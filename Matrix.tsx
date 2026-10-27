import { useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtCompact, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

function cellColour(v: number | null, invert = false): string {
  if (v === null) return "bg-transparent text-muted-foreground";
  const x = invert ? 100 - v : v;
  if (x >= 90) return "bg-rose-500/25 text-rose-200";
  if (x >= 75) return "bg-rose-500/10 text-rose-300/90";
  if (x <= 10) return "bg-teal-500/25 text-teal-200";
  if (x <= 25) return "bg-teal-500/10 text-teal-300/90";
  return "bg-secondary/20 text-muted-foreground";
}

export default function Matrix() {
  const classes = trpc.cot.assetClasses.useQuery();
  const [cls, setCls] = useState<string>("Energy");
  const effectiveCls = classes.data?.some((c) => c.assetClass === cls) ? cls : (classes.data?.[0]?.assetClass ?? "Energy");
  const matrix = trpc.cot.matrix.useQuery({ assetClass: effectiveCls }, { refetchInterval: 60_000 });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(classes.data ?? []).map((c) => (
          <button
            key={c.assetClass}
            onClick={() => setCls(c.assetClass)}
            aria-pressed={effectiveCls === c.assetClass}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs transition-colors",
              effectiveCls === c.assetClass
                ? "border-amber-500/60 bg-amber-500/10 text-amber-400"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {c.assetClass} ({c.count})
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {matrix.data ? `${matrix.data.rows.length} markets · report ${matrix.data.reportDate}` : ""}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        Percentile ranks of positioning versus each market&rsquo;s own expanding history — higher long percentile
        (red) means crowded longs; higher short percentile (teal) means crowded shorts.
      </p>

      {matrix.isLoading ? (
        <Skeleton className="h-[420px] w-full" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">Market</th>
                <th className="px-3 py-2.5 text-right font-medium">OI</th>
                <th className="px-3 py-2.5 text-center font-medium">Long pct</th>
                <th className="px-3 py-2.5 text-center font-medium">Short pct</th>
                <th className="px-3 py-2.5 text-center font-medium">Net pct</th>
                <th className="px-3 py-2.5 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              {(matrix.data?.rows ?? []).map((r) => (
                <tr key={r.marketKey} className="border-b border-border/50 last:border-0 hover:bg-secondary/20 transition-colors">
                  <td className="px-3 py-2">
                    <Link to={`/market/${encodeURIComponent(r.marketKey)}`} className="hover:text-amber-400 transition-colors">
                      {r.marketName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtCompact(r.openInterest)}</td>
                  <td className="p-1">
                    <div className={cn("rounded px-2 py-1.5 text-center text-xs tabular-nums", cellColour(r.percentileLong))}>
                      {fmtPct(r.percentileLong)}
                    </div>
                  </td>
                  <td className="p-1">
                    <div className={cn("rounded px-2 py-1.5 text-center text-xs tabular-nums", cellColour(r.percentileShort, true))}>
                      {fmtPct(r.percentileShort)}
                    </div>
                  </td>
                  <td className="p-1">
                    <div className={cn("rounded px-2 py-1.5 text-center text-xs tabular-nums font-medium", cellColour(r.percentile))}>
                      {fmtPct(r.percentile)}
                    </div>
                  </td>
                  <td className={cn("px-3 py-2 text-right tabular-nums", r.net >= 0 ? "text-teal-400" : "text-rose-400")}>
                    {fmtCompact(r.net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {matrix.data && matrix.data.rows.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">No markets in this class.</div>
          )}
        </div>
      )}
    </div>
  );
}
