# Project image storage

Select an Image node to upload a PNG, JPEG, or WebP, or attach an existing project image. Uploads are limited to 10 MiB and 40 megapixels each. A project can reserve at most 100 images or 100 MiB, including interrupted uploads. Uploads do not spend generation credits.

Owners and editors can upload and change attachments. Viewers can see previews. Every metadata and file request checks the current project membership; image responses are private, non-cacheable, and served through authenticated Kousa routes. R2 has no public domain, public access, or browser credentials. SVG and mismatched image types are rejected. Image headers determine dimensions and type; this is not full pixel decoding or malware scanning.

## Local development

Run `pnpm dev` from the repository root. Alchemy applies migrations, including `0007_project_media` and `0008_image_generation`, before starting Next. OpenNext's platform proxy reads the `MEDIA` R2 binding from `apps/web/wrangler.jsonc`. Objects persist locally under `apps/web/.wrangler/state`; metadata stays in the configured development Neon database. No extra environment variables or R2 access keys are needed.

Local image files survive a dev-server restart, but are not uploaded to Cloudflare. Do not remove `.wrangler/state` if you want to keep them. Another checkout or computer does not share these local files. If local files are lost, uploading the same original image restores the existing asset ID. Keep production and development databases separate; local objects are not automatically migrated on deployment.

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

`pnpm test` covers real Postgres migrations and store behavior in PGlite: permissions, cross-project isolation, quota concurrency, duplicate uploads, revoked editing access, interrupted writes, ambiguous completion, file validation, and private HTTP responses. Shared-document tests cover attachment synchronization, restore, and undo. Validate the native R2 binding with a browser upload, a second canvas tab, and a dev-server restart.
