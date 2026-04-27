import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { forwardAuthHeaders, validatePathSegments, validateRunId } from "./proxy-helpers";

describe("proxy helpers", () => {
  it("rejects invalid run IDs", () => {
    expect(validateRunId("20260427-abc_123")).toBeNull();
    expect(validateRunId("../secret")?.status).toBe(400);
    expect(validateRunId("run/with/slash")?.status).toBe(400);
  });

  it("rejects unsafe file path segments", () => {
    expect(validatePathSegments(["abc123-plot.png"])).toBeNull();
    expect(validatePathSegments([".."])?.status).toBe(400);
    expect(validatePathSegments(["bad\\name.png"])?.status).toBe(400);
    expect(validatePathSegments([""])?.status).toBe(400);
  });

  it("forwards only the trusted Easy Auth principal header", () => {
    const request = new NextRequest("https://example.test/api/history", {
      headers: {
        "x-ms-client-principal-name": "user@example.com",
        "x-ms-token-aad-access-token": "token",
      },
    });

    expect(forwardAuthHeaders(request)).toEqual({
      "X-MS-CLIENT-PRINCIPAL-NAME": "user@example.com",
    });
  });
});
