# CFTC

CFTC is a dashboard for CFTC Commitments of Traders positioning. 

## Product scope

The interface is organised around the latest combined futures + options Legacy report and exposes four surfaces:

- **Overview** — every market in the latest report with long, short, net, open interest, percentile, z-score, WMA deviation, long/short ratio, week-over-week change, crowding flag, and a 16-week net sparkline. Search and asset-class filters are dynamic, derived from the persisted panel.
- **Market drill-down** (`/market/:code`) — 2W / 4W / 8W / 16W lookback controls, net-positioning history lines per trader cohort, a full feature snapshot, and a cohort comparison table.
- **Matrix** (`/matrix`) — long, short, and net percentile ranks across a selected asset class.
- **Update log + Note** (`/updates`, `/note`) — a persistent ingestion run log (including holiday-week no-update events) and a versioned, server-generated trade note with history and an explicit regenerate action.

## Data pipeline

The ingestion worker (`api/cot/ingest.ts`) runs a deterministic, bounded cycle:

1. Read the latest persisted report date and the previous run's payload hash.
2. Download only the year partitions that can contain new data (on an empty panel: the current year and the two preceding years) from the official CFTC Legacy Combined annual archives (`https://www.cftc.gov/files/dea/history/deacot{year}.zip`). The download path uses a browser-like TLS profile because the CFTC edge blocks Node's default client fingerprint; this is isolated in `api/cot/download.ts`.
3. Hash the latest report slice to distinguish **new report** / **revision** / **no update**.
4. Replace the affected date slice and recompute the feature series (expanding-window percentile ranks for long/short/net, z-score, 26-week linearly weighted moving average deviation, WoW change, OI share, momentum at 2/4/8/16 weeks, long/short ratio, bounded net sentiment, crowding flag). No per-market constants anywhere; analytics are functions of the loaded series.
5. Append a run record for every outcome — including a successful no-update — and push it to the SSE bus.

Canonical panel schema (one row per report date × market × trader category) lives in `db/schema.ts` (`cot_market_features`), with run records in `cot_ingestion_runs` and notes in `cot_notes`. All three trader cohorts (non-commercial, commercial, non-reportable) are retained.

## Auto-update

- **SSE wire-in**: `GET /api/cot/events` streams ingestion events; the layout subscribes and invalidates the views when a run completes, so the dashboard refreshes itself. If the stream drops, the client degrades to a 60-second poll.
- **Cron**: `POST /api/scheduled/cftc-ingestion` is the production callback (secret via the `x-cot-ingestion-secret` header when `CFTC_INGESTION_SECRET` is set). Point a project Heartbeat at it with `0 0 * * 6` (00:00 UTC Saturday, safely after the Friday 15:30 ET publication). The Update log's **Run check now** action calls the same worker through tRPC.
- After a **new report** or **revision**, a fresh note is generated server-side through the platform model gateway and stored as a new version. No automatic note is generated for no-update outcomes.

## Local development

```bash
npm install
npm run db:push   # sync schema
npm run dev       # http://localhost:3000
npm run check && npm run build && npm start
```

On an empty database the first overview query triggers a background initial ingestion (~1 minute for three years of archives); the UI shows a loading state and populates automatically.
