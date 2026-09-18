# Project media library and storage

## Generated media page

Open **Media** in the main navigation to browse generated images, videos, speech, and completed narrated clips at `/media`. The page combines your personal playground outputs with outputs from projects you currently own or belong to, including workflow results and files from older generations. Each stored file appears once within its project or playground library. Uploads and unfinished outputs are excluded.

Filter by media type, search filenames or project names, and use **Load more media** to reach older files. Results are ordered by file creation time, newest first. Open a preview to view an image or play video/audio, read saved speech or clip transcripts, download the file, or open its source project. Video and audio files load only when their preview is opened. All file delivery uses the existing private media routes.

The gallery checks current ownership and project membership on every request. Cursor pagination preserves database timestamp precision, and query caches are scoped to the signed-in account. No migration or new configuration is required.

Gallery tests cover personal and shared outputs, clip results, deduplication, revoked access, private metadata, filters, and pagination with equal timestamps and microseconds. API tests cover authentication and input validation. The local browser check verified existing project and playground files, filename search, empty results, type filters, image previews, and video loading.

## Project library

Open **Media library** in the canvas toolbar to browse this project's uploaded images, videos, speech, completed generations, and narrated clips. Filter by Images, Videos, or Speech, or search filenames. Click a thumbnail to preview an image or open a video/audio player. Each file has a download link and format, dimensions, duration (where applicable), and size. Media refreshes every ten seconds and when the library opens; Refresh also reloads it manually.

Owners and editors can use **Add to canvas** on any file to create a selected node of its media type referencing the same asset, without uploading or generating it again. The node uses the project media as its source and participates in shared saving and undo/redo. The 200-node limit still applies. Viewers can browse, preview, and download, but cannot add nodes. Video and speech sources can be combined using [Narrated clip](clip-composition.md).

Files remain in the library when their nodes are deleted. Speech previews include the script frozen at generation time, even if the source node has been edited or deleted. Deduplicated speech results appear once per file, with the most recently completed matching script. Only ready assets and successful speech scripts are listed; unfinished files stay hidden. Video/audio bytes are loaded when their preview is opened, rather than for every library card.

Use **Upload media**, drop files onto the canvas, or paste copied files while the canvas is focused to add media nodes. Node settings also support uploads and attaching existing project files. Images are PNG, JPEG, or WebP, limited to 10 MiB and 40 megapixels each. Saved speech is MP3 (up to 10 MiB and three minutes); video is H.264 MP4 with optional AAC audio (up to 20 MiB and twelve seconds). A project can reserve at most 100 media files or 100 MiB, including interrupted uploads. Uploads, browsing, downloads, and reusing an existing file do not spend generation credits. See [Canvas guide, uploads, and recovery](canvas-onboarding.md) for batch retries and undo behavior.

Owners and editors can upload and change attachments. Every metadata and file request checks current project membership; responses are private, non-cacheable, and served through authenticated Kousa routes. R2 has no public domain, public access, or browser credentials. SVG and mismatched image types are rejected. Image headers determine dimensions and type; this is not full pixel decoding or malware scanning.

## Storage usage and removal

The library shows reserved bytes and files against the project's 100 MiB and 100-file limits, including unfinished uploads and removals awaiting storage confirmation. Open **Usage & removal** on a file to see its shared canvas nodes, generation and workflow records, clip records, and retention reason. The check includes disconnected nodes, selected historical outputs, active jobs, and retained inputs. If the authoritative shared canvas cannot be read completely, removal stays disabled.

**Upload to library** saves a file without creating a node. An unused library upload can be permanently removed by an owner or editor after confirmation. The server rechecks current permissions and references before deleting it. The existing jobs worker checks every 15 minutes and removes confirmed, unused library uploads after seven days. Uploading the same file again restarts that interval.

Adding a file to the canvas or choosing it as a node source first retains it on the server. Retention survives deleting a node, replacing an attachment, undo, and offline edits. Run and clip records retain their inputs and outputs even after completion or failure. Files that predate lifecycle tracking also stay retained because older offline undo stacks cannot be inspected. This first version has no expiry for those retained files; a disconnected or deleted node is never enough to prove a file unused.

Canvas uploads, drops, and pastes retain files before returning them to the editor. Only explicit library uploads are eligible for unused-file cleanup. General interrupted-upload recovery and abandoned-generation cleanup remain follow-ups. An uncertain storage write reserves its space and prevents removal; temporary clip receipts continue to use their separate expiry policy.

## Local development

