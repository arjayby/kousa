# Melius models and a replacement catalog for Kousa

Inspected September 22, 2026, around 16:16–16:21 Asia/Manila. This is a catalog and integration comparison, not a quality benchmark.

Created one Text, Image, Video, and Audio node in the user's [Melius canvas](https://app.melius.com/projects/cb7399eb-ad1b-4347-bb47-6f50e4084ef2/canvas/b28b55c3-e596-4abe-8fa1-d8edf65fae02), expanded every provider submenu, and left the nodes arranged in a two-by-two layout. All four nodes persisted after reload. No generations were submitted. The visible balance was zero.

The tables below record the exact model labels exposed by that account. Provider means the brand grouping in Melius's menu; the UI does not establish which inference host Melius uses. Counts include quality presets and specialist operations as separate menu choices. They are not counts of unique underlying models.

| Node | Provider groups | Menu choices | Initial Auto selection |
| --- | ---: | ---: | --- |
| Text | 9 | 22 | Gemini 3.8 Flash |
| Image | 13 | 28 | Seedream 5.0 Pro |
| Video | 18 | 51 | Kling 3.0 Omni |
| Audio | 8 | 17 | ElevenLabs v3 |
| Total | 48 appearances across types | 118 | |

For every exact Gateway ID, match limitation, current price, and source, see the companion [Gateway comparison](vercel-ai-gateway-catalog-2026-09-22.md). The [public catalog snapshot](research/vercel-ai-gateway-catalog-2026-09-22.json) preserves the live response used for comparison.

## Text

All entries below were visible in the Text node's provider submenus. Source: the authenticated Melius canvas linked above.

| Provider | Models |
| --- | --- |
| OpenAI | GPT-6 Astra; GPT-5.6 |
| xAI | Grok 4.6; Grok 4.5 |
| DeepSeek | DeepSeek V4 Pro |
| Meta | Llama 4 Maverick |
| Anthropic | Claude Haiku 4.5; Claude Fable 5.1; Claude Fable 5; Claude Sonnet 5; Claude Opus 4.8; Claude Opus 5 |
| Mistral | Mistral Large 3 |
| Alibaba | Qwen 3.6 Plus; Qwen 3 VL 235B; Qwen 3.5 397B |
| Google | Gemini 3.1 Pro; Gemini 3.8 Flash; Gemini 3.7 Flash; Gemini 3.6 Flash; Gemini 3.5 Flash |
| ElevenLabs | ElevenLabs Scribe v2 |

Scribe is transcription, so copying this list into Kousa's text-generation selector would misrepresent what the existing provider can do. Melius's Text node also exposes Text, Image, and Video inputs. Kousa's current text adapter passes a plain string prompt.

## Image

All entries below were visible in the Image node's provider submenus. Source: the authenticated Melius canvas linked above.

| Provider | Models |
| --- | --- |
| OpenAI | GPT Image 2.5 Sunburst; GPT Image 2.5 Flare; GPT Image 2 (High); GPT Image 2 (Medium); GPT Image 2 (Low) |
| Microsoft | MAI Image 2.5; MAI Image 2.5 Pro |
| Google | Nano Banana 2; Nano Banana 2 Lite; Nano Banana Pro |
| Quiver | Arrow 1.1; Arrow 1.1 Max |
| Ideogram | Ideogram 4.0 |
| Alibaba | Qwen Image 3 |
| Meta | Muse Image |
| Black Forest Labs | Flux Schnell; Flux Pro 1.1 Ultra; Flux 2 Max |
| Bytedance | Seedream 4.5; Seedream 5.0 Lite; Seedream 5.0 Pro |
| Recraft | Recraft V4.1; Recraft V4.1 Pro |
| Luma | Uni-1.1 Max |
| Krea | Krea 2 Large; Krea 2 Medium |
| xAI | Grok Imagine; Grok Imagine Image 2.0 |

The UI spells the GPT Image 2 presets with parentheses around High, Medium, and Low. These are three menu options, not evidence of three separate model IDs. The default image node exposed aspect ratio and resolution, initially 16:9 and 2K, and Text/Image inputs.

## Video

All entries below were visible in the Video node's provider submenus. Source: the authenticated Melius canvas linked above.

