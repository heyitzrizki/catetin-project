# Reliable Local Transcription Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the tested policy, state, merge, checkpoint, deployment-safety, and codec-feasibility foundations required before Catetin's bounded-memory transcription engine is integrated.

**Architecture:** This is Stage 1A of the approved reliable-transcription design. Pure domain modules define decisions independently from React and Transformers.js; IndexedDB owns resumable local checkpoints; the service worker uses route-specific caching; and a disposable browser spike records which native audio-preparation routes actually keep memory bounded. Stage 1B is planned only after the spike selects real adapters, preventing speculative implementation work.

**Tech Stack:** TypeScript 7, React 19, Vite 8, Node test runner through `tsx`, IndexedDB, Service Worker API, Web Audio/WebCodecs capability probes, Playwright or installed Chromium for the disposable benchmark harness.

**Spec:** `docs/superpowers/specs/2026-10-23-reliable-local-transcription-engine-design.md`

## Global Constraints

- Audio, transcript text, fingerprints, checkpoints, and benchmark fixtures remain local; this plan adds no remote telemetry.
- Stage 1 supports explicit Indonesian (`id`) and English (`en`) transcription only; the selected language is fixed for a job.
- Phones and ambiguous handheld devices are restricted to Whisper Tiny; viewport width alone must never classify a device.
- A WebGPU route is available only after `requestAdapter()` succeeds; recognized WebGPU failures may fall back to WASM once, never loop.
- Incomplete checkpoints expire 30 days after their last successful update unless the user explicitly retains them; warn locally during the final seven days.
- Resume requires an exact match for all engine compatibility fields; incompatible checkpoints are neither migrated nor silently deleted.
- Existing editable transcripts are never replaced by incomplete output.
- Navigations are network-first; hashed assets may be cache-first; an active transcription is never force-reloaded for an update.
- Copy and UI changes must follow `AGENTS.md`, including real actions, explicit loading/error/empty states, keyboard access, and no fabricated claims.
- Do not introduce FFmpeg/WASM in Stage 1A. The codec spike exists to determine whether it is needed later.

## Review Focus

- iPadOS presenting a Macintosh user agent must classify as tablet, while a touch-screen laptop remains desktop; Task 2 pins both cases.
- A late event from an obsolete job must not mutate the current job; Task 1 pins job-ID rejection and legal transitions.
- Repeated words inside Whisper overlap must not duplicate text or move timestamps backward; Task 3 pins boundary reconciliation.
- A crash-created checkpoint must expire after 30 days without deleting manually retained or completed transcripts; Task 4 pins all three outcomes.
- A returning production user with stale cached HTML must receive the network shell when online and the last valid shell only when offline; Task 5 pins route behavior and cache upgrade.

---

### Task 1: Test Harness and Transcription Domain State

**Files:**
- Create: `src/features/transcription/types.ts`
- Create: `src/features/transcription/job-state.ts`
- Create: `tests/transcription/job-state.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: None.
- Produces: `TranscriptionBackend`, `TranscriptionLanguage`, `TranscriptionModel`, `JobCompatibility`, `TranscriptionJobState`, `TranscriptionEvent`, `initialJobState(jobId, settings)`, `reduceJobState(state, event)`, and `acceptsJobEvent(activeJobId, eventJobId)`.

- [ ] **Step 1: Add the failing state-machine tests**

Create tests named `follows the legal successful job path`, `rejects an illegal transition`, `ignores an event from an obsolete job id`, `records one webgpu to wasm fallback`, and `never permits wasm to webgpu fallback`. Assert exact phase transitions through `inspecting`, `preparing-model`, `preparing-audio`, `transcribing`, `falling-back`, `merging`, `checkpointing`, and `complete`; an illegal transition returns a typed invariant error instead of mutating state.

- [ ] **Step 2: Add the repository test command and verify failure**

Add `"test": "tsx --test tests/**/*.test.ts tests/**/*.test.tsx"` to `package.json`.

Run: `npm test -- tests/transcription/job-state.test.ts`  
Expected: FAIL because the domain modules do not exist.

- [ ] **Step 3: Implement the domain types and reducer**

Use discriminated unions. `TranscriptionEvent` must always carry `jobId`; fallback events carry `from: 'webgpu'`, `to: 'wasm'`, and `attempt: 1`. `JobCompatibility` contains checkpoint schema, transcription protocol, Transformers.js version, exact model repository/revision, chunk-policy version, merger version, and transcript-schema version.

- [ ] **Step 4: Run focused and full verification**

Run: `npm test -- tests/transcription/job-state.test.ts`  
Expected: all Task 1 tests PASS.

Run: `npm run lint`  
Expected: TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add package.json src/features/transcription/types.ts src/features/transcription/job-state.ts tests/transcription/job-state.test.ts
git commit -m "test: define transcription job lifecycle"
```

