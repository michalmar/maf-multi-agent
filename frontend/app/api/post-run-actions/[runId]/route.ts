/**
 * Proxy for GET/POST /api/post-run-actions/:runId.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  BACKEND,
  validateRunId,
  forwardAuthHeaders,
  safeFetch,
  safeJson,
} from "../../lib/proxy-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;

  const runIdError = validateRunId(runId);
  if (runIdError) return runIdError;

  const { response, error } = await safeFetch(
    `${BACKEND}/api/post-run-actions/${encodeURIComponent(runId)}`,
    { cache: "no-store", headers: forwardAuthHeaders(request) },
  );
  if (error) return error;

  const upstream = response!;
  if (!upstream.ok) {
    return NextResponse.json(
      { detail: "Post-run actions unavailable" },
      { status: upstream.status },
    );
  }

  const { data, error: jsonErr } = await safeJson(upstream);
  if (jsonErr) return jsonErr;

  return NextResponse.json(data, { status: upstream.status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;

  const runIdError = validateRunId(runId);
  if (runIdError) return runIdError;

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
    if (payload === null || Array.isArray(payload) || typeof payload !== "object") {
      throw new Error("Invalid payload");
    }
  } catch {
    return NextResponse.json(
      { detail: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  const { response, error } = await safeFetch(
    `${BACKEND}/api/post-run-actions/${encodeURIComponent(runId)}`,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...forwardAuthHeaders(request),
      },
      body: JSON.stringify(payload),
    },
  );
  if (error) return error;

  const upstream = response!;
  const { data, error: jsonErr } = await safeJson(upstream);
  if (jsonErr) return jsonErr;

  return NextResponse.json(data, { status: upstream.status });
}
