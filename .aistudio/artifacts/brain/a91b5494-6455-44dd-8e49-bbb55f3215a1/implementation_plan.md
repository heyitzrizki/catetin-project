# CATETIN — Phase 3: Transcription Workspace Redesign (Final Revised Plan)

## Executive Summary
Phase 3 redesigns the Catetin Transcription Workspace into an intentional, distraction-free **transcript-first workstation**. The design prioritizes continuous document reading and direct editorial revision, replacing card-based boxes with **borderless speaker-turn blocks separated by typography and whitespace**. Audio controls are housed in a **persistent bottom dock**, sample audio selection is placed directly in the **workspace header**, and Whisper model specifications and diagnostics reside in a slide-out drawer featuring **rigorous 3-tier hardware diagnostics** with zero fabricated telemetry. All existing data structures, state handlers, export formats, and UI states are 100% preserved.

---

### User Review & Final Requirement Directives

> [!IMPORTANT]
> This revision directly addresses all four final requirements specified for Phase 3 implementation:
> 1. **Continuous Document, Not Dialogue Cards**: The transcript editor renders borderless speaker turns separated by vertical whitespace and clean typographic hierarchy. No segment is wrapped in an individual `Card` or boxed container. A subtle left-side navy accent indicator and light surface tint highlight the currently playing segment without visual noise.
> 2. **Preserve Actual Data Structures (Zero Invented Fields)**: The existing `DialogSegment` (`id`, `time`, `seconds`, `speaker`, `text`) and `SampleRecording` (`id`, `category`, `filename`, `duration`, `durationSec`, `segments`) interfaces are preserved exactly as defined in `App.tsx`. No assumed fields (such as `start` or `end`) are introduced. All state variables (`transcriptData`, `speakerNames`, `editingSpeaker`, `currentTime`, `isPlaying`, `playbackSpeed`), audio loops, speaker rename handlers, and export logic (.DOCX, .SRT, .TXT, clipboard) remain fully intact.
> 3. **Accurate 3-Tier Hardware Diagnostics**: Distinguishes between (a) WebGPU API exposure in `navigator`, (b) successful GPU adapter acquisition via `navigator.gpu.requestAdapter()`, and (c) execution fallback to WebAssembly/CPU. If WebGPU or adapter is unavailable, the UI honestly explains: *"WebAssembly / CPU Fallback (Lokal) — WebGPU tidak aktif di peramban ini; model berjalan lokal tanpa transfer cloud"*. Estimated model memory (~140 MB RAM for Base) is explicitly labeled as a static model footprint, not simulated live telemetry.
> 4. **Preserve All Working UI States**: Fully accounts for and protects all states: Ready (normal editing/playback), Loading (sample load / file ingest), Empty (waiting for audio / no segments), and Error (unsupported audio format with clear user recovery guidance).

---

## 1. Overview & Core Concept

- **What It Does**: Transforms Catetin from a cramped two-column split into a focused, continuous editorial workstation for proofreading, editing, and verifying speech-to-text transcripts generated locally by Whisper on the user's device.
- **Target Audience / Persona**: Legal practitioners, UX researchers, investigative journalists, and meeting scribes who require confidential local processing, rapid keyboard-driven text correction, and effortless audio-to-text scrubbing.
- **Key Value**: Delivers an uncluttered, document-first reading experience with synchronized audio playback, honest hardware diagnostics, and a guaranteed zero-cloud-egress data perimeter.

---

## 2. User Experience & Visual Design

### Key User Flows
1. **Workspace Entry & File Ingest**: The user enters the workspace. The top header shows the active document title, duration, sample switcher dropdown (`Wawancara Investigasi`, `Konsultasi Hukum NDA`, `Notulen Rapat Sprint`), local audio upload button (`.mp3`, `.wav`, `.m4a`), model status badge, and export menu.
2. **Audio-Synchronized Proofreading**: The user presses `Space` or clicks Play in the bottom dock. As playback progresses, the active speaker turn is highlighted with a subtle left-edge navy line (`border-l-2 border-primary`) and gentle background tint. Clicking any timecode tag (`▶ 00:15`) instantaneously jumps audio playback to that exact second.
3. **Continuous Inline Editing**: The user edits dialogue text directly in the continuous document flow via `contentEditable` or inline text inputs. Clicking a speaker name enables inline renaming with Enter/Escape triggers, automatically updating all matching segments.
4. **Hardware & Engine Inspection**: The user opens the Whisper settings drawer from the header badge. The drawer runs genuine 3-tier hardware detection (API check -> adapter request -> backend classification) and displays static memory specifications with zero fabricated telemetry.

