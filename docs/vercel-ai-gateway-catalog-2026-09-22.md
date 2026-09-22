# Vercel AI Gateway catalog comparison

Checked on September 22, 2026, approximately 08:20 UTC. This report compares the Melius model labels observed during this session with Vercel's public catalog. It also checks Kousa's current selections. No generation requests were made and no application code was changed.

The [normalized catalog snapshot](research/vercel-ai-gateway-catalog-2026-09-22.json) contains 380 entries, exact IDs, capabilities, original pricing fields, and selected model pages' Free Tier flags. The source is the unauthenticated [Gateway models API](https://ai-gateway.vercel.sh/v1/models), which Vercel documents for [model discovery](https://vercel.com/docs/ai-gateway/models-and-providers). An absent model below means absent from this public snapshot, not proof that another service cannot supply it.

## What matters for the current free models

Vercel distinguishes a model priced at zero from a paid model eligible for its $5 monthly free allowance. That allowance covers a subset of models, applies per team, and stops after the team purchases Gateway credits. Free accounts have lower per-model limits. Paid accounts can access the full catalog. [Vercel pricing](https://vercel.com/docs/ai-gateway/pricing)

Kousa currently exposes the following IDs in [generation contracts](../packages/generation/src/contracts.ts). App credit charges are Kousa's own units, not Vercel dollars.

| Node | Current Gateway ID | Current provider price | Free Tier eligible | Finding |
| --- | --- | --- | --- | --- |
| Text | `amazon/nova-micro` | $0.035 input / $0.14 output per million tokens | Yes | Low cost, not zero cost. |
| Text | `amazon/nova-lite` | $0.06 input / $0.24 output per million tokens | Yes | Low cost, not zero cost. |
| Image | `bfl/flux-2-klein-4b` | $0.014 per megapixel | Yes | API pricing object is empty; model page supplies the price. |
| Audio | `fish-audio/s2.1-pro-free` | Website says free | No | Missing from live API; its provider-endpoints API returns 404. Availability needs a real authenticated smoke test. |
| Video | `bytedance/seedance-v1.0-pro-fast` | $0.0097/s at 480p, $0.0206/s at 720p, $0.049/s at 1080p | No | Paid Gateway access already required. |

Sources: [Nova Micro](https://vercel.com/ai-gateway/models/nova-micro), [Nova Lite](https://vercel.com/ai-gateway/models/nova-lite), [FLUX klein 4B](https://vercel.com/ai-gateway/models/flux-2-klein-4b), [Fish free page](https://vercel.com/ai-gateway/models/s2.1-pro-free), [Fish free endpoint](https://ai-gateway.vercel.sh/v1/models/fish-audio/s2.1-pro-free/endpoints), [Seedance Pro Fast](https://vercel.com/ai-gateway/models/seedance-v1.0-pro-fast).

The Fish discrepancy should be addressed before adding more models. The live catalog and endpoint do contain `fish-audio/s2.1-pro`, at $15 per million input characters. Its description still mentions free access, but its pricing fields and public provider table say paid. Do not use descriptive marketing text as the billing authority. [Paid Fish endpoint](https://ai-gateway.vercel.sh/v1/models/fish-audio/s2.1-pro/endpoints), [paid model page](https://vercel.com/ai-gateway/models/s2.1-pro)

## Catalog coverage

The snapshot has 257 language entries, 33 image entries, 35 video entries, 6 speech entries, 8 transcription entries, 9 realtime entries, 26 embedding entries, 5 rerankers, and 1 evaluator. These counts include aliases and preview variants. Seven language entries also produce images, and one also produces video, so filtering solely by `type` omits useful models. These are counts computed from the [public API](https://ai-gateway.vercel.sh/v1/models).

Model creators and inference providers are different. For example, FLUX Schnell appears under Prodia's Gateway ID, and InclusionAI Ling can run on Novita. An exact ID match confirms the catalog entry, but a similar display label does not prove which version Melius runs. Vercel publishes separate lists of [model creators](https://vercel.com/ai-gateway/models/labs) and [inference providers](https://vercel.com/ai-gateway/models/providers).

## Melius text crosswalk

Rates below are the API's base input/output USD per million tokens, before cache, long-context, region, provider, and service-tier variations. All IDs and rates in this table come from the [Gateway models API](https://ai-gateway.vercel.sh/v1/models).

| Melius label | Gateway ID or finding | Input / output per 1M tokens |
| --- | --- | --- |
| OpenAI GPT-6 Astra | `openai/gpt-6-astra` | $10 / $50 |
| OpenAI GPT-5.6 | Ambiguous. Gateway has `openai/gpt-5.6-luna`, `openai/gpt-5.6-terra`, `openai/gpt-5.6-sol`; no bare `gpt-5.6` | Luna $0.20 / $1.20; Terra $2 / $12; Sol $4 / $20 |
| xAI Grok 4.6 | `spacexai/grok-4.6` | $2 / $6 |
| xAI Grok 4.5 | `spacexai/grok-4.5` | $2 / $6 |
| DeepSeek V4 Pro | `deepseek/deepseek-v4-pro` | $0.66 / $1.98 |
| Meta Llama 4 Maverick | `meta/llama-4-maverick` | $0.24 / $0.97 |
| Anthropic Claude Haiku 4.5 | `anthropic/claude-haiku-4.5` | $1 / $5 |
| Anthropic Claude Fable 5.1 | `anthropic/claude-fable-5.1` | $10 / $50 |
| Anthropic Claude Fable 5 | `anthropic/claude-fable-5` | $10 / $50 |
| Anthropic Claude Sonnet 5 | `anthropic/claude-sonnet-5` | $2 / $10 |
| Anthropic Claude Opus 4.8 | `anthropic/claude-opus-4.8` | $5 / $25 |
| Anthropic Claude Opus 5 | `anthropic/claude-opus-5` | $5 / $25 |
| Mistral Large 3 | `mistral/mistral-large-3` | $0.50 / $1.50 |
| Alibaba Qwen 3.6 Plus | `alibaba/qwen3.6-plus` | $0.50 / $3 |
| Alibaba Qwen 3 VL 235B | Instruct match: `alibaba/qwen3-vl-235b-a22b-instruct`, also aliased as `alibaba/qwen3-vl-instruct`. Thinking variant is `alibaba/qwen3-vl-thinking`. Melius label does not disambiguate. | Instruct $0.40 / $1.60; Thinking $0.40 / $4 |
| Alibaba Qwen 3.5 397B | No exact entry. `qwen3.5-plus` is not sufficient evidence of a match. | Unknown |
| Google Gemini 3.1 Pro | `google/gemini-3.1-pro-preview`; preview status differs from the Melius label | $2 / $12 |
| Google Gemini 3.8 Flash | `google/gemini-3.8-flash` | $0.75 / $3.75 |
| Google Gemini 3.7 Flash | `google/gemini-3.7-flash` | $0.75 / $3.75 |
| Google Gemini 3.6 Flash | `google/gemini-3.6-flash` | $0.75 / $3.75 |
| Google Gemini 3.5 Flash | `google/gemini-3.5-flash` | $1.50 / $9 |
| ElevenLabs Scribe v2 | No ElevenLabs entry. Transcription is a separate operation from text generation. | Not listed |

Gateway transcription alternatives include `fish-audio/transcribe-1`, `google/gemini-3.5-transcribe`, `google/gemini-3.5-transcribe-live`, `openai/gpt-4o-transcribe`, and `openai/gpt-4o-mini-transcribe`. These are alternatives, not Scribe replacements with identical behavior. [Catalog](https://ai-gateway.vercel.sh/v1/models)

## Melius image crosswalk

Per-image rates refer to catalog output charges and do not imply every request costs exactly that amount. Some models also charge for input, reference images, or different dimensions. [Catalog pricing fields](https://ai-gateway.vercel.sh/v1/models)

| Melius provider and model | Gateway mapping | Price or distinction |
| --- | --- | --- |
| OpenAI GPT Image 2.5 Sunburst | `openai/gpt-image-2.5-sunburst` | Token-priced; inspect dimensions and quality before estimating per image. |
| OpenAI GPT Image 2.5 Flare | `openai/gpt-image-2.5-flare` | Token-priced. |
| OpenAI GPT Image 2 High / Medium / Low | `openai/gpt-image-2` | One model with quality options, not three separate Gateway IDs. |
| Microsoft MAI Image 2.5 / 2.5 Pro | No matching entries | No Microsoft image creator in this snapshot. |
| Google Nano Banana 2 | `google/gemini-3.1-flash-image` | $0.045 at 512; $0.067 at 1K; $0.101 at 2K; $0.151 at 4K. |
| Google Nano Banana 2 Lite | `google/gemini-3.1-flash-lite-image` | $0.034 at 1K. |
| Google Nano Banana Pro | `google/gemini-3-pro-image` | $0.1344 at 1K/2K; $0.24 at 4K. |
| Quiver Arrow 1.1 | `quiverai/arrow-1.1` | $0.20 generation, $0.15 vectorization. |
| Quiver Arrow 1.1 Max | No exact entry | Arrow 2 and Arrow 2 Telos are newer, separately named models. |
| Ideogram 4.0 | No matching entry | No Ideogram creator in snapshot. |
| Alibaba Qwen Image 3 | No matching entry | Alibaba text and video support does not establish image support. |
| Meta Muse Image | `meta/muse-image-1.0` | $0.01/image; Melius label omits version. |
| BFL Flux Schnell | `prodia/flux-fast-schnell` | $0.001/image; supplied through Prodia. |
| BFL Flux Pro 1.1 Ultra | `bfl/flux-pro-1.1-ultra` | $0.06/image. |
| BFL Flux 2 Max | `bfl/flux-2-max` | Empty API price object; use model page. |
| ByteDance Seedream 4.5 | `bytedance/seedream-4.5` | $0.04/image. |
| ByteDance Seedream 5.0 Lite | `bytedance/seedream-5.0-lite` | $0.035/image. |
| ByteDance Seedream 5.0 Pro | `bytedance/seedream-5.0-pro` | $0.035/image plus listed input cost of $0.003/M tokens. |
| Recraft V4.1 | `recraft/recraft-v4.1` | $0.035/raster image; $0.08/vector illustration. |
| Recraft V4.1 Pro | `recraft/recraft-v4.1-pro` | $0.21/raster image; $0.30/vector illustration. |
| Luma Uni-1.1 Max | No matching entry | No Luma creator in snapshot. |
| Krea 2 Large / 2 Medium | No matching entries | No Krea creator in snapshot. |
| xAI Grok Imagine | `spacexai/grok-imagine-image` | $0.02/image; likely mapping given image node context. |
| xAI Grok Imagine Image 2.0 | `spacexai/grok-imagine-image-2.0` | Base $0.06; low quality $0.04; 2048 square $0.08 or $0.06 low quality. |

Sources: [full API](https://ai-gateway.vercel.sh/v1/models), [Flux Schnell pricing](https://vercel.com/ai-gateway/models/flux-fast-schnell), [GPT Image 2](https://vercel.com/ai-gateway/models/gpt-image-2).

## Melius video crosswalk

Several Melius choices describe an operation, such as edit or extend, rather than a separate base model. Do not count those as distinct missing models without checking the relevant Gateway operation. [Video generation documentation](https://vercel.com/docs/ai-gateway/modalities/video-generation)

| Melius provider and models | Gateway mapping or finding |
| --- | --- |
| BFL Flux 3 | `bfl/flux-3-video`. Public model page starts at $0.06/s. |
| BFL Flux 3 Edit / Extend / Keyframes | Base Flux 3 exists; these three named operations were not verified through Gateway. Do not promise operation parity from the base ID alone. |
| MiniMax H3 / H3 Max | `minimax/minimax-h3` / `minimax/minimax-h3-max`. |
| MiniMax H3 Max Turbo | No distinct Turbo entry. |
| Google Veo 3.1 / Veo 3.1 Fast | `google/veo-3.1-generate-001` / `google/veo-3.1-fast-generate-001`. |
| Google Gemini Omni Flash | `google/gemini-omni-flash-preview`; language-type model with video output. |
| Google Gemini Omni Flash 1.1 | No exact versioned entry. |
| ByteDance Seedance 2.0 Fast / 2.0 / 2.0 Mini / 2.5 | `bytedance/seedance-2.0-fast`, `bytedance/seedance-2.0`, `bytedance/seedance-2.0-mini`, `bytedance/seedance-2.5`. |
| OpenAI Sora 2 | No Sora entry. |
| Kuaishou Kling 3 Pro | `klingai/kling-v3.0-t2v` or `klingai/kling-v3.0-i2v`, with pro mode. Melius version label is less precise. |
| Kuaishou Kling 3 Turbo Pro / Turbo Standard / 3.0 Omni | No exact entries. Standard/pro modes on base Kling 3.0 do not prove Turbo or Omni parity. |
| Kuaishou Kling 2.5 Turbo | `klingai/kling-v2.5-turbo-t2v` or `klingai/kling-v2.5-turbo-i2v`. |
| Kuaishou Kling Lipsync / Avatar | No corresponding entries. |
| Alibaba Wan 3.0 | `alibaba/wan-v3.0-video`; Gateway also has a separately named `alibaba/wan-v3.0-video-prime`. |
| Alibaba Wan 3.0 Fast | No exact Fast entry. Do not substitute Prime by name alone. |
| Alibaba Wan 2.7 | `alibaba/wan-v2.7-t2v` or `alibaba/wan-v2.7-r2v`. |
| Alibaba Wan 2.2 / Happy Horse 1.1 | No matching entries. |
| Lightricks LTX 2.3 / 2.3 Quality / 2.5 / 2.5 Fast | No Lightricks or LTX entries. |
| xAI Grok Imagine Video | `spacexai/grok-imagine-video`. |
| xAI Grok Imagine Video Edit / Video Extend | Documented operations on `spacexai/grok-imagine-video`, not separate IDs. |
| xAI Grok Imagine Video 1.5 | `spacexai/grok-imagine-video-1.5`. Docs specify image-to-video; do not assume base model edit/extend behavior. |
| Vidu Q3 | No matching entry. |
| Luma Ray 3.2 | No matching entry. |
| PixVerse v5.6 | No matching entry. |
| MultiTalk Infinitalk / AI Avatar | No corresponding entries. |
| Creatify Boreal | No matching entry. |
| HeyGen Lipsync / Digital Twin / Avatar IV | No HeyGen entries. |
| Sync Lipsync v3 / v2 Pro | No corresponding entries. |
| VEED Fabric 1.0 / Lipsync v2 | No VEED entries. |
| Sonilo Video Music / Video Sound Effects | No Sonilo entries. These also require audio-for-video operations, not plain text-to-video. |

Sources: [API catalog](https://ai-gateway.vercel.sh/v1/models), [Flux 3](https://vercel.com/ai-gateway/models/flux-3-video), [Grok editing](https://vercel.com/docs/ai-gateway/modalities/video-generation/video-editing), [Grok extension and 1.5 limitations](https://vercel.com/docs/ai-gateway/modalities/video-generation/video-extension).

Selected video prices from the [API](https://ai-gateway.vercel.sh/v1/models), in USD per output second unless stated otherwise:

| Model | Price examples |
| --- | --- |
| Seedance v1.0 Pro Fast, current Kousa default | Kousa uses 480p at $0.0097/s: $0.0485 for 5 seconds or $0.097 for 10 seconds. The 720p option is $0.0206/s. |
| Seedance v1.5 Pro, inexpensive audio-capable alternative | 720p silent $0.0259/s; with audio $0.0518/s. |
| Seedance 2.0 | 480p/720p $7/M video tokens without video input or $4.30/M with video input; other tiers in snapshot. |
| Seedance 2.0 Fast | $5.60/M video tokens without video input or $3.30/M with video input. |
| Seedance 2.0 Mini | $3.50/M video tokens without video input or $2.10/M with video input. |
| Seedance 2.5 | 480p/720p $10.70/M video tokens without video input or $6.40/M with video input. |
| Veo 3.1 Lite | 720p silent $0.03/s; audio $0.05/s. |
| Veo 3.1 Fast | 720p/1080p silent $0.10/s; audio $0.15/s. |
| Veo 3.1 | 720p/1080p silent $0.20/s; audio $0.40/s. |
| Kling 2.5 Turbo | Standard $0.042/s; pro $0.07/s. |
| Kling 3.0 | Standard silent $0.168/s; pro silent $0.224/s; audio/voice-control cost more. |
| Wan 3.0 | 480p $0.05/s; 720p $0.10/s; 1080p $0.20/s. |
| Wan 2.7 | 720p $0.10/s; 1080p $0.15/s. |
| MiniMax H3 | 768p $0.08/s; 2K $0.13/s. |
| MiniMax H3 Max | 480p $0.05/s; 768p $0.08/s. |
| Grok Imagine Video | 480p $0.05/s; 720p $0.07/s. |
| Grok Imagine Video 1.5 | 480p $0.08/s; 720p $0.14/s; 1080p $0.25/s. |

Seedance 2.x token billing includes video input and output, with duration-related minimums. Do not apply the existing flat five/ten-second credit charge without a cost model. For video workflows, supported duration, resolution, references, audio, first/last frames, and editing depend on the provider. [Video documentation](https://vercel.com/docs/ai-gateway/modalities/video-generation)

## Melius audio crosswalk

| Melius provider and models | Gateway finding |
| --- | --- |
| ElevenLabs Turbo v2.5 / Multilingual v2 / v3 / v3 Conversational | No ElevenLabs speech entries. |
| ElevenLabs Sound Effects / Music / Voice Changer / Voice Isolator | No corresponding entries or verified operations. |
| ByteDance Seed Audio 1.0 | No matching entry. |
| Fish Audio S2.1 Pro | `fish-audio/s2.1-pro`, $15/M input characters. Free alias discrepancy described above. |
| MiniMax Speech 2.8 HD / Music 3 | No matching audio entries. MiniMax text/video presence does not establish these. |
| Alibaba Qwen3 TTS 1.7B | No matching entry. |
| Google Gemini 3.1 Flash TTS | No matching speech entry. Gemini Live and transcription models are different operations. |
| xAI TTS v1 | Likely `spacexai/grok-tts`, $15/M characters, five stock voices; Melius label does not prove exact version identity. |
| Sonilo Sound Effects / Video Sound Effects | No matching entries. |

All six dedicated Gateway speech models in the snapshot are `fish-audio/s1`, `fish-audio/s2-pro`, `fish-audio/s2.1-pro`, `openai/tts-1`, `openai/tts-1-hd`, and `spacexai/grok-tts`. All cost $15/M input characters except TTS-1 HD at $30/M. There is no music or sound-effect model in this snapshot. [API catalog](https://ai-gateway.vercel.sh/v1/models)

Speech is still marked beta, with gradual team access. Voice identifiers and controls depend on the provider. Unsupported options may produce warnings instead of errors. [Speech documentation](https://vercel.com/docs/ai-gateway/modalities/text-to-speech)

## Practical replacement shortlist

These are candidates for evaluation, not quality rankings. No prompt suite or generated output comparison was run.

| Goal | Candidate | Reason and constraint |
| --- | --- | --- |
| Truly zero-priced text | `inclusionai/ling-3.0-flash-vl` | $0 input/output, Free Tier eligible, 256K context, 32K max output, tools/reasoning and image/video input. Public endpoint is Novita. Evaluate creative writing before making it default. |
| Cheap general text within free allowance | `google/gemini-2.5-flash-lite` | $0.10/$0.40 per 1M tokens and Free Tier eligible. Kousa currently redirects this stored ID to Nova, so adding it back requires changing that migration logic. |
| Cheap paid general text | `openai/gpt-5.6-luna` | $0.20/$1.20 per 1M tokens. Not Free Tier eligible in checked provider table. |
| Melius-like premium text | `anthropic/claude-sonnet-5` or `google/gemini-3.8-flash` | Exact catalog matches. Budget each model separately. |
| Cheapest image drafts | `prodia/flux-fast-schnell` | $0.001/image and Free Tier eligible. Verify reference-image support before replacing the current editing model. |
| Melius image option within free allowance | `bytedance/seedream-4.5` | $0.04/image, Free Tier eligible, exact Melius match. |
| Modern paid image option | `google/gemini-3.1-flash-image` | Nano Banana 2 match, starting $0.045 at 512 and $0.067 at 1K. Requires a different request/result path from Kousa's existing image-only adapter. |
| Speech within free allowance | `spacexai/grok-tts` | $15/M characters, Free Tier eligible. 1,000 characters cost $0.015. Replace Fish-specific voice IDs and direction syntax. |
| Preserve current voice behavior | `fish-audio/s2.1-pro` | Same Fish family and current priced endpoint. Not Free Tier eligible; no assumption that zero-priced alias will work. |
| Cheap paid video with audio | `bytedance/seedance-v1.5-pro` | 720p with audio $0.0518/s; 5 seconds $0.259. The current fast model remains cheaper for silent drafts. |
| Melius-like video expansion | Seedance 2.0/2.5, Veo 3.1 Fast, Kling 3.0 | Strong catalog overlap; each requires different capability and pricing controls. |

Sources: [Ling model and provider details](https://vercel.com/ai-gateway/models/ling-3.0-flash-vl), [Gemini Flash Lite](https://vercel.com/ai-gateway/models/gemini-2.5-flash-lite), [GPT-5.6 Luna](https://vercel.com/ai-gateway/models/gpt-5.6-luna), [Flux Schnell](https://vercel.com/ai-gateway/models/flux-fast-schnell), [Seedream 4.5](https://vercel.com/ai-gateway/models/seedream-4.5), [Nano Banana 2](https://vercel.com/ai-gateway/models/gemini-3.1-flash-image), [Grok TTS](https://vercel.com/ai-gateway/models/grok-tts), [Seedance 1.5](https://vercel.com/ai-gateway/models/seedance-v1.5-pro).

The catalog's other zero-priced text entries are `inclusionai/ling-3.0-flash-fin`, `inclusionai/ling-3.0-flash-fin-free`, `inclusionai/ling-3.0-flash-sante`, `inclusionai/ling-3.0-flash-sante-free`, `inclusionai/ling-3.0-flash-vl-free`, and `poolside/laguna-s-2.1-free`. Fin and Sante specialize in finance and medicine; Laguna targets coding. They are less obvious defaults for a creative canvas. Ling Fin's price varies by provider, so a zero base rate is not a promise that every route is free. None of these rates promises a permanent promotion. [Catalog](https://ai-gateway.vercel.sh/v1/models)

## Changes needed beyond picker entries

1. Keep free-account eligibility, zero provider price, and Kousa app credits as separate model metadata. Do not label all allowance-eligible models "free" without explanation.
2. Replace the global flat cost assumption with model-specific estimates. Store pricing units and selected quality, dimensions, resolution, duration, audio, and operation where applicable.
3. Add a request strategy for multimodal image models. Nano Banana uses `generateText` or `streamText` and returns image files; Kousa currently always uses `generateImage` with `gateway.imageModel`. [Official image integration guide](https://vercel.com/docs/ai-gateway/modalities/image-generation/ai-sdk)
4. Give speech models their own voices and direction controls. The current [speech adapter](../packages/generation/src/gateway.ts) embeds Fish bracket cues; this is not a portable voice interface.
5. Preserve each video's supported operations. Adding a model ID does not add edit, extend, lip-sync, avatar, or music behavior. Kousa's current contract only allows a prompt, optional image, aspect ratio, and five/ten-second duration.
6. Remove or narrow `resolveTextModel`'s old-ID migration before restoring Gemini Flash Lite or GPT-4.1 Mini; otherwise persisted selections resolve back to Nova.

The public model APIs omit some prices, including FLUX megapixel and Prodia per-image charges. The catalog also gives incomplete image input capabilities for some image models. Use the model page and provider guide, then verify a small authenticated request for each chosen operation. An empty price object is never evidence of zero cost.

Free Tier flags in the snapshot come from the model pages' first provider table, including accessible `Free Tier: Yes/No` labels. These flags are not present in the public `/v1/models` payload. No account balance, authentication configuration, or team-specific availability was inspected.
