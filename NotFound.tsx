import { Link } from "react-router";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-4xl font-semibold text-muted-foreground">404</p>
      <p className="text-sm text-muted-foreground">This page does not exist.</p>
      <Button asChild variant="outline">
        <Link to="/">Back to overview</Link>
      </Button>
    </div>
  );
}