### Visual Identity & Anti-Slop Discipline
- **Aesthetic Direction**: High-precision editorial workstation inspired by professional audio editors (MacWhisper, Descript, Audacity), strictly purged of generic AI slop.
- **Color Palette & WCAG AA Contrast**:
  - Main Background: Pure white (`#FFFFFF` in light mode, `#0B0F17` in dark mode).
  - Surface Panels / Dock: Muted neutral (`#F8FAFC` light / `#111827` dark) with crisp 1px borders (`#E2E8F0` / `#1F2937`).
  - Brand Accent: High-contrast Navy (`#1E3A8A` light / `#3B82F6` dark) used exclusively for the active segment left indicator, playback progress fill, and primary buttons.
  - Text: High-contrast charcoal (`#0F172A` light / `#F8FAFC` dark), guaranteed >= 4.5:1 contrast against all backgrounds.
- **Typography**:
  - Continuous Reading: Clean sans-serif (`Inter`, `system-ui`) with relaxed leading (`leading-relaxed`) and optimal measure (65-80 characters per line) for fatigue-free reading.
  - Timestamps & Metrics: Monospace (`JetBrains Mono`, `ui-monospace`) for timecodes (`00:15 / 03:42`), duration, and RAM estimates.
- **Border & Corner Rules**: Strict anti-slop rules enforced: no bubble corners or pill overload (`rounded-none`, `rounded-xs`, or `rounded-sm`). No enclosing cards for individual transcript segments.

### Visual Wireframes

