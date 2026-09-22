# Audio nodes

Audio is one of the four canvas node types, alongside Text, Image, and Video. Use it for generated speech or uploaded MP3 speech, music, ambience, and sound effects.

The Audio source controls appear first in the inspector. Choose an existing project file or upload an MP3 up to three minutes and 10 MB. Connect the Audio output to a Video node’s Audio input, then use **Clip with audio** to set timing and volume and export the combined media. Uploads do not require a transcript.

AI generation currently supports speech: enter a script or connect Text, choose a model and voice, and use **Generate speech**. Music and sound-effect generation require additional provider integrations. The Playground uses the Audio label and explains this generation limit.

## Saved-data compatibility

New canvas nodes use `type: "audio"`. The shared canvas schema accepts legacy `type: "speech"` and returns `audio`. This applies to JSON saves, Yjs documents, templates, clipboard payloads, and saved chat proposals. Node IDs, authored names, scripts, voices, attachments, selected historical runs, and connections are preserved.

Generation jobs still use `kind: "speech"`: speech is the current operation performed by an Audio node. Explicit mappings between node type and generation kind preserve run history, snapshots, input hashes, workflow recovery, and receipts. Playground imports create Audio nodes from speech results. No database migration or model-catalog change is required.
