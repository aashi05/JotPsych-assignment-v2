// Shared settings and a tiny Gemini API helper.

// Veo models to try, in order. A model whose quota is used up is skipped for the next one.
// Lite is cheapest ($0.05/s); Fast is $0.10/s. (Standard is $0.40/s, so it is not used.)
export const VEO_MODELS = (process.env.VEO_MODELS ||
  "veo-3.1-lite-generate-preview,veo-3.1-fast-generate-preview")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const BASE = "https://generativelanguage.googleapis.com/v1beta";
export const TEXT_MODEL = process.env.TEXT_MODEL || "gemini-3.5-flash-lite";

// Quota guard: Tier 1 allows only 2 video requests/minute and 10/day per model,
// so a video uses as few requests as possible. 2 scenes x 8s = 16s, 2 requests.
export const SCENES = Math.min(3, Math.max(1, Number(process.env.SCENES) || 2));
export const CLIP_SECONDS = [4, 6, 8].includes(Number(process.env.CLIP_SECONDS))
  ? Number(process.env.CLIP_SECONDS)
  : 8;

export function apiKey() {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error("Server is missing GEMINI_API_KEY");
  return k;
}

// path is relative to the v1beta base, e.g. "models/x:generateContent"
export function gfetch(path, init = {}) {
  return fetch(`${BASE}/${path}`, {
    ...init,
    headers: {
      "x-goog-api-key": apiKey(),
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}
