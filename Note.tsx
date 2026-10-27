import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { RefreshCw, FileText } from "lucide-react";

export default function Note() {
  const latest = trpc.cot.noteLatest.useQuery();
  const history = trpc.cot.noteHistory.useQuery();
  const utils = trpc.useUtils();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = trpc.cot.noteById.useQuery(
    { id: selectedId ?? 0 },
    { enabled: selectedId !== null },
  );
  const regenerate = trpc.cot.noteRegenerate.useMutation({
    onSuccess: () => {
      setSelectedId(null);
      void utils.cot.noteLatest.invalidate();
      void utils.cot.noteHistory.invalidate();
    },
  });

  const note = selectedId !== null && selected.data ? selected.data : latest.data;
  const aiError =
    regenerate.error &&
    (regenerate.error.message.includes("未注入") || regenerate.error.message.includes("quota") ||
     regenerate.error.message.includes("额度"))
      ? "Model quota unavailable — the site owner needs to top up before notes can be generated."
      : regenerate.error?.message;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">COT trade note</h1>
          <p className="text-sm text-muted-foreground">
            Generated from the latest persisted feature panel, server-side, with point-in-time discipline. A new
            version is written after every new or revised report.
          </p>
        </div>
        <Button
          onClick={() => regenerate.mutate()}
          disabled={regenerate.isPending}
          variant="outline"
          className="ml-auto"
        >
          <RefreshCw className={cn("mr-2 h-4 w-4", regenerate.isPending && "animate-spin")} />
          {regenerate.isPending ? "Regenerating…" : "Regenerate note"}
        </Button>
      </div>

      {history.data && history.data.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {history.data.map((h) => (
            <button
              key={h.id}
              onClick={() => setSelectedId(h.id === selectedId ? null : h.id)}
              aria-pressed={selectedId === h.id}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs transition-colors",
                (selectedId === h.id || (selectedId === null && h.id === latest.data?.id))
                  ? "border-amber-500/60 bg-amber-500/10 text-amber-400"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              v{h.version} · {h.reportDate} · {h.trigger}
            </button>
          ))}
        </div>
      )}

      {regenerate.isError && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          Note generation failed: {aiError} You can retry with the button above.
        </div>
      )}

      {note ? (
        <article className="rounded-lg border border-border bg-card/30 p-5">
          <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-border/60 pb-3 text-xs text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            <span>
              Version {note.version} · report {note.reportDate} · written{" "}
              {note.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC · trigger {note.trigger}
              {note.model ? ` · model ${note.model}` : ""}
            </span>
          </div>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{note.content}</div>
        </article>
      ) : latest.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="flex min-h-[30vh] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-center">
          <p className="text-sm font-medium">No note yet</p>
          <p className="max-w-md text-xs text-muted-foreground">
            A note is generated automatically after the first new or revised report, or on demand with
            &ldquo;Regenerate note&rdquo;.
          </p>
        </div>
      )}
    </div>
  );
}
