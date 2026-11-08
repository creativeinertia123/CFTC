/**
 * tRPC router for the COT workspace. Every read is served from the persisted
 * feature panel; when the panel is empty the first query triggers a bounded
 * background ingestion (auto-seed) and reports `seeding: true` so the
 * frontend can poll until data lands.
 */
import { z } from "zod";
import { desc, eq, and, inArray } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import {
  cotMarketFeatures,
  cotIngestionRuns,
  cotNotes,
} from "../../db/schema";
import { runIngestionGuarded } from "./ingest";
import { maybeGenerateScheduledNote } from "./note";
import { log } from "../lib/logger";

let seeding: Promise<unknown> | null = null;

function ensureSeeded() {
  if (!seeding) {
    seeding = runIngestionGuarded().catch((err) => {
      log.error("auto-seed failed", { error: err instanceof Error ? err.message : String(err) });
    });
  }
  return seeding;
}

const LOOKBACKS = [2, 4, 8, 16] as const;

export const cotRouter = createRouter({
  meta: publicQuery.query(async () => {
    const db = getDb();
    const [latest] = await db
      .select({ reportDate: cotMarketFeatures.reportDate })
      .from(cotMarketFeatures)
      .orderBy(desc(cotMarketFeatures.reportDate))
      .limit(1);
    if (!latest) {
      ensureSeeded();
      return { reportDate: null as string | null, marketCount: 0, seeding: true };
    }
    const reportDate = String(latest.reportDate);
    const [row] = await db
      .select({ n: cotMarketFeatures.marketKey })
      .from(cotMarketFeatures)
      .where(eq(cotMarketFeatures.reportDate, reportDate))
      .groupBy(cotMarketFeatures.marketKey)
      .limit(1);
    void row;
    const countRows = await db
      .select({ marketKey: cotMarketFeatures.marketKey })
      .from(cotMarketFeatures)
      .where(eq(cotMarketFeatures.reportDate, reportDate))
      .groupBy(cotMarketFeatures.marketKey);
    return { reportDate, marketCount: countRows.length, seeding: false };
  }),

  overview: publicQuery.query(async () => {
    const db = getDb();
    const [latest] = await db
      .select({ reportDate: cotMarketFeatures.reportDate })
      .from(cotMarketFeatures)
      .orderBy(desc(cotMarketFeatures.reportDate))
      .limit(1);
    if (!latest) {
      ensureSeeded();
      return { reportDate: null as string | null, rows: [] };
    }
    const reportDate = String(latest.reportDate);
    const latestRows = await db
      .select()
      .from(cotMarketFeatures)
      .where(eq(cotMarketFeatures.reportDate, reportDate));

    // 16-week sparkline window for the headline (non-commercial) series.
    const dates = (
      await db
        .select({ reportDate: cotMarketFeatures.reportDate })
        .from(cotMarketFeatures)
        .groupBy(cotMarketFeatures.reportDate)
        .orderBy(desc(cotMarketFeatures.reportDate))
        .limit(16)
    ).map((d) => String(d.reportDate));
    const windowRows = dates.length
      ? await db
          .select()
          .from(cotMarketFeatures)
          .where(
            and(
              inArray(cotMarketFeatures.reportDate, dates),
              eq(cotMarketFeatures.traderCategory, "noncommercial"),
            ),
          )
      : [];
    const nets = new Map<string, number[]>();
    for (const r of windowRows) {
      if (!nets.has(r.marketKey)) nets.set(r.marketKey, []);
    }
    for (const d of [...dates].reverse()) {
      const byMarket = new Map<string, number>();
      for (const r of windowRows) {
        if (String(r.reportDate) === d) byMarket.set(r.marketKey, r.net);
      }
      for (const [k, arr] of nets) arr.push(byMarket.get(k) ?? 0);
    }

    const byMarket = new Map<string, (typeof latestRows)[number]>[]>();
    for (const r of latestRows) {
      if (!byMarket.has(r.marketKey)) byMarket.set(r.marketKey, []);
      byMarket.get(r.marketKey)!.push(r);
    }
    const rows = [...byMarket.entries()].map(([marketKey, cats]) => {
      const nc = cats.find((c) => c.traderCategory === "noncommercial")!;
      const comm = cats.find((c) => c.traderCategory === "commercial")!;
      return {
        marketKey,
        marketCode: nc.marketCode,
        marketName: nc.marketName,
        assetClass: nc.assetClass,
        openInterest: nc.openInterest,
        long: nc.long,
        short: nc.short,
        net: nc.net,
        wowChange: nc.wowChange,
        percentile: nc.percentile,
        percentileLong: nc.percentileLong,
        percentileShort: nc.percentileShort,
        zscore: nc.zscore,
        wmaDev: nc.wmaDev,
        oiShare: nc.oiShare,
        longShortRatio: nc.longShortRatio,
        boundedNet: nc.boundedNet,
        crowding: nc.crowding === 1,
        commercialNet: comm.net,
        spark: nets.get(marketKey) ?? [],
      };
    });
    rows.sort((a, b) => b.openInterest - a.openInterest);
    return { reportDate, rows };
  }),

  marketDetail: publicQuery
    .input(z.object({ key: z.string(), lookback: z.number().int().min(2).max(16).default(16) }))
    .query(async ({ input }) => {
      const db = getDb();
      const all = await db
        .select()
        .from(cotMarketFeatures)
        .where(eq(cotMarketFeatures.marketKey, input.key))
        .orderBy(desc(cotMarketFeatures.reportDate))
        .limit(52 * 3);
      if (all.length === 0) {
        ensureSeeded();
        return { found: false as const };
      }
      const latest = all[0];
      const dates = [...new Set(all.map((r) => String(r.reportDate)))].sort().reverse();
      const lookDates = new Set(dates.slice(0, input.lookback));
      const history = all
        .filter((r) => lookDates.has(String(r.reportDate)))
        .map((r) => ({
          reportDate: String(r.reportDate),
          traderCategory: r.traderCategory,
          long: r.long,
          short: r.short,
          spreading: r.spreading,
          net: r.net,
        }));
      const snapshotRows = all.filter((r) => String(r.reportDate) === String(latest.reportDate));
      const snapshot = snapshotRows.map((r) => ({
        traderCategory: r.traderCategory,
        long: r.long,
        short: r.short,
        spreading: r.spreading,
        net: r.net,
        openInterest: r.openInterest,
        percentile: r.percentile,
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
        crowding: r.crowding === 1,
      }));
      return {
        found: true as const,
        reportDate: String(latest.reportDate),
        marketKey: latest.marketKey,
        marketCode: latest.marketCode,
        marketName: latest.marketName,
        assetClass: latest.assetClass,
        history,
        snapshot,
      };
    }),

  matrix: publicQuery
    .input(z.object({ assetClass: z.string().default("Energy") }))
    .query(async ({ input }) => {
      const db = getDb();
      const [latest] = await db
        .select({ reportDate: cotMarketFeatures.reportDate })
        .from(cotMarketFeatures)
        .orderBy(desc(cotMarketFeatures.reportDate))
        .limit(1);
      if (!latest) {
        ensureSeeded();
        return { reportDate: null as string | null, rows: [] };
      }
      const reportDate = String(latest.reportDate);
      const rows = await db
        .select()
        .from(cotMarketFeatures)
        .where(
          and(
            eq(cotMarketFeatures.reportDate, reportDate),
            eq(cotMarketFeatures.traderCategory, "noncommercial"),
            eq(cotMarketFeatures.assetClass, input.assetClass),
          ),
        )
        .orderBy(desc(cotMarketFeatures.openInterest));
      return {
        reportDate,
        rows: rows.map((r) => ({
          marketKey: r.marketKey,
          marketName: r.marketName,
          openInterest: r.openInterest,
          percentileLong: r.percentileLong,
          percentileShort: r.percentileShort,
          percentile: r.percentile,
          net: r.net,
        })),
      };
    }),

  assetClasses: publicQuery.query(async () => {
    const db = getDb();
    const [latest] = await db
      .select({ reportDate: cotMarketFeatures.reportDate })
      .from(cotMarketFeatures)
      .orderBy(desc(cotMarketFeatures.reportDate))
      .limit(1);
    if (!latest) return [];
    const rows = await db
      .select({ assetClass: cotMarketFeatures.assetClass, key: cotMarketFeatures.marketKey })
      .from(cotMarketFeatures)
      .where(eq(cotMarketFeatures.reportDate, String(latest.reportDate)))
      .groupBy(cotMarketFeatures.assetClass, cotMarketFeatures.marketKey);
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.assetClass, (counts.get(r.assetClass) ?? 0) + 1);
    return [...counts.entries()]
      .map(([assetClass, count]) => ({ assetClass, count }))
      .sort((a, b) => b.count - a.count);
  }),

  refreshHistory: publicQuery.query(async () => {
    const db = getDb();
    const runs = await db
      .select()
      .from(cotIngestionRuns)
      .orderBy(desc(cotIngestionRuns.id))
      .limit(30);
    return runs.map((r) => ({
      id: r.id,
      runAt: r.runAt,
      status: r.status,
      outcome: r.outcome,
      reportDate: r.reportDate,
      rowsParsed: r.rowsParsed,
      rowsInserted: r.rowsInserted,
      revisions: r.revisions,
      durationMs: r.durationMs,
      error: r.error,
    }));
  }),

  runCheck: publicQuery.mutation(async () => {
    const run = await runIngestionGuarded();
    if (run.status === "success" && (run.outcome === "new_report" || run.outcome === "revision")) {
      void maybeGenerateScheduledNote(run.outcome);
    }
    return run;
  }),

  noteLatest: publicQuery.query(async () => {
    const db = getDb();
    const [note] = await db.select().from(cotNotes).orderBy(desc(cotNotes.version)).limit(1);
    return note ?? null;
  }),

  noteHistory: publicQuery.query(async () => {
    const db = getDb();
    const notes = await db
      .select({
        id: cotNotes.id,
        createdAt: cotNotes.createdAt,
        reportDate: cotNotes.reportDate,
        version: cotNotes.version,
        trigger: cotNotes.trigger,
      })
      .from(cotNotes)
      .orderBy(desc(cotNotes.version))
      .limit(20);
    return notes;
  }),

  noteById: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const db = getDb();
    const [note] = await db.select().from(cotNotes).where(eq(cotNotes.id, input.id));
    return note ?? null;
  }),

  noteRegenerate: publicQuery.mutation(async () => {
    const { generateCotNote } = await import("./note");
    return generateCotNote("manual");
  }),
});

export { LOOKBACKS };
