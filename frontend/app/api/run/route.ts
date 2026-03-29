/**
 * Proxy for POST /api/run — forwards to the FastAPI backend.
 *
 * Using a Route Handler (instead of a Next.js rewrite) keeps the
 * API layer consistent with the SSE streaming handler and avoids
 * any proxy-level buffering surprises.
 */

import { NextRequest, NextResponse } from "next/server";
import { BACKEND, safeFetch, safeJson } from "../lib/proxy-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: string;
  try {
    body = await request.text();
    JSON.parse(body); // validate JSON
  } catch {
    return NextResponse.json(
      { detail: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  const { response, error } = await safeFetch(`${BACKEND}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (error) return error;

  const upstream = response!;
  const { data, error: jsonErr } = await safeJson(upstream);
  if (jsonErr) return jsonErr;

  return NextResponse.json(data, { status: upstream.status });
}
