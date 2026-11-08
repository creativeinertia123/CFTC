/**
 * COT ingestion worker.
 *
 * Deterministic, bounded per run:
 *   1. Read the latest persisted report date and the latest run's payload hash.
 *   2. Download only the year partitions that can contain new data
 *      (on an empty panel: the current year and the two preceding years).
 *   3. Hash the latest report slice to distinguish new report / revision /
 *      no update.
 *   4. On new or revised data: replace the affected date slice, recompute
 *      features for the affected (market, category) series and upsert them.
 *   5. Append a run record for every outcome — including a successful
 *      holiday-week no-update — and push it to the SSE bus.
 *
 * No long-lived child process; each execution is a single bounded fetch-parse-
 * compute-write cycle triggerable from the cron route, the "Run check now"
 * action, or the first-page-view auto-seed.
 */
import { createHash } from "crypto";
import { desc, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import {
  cotMarketFeatures,
  cotIngestionRuns,
  type CotIngestionRun,
} from "../../db/schema";
import { classifyAssetClass } from "./classify";
import { fetchYearArchive, type RawCotRow } from "./parse";
import { computeFeatures } from "./features";
import { publishCotEvent } from "./events";
import { log } from "../lib/logger";

const TRADER_CATEGORIES = ["noncommercial", "commercial", "nonreportable"] as const;
type TraderCategory = (typeof TRADER_CATEGORIES)[number];

interface PanelRow {
  reportDate: string;
  marketKey: string;
  marketCode: string;
  marketName: string;
  assetClass: string;
  traderCategory: TraderCategory;
  long: number;
  short: number;
  spreading: number;
  net: number;
  openInterest: number;
  percentile: number | null;
  percentileLong: number | null;
  percentileShort: number | null;
  zscore: number | null;
  wmaDev: number | null;
  wowChange: number | null;
  oiShare: number;
  momentum2: number | null;
  momentum4: number | null;
  momentum8: number | null;
  momentum16: number | null;
  longShortRatio: number | null;
  boundedNet: number;
  crowding: number;
}

function categoryValues(r: RawCotRow, cat: TraderCategory) {
  switch (cat) {
    case "noncommercial":
      return { long: r.noncommLong, short: r.noncommShort, spreading: r.noncommSpreading };
    case "commercial":
      return { long: r.commLong, short: r.commShort, spreading: 0 };
    case "nonreportable":
      return { long: r.nonrepLong, short: r.nonrepShort, spreading: 0 };
  }
}

/** Deterministic market identity; codes shared by several venues get a suffix. */
function buildMarketKeys(rows: RawCotRow[]): Map<string, string> {
  const byCode = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!byCode.has(r.marketCode)) byCode.set(r.marketCode, new Set());
    byCode.get(r.marketCode)!.add(r.marketName);
  }
  const keys = new Map<string, string>();
  for (const r of rows) {
    const names = [...byCode.get(r.marketCode)!].sort();
    const key =
      names.length === 1
        ? r.marketCode
        : `${r.marketCode}~${names.indexOf(r.marketName) + 1}`;
    keys.set(r.marketName, key);
  }
  return keys;
}

function hashLatestSlice(rows: RawCotRow[]): { hash: string; latestDate: string } {
  const latest = rows.reduce((m, r) => (r.date > m ? r.date : m), "");
  const slice = rows
    .filter((r) => r.date === latest)
    .map((r) => [r.marketCode, r.marketName, r.openInterest, r.noncommLong, r.noncommShort, r.commLong, r.commShort, r.nonrepLong, r.nonrepShort].join("|"))
    .sort();
  return {
    hash: createHash("sha256").update(slice.join("\n")).digest("hex"),
    latestDate: latest,
  };
}

function publishRun(run: CotIngestionRun) {
  publishCotEvent({
    type: "run",
    id: run.id,
    runAt: run.runAt.toISOString(),
    status: run.status,
    outcome: run.outcome,
    reportDate: run.reportDate,
    rowsParsed: run.rowsParsed,
    rowsInserted: run.rowsInserted,
    revisions: run.revisions,
    durationMs: run.durationMs,
    error: run.error,
  });
}

async function recordRun(
  data: Omit<typeof cotIngestionRuns.$inferInsert, "runAt">,
): Promise<CotIngestionRun> {
  const db = getDb();
  const inserted = await db.insert(cotIngestionRuns).values(data).$returningId();
  const [run] = await db
    .select()
    .from(cotIngestionRuns)
    .where(eq(cotIngestionRuns.id, inserted[0].id));
  publishRun(run);
  return run;
}

let running: Promise<CotIngestionRun> | null = null;

