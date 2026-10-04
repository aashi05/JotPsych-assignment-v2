// Caption helpers used when burning subtitles into the downloadable MP4.

// Greedy word-wrap into lines of at most `max` characters.
export function wrapWords(words, max = 20) {
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= max) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Split a spoken line into caption chunks of at most two short lines each.
export function chunkLine(text, max = 20) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const chunks = [];
  let group = [];
  for (const w of words) {
    const test = [...group, w];
    if (wrapWords(test, max).length > 2) {
      chunks.push(wrapWords(group, max).join("\\N"));
      group = [w];
    } else {
      group = test;
    }
  }
  if (group.length) chunks.push(wrapWords(group, max).join("\\N"));
  return chunks;
}

const pad = (n, w = 2) => String(n).padStart(w, "0");
export function assTime(sec) {
  const cs = Math.round(sec * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs % 100)}`;
}

const escapeAss = (s) => s.replace(/[{}]/g, "");

// segments: [{ start, duration, line }] on the final (concatenated) timeline.
// Colors are ASS &HAABBGGRR: Warm #FFF2F5 text on a Deep #1E125E box.
export function buildAss(segments) {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Liberation Sans,46,&H00F5F2FF,&H00F5F2FF,&H005E121E,&H00000000,-1,0,0,0,100,100,0,0,3,14,0,2,60,60,230,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const events = [];
  for (const seg of segments) {
    const chunks = chunkLine(escapeAss(seg.line));
    if (!chunks.length) continue;
    const a = seg.start + 0.4;
    const b = seg.start + Math.max(1.4, seg.duration - 0.4);
    const step = (b - a) / chunks.length;
    chunks.forEach((c, i) => {
      events.push(
        `Dialogue: 0,${assTime(a + i * step)},${assTime(a + (i + 1) * step)},Cap,,0,0,0,,${c}`
      );
    });
  }
  return header + events.join("\n") + "\n";
}
