/**
 * Proxy for GET /api/result/:runId — forwards to the FastAPI backend.
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BACKEND = process.env.BACKEND_API_URL ?? "http://127.0.0.1:8000";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;

  const upstream = await fetch(`${BACKEND}/api/result/${runId}`, {
    cache: "no-store",
  });

  if (!upstream.ok) {
    return NextResponse.json(
      { detail: "Result not found" },
      { status: upstream.status },
    );
  }

  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
