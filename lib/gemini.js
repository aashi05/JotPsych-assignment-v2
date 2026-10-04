// Shared settings and a tiny Gemini API helper.
export const BASE = "https://generativelanguage.googleapis.com/v1beta";
export const VEO_MODEL = process.env.VEO_MODEL || "veo-3.1-lite-generate-preview";
export const TEXT_MODEL = process.env.TEXT_MODEL || "gemini-3.5-flash-lite";

// Cost guard: 3 clips x 6s on Lite = 18s of video per request.
export const SCENES = 3;
export const CLIP_SECONDS = 6;

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
