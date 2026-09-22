# Gateway model integration contracts

Checked on 2026-09-22 against the live public Gateway catalog, Gateway endpoint metadata, Vercel documentation, and the AI SDK source. Scope is the verified Melius matches in [the catalog report](vercel-ai-gateway-catalog-2026-09-22.md), plus the existing Kousa models. This document records integration evidence. It does not claim that a paid generation was run for every model.

Kousa has AI SDK 7.0.105 and Gateway 4.0.85 installed. The upstream source reviewed was commit `4e8c387622ee1bb0d55841664416d38754d5c9a3`. Gateway executes provider adapters remotely, so local support for a request shape does not by itself establish that every upstream feature has reached Gateway.

## Request families

| Family | SDK call | Model factory | Output |
| --- | --- | --- | --- |
| Text | `generateText` | `gateway(modelId)` | `result.text` |
| Image model | `generateImage` | `gateway.imageModel(modelId)` | `result.images`, binary bytes and MIME type |
| Nano Banana image | `generateText` | `gateway(modelId)` | Image entries in `result.files` |
| Video | `experimental_startVideo`, then `getVideoStatus` | `gateway.videoModel(modelId)` | Opaque operation, then pending/error/completed result |
| Speech | `generateSpeech` | `gateway.speechModel(modelId)` | `result.audio`, bytes and MIME type |

Use the catalog's type together with an explicit strategy. A language model with image output must not accidentally appear in the text-only picker. Gemini Omni is another language-type entry, but its Gateway video request contract is unresolved below. [Gateway image guide](https://vercel.com/docs/ai-gateway/modalities/image-generation/ai-sdk), [video guide](https://vercel.com/docs/ai-gateway/modalities/video-generation), [speech guide](https://vercel.com/docs/ai-gateway/modalities/text-to-speech).

Text models can use Kousa's existing `generateText` path. Keep its output cap and avoid adding universal temperature, reasoning, or system-message parameters: providers differ. The public catalog publishes supported parameters, context window, and maximum output tokens. Nova Micro/Lite remain valid existing models. [Public catalog](https://ai-gateway.vercel.sh/v1/models).

## Image profiles

The standard image interface accepts a text prompt or `{ text, images: [bytesOrURL] }`. Editing support is model-specific. The SDK may warn and drop unsupported input instead of throwing, so validate the selected model before making a billable request. [Image API](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-image).

| Gateway IDs | Dimensions and options | Reference input |
| --- | --- | --- |
| `openai/gpt-image-2` | Use `1024x1024`, `1536x1024`, or `1024x1536`. `providerOptions.openai.quality` accepts low/medium/high/auto. Melius's three quality labels are one model with different settings. | `prompt.images`; PNG/WebP/JPEG, each under 50 MB. |
| `openai/gpt-image-2.5-flare`, `openai/gpt-image-2.5-sunburst` | Standard presets or custom width/height. Each dimension must be divisible by 16; ratio 1:3 through 3:1; longest edge at most 3840; total area 655,360 through 8,294,400 pixels. Above 2560x1440 is experimental. Extra qualities xhigh/max exist. | `prompt.images`; editing and masks supported. |

OpenAI uses `size`, not the generic `aspectRatio` parameter. A global 1024x576 choice is invalid for GPT Image 2 and falls below GPT Image 2.5's minimum pixel area. PNG is a useful common output; use `providerOptions.openai.outputFormat`. [OpenAI SDK image documentation](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/content/providers/01-ai-sdk-providers/03-openai.mdx), [image option schema](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/packages/openai/src/image/openai-image-model-options.ts).

| Gateway IDs | Dimensions and options | Reference input |
| --- | --- | --- |
| `bytedance/seedream-4.5` | Native tiers 2K/4K; JPEG output. | Up to 14 images. |
| `bytedance/seedream-5.0-lite` | Native tiers 2K/3K/4K; JPEG/PNG. | Up to 14 images. |
| `bytedance/seedream-5.0-pro` | Native tiers 1K/2K; JPEG/PNG. | Up to 10 images. |

Seedream accepts explicit `size: '2048x2048'` or `providerOptions.bytedance.size: '2K'`. The native tier overrides explicit size. Do not supply both expecting a tier and aspect ratio to combine. The adapter ignores generic `aspectRatio`; use approved pixel dimensions when preserving an output ratio. References go in `prompt.images`. Seed and masks are unsupported. [ByteDance SDK documentation](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/content/providers/01-ai-sdk-providers/85-bytedance.mdx), [adapter](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/packages/bytedance/src/bytedance-image-model.ts).

