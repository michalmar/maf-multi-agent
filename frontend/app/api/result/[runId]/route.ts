/**
 * Proxy for GET /api/result/:runId — forwards to the FastAPI backend.
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
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;

  const runIdError = validateRunId(runId);
  if (runIdError) return runIdError;

  const { response, error } = await safeFetch(
    `${BACKEND}/api/result/${encodeURIComponent(runId)}`,
    { cache: "no-store", headers: forwardAuthHeaders(_request) },
  );
  if (error) return error;

  const upstream = response!;
  if (!upstream.ok) {
    return NextResponse.json(
      { detail: "Result not found" },
      { status: upstream.status },
    );
  }

  const { data, error: jsonErr } = await safeJson(upstream);
  if (jsonErr) return jsonErr;

  return NextResponse.json(data, { status: upstream.status });
}
