import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

export async function GET() {
  try {
    // Next.js standalone server.js does process.chdir(__dirname), so cwd varies:
    // - Docker:  /app/frontend-standalone/frontend/  (standalone chdir)
    // - Dev:     /path/to/project/frontend/          (npm run dev)
    // CHANGELOG.md lives at the project root (/app/ in Docker, ../ from frontend/ in dev)
    const cwd = process.cwd();
    const paths = [
      join(cwd, "CHANGELOG.md"),
      join(cwd, "..", "CHANGELOG.md"),
      join(cwd, "..", "..", "CHANGELOG.md"),
    ];

    for (const p of paths) {
      try {
        const content = await readFile(p, "utf-8");
        // Strip the top-level heading and description lines for cleaner display
        const cleaned = content
          .replace(/^# Changelog\n+/, "")
          .replace(/^All notable changes.*\n+/m, "")
          .replace(/^Update this file.*\n+/m, "")
          .trim();
        return new NextResponse(cleaned, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      } catch {
        continue;
      }
    }

    return new NextResponse("No changelog available.", { status: 404 });
  } catch {
    return new NextResponse("Failed to load changelog.", { status: 500 });
  }
}