#### Desktop: Continuous Document Workspace (No Dialogue Cards)
```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [← Beranda]   [Wawancara Investigasi ▼]   [+ Unggah Audio]       [Whisper Base · Lokal]   [Ekspor ▼]   │ (Header)
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                        │
│   Wawancara_Investigasi_Q3.mp3                                                                        │
│   03:42 · 5 Segmen Percakapan · Riset & Investigasi                        [Salin Semua]  [Cari Teks]  │
│   ───────────────────────────────────────────────────────────────────────────────────────────────────  │
│                                                                                                        │
│   Speaker 1 (Pewawancara)   00:03                                                             Baris 01 │
│   Boleh diceritakan alasan utama tim Anda melarang keras penggunaan software transkrip online yang     │
│   biasa?                                                                                               │
│                                                                                                        │
│ ▌ Speaker 2 (Narasumber)   ▶ 00:15                                                            Baris 02 │
│ ▌ Semua berkas investigasi terikat perjanjian kerahasiaan ketat. Begitu audio diunggah ke server cloud │
│ ▌ pihak ketiga, risiko hukum dan kebocoran datanya jadi tanggung jawab kami.                           │ (Active Row)
│                                                                                                        │
│   Speaker 1 (Pewawancara)   00:36                                                             Baris 03 │
│   Itu sebabnya di catetin, kalkulasi AI Whisper dieksekusi 100% di perambanmu sendiri melalui WebGPU   │
│   tanpa ada 1 byte pun data suara yang dikirim keluar.                                                 │
│                                                                                                        │
│   Speaker 2 (Narasumber)   00:58                                                              Baris 04 │
│   Bahkan hasilnya bisa langsung kami ekspor jadi format Word rapi lengkap dengan pemisahan nama dan    │
│   penomoran baris.                                                                                     │
│                                                                                                        │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [▶ Putar]  00:15  ───||||||||||||||||||||||||||||||||||||||||||──────────────────  03:42  [Ulang] [1.0x]│ (Bottom Dock)
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Slide-Out Whisper Settings & Diagnostics Drawer
```
┌─────────────────────────────────────────────────────────┐
│ PENGATURAN & DIAGNOSTIK MODEL WHISPER               [X] │
├─────────────────────────────────────────────────────────┤
│ MODEL AKTIF                                             │
│ (●) Whisper Base  (~140 MB · Cepat & Seimbang)          │
│ ( ) Whisper Small (~460 MB · Akurasi Tinggi)            │
│ ( ) Whisper Tiny  (~75 MB · Paling Ringan)              │
├─────────────────────────────────────────────────────────┤
│ ESTIMASI KEBUTUHAN MEMORI (STATIS)                      │
│ Ukuran Bobot Model      : ~140 MB                       │
│ Estimasi Alokasi VRAM   : ~500 MB                       │
│ Format Model            : ONNX / WebGPU Shader          │
├─────────────────────────────────────────────────────────┤
│ DIAGNOSTIK HARDWARE & RUNTIME (HASIL DETEKSI NYATA)     │
│ 1. API WebGPU Browser   : Didukung                      │
│ 2. Permintaan GPU Adapter: Berhasil (Hardware Aktif)    │
│ 3. Backend Inferensi    : WebGPU Shader (GPU Terakselerasi)
│ Catatan: Tidak ada data memori real-time sintesis.      │
│          Pengukuran heap diisolasi oleh sandbox browser.│
├─────────────────────────────────────────────────────────┤
│ PERIMETER PRIVASI DATA                                  │
│ Status Jaringan         : 100% On-Device / Zero Cloud    │
│ Jaminan Privasi         : Audio tidak meninggalkan RAM  │
└─────────────────────────────────────────────────────────┘
```

#### Mobile Viewport (Responsive Stack)
- Top bar contains back button, document title, sample selector trigger, and overflow export menu.
- Continuous document adapts seamlessly with comfortable touch spacing; speaker names and timestamps wrap cleanly without overflowing horizontally.
- Bottom audio dock remains permanently pinned with high-contrast, thumb-friendly Play/Pause (min 44px), scrubber progress, and speed selector.

---

## 3. Key Product Decisions & Trade-Offs

### Decision 1: Borderless Document vs. Card-Based Segment Containers
- **Chosen Approach**: Render dialogue turns as typographic blocks separated by clean vertical rhythm (`py-4 border-b border-border/40`), reserving borders solely for the active turn indicator (`border-l-2 border-primary pl-3 bg-muted/30`).
- **Why**: Traditional audio transcription tools (Word, Descript, MacWhisper) present transcripts as living, readable documents. Wrapping each line in a boxed `Card` creates unnecessary visual boundaries, disrupts reading flow, and feels like generic AI chatbot messaging bubbles rather than a professional editorial document.
- **Alternatives Considered**: Enclosed cards for every turn (firmly rejected per user requirement); plain text area with no speaker separation (rejected: loses interactive timestamp jump and speaker rename capability).

### Decision 2: 3-Tier Hardware Diagnostics vs. Superficial API Checks
- **Chosen Approach**:
  1. Check `typeof navigator !== 'undefined' && 'gpu' in navigator`.
  2. If present, invoke `await navigator.gpu.requestAdapter()` to verify an actual hardware adapter is returned.
  3. If adapter is null or API missing, cleanly report: *"WebAssembly / Multi-Threaded CPU (Lokal)"* with clear explanatory copy.
  4. Label memory metrics honestly as *"Estimasi Kebutuhan Memori Model (Statis)"*.
- **Why**: Eliminates false positives where `navigator.gpu` exists in browser flags but the underlying GPU is disabled or incompatible. Strictly fulfills Anti-Slop Rule C-5 (Evidence Over Claims) and Rule R-36 (No Fabricated Claims).
- **Alternatives Considered**: Fake live FPS or dynamic VRAM ticker (strictly rejected as deceptive AI slop).

### Decision 3: Sample Switcher Relocation to Workspace Header
- **Chosen Approach**: Housing sample selection (`Wawancara Investigasi`, `Konsultasi Hukum NDA`, `Notulen Rapat Sprint`) in the top workspace toolbar next to audio file upload.
- **Why**: Sample recordings are user inputs and documents, not engine settings. Users need immediate access to test different recordings without opening a technical inference drawer.

---

## 4. Technical Architecture & Data Strategy

### Exact Preserved Data Structures (From App.tsx)
No fields will be modified, renamed, or assumed.

```typescript
// Preserved exact segment interface
interface DialogSegment {
  id: number;
  time: string;      // Formatted "MM:SS" (e.g. "00:03")
  seconds: number;   // Second offset for audio jump (e.g. 3)
  speaker: string;   // Speaker key (e.g. "Speaker 1 (Pewawancara)")
  text: string;      // Dialogue text
}

