/**
 * Proxy for GET /api/agents — forwards to the FastAPI backend.
 */

import { proxyJsonGet, BACKEND } from "../lib/proxy-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return proxyJsonGet(`${BACKEND}/api/agents`, {
    errorDetail: "Failed to fetch agents",
  });
}
