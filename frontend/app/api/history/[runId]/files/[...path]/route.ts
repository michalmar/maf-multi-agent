/**
 * Proxy for persisted run artifacts served from /api/history/:runId/files/*.
 *
 * History snapshots rewrite generic /api/files/* references to this run-scoped
 * route so replayed PNGs and JSON artifacts can be retrieved from Blob/local
 * history even after the global sandbox cache is gone.
 */

import { NextRequest } from "next/server";
import { BACKEND, forwardAuthHeaders, safeFetch, validatePathSegments, validateRunId } from "../../../../lib/proxy-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; path: string[] }> },
) {
  const { runId, path } = await params;

  const runIdError = validateRunId(runId);
  if (runIdError) return runIdError;

  const pathError = validatePathSegments(path);
  if (pathError) return pathError;

  const marker = `/api/history/${encodeURIComponent(runId)}/files/`;
  const pathname = request.nextUrl.pathname;
  const rawFileKey = pathname.includes(marker)
    ? pathname.slice(pathname.indexOf(marker) + marker.length)
    : "";
  const fileKey = rawFileKey || path.map(encodeURIComponent).join("/");
  const url = `${BACKEND}/api/history/${encodeURIComponent(runId)}/files/${fileKey}`;

  const { response, error } = await safeFetch(
    url,
    { headers: forwardAuthHeaders(request) },
    60_000,
  );
  if (error) return error;

  const upstream = response!;
  if (!upstream.ok) {
    return new Response(upstream.statusText, { status: upstream.status });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "private, no-store",
    },
  });
}