### Task 2: Capability and Safe Model Policy

**Files:**
- Create: `src/features/transcription/capability-policy.ts`
- Create: `tests/transcription/capability-policy.test.ts`

**Interfaces:**
- Consumes: `TranscriptionBackend` and `TranscriptionModel` from Task 1.
- Produces: `DeviceSignals`, `DeviceClass`, `CapabilityReport`, `classifyDevice(signals)`, `verifyWebGpu(gpu)`, and `createCapabilityPolicy(report)` returning allowed models, recommended model, preferred backend, fallback backend, and human-readable reason codes.

- [ ] **Step 1: Write failing classification and policy tests**

Cover: ordinary iPhone and Android phone become `phone`; iPadOS Macintosh presentation with multi-touch becomes `tablet`; a Macintosh or Windows device with touch remains `desktop` unless the iPad signal matches; foldable/ambiguous handheld becomes `phone`; viewport changes do not affect classification; phones allow only `tiny`; unknown devices receive the conservative policy; a missing or rejected adapter yields WASM-only; a resolved adapter prefers WebGPU with one WASM fallback.

- [ ] **Step 2: Verify the policy tests fail**

Run: `npm test -- tests/transcription/capability-policy.test.ts`  
Expected: FAIL because `capability-policy.ts` does not exist.

- [ ] **Step 3: Implement pure classification and asynchronous WebGPU verification**

`DeviceSignals` accepts normalized user-agent/client-hint signals, platform, maximum touch points, mobile hint, and form-factor hint. Do not read globals inside `classifyDevice`; collect browser globals in a later presentation adapter. `verifyWebGpu()` calls `requestAdapter()` and returns a result object instead of throwing.

- [ ] **Step 4: Run focused and type verification**

Run: `npm test -- tests/transcription/capability-policy.test.ts`  
Expected: all Task 2 tests PASS.

Run: `npm run lint`  
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/features/transcription/capability-policy.ts tests/transcription/capability-policy.test.ts
git commit -m "feat: add safe transcription capability policy"
```

### Task 3: Deterministic Timestamped Chunk Merger

**Files:**
- Create: `src/features/transcription/chunk-merger.ts`
- Create: `tests/transcription/chunk-merger.test.ts`

**Interfaces:**
- Consumes: `TranscriptionLanguage` from Task 1.
- Produces: `TranscriptChunkResult`, `TranscriptSegment`, `mergeChunkResults(chunks)` and `toDialogSegments(segments)`.

- [ ] **Step 1: Write failing merger contract tests**

Assert that the merger offsets chunk-local floating-point start/end timestamps to the recording timeline, orders out-of-order completed chunks by source index, removes exact and normalized repeated boundary phrases, preserves legitimate repeated words outside overlap, drops whitespace-only segments, clamps tiny floating-point regressions, and produces monotonic non-negative start/end timestamps. Assert `toDialogSegments()` uses segment start time, sequential IDs, `Pembicara 1`, trimmed text, and the existing `formatSeconds()` representation.

- [ ] **Step 2: Verify merger tests fail**

Run: `npm test -- tests/transcription/chunk-merger.test.ts`  
Expected: FAIL because the merger does not exist.

- [ ] **Step 3: Implement pure merge and editor conversion functions**

Each `TranscriptChunkResult` includes job/chunk IDs, source index, source start/end, overlap start/end, fixed language, and segment-level text/start/end. Boundary reconciliation may remove only text proven to fall inside declared overlap; it must not apply fuzzy deletion outside that interval.

- [ ] **Step 4: Run focused and regression verification**

Run: `npm test -- tests/transcription/chunk-merger.test.ts`  
Expected: all Task 3 tests PASS.

Run: `npm test`  
Expected: all existing and new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/transcription/chunk-merger.ts tests/transcription/chunk-merger.test.ts
git commit -m "feat: merge timestamped transcription chunks"
```

### Task 4: Local Checkpoint Store and Retention

