"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, Download, Loader2 } from "lucide-react";
import { chartLinkTitle, isNativeChartHref, isNativeChartLink } from "@/lib/native-chart-links";

const MAX_CHART_JSON_BYTES = 1_500_000;
const SVG_WIDTH = 840;
const SVG_HEIGHT = 280;
const PADDING = { top: 24, right: 28, bottom: 52, left: 64 };
const PALETTE = [
  "var(--accent)",
  "var(--accent-warm)",
  "var(--success)",
  "var(--accent-alt)",
  "var(--attention)",
  "#2dd4bf",
  "#60a5fa",
  "#fb7185",
];

type ChartPrimitive = string | number;
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
  colorLabel?: string;
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
  data: SeriesPoint[];
}

interface Threshold {
  value: number;
  label?: string;
  color?: string;
  dashed?: boolean;
}

interface Band {
  xStart: ChartPrimitive;
  xEnd: ChartPrimitive;
  label?: string;
  color?: string;
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

interface XScaleModel {
  mode: "time" | "linear" | "ordinal";
  min: number;
  max: number;
  categories: string[];
  toNumber: (value: ChartPrimitive) => number;
  format: (value: number) => string;
}

interface TooltipState {
  label: string;
  value?: string;
}

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
      <div className="native-chart-body">
        {type === "bar" ? <BarChart spec={spec} /> : null}
        {type === "horizontal_bar" ? <HorizontalBarChart spec={spec} /> : null}
        {type === "stacked_bar" ? <StackedBarChart spec={spec} /> : null}
        {type === "line" || type === "timeseries" ? <LineChart spec={spec} /> : null}
        {type === "multi_timeseries" ? <MultiTimeseriesChart spec={spec} /> : null}
        {type === "scatter" ? <ScatterChart spec={spec} /> : null}
        {type === "correlation_matrix" ? <CorrelationMatrixChart spec={spec} /> : null}
        {!isSupportedType(type) ? (
          <div className="native-chart-state native-chart-error">
            <AlertCircle className="h-4 w-4" />
            Unsupported chart type: {String(type || "missing")}
          </div>
        ) : null}
      </div>
    </figure>
  );
}

function BarChart({ spec }: { spec: NativeChartSpec }) {
  const items = coerceValueItems(spec.data);
  const max = Math.max(...items.map((item) => item.value), 1);
  const labelInterval = Math.max(1, Math.ceil(items.length / 8));

  if (!items.length) return <EmptyChart />;

  return (
    <div className="native-chart-vertical">
      <div className="dash-chart-bars native-chart-bar-area">
        {items.map((item, index) => (
          <div key={`${item.label}-${index}`} className="dash-chart-col" title={item.tooltip || `${item.label}: ${formatNumber(item.value)}`}>
            <div className="dash-chart-bar-wrap">
              <motion.div
                className="dash-chart-bar"
                style={{ backgroundColor: item.color || "var(--accent-strong)" }}
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(item.value > 0 ? 8 : 0, (item.value / max) * 100)}%` }}
                transition={{ duration: 0.4, delay: index * 0.01, ease: "easeOut" }}
              />
            </div>
            {index % labelInterval === 0 ? <span className="dash-chart-label">{item.label}</span> : null}
          </div>
        ))}
      </div>
      <AxisFooter xLabel={asString(spec.xLabel)} yLabel={asString(spec.yLabel)} />
    </div>
  );
}

function HorizontalBarChart({ spec }: { spec: NativeChartSpec }) {
  const items = coerceValueItems(spec.data);
  const max = Math.max(...items.map((item) => item.value), 1);

  if (!items.length) return <EmptyChart />;

  return (
    <div className="dash-hbars">
      {items.map((item, index) => (
        <div key={`${item.label}-${index}`} className="dash-hbar-row" title={item.tooltip || `${item.label}: ${formatNumber(item.value)}`}>
          <span className="dash-hbar-label native-chart-hbar-label">{item.label}</span>
          <div className="dash-hbar-track">
            <motion.div
              className="dash-hbar-fill"
              style={{ backgroundColor: item.color || "var(--accent)" }}
              initial={{ width: 0 }}
              animate={{ width: `${(item.value / max) * 100}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>
          <span className="dash-hbar-value native-chart-hbar-value">{formatNumber(item.value)}</span>
        </div>
      ))}
    </div>
  );
}

