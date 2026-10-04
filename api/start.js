// POST /api/start  { feature, confirm? }
//   -> { scenes: [{ op, line }] }                     videos started
//   -> { needsConfirm: true, message }                prompt does not look like a feature
// Writes the script, then starts one Veo job per scene and returns immediately.
// If a model's quota is used up, that scene falls back to the next model in VEO_MODELS.
import { gfetch, VEO_MODELS, CLIP_SECONDS } from "../lib/gemini.js";
import { writeScript, buildVeoPrompt, NOT_A_FEATURE_MESSAGE } from "../lib/script.js";

// Light per-IP throttle (in-memory, best effort). The prepaid balance is the real cap.
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const max = 10;
  const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

async function startScene(model, prompt) {
  const r = await gfetch(`models/${model}:predictLongRunning`, {
    method: "POST",
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        aspectRatio: "9:16",
        durationSeconds: CLIP_SECONDS, // must be a number, not a string
        resolution: "720p",
      },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.name) {
    const e = new Error(j?.error?.message || `Veo start failed (${r.status})`);
    e.status = r.status;
    e.raw = JSON.stringify(j?.error || {}).slice(0, 2000);
    throw e;
  }
  return j.name;
}

const isQuota = (e) =>
  e.status === 429 ||
  /quota|exhaust|rate limit|resource_exhausted/i.test(`${e.message} ${e.raw || ""}`);

// Try each model in order; only move on when the failure is a quota/rate-limit one.
async function startWithFallback(prompt) {
  let lastErr;
  for (const model of VEO_MODELS) {
    try {
      return await startScene(model, prompt);
    } catch (e) {
      lastErr = e;
      console.error(`scene start failed on ${model}:`, e.message);
      if (!isQuota(e)) throw e;
    }
  }
  throw lastErr;
}

function quotaMessage(errors) {
  const t = errors.map((e) => `${e?.raw || ""} ${e?.message || ""}`).join(" ");
  if (/PerDay|per_day|per day/i.test(t)) {
    return "Today's video limit has been reached. It resets at midnight Pacific time (3 AM Eastern). Please try again then.";
  }
  if (/PerMinute|per_minute|per minute/i.test(t)) {
    return "The video service is busy right now. Please try again in a minute.";
  }
  return "The video service is at its limit right now. Please try again in a minute. If it keeps happening, the daily limit may be used up (it resets at midnight Pacific time, 3 AM Eastern).";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  const feature = String(body?.feature ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
  if (feature.length < 3) {
    return res.status(400).json({ error: "Describe a feature first." });
  }
  const confirmed = body?.confirm === true;

  const ip =
    String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    "unknown";

  try {
    const script = await writeScript(feature);

    // Cheap check first: no video money is spent until the user confirms an off-topic prompt.
    if (!script.isFeature && !confirmed) {
      return res.status(200).json({ needsConfirm: true, message: NOT_A_FEATURE_MESSAGE });
    }

    if (limited(ip)) {
      return res.status(429).json({
        error:
          "Easy there! That's a lot of videos from one connection. Try again in a few minutes.",
      });
    }

    const settled = await Promise.allSettled(
      script.scenes.map((sc, i) => startWithFallback(buildVeoPrompt(script, sc, i)))
    );
    const scenes = [];
    const errors = [];
    settled.forEach((s, i) => {
      if (s.status === "fulfilled") {
        scenes.push({ op: s.value, line: script.scenes[i].line });
      } else {
        errors.push(s.reason);
      }
    });
    if (!scenes.length) {
      if (errors.length && errors.every(isQuota)) {
        return res.status(503).json({ error: quotaMessage(errors) });
      }
      return res
        .status(502)
        .json({ error: "Could not start the video. Please try again." });
    }
    return res.status(200).json({ scenes });
  } catch (err) {
    console.error("start error:", err?.message);
    return res
      .status(500)
      .json({ error: "Something went wrong starting the video. Try again." });
  }
}
