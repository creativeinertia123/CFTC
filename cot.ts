/**
 * Plain REST surface for the COT workspace:
 *
 *   GET  /api/cot/events                — SSE stream of ingestion events.
 *   POST /api/scheduled/cftc-ingestion  — cron callback (Saturday 00:00 UTC
 *                                         platform heartbeat). Protected by
 *                                         x-cot-ingestion-secret when
 *                                         CFTC_INGESTION_SECRET is set.
 */
import { Hono } from "hono";
import { subscribeCotEvents, type CotEvent } from "../cot/events";
import { runIngestionGuarded } from "../cot/ingest";
import { maybeGenerateScheduledNote } from "../cot/note";

export const cotRoutes = new Hono();

function sseFrame(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

cotRoutes.get("/events", (c) => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(sseFrame("hello", { ok: true, ts: Date.now() }));
      const unsubscribe = subscribeCotEvents((e: CotEvent) => {
        try {
          controller.enqueue(sseFrame(e.type, e));
        } catch {
          unsubscribe();
        }
      });
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(sseFrame("heartbeat", { ts: Date.now() }));
        } catch {
          clearInterval(heartbeat);
        }
      }, 25000);
      // `closed` resolves when the client disconnects; clean up both timers.
      void c.req.raw.signal?.addEventListener?.("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

cotRoutes.post("/scheduled/cftc-ingestion", async (c) => {
  const secret = process.env.CFTC_INGESTION_SECRET;
  if (secret) {
    const sent = c.req.header("x-cot-ingestion-secret");
    if (sent !== secret) {
      return c.json({ error: "unauthorised" }, 401);
    }
  }
  const run = await runIngestionGuarded();
  if (run.status === "success" && (run.outcome === "new_report" || run.outcome === "revision")) {
    void maybeGenerateScheduledNote(run.outcome);
  }
  return c.json(run);
});

// The production cron path documented by the workspace:
//   POST /api/scheduled/cftc-ingestion
// Same handler, mounted at the /api root.
export const scheduledRoutes = new Hono();
scheduledRoutes.post("/cftc-ingestion", async (c) => {
  const secret = process.env.CFTC_INGESTION_SECRET;
  if (secret) {
    const sent = c.req.header("x-cot-ingestion-secret");
    if (sent !== secret) {
      return c.json({ error: "unauthorised" }, 401);
    }
  }
  const run = await runIngestionGuarded();
  if (run.status === "success" && (run.outcome === "new_report" || run.outcome === "revision")) {
    void maybeGenerateScheduledNote(run.outcome);
  }
  return c.json(run);
});
