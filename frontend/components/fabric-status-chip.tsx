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

  const color = isActive ? "#3fb950" : isPaused ? "#f85149" : isTransitioning ? "#d29922" : "#8b949e";
  const bg = isActive
    ? "rgba(63,185,80,0.14)"
    : isPaused
      ? "rgba(248,81,73,0.14)"
      : isTransitioning
        ? "rgba(210,153,34,0.14)"
        : "rgba(139,148,158,0.14)";

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
          style={{ color: "#3fb950", background: "rgba(63,185,80,0.18)" }}
          title="Resume Fabric capacity"
          aria-label="Resume Fabric capacity"
        >
          <Play className="h-3 w-3 fill-current" strokeWidth={0} />
        </button>
      )}
    </span>
  );
}
