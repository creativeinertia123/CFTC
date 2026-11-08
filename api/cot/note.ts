/**
 * COT trade note encoder.
 *
 * Deterministic, pure-JS rendering of the persisted feature panel into the
 * weekly trade note. No model call, no randomness: the same panel always
 * produces the same text. All figures come from the computed features —
 * nothing is hardcoded per market.
 */
import { desc, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { cotMarketFeatures, cotNotes, type CotNote } from "../../db/schema";
import { log } from "../lib/logger";

const LINE_WIDTH = 78;

interface DigestLine {
  market: string;
  cls: string;
  net: number;
  wow: number | null;
  percentile: number | null;
  zscore: number | null;
  crowding: boolean;
}

async function buildDigest(): Promise<{ reportDate: string; lines: DigestLine[] }> {
  const db = getDb();
  const [latest] = await db
    .select({ reportDate: cotMarketFeatures.reportDate })
    .from(cotMarketFeatures)
    .orderBy(desc(cotMarketFeatures.reportDate))
    .limit(1);
  if (!latest) throw new Error("The feature panel is empty — run ingestion first.");
  const reportDate = String(latest.reportDate).slice(0, 10);
  const rows = await db
    .select()
    .from(cotMarketFeatures)
    .where(eq(cotMarketFeatures.reportDate, reportDate));
  const lines: DigestLine[] = rows
    .filter((r) => r.traderCategory === "noncommercial")
    .map((r) => ({
      market: r.marketName,
      cls: r.assetClass,
      net: r.net,
      wow: r.wowChange,
      percentile: r.percentile,
      zscore: r.zscore,
      crowding: r.crowding === 1,
    }));
  return { reportDate, lines };
}

function formatCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

function signedCompact(n: number): string {
  return `${n >= 0 ? "+" : ""}${formatCompact(n)}`;
}

function rule(char = "-"): string {
  return char.repeat(LINE_WIDTH);
}

function heading(text: string): string {
  return `\n${rule("=")}\n${text}\n${rule("=")}`;
}

function wrap(text: string, indent = ""): string {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = indent;
  for (const w of words) {
    if ((line + (line === indent ? "" : " ") + w).length > LINE_WIDTH) {
      out.push(line);
      line = indent + w;
    } else {
      line += (line === indent ? "" : " ") + w;
    }
  }
  if (line.trim().length > 0) out.push(line);
  return out.join("\n");
}

function ordinal(p: number): string {
  const v = Math.round(p);
  const suffix = v % 100 >= 11 && v % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][Math.min(v % 10, 4)] ?? "th";
  return `${v}${suffix}`;
}

