export type ChartPrimitive = string | number;

export interface NativeChartBand {
  xStart: ChartPrimitive;
  xEnd: ChartPrimitive;
  label?: string;
  color?: string;
  kind?: string;
  severity?: string;
}

export interface LineXAxisModel {
  labels: string[];
  values: ChartPrimitive[];
  mode: "numeric" | "time" | "ordinal";
}

export interface NativeChartBandTheme {
  dangerSoft: string;
  attentionSoft: string;
  accentSoft: string;
}

export function resolveBandPixelRange(
  band: NativeChartBand,
  xAxis: LineXAxisModel,
  areaLeft: number,
  areaRight: number,
): [number, number] | null {
  if (xAxis.mode === "numeric" || xAxis.mode === "time") {
    const start = chartAxisValueToNumber(band.xStart, xAxis.mode);
    const end = chartAxisValueToNumber(band.xEnd, xAxis.mode);
    const domain = xAxis.values.map((value) => chartAxisValueToNumber(value, xAxis.mode)).filter(isFiniteNumber);
    if (!isFiniteNumber(start) || !isFiniteNumber(end) || domain.length < 2) return null;

    const min = Math.min(...domain);
    const max = Math.max(...domain);
    if (min === max) return null;

    const leftBoundary = scale(Math.min(start, end), min, max, areaLeft, areaRight);
    const rightBoundary = scale(Math.max(start, end), min, max, areaLeft, areaRight);
    const left = Math.max(areaLeft, Math.min(leftBoundary, rightBoundary));
    const right = Math.min(areaRight, Math.max(leftBoundary, rightBoundary));

    return right > left ? [left, right] : null;
  }

  const start = fractionalIndexForBandValue(band.xStart, xAxis);
  const end = fractionalIndexForBandValue(band.xEnd, xAxis);
  if (!isFiniteNumber(start) || !isFiniteNumber(end)) return null;

  const maxIndex = Math.max(xAxis.labels.length - 1, 1);
  const step = (areaRight - areaLeft) / maxIndex;
  const pad = xAxis.mode === "ordinal" ? step / 2 : 0;
  const x1 = areaLeft + Math.min(start, end) * step - pad;
  const x2 = areaLeft + Math.max(start, end) * step + pad;
  const left = Math.max(areaLeft, Math.min(x1, x2));
  const right = Math.min(areaRight, Math.max(x1, x2));

  return right > left ? [left, right] : null;
}

export function formatChartPrimitive(value: ChartPrimitive): string {
  return typeof value === "number" ? formatNumber(value) : value;
}

export function chartAxisValueToNumber(value: ChartPrimitive, mode: LineXAxisModel["mode"]): number {
  if (mode === "numeric") {
    return typeof value === "number" ? value : Number(value);
  }
  if (mode === "time") {
    return typeof value === "string" ? Date.parse(value) : Number.NaN;
  }
  return Number.NaN;
}

export function resolveBandFill(band: NativeChartBand, theme: NativeChartBandTheme): string {
  if (band.color && !band.color.trim().startsWith("var(")) return band.color;

  const descriptor = `${band.kind ?? ""} ${band.severity ?? ""} ${band.label ?? ""}`.toLowerCase();
  if (/\b(after[-\s]?effect|recovery|cooldown|post[-\s]?event|residual|delta|follow[-\s]?up)\b/.test(descriptor)) {
    return theme.attentionSoft;
  }
  if (/\b(context|maintenance|planned|baseline|reference|note|info)\b/.test(descriptor)) {
    return theme.accentSoft;
  }

  return theme.dangerSoft;
}

function fractionalIndexForBandValue(value: ChartPrimitive, xAxis: LineXAxisModel): number | null {
  if (!xAxis.values.length) return null;
  if (xAxis.values.length === 1) return 0;

  if (xAxis.mode === "numeric" || xAxis.mode === "time") {
    const parsed = chartAxisValueToNumber(value, xAxis.mode);
    if (!isFiniteNumber(parsed)) return null;
    const parsedValues = xAxis.values.map((axisValue) => chartAxisValueToNumber(axisValue, xAxis.mode));
    if (!parsedValues.every(isFiniteNumber)) return null;

    if (parsed <= parsedValues[0]) return 0;
    const lastIndex = parsedValues.length - 1;
    if (parsed >= parsedValues[lastIndex]) return lastIndex;

    for (let index = 0; index < parsedValues.length - 1; index += 1) {
      const current = parsedValues[index];
      const next = parsedValues[index + 1];
      if (parsed >= current && parsed <= next) {
        if (next === current) return index;
        return index + (parsed - current) / (next - current);
      }
    }

    return null;
  }

  const formatted = formatChartPrimitive(value);
  const index = xAxis.labels.findIndex((label) => label === formatted);
  return index >= 0 ? index : null;
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

function scale(value: number, domainMin: number, domainMax: number, rangeMin: number, rangeMax: number): number {
  const ratio = (value - domainMin) / (domainMax - domainMin);
  return rangeMin + ratio * (rangeMax - rangeMin);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
