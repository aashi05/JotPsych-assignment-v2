// POST /api/start  { feature, confirm? }
//   -> { scenes: [{ op, line }] }                     videos started
//   -> { needsConfirm: true, message }                prompt does not look like a feature
// Writes the script, then starts one Veo job per scene and returns immediately.
import { gfetch, VEO_MODEL, CLIP_SECONDS } from "../lib/gemini.js";
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

async function startScene(prompt) {
  const r = await gfetch(`models/${VEO_MODEL}:predictLongRunning`, {
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
    throw new Error(j?.error?.message || `Veo start failed (${r.status})`);
  }
  return j.name;
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
      script.scenes.map((sc, i) => startScene(buildVeoPrompt(script, sc, i)))
    );
    const scenes = [];
    settled.forEach((s, i) => {
      if (s.status === "fulfilled") {
        scenes.push({ op: s.value, line: script.scenes[i].line });
      } else {
        console.error("scene start failed:", s.reason?.message);
      }
    });
    if (!scenes.length) {
      const why = settled[0]?.reason?.message || "";
      const busy = /quota|rate|429|exhaust|credit|billing/i.test(why);
      return res.status(busy ? 503 : 502).json({
        error: busy
          ? "The video service is busy right now. Please try again in a minute."
          : "Could not start the video. Please try again.",
      });
    }
    return res.status(200).json({ scenes });
  } catch (err) {
    console.error("start error:", err?.message);
    return res
      .status(500)
      .json({ error: "Something went wrong starting the video. Try again." });
  }
}
