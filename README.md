# CFTC

A dark, analyst-first dashboard for CFTC Commitments of Traders positioning, built on React + tRPC + Hono + MySQL. It ingests the official Legacy Combined reports, computes expanding-window analytics for every published market, and refreshes itself when a new report lands.

## Quickstart

```bash
npm install
npm run db:push   # sync schema
npm run dev       # http://localhost:3000
npm run check && npm run build && npm start   # production
```

On an empty database the first overview query triggers a background initial ingestion (~1 minute for three years of archives); the UI shows a loading state and populates automatically.

## What it does

- **Overview** — every market in the latest report: long/short/net, open interest, percentile, z-score, WMA deviation, WoW change, crowding flag, 16-week sparkline, with dynamic search and asset-class filters.
- **Market drill-down** (`/market/:code`) — 2W/4W/8W/16W lookbacks, cohort history, feature snapshot, cohort comparison.
- **Matrix** (`/matrix`) — long/short/net percentile ranks per asset class.
- **Update log + Note** (`/updates`, `/note`) — persistent ingestion run log and a deterministic, versioned trade note with regenerate.

## Data pipeline

`api/cot/ingest.ts` runs a deterministic cycle:

1. Read the latest persisted report date and previous payload hash.
2. Download only the year partitions that can contain new data from the CFTC annual archives (`deacot{year}.zip`), using a browser-like TLS profile (`api/cot/download.ts`) because the CFTC edge blocks Node's default fingerprint.
3. Hash the latest slice to classify **new report** / **revision** / **no update**.
4. Replace the affected slice and recompute the feature series (percentile ranks, z-score, 26-week LWMA deviation, WoW change, momentum 2/4/8/16W, long/short ratio, crowding). No per-market constants; analytics are functions of the loaded series.
5. Append a run record for every outcome, including no-update, and push it to the SSE bus.

Schema: `cot_market_features` (one row per date x market x trader category), `cot_ingestion_runs`, `cot_notes` — all three trader cohorts retained.

## Auto-update

- **SSE**: `GET /api/cot/events` streams ingestion events; the layout invalidates views on completion and degrades to a 60-second poll if the stream drops.
- **Cron**: `POST /api/scheduled/cftc-ingestion` is the production callback (secret via `x-cot-ingestion-secret` when `CFTC_INGESTION_SECRET` is set). Schedule `0 0 * * 6` — 00:00 UTC Saturday, after the Friday 15:30 ET publication. The Update log's **Run check now** calls the same worker through tRPC.
- After a new report or revision, a fresh note is encoded server-side by a deterministic pure-JS renderer (`api/cot/note.ts`): same panel, same text, no model call. No note is generated for no-update outcomes.

## Layout

```
api/            Hono server, tRPC router, COT ingest/download/note workers
db/             Drizzle schema + relations
src/pages/      Overview, Matrix, Updates, Note, Market drill-down, NotFound
src/components/ Sparkline, layout, ui (shadcn)
contracts/      Shared types and errors
```

## Notes

- Every market is kept exactly as published (512 distinct markets across 2024–2026); no crypto exclusion or micro-to-parent aggregation is applied.
- The note generator and the Socrata-based worker from the source package are replaced by the deterministic encoder and the annual-archive path described above; outcomes, hashing semantics, and table contracts are unchanged.
- Copy follows British English conventions.
