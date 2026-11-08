import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { fmtCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RefreshCw } from "lucide-react";

const OUTCOME_STYLES: Record<string, { label: string; className: string }> = {
  initial: { label: "Initial load", className: "bg-teal-500/15 text-teal-400 border-teal-500/30" },
  new_report: { label: "New report", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  revision: { label: "Revision", className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  no_update: { label: "No update", className: "bg-secondary/40 text-muted-foreground border-border" },
};

export default function Updates() {
  const history = trpc.cot.refreshHistory.useQuery(undefined, { refetchInterval: 30_000 });
  const utils = trpc.useUtils();
  const runCheck = trpc.cot.runCheck.useMutation({
    onSuccess: () => {
      void utils.cot.invalidate();
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">Update log</h1>
          <p className="text-sm text-muted-foreground">
            Refresh outcomes from the ingestion worker, including holiday-week no-update events. A scheduled run
            checks the CFTC publication every Saturday 00:00 UTC; this page updates live when a run completes.
          </p>
        </div>
        <Button
          onClick={() => runCheck.mutate()}
          disabled={runCheck.isPending}
          className="ml-auto bg-amber-500/90 text-black hover:bg-amber-400"
        >
          <RefreshCw className={cn("mr-2 h-4 w-4", runCheck.isPending && "animate-spin")} />
          {runCheck.isPending ? "Running…" : "Run check now"}
        </Button>
      </div>

      {runCheck.data && (
        <div
          className={cn(
            "rounded-lg border px-4 py-3 text-sm",
            runCheck.data.status === "error"
              ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
          )}
        >
          Last run: {OUTCOME_STYLES[runCheck.data.outcome]?.label ?? runCheck.data.outcome} · report{" "}
          {runCheck.data.reportDate ?? "—"} · {runCheck.data.rowsInserted.toLocaleString()} rows written in{" "}
          {(runCheck.data.durationMs / 1000).toFixed(1)}s
          {runCheck.data.error ? ` · ${runCheck.data.error}` : ""}
        </div>
      )}

      {history.isLoading ? (
        <Skeleton className="h-[320px] w-full" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">Run at (UTC)</th>
                <th className="px-3 py-2.5 font-medium">Outcome</th>
                <th className="px-3 py-2.5 font-medium">Report date</th>
                <th className="px-3 py-2.5 text-right font-medium">Rows parsed</th>
                <th className="px-3 py-2.5 text-right font-medium">Rows written</th>
                <th className="px-3 py-2.5 text-right font-medium">Revisions</th>
                <th className="px-3 py-2.5 text-right font-medium">Duration</th>
                <th className="px-3 py-2.5 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {(history.data ?? []).map((r) => (
                <tr key={r.id} className="border-b border-border/50 last:border-0 hover:bg-secondary/20 transition-colors">
                  <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                    {r.runAt.toISOString().replace("T", " ").slice(0, 19)}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge variant="outline" className={cn("border", OUTCOME_STYLES[r.outcome]?.className)}>
                      {OUTCOME_STYLES[r.outcome]?.label ?? r.outcome}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">{r.reportDate ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtCompact(r.rowsParsed)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtCompact(r.rowsInserted)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{r.revisions}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                    {(r.durationMs / 1000).toFixed(1)}s
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {r.status === "error" ? <span className="text-rose-400">{r.error}</span> : "ok"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(history.data ?? []).length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No runs yet — trigger the first check above.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