function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${d} ${months[m - 1]} ${y}`;
}

export function encodeNote(reportDate: string, lines: DigestLine[]): string {
  const byClass = new Map<string, DigestLine[]>();
  for (const l of lines) {
    if (!byClass.has(l.cls)) byClass.set(l.cls, []);
    byClass.get(l.cls)!.push(l);
  }

  const parts: string[] = [];
  parts.push(heading(`WEEKLY COT TRADE NOTE — REPORT DATE ${reportDate}`));
  parts.push(
    wrap(
      `Positions as at ${longDate(reportDate)}; published by the CFTC the following Friday and one week stale by design. ` +
        `Universe: ${lines.length} markets, Legacy Combined futures + options.`,
    ),
  );

  // ---- Aggregate tone per asset class ------------------------------------
  parts.push(heading("AGGREGATE POSITIONING TONE"));
  const classMoves = [...byClass.entries()].map(([cls, ls]) => {
    const netSum = ls.reduce((a, l) => a + l.net, 0);
    const wowSum = ls.reduce((a, l) => a + (l.wow ?? 0), 0);
    const moved = ls.filter((l) => l.wow !== null && l.wow !== 0).length;
    const pct = ls.length > 0 ? (moved / ls.length) * 100 : 0;
    return { cls, netSum, wowSum, moved, total: ls.length, pct };
  });
  const biggestCut = [...classMoves].sort((a, b) => a.wowSum - b.wowSum)[0];
  const biggestAdd = [...classMoves].sort((a, b) => b.wowSum - a.wowSum)[0];
  for (const c of classMoves) {
    parts.push(
      wrap(
        `${c.cls}: aggregate non-commercial net ${signedCompact(c.netSum)} ` +
          `(${signedCompact(c.wowSum)} WoW across ${c.total} markets).`,
      ),
    );
  }
  if (biggestAdd && biggestCut && biggestAdd.cls !== biggestCut.cls) {
    parts.push(
      wrap(
        `The week's centre of gravity: largest net additions in ${biggestAdd.cls}, largest reductions in ${biggestCut.cls}.`,
      ),
    );
  }

  // ---- Largest WoW net changes -------------------------------------------
  parts.push(heading("LARGEST WEEK-OVER-WEEK NET CHANGES (NON-COMMERCIAL)"));
  const movers = [...lines]
    .filter((l) => l.wow !== null)
    .sort((a, b) => Math.abs(b.wow!) - Math.abs(a.wow!))
    .slice(0, 10);
  for (const m of movers) {
    const pct = m.percentile !== null ? `, ${ordinal(m.percentile)} percentile` : "";
    const z = m.zscore !== null ? `, z ${m.zscore.toFixed(2)}` : "";
    parts.push(wrap(`- ${m.market} [${m.cls}]: net ${formatCompact(m.net)}, WoW ${signedCompact(m.wow!)}${pct}${z}`));
  }

  // ---- Crowding ------------------------------------------------------------
  parts.push(heading("CROWDING FLAGS (NET PERCENTILE >= 90 OR <= 10)"));
  const crowded = lines.filter((l) => l.crowding);
  if (crowded.length === 0) {
    parts.push(wrap("No market is flagged this week."));
  } else {
    for (const m of crowded) {
      const side = (m.percentile ?? 50) >= 90 ? "crowded long" : "crowded short";
      parts.push(wrap(`- ${m.market} [${m.cls}]: ${side}, net ${formatCompact(m.net)}`));
    }
  }

  // ---- One-line takeaway ---------------------------------------------------
  parts.push(heading("TAKEAWAY"));
  if (movers.length > 0) {
    const m = movers[0];
    parts.push(
      wrap(
        `The dominant flow of the week is ${signedCompact(m.wow!)} in ${m.market} ` +
          `(${m.percentile !== null ? ordinal(m.percentile) + " percentile of its history" : "no percentile yet"}); ` +
          `${crowded.length} market${crowded.length === 1 ? "" : "s"} sit at crowded extremes worth fade/squeeze watch.`,
      ),
    );
  } else {
    parts.push(wrap("Insufficient history for a directional read this week."));
  }

  return parts.join("\n");
}

export async function generateCotNote(trigger: "scheduled" | "manual"): Promise<CotNote> {
  const db = getDb();
  const { reportDate, lines } = await buildDigest();
  const content = encodeNote(reportDate, lines);

  const [prev] = await db
    .select({ version: cotNotes.version })
    .from(cotNotes)
    .orderBy(desc(cotNotes.version))
    .limit(1);
  const inserted = await db
    .insert(cotNotes)
    .values({ reportDate, version: (prev?.version ?? 0) + 1, trigger, model: null, content })
    .$returningId();
  const [note] = await db.select().from(cotNotes).where(eq(cotNotes.id, inserted[0].id));
  log.info("cot note encoded", { version: note.version, reportDate, markets: lines.length });
  return note;
}

export async function maybeGenerateScheduledNote(outcome: string): Promise<void> {
  if (outcome !== "new_report" && outcome !== "revision") return;
  try {
    await generateCotNote("scheduled");
  } catch (err) {
    log.warn("scheduled cot note skipped", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export const noteInternals = { encodeNote };
