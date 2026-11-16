import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import crypto from "crypto";
import { requireAdminApi } from "@/lib/auth";

export const runtime = "nodejs";

// Max upload size: 5 MB for images, 60 MB for the redeem-guide video
// (short how-to clips only — it streams from Cloudinary).
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

// Strict whitelist of allowed types. Video uploads must use ?kind=video.
const ALLOWED: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

const ALLOWED_VIDEO: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

// Images are stored on Cloudinary. Set these in .env (see .env.example):
//   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
//   CLOUDINARY_FOLDER (optional, default "topupwebsite")
// The API secret stays on the server; the browser only ever sends the file here.
export async function POST(req: NextRequest) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  try {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) {
      console.error("[upload] Cloudinary env vars are missing");
      return NextResponse.json(
        { error: "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET." },
        { status: 500 }
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    // kind=video switches the whitelist, size cap and Cloudinary endpoint.
    const kind = req.nextUrl.searchParams.get("kind") === "video" ? "video" : "image";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }
    const maxBytes = kind === "video" ? MAX_VIDEO_BYTES : MAX_BYTES;
    if (file.size > maxBytes) {
      return NextResponse.json(
        { error: `File too large. Max ${maxBytes / 1024 / 1024}MB.` },
        { status: 413 }
      );
    }

    const ext = kind === "video" ? ALLOWED_VIDEO[file.type] : ALLOWED[file.type];
    if (!ext) {
      return NextResponse.json(
        { error: `Unsupported type "${file.type}". ${kind === "video" ? "Use MP4, WEBM or MOV." : "Use PNG, JPG, WEBP, GIF, or SVG."}` },
        { status: 415 }
      );
    }

    // Random file name - the client-supplied name is ignored entirely.
    const publicId = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
    const folder = (process.env.CLOUDINARY_FOLDER || "topupwebsite").replace(/[^a-zA-Z0-9_\-/]/g, "");
    const timestamp = Math.floor(Date.now() / 1000);

    // Cloudinary signature: SHA-1 of the signed params (alphabetical, "k=v&k=v") + API secret.
    const toSign = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}`;
    const signature = crypto.createHash("sha1").update(toSign + apiSecret).digest("hex");

    const body = new FormData();
    body.append("file", file);
    body.append("api_key", apiKey);
    body.append("timestamp", String(timestamp));
    body.append("folder", folder);
    body.append("public_id", publicId);
    body.append("signature", signature);

    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${kind}/upload`, {
      method: "POST",
      body,
    });
    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.secure_url) {
      console.error("[upload] Cloudinary error:", res.status, data?.error?.message);
      return NextResponse.json(
        { error: `Upload failed${data?.error?.message ? `: ${data.error.message}` : ""}` },
        { status: 502 }
      );
    }

    // Same delivery settings as the images already in the catalogue (auto format/quality, max 2000px wide).
    // SVG and GIF are left untouched so vectors and animations are not converted.
    let url: string = data.secure_url;
    if (kind === "image" && ext !== "svg" && ext !== "gif") {
      url = url.replace("/upload/", "/upload/f_auto,q_auto,c_limit,w_2000/");
    }

    return NextResponse.json({ url, size: file.size, type: file.type });
  } catch (err) {
    console.error("[upload] error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
