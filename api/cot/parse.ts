/**
 * Parsing for the CFTC Legacy Combined annual archives (deacot{year}.zip).
 *
 * The archive contains one CSV text file with quoted fields and latin-1
 * encoding. Only the "(All)" columns are used — the canonical series is
 * futures + options combined, matching the workspace data contract:
 *
 *   date | market_code | market_name | trader_category |
 *   long | short | spreading | net | open_interest
 */
import { fetchBinary } from "./download";
import { extractZipText } from "./unzip";

export interface RawCotRow {
  date: string; // YYYY-MM-DD
  marketCode: string;
  marketName: string;
  openInterest: number;
  noncommLong: number;
  noncommShort: number;
  noncommSpreading: number;
  commLong: number;
  commShort: number;
  nonrepLong: number;
  nonrepShort: number;
}

const COL = {
  name: "Market and Exchange Names",
  date: "As of Date in Form YYYY-MM-DD",
  code: "CFTC Contract Market Code",
  oi: "Open Interest (All)",
  ncLong: "Noncommercial Positions-Long (All)",
  ncShort: "Noncommercial Positions-Short (All)",
  ncSpread: "Noncommercial Positions-Spreading (All)",
  cLong: "Commercial Positions-Long (All)",
  cShort: "Commercial Positions-Short (All)",
  nrLong: "Nonreportable Positions-Long (All)",
  nrShort: "Nonreportable Positions-Short (All)",
} as const;

/** Minimal RFC-4180 parser (quoted fields may contain commas and doubled quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function toNum(v: string): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Download and parse one yearly archive. Returns normalised raw rows plus
 * validation counters. Rows failing validation (bad numbers, non-positive
 * open interest) are skipped and counted.
 */
export async function fetchYearArchive(year: number): Promise<{
  rows: RawCotRow[];
  parsed: number;
  skipped: number;
}> {
  const url = `https://www.cftc.gov/files/dea/history/deacot${year}.zip`;
  const buf = await fetchBinary(url);
  const text = extractZipText(buf, ".txt");

  const grid = parseCsv(text);
  const header = grid[0];
  const idx = Object.fromEntries(
    Object.entries(COL).map(([k, v]) => [k, header.indexOf(v)]),
  ) as Record<keyof typeof COL, number>;
  for (const [k, i] of Object.entries(idx)) {
    if (i < 0) throw new Error(`CFTC archive ${year}: missing expected column "${COL[k as keyof typeof COL]}"`);
  }

  const rows: RawCotRow[] = [];
  let skipped = 0;
  for (let r = 1; r < grid.length; r++) {
    const g = grid[r];
    const get = (i: number) => (g[i] ?? "").trim();
    const oi = toNum(get(idx.oi));
    const ncLong = toNum(get(idx.ncLong));
    const ncShort = toNum(get(idx.ncShort));
    const ncSpread = toNum(get(idx.ncSpread));
    const cLong = toNum(get(idx.cLong));
    const cShort = toNum(get(idx.cShort));
    const nrLong = toNum(get(idx.nrLong));
    const nrShort = toNum(get(idx.nrShort));
    const date = get(idx.date);
    const marketCode = get(idx.code);
    const marketName = get(idx.name);
    if (
      oi === null || oi <= 0 ||
      ncLong === null || ncShort === null || ncSpread === null ||
      cLong === null || cShort === null || nrLong === null || nrShort === null ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) || !marketCode || !marketName
    ) {
      skipped++;
      continue;
    }
    rows.push({
      date,
      marketCode,
      marketName,
      openInterest: Math.round(oi),
      noncommLong: Math.round(ncLong),
      noncommShort: Math.round(ncShort),
      noncommSpreading: Math.round(ncSpread),
      commLong: Math.round(cLong),
      commShort: Math.round(cShort),
      nonrepLong: Math.round(nrLong),
      nonrepShort: Math.round(nrShort),
    });
  }
  return { rows, parsed: rows.length, skipped };
}
