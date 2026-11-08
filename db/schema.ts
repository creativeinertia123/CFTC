import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  int,
  float,
  tinyint,
  date,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/mysql-core";

/**
 * COT feature panel — one row per (report_date, market, trader_category).
 * Populated by the ingestion worker from the CFTC Legacy Combined annual
 * archives. All analytics (percentile, z-score, LWMA deviation, momentum...)
 * are computed server-side at ingestion time; the frontend renders whatever
 * the persisted panel contains.
 */
export const cotMarketFeatures = mysqlTable(
  "cot_market_features",
  {
    id: serial("id").primaryKey(),
    reportDate: date("report_date", { mode: "string" }).notNull(),
    // Deterministic identity: contract market code, suffixed when the code is
    // shared by more than one market name (dual-venue crypto listings).
    marketKey: varchar("market_key", { length: 40 }).notNull(),
    marketCode: varchar("market_code", { length: 16 }).notNull(),
    marketName: varchar("market_name", { length: 255 }).notNull(),
    assetClass: varchar("asset_class", { length: 32 }).notNull(),
    traderCategory: varchar("trader_category", { length: 32 }).notNull(),
    long: int("long").notNull(),
    short: int("short").notNull(),
    spreading: int("spreading").notNull(),
    net: int("net").notNull(),
    openInterest: int("open_interest").notNull(),
    percentile: float("percentile"),
    percentileLong: float("percentile_long"),
    percentileShort: float("percentile_short"),
    zscore: float("zscore"),
    wmaDev: float("wma_dev"),
    wowChange: int("wow_change"),
    oiShare: float("oi_share").notNull(),
    momentum2: int("momentum_2"),
    momentum4: int("momentum_4"),
    momentum8: int("momentum_8"),
    momentum16: int("momentum_16"),
    longShortRatio: float("long_short_ratio"),
    boundedNet: float("bounded_net").notNull(),
    crowding: tinyint("crowding").notNull().default(0),
  },
  (t) => [
    uniqueIndex("uq_feature").on(t.reportDate, t.marketKey, t.traderCategory),
    index("idx_feature_market").on(t.marketKey, t.reportDate),
    index("idx_feature_date").on(t.reportDate),
  ],
);

export const cotIngestionRuns = mysqlTable(
  "cot_ingestion_runs",
  {
    id: serial("id").primaryKey(),
    runAt: timestamp("run_at").notNull().defaultNow(),
    status: mysqlEnum("status", ["success", "error"]).notNull(),
    outcome: mysqlEnum("outcome", ["initial", "new_report", "revision", "no_update"]).notNull(),
    reportDate: date("report_date", { mode: "string" }),
    rowsParsed: int("rows_parsed").notNull().default(0),
    rowsInserted: int("rows_inserted").notNull().default(0),
    revisions: int("revisions").notNull().default(0),
    durationMs: int("duration_ms").notNull().default(0),
    payloadHash: varchar("payload_hash", { length: 64 }),
    error: text("error"),
  },
  (t) => [index("idx_runs_at").on(t.runAt)],
);

export const cotNotes = mysqlTable(
  "cot_notes",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    reportDate: date("report_date", { mode: "string" }).notNull(),
    version: int("version").notNull(),
    trigger: mysqlEnum("trigger", ["scheduled", "manual"]).notNull(),
    model: varchar("model", { length: 64 }),
    content: text("content").notNull(),
  },
  (t) => [index("idx_notes_date").on(t.reportDate)],
);

export type CotMarketFeature = typeof cotMarketFeatures.$inferSelect;
export type CotIngestionRun = typeof cotIngestionRuns.$inferSelect;
export type CotNote = typeof cotNotes.$inferSelect;