**Files:**
- Create: `src/features/transcription/checkpoint-store.ts`
- Create: `tests/transcription/checkpoint-store.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `JobCompatibility` and job settings from Task 1; `TranscriptChunkResult` from Task 3.
- Produces: `TranscriptionCheckpoint`, `CheckpointSummary`, `saveCheckpoint()`, `findResumableCheckpoint()`, `setCheckpointRetention()`, `listCheckpointSummaries()`, `deleteCheckpoint()`, `purgeExpiredCheckpoints()`, and constants `DEFAULT_RETENTION_DAYS = 30`, `EXPIRY_WARNING_DAYS = 7`.

- [ ] **Step 1: Add IndexedDB test support and failing retention tests**

Add `fake-indexeddb` as a development dependency. Test exact compatibility matching; mismatch remains listed but is not resumable; ordinary incomplete checkpoint expires at 30 days from `updatedAt`; a checkpoint is flagged for warning at seven days remaining; `manual` retention does not expire; a crash/default record uses timed retention; completed final transcript data is never part of purge; deleting checkpoint data does not touch the existing workspace store.

- [ ] **Step 2: Verify checkpoint tests fail**

Run: `npm test -- tests/transcription/checkpoint-store.test.ts`  
Expected: FAIL because the checkpoint store does not exist.

- [ ] **Step 3: Implement a versioned, separate IndexedDB checkpoint store**

Use a dedicated object store/database boundary from the editable workspace record. Store only local input fingerprint metadata, settings, compatibility, backend history, completed chunk results, timestamps, retention mode (`timed` or `manual`), and state. Database upgrades must preserve the current `catetin-local` workspace data; prefer a separate `catetin-transcription` database to make this isolation explicit.

- [ ] **Step 4: Run focused and full verification**

Run: `npm test -- tests/transcription/checkpoint-store.test.ts`  
Expected: all Task 4 tests PASS.

Run: `npm test && npm run lint`  
Expected: both commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/features/transcription/checkpoint-store.ts tests/transcription/checkpoint-store.test.ts
git commit -m "feat: persist resumable transcription checkpoints"
```

### Task 5: Deployment-Safe Service Worker

**Files:**
- Create: `public/sw-policy.js`
- Create: `src/pwa/update-coordinator.ts`
- Create: `tests/pwa/cache-policy.test.ts`
- Create: `tests/pwa/update-coordinator.test.ts`
- Modify: `public/sw.js`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: Vite's hashed `/assets/*` output convention.
- Produces: pure `self.CatetinCachePolicy.classifyRequest(url, mode)` loaded by `sw.js` through `importScripts('/sw-policy.js')`; `registerServiceWorkerUpdates()` and `setTranscriptionJobActive(active)`; service-worker messages `CATETIN_UPDATE_READY`, `CATETIN_ACTIVATE_UPDATE`, and `CATETIN_JOB_ACTIVITY` with `active: boolean`.

- [ ] **Step 1: Write failing cache-policy tests**

Assert navigations use `network-first`; hashed `/assets/*` use `cache-first`; `/sw.js`, `/sw-policy.js`, `/index.html`, manifest, and unknown non-hashed same-origin files use `network-first`; cross-origin model/CDN requests are not stored in the app-shell cache; upgrading the explicit cache version identifies obsolete `catetin-app-*` caches only. Add a source contract test that rejects a generic `caches.match(request) || fetch(request)` handler for navigations. In the coordinator test, assert an update remains waiting while activity is true and receives activation only after activity becomes false.

- [ ] **Step 2: Verify cache tests fail against the existing worker**

Run: `npm test -- tests/pwa/cache-policy.test.ts tests/pwa/update-coordinator.test.ts`  
Expected: FAIL because the existing worker is generic cache-first.

- [ ] **Step 3: Implement route-specific caching and deferred activation**

Use `sw-policy.js` as the single runtime route classifier shared by worker behavior and Node tests. Use network-first navigation with cached `/index.html` only after a network failure. Cache successful hashed assets by URL. Version the app-shell cache and remove only older Catetin app caches at activation. Register update/error handling in `main.tsx` without blocking React render. A waiting worker announces availability; `update-coordinator.ts` requests activation only when `setTranscriptionJobActive(false)` confirms no active job. Stage 1B will connect the job controller to that setter.

- [ ] **Step 4: Run focused tests and production build**

Run: `npm test -- tests/pwa/cache-policy.test.ts tests/pwa/update-coordinator.test.ts`  
Expected: all Task 5 tests PASS.

Run: `npm run build`  
Expected: Vite build exits 0; an existing chunk-size warning is acceptable, new service-worker errors are not.

- [ ] **Step 5: Manually verify update and offline routing**

