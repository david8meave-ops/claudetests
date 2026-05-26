import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const MIME_TYPES: Record<string, string> = {
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".map": "application/json; charset=utf-8",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const resolvedParams = await params;
  const segments = resolvedParams.path ?? [];

  // Prevent path traversal attacks
  const normalized = segments.map((s) => path.normalize(s));
  if (normalized.some((s) => s.includes(".."))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const filePath = path.join(
    process.cwd(),
    "node_modules",
    "monaco-editor",
    "min",
    "vs",
    ...normalized
  );

  try {
    const content = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

    return new NextResponse(content, {
      headers: {
        "Content-Type": contentType,
        // Cache aggressively since monaco files are versioned
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
