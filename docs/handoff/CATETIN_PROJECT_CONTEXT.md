# Catetin Project Context

## Ringkasan Produk

Catetin adalah produk pengelolaan rekaman percakapan: merekam atau mengunggah audio, mentranskripsikannya, menyunting naskah, mengelompokkan project, lalu mengekspor hasil. Produk bermula sebagai local-first browser app, kemudian diputuskan beralih menjadi cloud-first agar transkripsi panjang lebih cepat, dapat digunakan lintas perangkat, dan memiliki model bisnis yang sehat.

Local transcription tidak dibuang. Versi lokal tetap dipertahankan sebagai kemampuan niche, fallback privasi, dan calon Windows Local Edition setelah web cloud terbukti. Jangan menghapus engine lokal, IndexedDB workspace, recording engine, atau backup `.catetin` hanya karena cloud pipeline sedang dibangun.

## Posisi Arsitektur Sekarang

- Frontend: React 19, TypeScript, Vite, Tailwind CSS, Radix UI.
- Runtime cloud: Cloudflare Worker.
- Database identitas dan cloud metadata: Cloudflare D1.
- Object storage target: Cloudflare R2 private bucket.
- Auth: Better Auth dengan Google OAuth.
- Current production origin: `https://catetin-project.anwars-rizki.workers.dev`.
- Planned cloud ASR: Deepgram Nova-3 Multilingual.
- Repository: private GitHub repository `heyitzrizki/catetin-project`.

## Produk yang Sudah Ada

- Landing page, pricing foundation, brand assets, responsive navigation, dan account center.
- Google OAuth, session management, account activity, and privacy-safe usage metadata.
- Studio local workspace: projects, recordings, folders, tags, search, editor, export, and local storage status.
- Local browser transcription with Whisper Tiny, bounded guardrails, chunking, checkpoint/resume, WebGPU to WASM fallback, and export.
- Direct local meeting recording with consent, pause/resume, recovery, durable draft checkpoint, and safe finalization.
- Portable `.catetin` workspace backup/import with integrity and zip-bomb guardrails.
- Cloud workspace D1 schema, membership authorization, monotonic sync engine, authenticated read/sync APIs, personal workspace bootstrap, and server-mapped mutation APIs.

## Product Direction

Fundamental web product is cloud-first with transparent privacy controls. Audio may be uploaded to private R2 storage so users can listen again, edit transcripts later, and access the same project on web and future Android clients. The product must never claim "zero cloud" for cloud workflows. It must clearly distinguish local processing from optional or primary cloud processing.

The product is rename-ready. `src/config/product-identity.ts` is the central identity source. "Catetin" remains the working name, but final brand and custom domain can change later without rewriting business logic.

## Current Delivery Chain

The official roadmap spans R0 to R14. Implementation has reached:

- R0/R1: baseline and rename-ready foundation complete.
- R2: cloud workspace data model, authorization, sync, bootstrap, and mutation APIs complete and deployed.
- R3A: cloud audio upload architecture design complete and committed locally.
- R3B-A: isolated R2 multipart interoperability harness implemented locally, but real Cloudflare R2/browser execution remains pending.

The next real decision gate is empirical R2 interoperability. Do not begin production upload APIs before the spike proves native Worker multipart completion, S3 presigned UploadPart, browser CORS exposure of `ETag`, and deterministic cleanup against actual Cloudflare R2.
