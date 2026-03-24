/**
 * Proxy for POST /api/fabric/resume — forwards to the FastAPI backend.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BACKEND = process.env.BACKEND_API_URL ?? "http://127.0.0.1:8000";

export async function POST() {
  try {
    const upstream = await fetch(`${BACKEND}/api/fabric/resume`, {
      method: "POST",
      cache: "no-store",
    });

    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { success: false, error: "Backend unreachable" },
      { status: 502 },
    );
  }
}
