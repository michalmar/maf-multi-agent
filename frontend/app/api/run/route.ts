/**
 * Proxy for POST /api/run — forwards to the FastAPI backend.
 *
 * Using a Route Handler (instead of a Next.js rewrite) keeps the
 * API layer consistent with the SSE streaming handler and avoids
 * any proxy-level buffering surprises.
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BACKEND = process.env.BACKEND_API_URL ?? "http://127.0.0.1:8000";

export async function POST(request: NextRequest) {
  const body = await request.text();

  const upstream = await fetch(`${BACKEND}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
