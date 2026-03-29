/**
 * Proxy for GET /api/version — forwards to the FastAPI backend.
 */

import { proxyJsonGet, BACKEND } from "../lib/proxy-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return proxyJsonGet(`${BACKEND}/api/version`, {
    fallback: { version: "dev", git_sha: "unknown", build_date: "unknown" },
  });
}
