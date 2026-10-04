# JotPsych Feature Shorts (v2)

One text box, one Go button, one vertical video. Type a JotPsych feature and get a short comedy video starring a talking animal, with a download button.

## What's new in v2
- **Download button:** after the video plays, the three clips are joined server-side (ffmpeg) into ONE vertical MP4 with captions burned in and a Sunset/Afterglow frame. Ready to upload to JotPsych's site.
- **App walkthrough scene:** scene 2 shows the animal presenting a stylized JotPsych-like app screen (deep indigo sidebar, blush-white note panel, pink record button, sections filling in) that illustrates the typed feature.
- **Progress bar** instead of "1/3 scenes".
- **Off-topic warning:** if the prompt does not look like a JotPsych feature (e.g. "a girl walking on a beach"), the page asks "Are you sure you want to proceed?" before any video money is spent.

## How it works
1. `POST /api/start` asks a Gemini text model for a 3-scene script AND whether the prompt is a feature. If not, it returns `needsConfirm` and starts nothing. Otherwise it starts 3 Veo 3.1 Lite jobs (9:16, 6s, 720p) and returns right away.
2. The page polls `GET /api/status` per scene. Finished clips are saved to Vercel Blob. The page plays them back to back with a caption track.
3. When all scenes are ready, the page calls `POST /api/stitch`, which downloads the clips, joins them with ffmpeg (bundled via `ffmpeg-static`), burns captions and the frame in, saves the MP4 to Blob, and returns a download link.

Cost per video: 3 x 6s x ~$0.05/s on Lite = about $0.90. The off-topic check and script cost fractions of a cent.

## Deploy (Vercel)
1. Push to GitHub, import in Vercel (Application Preset: Other, no build command).
2. Environment variable: `GEMINI_API_KEY`.
3. Storage -> Create -> Blob -> connect to the project (adds `BLOB_READ_WRITE_TOKEN`). **Blob is required for the download button.**
4. Redeploy. Settings -> Deployment Protection: make sure Vercel Authentication is off for Production.

## Notes
- If the stitched download fails, the page falls back to per-scene download links.
- `assets/font.ttf` is Liberation Sans Bold (SIL OFL), used for the burned-in captions.
