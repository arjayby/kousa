# Canvas guide, uploads, and recovery

Open **Guide** in the canvas toolbar or press **?** while the canvas or its controls have focus. The empty canvas also offers **Choose a starter example**. Text inputs and other dialogs keep their normal keyboard behavior. Escape closes the guide and returns focus to its toolbar button.

The guide offers Text to image, Edit a product photo, Script to speech, Text to video, and Image to video. Availability comes from the current generation configuration; unavailable examples explain which capability is missing. Examples use supported inputs and describe current limits: Image Reference edits use one selected image, video-to-video is unsupported, Text generation consumes only text context, and Speech → Video Audio is composition rather than a video-model input.

Adding an example inserts connected nodes as one undoable edit and spends no credits. A guidance banner identifies the next output, lets you edit the source text or open that output, and advances when an output is available. Guidance lasts for the current canvas session; the workflow itself is saved. Generate still requires the existing permissions, synchronization, balance, and input checks. Disabled generation controls now explain the blocking condition, and failed status queries or insufficient balance offer a refresh action.

## Upload and paste

Use **Upload media**, drop files onto the viewport, or paste copied media while the canvas is focused. Supported files become selected Image, Speech, or Video nodes using the same authenticated upload endpoint as the node inspector. Native paste inside a text field remains text editing; **Paste nodes** continues to paste copied canvas selections.

The client checks type, size, editing access, connection state, and room under the 200-node limit before sending a batch. The server remains authoritative for permissions, storage quotas, byte signatures, codecs, dimensions, and duration. Files upload sequentially, with visible progress. A dropped batch keeps its original canvas position if the viewport moves during the upload.

If a file fails, earlier successful files are added and **Retry remaining files** resumes with the failed file. Retrying the same bytes uses the existing deduplication and reservation recovery. If the canvas changes or editing access is lost before insertion, saved files remain available in Media library. Undo removes an imported batch's nodes as one action and retains the uploaded files.

## Recovery and keyboard access

Connection errors, reconnection, changed editing access, unavailable browser recovery, and loading or saving that exceeds ten seconds get actionable messages. Users can retry the connection and download their loaded changes before reloading. Generation and canvas uploads wait for a connected, saved canvas.

The guide lists node search, selection, copy/paste, duplicate, undo/redo, deletion, and viewport navigation. Nodes have descriptive accessible names and visible keyboard focus. Closing node settings returns focus to the viewport.

## Verification

Automated tests cover starter graph validity and shared input resolution, capability gating, generation blocking reasons, upload validation, authenticated request construction, and ambiguous upload responses. In-app browser checks cover the starter's next actions, disabled image-to-video example, batch image/audio/video upload, image paste, whole-batch undo, unsupported files, and partial upload recovery. Provider generation is not required by onboarding verification and spends no credits until the user explicitly runs it.
