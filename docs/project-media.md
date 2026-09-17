# Project media library and storage

Open **Media library** in the canvas toolbar to browse this project's uploaded images and completed image, video, and speech generations. Filter by Images, Videos, or Speech, or search filenames. Click a thumbnail to preview an image or open a video/audio player. Each file has a download link and format, dimensions, duration (where applicable), and size. Media refreshes every ten seconds and when the library opens; Refresh also reloads it manually.

Owners and editors can use **Add to canvas** on an image to create a selected Image node referencing the same asset, without uploading or generating it again. The node uses the project image as its output and participates in shared saving and undo/redo. The 200-node limit still applies. Viewers can browse, preview, and download, but cannot add nodes. Video and speech reuse as canvas inputs is not supported yet.

Files remain in the library when their nodes are deleted. Speech previews include the script frozen at generation time, even if the source node has been edited or deleted. Deduplicated speech results appear once per file, with the most recently completed matching script. Only ready assets and successful speech scripts are listed; unfinished files stay hidden. Video/audio bytes are loaded when their preview is opened, rather than for every library card.

Select an Image node to upload a PNG, JPEG, or WebP, or attach an existing project image. Uploads are limited to 10 MiB and 40 megapixels each. Saved speech is MP3 (up to 10 MiB and three minutes); video is silent H.264 MP4 (up to 20 MiB and twelve seconds). A project can reserve at most 100 media files or 100 MiB, including interrupted uploads. Uploads, browsing, downloads, and reusing an existing image do not spend generation credits.

Owners and editors can upload and change attachments. Every metadata and file request checks current project membership; responses are private, non-cacheable, and served through authenticated Kousa routes. R2 has no public domain, public access, or browser credentials. SVG and mismatched image types are rejected. Image headers determine dimensions and type; this is not full pixel decoding or malware scanning.

## Local development

Run `pnpm dev` from the repository root. Alchemy applies migrations, including `0007_project_media` and `0008_image_generation`, before starting Next. OpenNext's platform proxy reads the `MEDIA` R2 binding from `apps/web/wrangler.jsonc`. Objects persist locally under `apps/web/.wrangler/state`; metadata stays in the configured development Neon database. No extra environment variables or R2 access keys are needed.

Local media files survive a dev-server restart, but are not uploaded to Cloudflare. Do not remove `.wrangler/state` if you want to keep them. Another checkout or computer does not share these local files. If local files are lost, uploading the same original image restores the existing asset ID. Keep production and development databases separate; local objects are not automatically migrated on deployment. The library needs no new environment variables or database migrations.

## Cloudflare deployment

`packages/infra/alchemy.run.ts` declares a private `media` R2 bucket and binds it as `MEDIA`. Alchemy generates a stage-specific physical bucket name; the Wrangler `kousa-media-local` name is only for local development. Nonempty bucket destruction is disabled. Application code accesses the native binding through `@kousa/env`; no S3 credentials or bucket secrets belong in `.env`.

Before a production deployment, enable R2 in the Cloudflare account used by Alchemy (Storage & databases → R2 → Overview). Cloudflare requires the R2 subscription checkout, which may request payment details. R2 includes monthly free usage and bills overages; it is separate from the Workers Paid subscription. Current terms: [R2 setup](https://developers.cloudflare.com/r2/get-started/) and [pricing](https://developers.cloudflare.com/r2/pricing/). The app's per-project quota is not an account-wide billing cap.

Use the normal Alchemy deployment so it creates the bucket and configures the binding. Deployment and account billing activation are not performed as part of local setup. Provisioning credentials must allow R2 bucket management.

## Data and retries

- Neon owns asset metadata; R2 owns bytes. Canvas/Yjs stores an `assetId` and output selection, independent of the storage provider and collaboration transport.
- Upload bytes are size-bounded while streaming, validated, and hashed on the server. A database function locks the project to serialize quota reservations and deduplicates by project and SHA-256.
- A reservation is `pending` until R2 finishes and the database confirms current editing permission. Generated images also finalize the generation credit charge in the same database transaction. Pending rows never appear in the library or file endpoint.
- Retrying the same file reuses the reservation and object key, including after an ambiguous network or database response. The service never deletes a possibly committed file on an uncertain result.
- Removing an attachment or deleting a node retains the file for other nodes and undo. Permanent asset deletion, orphan cleanup, uploads for video/audio, and large-file multipart transfers are later work. Pending reservations count toward quotas until recovered or explicitly cleaned up; there is no automatic cleanup job yet.

## Validation

`pnpm test` covers real Postgres migrations and store behavior in PGlite: permissions, cross-project isolation, quota concurrency, duplicate uploads, revoked editing access, interrupted writes, ambiguous completion, file validation, and private HTTP responses. Library tests cover mixed media listing, pending-file exclusion, private metadata filtering, revoked viewer access, and speech scripts after node deletion and deduplicated generation. Shared-document tests cover attachment synchronization, restore, and undo.

The September 17, 2026 in-app browser check verified existing image previews, filename search, media-type filters, empty search results, image reuse, synchronization to a second canvas session, and undo while retaining the stored file. MP3/MP4 delivery uses local fixtures in automated tests. Successful real speech/video provider generation and playback remain on the [deferred verification checklist](verification.md).
