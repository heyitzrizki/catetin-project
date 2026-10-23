# Catetin Reliable Local Transcription Engine

**Date:** 2026-10-23  
**Status:** Draft for approval  
**Roadmap position:** Product Milestone 1, Stage 1 of 4

## Intent

Make Catetin's existing in-browser Whisper flow dependable enough for real transcription work before expanding the editor, local workspace, or paid product. A user should be able to open a supported recording, understand whether their device can process it, start transcription, follow honest progress, recover from expected failures, and receive timestamped text without the audio leaving the device.

This stage proves usefulness and trust. It does not attempt to prove monetization.

## Product promise for this stage

Catetin processes audio and generated transcript content locally in the browser. Model files may be downloaded from their configured model host and cached by the browser, but recordings and transcript content are not uploaded to Catetin or a transcription service.

Catetin will not claim that every device can process every recording length. It will detect capabilities, choose conservative defaults, expose meaningful limitations, and fail safely when a browser or device cannot complete the work.

## Goals

- Replace whole-file, single-buffer transcription with a bounded-memory, chunk-oriented pipeline where browser capabilities permit it.
- Verify WebGPU availability with a real adapter request and automatically fall back to WebAssembly when WebGPU initialization or inference fails.
- Apply conservative device policies, including locking smartphones to Whisper Tiny for this stage.
- Separate model preparation progress from audio transcription progress.
- Support cancellation without replacing an existing transcript with partial or invalid output.
- Preserve completed chunk results as local checkpoints so an interrupted job can resume when the same local recording is available.
- Prevent the service worker from serving stale application HTML or obsolete bundles after deployment.
- Add automated tests for policy, state transitions, chunk merging, fallback, cancellation, and service-worker routing.
- Establish a repeatable manual test matrix using real, non-sensitive audio fixtures.

## Non-goals

- Payment, licensing, accounts, analytics funnels, or Pro entitlements.
- Batch processing of multiple recordings.
- Background processing after the browser or PWA has been fully closed.
- Server-side transcription or cloud backup.
- Speaker diarization, automatic cleanup, summarization, or other generative text manipulation.
- Custom vocabulary, Safe Find & Replace, or bulk speaker management. These belong to Stage 2.
- Local Folder Vault and portable `.catetin` archives. These belong to Stage 3.
- New editorial export presets. These belong to Stage 4.
- Guaranteeing two-to-three-hour transcription on every supported device.

## Anti-goals

- Hiding a fallback, retry, or restart behind a progress indicator that appears to continue normally.
- Selecting a model that is likely to exhaust the device merely because the user requested it.
- Keeping several decoded chunks or duplicate model instances alive without a measured need.
- Describing a downloaded model as if no network access is ever required.
- Caching navigations indefinitely and trapping users on an obsolete deployment.

## Current implementation and constraints

The current flow is concentrated in `src/App.tsx`, `src/lib/transcription.ts`, `src/workers/transcription.worker.ts`, and `src/components/workspace/WhisperDrawer.tsx`.

- `decodeAudio()` decodes the complete recording, resamples it, and creates one `Float32Array` before the worker begins. Memory therefore grows with the complete recording.
- The worker caches one Transformers.js pipeline and performs one inference request for the entire sample array.
- `navigator.gpu` presence is treated as WebGPU support. Adapter creation and inference capability are not verified before the job starts.
- A failed WebGPU attempt is reported as an error instead of retrying through WASM.
- Model download progress and transcription status share a small state shape that cannot represent job phases, per-chunk progress, fallback, or resumability accurately.
- Cancellation terminates the worker but has no explicit job identity or checkpoint protocol.
- The current service worker uses cache-first behavior for navigations and all same-origin GET requests under the fixed cache name `catetin-app-v1`.
- IndexedDB already stores workspace data and audio blobs. Stage 1 may extend local persistence for transcription job metadata and completed chunk results, but it will not redesign the broader workspace store.

## Approaches considered

### 1. Harden the existing whole-file pipeline

Add better detection, messages, WebGPU fallback, and service-worker behavior without changing audio preparation. This has the lowest implementation cost but leaves the largest risk intact: long recordings still require a full decoded copy in memory. Rejected because it cannot support the stage's reliability goal.

