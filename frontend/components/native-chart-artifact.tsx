"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend as ChartLegend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartDataset,
  type ChartOptions,
  type Plugin,
  type ScatterDataPoint,
  type TooltipItem,
} from "chart.js";
import { AlertCircle, Download, Loader2 } from "lucide-react";
import { Bar, Line, Scatter } from "react-chartjs-2";
import { chartLinkTitle, isNativeChartHref, isNativeChartLink } from "@/lib/native-chart-links";
import {
  chartAxisValueToNumber,
  formatChartPrimitive,
  resolveBandFill,
  resolveBandPixelRange,
  type ChartPrimitive,
  type LineXAxisModel,
  type NativeChartBand as Band,
} from "@/lib/native-chart-ranges";

// Chart.js option patterns adapted from michalmar/copilot-billing-preview (MIT, Copyright GitHub, Inc.).
ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler, Tooltip, ChartLegend);

const MAX_CHART_JSON_BYTES = 1_500_000;
const DEFAULT_CHART_HEIGHT = 320;
const DEFAULT_PANEL_HEIGHT = 230;
const PALETTE_FALLBACK = ["#2f81f7", "#f78166", "#3fb950", "#a371f7", "#d29922", "#2dd4bf", "#60a5fa", "#fb7185"];

type ChartType =
  | "bar"
  | "horizontal_bar"
  | "stacked_bar"
  | "line"
  | "timeseries"
  | "multi_timeseries"
  | "scatter"
  | "correlation_matrix";

interface NativeChartSpec {
  version?: number;
  renderer?: string;
  type?: ChartType | string;
  title?: string;
  subtitle?: string;
  description?: string;
  xLabel?: string;
  yLabel?: string;
  y1Label?: string;
  colorLabel?: string;
  height?: number;
  data?: unknown;
  series?: unknown;
  panels?: unknown;
  thresholds?: unknown;
  bands?: unknown;
  variables?: unknown;
  values?: unknown;
  matrix?: unknown;
  [key: string]: unknown;
}

interface ValueItem {
  label: string;
  value: number;
  color?: string;
  tooltip?: string;
}

interface StackSegment {
  label: string;
  value: number;
  color?: string;
}

interface StackItem {
  label: string;
  segments: StackSegment[];
  tooltip?: string;
}

interface SeriesPoint {
  x: ChartPrimitive;
  y: number;
  label: string;
  anomaly?: boolean;
  highlight?: boolean;
  tooltip?: string;
}

interface ChartSeries {
  name: string;
  color?: string;
  yAxisID: "y" | "y1";
  data: SeriesPoint[];
}

interface Threshold {
  value: number;
  label?: string;
  color?: string;
  dashed?: boolean;
}

interface ScatterPoint {
  x: number;
  y: number;
  label: string;
  colorValue?: number;
  color?: string;
  highlight?: boolean;
  anomaly?: boolean;
  tooltip?: string;
}

interface ChartTheme {
  text: string;
  muted: string;
  grid: string;
  border: string;
  panel: string;
  tooltipBg: string;
  tooltipText: string;
  fontFamily: string;
  danger: string;
  dangerSoft: string;
  attention: string;
  attentionSoft: string;
  accentSoft: string;
  palette: string[];
}

const DEFAULT_THEME: ChartTheme = {
  text: "#f0f6fc",
  muted: "#8b949e",
  grid: "rgba(139, 148, 158, 0.24)",
  border: "#30363d",
  panel: "#0d1117",
  tooltipBg: "#161b22",
  tooltipText: "#f0f6fc",
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  danger: "#f85149",
  dangerSoft: "rgba(248, 81, 73, 0.14)",
  attention: "#d29922",
  attentionSoft: "rgba(210, 153, 34, 0.12)",
  accentSoft: "rgba(47, 129, 247, 0.10)",
  palette: PALETTE_FALLBACK,
};

export { chartLinkTitle, isNativeChartHref, isNativeChartLink };

