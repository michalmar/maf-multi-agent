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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BACKEND_ORIGIN = process.env.BACKEND_API_URL ?? "http://127.0.0.1:8000";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const url = `${BACKEND_ORIGIN}/api/stream/${runId}`;

  // Use node:http for true chunk-by-chunk streaming (no internal buffering)
  return new Promise<Response>((resolve) => {
    const req = http.get(url, { headers: { Accept: "text/event-stream" } }, (res) => {
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
  });
}

