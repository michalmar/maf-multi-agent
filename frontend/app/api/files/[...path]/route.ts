/**
 * Proxy for Code Interpreter sandbox files served by the backend.
 *
 * Catches all requests to /api/files/* and forwards them to the
 * Python backend's /api/files/* endpoint, preserving the Content-Type
 * so images render correctly in <img> tags.
 */

import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BACKEND_ORIGIN = process.env.BACKEND_API_URL ?? "http://127.0.0.1:8000";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const fileKey = path.join("/");
  const url = `${BACKEND_ORIGIN}/api/files/${fileKey}`;

  try {
    const upstream = await fetch(url);

    if (!upstream.ok) {
      return new Response(upstream.statusText, { status: upstream.status });
    }

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    const body = await upstream.arrayBuffer();

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(`Backend file fetch failed: ${message}`, { status: 502 });
  }
}