// Preserved exact sample recording interface
interface SampleRecording {
  id: string;
  category: string;
  filename: string;
  duration: string;
  durationSec: number;
  segments: DialogSegment[];
}
```

### Exact Preserved State & Handlers
- `activeKey`: `string` ('wawancara' | 'hukum' | 'rapat' | custom uploaded ID)
- `transcriptData`: `DialogSegment[]`
- `speakerNames`: `{ [key: string]: string }`
- `editingSpeaker`: `string | null`
- `currentTime`: `number` (seconds)
- `isPlaying`: `boolean`
- `playbackSpeed`: `number` (1 | 1.25 | 1.5)
- `displayMode`: `'script' | 'segments'`
- `hoveredWaveSec`: `number | null`
- `activeSample`: Derived from `SAMPLES_DATA[activeKey]`
- `loadSample(key: string)`: Updates key, resets `currentTime = 0`, stops playback, updates `transcriptData`.
- `handleCustomFileUpload(e: React.ChangeEvent<HTMLInputElement>)`: Ingests audio, registers in `SAMPLES_DATA`, sets active key.
- `handleRenameSpeaker(oldName: string, newName: string)`: Updates `speakerNames` dictionary, affecting all instances across the transcript.
- `copyFullTranscript()`: Formats and writes full dialogue to clipboard.
- `exportWordDoc()`: Creates `.docx` MIME blob download.
- `exportSrt()`: Generates standard SubRip `.srt` format using `seconds` and offsets.
- `exportTxt()`: Creates clean `.txt` document download.

### Component Decomposition
To maintain clean architecture while preserving state:
1. `src/components/workspace/WorkspaceHeader.tsx`: Navigation back to landing, active file name, sample selector, audio upload button, model drawer trigger badge, and export action dropdown.
2. `src/components/workspace/ContinuousTranscriptEditor.tsx`: Document-style reader with borderless speaker turns, synchronized active line styling, inline speaker rename inputs, editable dialogue text, line numbers, and instant timestamp jump triggers.
3. `src/components/workspace/AudioDock.tsx`: Persistent bottom dock with Play/Pause button, timeline waveform scrubber, elapsed/total time readout, replay button, and speed controls.
4. `src/components/workspace/WhisperDrawer.tsx`: Slide-out sheet featuring model selection, static RAM requirement cards, and asynchronous 3-tier WebGPU diagnostics probe.

---

## 5. UI States & Resilience (Rule C-4 & R-27)

1. **Ready / Loaded State**:
   - The continuous transcript is rendered cleanly with speaker names and timestamps.
   - Bottom audio dock displays the loaded file's waveform and duration (`formatSeconds(currentTime)` / `activeSample.duration`).
2. **Loading / Processing State**:
   - Triggered when loading large audio files or switching heavy samples.
   - Top banner or progress bar displays *"Memproses audio lokal via WebGPU..."* with non-blocking feedback.
3. **Empty State**:
   - Occurs if user clears transcript or uploads an audio file with zero detected speech.
   - Displays clear, honest empty state: *"Belum ada segmen transkrip. Silakan pilih rekaman sampel atau unggah berkas audio lokal (.mp3, .wav, .m4a)."* with direct action buttons to reload samples.
4. **Error State**:
   - Occurs on unsupported file formats or invalid audio files.
   - Shows floating sharp-corner toast notification with actionable explanation: *"Format berkas tidak didukung. Harap gunakan berkas audio standar (MP3, WAV, atau M4A)."*

---

## 6. Verification Plan

### Automated Verification
- Run `compile_applet` and `lint_applet` to verify zero TypeScript errors, clean imports, and correct Tailwind v4 semantic utility resolution.

### Manual Verification Checklist
1. **Continuous Document Presentation**:
   - Verify transcript rows are NOT enclosed in separate card boxes or thick borders.
   - Verify vertical whitespace and typography cleanly demarcate speaker turns.
   - Verify only the currently playing segment receives the left navy accent bar and subtle surface tint.
2. **Data Structure & Synchronization**:
   - Verify clicking any timestamp (`▶ 00:15`) updates `currentTime` and seeks playback.
   - Verify editing speaker name updates all matching segments without losing text.
   - Verify editing text in `contentEditable` or input reflects immediately in state.
   - Verify .DOCX, .SRT, and .TXT exports produce valid formatted files with exact timestamps.
3. **Hardware Diagnostics**:
   - Open Whisper settings drawer.
   - Verify WebGPU probe checks both `navigator.gpu` and `requestAdapter()`.
   - Verify clean fallback to CPU/WebAssembly when WebGPU is unavailable, with transparent user copy.
   - Verify model memory requirements are explicitly labeled as static estimates.
4. **Persistent Audio Dock**:
   - Verify bottom dock remains accessible across all scroll positions.
   - Verify scrubbing waveform updates playback time seamlessly.
   - Verify speed changes (1x, 1.25x, 1.5x) scale playback speed accurately.
   - Verify all buttons satisfy minimum 44px touch target guidelines.
5. **Mobile Responsiveness**:
   - Verify responsive behavior on 375px viewport with no horizontal overflow.
