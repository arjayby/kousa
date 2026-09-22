# Gateway model expansion

Implemented on 2026-09-22 after the browser comparison with Melius. This pass expands the model choices beyond the original Melius matches, using Vercel AI Gateway only. It prepares model metadata for the next node-compatibility pass; it does not add new canvas connection types.

The reviewed [public Gateway catalog](https://ai-gateway.vercel.sh/v1/models) contains 380 entries. Kousa includes its 339 language, image, video, speech, and transcription entries. Embedding, reranking, realtime sessions, and evaluation models do not belong in these four node pickers. The snapshot is checked into `packages/generation/src/model-data.json`; newly published models are not enabled automatically.

| Picker | Selectable | Listed but unavailable | Total |
| --- | ---: | ---: | ---: |
| Text | 246 | 11 | 257 |
| Image | 37 | 3 | 40 |
| Video | 33 | 3 | 36 |
| Audio speech | 6 | 0 | 6 |
| Total | 322 | 17 | 339 |

The catalog spans 35 provider labels, with selectable models from 34. Perplexity remains unavailable pending reviewed quotes. Canvas and Playground share a searchable picker with provider groups and explicit unavailable explanations. Search matches model names, IDs, and provider names. Existing defaults remain Nova Micro, FLUX.2 Klein 4B, Seedance 1.0 Pro Fast, and Fish S2.1 Pro. Selecting GPT-4.1 Mini or Gemini 2.5 Flash Lite now preserves that actual model instead of silently replacing it with Nova.

## Generation contracts

The additional language models use the existing Gateway text route, with the smaller of Kousa's 2,048-token output limit and the published model maximum. Small-context models have a conservative UTF-8 input bound that reserves output and message overhead. Kousa still sends connected Text only.

Image alternatives include FLUX Kontext Pro/Max, additional FLUX.2 variants, Seedream 4, GPT Image 1/1 Mini/1.5, original Nano Banana, and Recraft variants. Kontext uses ratio plus reference-image input. Original Nano Banana omits the unsupported image-resolution setting. Older GPT Image models use the supported square preset. Recraft V2/V3 use their own dimensions and 1,000-character prompt limit; V4 Pro variants use their larger dimensions. [BFL SDK](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/content/providers/01-ai-sdk-providers/12-black-forest-labs.mdx), [Google SDK](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/content/providers/01-ai-sdk-providers/15-google.mdx), [Recraft dimensions and limits](https://www.recraft.ai/docs/api-reference/appendix).

Video alternatives include Wan 2.5/2.6 and Wan 3 Prime, Seedance 1.0 Pro/1.5 Pro, Veo 3/3 Fast/3.1 Lite, and Kling 2.6 text/image variants. They use the existing bounded text/image generation route, per-model dimensions and durations, and at most 12 seconds. The complete published video capability metadata is retained in `video-capabilities.json`; advertised operations do not automatically enable a canvas port. [Gateway video documentation](https://vercel.com/docs/ai-gateway/modalities/video-generation).

Audio now includes Fish S1, S2 Pro, S2.1 Pro, OpenAI TTS-1, TTS-1 HD, and Grok TTS. OpenAI uses Alloy, Echo, Fable, Onyx, Nova, and Shimmer. Fish models use Fish voice IDs; Grok uses its own voices. Separate voice direction is exposed only for Fish S2 models. Invalid voices and unsupported directions are rejected before submission. [Gateway speech documentation](https://vercel.com/docs/ai-gateway/modalities/text-to-speech), [Fish SDK](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/content/providers/01-ai-sdk-providers/190-fish-audio.mdx), [OpenAI SDK speech contract](https://github.com/vercel/ai/blob/4e8c387622ee1bb0d55841664416d38754d5c9a3/content/providers/01-ai-sdk-providers/03-openai.mdx#speech-models).

Every selectable model has a positive integer credit quote. New media models use explicit Kousa tiers. TTS-1 HD costs 4 credits, other speech models 2. These are application prices, not exact provider pass-through prices. Existing prices remain unchanged. The reservation, charge-on-success, and release-on-failure flow is unchanged.

## Remaining compatibility work

The following catalog entries remain disabled, including server-side validation before credit reservation:

- Eight transcription models need recorded-audio input and a transcription execution path.
- Kling 2.6/3 motion control need image and motion-reference video inputs.
- FLUX Fill needs a mask input.
- Arrow 2 and Arrow 2 Telos need a verified vector-language output workflow.
- Gemini Omni still lacks a verified Gateway video request contract.
- Three Perplexity models lack a reviewed credit quote in this public snapshot.

Multimodal Text inputs, multiple image references, first/last frames, video references/edit/extend, and separate video frame/audio outputs still require node and execution changes. Gateway's current catalog has no dedicated music, sound-effect, voice-changing, or voice-isolation models. This limits full Melius parity under the Gateway-only choice.

## Verification

Adapter tests exercise the new speech voices and delivery controls, Kontext requests, Nano Banana options, added video request profiles, unavailable-model rejection, valid settings for every enabled media model, and positive quotes for every selectable model. Generation service tests verify that selected GPT-4.1 Mini and Gemini Flash Lite IDs reach the provider unchanged. Canvas and Playground both reject prompts beyond small-model context bounds.

Browser checks cover all four pickers, search and empty results, OpenAI speech voices and the HD quote, hidden unsupported voice direction, unavailable motion-control explanations, and a Text model surviving reload. Test selections are restored afterward. Paid generations were not submitted; adapter tests verify request construction, not successful inference for every Gateway entry.

Validation passed: all 574 workspace tests, all workspace TypeScript checks, Biome checks on changed code, and the Wrangler Worker build. The running Next.js server reported no runtime or configuration errors after the Canvas and Playground checks.