/** Serialise runs: overlapping triggers collapse into the in-flight run. */
export function runIngestion(): Promise<CotIngestionRun> {
  if (running) return running;
  running = (async () => {
    const start = Date.now();
    try {
      return await ingestOnce(start);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function ingestOnce(start: number): Promise<CotIngestionRun> {
  const db = getDb();
  const [latestStored] = await db
    .select({ reportDate: cotMarketFeatures.reportDate })
    .from(cotMarketFeatures)
    .orderBy(desc(cotMarketFeatures.reportDate))
    .limit(1);
  const [lastRun] = await db
    .select()
    .from(cotIngestionRuns)
    .orderBy(desc(cotIngestionRuns.id))
    .limit(1);

  const currentYear = new Date().getUTCFullYear();
  const firstYear = latestStored ? Number(latestStored.reportDate.slice(0, 4)) : currentYear - 2;
  const years: number[] = [];
  for (let y = firstYear; y <= currentYear; y++) years.push(y);

  const all: RawCotRow[] = [];
  let parsed = 0;
  let skipped = 0;
  for (const y of years) {
    const archive = await fetchYearArchive(y);
    all.push(...archive.rows);
    parsed += archive.parsed;
    skipped += archive.skipped;
  }
  if (skipped > 0) log.warn("cot ingestion skipped invalid rows", { skipped });

  const { hash, latestDate } = hashLatestSlice(all);
  const storedLatest = latestStored ? String(latestStored.reportDate).slice(0, 10) : null;
  const isInitial = !storedLatest;
  // A report date counts as stored only if the panel actually holds rows for
  // it — a run that crashed mid-insert leaves a later MAX(report_date) than
  // the dates that were fully written, and must be treated as not-stored.
  let storedDates = new Set<string>();
  if (storedLatest) {
    const dateRows = await db
      .select({ reportDate: cotMarketFeatures.reportDate })
      .from(cotMarketFeatures)
      .groupBy(cotMarketFeatures.reportDate);
    storedDates = new Set(dateRows.map((r) => String(r.reportDate).slice(0, 10)));
  }
  const isNew = !isInitial && !storedDates.has(latestDate);
  const isRevision =
    !isInitial && !isNew && lastRun?.payloadHash !== null && lastRun?.payloadHash !== hash;

  if (!isInitial && !isNew && !isRevision) {
    return recordRun({
      status: "success",
      outcome: "no_update",
      reportDate: latestDate,
      rowsParsed: parsed,
      rowsInserted: 0,
      revisions: 0,
      durationMs: Date.now() - start,
      payloadHash: hash,
    });
  }

  // Replace every stored date the incoming slice touches — including the
  // stored latest date on a new report (its features must be recomputed with
  // the extended history), and any crash-partial dates below it.
  const sliceRows = isInitial ? all : all.filter((r) => r.date >= (storedLatest ?? ""));
  const marketKeys = buildMarketKeys(all);
  const affectedDates = [...new Set(sliceRows.map((r) => r.date))].sort();
  if (!isInitial) {
    for (const d of [...storedDates].filter((d) => d >= (storedLatest ?? ""))) {
      if (!affectedDates.includes(d)) affectedDates.push(d);
    }
    affectedDates.sort();
  }

  if (isInitial) {
    await db.delete(cotMarketFeatures);
  } else {
    for (const d of affectedDates) {
      await db.delete(cotMarketFeatures).where(eq(cotMarketFeatures.reportDate, d));
    }
  }

  // Full history per (marketKey, category) for feature computation.
  const remaining = await db
    .select()
    .from(cotMarketFeatures)
    .orderBy(cotMarketFeatures.reportDate);
  const seriesMap = new Map<string, { point: { long: number; short: number; openInterest: number }; row: PanelRow }[]>();
  for (const r of remaining) {
    const k = `${r.marketKey}|${r.traderCategory}`;
    if (!seriesMap.has(k)) seriesMap.set(k, []);
    seriesMap.get(k)!.push({
      point: { long: r.long, short: r.short, openInterest: r.openInterest },
      row: {
        reportDate: String(r.reportDate),
        marketKey: r.marketKey,
        marketCode: r.marketCode,
        marketName: r.marketName,
        assetClass: r.assetClass,
        traderCategory: r.traderCategory as TraderCategory,
        long: r.long,
        short: r.short,
        spreading: r.spreading,
        net: r.net,
        openInterest: r.openInterest,
        percentile: r.percentile,
        percentileLong: r.percentileLong,
        percentileShort: r.percentileShort,
        zscore: r.zscore,
        wmaDev: r.wmaDev,
        wowChange: r.wowChange,
        oiShare: r.oiShare,
        momentum2: r.momentum2,
        momentum4: r.momentum4,
        momentum8: r.momentum8,
        momentum16: r.momentum16,
        longShortRatio: r.longShortRatio,
        boundedNet: r.boundedNet,
        crowding: r.crowding,
      },
    });
  }

  // Append the new slice, then recompute features for the affected series.
  const byMarketDate = new Map<string, RawCotRow[]>();
  for (const r of sliceRows) {
    if (!byMarketDate.has(r.marketName)) byMarketDate.set(r.marketName, []);
    byMarketDate.get(r.marketName)!.push(r);
  }
  const affectedKeys = new Set<string>();
  for (const [name, mRows] of byMarketDate) {
    const marketKey = marketKeys.get(name)!;
    const assetClass = classifyAssetClass(name);
    for (const r of mRows) {
      for (const cat of TRADER_CATEGORIES) {
        const v = categoryValues(r, cat);
        const k = `${marketKey}|${cat}`;
        if (!seriesMap.has(k)) seriesMap.set(k, []);
        seriesMap.get(k)!.push({
          point: { long: v.long, short: v.short, openInterest: r.openInterest },
          row: {
            reportDate: r.date,
            marketKey,
            marketCode: r.marketCode,
            marketName: name,
            assetClass,
            traderCategory: cat,
            long: v.long,
            short: v.short,
            spreading: v.spreading,
            net: v.long - v.short,
            openInterest: r.openInterest,
            percentile: null, percentileLong: null, percentileShort: null,
            zscore: null, wmaDev: null, wowChange: null,
            oiShare: 0, momentum2: null, momentum4: null, momentum8: null, momentum16: null,
            longShortRatio: null, boundedNet: 0, crowding: 0,
          },
        });
        affectedKeys.add(k);
      }
    }
  }

  const upsertRows: PanelRow[] = [];
  for (const k of affectedKeys) {
    // Source files are newest-first; the feature series must be chronological.
    const series = seriesMap
      .get(k)!
      .slice()
      .sort((a, b) => a.row.reportDate.localeCompare(b.row.reportDate));
    const feats = computeFeatures(series.map((s) => s.point));
    for (let i = 0; i < series.length; i++) {
      const f = feats[i];
      upsertRows.push({
        ...series[i].row,
        percentile: f.percentile,
        percentileLong: f.percentileLong,
        percentileShort: f.percentileShort,
        zscore: f.zscore,
        wmaDev: f.wmaDev,
        wowChange: f.wowChange,
        oiShare: f.oiShare,
        momentum2: f.momentum2,
        momentum4: f.momentum4,
        momentum8: f.momentum8,
        momentum16: f.momentum16,
        longShortRatio: f.longShortRatio,
        boundedNet: f.boundedNet,
        crowding: f.crowding ? 1 : 0,
      });
    }
  }

  const CHUNK = 200;
  for (let i = 0; i < upsertRows.length; i += CHUNK) {
    // Writes are idempotent at the boundary level: runs are serialised and
    // every affected date slice is deleted just above, so a plain insert
    // converges regardless of what a crashed run left behind.
    await db.insert(cotMarketFeatures).values(upsertRows.slice(i, i + CHUNK));
  }

  const revisions = isRevision ? countRevisionRows(lastRun!, affectedDates) : 0;
  const run = await recordRun({
    status: "success",
    outcome: isInitial ? "initial" : isNew ? "new_report" : "revision",
    reportDate: latestDate,
    rowsParsed: parsed,
    rowsInserted: upsertRows.length,
    revisions,
    durationMs: Date.now() - start,
    payloadHash: hash,
  });
  log.info("cot ingestion completed", {
    outcome: run.outcome,
    reportDate: run.reportDate,
    rowsInserted: run.rowsInserted,
    durationMs: run.durationMs,
  });
  return run;
}

/** Revision magnitude: rows re-written for dates that were already stored. */
function countRevisionRows(lastRun: CotIngestionRun, affectedDates: string[]): number {
  if (!lastRun.reportDate) return 0;
  return affectedDates.filter((d) => d <= String(lastRun.reportDate)).length;
}

/** Exposed for the router: run the worker and record failures as runs. */
export async function runIngestionGuarded(): Promise<CotIngestionRun> {
  try {
    return await runIngestion();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("cot ingestion failed", { error: message, stack: err instanceof Error ? err.stack : undefined });
    return recordRun({
      status: "error",
      outcome: "no_update",
      reportDate: null,
      rowsParsed: 0,
      rowsInserted: 0,
      revisions: 0,
      durationMs: 0,
      payloadHash: null,
      error: message,
    });
  }
}

export const ingestionInternals = { hashLatestSlice, buildMarketKeys };
