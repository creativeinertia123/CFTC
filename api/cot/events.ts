/**
 * In-process event bus bridging the ingestion worker and the SSE stream.
 * When a run completes (any outcome, including a holiday-week no-update)
 * every connected browser is pushed the run record and refreshes its views.
 */

export interface CotRunEvent {
  type: "run";
  id: number;
  runAt: string;
  status: "success" | "error";
  outcome: "initial" | "new_report" | "revision" | "no_update";
  reportDate: string | null;
  rowsParsed: number;
  rowsInserted: number;
  revisions: number;
  durationMs: number;
  error: string | null;
}

export type CotEvent = CotRunEvent;

type Listener = (event: CotEvent) => void;

const listeners = new Set<Listener>();

export function publishCotEvent(event: CotEvent): void {
  for (const l of listeners) {
    try {
      l(event);
    } catch {
      // a broken subscriber must not affect the others
    }
  }
}

export function subscribeCotEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
