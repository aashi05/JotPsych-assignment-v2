// Where finished videos are saved.
// - Vercel Blob when BLOB_READ_WRITE_TOKEN is set (production).
// - A local folder when STORAGE_DIR is set (tests / local dev only).
// - Otherwise null, and callers fall back to inline data URLs.
import { put } from "@vercel/blob";
import fs from "node:fs";
import path from "node:path";

export const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

export async function saveVideo(buf, name) {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(name, buf, {
      access: "public",
      contentType: "video/mp4",
      addRandomSuffix: true,
    });
    return { url: blob.url, downloadUrl: blob.downloadUrl || `${blob.url}?download=1` };
  }
  if (process.env.STORAGE_DIR) {
    const file = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${path.basename(name)}`;
    fs.mkdirSync(process.env.STORAGE_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.STORAGE_DIR, file), buf);
    const url = `https://local${BLOB_HOST_SUFFIX}/${file}`;
    return { url, downloadUrl: `${url}?download=1` };
  }
  return null;
}

// Only accept clip URLs that live in our own blob store.
export function isOurBlobUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "https:" && x.hostname.endsWith(BLOB_HOST_SUFFIX);
  } catch {
    return false;
  }
}
