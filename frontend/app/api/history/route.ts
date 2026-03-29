/**
 * Proxy for GET /api/history — list saved session snapshots.
 */

import { proxyJsonGet, BACKEND } from "../lib/proxy-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return proxyJsonGet(`${BACKEND}/api/history`, {
    fallback: [], // graceful degradation: empty list when backend is down
    errorDetail: "Failed to fetch history",
  });
}
