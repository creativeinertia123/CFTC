import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CATEGORY_LABELS, fmtCompact, fmtNum, fmtPct, fmtSigned } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";

const LOOKBACKS = [2, 4, 8, 16] as const;
const CATEGORY_COLOURS: Record<string, string> = {
  noncommercial: "#f5b942",
  commercial: "#2dd4bf",
  nonreportable: "#8b93a8",
};

export default function MarketDetail() {
  const { code } = useParams<{ code: string }>();
  const key = code ? decodeURIComponent(code) : "";
  const [lookback, setLookback] = useState<number>(16);
  const detail = trpc.cot.marketDetail.useQuery(
    { key, lookback },
    { enabled: key.length > 0, refetchInterval: 60_000 },
  );

  const chartData = useMemo(() => {
    if (!detail.data?.found) return [];
    const byDate = new Map<string, { date: string; [k: string]: number | string }>();
    for (const h of detail.data.history) {
      if (!byDate.has(h.reportDate)) byDate.set(h.reportDate, { date: h.reportDate.slice(5) });
      byDate.get(h.reportDate)![h.traderCategory] = h.net;
    }
    return [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, v]) => v);
  }, [detail.data]);

  if (detail.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-96" />
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  if (!detail.data?.found) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
        <p className="text-lg font-medium">Market not found</p>
        <p className="text-sm text-muted-foreground">
          {detail.data === undefined
            ? "The feature panel is still loading — this page will resolve shortly."
            : `No series exists for “${key}”.`}
        </p>
        <Button asChild variant="outline">
          <Link to="/">Back to overview</Link>
        </Button>
      </div>
    );
  }

  const d = detail.data;
  const snapshot = [...d.snapshot].sort((a, b) => a.traderCategory.localeCompare(b.traderCategory));

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link to="/">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Overview
          </Link>
        </Button>
        <h1 className="text-xl font-semibold leading-tight">{d.marketName}</h1>
        <p className="text-sm text-muted-foreground">
          {d.assetClass} · code {d.marketCode} · report {d.reportDate}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground mr-1">Lookback</span>
        <div className="flex rounded-md border border-border overflow-hidden">
          {LOOKBACKS.map((w) => (
            <button
              key={w}
              onClick={() => setLookback(w)}
              aria-pressed={lookback === w}
              className={cn(
                "px-3.5 py-2 text-sm transition-colors",
                lookback === w ? "bg-amber-500/15 text-amber-400 font-medium" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {w}W
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card/30 p-4">
        <h2 className="mb-3 text-sm font-medium">Net positioning by trader cohort — {lookback}W</h2>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 4% 20%)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(240 5% 65%)" }} tickLine={false} axisLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: "hsl(240 5% 65%)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => fmtCompact(v)}
                width={56}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(240 6% 8%)",
                  border: "1px solid hsl(240 4% 18%)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value: number, name: string) => [fmtSigned(value), CATEGORY_LABELS[name] ?? name]}
              />
              <Legend formatter={(v: string) => CATEGORY_LABELS[v] ?? v} wrapperStyle={{ fontSize: 12 }} />
              {(["noncommercial", "commercial", "nonreportable"] as const).map((cat) => (
                <Line
                  key={cat}
                  type="monotone"
                  dataKey={cat}
                  stroke={CATEGORY_COLOURS[cat]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <div className="rounded-lg border border-border bg-card/30 p-4 min-w-0">
          <h2 className="mb-3 text-sm font-medium">Feature snapshot — {d.reportDate}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Feature</th>
                  {snapshot.map((s) => (
                    <th key={s.traderCategory} className="py-2 pr-3 text-right font-medium">
                      {CATEGORY_LABELS[s.traderCategory]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Net", (s: (typeof snapshot)[number]) => fmtSigned(s.net)],
                    ["WoW change", (s) => fmtSigned(s.wowChange)],
                    ["Percentile", (s) => fmtPct(s.percentile)],
                    ["Z-score", (s) => fmtNum(s.zscore, 2)],
                    ["WMA deviation", (s) => `${fmtNum(s.wmaDev, 1)}%`],
                    ["OI share", (s) => `${fmtNum(s.oiShare, 1)}%`],
                    ["Momentum 2W", (s) => fmtSigned(s.momentum2)],
                    ["Momentum 4W", (s) => fmtSigned(s.momentum4)],
                    ["Momentum 8W", (s) => fmtSigned(s.momentum8)],
                    ["Momentum 16W", (s) => fmtSigned(s.momentum16)],
                    ["Long/short ratio", (s) => fmtNum(s.longShortRatio, 2)],
                    ["Bounded net", (s) => fmtNum(s.boundedNet, 2)],
                    ["Crowding flag", (s) => (s.crowding ? "Yes" : "No")],
                  ] as Array<[string, (s: (typeof snapshot)[number]) => string]>
                ).map(([label, fn]) => (
                  <tr key={label} className="border-b border-border/40 last:border-0">
                    <td className="py-2 pr-3 text-muted-foreground">{label}</td>
                    {snapshot.map((s) => (
                      <td key={s.traderCategory} className="py-2 pr-3 text-right tabular-nums">
                        {fn(s)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card/30 p-4 min-w-0">
          <h2 className="mb-3 text-sm font-medium">Cohort comparison — latest report</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-right text-xs uppercase text-muted-foreground">
                  <th className="py-2 pr-3 text-left font-medium">Cohort</th>
                  <th className="py-2 pr-3 font-medium">Long</th>
                  <th className="py-2 pr-3 font-medium">Short</th>
                  <th className="py-2 pr-3 font-medium">Spread</th>
                  <th className="py-2 pr-3 font-medium">Net</th>
                  <th className="py-2 font-medium">% OI</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.map((s) => (
                  <tr key={s.traderCategory} className="border-b border-border/40 last:border-0">
                    <td className="py-2.5 pr-3 text-left">{CATEGORY_LABELS[s.traderCategory]}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{fmtCompact(s.long)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{fmtCompact(s.short)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">{fmtCompact(s.spreading)}</td>
                    <td className={cn("py-2.5 pr-3 text-right tabular-nums", s.net >= 0 ? "text-teal-400" : "text-rose-400")}>
                      {fmtSigned(s.net)}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-muted-foreground">{fmtNum(s.oiShare, 1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            % OI is the cohort net as a share of total open interest. Smart-money divergence is read
            directly from the non-commercial vs commercial lines above.
          </p>
        </div>
      </div>
    </div>
  );
}
