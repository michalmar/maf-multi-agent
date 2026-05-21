import { describe, expect, it } from "vitest";

import { chartLinkTitle, isNativeChartHref, isNativeChartLink } from "@/lib/native-chart-links";
import { resolveBandFill, resolveBandPixelRange, type LineXAxisModel } from "@/lib/native-chart-ranges";

describe("native chart artifact helpers", () => {
  it("detects chart links by label and artifact extension", () => {
    expect(isNativeChartLink("chart:Vibration trend", "/api/files/chart.json")).toBe(true);
    expect(isNativeChartLink("Vibration trend", "/api/files/abc-vibration.mafchart.json")).toBe(true);
    expect(isNativeChartHref("/api/files/abc-vibration.nativechart.json")).toBe(true);
    expect(isNativeChartLink("normal link", "/api/files/report.csv")).toBe(false);
  });

  it("strips the chart marker from the display title", () => {
    expect(chartLinkTitle("chart: Major abnormal interval")).toBe("Major abnormal interval");
    expect(chartLinkTitle("Plain title")).toBe("Plain title");
  });

  it("positions numeric anomaly windows by x-value instead of visible tick index", () => {
    const xAxis: LineXAxisModel = {
      mode: "numeric",
      labels: Array.from({ length: 100 }, (_, index) => String(index)),
      values: Array.from({ length: 100 }, (_, index) => index),
    };

    const range = resolveBandPixelRange({ xStart: 48, xEnd: 56 }, xAxis, 100, 1100);

    expect(range?.[0]).toBeCloseTo(100 + (48 / 99) * 1000);
    expect(range?.[1]).toBeCloseTo(100 + (56 / 99) * 1000);
  });

  it("positions timestamp anomaly windows by timestamp range", () => {
    const values = [
      "2026-04-15T00:00:00Z",
      "2026-04-15T06:00:00Z",
      "2026-04-15T12:00:00Z",
      "2026-04-15T18:00:00Z",
    ];
    const xAxis: LineXAxisModel = {
      mode: "time",
      labels: values,
      values,
    };

    const range = resolveBandPixelRange(
      { xStart: "2026-04-15T06:00:00Z", xEnd: "2026-04-15T12:00:00Z" },
      xAxis,
      0,
      300,
    );

    expect(range).toEqual([100, 200]);
  });

  it("styles after-effect bands differently from default anomaly bands", () => {
    const theme = {
      text: "#fff",
      muted: "#aaa",
      grid: "#333",
      border: "#444",
      panel: "#000",
      tooltipBg: "#111",
      tooltipText: "#fff",
      fontFamily: "Inter",
      danger: "#f85149",
      dangerSoft: "rgba(248, 81, 73, 0.16)",
      attention: "#d29922",
      attentionSoft: "rgba(210, 153, 34, 0.14)",
      accentSoft: "rgba(47, 129, 247, 0.10)",
      palette: [],
    };

    expect(resolveBandFill({ xStart: 0, xEnd: 1, label: "Physical upset" }, theme)).toBe(theme.dangerSoft);
    expect(resolveBandFill({ xStart: 1, xEnd: 2, label: "Delta after-effect" }, theme)).toBe(theme.attentionSoft);
  });
});
