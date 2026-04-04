/**
 * Shared utilities for API route proxy handlers.
 *
 * Provides input validation, safe fetch with timeouts,
 * and consistent error response formatting.
 */

import { NextRequest, NextResponse } from "next/server";

export const BACKEND =
  process.env.BACKEND_API_URL ?? "http://127.0.0.1:8000";

const DEFAULT_TIMEOUT_MS = 30_000;

/* ------------------------------------------------------------------ */
/*  Input validation                                                   */
/* ------------------------------------------------------------------ */

const RUN_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * Validate a runId parameter. Returns `null` if valid,
 * or a NextResponse error if invalid.
 */
export function validateRunId(runId: string): NextResponse | null {
  if (!RUN_ID_PATTERN.test(runId)) {
    return NextResponse.json(
      { detail: "Invalid run ID format" },
      { status: 400 },
    );
  }
  return null;
}

/**
 * Validate file path segments — reject traversal and control characters.
 * Returns `null` if valid, or a NextResponse error if invalid.
 */
export function validatePathSegments(
  segments: string[],
): NextResponse | null {
  for (const seg of segments) {
    if (
      seg === ".." ||
      seg === "." ||
      seg === "" ||
      seg.includes("\0") ||
      /[<>:"|?*\\]/.test(seg)
    ) {
      return NextResponse.json(
        { detail: "Invalid file path" },
        { status: 400 },
      );
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Auth header forwarding                                             */
/* ------------------------------------------------------------------ */

/**
 * Extract Easy Auth identity headers from an incoming request
 * so they can be forwarded to the backend for user-scoped operations.
 */
export function forwardAuthHeaders(
  request: NextRequest,
): Record<string, string> {
  const headers: Record<string, string> = {};
  const principalName = request.headers.get("x-ms-client-principal-name");
  if (principalName) {
    headers["X-MS-CLIENT-PRINCIPAL-NAME"] = principalName;
  }
  return headers;
}

/* ------------------------------------------------------------------ */
/*  Safe fetch with timeout                                            */
/* ------------------------------------------------------------------ */

interface SafeFetchResult {
  response?: Response;
  error?: NextResponse;
}

/**
 * Fetch with an AbortController timeout. Returns the upstream Response
 * on success, or a pre-built NextResponse error on failure.
 */
export async function safeFetch(
  url: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<SafeFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    return { response };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return {
        error: NextResponse.json(
          { detail: "Backend request timed out" },
          { status: 504 },
        ),
      };
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      error: NextResponse.json(
        { detail: `Backend unreachable: ${message}` },
        { status: 502 },
      ),
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/*  Safe JSON parsing                                                  */
/* ------------------------------------------------------------------ */

/**
 * Safely parse JSON from an upstream response.
 * Returns the parsed data or a NextResponse error if the body is not valid JSON.
 */
export async function safeJson(
  upstream: Response,
): Promise<{ data?: unknown; error?: NextResponse }> {
  try {
    const data = await upstream.json();
    return { data };
  } catch {
    return {
      error: NextResponse.json(
        { detail: "Invalid JSON from backend" },
        { status: 502 },
      ),
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Convenience: fetch + parse + forward                               */
/* ------------------------------------------------------------------ */

/**
 * One-shot proxy helper: fetches the URL, parses JSON, and returns
 * a properly-formatted NextResponse.
 *
 * `fallback` is returned with HTTP 200 when the backend is completely
 * unreachable and the caller prefers a graceful degradation (e.g. version info).
 */
export async function proxyJsonGet(
  url: string,
  opts?: {
    fallback?: Record<string, unknown> | unknown[];
    errorDetail?: string;
    timeoutMs?: number;
    headers?: Record<string, string>;
  },
): Promise<NextResponse> {
  const { response, error } = await safeFetch(
    url,
    { cache: "no-store", headers: opts?.headers },
    opts?.timeoutMs,
  );

  if (error) {
    if (opts?.fallback) {
      return NextResponse.json(opts.fallback, { status: 200 });
    }
    return error;
  }

  const upstream = response!;
  if (!upstream.ok) {
    return NextResponse.json(
      { detail: opts?.errorDetail ?? `Backend returned ${upstream.status}` },
      { status: upstream.status },
    );
  }

  const { data, error: jsonErr } = await safeJson(upstream);
  if (jsonErr) return jsonErr;

  return NextResponse.json(data, { status: upstream.status });
}