| Gateway IDs | Dimensions and options | Reference input |
| --- | --- | --- |
| `bfl/flux-2-klein-4b` | Width/height divisible by 16, minimum 64 on each side, maximum 4 MP. Set `providerOptions.blackForestLabs.width` and `.height`. | `prompt.images`, maximum 4. |
| `bfl/flux-2-max` | Same FLUX.2 dimension rules. | `prompt.images`; do not use the adapter's generic maximum as proof of the model's exact reference limit. One connected image is supported. |
| `bfl/flux-pro-1.1-ultra` | Use `aspectRatio`; supported range 9:21 through 21:9. | Its native image prompt is `providerOptions.blackForestLabs.imagePrompt`, with `imagePromptStrength` from 0 to 1. Generic `prompt.images` maps to a different native field and is not the verified Ultra path. |
| `prodia/flux-fast-schnell` | `size` maps to width/height. | Text-to-image only in the reviewed Prodia adapter; reference files are not consumed. |

The BFL adapter accepts `size` but warns that it derives a ratio; explicit BFL width/height options remove that ambiguity for FLUX.2. Ultra uses a different native request schema. [BFL dimension limits](https://help.bfl.ai/articles/8916739058-what-aspect-ratios-and-output-dimensions-are-supported), [Klein constraints](https://help.bfl.ai/articles/7592221790-how-do-i-generate-quickly-with-flux-2-klein), [Ultra API](https://docs.bfl.ai/flux_models/flux_1_1_pro_ultra_raw), [BFL adapter](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/packages/black-forest-labs/src/black-forest-labs-image-model.ts), [Prodia adapter](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/packages/prodia/src/prodia-image-model.ts).

| Gateway IDs | Dimensions and options | Reference input |
| --- | --- | --- |
| `recraft/recraft-v4.1` | Square 1024x1024; landscape 1344x768; portrait 768x1344; 4:3 1216x896. | No verified V4.1 image-editing request through Gateway. Expose text-to-image. |
| `recraft/recraft-v4.1-pro` | Square 2048x2048; landscape 2688x1536; portrait 1536x2688; 4:3 2432x1792. | Same restriction. |
| `meta/muse-image-1.0` | The Vercel example omits size; no exact custom size list was verified. Use provider default until dimensions are documented. | Vercel explicitly demonstrates `prompt.images` editing and multiple reference images. |
| `spacexai/grok-imagine-image`, `spacexai/grok-imagine-image-2.0` | Use `aspectRatio`; generic `size` and seed are unsupported. Provider options are under `xai`, despite the Gateway ID prefix. | `prompt.images` selects the image-edit endpoint. Masks unsupported. |

Recraft supports additional exact sizes listed in its appendix. Do not substitute generic 1024x576 or 2560x1440 dimensions. V4.1 is documented as text-to-image; Recraft's separate editing API is not evidence for a Gateway V4.1 editing contract. [Recraft dimensions](https://www.recraft.ai/docs/api-reference/appendix), [V4.1 model](https://www.recraft.ai/docs/recraft-models/recraft-v4-1), [Muse Gateway example](https://vercel.com/changelog/muse-image-now-available-on-ai-gateway), [xAI image adapter](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/packages/xai/src/xai-image-model.ts).

The xAI adapter accepts `providerOptions.xai.resolution` as `1k` or `2k` and quality settings, but verify the selected model's support before exposing these. A provider adapter accepting an option does not establish every model's range. Default aspect-ratio generation is the conservative common path. [xAI image options](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/packages/xai/src/xai-image-model-options.ts).

### Nano Banana

Use `google/gemini-3.1-flash-image`, `google/gemini-3.1-flash-lite-image`, or `google/gemini-3-pro-image` with `generateText`. References are user-message image parts. Configure `providerOptions.google.imageConfig` with `aspectRatio` and `imageSize`; optionally set `responseModalities: ['TEXT', 'IMAGE']`. Read image MIME entries from `result.files`, and fail clearly if none were generated. [Gateway image guide](https://vercel.com/docs/ai-gateway/modalities/image-generation/ai-sdk), [Google option schema](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/packages/google/src/google-language-model-options.ts).

Use 1K as the shared initial profile. Nano Banana 2 also supports 512/2K/4K; Pro supports 1K/2K/4K; the Lite entry advertises 1K. The direct Google SDK now has an image wrapper, but that does not verify `gateway.imageModel` for these language-type IDs. The documented Gateway language call is the reliable route. [Google SDK image models](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/content/providers/01-ai-sdk-providers/15-google.mdx), [Lite endpoint](https://ai-gateway.vercel.sh/v1/models/google/gemini-3.1-flash-lite-image/endpoints).

### Arrow SVG output

`quiverai/arrow-1.1` returns `image/svg+xml`; the SDK response schema fixes this MIME type. There is no raster output option in the reviewed contract. It supports up to four references; generic size/aspect ratio are unsupported. Do not label the SVG bytes as PNG. [Quiver SDK adapter](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/packages/quiverai/src/quiverai-image-model.ts), [Quiver documentation](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/content/providers/01-ai-sdk-providers/180-quiverai.mdx).

For Kousa's existing raster media pipeline, render SVG to PNG in the worker before upload. `@cf-wasm/resvg` 0.4.0 documents a Cloudflare Workers entrypoint, `@cf-wasm/resvg/workerd`, and `await Resvg.async(svg, options)`. Render with `.render().asPng()` and release WASM handles. Bound input bytes and output dimensions; do not add network fetching for resources embedded in SVG. Verify the Wrangler WASM bundle in the worker environment. [Maintainer's Workers instructions](https://github.com/fineshopdesign/cf-wasm/tree/main/packages/resvg), [resvg WASM API](https://github.com/thx/resvg-js/tree/main/wasm), [Cloudflare WASM runtime](https://developers.cloudflare.com/workers/runtime-apis/webassembly/javascript/).

## Video profiles

`experimental_startVideo` accepts `prompt`, `duration`, `aspectRatio`, `resolution: 'WIDTHxHEIGHT'`, `frameImages`, `inputReferences`, `generateAudio`, and `providerOptions`. A starting image goes in `prompt: { text, image }`. First/last frames use `frameImages: [{ frameType: 'first_frame', image }, { frameType: 'last_frame', image }]`. References use `inputReferences: [url]` or `[{ data: imageBytes, mediaType: 'image/png' }]`. These inputs describe different operations and must not be interchanged. [Start-video API](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/packages/ai/src/generate-video/start-video.ts).

Persist the returned `operation` unchanged along with the exact model ID and request settings. Poll `getVideoStatus` with that same model and operation. A completed response may contain a URL, base64 bytes, or binary bytes. Keep Kousa's bounded, validated download and media-storage path. Do not translate opaque provider operations into an invented common task ID. [Status API](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/packages/ai/src/generate-video/get-video-status.ts).

The following limits come from live Gateway endpoint capabilities. They are provider limits, not a requirement to expose every duration in Kousa. An application can deliberately retain a smaller export/storage limit.

| Gateway IDs | Duration seconds | Resolution tiers | Operations verified |
| --- | --- | --- | --- |
| `bfl/flux-3-video` | 5 through 20 | hd, fhd | Text, first image, first+last frames, keyframes, extension. General edit unverified. |
| `minimax/minimax-h3` | 4 through 15 | 768p, 2k | Text, first image, first+last, references. |
| `minimax/minimax-h3-max` | 5 through 15 | 480p, 768p | Text, first image, first+last. No reference-to-video capability. |
| `google/veo-3.1-generate-001`, `google/veo-3.1-fast-generate-001` | 4, 6, 8 | 720p, 1080p, 4k in current endpoint metadata | Text, first image, first+last, references, extension. Higher-resolution/operation combinations need separate validation. |
| `bytedance/seedance-2.0` | 4 through 15 | 480p, 720p, 1080p, 4k in current endpoint metadata | Text, first image, first+last, references. |
| `bytedance/seedance-2.0-fast`, `bytedance/seedance-2.0-mini` | 4 through 15 | 480p, 720p | Same base generation operations. |
| `bytedance/seedance-2.5` | 4 through 30 | 480p, 720p, 1080p | Also advertises editing and extension. |
| `klingai/kling-v3.0-t2v`, `klingai/kling-v3.0-i2v` | 3 through 15 | 720p, 1080p, 4k | Separate text and image IDs; image ID also lists first+last and references. |
| `klingai/kling-v2.5-turbo-t2v`, `klingai/kling-v2.5-turbo-i2v` | 5, 10 | 720p, 1080p | Separate text and image IDs. |
| `alibaba/wan-v3.0-video` | 2 through 30 | 480p, 720p, 1080p | Text, first image, first+last, references. |
| `alibaba/wan-v2.7-t2v` | 2 through 15 | 720p, 1080p | Text only. |
| `alibaba/wan-v2.7-r2v` | 2 through 10 | 720p, 1080p | References only. |
| `spacexai/grok-imagine-video` | 1 through 15 | 480p, 720p | Text, first image, references, edit, extend. No last frame. |
| `spacexai/grok-imagine-video-1.5` | 1 through 15 | 480p, 720p, 1080p | Current SDK and metadata support text/image/reference generation. No verified edit/extend on 1.5. |
| `bytedance/seedance-v1.0-pro-fast` | 2 through 12 | Keep existing 480p profile | Existing Kousa model; text and first image. |

Capability sources are public at `https://ai-gateway.vercel.sh/v1/models/{creator}/{model}/endpoints`, for example [FLUX 3](https://ai-gateway.vercel.sh/v1/models/bfl/flux-3-video/endpoints), [H3](https://ai-gateway.vercel.sh/v1/models/minimax/minimax-h3/endpoints), [Veo](https://ai-gateway.vercel.sh/v1/models/google/veo-3.1-generate-001/endpoints), [Seedance 2.5](https://ai-gateway.vercel.sh/v1/models/bytedance/seedance-2.5/endpoints), [Wan 3](https://ai-gateway.vercel.sh/v1/models/alibaba/wan-v3.0-video/endpoints), [Grok 1.5](https://ai-gateway.vercel.sh/v1/models/spacexai/grok-imagine-video-1.5/endpoints). Read `data.capabilities`. Limits vary by operation; a union of advertised capabilities is not proof that every combination is valid.

### Provider options and resolution conversion

| Provider | Exact namespace and settings | Caveats |
| --- | --- | --- |
| BFL | `blackForestLabs.resolution: 'hd' | 'fhd'`; 1280x720/1920x1080 are standard equivalents. | Lower-side resolution mapping exists, but explicit tiers avoid rounding ambiguity. No custom FPS or seed. Audio defaults on. |
| MiniMax | `minimax.resolution: '480P' | '768P' | '2K'`. Use only the selected model's tiers. 1366x768 maps to 768P. | A starting frame controls its ratio; text generation requires a concrete ratio. H3 reference mode and frame mode cannot be mixed. |
| Google Veo | Google Vertex provider options use `vertex`. Standard SDK resolution is WxH. | Reference images must be bytes/base64 in the Gateway reference guide, even though model metadata also lists URLs. |
| ByteDance | `bytedance.resolution` uses native tiers such as `480p`/`720p`. | Preserve typed media for references so video/audio URLs are not mistaken for images. |
| Kling | `klingai.mode: 'pro'` for the Melius Pro choice; standard is `std`. | Route text and image requests to the corresponding model IDs. Do not map Turbo/Omni Melius labels to the base model. |
| Alibaba | `alibaba.ratio` supports concrete ratios; Wan 3 also supports `adaptive`. | Standard 1280x720/1920x1080 map to 720P/1080P. Wan 3's 480p mapping is **832x480**, not 854x480. |
| xAI | Current SDK uses `xai.resolution: '480p' | '720p' | '1080p'`, despite the Gateway creator prefix `spacexai`. | Reference mode is capped at 720p. Generic docs use `spacexai` in some examples; prefer standard request fields where possible until the deployed namespace is verified. |

Sources: [BFL video adapter](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/packages/black-forest-labs/src/black-forest-labs-video-model.ts), [MiniMax adapter](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/packages/minimax/src/minimax-video-model.ts), [Gateway reference guide](https://vercel.com/docs/ai-gateway/modalities/video-generation/reference-to-video), [ByteDance SDK](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/content/providers/01-ai-sdk-providers/85-bytedance.mdx), [Alibaba adapter](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/packages/alibaba/src/alibaba-video-model.ts), [xAI adapter](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/packages/xai/src/xai-video-model.ts).

### Operations that need distinct controls

- FLUX 3 keyframes use `providerOptions.blackForestLabs.keyframes`, up to ten images or timed `[seconds, image]` pairs. Three or more untimed frames require an explicit duration. Extension takes a video reference; do not call this generic editing. Keyframes and continuation cannot be combined.
- Wan 2.7 R2V needs `inputReferences`, not `prompt.image`. The new adapter builds native `input.media`. Wan 3 accepts first/last frames separately. Wan 2.7 always generates audio; Wan 3 has an audio toggle. Native `alibaba.media` overrides automatically built references, so use one path consistently.
- Grok base edit/extend use `xai.mode: 'edit-video' | 'extend-video'` and `xai.videoUrl`. Editing inherits duration, ratio and resolution; extension inherits ratio/resolution. Hide those settings when ignored. A last-frame image is not supported.
- H3 references support image/video input. H3 Max's two frame images are not arbitrary reference-to-video support. Audio references use `minimax.referenceAudioUrls` and require image/video context.

These are adapter-specific contracts, not additional model IDs. They require matching canvas inputs and validation before UI exposure. [BFL options](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/packages/black-forest-labs/src/black-forest-labs-video-model.ts), [Alibaba options](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/packages/alibaba/src/alibaba-video-model-options.ts), [xAI video documentation](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/content/providers/01-ai-sdk-providers/01-xai.mdx), [MiniMax video documentation](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/content/providers/01-ai-sdk-providers/33-minimax.mdx).

## Speech profiles

| Gateway ID | Voice and format | Delivery control |
| --- | --- | --- |
| `fish-audio/s2.1-pro` | Fish reference ID in `voice`; `providerOptions.fishAudio.referenceId` takes precedence. MP3/WAV/PCM/Opus. Speed 0.5 through 2.0. | No SDK `instructions` or language setting. Fish infers language and supports its own inline delivery tags. |
| `spacexai/grok-tts` | Voices `eve`, `ara`, `rex`, `sal`, `leo`; default `eve`. MP3/WAV/PCM/mulaw/alaw. Speed 0.7 through 1.5. Language code or `auto`. | `instructions` is unsupported. Documented tags include `[pause]`, `[laugh]`, and `<whisper>...</whisper>` inside text. |

Use MP3 as the shared output. Voice choices belong to their provider; a saved Fish voice must reset to a valid xAI voice after a model change. Do not prepend Fish-style arbitrary bracketed directions to Grok text. Either hide the freeform direction field or translate only documented supported controls. xAI options use the `xai` namespace, including `sampleRate`, `bitRate`, `optimizeStreamingLatency` and `textNormalization`. [Fish speech adapter](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/packages/fish-audio/src/fish-audio-speech-model.ts), [Fish guide](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/content/providers/01-ai-sdk-providers/190-fish-audio.mdx), [xAI speech adapter](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/packages/xai/src/xai-speech-model.ts), [xAI speech API](https://docs.x.ai/developers/model-capabilities/audio/text-to-speech).

Migrate saved `fish-audio/s2.1-pro-free` to the paid `fish-audio/s2.1-pro` ID with an explicit cost label. The free ID is absent from the public catalog and its endpoint query returned 404, even though its HTML model page remains accessible. Do not assume a stale page means a routable free model. [Paid endpoint](https://ai-gateway.vercel.sh/v1/models/fish-audio/s2.1-pro/endpoints), [catalog](https://ai-gateway.vercel.sh/v1/models).

## Unresolved or unavailable matches

`google/gemini-omni-flash-preview` exists and advertises video output. Its Gateway model page shows language calls, while its FAQ mentions video calls. The reviewed `google-language-model-options` allows only TEXT/IMAGE response modalities. Google's direct Interactions adapter has `responseFormat: [{ type: 'video', aspectRatio, resolution, duration, delivery }]`, but no documented Gateway switch to that adapter was found. Do not invent `responseModalities: ['VIDEO']` or a `videoConfig` setting. Keep Omni unavailable with this specific reason until a Gateway request/result contract is verified. [Gateway model](https://vercel.com/ai-gateway/models/gemini-omni-flash-preview), [Google language schema](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/packages/google/src/google-language-model-options.ts), [Interactions schema](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/packages/google/src/interactions/google-interactions-language-model-options.ts).

The full missing-model list remains in the catalog report. ElevenLabs Scribe is transcription, not a text-generation model. ElevenLabs music, effects, isolation and voice conversion are different operations from text-to-speech. Missing Melius providers or operations cannot be enabled by assigning a nearby Gateway model ID.

Conflicts to retain in validation decisions:

- Kling 2.5 endpoint metadata advertises generated audio, while SDK documentation ties the audio option to later Kling versions. Do not expose its audio toggle without a tested contract.
- Seedance 2.0 and Veo endpoint metadata lists more resolutions than older SDK prose. A conservative implemented profile can use 720p while later profiles validate the newer combinations.
- The older catalog report's caution on FLUX 3 extend/keyframes and Grok 1.5 generation is superseded by the newer SDK evidence above. FLUX 3 general editing and Grok 1.5 edit/extend remain unverified.

## Catalog discovery and verification

Use the public `/v1/models` catalog for IDs, model types, pricing, input/output media and supported parameters. Use each model's `/endpoints` response for capabilities and provider details. These are read-only public endpoints. `gateway.getAvailableModels()` uses a smaller SDK schema and discards capability fields, so it is insufficient for building settings forms. [Catalog API documentation](https://vercel.com/docs/ai-gateway/models-and-providers), [Gateway provider source](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/packages/gateway/src/gateway-provider.ts).

Validate model ID, operation, ratio, dimension, duration, reference kind/count and voice before reserving credits. Preserve warnings from the provider instead of silently claiming a requested setting succeeded. Tests should exercise one representative per distinct request strategy and reject incompatible combinations. A mocked adapter test proves request construction; only an authenticated generation proves the deployed Gateway accepts that model and option combination.

## Kousa implementation

The picker includes 65 reviewed entries across 17 provider labels: 24 Text, 19 Image, 20 Video, and 2 speech models under Audio. All are enabled except Gemini Omni, which displays its unresolved-contract reason. The registry in `packages/generation/src/model-data.json` deliberately excludes unrelated Gateway models. It preserves Nova Micro/Lite, FLUX.2 Klein 4B and Seedance 1.0 Pro Fast, and resolves the retired Fish free ID to S2.1 Pro. No new provider keys are required beyond the existing server-side Gateway key.

Canvas and Playground use provider groups and per-model settings. OpenAI images expose low/medium/high quality. Google images use the 1K profile, Seedream uses bounded 2K dimensions, Recraft uses its documented dimensions, and Arrow is rendered to PNG at 1024 pixels wide. Muse and Arrow use automatic source dimensions. GPT Image 2 is square-only because square is the only overlap between its presets and Kousa's current ratio choices. Video profiles expose supported ratios and durations up to Kousa's existing 12-second media limit. Native video audio is retained when present. Audio exposes the Fish and Grok voice lists separately; music and effects still require uploads.

The implemented canvas operations are text generation, text-to-image, one reference image where supported, text-to-video, one starting/reference image where supported, and text-to-speech. Keyframes, video editing/extension, multi-reference generation, and native music/effects operations are not added by this model expansion. The earlier research lists Melius models absent from Gateway; those cannot be activated through this integration.

Kousa credit quotes are application prices, separate from Gateway dollar billing. The existing default prices remain 1 credit for Nova, 3 for Klein, 2 for speech, and 2 per second for Seedance 1.0 Pro Fast. Other text quotes use the catalog rate with the bounded 12 KB input and 2,048 output-token budget, rounded up at 200 credits per provider dollar. Image and video profiles use explicit credit tiers in `model-catalog.ts`; OpenAI quality costs 20/40/80 credits. These are fixed app prices, not promises of exact provider cost. New model or pricing changes require reviewing these tiers. Credits remain reserved on acceptance, charged on success, and released on failure.

Image quality is saved in authored history and workflow plans, participates in freshness hashes, and survives canvas imports and collaborative edits. Server validation rejects unsupported model/settings/input combinations before reserving credits. Migration 0029 expands the video duration constraint to 1–12 seconds; the model-specific validator enforces the smaller allowed set.

Verification on 2026-09-22: all 559 workspace tests and all TypeScript checks passed. The Wrangler Worker build includes the WASM renderer. A local Workers runtime rendered a 160×90 SVG to a valid 1024×576 PNG and rejected invalid and extreme-dimension SVGs. Browser checks covered all four provider menus, image quality and quotes, Veo durations, Grok voice switching, the disabled Omni explanation, and a Canvas model/voice change surviving reload. Next.js reported no runtime errors. The development database migration applied successfully. No authenticated paid generations were run against the new models.

Kling uses `klingai.mode: pro` rather than the unsupported generic resolution option. Its image-to-video aspect ratio comes from the source image. MiniMax starting-image generation also inherits the image ratio. Kousa omits these ignored request fields and disables the ratio control when such a frame is connected. [Kling SDK adapter](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/packages/klingai/src/klingai-video-model.ts).
