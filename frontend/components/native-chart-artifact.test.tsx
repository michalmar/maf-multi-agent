import { describe, expect, it } from "vitest";

import { chartLinkTitle, isNativeChartHref, isNativeChartLink } from "@/lib/native-chart-links";

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
});
