# Narrated clips

Connect a Speech node's output to a Video node's **Audio** input. Open the Video settings, set **Narration start**, **Narration volume**, and **Original video volume**, then choose **Review clip → Create clip**. The review uses the saved project graph and freezes the selected files and settings. If they change before starting, review again.

Both nodes need completed media. Use their latest successful generation, choose an existing project file, or upload a supported MP4/MP3 through **Video source** or **Speech source**. **Add to canvas** in the media library supports images, videos, speech, and finished clips. Uploaded speech has no transcript; generated speech retains its saved script.

The export is H.264 MP4 with stereo AAC audio. The video stream is copied without re-encoding. Narration can start at any nonnegative offset before the video ends; volume ranges from 0% to 200%. Original audio is muted by default. Narration beyond the end is trimmed, and short narration leaves the remaining video playing. The clip keeps the source video's duration, dimensions, and frame rate. This version handles one video and one narration track, up to 12 seconds and 20 MiB per video.

Progress appears as Queued, Rendering, Saving, or Complete. Rendering runs on the server and survives closing the tab. Return to the Video node to preview/download the saved clip, or find it in the project media library. Inputs remain available. A new export is required to apply later edits. If a clip fails, its error is shown and the previous successful clip remains available.

Clip creation uses no AI generation credits. This does not mean hosted rendering is free: cloud compute and storage have their own billing. Owners and editors can create clips; viewers can see progress, play, and download finished clips. One active clip is allowed per project and per initiating user.

## How it relates to workflow runs

**Run workflow** and **Run to this node** generate AI outputs. Speech → Video Audio is a composition connection, so it does not cause an AI video model to consume audio, regenerate speech, or merge those two output selections. **All outputs** includes both the video and narration branches. After they finish, use **Create clip** to combine the saved results. Automatic composition inside a workflow run is future work.

## Local development

No new API keys or paid plan are needed locally. Install FFmpeg (including ffprobe) on PATH; on macOS:

```bash
brew install ffmpeg
pnpm dev
```

The local jobs script starts a Node renderer on `127.0.0.1:8790` along with the Worker on port 8787. Health checks disable starting clips if the renderer is unavailable. The dev processes must keep running; closing the browser is fine. Local R2 bytes remain under `apps/web/.wrangler/state`, alongside the existing development storage. Alchemy applies migration `0017_clip_composition` to development Neon.

Run the actual FFmpeg checks separately from the portable application suite:

```bash
pnpm test
pnpm --filter @kousa/jobs test:renderer
pnpm check-types
```

The renderer tests need FFmpeg/ffprobe. They check copied video bytes, AAC output, silence before the offset, half-volume amplitude, end trimming, padding, original soundtrack mixing/muting, and invalid media/settings. Application tests use isolated Postgres and local fixtures for permissions, private delivery, immutable inputs, stale previews, retries, expiry, concurrency, media publication, and unchanged AI balances.

## Production setup — deferred

Cloudflare Containers requires Workers Paid. No plan upgrade or deployment was performed for this feature. When ready:

1. Enable Workers Paid and the existing private R2 storage on the deployment account.
2. Ensure Docker is running on the deployment machine. Alchemy builds `apps/jobs/renderer/Dockerfile`, which installs Node and FFmpeg.
3. Set `CLIP_RENDERING_ENABLED=true` in `packages/infra/.env` for the deployment. It defaults to false so a normal deployment does not create paid renderer infrastructure implicitly.
4. Use the normal Alchemy deployment with the intended stage. Alchemy attaches the private `CLIP_RENDERER` container binding to the jobs Worker, with at most two instances. The container sleeps after one minute idle and has outbound internet disabled.
5. Verify an actual hosted export, close the tab while Rendering, return to the completed result, and check authorized playback/download and denial after project access is removed.

The renderer receives private media bytes from the jobs Worker. No public bucket, public media origin, browser credentials, new Gateway key, or separately exposed renderer endpoint is needed. Production must use the container binding; `CLIP_RENDERER_URL` in Wrangler is for loopback development only.

References: [Cloudflare Containers](https://developers.cloudflare.com/containers/) and [container pricing](https://developers.cloudflare.com/containers/pricing/).

## Persistence and recovery

Neon stores the job, initiating user, source asset IDs, reviewed input hash, and settings. The API derives the user from the session, validates project ownership of both media files, and rechecks editing access when starting. SQL serializes project claims and guards active-job limits. Reusing a request ID for different inputs or a different user is rejected.

Cloudflare Workflows owns the render and publish steps. A private R2 receipt allows publishing to retry without rendering again. Successful publication and job completion are atomic in Postgres and recheck current editing access. Normal completion removes the receipt; a three-day R2 lifecycle rule removes abandoned receipts under `clip-receipts/` only. Final assets are unaffected. Pending media reservations retain the existing project quota policy.

The existing fifteen-minute recovery scan redispatches unacknowledged jobs and marks failed/terminated workflows. Jobs expire after thirty minutes. Cloud failures can still require a new export; this is durable execution with bounded retries, not a guarantee of completion through every outage.

## Verification

September 17, 2026: the in-app browser uploaded local video and speech fixtures, connected Speech → Video Audio, saved a one-second delay and 50% narration volume, and created a private five-second MP4. The saved result remained available after reload. A second export used 75% narration volume; its tab was closed while the UI showed Rendering. Reopening showed Complete; the exported MP4 played to its five-second end without a media error and was reused as a new Video node. No AI request was sent; the displayed credit balance stayed at 458.

Cloudflare Container deployment and real Gateway speech/video generation remain separate checks. See [verification](verification.md).
