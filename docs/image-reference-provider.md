# Image references through AI Gateway

Verified September 20, 2026 using installed `ai@7.0.105`, installed `@ai-sdk/gateway@4.0.85`, official documentation, and a local request interception. No paid generation request was made.

Reuse `bfl/flux-2-klein-4b` and pass reference bytes through the standard image prompt object:

```ts
const result = await generateImage({
  model: gateway.imageModel("bfl/flux-2-klein-4b"),
  prompt: references.length
    ? { text: prompt, images: references.map((reference) => reference.bytes) }
    : prompt,
  size: "1024x1024",
  n: 1,
});
```

Here `reference.bytes` is a `Uint8Array` read by the server from authorized private storage. The SDK sends those bytes in the request; it does not require a publicly accessible image URL. This avoids publishing a storage URL, though the selected provider still receives the reference content for inference.

Evidence for the adapter:

- The installed SDK's `GenerateImagePrompt` accepts a string or `{ images: Array<DataContent>; text?: string; mask?: DataContent }`. `normalizePrompt` converts each image to an `ImageModelV4File`; byte content becomes a file with an inferred image MIME type. [SDK source](/Users/arj/100k/kousa/packages/generation/node_modules/ai/src/generate-image/generate-image.ts:59)
- The installed Gateway adapter includes `files` in the JSON request and converts `Uint8Array` data to base64. It posts to `/v4/ai/image-model`, with the model ID in headers. [Gateway source](/Users/arj/100k/kousa/node_modules/.pnpm/@ai-sdk+gateway@4.0.85_zod@4.5.4/node_modules/@ai-sdk/gateway/src/gateway-image-model.ts:57)
- A local test called the real installed SDK and Gateway adapter with a custom `fetch` that intercepted every request. A one-pixel PNG arrived as `{ type: "file", mediaType: "image/png", data: "<base64>" }`, with byte-for-byte identical content, the text prompt, size and `n: 1`. The mock returned a synthetic response. This verifies client serialization, not a live Gateway-to-BFL inference.
- Vercel's model page explicitly supports image editing and multi-reference generation, and its hosted playground accepts up to four reference images. Gateway documentation also states that image editing is supported. [Klein model page](https://vercel.com/ai-gateway/models/flux-2-klein-4b), [Gateway image capabilities](https://vercel.com/docs/ai-gateway/modalities/image-generation)

Do not add BFL's native `input_image` fields to `providerOptions` for this adapter. Those are the direct BFL REST API shape. The standard `prompt.images` path already reaches Gateway as image files. No direct BFL credential is needed. [Direct BFL endpoint](https://docs.bfl.ml/api-reference/models/generate-or-edit-an-image-with-flux2-%5Bklein%5D-4b), [Vercel model authentication](https://vercel.com/ai-gateway/models/flux-2-klein-4b)

Constraints and implementation implications:

- Klein supports up to four reference images, minimum 64×64, output up to 4MP, and dimensions in multiples of 16. Keeping the current 1024×1024 output is within these limits. A first release can enforce one reference as an application scope choice. [BFL Klein guide](https://help.bfl.ai/articles/7592221790-how-do-i-generate-quickly-with-flux-2-klein)
- The 4MP limit is an image resolution constraint, not an encoded file-size allowance. BFL documents automatic resizing for input images over 4MP; Kousa should retain its own byte-size and supported-format validation. [BFL resolution guidance](https://help.bfl.ai/articles/8531149640-what-are-the-resolution-limits)
- Reference-guided editing does not establish mask-based inpainting support. Although the SDK accepts `mask`, do not expose that for Klein without separate verification; Vercel points to FLUX.1 Fill Pro for masked region editing. [Model guidance](https://vercel.com/ai-gateway/models/flux-2-klein-4b)
- Free Gateway credits currently cover only eligible models, with lower rate limits. The pricing page documents $5 monthly credit for the free tier and says purchasing credits moves the account to the paid tier. Klein-specific free-tier eligibility was not conclusively exposed by the public catalog in this check; do not promise that reference editing is free. Reusing the existing model avoids assuming that a different model is available to the account. [Gateway pricing](https://vercel.com/docs/ai-gateway/pricing), [eligible model catalog](https://vercel.com/ai-gateway/models?freeTier=true)

Remaining verification: a live generation with an authorized account is needed to establish end-to-end provider acceptance and output quality. The current model documentation and installed client implementation support the proposed adapter, but the local interception cannot prove hosted service behavior.

## Subsequent app verification

The implementation was verified with one live Gateway reference edit on September 20, 2026. A private 512 × 512 synthetic bottle image produced a saved 1024 × 1024 studio composition through the byte-based SDK prompt. The original stayed available; the result survived reload and cost 3 Kousa credits. See [verification](verification.md#product-photo-reference-editing). This establishes the live request path, not general product-label fidelity or the account's underlying Gateway free-credit eligibility.
