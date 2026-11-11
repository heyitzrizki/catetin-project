# Decisions and Constraints

## Locked Product Decisions

- Web direction is cloud-first. Local-first remains available but is not the fundamental commercial workflow.
- Cloud audio must be private, access-controlled, and deletable by the user.
- Audio is not necessarily deleted immediately after transcription because users need later playback and transcript correction.
- Default cloud retention direction is 30 days; longer `until_deleted` retention depends on paid storage entitlement and includes a 30-day grace period after entitlement loss.
- Web and future Android clients should show the same cloud projects for the same account.
- Android must eventually support recording and editing itself, not merely redirect editing to web.
- Local Windows edition is a later product, likely sold through an annual license, and may require stronger hardware.

## Transcription and Quota Direction

- Planned provider: Deepgram Nova-3 Multilingual.
- Speaker diarization is optional per job.
- Standard transcription consumes 1 quota minute per audio minute.
- Speaker detection consumes 1.5 quota minutes per audio minute.
- The UI must explain the multiplier before processing, never deduct it silently.
- Example: 300 quota minutes support either 300 standard minutes, 200 diarized minutes, or a combination.

## Commercial Direction

- No permanent free cloud tier is planned.
- Low-friction first purchase direction: Rp10.000 for 30 minutes.
- Plan names under consideration: Coba, Plus, Pro, Team, plus top-ups.
- Plus/Pro/Team prices and storage entitlements are still product configuration, not schema constants, and must be revalidated before launch.
- Referral direction: reward after a qualifying paid transaction, not a free abuse-prone signup reward.
- Midtrans integration is deliberately postponed until the product is operationally ready.
- Midtrans target methods are QRIS and e-wallet; Virtual Account should be disabled if commercial configuration permits.

## R3 Upload Decisions

- Private Cloudflare R2 object storage.
- Browser uploads directly to presigned R2 UploadPart URLs; Worker is the control plane.
- 8 MiB multipart chunks, maximum three concurrent uploads.
- Planned upload ceiling: 2 GiB or 4 hours, subject to verified metadata and future product policy.
- Accepted direction: WAV, MP3, M4A, and WebM.
- Upload session lifetime: 24 hours.
- Incomplete multipart lifecycle cleanup: 7 days.
- Atomic replacement: old and new audio count against reservation until new audio becomes ready.
- Client part acknowledgements are untrusted hints; D1 is canonical for completion.
- Upload control belongs to the initiating user; workspace owner retains administrative abort/delete rights.
- Production bucket working name: `workspace-audio-prod`.
- Spike bucket: `workspace-audio-spike`.
- Bucket names are internal and rename-ready, not customer-facing brand promises.

## Security and Privacy Constraints

- Never store audio, transcripts, project titles, filenames, speaker names, tags, or search queries in analytics.
- Server logs must be structured and content-free.
- Never log signed URLs, upload IDs, access keys, authorization headers, raw OAuth data, or transcript contents.
- Never commit `.dev.vars`, `.env`, Wrangler credential state, Google OAuth secret, Better Auth secret, R2 keys, or Midtrans keys.
- Authentication, authorization, idempotency, quota reservation, and cleanup must fail closed.
- D1 is authoritative for cloud metadata and sync cursors; client state is not trusted authority.

## Engineering Constraints

- Follow `AGENTS.md`, including accessibility, honest copy, responsive states, and anti-fabrication rules.
- Avoid em dash characters in UI copy and generated code comments.
- Preserve unrelated user changes and untracked files.
- Use isolated commits and review corrective reports instead of trusting generated summaries blindly.
- Design and security-critical work requires stronger agent reasoning; mechanical edits may use a cheaper model.