### 2. Bounded-memory chunk pipeline

Process audio in sequential chunks, release transient buffers after use, merge timestamped output deterministically, and checkpoint completed chunks. Use native browser capabilities where available, with a guarded compatibility path when incremental preparation is unavailable. Selected because it addresses the primary failure mode while retaining Catetin's local-first architecture.

### 3. Universal FFmpeg/WASM media pipeline

Bundle or download FFmpeg/WASM to normalize and segment nearly every input format. This improves media-format consistency but adds a substantial download, another high-memory runtime, more worker orchestration, and a larger testing surface. Deferred until evidence shows browser-native preparation is insufficient for the target users.

## Selected experience

### Before transcription

When a recording is opened, Catetin inspects information the browser can provide without uploading or fully decoding the recording: file type, size, media duration when available, browser family, mobile/tablet classification, WebGPU adapter availability, and relevant API support.

The transcription drawer presents:

- processing route: WebGPU preferred, WASM fallback, or WASM only;
- recommended model and reason;
- estimated suitability rather than a fabricated completion time;
- a plain warning when the recording exceeds the tested envelope for that device class;
- unavailable model choices as disabled controls with a reason, not choices that fail later.

Smartphones are locked to Whisper Tiny in this stage. Tablets and desktop-class devices receive a recommendation derived from verified capability, but unverified memory estimates are not presented as facts. Whisper Small is available only inside a tested capability envelope.

### During transcription

The user sees distinct phases:

1. Inspecting recording.
2. Preparing the selected model.
3. Preparing audio chunk N of total.
4. Transcribing chunk N of total.
5. Combining timestamped results.
6. Saving the local checkpoint or final result.

Model download progress and recording progress are separate. If the total chunk count is not yet known, the UI uses an indeterminate state instead of inventing a percentage.

When WebGPU initialization or inference fails with a recognized recoverable device/backend error, Catetin explains that it is switching to WASM, disposes the failed pipeline, and retries the current chunk once. It does not silently restart the entire recording. Content or decoding failures do not trigger backend fallback because changing the inference backend cannot repair an invalid recording.

The existing transcript remains unchanged until a job completes. Partial results live in job storage and may be previewed later, but Stage 1 does not insert them into the editable transcript automatically.

### Cancellation, interruption, and resumption

Each job has an ID, input fingerprint, model, language, backend history, chunk policy version, completed chunk list, and state. Messages between the UI and worker include the job ID so late messages from a terminated or replaced worker are ignored.

Cancelling stops scheduling new work, terminates active work, and retains completed checkpoints. The UI distinguishes:

- **Cancel and keep progress**, the default;
- **Discard transcription progress**, a separate destructive action with confirmation.

On reopening a recording, Catetin offers to resume only when the local recording fingerprint and transcription settings match the stored job. If the recording is unavailable, the checkpoint remains metadata only and Catetin asks the user to select the original file again. Stage 1 makes no promise that browsers will retain file permission or handles across sessions.

### Completion

Chunk output is normalized into a single timestamped transcript. Overlap introduced for Whisper context is removed through deterministic boundary reconciliation. Timestamps are offset to the recording timeline and required to remain monotonic. The completed transcript replaces the empty or existing transcript only after the user confirms when replacement would overwrite edits.

The completion state reports the backend actually used, model, processed duration, and any chunks that required retry. It does not report accuracy scores Catetin cannot measure.

## Technical design

### Module boundaries

The current transcription responsibilities will be split into focused modules during implementation:

- **Capability policy:** browser/device inspection, verified WebGPU adapter check, recommended/allowed model policy, and route selection.
- **Audio chunk source:** metadata inspection and sequential production of normalized 16 kHz mono chunks with bounded live memory.
- **Job controller:** lifecycle, job IDs, cancellation, retry and fallback policy, checkpoint calls, and UI events.
- **Inference worker:** model lifecycle and inference for one chunk at a time. It never owns UI state.
- **Chunk merger:** overlap reconciliation and timestamp normalization, implemented as deterministic pure functions.
- **Checkpoint store:** IndexedDB records for job metadata and completed chunk results, separate from the editable workspace record so incomplete output cannot corrupt a draft.
- **Presentation adapter:** converts domain job state into localized labels, progress, actions, and accessible announcements.

