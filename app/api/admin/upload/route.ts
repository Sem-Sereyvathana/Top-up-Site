import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import { put } from "@vercel/blob";
import crypto from "crypto";

export const runtime = "nodejs";

// Max upload size: 5 MB
const MAX_BYTES = 5 * 1024 * 1024;

// Strict whitelist of allowed image types + their file extensions.
const ALLOWED: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size === 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large. Max ${MAX_BYTES / 1024 / 1024}MB.` },
        { status: 413 }
      );
    }

    const ext = ALLOWED[file.type];
    if (!ext) {
      return NextResponse.json(
        { error: `Unsupported type "${file.type}". Use PNG, JPG, WEBP, GIF, or SVG.` },
        { status: 415 }
      );
    }

    // Generate a safe random filename — ignore the client-supplied name
    // entirely to prevent path traversal and collisions.
    const name = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`;

    // Vercel's serverless functions have a read-only filesystem (aside from
    // /tmp, which is ephemeral and never publicly served), so files can't be
    // saved to disk the way they could in a normal always-on server. Vercel
    // Blob stores the file remotely instead and hands back a permanent
    // public URL — see BLOB_READ_WRITE_TOKEN in .env.example.
    const blob = await put(name, file, {
      access: "public",
      contentType: file.type,
    });

    return NextResponse.json({
      url: blob.url,
      size: file.size,
      type: file.type,
    });
  } catch (err) {
    console.error("[upload] error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

