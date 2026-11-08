import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export type WireStatus = "connecting" | "live" | "polling";

const OUTCOME_LABELS: Record<string, string> = {
  initial: "Initial load",
  new_report: "New report",
  revision: "Revision",
  no_update: "No update",
};

/**
 * SSE wire-in for ingestion events. While the event stream is connected the
 * views are pushed; if the stream drops, the hook degrades to a 60-second
 * poll of the same data so auto-update keeps working either way.
 */
export function useCotEvents() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<WireStatus>("connecting");
  const seenRef = useRef<number>(0);

  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: [["cot"]] });
    };

    const startPolling = () => {
      setStatus("polling");
      if (!pollTimer) {
        pollTimer = setInterval(invalidate, 60_000);
      }
    };

    const connect = () => {
      es = new EventSource("/api/cot/events");
      es.onopen = () => {
        if (closed) return;
        setStatus("live");
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      };
      es.addEventListener("run", (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data);
          if (typeof data.id === "number" && data.id <= seenRef.current) return;
          seenRef.current = data.id ?? 0;
          invalidate();
          if (data.status === "error") {
            toast.error("Ingestion failed", { description: data.error ?? "Unknown error" });
          } else if (data.outcome === "new_report" || data.outcome === "revision") {
            toast.success(`${OUTCOME_LABELS[data.outcome] ?? data.outcome}: ${data.reportDate ?? ""}`, {
              description: `${data.rowsInserted.toLocaleString()} rows written`,
            });
          }
        } catch {
          // malformed frame: ignore
        }
      });
      es.onerror = () => {
        if (closed) return;
        es?.close();
        es = null;
        startPolling();
        setTimeout(connect, 10_000);
      };
    };

    connect();
    return () => {
      closed = true;
      es?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [queryClient]);

  return status;
}