function StackedBarChart({ spec }: { spec: NativeChartSpec }) {
  const rows = coerceStackItems(spec.data);
  if (!rows.length) return <EmptyChart />;

  return (
    <div className="native-chart-stacked">
      {rows.map((row, rowIndex) => {
        const total = row.segments.reduce((sum, segment) => sum + segment.value, 0);
        return (
          <div key={`${row.label}-${rowIndex}`} className="native-chart-stack-row" title={row.tooltip || `${row.label}: ${formatNumber(total)}`}>
            <span className="native-chart-stack-label">{row.label}</span>
            <div className="dash-token-bar native-chart-stack-track">
              {row.segments.map((segment, segmentIndex) => (
                <motion.div
                  key={`${segment.label}-${segmentIndex}`}
                  className="dash-token-segment"
                  style={{
                    backgroundColor: segment.color || PALETTE[segmentIndex % PALETTE.length],
                    width: `${total > 0 ? (segment.value / total) * 100 : 0}%`,
                  }}
                  title={`${segment.label}: ${formatNumber(segment.value)} (${total > 0 ? Math.round((segment.value / total) * 100) : 0}%)`}
                  initial={{ width: 0 }}
                  animate={{ width: `${total > 0 ? (segment.value / total) * 100 : 0}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
              ))}
            </div>
            <span className="native-chart-stack-total">{formatNumber(total)}</span>
          </div>
        );
      })}
      <Legend items={collectSegmentLegend(rows)} />
    </div>
  );
}

function LineChart({ spec }: { spec: NativeChartSpec }) {
  const series = coerceSeries(spec.series, spec.data);
  const thresholds = coerceThresholds(spec.thresholds);
  const bands = coerceBands(spec.bands);
  if (!series.some((entry) => entry.data.length)) return <EmptyChart />;

  return (
    <LineSvg
      series={series}
      thresholds={thresholds}
      bands={bands}
      xLabel={asString(spec.xLabel)}
      yLabel={asString(spec.yLabel)}
      height={SVG_HEIGHT}
    />
  );
}

function MultiTimeseriesChart({ spec }: { spec: NativeChartSpec }) {
  const panels = Array.isArray(spec.panels) ? spec.panels.filter(isRecord) : [];
  if (!panels.length) return <EmptyChart />;

  return (
    <div className="native-chart-multipanel">
      {panels.map((panel, index) => {
        const series = coerceSeries(panel.series, panel.data);
        const thresholds = coerceThresholds(panel.thresholds);
        const bands = coerceBands(panel.bands ?? spec.bands);
        return (
          <div key={`${asString(panel.title) || "panel"}-${index}`} className="native-chart-panel">
            {asString(panel.title) ? <div className="native-chart-panel-title">{asString(panel.title)}</div> : null}
            <LineSvg
              series={series}
              thresholds={thresholds}
              bands={bands}
              xLabel={index === panels.length - 1 ? asString(spec.xLabel) : ""}
              yLabel={asString(panel.yLabel) || asString(panel.title)}
              height={190}
              compact
            />
          </div>
        );
      })}
    </div>
  );
}

function ScatterChart({ spec }: { spec: NativeChartSpec }) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const points = coerceScatterPoints(spec.data);
  const normalPoints = points.filter((point) => !point.highlight && !point.anomaly);
  const highlightedPoints = points.filter((point) => point.highlight || point.anomaly);
  if (!points.length) return <EmptyChart />;

  const xDomain = paddedDomain(points.map((point) => point.x));
  const yDomain = paddedDomain(points.map((point) => point.y));
  const colorValues = points.map((point) => point.colorValue).filter(isFiniteNumber);
  const colorDomain = colorValues.length ? paddedDomain(colorValues, 0.02) : [0, 1];
  const xTicks = makeTicks(xDomain[0], xDomain[1], 5);
  const yTicks = makeTicks(yDomain[0], yDomain[1], 5);
  const plot = plotBox();
  const sx = (x: number) => scale(x, xDomain[0], xDomain[1], plot.left, plot.right);
  const sy = (y: number) => scale(y, yDomain[0], yDomain[1], plot.bottom, plot.top);
  const colorFor = (point: ScatterPoint) => {
    if (point.highlight || point.anomaly) return "var(--danger)";
    if (point.color) return point.color;
    if (isFiniteNumber(point.colorValue)) {
      return gradientColor(scale(point.colorValue, colorDomain[0], colorDomain[1], 0, 1));
    }
    return "var(--accent)";
  };

  return (
    <div className="native-chart-scatter-shell">
      <svg className="native-chart-svg" viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} role="img">
        <Grid xTicks={xTicks} yTicks={yTicks} xScale={sx} yScale={sy} xFormat={formatNumber} yFormat={formatNumber} />
        <AxisLabels xLabel={asString(spec.xLabel)} yLabel={asString(spec.yLabel)} />
        {[...normalPoints, ...highlightedPoints].map((point, index) => (
          <motion.circle
            key={`${point.label}-${index}`}
            cx={sx(point.x)}
            cy={sy(point.y)}
            r={point.highlight || point.anomaly ? 5.5 : 3.2}
            fill={colorFor(point)}
            fillOpacity={point.highlight || point.anomaly ? 1 : 0.68}
            stroke={point.highlight || point.anomaly ? "var(--bg-panel)" : "transparent"}
            strokeWidth={point.highlight || point.anomaly ? 1.5 : 0}
            className="native-chart-point"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.22, delay: Math.min(index * 0.002, 0.25) }}
            onMouseEnter={() => setTooltip({
              label: point.label,
              value: point.tooltip || `x=${formatNumber(point.x)}, y=${formatNumber(point.y)}${isFiniteNumber(point.colorValue) ? `, color=${formatNumber(point.colorValue)}` : ""}`,
            })}
            onMouseLeave={() => setTooltip(null)}
          >
            <title>{point.tooltip || `${point.label}: x=${formatNumber(point.x)}, y=${formatNumber(point.y)}`}</title>
          </motion.circle>
        ))}
      </svg>
      {colorValues.length ? <ColorBar label={asString(spec.colorLabel)} min={colorDomain[0]} max={colorDomain[1]} /> : null}
      <div className="native-chart-overlay">{tooltip ? <TooltipBox tooltip={tooltip} /> : null}</div>
      <Legend
        items={[
          { label: "Normal", color: "var(--accent)" },
          ...(highlightedPoints.length ? [{ label: "Anomaly", color: "var(--danger)" }] : []),
        ]}
      />
    </div>
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
          <g key={`x-${label}`}>
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

function LineSvg({
  series,
  thresholds,
  bands,
  xLabel,
  yLabel,
  height,
  compact = false,
}: {
  series: ChartSeries[];
  thresholds: Threshold[];
  bands: Band[];
  xLabel?: string;
  yLabel?: string;
  height: number;
  compact?: boolean;
}) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const allPoints = series.flatMap((entry) => entry.data);
  const xScaleModel = useMemo(() => createXScale(allPoints), [allPoints]);
  const yValues = [
    ...allPoints.map((point) => point.y),
    ...thresholds.map((threshold) => threshold.value),
  ];
  const yDomain = paddedDomain(yValues);
  const plot = plotBox(height, compact);
  const sx = (x: ChartPrimitive) => scale(xScaleModel.toNumber(x), xScaleModel.min, xScaleModel.max, plot.left, plot.right);
  const sy = (y: number) => scale(y, yDomain[0], yDomain[1], plot.bottom, plot.top);
  const xTicks = makeTicks(xScaleModel.min, xScaleModel.max, compact ? 4 : 6);
  const yTicks = makeTicks(yDomain[0], yDomain[1], compact ? 4 : 5);

  return (
    <div className="native-chart-svg-wrap">
      <svg className="native-chart-svg" viewBox={`0 0 ${SVG_WIDTH} ${height}`} role="img">
        <Grid xTicks={xTicks} yTicks={yTicks} xScale={(x) => scale(x, xScaleModel.min, xScaleModel.max, plot.left, plot.right)} yScale={sy} xFormat={xScaleModel.format} yFormat={formatNumber} height={height} compact={compact} />
        {bands.map((band, index) => {
          const x1 = sx(band.xStart);
          const x2 = sx(band.xEnd);
          return (
            <rect
              key={`${band.label || "band"}-${index}`}
              x={Math.min(x1, x2)}
              y={plot.top}
              width={Math.abs(x2 - x1)}
              height={plot.bottom - plot.top}
              fill={band.color || "rgba(248, 81, 73, 0.16)"}
              stroke={band.color || "rgba(248, 81, 73, 0.28)"}
              className="native-chart-band"
            >
              <title>{band.label || "Highlighted interval"}</title>
            </rect>
          );
        })}
        {thresholds.map((threshold, index) => (
          <g key={`${threshold.label || "threshold"}-${index}`}>
            <line
              x1={plot.left}
              x2={plot.right}
              y1={sy(threshold.value)}
              y2={sy(threshold.value)}
              stroke={threshold.color || "var(--danger)"}
              strokeDasharray={threshold.dashed === false ? undefined : "6 4"}
              strokeWidth={1.4}
            />
            {threshold.label ? (
              <text x={plot.left + 6} y={sy(threshold.value) - 5} className="native-chart-threshold-label">
                {threshold.label}
              </text>
            ) : null}
          </g>
        ))}
        {series.map((entry, index) => {
          const color = entry.color || PALETTE[index % PALETTE.length];
          const path = linePath(entry.data, sx, sy);
          return (
            <g key={`${entry.name}-${index}`}>
              <motion.path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.7, ease: "easeOut" }}
              />
              {entry.data.map((point, pointIndex) => (
                <circle
                  key={`${entry.name}-${point.label}-${pointIndex}`}
                  cx={sx(point.x)}
                  cy={sy(point.y)}
                  r={point.anomaly || point.highlight ? 4.2 : 2.4}
                  fill={point.anomaly || point.highlight ? "var(--danger)" : color}
                  className="native-chart-point"
                  onMouseEnter={() => setTooltip({ label: point.label, value: point.tooltip || `${entry.name}: ${formatNumber(point.y)}` })}
                  onMouseLeave={() => setTooltip(null)}
                >
                  <title>{point.tooltip || `${entry.name} ${point.label}: ${formatNumber(point.y)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
        <AxisLabels xLabel={xLabel} yLabel={yLabel} height={height} compact={compact} />
      </svg>
      <div className="native-chart-overlay">{tooltip ? <TooltipBox tooltip={tooltip} /> : null}</div>
      {!compact ? <Legend items={series.map((entry, index) => ({ label: entry.name, color: entry.color || PALETTE[index % PALETTE.length] }))} /> : null}
    </div>
  );
}

function Grid({
  xTicks,
  yTicks,
  xScale,
  yScale,
  xFormat,
  yFormat,
  height = SVG_HEIGHT,
  compact = false,
}: {
  xTicks: number[];
  yTicks: number[];
  xScale: (value: number) => number;
  yScale: (value: number) => number;
  xFormat: (value: number) => string;
  yFormat: (value: number) => string;
  height?: number;
  compact?: boolean;
}) {
  const plot = plotBox(height, compact);
  return (
    <g>
      <rect x={plot.left} y={plot.top} width={plot.right - plot.left} height={plot.bottom - plot.top} fill="transparent" stroke="var(--border-soft)" />
      {yTicks.map((tick) => (
        <g key={`y-${tick}`}>
          <line x1={plot.left} x2={plot.right} y1={yScale(tick)} y2={yScale(tick)} className="native-chart-grid-line" />
          <text x={plot.left - 10} y={yScale(tick) + 4} textAnchor="end" className="native-chart-axis-text">
            {yFormat(tick)}
          </text>
        </g>
      ))}
      {xTicks.map((tick) => (
        <g key={`x-${tick}`}>
          <line x1={xScale(tick)} x2={xScale(tick)} y1={plot.top} y2={plot.bottom} className="native-chart-grid-line" />
          <text x={xScale(tick)} y={plot.bottom + 20} textAnchor="middle" className="native-chart-axis-text">
            {xFormat(tick)}
          </text>
        </g>
      ))}
    </g>
  );
}

function AxisLabels({ xLabel, yLabel, height = SVG_HEIGHT, compact = false }: { xLabel?: string; yLabel?: string; height?: number; compact?: boolean }) {
  const plot = plotBox(height, compact);
  return (
    <g>
      {xLabel ? (
        <text x={(plot.left + plot.right) / 2} y={height - 8} textAnchor="middle" className="native-chart-axis-label">
          {xLabel}
        </text>
      ) : null}
      {yLabel ? (
        <text
          x={14}
          y={(plot.top + plot.bottom) / 2}
          textAnchor="middle"
          transform={`rotate(-90 14 ${(plot.top + plot.bottom) / 2})`}
          className="native-chart-axis-label"
        >
          {yLabel}
        </text>
      ) : null}
    </g>
  );
}

function AxisFooter({ xLabel, yLabel }: { xLabel?: string; yLabel?: string }) {
  if (!xLabel && !yLabel) return null;
  return (
    <div className="native-chart-axis-footer">
      {yLabel ? <span>{yLabel}</span> : null}
      {xLabel ? <span>{xLabel}</span> : null}
    </div>
  );
}

function ColorBar({ label, min, max }: { label?: string; min: number; max: number }) {
  return (
    <div className="native-chart-colorbar" aria-label={label || "Color scale"}>
      <span>{formatNumber(max)}</span>
      <span className="native-chart-colorbar-track" />
      <span>{formatNumber(min)}</span>
      {label ? <span className="native-chart-colorbar-label">{label}</span> : null}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  if (!items.length) return null;
  return (
    <div className="native-chart-legend">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="native-chart-legend-item">
          <span className="native-chart-legend-dot" style={{ backgroundColor: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function TooltipBox({ tooltip }: { tooltip: TooltipState }) {
  return (
    <div className="native-chart-tooltip">
      <strong>{tooltip.label}</strong>
      {tooltip.value ? <span>{tooltip.value}</span> : null}
    </div>
  );
}

function EmptyChart() {
  return <div className="native-chart-state">No renderable chart data.</div>;
}

function isSupportedType(type: unknown): type is ChartType {
  return (
    type === "bar" ||
    type === "horizontal_bar" ||
    type === "stacked_bar" ||
    type === "line" ||
    type === "timeseries" ||
    type === "multi_timeseries" ||
    type === "scatter" ||
    type === "correlation_matrix"
  );
}

function coerceValueItems(candidate: unknown): ValueItem[] {
  if (!Array.isArray(candidate)) return [];
  return candidate.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const value = asNumber(item.value ?? item.y ?? item.count);
    if (!isFiniteNumber(value)) return [];
    return [{
      label: asString(item.label ?? item.x ?? item.name) || `Item ${index + 1}`,
      value,
      color: asString(item.color),
      tooltip: asString(item.tooltip),
    }];
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
      return [{
        label: asString(segment.label ?? segment.name) || `Segment ${segmentIndex + 1}`,
        value,
        color: asString(segment.color),
      }];
    });
    if (!segments.length) return [];
    return [{
      label: asString(item.label ?? item.name) || `Item ${index + 1}`,
      segments,
      tooltip: asString(item.tooltip),
    }];
  });
}

function coerceSeries(seriesCandidate: unknown, dataCandidate: unknown): ChartSeries[] {
  if (Array.isArray(seriesCandidate)) {
    return seriesCandidate.flatMap((entry, index) => {
      if (!isRecord(entry)) return [];
      const data = coerceSeriesPoints(entry.data);
      if (!data.length) return [];
      return [{
        name: asString(entry.name ?? entry.label) || `Series ${index + 1}`,
        color: asString(entry.color),
        data,
      }];
    });
  }

  const points = coerceSeriesPoints(dataCandidate);
  if (!points.length) return [];
  return [{ name: "Value", data: points }];
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
    return [{
      x,
      y,
      label,
      anomaly: item.anomaly === true,
      highlight: item.highlight === true,
      tooltip: asString(item.tooltip),
    }];
  });
}

function coerceThresholds(candidate: unknown): Threshold[] {
  if (!Array.isArray(candidate)) return [];
  return candidate.flatMap((item) => {
    if (!isRecord(item)) return [];
    const value = asNumber(item.value);
    if (!isFiniteNumber(value)) return [];
    return [{
      value,
      label: asString(item.label),
      color: asString(item.color),
      dashed: item.dashed === false ? false : true,
    }];
  });
}

function coerceBands(candidate: unknown): Band[] {
  if (!Array.isArray(candidate)) return [];
  return candidate.flatMap((item) => {
    if (!isRecord(item)) return [];
    const start = item.xStart ?? item.start ?? item.from;
    const end = item.xEnd ?? item.end ?? item.to;
    if (!isChartPrimitive(start) || !isChartPrimitive(end)) return [];
    return [{
      xStart: start,
      xEnd: end,
      label: asString(item.label),
      color: asString(item.color),
    }];
  });
}

function coerceScatterPoints(candidate: unknown): ScatterPoint[] {
  if (!Array.isArray(candidate)) return [];
  return candidate.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const x = asNumber(item.x);
    const y = asNumber(item.y);
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return [];
    return [{
      x,
      y,
      label: asString(item.label ?? item.name) || `Point ${index + 1}`,
      colorValue: asNumber(item.colorValue ?? item.color_value ?? item.z),
      color: asString(item.color),
      highlight: item.highlight === true,
      anomaly: item.anomaly === true,
      tooltip: asString(item.tooltip),
    }];
  });
}

function collectSegmentLegend(rows: StackItem[]) {
  const seen = new Map<string, string>();
  for (const row of rows) {
    row.segments.forEach((segment, index) => {
      if (!seen.has(segment.label)) {
        seen.set(segment.label, segment.color || PALETTE[index % PALETTE.length]);
      }
    });
  }
  return Array.from(seen.entries()).map(([label, color]) => ({ label, color }));
}

function createXScale(points: SeriesPoint[]): XScaleModel {
  const xValues = points.map((point) => point.x);
  const numeric = xValues.map((value) => (typeof value === "number" ? value : Number(value)));
  if (numeric.every(isFiniteNumber)) {
    const domain = paddedDomain(numeric);
    return {
      mode: "linear",
      min: domain[0],
      max: domain[1],
      categories: [],
      toNumber: (value) => Number(value),
      format: formatNumber,
    };
  }

  const times = xValues.map((value) => (typeof value === "string" ? Date.parse(value) : Number.NaN));
  if (times.every(isFiniteNumber)) {
    const domain = paddedDomain(times, 0.01);
    return {
      mode: "time",
      min: domain[0],
      max: domain[1],
      categories: [],
      toNumber: (value) => (typeof value === "string" ? Date.parse(value) : Number(value)),
      format: formatDateTick,
    };
  }

  const categories = Array.from(new Set(xValues.map(formatPrimitive)));
  const max = Math.max(categories.length - 1, 1);
  return {
    mode: "ordinal",
    min: 0,
    max,
    categories,
    toNumber: (value) => Math.max(0, categories.indexOf(formatPrimitive(value))),
    format: (value) => categories[Math.round(value)] || "",
  };
}

function linePath(points: SeriesPoint[], sx: (value: ChartPrimitive) => number, sy: (value: number) => number): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${sx(point.x).toFixed(2)} ${sy(point.y).toFixed(2)}`)
    .join(" ");
}

function plotBox(height = SVG_HEIGHT, compact = false) {
  const padding = compact
    ? { top: 12, right: 24, bottom: 38, left: 64 }
    : PADDING;
  return {
    left: padding.left,
    right: SVG_WIDTH - padding.right,
    top: padding.top,
    bottom: height - padding.bottom,
  };
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

function makeTicks(min: number, max: number, count: number): number[] {
  if (!isFiniteNumber(min) || !isFiniteNumber(max) || count <= 1) return [];
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, index) => min + step * index);
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
    return interpolateRgb([138, 92, 150], [45, 190, 170], local);
  }
  return interpolateRgb([45, 190, 170], [250, 230, 85], (t - 0.5) / 0.5);
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

function formatNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function formatDateTick(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatPrimitive(value: ChartPrimitive): string {
  return typeof value === "number" ? formatNumber(value) : value;
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
