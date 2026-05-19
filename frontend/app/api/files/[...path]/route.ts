/**
 * Proxy for Code Interpreter sandbox files served by the backend.
 *
 * Catches all requests to /api/files/* and forwards them to the
 * Python backend's /api/files/* endpoint, preserving the Content-Type
 * so images render correctly in <img> tags.
 */

import { NextRequest } from "next/server";
import { BACKEND, validatePathSegments, safeFetch } from "../../lib/proxy-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;

  const pathError = validatePathSegments(path);
  if (pathError) return pathError;

  // Preserve the original encoded suffix so historical URLs like
  // /api/files/%2Fmnt%2Fdata%2Fplot.png are not double-encoded to %252F...
  const pathname = request.nextUrl.pathname;
  const marker = "/api/files/";
  const rawFileKey = pathname.includes(marker)
    ? pathname.slice(pathname.indexOf(marker) + marker.length)
    : "";
  const fileKey = rawFileKey || path.map(encodeURIComponent).join("/");
  const url = `${BACKEND}/api/files/${fileKey}`;

  const { response, error } = await safeFetch(url, undefined, 60_000);
  if (error) return error;

  const upstream = response!;
  if (!upstream.ok) {
    return new Response(upstream.statusText, { status: upstream.status });
  }

  const contentType =
    upstream.headers.get("content-type") ?? "application/octet-stream";

  // Stream the response instead of buffering the full arrayBuffer
  const body = upstream.body;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, no-store",
    },
  });
}