Exact filenames are left to the implementation plan, but `App.tsx` must no longer contain the transcription protocol itself.

### Audio preparation policy

The preferred path produces sequential, normalized chunks without retaining the complete decoded recording and without accumulating output buffers. Only the source data needed by the current preparation operation, the current normalized chunk, a small overlap, and checkpoint metadata should be live.

Because browser codec and incremental-decoding support varies, implementation begins with a technical spike against the actual target browsers before finalizing adapters. The spike must measure memory behavior and codec coverage; it is not permission to ship an unbounded fallback.

When only whole-file decoding is available for an input/browser combination:

- Catetin estimates decoded PCM cost from duration and sample rate when metadata is available.
- It permits the compatibility path only within a tested conservative envelope.
- It blocks or warns outside that envelope before starting expensive work.
- The message names the limitation and suggests a shorter recording or supported desktop browser; it does not imply that the audio was uploaded.

Chunk duration and overlap are configuration values backed by tests and benchmarks, not hard-coded across the UI and worker. Initial candidates may be evaluated during the spike, but this design does not invent a universal optimum.

### Backend and model policy

- WebGPU is considered available only after `requestAdapter()` succeeds and the inference pipeline can initialize.
- Failure categories distinguish capability, initialization, resource exhaustion, media decoding, model download, network, cancellation, and unknown errors.
- A recoverable WebGPU failure retries the current chunk once through WASM.
- A WASM failure does not loop back to WebGPU.
- Mobile phones use Tiny only.
- The default for other devices is the lightest model that meets the tested envelope; larger models require explicit availability from policy.
- Backend and model policy is centralized and unit-testable rather than duplicated in components.

### Worker protocol

Worker requests and responses are typed discriminated unions. Every message carries a job ID. Required events include initialization, model progress, chunk start, chunk progress when available, chunk result, backend fallback, completion, cancellation acknowledgement, and structured error.

Large buffers use transferable objects. The controller must not retain transferred chunk arrays. Pipelines are disposed when switching backend/model, cancelling, or when the worker terminates.

### Checkpoints and privacy

Checkpoints contain transcript text and timestamps, so they receive the same privacy treatment as drafts. They remain in local IndexedDB and are never included in remote error reporting. Stage 1 does not add remote telemetry.

The input fingerprint must be useful for matching without pretending to be proof of file identity. It can combine stable local metadata and sampled content hashing, provided the operation remains local and does not require reading the entire recording up front.

Checkpoint compatibility is strict in Stage 1. A resumable job records the checkpoint schema, application transcription protocol, Transformers.js version, exact model repository and revision, chunk-policy version, merger version, and transcript schema. Resume is offered only when every compatibility field matches. An incompatible checkpoint is never migrated implicitly; Catetin explains that the transcription engine changed and offers a fresh job while leaving deletion as an explicit action. Migration may be designed later if real usage shows enough valuable checkpoints to justify it.

Incomplete checkpoints expire automatically after 30 days by default. Expiry is based on the last successful checkpoint update and the UI shows the concrete local deletion date rather than only saying “30 days.” When the user next opens Catetin with seven days or fewer remaining, Catetin gives a local reminder and offers to extend retention, keep the checkpoint until manual deletion, or delete it immediately.

After an intentional cancellation, Catetin offers two primary actions: keep progress for later or delete progress now. Keeping progress uses the 30-day default and also exposes an explicit “keep until I delete it” option. If the browser crashes or closes before Catetin can ask, the saved checkpoint uses the privacy-preserving 30-day default and the choice is presented on the next relevant visit.

Once a transcription completes and its final transcript has been safely committed, temporary chunk checkpoints for that job are deleted automatically. Catetin does not delete the completed editable transcript. Storage-pressure handling may ask the user to remove checkpoints, but it never silently deletes a manually retained checkpoint before explaining the situation.

### Service worker and deployment safety

