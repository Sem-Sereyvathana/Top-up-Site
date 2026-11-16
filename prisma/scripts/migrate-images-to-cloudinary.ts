/**
 * One-off migration: move every image link in the database to Cloudinary.
 *
 * What it does
 *  - Looks at every image column in the database (games, banners, products,
 *    logo, popups, blog covers, marketplace items...).
 *  - For each link that is NOT already on Cloudinary, asks Cloudinary to
 *    fetch the file from its current location and store a copy.
 *  - Replaces the link in the database with the new Cloudinary link.
 *  - Writes image-migration-log.json (old link -> new link) so you can undo.
 *
 * Safe by default: it is a DRY RUN (changes nothing) unless you pass --apply.
 * Safe to re-run: links already on Cloudinary are skipped, and the same
 * source link always maps to the same Cloudinary file.
 *
 * Usage
 *   npm run db:migrate-images                 # dry run, shows the plan
 *   npm run db:migrate-images -- --apply      # actually do it
 *   npm run db:migrate-images -- --apply --only-blob
 *        (only move Vercel Blob images, leave links to other sites alone)
 *
 * Needs in .env: DATABASE_URL, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY,
 * CLOUDINARY_API_SECRET.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { v2 as cloudinary } from "cloudinary";

// ---- tiny .env loader (so the script works no matter how it's launched) ----
function loadEnv() {
  const file = path.join(process.cwd(), ".env");
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnv();

const APPLY = process.argv.includes("--apply");
const ONLY_BLOB = process.argv.includes("--only-blob");

// Every [prisma model delegate, column] that holds an image link.
// (User.avatarUrl is skipped on purpose: those are Google profile pictures.)
const TARGETS: Array<[string, string]> = [
  ["game", "imageUrl"],
  ["game", "bannerUrl"],
  ["gameGroup", "imageUrl"],
  ["product", "imageUrl"],
  ["settings", "logoUrl"],
  ["heroBanner", "imageUrl"],
  ["blogPost", "coverUrl"],
  ["gameAccount", "imageUrl"],
  ["gameAccountCategory", "imageUrl"],
  ["gameItem", "imageUrl"],
  ["gameItemCategory", "imageUrl"],
  ["welcomePopup", "imageUrl"],
  ["signInPopup", "imageUrl"],
];

const prisma = new PrismaClient();
const FOLDER = "sharustore/migrated";

function isBlobUrl(u: string) {
  try {
    return new URL(u).hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

/** Returns why a value is skipped, or null if it should be migrated. */
function skipReason(u: string): string | null {
  if (!/^https?:\/\//i.test(u)) return "not an http(s) link (local path?)";
  if (u.includes("res.cloudinary.com")) return "already on Cloudinary";
  if (ONLY_BLOB && !isBlobUrl(u)) return "not a Vercel Blob link (--only-blob)";
  return null;
}

async function uploadOne(src: string): Promise<string> {
  // Same source link -> same public_id, so re-runs never create duplicates.
  const publicId = crypto.createHash("sha1").update(src).digest("hex").slice(0, 20);
  const res = await cloudinary.uploader.upload(src, {
    folder: FOLDER,
    public_id: publicId,
    resource_type: "image",
    overwrite: false,
    allowed_formats: ["png", "jpg", "jpeg", "webp", "gif", "svg"],
  });
  let url = res.secure_url;
  // Same optimisation as new uploads (see app/api/admin/upload/route.ts):
  // not applied to GIF (animation) or SVG (vector).
  if (["png", "jpg", "webp"].includes(res.format)) {
    url = url.replace("/image/upload/", "/image/upload/f_auto,q_auto,c_limit,w_2000/");
  }
  return url;
}

async function main() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new Error("Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in .env first.");
  }
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });

  console.log(APPLY ? "MODE: APPLY (database will be updated)\n" : "MODE: DRY RUN (nothing will be changed)\n");

  // 1) Collect every image link and where it is used.
  type Use = { model: string; field: string; id: string | number };
  const usesByUrl = new Map<string, Use[]>();
  const skipped: Record<string, number> = {};

  for (const [model, field] of TARGETS) {
    const rows: any[] = await (prisma as any)[model].findMany({ select: { id: true, [field]: true } });
    for (const row of rows) {
      const value: string | null = row[field];
      if (!value) continue;
      const why = skipReason(value);
      if (why) {
        skipped[why] = (skipped[why] || 0) + 1;
        continue;
      }
      if (!usesByUrl.has(value)) usesByUrl.set(value, []);
      usesByUrl.get(value)!.push({ model, field, id: row.id });
    }
  }

  const totalUses = [...usesByUrl.values()].reduce((n, u) => n + u.length, 0);
  console.log(`Found ${usesByUrl.size} unique image(s) to move, used in ${totalUses} place(s).`);
  for (const [why, n] of Object.entries(skipped)) console.log(`Skipped ${n}: ${why}`);
  console.log("");

  if (!APPLY) {
    for (const [url, uses] of usesByUrl) {
      console.log(`- ${url}\n    used by: ${uses.map((u) => `${u.model}.${u.field}`).join(", ")}`);
    }
    console.log("\nDry run only. Re-run with  --apply  to migrate.");
    return;
  }

  // 2) Upload each unique image once, then update every row that used it.
  const mapping: Record<string, string> = {};
  const failures: Array<{ url: string; error: string }> = [];
  let i = 0;

  for (const [oldUrl, uses] of usesByUrl) {
    i++;
    try {
      const newUrl = await uploadOne(oldUrl);
      for (const u of uses) {
        await (prisma as any)[u.model].update({ where: { id: u.id }, data: { [u.field]: newUrl } });
      }
      mapping[oldUrl] = newUrl;
      console.log(`[${i}/${usesByUrl.size}] OK   ${oldUrl}`);
    } catch (e: any) {
      const msg = e?.message || e?.error?.message || String(e);
      failures.push({ url: oldUrl, error: msg });
      console.log(`[${i}/${usesByUrl.size}] FAIL ${oldUrl}\n         ${msg}`);
    }
  }

  fs.writeFileSync(
    path.join(process.cwd(), "image-migration-log.json"),
    JSON.stringify({ when: new Date().toISOString(), moved: mapping, failed: failures }, null, 2)
  );

  console.log(`\nDone. Moved ${Object.keys(mapping).length}, failed ${failures.length}.`);
  console.log("Log saved to image-migration-log.json (old link -> new link).");
  if (failures.length) console.log("Failed images were left unchanged in the database.");
}

main()
  .catch((e) => {
    console.error("\nMigration stopped:", e.message || e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
