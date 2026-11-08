export function fmtCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

export function fmtSigned(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n > 0 ? "+" : ""}${fmtCompact(n)}`;
}

export function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n.toFixed(0)}%`;
}

export const CATEGORY_LABELS: Record<string, string> = {
  noncommercial: "Non-commercial",
  commercial: "Commercial",
  nonreportable: "Non-reportable",
};