- Navigations use network-first behavior with a cached app-shell fallback only when the network is unavailable.
- Hashed build assets may use cache-first because their URLs are content-addressed.
- `sw.js`, navigation HTML, and non-hashed configuration files are not held indefinitely under a fixed cache strategy.
- Cache names include an explicit application-shell version and obsolete Catetin caches are removed during activation.
- Service-worker registration failures do not prevent the application from rendering.
- An update path tells an open client when a newer app shell is ready; applying it must not discard an active transcription job without warning.

An active job continues on the old application shell until it completes or the user cancels it. Catetin does not force a checkpoint-and-reload at a chunk boundary. A waiting update is offered after the job reaches a safe terminal state. The new service worker must not claim active clients early, which avoids mixing a running controller with a different worker protocol or checkpoint schema.

### Supported browser baseline

Support is defined against the latest two stable major releases available when a Catetin release is verified; the verification record stores the exact tested versions so “current stable” is never the only evidence.

- **Primary desktop gate:** Chrome and Edge on Windows 11, plus Chrome on current macOS, through verified WebGPU and WASM routes where the browser/device exposes them.
- **Primary tablet gate:** Safari on the latest two stable iPadOS major releases on an Apple Silicon iPad, using the safe route established by measured capability.
- **Safety gate for phones:** Safari on the latest two stable iOS major releases and Chrome on the latest two stable Android major releases. The gate requires Tiny enforcement, safe refusal outside the measured envelope, and successful short-fixture processing; it does not require long-recording parity with desktop.
- **Compatibility gate:** Safari on current macOS and Firefox on Windows/macOS through their supported measured route. Missing WebGPU may reduce the route to WASM without making the privacy promise weaker.

“Pass” means all safety, privacy, state-transition, fallback, cancellation, and stale-deployment checks succeed. Endurance targets may differ by class and must be recorded from measurement rather than assumed.

### Device-class policy

Device class is not inferred from viewport width. The policy combines user-agent/client-hint information when available, known iPadOS desktop-mode signals such as multi-touch Macintosh presentation, and measured capabilities. Resizing a desktop browser does not turn it into a phone. Touch-screen laptops remain desktop-class. Foldables and ambiguous handheld devices receive the conservative phone policy. A user may voluntarily choose a lighter model, but Stage 1 does not provide an override that unlocks a model prohibited by safety policy.

Classification returns both a class and a reason so the result can be tested and explained. Unknown devices receive the most conservative policy compatible with their verified capabilities.

### Language and transcript contract

Stage 1 supports explicit Indonesian or English transcription. The selected language is fixed for the complete job and forms part of checkpoint identity. Automatic language detection, per-chunk language changes, and translation mode are out of scope.

Whisper output is checkpointed as segment-level text with floating-point start and end timestamps on the recording timeline, the fixed language, source chunk identity, and overlap metadata needed by the merger. Word-level timing is not required. The merger returns ordered, non-empty segments with monotonic start/end timestamps and no duplicated overlap text. Integration with the current editor converts each merged segment into the existing `DialogSegment` shape using its start time while retaining richer timing inside the transcription result/checkpoint schema for later stages. Stage 1 does not silently discard raw fields required for deterministic re-merging, but it does not preserve arbitrary library output fields without a defined consumer.

## State model

The job state is explicit rather than represented by a single loose phase string:

- `idle`
- `inspecting`
- `preparing-model`
- `preparing-audio`
- `transcribing`
- `falling-back`
- `merging`
- `checkpointing`
- `paused` or `resumable`
- `cancelling`
- `cancelled`
- `complete`
- `error`

Legal transitions are defined and tested. Starting a new job invalidates UI events from older job IDs. Error states retain a stable category, user-safe message, and optional recovery action; raw browser or library errors are not shown directly as the primary user message.

## Failure handling

- **Unsupported or corrupt media:** stop before inference where possible and suggest a supported input path.
- **Model download unavailable:** retain the recording and job settings; allow retry when connected. Offline transcription is offered only if the required model is already cached.
- **Insufficient memory:** stop, preserve completed chunks, recommend Tiny or a more capable device, and avoid automatic retry with the same settings.
- **WebGPU failure:** explain fallback, dispose WebGPU state, retry current chunk once with WASM.
- **WASM failure:** preserve checkpoints and offer retry or settings change without a loop.
- **Storage quota failure:** transcription may continue only if the user acknowledges that resume protection is unavailable; existing saved work must not be deleted automatically.
- **Deployment update:** defer reload while a job is active and offer the update after a checkpoint boundary or cancellation.

