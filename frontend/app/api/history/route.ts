/**
 * Proxy for GET /api/history — list saved session snapshots.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BACKEND = process.env.BACKEND_API_URL ?? "http://127.0.0.1:8000";

export async function GET() {
  const upstream = await fetch(`${BACKEND}/api/history`, {
    cache: "no-store",
  });

  if (!upstream.ok) {
    return NextResponse.json([], { status: upstream.status });
  }

  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
