# Architecture — Suspended Tickets Triage Center

This document describes the technical architecture, module design, data flows, and design decisions behind the Suspended Tickets Triage Center.

---

## System Overview

The app runs as an iframe inside the Zendesk Support interface (nav bar location). It communicates with the Zendesk API exclusively through the ZAF SDK's `client.request()` method, which handles authentication transparently.

```
┌─────────────────────────────────────────────────────────┐
│                    Zendesk Support UI                     │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │              App iframe (nav_bar)                   │  │
│  │                                                     │  │
│  │   iframe.html                                       │  │
│  │   ├── css/app.css          (Styling)                │  │
│  │   ├── js/cache.js          (IndexedDB layer)        │  │
│  │   ├── js/api.js            (Zendesk API wrapper)    │  │
│  │   ├── js/logger.js         (Audit log + CSV)        │  │
│  │   ├── js/search.js         (Search & filter)        │  │
│  │   ├── js/virtual-list.js   (Virtual scrolling)      │  │
│  │   ├── js/charts.js         (Chart.js rendering)     │  │
│  │   └── js/app.js            (Main controller)        │  │
│  │                                                     │  │
│  │   External CDN:                                     │  │
│  │   ├── ZAF SDK 2.0                                   │  │
│  │   ├── Zendesk Garden CSS packages                   │  │
│  │   └── Chart.js 4                                    │  │
│  └────────────────────────────────────────────────────┘  │
│                          │                                │
│                    ZAF SDK bridge                         │
│                          │                                │
│                   Zendesk REST API                        │
│              /api/v2/suspended_tickets                    │
└─────────────────────────────────────────────────────────┘
```

---

## Module Design

### Dependency Graph

```
app.js (controller)
├── api.js         (no deps)
├── cache.js       (no deps)
├── logger.js      (depends on: cache.js)
├── search.js      (no deps)
├── virtual-list.js(no deps)
└── charts.js      (depends on: search.js, Chart.js CDN)
```

Scripts are loaded in dependency order in `iframe.html`: cache → api → logger → search → virtual-list → charts → app.

### Module Responsibilities

| Module | Responsibility | Public API |
|--------|---------------|------------|
| `cache.js` | IndexedDB CRUD for tickets, meta, and action logs | `openDB()`, `getAllTickets()`, `upsertTickets()`, `removeTickets()`, `getMeta()`, `setMeta()`, `logAction()`, `getRecentLogs()`, `clearExpiredLogs()` |
| `api.js` | Zendesk API communication with pagination and rate limiting | `fetchPage()`, `fetchAllSuspendedTickets()`, `recoverTickets()`, `deleteTickets()` |
| `logger.js` | High-level audit logging and CSV export | `logRecovery()`, `logDeletion()`, `getRecentLogs()`, `downloadCSV()`, `exportTicketsAsCSV()` |
| `search.js` | Client-side text search, filtering, and repeat offender detection | `filterTickets()`, `extractCauses()`, `findRepeatOffenders()`, `debounce()` |
| `virtual-list.js` | Viewport-based rendering for large lists | `create()` → instance with `setItems()`, `selectAll()`, `getSelectedIds()`, `navigate()` |
| `charts.js` | Chart.js wrapper for trend and cause charts | `renderTrendChart()`, `renderCauseChart()`, `destroy()` |
| `app.js` | Main controller: ZAF init, event binding, state management, rendering | Self-initializing IIFE |

---

## Data Flow

### 1. Startup (Cache-First Loading)

```
1. DOMContentLoaded fires
2. app.js init() caches DOM references
3. ZAFClient.init() → client.on('app.registered')
4. Read all tickets from IndexedDB (cache.getAllTickets)
5. If cache has data:
   a. Set allTickets = cached data
   b. Render ticket list, dashboard, charts immediately
   c. Show "Showing cached data..." status
6. Check for resumable page (cache.getMeta('lastPage'))
7. Start API fetch (page 1 or resumed page)
8. On each page received:
   a. Upsert to IndexedDB
   b. Update progress bar (first load only)
   c. Save current page to meta (for resume)
9. On complete:
   a. Reconcile stale tickets (remove IDs not in API response)
   b. Clear resume state
   c. Re-render UI with fresh data
   d. Set lastFetchedAt meta
```

### 2. Bulk Action

