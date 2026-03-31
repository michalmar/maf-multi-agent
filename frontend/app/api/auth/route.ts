/**
 * Returns the current user identity from ACA Easy Auth headers.
 *
 * Easy Auth injects `X-MS-CLIENT-PRINCIPAL` (base64-encoded JSON) into every
 * request that reaches the container. This route decodes it and returns a
 * simple { name, email } object for the frontend sidebar.
 *
 * Returns 204 when not behind Easy Auth (local dev).
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface ClientPrincipal {
  auth_typ: string;
  name_typ: string;
  role_typ: string;
  claims: Array<{ typ: string; val: string }>;
}

export async function GET(request: NextRequest) {
  const principalHeader = request.headers.get("x-ms-client-principal");
  const principalName = request.headers.get("x-ms-client-principal-name");

  if (!principalHeader) {
    // Not behind Easy Auth (local dev) — return empty
    return new NextResponse(null, { status: 204 });
  }

  try {
    const decoded = Buffer.from(principalHeader, "base64").toString("utf-8");
    const principal: ClientPrincipal = JSON.parse(decoded);

    const claims = principal.claims ?? [];
    const name =
      claims.find((c) => c.typ === "name")?.val ??
      claims.find((c) => c.typ === "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name")?.val ??
      "";
    const email =
      claims.find((c) => c.typ === "preferred_username")?.val ??
      claims.find((c) => c.typ === "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress")?.val ??
      principalName ??
      "";

    return NextResponse.json({
      name: name || email,
      email,
      hasAccessToken: !!request.headers.get("x-ms-token-aad-access-token"),
    });
  } catch {
    return NextResponse.json({
      name: principalName ?? "User",
      email: principalName ?? "",
    });
  }
}