## Accessibility and language

- Progress changes use restrained live-region announcements; per-frame or per-percent updates are not announced.
- Cancellation, retry, fallback, and discard controls are keyboard accessible with visible focus.
- Errors identify the failed phase and the next safe action.
- Indonesian and English copy must describe the same capability and limitation.
- No raw implementation jargon is required to complete the flow; WebGPU and WebAssembly may appear in an expandable device-detail area.

## Verification strategy

### Automated

- Unit tests for capability/model policy across phone, tablet, desktop, WebGPU, and WASM fixtures.
- State-machine tests for normal completion, cancellation, stale worker messages, WebGPU fallback, retry limits, storage errors, and resume.
- Pure-function tests for timestamp offsets, overlap reconciliation, empty chunks, repeated phrases, and monotonic output.
- Worker protocol contract tests with mocked inference adapters.
- IndexedDB checkpoint tests using a browser-capable test environment.
- Service-worker tests for navigation network-first behavior, offline fallback, hashed asset caching, and cache upgrades.
- Existing TypeScript, landing tests, and production build remain green.

### Manual browser matrix

At minimum, test current stable Chrome/Edge desktop, Safari desktop, Safari iPadOS on a modern iPad, Chrome Android, and Safari iPhone. Firefox is tested through the WASM path and documented according to observed support.

Fixtures should include:

- short clean speech for fast regression;
- overlapping or noisy conversation;
- a longer non-sensitive recording assembled for endurance testing;
- unsupported or damaged media;
- offline with model cached and offline without model cached;
- cancellation and reload at multiple chunk boundaries.

Record actual browser version, device class, model, backend, media format, duration, peak memory when observable, completion, fallback, and transcript/timestamp sanity. Do not turn a single successful device result into a universal claim.

## Stage gate

Stage 1 is complete when:

- the same short fixture completes repeatedly through WebGPU and WASM routes where supported;
- recognized WebGPU failure falls back once to WASM without losing completed chunks;
- mobile policy prevents selecting an unsafe model;
- a long fixture is processed with bounded live chunk buffers on at least the agreed primary desktop target;
- cancellation leaves the existing editable transcript intact and produces a resumable checkpoint;
- an interrupted matching job can resume from completed chunks;
- corrupt/unsupported media, offline model absence, storage failure, and memory failure each produce a specific safe recovery path;
- a new deployment no longer leaves a returning user on stale HTML or a blank page;
- automated verification, production build, and the documented manual browser matrix pass at the agreed support level.

Passing this gate permits Stage 2 work. It does not yet justify “unlimited duration on every device” marketing copy.

## Decisions made by the assistant for review

- Checkpoints are included in Stage 1 because reliable cancellation and interruption recovery cannot be delivered honestly without them.
- Partial output is isolated from the editable transcript until completion to protect existing work.
- Phone devices are locked to Tiny; other model availability is policy-driven rather than a free choice.
- The exact chunk duration, overlap, decoded-memory ceiling, and supported codec matrix are benchmark outputs, not invented constants in the design.
- No remote telemetry is added in this stage because it would complicate the zero-cloud trust boundary before the product has a privacy specification for analytics.
- Browser support is tied to the latest two stable major releases at verification time, with exact versions written into each test record.
- Ambiguous handheld devices receive phone policy; screen width alone never classifies device safety.
- Checkpoint resume requires exact engine/protocol compatibility in Stage 1; incompatible checkpoints are not silently migrated or deleted.
- Incomplete checkpoints expire after 30 days by default, warn locally during the final seven days, and may be retained indefinitely only through an explicit user choice.
- Indonesian or English is selected explicitly and remains fixed for a job; automatic detection and translation are deferred.
- Transcript checkpoints retain segment start/end timing while the current editor consumes segment start timing through its existing data shape.
- A deployment update waits for the active job to finish or be cancelled rather than forcing a mid-job reload.

