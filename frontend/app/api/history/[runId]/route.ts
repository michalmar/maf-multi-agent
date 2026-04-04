/**
 * Proxy for GET/DELETE /api/history/{runId} — load or delete a session snapshot.
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
    `${BACKEND}/api/history/${encodeURIComponent(runId)}`,
    { cache: "no-store", headers: forwardAuthHeaders(request) },
  );
  if (error) return error;

  const upstream = response!;
  if (!upstream.ok) {
    return NextResponse.json(
      { detail: "Session not found" },
      { status: upstream.status },
    );
  }

  const { data, error: jsonErr } = await safeJson(upstream);
  if (jsonErr) return jsonErr;

  return NextResponse.json(data, { status: upstream.status });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;

  const runIdError = validateRunId(runId);
  if (runIdError) return runIdError;

  const { response, error } = await safeFetch(
    `${BACKEND}/api/history/${encodeURIComponent(runId)}`,
    { method: "DELETE", headers: forwardAuthHeaders(request) },
  );
  if (error) return error;

  const upstream = response!;
  if (!upstream.ok) {
    return NextResponse.json(
      { detail: "Delete failed" },
      { status: upstream.status },
    );
  }

  const { data, error: jsonErr } = await safeJson(upstream);
  if (jsonErr) return jsonErr;

  return NextResponse.json(data, { status: upstream.status });
}
