/**
 * Proxy for GET /api/history — list saved session snapshots.
 */

import { NextRequest } from "next/server";
import { proxyJsonGet, forwardAuthHeaders, BACKEND } from "../lib/proxy-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return proxyJsonGet(`${BACKEND}/api/history`, {
    fallback: [], // graceful degradation: empty list when backend is down
    errorDetail: "Failed to fetch history",
    headers: forwardAuthHeaders(request),
  });
}
