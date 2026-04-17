"use client";

import { Play, Zap } from "lucide-react";
import { FabricStatus } from "@/lib/types";

interface FabricStatusChipProps {
  status: FabricStatus | null;
  onResume: () => void;
}

export function FabricStatusChip({ status, onResume }: FabricStatusChipProps) {
  if (!status?.enabled) return null;

  const state = status.state ?? "Unknown";
  const isActive = state === "Active";
  const isPaused = state === "Paused" || state === "Suspended";
  const isTransitioning = ["Resuming", "Provisioning", "Scaling", "Preparing"].includes(state);

  const color = isActive ? "#22c55e" : isPaused ? "#ef4444" : isTransitioning ? "#f59e0b" : "#8a8f98";
  const bg = isActive
    ? "rgba(34,197,94,0.12)"
    : isPaused
      ? "rgba(239,68,68,0.12)"
      : isTransitioning
        ? "rgba(245,158,11,0.12)"
        : "rgba(138,143,152,0.12)";

  const label = isActive ? "Active" : state;
  const title = `Fabric capacity: ${label}${status.name ? ` · ${status.name}` : ""}${status.sku ? ` · ${status.sku}` : ""}`;

  return (
    <span
      className="fabric-chip"
      style={{ background: bg, color, borderColor: "transparent" }}
      title={title}
    >
      <Zap className={`h-3 w-3 ${isTransitioning ? "animate-pulse" : ""}`} strokeWidth={2.5} />
      <span className="fabric-chip-label">Fabric</span>
      <span className="fabric-chip-state" style={{ opacity: 0.85 }}>
        {label}
      </span>
      {isPaused && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onResume();
          }}
          className="fabric-chip-resume"
          style={{ color: "#22c55e", background: "rgba(34,197,94,0.18)" }}
          title="Resume Fabric capacity"
          aria-label="Resume Fabric capacity"
        >
          <Play className="h-3 w-3 fill-current" strokeWidth={0} />
        </button>
      )}
    </span>
  );
}