Serve one build, load it, replace it with a second build containing a visible version marker, and verify: online reload receives build two; offline reload receives the last valid shell; a waiting update does not force reload while the test client reports an active job. Record exact Chrome/Edge version and result in `.design/transcription-stage-1a/service-worker-verification.md`.

- [ ] **Step 6: Commit**

```bash
git add public/sw-policy.js public/sw.js src/pwa/update-coordinator.ts src/main.tsx tests/pwa/cache-policy.test.ts tests/pwa/update-coordinator.test.ts .design/transcription-stage-1a/service-worker-verification.md
git commit -m "fix: make app shell updates deployment safe"
```

### Task 6: Bounded-Memory Audio Preparation Spike

**Files:**
- Create: `spikes/audio-chunking/index.html`
- Create: `spikes/audio-chunking/main.ts`
- Create: `spikes/audio-chunking/probes.ts`
- Create: `tests/transcription/audio-probes.test.ts`
- Create: `.design/transcription-stage-1a/audio-spike-results.md`
- Create: `.design/transcription-stage-1a/fixtures/README.md`

**Interfaces:**
- Consumes: browser `Blob`, media metadata, WebCodecs/Web Audio capabilities; no production module consumes spike code.
- Produces: `AudioPreparationProbeResult` records and a written adapter decision for Stage 1B: accepted native route(s), codec/browser envelope, observed peak-memory trend, failure modes, and whether FFmpeg/WASM must be reconsidered in a separate design amendment.

- [ ] **Step 1: Write failing probe-shape tests**

Test that probe records require exact browser/OS version, device class, codec/container, duration, file size, route name, whether full-file bytes were retained, maximum simultaneous normalized PCM seconds, completion status, failure category, and memory observations marked as measured or unavailable. Test that a route cannot be labeled `bounded` when it retains the complete decoded PCM or multiple complete chunk buffers.

- [ ] **Step 2: Verify probe tests fail**

Run: `npm test -- tests/transcription/audio-probes.test.ts`  
Expected: FAIL because the probe module does not exist.

- [ ] **Step 3: Implement the disposable probe harness**

Probe browser-native candidates separately: WebCodecs only where a valid demux path exists; browser decode compatibility through `decodeAudioData`; and any sequential media-element/Web Audio route capable of deterministic faster-than-real-time extraction. Measure whether only the current normalized 16 kHz mono chunk plus configured overlap remains live. Do not import the spike into production code and do not download third-party media engines.

- [ ] **Step 4: Run automated probe validation**

Run: `npm test -- tests/transcription/audio-probes.test.ts`  
Expected: all shape and bounded-label tests PASS.

- [ ] **Step 5: Run the manual browser matrix with non-sensitive fixtures**

Use short and endurance fixtures for MP3, WAV, M4A/AAC, and WebM/Opus where the target browser supports them. At minimum run current Chrome/Edge Windows 11; add Safari macOS/iPadOS results on available hardware or mark them `not measured`, never inferred. Keep fixture binaries out of Git; document generation/source and checksums in the fixture README.

- [ ] **Step 6: Write the Stage 1B adapter decision**

In `audio-spike-results.md`, choose only routes demonstrated to be bounded and deterministic. For every target format/browser without such a route, specify the guarded whole-file compatibility envelope to benchmark next or state that an FFmpeg/WASM design amendment is required. Include exact evidence and reject routes that merely split already fully decoded PCM.

- [ ] **Step 7: Run Stage 1A final verification**

Run: `npm test && npm run lint && npm run build && git diff --check`  
Expected: tests, TypeScript, and build exit 0; `git diff --check` reports no whitespace errors. The existing Vite chunk-size warning is allowed and must be recorded, not represented as a failure.

- [ ] **Step 8: Commit**

```bash
git add spikes/audio-chunking tests/transcription/audio-probes.test.ts .design/transcription-stage-1a/audio-spike-results.md .design/transcription-stage-1a/fixtures/README.md
git commit -m "spike: measure bounded browser audio preparation"
```

## Stage 1A Exit and Stage 1B Planning Gate

Stage 1A is complete only when Tasks 1–6 pass and `audio-spike-results.md` selects an evidence-backed route or explicitly demonstrates that no acceptable browser-native route exists. Then write the Stage 1B plan against the selected result. Stage 1B will cover the production audio chunk source, typed inference worker, controller and fallback orchestration, React presentation adapter, cancellation/resume UI, retention notifications, integration tests, and the full manual support matrix.

Do not begin Stage 1B from assumptions made before the spike. If the result requires FFmpeg/WASM or materially narrows the approved product promise, return to the user with the evidence and amend the design before planning implementation.

