/**
 * Proxy for GET/DELETE /api/history/{runId} — load or delete a session snapshot.
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
  const upstream = await fetch(`${BACKEND}/api/history/${runId}`, {
    cache: "no-store",
  });

  if (!upstream.ok) {
    return NextResponse.json(
      { detail: "Session not found" },
      { status: upstream.status },
    );
  }

  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const upstream = await fetch(`${BACKEND}/api/history/${runId}`, {
    method: "DELETE",
  });

  if (!upstream.ok) {
    return NextResponse.json(
      { detail: "Delete failed" },
      { status: upstream.status },
    );
  }

  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
