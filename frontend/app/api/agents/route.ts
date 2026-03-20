/**
 * Proxy for GET /api/agents — forwards to the FastAPI backend.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BACKEND = process.env.BACKEND_API_URL ?? "http://127.0.0.1:8000";

export async function GET() {
  const upstream = await fetch(`${BACKEND}/api/agents`, {
    cache: "no-store",
  });

  if (!upstream.ok) {
    return NextResponse.json(
      { detail: "Failed to fetch agents" },
      { status: upstream.status },
    );
  }

  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