Run `pnpm dev` from the repository root. Alchemy applies migrations, including `0022_media_lifecycle`, before starting Next. OpenNext's platform proxy reads the `MEDIA` R2 binding from `apps/web/wrangler.jsonc`. Objects persist locally under `apps/web/.wrangler/state`; metadata stays in the configured development Neon database. Alchemy passes the existing `LIVEBLOCKS_SECRET_KEY` to both the web app and jobs worker for authoritative shared-canvas checks. No extra R2 access keys are needed.

Local media files survive a dev-server restart, but are not uploaded to Cloudflare. Do not remove `.wrangler/state` if you want to keep them. Another checkout or computer does not share these local files. If local files are lost, uploading the same original image restores the existing asset ID. Keep production and development databases separate; local objects are not automatically migrated on deployment. Clip composition adds migration `0017_clip_composition` and a local FFmpeg renderer; see its setup guide.

## Cloudflare deployment

`packages/infra/alchemy.run.ts` declares a private `media` R2 bucket and binds it as `MEDIA`. Alchemy generates a stage-specific physical bucket name; the Wrangler `kousa-media-local` name is only for local development. Nonempty bucket destruction is disabled. Application code accesses the native binding through `@kousa/env`; no S3 credentials or bucket secrets belong in `.env`.

Before a production deployment, enable R2 in the Cloudflare account used by Alchemy (Storage & databases → R2 → Overview). Cloudflare requires the R2 subscription checkout, which may request payment details. R2 includes monthly free usage and bills overages; it is separate from the Workers Paid subscription. Current terms: [R2 setup](https://developers.cloudflare.com/r2/get-started/) and [pricing](https://developers.cloudflare.com/r2/pricing/). The app's per-project quota is not an account-wide billing cap.

Use the normal Alchemy deployment so it creates the bucket and configures the binding. Deployment and account billing activation are not performed as part of local setup. Provisioning credentials must allow R2 bucket management.

## Data and retries

- Neon owns asset metadata; R2 owns bytes. Canvas/Yjs stores an `assetId` and output selection, independent of the storage provider and collaboration transport.
- Upload bytes are size-bounded while streaming, validated, and hashed on the server. A database function locks the project to serialize quota reservations and deduplicates by project and SHA-256.
- A reservation is `pending` until R2 finishes and the database confirms current editing permission. Generated images also finalize the generation credit charge in the same database transaction. Pending rows never appear in the library or file endpoint.
- Retrying the same file reuses the reservation and object key, including after an ambiguous network or database response. The service never deletes a possibly committed file on an uncertain result.
- Removing an attachment or deleting a node retains the file for other nodes and undo. Deletion claims serialize with upload reservations and attachment retention. Database triggers also protect media referenced by saved graphs and run/clip records.
- Removal marks metadata `deleting`, deletes R2 bytes, then marks it `deleted`. Failed or ambiguous deletion retains the quota reservation until a retry confirms removal. Deleted metadata stays as a tombstone to reject stale completions; reuploading creates a new asset ID.
- Library uploads record each in-flight storage write. A confirmed write clears its receipt; a failed or uncertain write remains protected. Pending reservations still count toward quotas. Multipart transfers and general interrupted-upload cleanup are later work.
- Current clients retain a file before attaching it. A library list requested by an older client conservatively retains its ready files before exposing IDs, protecting clients that attach files synchronously.

## Validation

`pnpm test` covers real Postgres migrations and store behavior in PGlite: permissions, cross-project isolation, quota concurrency, duplicate uploads, revoked editing access, interrupted writes, ambiguous completion, file validation, and private HTTP responses. Library tests cover mixed media listing, pending-file exclusion, private metadata filtering, revoked viewer access, and speech scripts after node deletion and deduplicated generation. Shared-document tests cover attachment synchronization, restore, and undo.

Lifecycle tests cover shared-canvas outages, historical selections, retained inputs and clip/workflow plans, concurrent attachment/removal, unfinished duplicate writes, legacy clients, seven-day cleanup, deletion retries, quota release, and stale writes against deleted assets. The September 18, 2026 in-app browser check covers usage display, retained-file protection, library-only upload and removal, and retention after canvas use and undo.

The September 17, 2026 in-app browser check verified existing image previews, filename search, media-type filters, empty search results, image reuse, synchronization to a second canvas session, and undo while retaining the stored file. MP3/MP4 delivery uses local fixtures in automated tests. Successful real speech/video provider generation and playback remain on the [deferred verification checklist](verification.md).
