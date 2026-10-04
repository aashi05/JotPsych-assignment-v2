// POST /api/stitch  { clips: [{ url, line }] }  ->  { url, downloadUrl }
// Joins the clips into ONE vertical MP4, burns in the captions, and adds a brand-color frame.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegStatic from "ffmpeg-static";
import { buildAss } from "../lib/captions.js";
import { saveVideo, isOurBlobUrl } from "../lib/storage.js";

const run = promisify(execFile);
const ASSETS = fileURLToPath(new URL("../assets/", import.meta.url));
const W = 720;
const H = 1280;

// Copy the binary to /tmp once per instance so it is certainly executable.
let ffmpegBin;
function getFfmpeg() {
  if (ffmpegBin) return ffmpegBin;
  const target = path.join(os.tmpdir(), "ffmpeg-bin");
  if (!fs.existsSync(target)) {
    fs.copyFileSync(ffmpegStatic, target);
    fs.chmodSync(target, 0o755);
  }
  ffmpegBin = target;
  return ffmpegBin;
}

async function durationOf(bin, file) {
  try {
    await run(bin, ["-hide_banner", "-i", file]);
  } catch (e) {
    // ffmpeg exits non-zero when no output is given, but still prints the duration
    const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(String(e.stderr || ""));
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  return 6;
}

// light per-IP throttle (best effort)
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (recent.length >= 20) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  const clips = Array.isArray(body?.clips) ? body.clips.slice(0, 3) : [];
  if (!clips.length || !clips.every((c) => isOurBlobUrl(c?.url))) {
    return res.status(400).json({ error: "Bad clips" });
  }
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return res.status(429).json({ error: "Too many requests" });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stitch-"));
  try {
    const bin = getFfmpeg();

    // 1. download the clips
    const files = [];
    for (let i = 0; i < clips.length; i++) {
      const r = await fetch(clips[i].url);
      if (!r.ok) throw new Error(`clip ${i} download ${r.status}`);
      const f = path.join(dir, `c${i}.mp4`);
      fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
      files.push(f);
    }

    // 2. captions on the joined timeline
    const segments = [];
    let t = 0;
    for (let i = 0; i < files.length; i++) {
      const d = await durationOf(bin, files[i]);
      segments.push({ start: t, duration: d, line: String(clips[i].line || "").slice(0, 200) });
      t += d;
    }
    const assFile = path.join(dir, "caps.ass");
    fs.writeFileSync(assFile, buildAss(segments));

    // 3. one ffmpeg pass: normalize, concat, frame, captions
    const n = files.length;
    const parts = [];
    for (let i = 0; i < n; i++) {
      parts.push(
        `[${i}:v]fps=24,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[v${i}]`,
        `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`
      );
    }
    const inputs = Array.from({ length: n }, (_, i) => `[v${i}][a${i}]`).join("");
    parts.push(
      `${inputs}concat=n=${n}:v=1:a=1[vc][aout]`,
      // brand frame: Sunset outer ring, Afterglow inner ring, then captions
      `[vc]drawbox=x=0:y=0:w=iw:h=ih:color=0xFD96C9:t=18,drawbox=x=18:y=18:w=iw-36:h=ih-36:color=0x813FE8:t=6,subtitles='${assFile}':fontsdir='${ASSETS}'[vout]`
    );
    const out = path.join(dir, "out.mp4");
    const args = ["-y", "-hide_banner", "-loglevel", "error"];
    files.forEach((f) => args.push("-i", f));
    args.push(
      "-filter_complex", parts.join(";"),
      "-map", "[vout]", "-map", "[aout]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
      out
    );
    await run(bin, args, { maxBuffer: 10 * 1024 * 1024, timeout: 50_000 });

    // 4. save and return
    const saved = await saveVideo(fs.readFileSync(out), "videos/jotpsych-feature-video.mp4");
    if (!saved) return res.status(501).json({ error: "No storage configured (add a Blob store)" });
    return res.status(200).json(saved);
  } catch (err) {
    console.error("stitch error:", String(err?.stderr || err?.message || err).slice(0, 600));
    return res.status(500).json({ error: "Could not prepare the download" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
