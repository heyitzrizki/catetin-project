# Bounded-memory audio preparation spike

**Measured:** 2026-10-26  
**Host:** Windows 11 desktop  
**Harness:** `spikes/audio-chunking/`

## Outcome

One browser-native route is demonstrated as bounded: direct byte-range preparation for known PCM WAV input. No bounded browser-native route was demonstrated for containerized MP3, M4A/AAC, or WebM/Opus.

This is a deliberate gate result, not an implementation failure. WebCodecs accepts encoded codec chunks but does not demux ordinary media containers; the current W3C specification explicitly treats encoded input as non-containerized. A container parser/demuxer is therefore still required before `AudioDecoder` can process common recording files. Source: [W3C WebCodecs specification](https://www.w3.org/TR/webcodecs/).

## Measured matrix

Executable versions were read from the installed products. User-agent versions are reduced to `156.0.0.0` by the browsers.

| Browser | Fixture | Route | Max normalized PCM live | Measured working buffers | Result |
|---|---|---|---:|---:|---|
| Chrome 156.0.8078.47 | WAV PCM, 120 s, 3,840,044 B | `pcm-wav-blob-slice` | 35 s | 3,360,000 B | bounded |
| Chrome 156.0.8078.47 | WAV PCM, 1,200 s, 38,400,044 B | `pcm-wav-blob-slice` | 35 s | 3,360,000 B | bounded |
| Edge 156.0.4314.42 | WAV PCM, 120 s, 3,840,044 B | `pcm-wav-blob-slice` | 35 s | 3,360,000 B | bounded |
| Edge 156.0.4314.42 | WAV PCM, 1,200 s, 38,400,044 B | `pcm-wav-blob-slice` | 35 s | 3,360,000 B | bounded |

The 30-second core chunk plus five-second overlap held one normalized `Float32Array` at a time. The measured working-buffer count includes the current Int16 source slice and Float32 normalized slice. It does not include the browser-owned input `Blob`, model memory, inference tensors, or browser overhead. The stable 3.36 MB figure across 2-minute and 20-minute inputs demonstrates that preparation working buffers do not scale with recording duration for this route.

## Rejected or unavailable routes

| Input/route | Chrome Windows | Edge Windows | Safari/macOS/iPadOS | Reason |
|---|---|---|---|---|
| `decodeAudioData` for any complete file | rejected | rejected | not measured | Requires complete file bytes and complete decoded PCM before chunking; splitting afterward is not bounded preparation. |
| WebCodecs `AudioDecoder` with MP3/M4A/WebM container | unavailable | unavailable | not measured | Browser API supplies codec decoding, not container demuxing. No valid demux path exists in the current project. |
| Media element + Web Audio capture | rejected | rejected | not measured | Playback-oriented and not a deterministic faster-than-real-time extraction route. |
| MP3 fixture | not measured | not measured | not measured | No non-sensitive fixture and no container demux adapter in this spike. |
| M4A/AAC fixture | not measured | not measured | not measured | No non-sensitive fixture and no container demux adapter in this spike. |
| WebM/Opus fixture | not measured | not measured | not measured | No non-sensitive fixture and no container demux adapter in this spike. |

No Safari hardware was available. No Safari result is inferred from Chromium.

## Stage 1B adapter decision

Accepted without a design change:

- Implement a bounded streaming adapter for supported PCM WAV layouts using `Blob.slice`, incremental mono conversion/resampling, one current normalized chunk, and declared overlap.
- Keep `decodeAudioData` only as a guarded compatibility route for short compressed recordings. Its decoded-memory estimate and device-specific ceiling must be checked before work starts, and it must never be described as bounded.

Not accepted:

- Splitting a complete `AudioBuffer` after `decodeAudioData`.
- Claiming long-recording support for MP3, M4A/AAC, or WebM/Opus from these WAV measurements.
- Passing container bytes directly to WebCodecs without a demuxer.

Decision required before the Stage 1B plan:

1. **Narrow alpha:** ship bounded long-recording support for PCM WAV and conservative whole-file limits for compressed formats.
2. **Add targeted demuxers:** investigate small, format-specific demuxers feeding WebCodecs for the common compressed formats, then amend and benchmark the design.
3. **Adopt FFmpeg/WASM:** broader compatibility at the cost of download size, memory, and complexity; this requires a design amendment and was intentionally excluded from Stage 1A.

The spike recommends option 1 for the fastest private alpha only if the limitation is acceptable to testers. If common long MP3/M4A recordings are required for alpha, option 2 should be investigated before planning Stage 1B. Option 3 remains the fallback, not the default.