```
1. User selects tickets via checkboxes
2. Clicks "Recover" or "Delete"
3. Confirmation modal shown
4. On confirm:
   a. Split IDs into batches of 100
   b. Call API sequentially (recover_many or destroy_many)
   c. On success: remove from IndexedDB
   d. Log action to actionLog store
   e. Remove from allTickets in memory
   f. Re-render list and dashboard
   g. Show success/error notification
```

### 3. Search & Filter

```
1. User types in search bar (debounced 250ms)
2. search.js filters allTickets:
   a. Text match: split query into terms, check each against searchable blob
   b. Cause filter: match cause_id if selected
   c. Sort: apply selected sort order
3. Filtered results passed to virtual list
4. Virtual list re-renders visible items only
```

---

## IndexedDB Design

### Database: `SuspendedTicketsTriageDB` v1

**Store: `tickets`**
- Key path: `id` (ticket ID from Zendesk API)
- Indexes: `cause_id`, `created_at`
- Contains: Full suspended ticket objects as returned by API

**Store: `actionLog`**
- Key path: `logId` (auto-increment)
- Indexes: `action`, `timestamp`, `ticketId`
- Contains: `{ action, ticketId, subject, author, cause, timestamp }`
- TTL: 30 days (purged on app startup via `clearExpiredLogs`)

**Store: `meta`**
- Key path: `key`
- Contains key-value pairs:
  - `lastFetchedAt`: ISO timestamp of last successful full sync
  - `lastPage`: Page number for resumable fetching

---

## Virtual Scrolling

The virtual list renders only items within the viewport plus a buffer of 10 items above and below. This enables smooth scrolling through thousands of tickets.

```
Total items: 5,000
Item height: 72px
Total scroll height: 360,000px (set on spacer element)
Viewport: ~500px
Visible items: ~7
Rendered items: ~27 (7 + 10 buffer top + 10 buffer bottom)
```

On scroll (throttled via `requestAnimationFrame`):
1. Calculate `startIndex` from `scrollTop / ITEM_HEIGHT - BUFFER`
2. Calculate `endIndex` from `(scrollTop + containerHeight) / ITEM_HEIGHT + BUFFER`
3. Render HTML for items[startIndex..endIndex]
4. Position items absolutely using `top: index * ITEM_HEIGHT`

---

## Rate Limiting

The Zendesk API enforces rate limits. The `api.js` module handles 429 responses with exponential backoff:

- Attempt 1: immediate
- Retry 1: wait 1 second
- Retry 2: wait 2 seconds
- Retry 3: wait 4 seconds
- After 3 retries: propagate error

Pagination also includes a 200ms delay between page fetches to stay well under rate limits.

---

## Security Considerations

- **No credentials stored** — Authentication handled entirely by ZAF SDK
- **No XSS** — All user-generated content escaped via `_escapeHtml()` (DOM-based escaping)
- **No external data transmission** — All data stays within Zendesk's domain and the browser's IndexedDB
- **CSV export** — Generated client-side, never sent to external servers
- **Secure iframing** — Runs within Zendesk's CSP-protected iframe sandbox

---

## Performance Characteristics

| Metric | Approach |
|--------|----------|
| First load | Progress bar, paginated fetch, incremental cache |
| Subsequent loads | Instant render from IndexedDB (~10ms for 1000 tickets) |
| Large lists (5000+) | Virtual scrolling, only ~27 DOM nodes rendered |
| Search | Client-side filtering, debounced input, no API calls |
| Bulk operations | Batched in groups of 100, sequential with progress feedback |
| Memory | Ticket objects stored in IndexedDB, only filtered subset in JS memory |

---

## Design Decisions

1. **No build step** — Zendesk apps are typically simple iframe apps. Avoiding Webpack/Rollup keeps deployment simple (just ZIP and upload).

2. **No framework (React/Vue)** — The app is small enough that vanilla JS with module pattern keeps the bundle tiny and avoids framework overhead in the iframe.

3. **IndexedDB over localStorage** — localStorage has a 5MB limit and is synchronous. IndexedDB handles structured data, has no practical size limit, and is async (won't block the UI thread).

4. **Garden CSS via CDN** — Following Zendesk's recommendation for consistent styling. In production, these should be downloaded and bundled with the app to avoid CDN dependency.

5. **Chart.js** — Lightweight (~60KB gzipped) charting library that works well in constrained iframe environments. No D3.js overhead.

6. **Stale-while-revalidate** — Suspended tickets change infrequently, making this caching pattern ideal. Users see data immediately while fresh data loads in the background.

7. **30-day log TTL** — Balances audit trail usefulness with IndexedDB storage. Expired logs are purged on each app startup.
