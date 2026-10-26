# Audio spike fixtures

The probe generates deterministic, non-sensitive silent PCM WAV files in browser memory. Fixture binaries are intentionally not committed.

Format: RIFF/WAVE, PCM signed 16-bit little-endian, mono, 16 kHz, standard 44-byte header.

| Fixture | Duration | Bytes | SHA-256 |
|---|---:|---:|---|
| `generated-120s.wav` | 120 s | 3,840,044 | `4395f2569b32c91407f267c835a96159b9d03c7a2303907ee10d716713ae1e0a` |
| `generated-1200s.wav` | 1,200 s | 38,400,044 | `3bb6524854ae983b27b2f4dd7e2c5d0b4876eb4004231b1ea7965f07b21b482d` |

Regenerate by opening `spikes/audio-chunking/?autorun=120` or `?autorun=1200` through Vite. The generator uses a zero-filled `ArrayBuffer`; silence is sufficient because this spike measures byte flow and simultaneously live buffers, not recognition accuracy.

No suitable local, non-sensitive MP3, M4A/AAC, or WebM/Opus fixtures were available. Those rows are recorded as `not measured`, not inferred from WAV behavior.
