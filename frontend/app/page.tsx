import { PlannerShell } from "@/components/planner-shell";
import { ErrorBoundary } from "@/components/error-boundary";

export default function HomePage() {
  return (
    <ErrorBoundary>
      <PlannerShell />
    </ErrorBoundary>
  );
}
