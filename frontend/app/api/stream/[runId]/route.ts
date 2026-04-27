/**
 * Streaming SSE proxy — uses raw Node.js HTTP to avoid fetch() buffering.
 *
 * Node.js `fetch()` (undici) can buffer the upstream response body internally,
 * which kills SSE real-time delivery. This Route Handler uses `node:http`
 * directly: each `data` event from the upstream socket is immediately
 * enqueued into a ReadableStream and flushed to the browser.
 */

import http from "node:http";
import { NextRequest } from "next/server";
import { validateRunId, BACKEND, forwardAuthHeaders } from "../../lib/proxy-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UPSTREAM_TIMEOUT_MS = 10 * 60 * 1000; // 10 min for long agent runs

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;

  const runIdError = validateRunId(runId);
  if (runIdError) return runIdError;

  const url = `${BACKEND}/api/stream/${encodeURIComponent(runId)}`;

  // Use node:http for true chunk-by-chunk streaming (no internal buffering)
  return new Promise<Response>((resolve) => {
    const req = http.get(
      url,
      {
        headers: { Accept: "text/event-stream", ...forwardAuthHeaders(request) },
        timeout: UPSTREAM_TIMEOUT_MS,
      },
      (res) => {
      if (res.statusCode !== 200) {
        // Consume response to free the socket
        res.resume();
        resolve(new Response(res.statusMessage ?? "Upstream error", { status: res.statusCode ?? 502 }));
        return;
      }

      const stream = new ReadableStream({
        start(controller) {
          res.on("data", (chunk: Buffer) => {
            controller.enqueue(chunk);
          });
          res.on("end", () => {
            controller.close();
          });
          res.on("error", (err) => {
            controller.error(err);
          });
        },
        cancel() {
          res.destroy();
        },
      });

      resolve(
        new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          },
        }),
      );
    });

    req.on("error", (err) => {
      resolve(new Response(`Backend connection failed: ${err.message}`, { status: 502 }));
    });

    req.on("timeout", () => {
      req.destroy();
      resolve(new Response("Backend stream timed out", { status: 504 }));
    });
  });
}
