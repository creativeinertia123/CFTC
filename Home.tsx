import { useMemo, useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { Sparkline } from "@/components/Sparkline";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtCompact, fmtPct, fmtSigned, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";

function pctColour(v: number | null): string {
  if (v === null) return "text-muted-foreground";
  if (v >= 90) return "text-rose-400 font-medium";
  if (v >= 70) return "text-amber-400";
  if (v <= 10) return "text-teal-400 font-medium";
  if (v <= 30) return "text-teal-400/80";
  return "text-foreground";
}

export default function Home() {
  const overview = trpc.cot.overview.useQuery(undefined, { refetchInterval: 60_000 });
  const classes = trpc.cot.assetClasses.useQuery();
  const [search, setSearch] = useState("");
  const [cls, setCls] = useState<string | null>(null);

  const rows = useMemo(() => {
    const all = overview.data?.rows ?? [];
    const q = search.trim().toLowerCase();
    return all.filter((r) => {
      if (cls && r.assetClass !== cls) return false;
      if (q && !r.marketName.toLowerCase().includes(q) && !r.marketCode.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [overview.data, search, cls]);

  if (overview.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-[420px] w-full" />
      </div>
    );
  }

  if (overview.data && overview.data.rows.length === 0) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <p className="text-lg font-medium">Building the feature panel</p>
        <p className="max-w-md text-sm text-muted-foreground">
          The first run downloads the CFTC Legacy Combined archives and computes the full feature panel. This page
          refreshes automatically once the run completes.
        </p>
        <Skeleton className="h-2 w-64" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${overview.data?.rows.length ?? ""} markets…`}
            className="w-64 pl-8"
            aria-label="Search markets"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setCls(null)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs transition-colors",
              cls === null
                ? "border-amber-500/60 bg-amber-500/10 text-amber-400"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            All ({overview.data?.rows.length ?? 0})
          </button>
          {(classes.data ?? []).map((c) => (
            <button
              key={c.assetClass}
              onClick={() => setCls(c.assetClass === cls ? null : c.assetClass)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs transition-colors",
                cls === c.assetClass
                  ? "border-amber-500/60 bg-amber-500/10 text-amber-400"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {c.assetClass} ({c.count})
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {rows.length} of {overview.data?.rows.length ?? 0} markets · report {overview.data?.reportDate}
        </span>
      </div>

      {/* Desktop table */}
      <div className="hidden lg:block overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2.5 font-medium">Market</th>
              <th className="px-3 py-2.5 text-right font-medium">Open interest</th>
              <th className="px-3 py-2.5 text-right font-medium">Long</th>
              <th className="px-3 py-2.5 text-right font-medium">Short</th>
              <th className="px-3 py-2.5 text-right font-medium">Net</th>
              <th className="px-3 py-2.5 text-right font-medium">WoW</th>
              <th className="px-3 py-2.5 text-right font-medium" title="Percentile rank of net positioning vs expanding history">Pct</th>
              <th className="px-3 py-2.5 text-right font-medium" title="Z-score of net positioning">Z</th>
              <th className="px-3 py-2.5 text-right font-medium" title="Deviation from 26-week linearly weighted moving average">WMA dev</th>
              <th className="px-3 py-2.5 text-right font-medium">L/S</th>
              <th className="px-3 py-2.5 text-right font-medium">16W trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.marketKey}
                className="border-b border-border/50 last:border-0 transition-colors hover:bg-secondary/30"
              >
                <td className="px-3 py-2">
                  <Link to={`/market/${encodeURIComponent(r.marketKey)}`} className="block group">
                    <div className="group-hover:text-amber-400 transition-colors leading-tight">{r.marketName}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.assetClass} · {r.marketCode}
                      {r.crowding && <span className="ml-1.5 text-rose-400">crowded</span>}
                    </div>
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtCompact(r.openInterest)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtCompact(r.long)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtCompact(r.short)}</td>
                <td className={cn("px-3 py-2 text-right tabular-nums", r.net >= 0 ? "text-teal-400" : "text-rose-400")}>
                  {fmtSigned(r.net)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtSigned(r.wowChange)}</td>
                <td className={cn("px-3 py-2 text-right tabular-nums", pctColour(r.percentile))}>
                  {fmtPct(r.percentile)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtNum(r.zscore, 2)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtNum(r.wmaDev, 1)}%</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtNum(r.longShortRatio, 2)}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end">
                    <Sparkline values={r.spark} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">No markets match the current filter.</div>
        )}
      </div>

      {/* Mobile cards */}
      <div className="lg:hidden space-y-2">
        {rows.map((r) => (
          <Link
            key={r.marketKey}
            to={`/market/${encodeURIComponent(r.marketKey)}`}
            className="block rounded-lg border border-border bg-card/40 px-3 py-3 transition-colors hover:bg-secondary/30"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{r.marketName}</div>
                <div className="text-xs text-muted-foreground">
                  {r.assetClass} · OI {fmtCompact(r.openInterest)}
                  {r.crowding && <span className="ml-1.5 text-rose-400">crowded</span>}
                </div>
              </div>
              <Sparkline values={r.spark} width={64} height={20} />
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2 text-center">
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">Net</div>
                <div className={cn("text-sm tabular-nums", r.net >= 0 ? "text-teal-400" : "text-rose-400")}>{fmtSigned(r.net)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">WoW</div>
                <div className="text-sm tabular-nums text-muted-foreground">{fmtSigned(r.wowChange)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">Pct</div>
                <div className={cn("text-sm tabular-nums", pctColour(r.percentile))}>{fmtPct(r.percentile)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">Z</div>
                <div className="text-sm tabular-nums text-muted-foreground">{fmtNum(r.zscore, 1)}</div>
              </div>
            </div>
          </Link>
        ))}
        {rows.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">No markets match the current filter.</div>
        )}
      </div>
    </div>
  );
}
