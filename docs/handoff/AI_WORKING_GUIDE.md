# AI Working Guide

## First Instruction for a New Codex Session

Use this prompt after cloning and opening the repository:

> Baca `AGENTS.md` dan seluruh `docs/handoff/README.md` beserta urutan dokumennya. Lalu baca `docs/product/rename-ready-cloud-renovation-roadmap.md` dan `docs/product/r3-cloud-audio-upload-design.md`. Jangan mengubah kode dulu. Laporkan pemahamanmu tentang status terakhir, branch yang harus dipakai, blocker R3B-A, keputusan bisnis yang masih draft, dan lima tindakan yang dilarang. Jangan membaca atau menampilkan secret.

## Collaboration Style

- Communicate in concise Indonesian unless English is clearer for exact technical contracts.
- Lead with the outcome, risk, or decision needed.
- Avoid repeated full test runs for every tiny correction. Use targeted tests during iteration, then one full gate before commit/release.
- Do not overengineer a small task.
- Do not infer permission for deploy, payment activation, remote migration, account mutation, or secret creation.
- Preserve local user files and unrelated dirty worktree changes.
- Reports must distinguish: designed, locally tested, committed, pushed, deployed, and manually verified.

## Agent Routing

Use a stronger architecture/reasoning model such as Argon for:

- authentication and authorization;
- database migrations and transactional consistency;
- idempotency, concurrency, sync, quotas, billing, and payment;
- R2 multipart upload, presigning, cleanup, and security review;
- production release gates and unfamiliar platform behavior.

Use Gemini Flash 3.8 or another economical model for:

- mechanical copy changes;
- isolated styling adjustments with an approved visual target;
- routine documentation formatting;
- narrow test updates after the contract is already fixed;
- commit/push instructions with an explicit allowlist.

If a Flash task requires more than one corrective security pass, stop saving credits and route the next pass to Argon.

## Standard Workflow

1. Audit the exact current state and relevant files only.
2. State scope, non-goals, and risks.
3. For architecture work, produce a design before implementation.
4. Implement in small isolated phases.
5. Run targeted tests.
6. Perform corrective review focused on real failure modes.
7. Run one full test/lint/build/diff gate before committing.
8. Commit with an exact allowlist.
9. Push/deploy/migrate only after explicit instruction.
10. Report evidence and remaining manual verification honestly.

## Common Failure Patterns to Avoid

- Running long browser or hardware tests indefinitely without a timeout.
- Leaving Node/tsx tasks alive after tests finish.
- Treating mocked browser tests as real hardware or cloud evidence.
- Changing production configuration for a spike.
- Uploading credentials through chat or Git.
- Repeating copy labels, creating enormous empty layouts, or making navigation that duplicates the same content.
- Claiming production readiness before physical microphone, real browser, provider, and payment workflows are verified.
