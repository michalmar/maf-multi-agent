export function isNativeChartHref(href?: string): boolean {
  if (!href) return false;
  const lower = href.toLowerCase();
  return lower.includes(".mafchart.json") || lower.includes(".nativechart.json");
}

export function isNativeChartLink(label: string, href?: string): boolean {
  return label.trim().toLowerCase().startsWith("chart:") || isNativeChartHref(href);
}

export function chartLinkTitle(label: string): string {
  const trimmed = label.trim();
  return trimmed.toLowerCase().startsWith("chart:")
    ? trimmed.slice(trimmed.indexOf(":") + 1).trim()
    : trimmed;
}
