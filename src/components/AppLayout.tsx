import { NavLink, Outlet } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { trpc } from "@/providers/trpc";
import { useCotEvents, type WireStatus } from "@/hooks/useCotEvents";
import { cn } from "@/lib/utils";

function WireDot({ status }: { status: WireStatus }) {
  const colour =
    status === "live" ? "bg-emerald-500" : status === "polling" ? "bg-amber-500" : "bg-muted-foreground/50";
  const label =
    status === "live"
      ? "Live wire connected — views refresh automatically when a run completes"
      : status === "polling"
        ? "Live wire unavailable — refreshing on a 60-second poll instead"
        : "Connecting to the live wire";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title={label}>
      <span className={cn("h-2 w-2 rounded-full", colour, status === "live" && "animate-pulse")} />
      <span className="hidden sm:inline">{status === "live" ? "Live" : status === "polling" ? "Polling" : "Connecting"}</span>
    </span>
  );
}

const NAV = [
  { to: "/", label: "Overview", end: true },
  { to: "/matrix", label: "Matrix" },
  { to: "/updates", label: "Update log" },
  { to: "/note", label: "Note" },
];

export default function AppLayout() {
  const status = useCotEvents();
  const meta = trpc.cot.meta.useQuery(undefined, { refetchInterval: 60_000 });
  return (
    <TooltipProvider>
      <div className="min-h-dvh bg-background text-foreground flex flex-col">
        <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
          <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-4 px-4">
            <NavLink to="/" className="flex items-center gap-2.5 shrink-0" aria-label="CFTC overview">
              <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-amber-500/90 text-[11px] font-bold text-black">
                CT
              </span>
              <span className="text-sm font-semibold tracking-wide">
                CFTC <span className="text-muted-foreground font-normal hidden md:inline">Commitments of Traders</span>
              </span>
            </NavLink>
            <nav className="flex items-center gap-1 overflow-x-auto" aria-label="Primary">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      "rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors hover:text-foreground",
                      isActive ? "bg-secondary text-foreground font-medium" : "text-muted-foreground",
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-3 shrink-0">
              <WireDot status={status} />
              <span className="hidden md:inline rounded border border-border px-2 py-1 text-xs text-muted-foreground tabular-nums">
                {meta.data?.reportDate ? `Report ${meta.data.reportDate}` : meta.data?.seeding ? "Loading panel…" : "No data"}
              </span>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6">
          <Outlet />
        </main>
        <footer className="border-t border-border/70 py-4">
          <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-2 px-4 text-xs text-muted-foreground">
            <span>
              Legacy Combined, futures + options. Source: US Commodity Futures Trading Commission weekly publication.
            </span>
            <span>Point-in-time panel — features recomputed on every run</span>
          </div>
        </footer>
      </div>
      <Toaster theme="dark" position="bottom-right" />
    </TooltipProvider>
  );
}
