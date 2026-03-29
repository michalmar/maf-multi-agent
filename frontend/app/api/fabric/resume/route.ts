/**
 * Proxy for POST /api/fabric/resume — forwards to the FastAPI backend.
 */

import { NextResponse } from "next/server";
import { BACKEND, safeFetch, safeJson } from "../../lib/proxy-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const { response, error } = await safeFetch(`${BACKEND}/api/fabric/resume`, {
    method: "POST",
    cache: "no-store",
  });

  if (error) {
    return NextResponse.json(
      { success: false, error: "Backend unreachable" },
      { status: 502 },
    );
  }

  const upstream = response!;
  const { data, error: jsonErr } = await safeJson(upstream);
  if (jsonErr) return jsonErr;

  return NextResponse.json(data, { status: upstream.status });
}