export function NativeChartArtifact({ href, title }: { href: string; title?: string }) {
  const [spec, setSpec] = useState<NativeChartSpec | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setSpec(null);

    fetch(href, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Chart artifact request failed (${response.status})`);
        }
        const length = Number(response.headers.get("content-length") ?? "0");
        if (length > MAX_CHART_JSON_BYTES) {
          throw new Error("Chart artifact is too large to render safely");
        }
        const text = await response.text();
        if (new Blob([text]).size > MAX_CHART_JSON_BYTES) {
          throw new Error("Chart artifact is too large to render safely");
        }
        return JSON.parse(text) as NativeChartSpec;
      })
      .then((nextSpec) => {
        if (nextSpec.renderer && nextSpec.renderer !== "maf-native") {
          throw new Error(`Unsupported chart renderer: ${nextSpec.renderer}`);
        }
        setSpec(nextSpec);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Failed to load chart artifact");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [href]);

  if (loading) {
    return (
      <div className="native-chart-card native-chart-state">
        <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" />
        Loading chart artifact...
      </div>
    );
  }

  if (error || !spec) {
    return (
      <div className="native-chart-card native-chart-state native-chart-error">
        <AlertCircle className="h-4 w-4" />
        <span>{error || "Chart artifact is empty."}</span>
        <a href={href} className="native-chart-download" target="_blank" rel="noopener noreferrer">
          Download JSON
        </a>
      </div>
    );
  }

  return <ChartFrame spec={spec} href={href} fallbackTitle={title} />;
}

function ChartFrame({ spec, href, fallbackTitle }: { spec: NativeChartSpec; href: string; fallbackTitle?: string }) {
  const title = asString(spec.title) || fallbackTitle || "Chart";
  const subtitle = asString(spec.subtitle) || asString(spec.description);
  const type = spec.type;

  return (
    <figure className="native-chart-card">
      <figcaption className="native-chart-header">
        <div>
          <div className="native-chart-title">{title}</div>
          {subtitle ? <div className="native-chart-subtitle">{subtitle}</div> : null}
        </div>
        <a href={href} className="native-chart-download" target="_blank" rel="noopener noreferrer" title="Download chart JSON">
          <Download className="h-3.5 w-3.5" />
          JSON
        </a>
      </figcaption>
      <div className="native-chart-body">{renderChart(type, spec)}</div>
    </figure>
  );
}

function renderChart(type: NativeChartSpec["type"], spec: NativeChartSpec) {
  switch (type) {
    case "bar":
      return <BarChart spec={spec} />;
    case "horizontal_bar":
      return <HorizontalBarChart spec={spec} />;
    case "stacked_bar":
      return <StackedBarChart spec={spec} />;
    case "line":
    case "timeseries":
      return <LineChart spec={spec} />;
    case "multi_timeseries":
      return <MultiTimeseriesChart spec={spec} />;
    case "scatter":
      return <ScatterChart spec={spec} />;
    case "correlation_matrix":
      return <CorrelationMatrixChart spec={spec} />;
    default:
      return (
        <div className="native-chart-state native-chart-error">
          <AlertCircle className="h-4 w-4" />
          Unsupported chart type: {String(type || "missing")}
        </div>
      );
  }
}

function BarChart({ spec }: { spec: NativeChartSpec }) {
  const theme = useChartTheme();
  const items = coerceValueItems(spec.data);
  if (!items.length) return <EmptyChart />;

  const chartData: ChartData<"bar", number[], string> = {
    labels: items.map((item) => item.label),
    datasets: [
      {
        label: asString(spec.yLabel) || "Value",
        data: items.map((item) => item.value),
        backgroundColor: items.map((item, index) => safeCanvasColor(item.color, theme.palette[index % theme.palette.length])),
        borderColor: items.map((item, index) => safeCanvasColor(item.color, theme.palette[index % theme.palette.length])),
        borderWidth: 1,
        borderRadius: 3,
      },
    ],
  };

  return (
    <ChartCanvasShell height={chartHeight(spec)}>
      <Bar
        data={chartData}
        options={buildBarOptions(theme, spec, { stacked: false, indexAxis: "x", legend: false }, items.map((item) => item.tooltip))}
      />
    </ChartCanvasShell>
  );
}

function HorizontalBarChart({ spec }: { spec: NativeChartSpec }) {
  const theme = useChartTheme();
  const items = coerceValueItems(spec.data);
  if (!items.length) return <EmptyChart />;

  const chartData: ChartData<"bar", number[], string> = {
    labels: items.map((item) => item.label),
    datasets: [
      {
        label: asString(spec.xLabel) || "Value",
        data: items.map((item) => item.value),
        backgroundColor: items.map((item, index) => safeCanvasColor(item.color, theme.palette[index % theme.palette.length])),
        borderColor: items.map((item, index) => safeCanvasColor(item.color, theme.palette[index % theme.palette.length])),
        borderWidth: 1,
        borderRadius: 3,
      },
    ],
  };

  return (
    <ChartCanvasShell height={chartHeight(spec)}>
      <Bar
        data={chartData}
        options={buildBarOptions(theme, spec, { stacked: false, indexAxis: "y", legend: false }, items.map((item) => item.tooltip))}
      />
    </ChartCanvasShell>
  );
}

function StackedBarChart({ spec }: { spec: NativeChartSpec }) {
  const theme = useChartTheme();
  const rows = coerceStackItems(spec.data);
  if (!rows.length) return <EmptyChart />;

  const segmentNames = collectSegmentNames(rows);
  const segmentColors = collectSegmentColors(rows, theme);
  const datasets: ChartDataset<"bar", number[]>[] = segmentNames.map((segmentName) => ({
    label: segmentName,
    data: rows.map((row) => row.segments.find((segment) => segment.label === segmentName)?.value ?? 0),
    backgroundColor: segmentColors.get(segmentName) ?? theme.palette[0],
    borderColor: segmentColors.get(segmentName) ?? theme.palette[0],
    borderWidth: 1,
    borderRadius: 2,
  }));
  const chartData: ChartData<"bar", number[], string> = {
    labels: rows.map((row) => row.label),
    datasets,
  };

  return (
    <ChartCanvasShell height={chartHeight(spec)}>
      <Bar data={chartData} options={buildBarOptions(theme, spec, { stacked: true, indexAxis: "x", legend: true })} />
    </ChartCanvasShell>
  );
}

function LineChart({ spec, height, compact = false }: { spec: NativeChartSpec; height?: number; compact?: boolean }) {
  const theme = useChartTheme();
  const series = coerceSeries(spec.series, spec.data);
  const thresholds = coerceThresholds(spec.thresholds);
  const bands = coerceBands(spec.bands);
  const xAxis = collectLineXAxis(series);
  const labels = xAxis.labels;
  const bandPlugin = useMemo(() => makeBandPlugin(bands, xAxis, theme), [bands, xAxis, theme]);

  if (!series.some((entry) => entry.data.length)) return <EmptyChart />;

  const datasets: ChartDataset<"line", ScatterDataPoint[]>[] = [
    ...series.map((entry, index) => lineDataset(entry, xAxis, theme, index)),
    ...thresholds.map((threshold, index) => thresholdDataset(threshold, xAxis, theme, index)),
  ];
  const chartData: ChartData<"line", ScatterDataPoint[], string> = { labels, datasets };

  return (
    <ChartCanvasShell height={height ?? chartHeight(spec)}>
      <Line
        data={chartData}
        options={buildLineOptions(theme, spec, series, xAxis, { compact })}
        plugins={bands.length ? [bandPlugin] : undefined}
      />
    </ChartCanvasShell>
  );
}

function MultiTimeseriesChart({ spec }: { spec: NativeChartSpec }) {
  const panels = Array.isArray(spec.panels) ? spec.panels.filter(isRecord) : [];
  if (!panels.length) return <LineChart spec={spec} />;

  return (
    <div className="native-chart-multipanel">
      {panels.map((panel, index) => {
        const title = asString(panel.title);
        const panelSpec: NativeChartSpec = { ...spec, ...panel, type: "line" };
        return (
          <div key={`${title || "panel"}-${index}`} className="native-chart-panel">
            {title ? <div className="native-chart-panel-title">{title}</div> : null}
            <LineChart spec={panelSpec} height={chartHeight(panelSpec, DEFAULT_PANEL_HEIGHT)} compact />
          </div>
        );
      })}
    </div>
  );
}

function ScatterChart({ spec }: { spec: NativeChartSpec }) {
  const theme = useChartTheme();
  const points = coerceScatterPoints(spec.data);
  if (!points.length) return <EmptyChart />;

  const colorValues = points.map((point) => point.colorValue).filter(isFiniteNumber);
  const colorDomain = colorValues.length ? paddedDomain(colorValues, 0.02) : [0, 1];
  const chartData: ChartData<"scatter", ScatterDataPoint[], string> = {
    datasets: [
      {
        label: asString(spec.colorLabel) || "Points",
        data: points.map((point) => ({ x: point.x, y: point.y })),
        pointBackgroundColor: points.map((point) => scatterPointColor(point, colorDomain, theme)),
        pointBorderColor: points.map((point) => (point.highlight || point.anomaly ? theme.panel : scatterPointColor(point, colorDomain, theme))),
        pointBorderWidth: points.map((point) => (point.highlight || point.anomaly ? 1.5 : 0)),
        pointRadius: points.map((point) => (point.highlight || point.anomaly ? 5.5 : 3.5)),
        pointHoverRadius: 6,
      },
    ],
  };

  return (
    <ChartCanvasShell height={chartHeight(spec)}>
      <Scatter data={chartData} options={buildScatterOptions(theme, spec, points)} />
    </ChartCanvasShell>
  );
}

function CorrelationMatrixChart({ spec }: { spec: NativeChartSpec }) {
  const variables = Array.isArray(spec.variables) ? spec.variables.map(String) : [];
  const matrixCandidate = spec.values ?? spec.matrix;
  const matrix = Array.isArray(matrixCandidate)
    ? matrixCandidate.map((row) => (Array.isArray(row) ? row.map((value) => asNumber(value) ?? 0) : []))
    : [];
  const n = Math.min(variables.length, matrix.length, 12);

  if (!n) return <EmptyChart />;

  const labelSize = 138;
  const cell = 44;
  const width = labelSize + n * cell + 16;
  const height = labelSize + n * cell + 16;

  return (
    <div className="native-chart-matrix-wrap">
      <svg className="native-chart-matrix" viewBox={`0 0 ${width} ${height}`} role="img">
        {variables.slice(0, n).map((label, index) => (
          <g key={`axis-${label}`}>
            <text
              x={labelSize + index * cell + cell / 2}
              y={labelSize - 12}
              textAnchor="start"
              transform={`rotate(-45 ${labelSize + index * cell + cell / 2} ${labelSize - 12})`}
              className="native-chart-axis-text"
            >
              {label}
            </text>
            <text
              x={labelSize - 10}
              y={labelSize + index * cell + cell / 2 + 4}
              textAnchor="end"
              className="native-chart-axis-text"
            >
              {label}
            </text>
          </g>
        ))}
        {matrix.slice(0, n).map((row, rowIndex) =>
          row.slice(0, n).map((value, colIndex) => (
            <g key={`${rowIndex}-${colIndex}`}>
              <rect
                x={labelSize + colIndex * cell}
                y={labelSize + rowIndex * cell}
                width={cell}
                height={cell}
                fill={correlationColor(value)}
                className="native-chart-matrix-cell"
              >
                <title>{`${variables[rowIndex]} vs ${variables[colIndex]}: ${value.toFixed(2)}`}</title>
              </rect>
              <text
                x={labelSize + colIndex * cell + cell / 2}
                y={labelSize + rowIndex * cell + cell / 2 + 4}
                textAnchor="middle"
                className="native-chart-matrix-value"
              >
                {value.toFixed(2)}
              </text>
            </g>
          )),
        )}
      </svg>
      <div className="native-chart-matrix-legend">
        <span>-1</span>
        <span className="native-chart-matrix-gradient" />
        <span>+1</span>
      </div>
    </div>
  );
}

function ChartCanvasShell({ children, height }: { children: ReactNode; height: number }) {
  return (
    <div className="native-chart-canvas-shell" style={{ height }}>
      {children}
    </div>
  );
}

function EmptyChart() {
  return <div className="native-chart-state">No renderable chart data.</div>;
}

function buildBarOptions(
  theme: ChartTheme,
  spec: NativeChartSpec,
  options: { stacked: boolean; indexAxis: "x" | "y"; legend: boolean },
  valueTooltips?: Array<string | undefined>,
): ChartOptions<"bar"> {
  const horizontal = options.indexAxis === "y";
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: options.indexAxis,
    plugins: {
      legend: {
        display: options.legend,
        position: "top" as const,
        labels: legendLabelOptions(theme),
      },
      tooltip: {
        backgroundColor: theme.tooltipBg,
        titleColor: theme.tooltipText,
        bodyColor: theme.tooltipText,
        borderColor: theme.border,
        borderWidth: 1,
        callbacks: {
          label: (context) => {
            const tooltip = valueTooltips?.[context.dataIndex];
            if (tooltip) return tooltip;
            const parsed = context.parsed;
            const value = horizontal ? parsed.x : parsed.y;
            return `${context.dataset.label ?? "Value"}: ${formatMaybeNumber(value)}`;
          },
        },
      },
    },
    scales: {
      x: {
        stacked: options.stacked,
        beginAtZero: horizontal,
        grid: { display: horizontal, color: theme.grid },
        border: { color: theme.border },
        ticks: tickOptions(theme),
        title: axisTitle(theme, horizontal ? asString(spec.xLabel) || asString(spec.yLabel) : asString(spec.xLabel)),
      },
      y: {
        stacked: options.stacked,
        beginAtZero: !horizontal,
        grid: { display: !horizontal, color: theme.grid },
        border: { color: theme.border },
        ticks: tickOptions(theme),
        title: axisTitle(theme, horizontal ? asString(spec.yLabel) : asString(spec.yLabel)),
      },
    },
    interaction: {
      mode: "index" as const,
      intersect: false,
    },
  };
}

function buildLineOptions(
  theme: ChartTheme,
  spec: NativeChartSpec,
  series: ChartSeries[],
  xAxis: LineXAxisModel,
  { compact }: { compact: boolean },
): ChartOptions<"line"> {
  const usesSecondaryAxis = series.some((entry) => entry.yAxisID === "y1");
  const primarySeries = series.find((entry) => entry.yAxisID !== "y1") ?? series[0];
  const secondarySeries = series.find((entry) => entry.yAxisID === "y1");

  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: !compact,
        position: "top" as const,
        labels: legendLabelOptions(theme),
      },
      tooltip: {
        backgroundColor: theme.tooltipBg,
        titleColor: theme.tooltipText,
        bodyColor: theme.tooltipText,
        borderColor: theme.border,
        borderWidth: 1,
        callbacks: {
          title: (items) => {
            const value = items[0]?.parsed.x;
            return isFiniteNumber(value) ? formatLineXAxisValue(value, xAxis) : "";
          },
          label: (context) => lineTooltipLabel(context, series, xAxis),
        },
      },
    },
    scales: {
      x: {
        type: "linear" as const,
        min: lineXAxisMin(xAxis),
        max: lineXAxisMax(xAxis),
        grid: { display: false },
        border: { color: theme.border },
        ticks: {
          color: theme.muted,
          font: {
            family: theme.fontFamily,
            size: 11,
          },
          callback: (value) => (typeof value === "number" ? formatLineXAxisValue(value, xAxis) : value),
          maxRotation: compact ? 0 : 40,
          autoSkip: true,
          maxTicksLimit: compact ? 5 : 8,
        },
        title: axisTitle(theme, compact ? "" : asString(spec.xLabel)),
      },
      y: {
        type: "linear" as const,
        position: "left" as const,
        grid: { color: theme.grid },
        border: { color: theme.border },
        ticks: tickOptions(theme),
        title: axisTitle(theme, asString(spec.yLabel) || primarySeries?.name || "Value", primarySeries?.color),
      },
      y1: {
        display: usesSecondaryAxis,
        type: "linear" as const,
        position: "right" as const,
        grid: { drawOnChartArea: false },
        border: { color: theme.border },
        ticks: tickOptions(theme, secondarySeries?.color),
        title: axisTitle(theme, asString(spec.y1Label) || secondarySeries?.name || "", secondarySeries?.color),
      },
    },
    interaction: {
      mode: "index" as const,
      intersect: false,
    },
  };
}

function buildScatterOptions(theme: ChartTheme, spec: NativeChartSpec, points: ScatterPoint[]): ChartOptions<"scatter"> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: theme.tooltipBg,
        titleColor: theme.tooltipText,
        bodyColor: theme.tooltipText,
        borderColor: theme.border,
        borderWidth: 1,
        callbacks: {
          title: (items) => {
            const point = items[0] ? points[items[0].dataIndex] : undefined;
            return point?.label ?? "";
          },
          label: (context) => {
            const point = points[context.dataIndex];
            if (point?.tooltip) return point.tooltip;
            return `x=${formatMaybeNumber(context.parsed.x)}, y=${formatMaybeNumber(context.parsed.y)}`;
          },
        },
      },
    },
    scales: {
      x: {
        type: "linear" as const,
        grid: { color: theme.grid },
        border: { color: theme.border },
        ticks: tickOptions(theme),
        title: axisTitle(theme, asString(spec.xLabel) || "X"),
      },
      y: {
        type: "linear" as const,
        grid: { color: theme.grid },
        border: { color: theme.border },
        ticks: tickOptions(theme),
        title: axisTitle(theme, asString(spec.yLabel) || "Y"),
      },
    },
    interaction: {
      mode: "nearest" as const,
      intersect: true,
    },
  };
}

function legendLabelOptions(theme: ChartTheme) {
  return {
    usePointStyle: true,
    color: theme.text,
    padding: 12,
    font: {
      family: theme.fontFamily,
      size: 11,
      weight: 500,
    },
  };
}

function tickOptions(theme: ChartTheme, color?: string) {
  return {
    color: safeCanvasColor(color, theme.muted),
    font: {
      family: theme.fontFamily,
      size: 11,
    },
    callback: (value: string | number) => (typeof value === "number" ? formatNumber(value) : value),
  };
}

function axisTitle(theme: ChartTheme, text?: string, color?: string) {
  return {
    display: Boolean(text),
    text,
    color: safeCanvasColor(color, theme.muted),
    font: {
      family: theme.fontFamily,
      size: 11,
      weight: 500,
    },
  };
}

function lineDataset(entry: ChartSeries, xAxis: LineXAxisModel, theme: ChartTheme, index: number): ChartDataset<"line", ScatterDataPoint[]> {
  const color = safeCanvasColor(entry.color, theme.palette[index % theme.palette.length]);
  const points = entry.data
    .map((point) => ({ point, x: lineXAxisValueToNumber(point.x, xAxis) }))
    .filter((item): item is { point: SeriesPoint; x: number } => isFiniteNumber(item.x))
    .sort((a, b) => a.x - b.x);

  return {
    label: entry.name,
    data: points.map(({ point, x }) => ({ x, y: point.y })),
    borderColor: color,
    backgroundColor: withAlpha(color, 0.16),
    pointBackgroundColor: points.map(({ point }) => {
      return point?.anomaly || point?.highlight ? theme.danger : color;
    }),
    pointBorderColor: points.map(({ point }) => {
      return point?.anomaly || point?.highlight ? theme.panel : color;
    }),
    pointRadius: points.map(({ point }) => {
      return point?.anomaly || point?.highlight ? 4.5 : 2.2;
    }),
    pointHoverRadius: 5,
    borderWidth: 2,
    tension: 0.28,
    spanGaps: true,
    fill: false,
    yAxisID: entry.yAxisID,
  };
}

function thresholdDataset(
  threshold: Threshold,
  xAxis: LineXAxisModel,
  theme: ChartTheme,
  index: number,
): ChartDataset<"line", ScatterDataPoint[]> {
  const color = safeCanvasColor(threshold.color, index === 0 ? theme.danger : theme.palette[(index + 4) % theme.palette.length]);
  const min = lineXAxisMin(xAxis);
  const max = lineXAxisMax(xAxis);
  return {
    label: threshold.label || `Threshold ${index + 1}`,
    data: isFiniteNumber(min) && isFiniteNumber(max) ? [{ x: min, y: threshold.value }, { x: max, y: threshold.value }] : [],
    borderColor: color,
    backgroundColor: color,
    pointRadius: 0,
    pointHoverRadius: 0,
    borderWidth: 1.5,
    borderDash: threshold.dashed === false ? undefined : [6, 5],
    tension: 0,
    fill: false,
  };
}

function makeBandPlugin(bands: Band[], xAxis: LineXAxisModel, theme: ChartTheme): Plugin<"line"> {
  return {
    id: "native-chart-bands",
    beforeDatasetsDraw(chart) {
      if (!bands.length || !xAxis.labels.length) return;
      const { top, bottom, left: areaLeft, right: areaRight } = chart.chartArea;

      chart.ctx.save();
      for (const band of bands) {
        const range = resolveBandPixelRange(band, xAxis, areaLeft, areaRight);
        if (!range) continue;
        const [left, right] = range;

        chart.ctx.fillStyle = resolveBandFill(band, theme);
        chart.ctx.fillRect(left, top, right - left, bottom - top);
      }
      chart.ctx.restore();
    },
  };
}

function lineTooltipLabel(context: TooltipItem<"line">, series: ChartSeries[], xAxis: LineXAxisModel): string {
  const entry = series[context.datasetIndex];
  const parsedX = context.parsed.x;
  const point = isFiniteNumber(parsedX)
    ? entry?.data.find((candidate) => Math.abs(lineXAxisValueToNumber(candidate.x, xAxis) - parsedX) < 0.5)
    : undefined;
  if (point?.tooltip) return point.tooltip;
  const value = context.parsed.y;
  return `${context.dataset.label ?? "Value"}: ${formatMaybeNumber(value)}`;
}

function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState(DEFAULT_THEME);

  useEffect(() => {
    const updateTheme = () => setTheme(readChartTheme());
    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

function readChartTheme(): ChartTheme {
  const styles = getComputedStyle(document.documentElement);
  const css = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  const accent = css("--accent", DEFAULT_THEME.palette[0]);
  const accentWarm = css("--accent-warm", DEFAULT_THEME.palette[1]);
  const success = css("--success", DEFAULT_THEME.palette[2]);
  const accentAlt = css("--accent-alt", DEFAULT_THEME.palette[3]);
  const attention = css("--attention", DEFAULT_THEME.palette[4]);

  return {
    text: css("--text-primary", DEFAULT_THEME.text),
    muted: css("--text-muted", DEFAULT_THEME.muted),
    grid: colorMix(css("--border-soft", DEFAULT_THEME.border), 0.58),
    border: css("--border-soft", DEFAULT_THEME.border),
    panel: css("--bg-panel", DEFAULT_THEME.panel),
    tooltipBg: css("--surface-overlay", DEFAULT_THEME.tooltipBg),
    tooltipText: css("--text-primary", DEFAULT_THEME.tooltipText),
    fontFamily: css("--font-body", DEFAULT_THEME.fontFamily),
    danger: css("--danger", DEFAULT_THEME.danger),
    dangerSoft: colorMix(css("--danger", DEFAULT_THEME.danger), 0.16),
    attention,
    attentionSoft: colorMix(attention, 0.14),
    accentSoft: colorMix(accent, 0.10),
    palette: [accent, accentWarm, success, accentAlt, attention, "#2dd4bf", "#60a5fa", "#fb7185"],
  };
}

function coerceValueItems(candidate: unknown): ValueItem[] {
  if (!Array.isArray(candidate)) return [];
  return candidate.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const value = asNumber(item.value ?? item.y ?? item.count);
    if (!isFiniteNumber(value)) return [];
    return [
      {
        label: asString(item.label ?? item.x ?? item.name) || `Item ${index + 1}`,
        value,
        color: asString(item.color),
        tooltip: asString(item.tooltip),
      },
    ];
  });
}

function coerceStackItems(candidate: unknown): StackItem[] {
  if (!Array.isArray(candidate)) return [];
  return candidate.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const rawSegments = item.segments;
    if (!Array.isArray(rawSegments)) return [];
    const segments = rawSegments.flatMap((segment, segmentIndex) => {
      if (!isRecord(segment)) return [];
      const value = asNumber(segment.value);
      if (!isFiniteNumber(value)) return [];
      return [
        {
          label: asString(segment.label ?? segment.name) || `Segment ${segmentIndex + 1}`,
          value,
          color: asString(segment.color),
        },
      ];
    });
    if (!segments.length) return [];
    return [
      {
        label: asString(item.label ?? item.name) || `Item ${index + 1}`,
        segments,
        tooltip: asString(item.tooltip),
      },
    ];
  });
}

function coerceSeries(seriesCandidate: unknown, dataCandidate: unknown): ChartSeries[] {
  if (Array.isArray(seriesCandidate)) {
    return seriesCandidate.flatMap((entry, index) => {
      if (!isRecord(entry)) return [];
      const data = coerceSeriesPoints(entry.data);
      if (!data.length) return [];
      return [
        {
          name: asString(entry.name ?? entry.label) || `Series ${index + 1}`,
          color: asString(entry.color),
          yAxisID: coerceYAxisID(entry.yAxisID ?? entry.yAxis ?? entry.axis),
          data,
        },
      ];
    });
  }

  const points = coerceSeriesPoints(dataCandidate);
  if (!points.length) return [];
  return [{ name: "Value", yAxisID: "y", data: points }];
}

function coerceSeriesPoints(candidate: unknown): SeriesPoint[] {
  if (!Array.isArray(candidate)) return [];
  return candidate.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const y = asNumber(item.y ?? item.value);
    if (!isFiniteNumber(y)) return [];
    const xCandidate = item.x ?? item.timestamp ?? item.label ?? index;
    const x = isChartPrimitive(xCandidate) ? xCandidate : index;
    const label = asString(item.label) || formatPrimitive(x);
    return [
      {
        x,
        y,
        label,
        anomaly: item.anomaly === true,
        highlight: item.highlight === true,
        tooltip: asString(item.tooltip),
      },
    ];
  });
}

function coerceThresholds(candidate: unknown): Threshold[] {
  if (!Array.isArray(candidate)) return [];
  return candidate.flatMap((item) => {
    if (!isRecord(item)) return [];
    const value = asNumber(item.value);
    if (!isFiniteNumber(value)) return [];
    return [
      {
        value,
        label: asString(item.label),
        color: asString(item.color),
        dashed: item.dashed === false ? false : true,
      },
    ];
  });
}

function coerceBands(candidate: unknown): Band[] {
  if (!Array.isArray(candidate)) return [];
  return candidate.flatMap((item) => {
    if (!isRecord(item)) return [];
    const start = item.xStart ?? item.start ?? item.from;
    const end = item.xEnd ?? item.end ?? item.to;
    if (!isChartPrimitive(start) || !isChartPrimitive(end)) return [];
    return [
      {
        xStart: start,
        xEnd: end,
        label: asString(item.label),
        color: asString(item.color),
        kind: asString(item.kind ?? item.type ?? item.category),
        severity: asString(item.severity),
      },
    ];
  });
}

function coerceScatterPoints(candidate: unknown): ScatterPoint[] {
  if (!Array.isArray(candidate)) return [];
  return candidate.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const x = asNumber(item.x);
    const y = asNumber(item.y);
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return [];
    return [
      {
        x,
        y,
        label: asString(item.label ?? item.name) || `Point ${index + 1}`,
        colorValue: asNumber(item.colorValue ?? item.color_value ?? item.z),
        color: asString(item.color),
        highlight: item.highlight === true,
        anomaly: item.anomaly === true,
        tooltip: asString(item.tooltip),
      },
    ];
  });
}

function collectSegmentNames(rows: StackItem[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const segment of row.segments) {
      seen.add(segment.label);
    }
  }
  return Array.from(seen);
}

function collectSegmentColors(rows: StackItem[], theme: ChartTheme): Map<string, string> {
  const colors = new Map<string, string>();
  for (const row of rows) {
    for (const segment of row.segments) {
      if (!colors.has(segment.label)) {
        colors.set(segment.label, safeCanvasColor(segment.color, theme.palette[colors.size % theme.palette.length]));
      }
    }
  }
  return colors;
}

function collectLineXAxis(series: ChartSeries[]): LineXAxisModel {
  const valuesByLabel = new Map<string, ChartPrimitive>();
  for (const entry of series) {
    for (const point of entry.data) {
      const label = formatPrimitive(point.x);
      if (!valuesByLabel.has(label)) {
        valuesByLabel.set(label, point.x);
      }
    }
  }

  const values = Array.from(valuesByLabel.values());
  const numeric = values.map((value) => (typeof value === "number" ? value : Number(value)));
  if (numeric.every(isFiniteNumber)) {
    const sortedValues = [...values].sort((a, b) => Number(a) - Number(b));
    return {
      labels: sortedValues.map(formatPrimitive),
      values: sortedValues,
      mode: "numeric",
    };
  }

  const timestamps = values.map((value) => (typeof value === "string" ? Date.parse(value) : Number.NaN));
  if (timestamps.every(isFiniteNumber)) {
    const sortedValues = [...values].sort((a, b) => Date.parse(String(a)) - Date.parse(String(b)));
    return {
      labels: sortedValues.map(formatPrimitive),
      values: sortedValues,
      mode: "time",
    };
  }

  return {
    labels: Array.from(valuesByLabel.keys()),
    values: Array.from(valuesByLabel.values()),
    mode: "ordinal",
  };
}

function lineXAxisValueToNumber(value: ChartPrimitive, xAxis: LineXAxisModel): number {
  if (xAxis.mode === "ordinal") {
    return xAxis.labels.findIndex((label) => label === formatPrimitive(value));
  }
  return chartAxisValueToNumber(value, xAxis.mode);
}

function lineXAxisNumbers(xAxis: LineXAxisModel): number[] {
  return xAxis.values.map((value) => lineXAxisValueToNumber(value, xAxis)).filter(isFiniteNumber);
}

function lineXAxisMin(xAxis: LineXAxisModel): number | undefined {
  const values = lineXAxisNumbers(xAxis);
  return values.length ? Math.min(...values) : undefined;
}

function lineXAxisMax(xAxis: LineXAxisModel): number | undefined {
  const values = lineXAxisNumbers(xAxis);
  return values.length ? Math.max(...values) : undefined;
}

function formatLineXAxisValue(value: number, xAxis: LineXAxisModel): string {
  if (xAxis.mode === "time") {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-GB", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  if (xAxis.mode === "ordinal") {
    return xAxis.labels[Math.round(value)] ?? "";
  }

  return formatNumber(value);
}

function coerceYAxisID(value: unknown): "y" | "y1" {
  const axis = asString(value).toLowerCase();
  return axis === "y1" || axis === "right" || axis === "secondary" ? "y1" : "y";
}

function chartHeight(spec: NativeChartSpec, fallback = DEFAULT_CHART_HEIGHT): number {
  const value = asNumber(spec.height);
  if (!isFiniteNumber(value)) return fallback;
  return Math.max(180, Math.min(720, value));
}

function scatterPointColor(point: ScatterPoint, colorDomain: number[], theme: ChartTheme): string {
  if (point.highlight || point.anomaly) return theme.danger;
  if (point.color) return safeCanvasColor(point.color, theme.palette[0]);
  if (isFiniteNumber(point.colorValue)) {
    return gradientColor(scale(point.colorValue, colorDomain[0], colorDomain[1], 0, 1));
  }
  return theme.palette[0];
}

function paddedDomain(values: number[], ratio = 0.08): [number, number] {
  const finite = values.filter(isFiniteNumber);
  if (!finite.length) return [0, 1];
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (min === max) {
    const pad = Math.max(Math.abs(min) * ratio, 1);
    return [min - pad, max + pad];
  }
  const pad = (max - min) * ratio;
  return [min - pad, max + pad];
}

function scale(value: number, domainMin: number, domainMax: number, rangeMin: number, rangeMax: number): number {
  if (domainMax === domainMin) return (rangeMin + rangeMax) / 2;
  const ratio = (value - domainMin) / (domainMax - domainMin);
  return rangeMin + ratio * (rangeMax - rangeMin);
}

function gradientColor(value: number): string {
  const t = Math.max(0, Math.min(1, value));
  if (t < 0.5) {
    const local = t / 0.5;
    return interpolateRgb([47, 129, 247], [45, 190, 170], local);
  }
  return interpolateRgb([45, 190, 170], [248, 81, 73], (t - 0.5) / 0.5);
}

function correlationColor(value: number): string {
  const v = Math.max(-1, Math.min(1, value));
  if (v < 0) return interpolateRgb([47, 129, 247], [246, 248, 250], v + 1);
  return interpolateRgb([246, 248, 250], [248, 81, 73], v);
}

function interpolateRgb(a: [number, number, number], b: [number, number, number], t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const values = a.map((start, index) => Math.round(start + (b[index] - start) * clamped));
  return `rgb(${values[0]}, ${values[1]}, ${values[2]})`;
}

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("#") && (color.length === 7 || color.length === 4)) {
    const normalized = color.length === 4
      ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
      : color;
    const opacity = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, "0");
    return `${normalized}${opacity}`;
  }
  return color;
}

function colorMix(color: string, alpha: number): string {
  if (color.startsWith("#") && color.length === 7) {
    const r = Number.parseInt(color.slice(1, 3), 16);
    const g = Number.parseInt(color.slice(3, 5), 16);
    const b = Number.parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
  }
  return color;
}

function safeCanvasColor(value: string | undefined, fallback: string): string {
  if (!value || value.trim().startsWith("var(")) return fallback;
  return value;
}

function formatNumber(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${sign}${(abs / 1_000).toFixed(0)}K`;
  if (abs >= 1000) return `${sign}${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (abs >= 100) return `${sign}${abs.toFixed(0)}`;
  if (abs >= 10) return `${sign}${abs.toFixed(1)}`;
  return `${sign}${abs.toFixed(2).replace(/\.?0+$/, "")}`;
}

function formatMaybeNumber(value: number | null | undefined): string {
  return isFiniteNumber(value) ? formatNumber(value) : "n/a";
}

function formatPrimitive(value: ChartPrimitive): string {
  return formatChartPrimitive(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isChartPrimitive(value: unknown): value is ChartPrimitive {
  return typeof value === "string" || typeof value === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
