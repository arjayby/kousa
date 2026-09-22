# Node compatibility

Implemented September 22, 2026, using the [recorded Melius inspection](melius-model-research.md), the [expanded Gateway catalog](gateway-model-expansion.md), and Gateway's documented input contracts. All generation stays on Vercel AI Gateway. Connecting two node types is valid only when the selected destination model accepts that input.

| Destination | Accepted connections | Behavior |
| --- | --- | --- |
| Text | Text, Image, Video, Audio through Context | Up to eight connections. Media is delivered as typed message parts to models that accept it. Text-only models reject media before credits are reserved. |
| Image | Text prompt and Image references | Up to four references on reviewed model families. Models with a single-reference contract retain that limit. Reference order is preserved. |
| Video | Text prompt, starting frame, last frame, reference images, reference video, reference audio | Each port checks the selected model's capabilities, counts, duration, dimensions, and format limits. Models cannot combine frame mode and reference mode in this implementation. |
| Audio | Text script | Existing speech generation and uploaded audio remain available. Uploaded music and effects can feed Text analysis, supported Video reference inputs, or Clip soundtrack composition. |

Video nodes expose three outputs: Video, Last frame, and Audio. Last frame acts as an Image input. Audio acts as an Audio input. Both are extracted from the chosen saved MP4, including a pinned historical output. A silent video fails audio extraction before any provider submission. Last frame can feed another Video node's starting frame for continuation.

The Clip soundtrack input retains the existing Audio-node composition flow. It is separate from Reference audio, which conditions generation. A Video node's extracted audio can feed Reference audio or Text context; it cannot feed Clip soundtrack directly.

## Model-specific behavior

Text input support comes from the checked-in Gateway metadata. Gemini 3.6 Flash also accepts audio, as demonstrated by the [Gateway audio-input guide](https://vercel.com/docs/ai-gateway/inputs-and-tools/audio-input), despite that omission in the public model metadata. Video analysis uses models advertising video input, following the [Gateway video-input contract](https://vercel.com/docs/ai-gateway/inputs-and-tools/video-input). The canvas does not add PDF uploads in this pass.

Multiple image references use native image requests or the Google image-output language path. First/last frames use the AI SDK video frame contract. Reference images and video use typed reference inputs. Seedance reference audio, MiniMax H3 reference audio, and supported Wan audio inputs use their provider-specific options. The implementation gates these paths through the reviewed profiles in `packages/generation/src/model-catalog.ts` and `video-capabilities.json`.

The model selector remains available when a connection is incompatible, with a reason explaining which model capability is missing. Changing a model does not silently discard connections.

## Saved inputs and delivery

Single-node generation and workflow review resolve media to exact asset IDs and generation runs. Submission rejects stale reviewed inputs before reserving credits. Workflow plans preserve project assets, pinned history, and generated dependencies. Changes to source media or selected outputs invalidate downstream results.

Media reads require current project access. Video providers receive expiring, run-scoped URLs restricted to the saved input index. URLs stop working when the run finishes or expires. Google video reference inputs use bytes. Video media runs currently require a public HTTPS generation origin, including during local development.

Additional connected media has a 40 MB aggregate source limit. Reads are bounded to 10 MB per image/audio input and 20 MB per video input. The existing primary-image path keeps its own limit. Frame/audio extraction accepts the existing bounded H.264 MP4 format, at most 12 seconds and 1920 pixels per dimension, and returns at most 10 MB. Extraction uses the existing FFmpeg renderer with network protocols disabled.

Existing no-media snapshots and their freshness hashes retain their prior shape. Migration `0030_connected_media.sql` adds validation of frozen media references to the database claim and workflow-start functions. The local development migration has been applied.

Connected media changes the displayed credit reservation. Text quotes reserve an additional 16,384 input tokens per media item. Image and Video quotes multiply the existing application quote by one plus the additional media count. The legacy primary-image charge remains unchanged. These are conservative Kousa prices, not exact provider billing estimates.

## Remaining differences from Melius

- The reviewed Gateway catalog has no dedicated music, sound-effects, voice-changer, or voice-isolator models. Audio generation therefore remains speech. Audio-to-Audio transformations are unavailable.
- Transcription-specific models remain disabled. Supported multimodal Text models can analyze audio, but this is not a dedicated transcription workflow.
- Reference-video conditioning is implemented. Dedicated edit, extend, avatar, lip-sync, and motion-control operation selectors are not implemented.
- Masked image fill and vector-language image models remain disabled.
- Gateway model limits still apply. Melius's visible port layout does not establish that every Melius model accepts every combination either.

## Verification

Tests cover frozen media delivery, stale/foreign asset rejection before billing, workflow reuse, scoped URL authorization and expiry, model compatibility, ordered image references, video frame/reference request construction, and derived video outputs. FFmpeg tests exercise real last-frame and audio extraction and reject silent-video audio extraction.

The in-app browser check connected one saved video to Text twice, once as Video and once as Last frame, selected Gemini 3.6 Flash, and completed workflow review with a nine-credit reservation. The review was canceled without starting generation. Temporary connections, prompt, and model selection were restored. Next.js reported no runtime errors after the duplicate preview-key fix. No paid inference was submitted, so these checks establish request construction and local workflow behavior, not live quality or successful inference for every model.

The Video connection preview also rejected Reference audio for Seedance v1.0 Pro Fast with a model-specific explanation. Validation passed: 586 workspace tests, four FFmpeg renderer tests, all ten workspace TypeScript checks, Biome on all changed code, and the Wrangler Worker build.