| Provider | Models and operations |
| --- | --- |
| Black Forest Labs | Flux 3; Flux 3 Edit; Flux 3 Extend; Flux 3 Keyframes |
| MiniMax | MiniMax H3; MiniMax H3 Max; MiniMax H3 Max Turbo |
| Google | Veo 3.1; Veo 3.1 Fast; Gemini Omni Flash 1.1; Gemini Omni Flash |
| Bytedance | Seedance 2.0 Fast; Seedance 2.0; Seedance 2.0 Mini; Seedance 2.5 |
| OpenAI | Sora 2 |
| Kuaishou | Kling 3 Pro; Kling 3 Turbo Pro; Kling 3 Turbo Standard; Kling 3.0 Omni; Kling 2.5 Turbo; Kling Lipsync; Kling Avatar |
| Alibaba | Wan 3.0; Wan 3.0 Fast; Wan 2.7; Wan 2.2; Happy Horse 1.1 |
| Lightricks | LTX 2.3; LTX 2.3 Quality; LTX 2.5; LTX 2.5 Fast |
| xAI | Grok Imagine Video; Grok Imagine Video Edit; Grok Imagine Video 1.5; Grok Imagine Video Extend |
| Vidu | Vidu Q3 |
| Luma | Ray 3.2 |
| PixVerse | PixVerse v5.6 |
| MultiTalk | Infinitalk; AI Avatar |
| Creatify | Boreal |
| HeyGen | HeyGen Lipsync; HeyGen Digital Twin; HeyGen Avatar IV |
| Sync | Sync Lipsync v3; Sync Lipsync v2 Pro |
| VEED | VEED Fabric 1.0; VEED Lipsync v2 |
| Sonilo | Sonilo Video Music; Sonilo Video Sound Effects |

The default Kling 3.0 Omni node exposed Text, reference image, starting frame, last frame, Video, and Audio inputs, plus Video, Last frame, and Audio outputs. The initial duration was 3 seconds at 16:9. Many menu options carried a sound-generation icon. These controls describe offered workflows; no outputs or model quality were tested.

## Audio

All entries below were visible in the Audio node's provider submenus. Source: the authenticated Melius canvas linked above.

| Provider | Models and operations |
| --- | --- |
| ElevenLabs | ElevenLabs Turbo v2.5; ElevenLabs Multilingual v2; ElevenLabs v3; ElevenLabs v3 Conversational; ElevenLabs Sound Effects; ElevenLabs Music; ElevenLabs Voice Changer; ElevenLabs Voice Isolator |
| Bytedance | Seed Audio 1.0 |
| Fish Audio | Fish Audio S2.1 Pro |
| MiniMax | MiniMax Speech 2.8 HD; MiniMax Music 3 |
| Alibaba | Qwen3 TTS 1.7B |
| Google | Gemini 3.1 Flash TTS |
| xAI | xAI TTS v1 |
| Sonilo | Sonilo Sound Effects; Sonilo Video Sound Effects |

Melius calls this an Audio node because it includes speech, music, sound effects, and transformations. Kousa currently has Speech nodes with a script, voice, and delivery direction. Renaming the existing node alone would not add those workflows. The initial Melius voice was Rachel.

## What Kousa currently offers

The live catalog is much broader than our five configured choices. Source: [generation contracts](../packages/generation/src/contracts.ts).

| Type | Current IDs | Kousa charge |
| --- | --- | --- |
| Text | `amazon/nova-micro`, `amazon/nova-lite` | 1 credit |
| Image | `bfl/flux-2-klein-4b` | 3 credits |
| Speech | `fish-audio/s2.1-pro-free` | 2 credits |
| Video | `bytedance/seedance-v1.0-pro-fast` | 10 credits for 5 seconds; 20 for 10 seconds |

