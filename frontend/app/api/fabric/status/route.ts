/**
 * Proxy for GET /api/fabric/status — forwards to the FastAPI backend.
 */

import { proxyJsonGet, BACKEND } from "../../lib/proxy-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return proxyJsonGet(`${BACKEND}/api/fabric/status`, {
    fallback: { enabled: false, error: "Backend unreachable" },
  });
}
