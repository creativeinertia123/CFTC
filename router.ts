import { createRouter, publicQuery } from "./middleware";
import { cotRouter } from "./cot/router";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  cot: cotRouter,
});

export type AppRouter = typeof appRouter;