These Kousa credits are internal charges, separate from Vercel's USD costs. Nova and Klein are metered models that can use eligible free credits. They are not zero-cost models. Vercel's free tier provides $5/month for a subset of models; purchasing credits switches the account to its paid tier and ends that monthly allowance. [Vercel pricing](https://vercel.com/docs/ai-gateway/pricing).

The speech ID needs attention first. Vercel still has an old page advertising `fish-audio/s2.1-pro-free`, but it was absent from the live model list and its public endpoint-details route returned 404. The paid `fish-audio/s2.1-pro` is listed. This is an availability risk, not proof that a generation request fails. The investigation made no billable generation requests. [Old free model page](https://vercel.com/ai-gateway/models/s2.1-pro-free), [current paid model page](https://vercel.com/ai-gateway/models/s2.1-pro), [live model API](https://ai-gateway.vercel.sh/v1/models).

## Recommended replacement shortlist

I recommend a small paid catalog with a budget option per type. The recommendation is based on current availability, cost, and fit with the product. It is not a claim that these models won a quality test.

| Type | Suggested default | Additional choices | Reason |
| --- | --- | --- | --- |
| Text | `google/gemini-3.8-flash` | `anthropic/claude-sonnet-5`; `openai/gpt-6-astra`; keep Nova Micro as a budget option | Gives users the same mainstream families visible in Melius while keeping cost explicit |
| Image | `bytedance/seedream-5.0-lite` for initial evaluation | Keep `bfl/flux-2-klein-4b` for the already-verified reference-edit path; add `openai/gpt-image-2.5-flare`; evaluate Seedream 5.0 Pro | Adds current generation choices without discarding a working low-cost editor |
| Video | Evaluate `bytedance/seedance-2.0-mini` as the budget upgrade | `bytedance/seedance-2.0-fast`; `minimax/minimax-h3-max`; a Veo 3.1 option later | All appear in Melius and Gateway; validate output, parameters, and cost before replacing the current default |
| Speech | `fish-audio/s2.1-pro` | `spacexai/grok-tts` after adding provider-specific voices and direction handling | The paid Fish model is the closest listed successor to our existing integration |

All IDs in this table are in the retrieved [Gateway catalog](research/vercel-ai-gateway-catalog-2026-09-22.json). Exact prices and eligibility are in the [comparison report](vercel-ai-gateway-catalog-2026-09-22.md). Nano Banana 2 and Pro are worthwhile later options, but Gateway exposes them through the language-model image-output path; they need a separate implementation from our current `imageModel()` adapter. [Gateway image generation](https://vercel.com/docs/ai-gateway/modalities/image-generation).

These base rates show why the new catalog needs different Kousa credit charges. Text examples assume 1,000 input and 1,000 billed output tokens, without caching, tools, or other surcharges. Sources: the [live model API](https://ai-gateway.vercel.sh/v1/models) and its saved snapshot.

| Candidate | Base provider rate | Example cost |
| --- | --- | --- |
| Gemini 3.8 Flash | $0.75 input / $3.75 output per million tokens | $0.0045 for the text example |
| Claude Sonnet 5 | $2 input / $10 output per million tokens | $0.012 for the text example |
| GPT-6 Astra | $10 input / $50 output per million tokens at ordinary context lengths | $0.06 for the text example |
| Seedream 5.0 Lite | $0.035 per output image | $0.035 per output image |
| GPT Image 2.5 Flare | Catalog lists $5 input / $30 output per million tokens | Depends on image dimensions, quality, and billed tokens |
| Seedance 2.0 Mini | $3.50 per million video tokens without video input | Requires resolution/duration token calculation and minimums |
| Seedance 2.0 Fast | $5.60 per million video tokens without video input | Requires resolution/duration token calculation and minimums |
| MiniMax H3 Max | $0.05/second at 480p; $0.08/second at 768p | $0.25 for 5 seconds at 480p |
| Fish Audio S2.1 Pro / Grok TTS | $15 per million input characters | $0.015 for 1,000 characters |

If the goal is strictly zero provider cost, evaluate `inclusionai/ling-3.0-flash-vl` for text. Its live catalog rates are zero, but we have not tested its quality. No currently listed zero-cost image, video, or speech model was established by this check. Empty pricing objects are missing pricing, not free usage. Free-tier eligibility also does not mean a zero unit price.

## Changes needed before switching the catalog

1. Replace the arrays in [contracts.ts](../packages/generation/src/contracts.ts) with a catalog that records model family, task, supported inputs, available settings, and price rules. Keep shared validation for canvas, playground, history, and workflow execution. Define explicit behavior for old saved model selections. `resolveTextModel()` currently remaps two older IDs to Nova Micro.
2. Reprice each model and its settings. The current one-price-per-type rules would charge the same Kousa credit for Nova Micro and GPT-6 Astra despite very different provider costs. Image quality/resolution and video duration/resolution/audio also need pricing rules before requests are reserved.
3. Update [gateway.ts](../packages/generation/src/gateway.ts) for provider-specific speech voices and instructions. Fish's bracketed delivery cues and voice IDs cannot be applied to every TTS provider. Handle Nano Banana image output separately if added.
4. Update [gateway-video.ts](../packages/generation/src/gateway-video.ts) and input validation for model-specific resolutions, durations, aspect ratios, audio, and reference inputs. The current request fixes `854x480`, accepts one starting image, and exposes 5 or 10 seconds. New video IDs are not automatic replacements for those settings.
5. Update the [canvas model selector](../apps/web/src/components/canvas/canvas-generation.tsx) and playground to group by provider/task, show cost, and remove the blanket free-credit description once paid choices appear. Keep speech, music, effects, and transcription distinct until each workflow exists.
6. Run a small set of representative generations before changing defaults: text prompt generation, reference-image editing, 5-second text-to-video and image-to-video, and short speech. Verify saved media, replay, credit charging, and old-canvas behavior. Speech and video currently still document pending real-provider verification in [speech generation](speech-generation.md) and [video generation](video-generation.md).

Gateway-only adoption will not reproduce all of Melius. Its ElevenLabs audio tools, music/effects tools, several image brands, avatar/lip-sync workflows, and some newer video variants have no matching entry in the retrieved catalog. Those need a separate provider integration or should remain absent from our picker. A missing catalog entry means it was not found in this snapshot; it does not establish that the vendor has no API.

This task changed research files and created the four requested Melius nodes. Kousa's runtime catalog and billing behavior remain unchanged.
