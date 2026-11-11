# Catetin Project Handoff

Dokumen di folder ini adalah sumber konteks lintas perangkat untuk Catetin. Tujuannya agar manusia atau AI collaborator baru dapat melanjutkan proyek tanpa membaca seluruh riwayat chat dan tanpa menyalin database internal Codex.

## Urutan Baca

1. [`START_HERE_ON_NEW_DEVICE.md`](START_HERE_ON_NEW_DEVICE.md)
2. [`CATETIN_PROJECT_CONTEXT.md`](CATETIN_PROJECT_CONTEXT.md)
3. [`CURRENT_STATUS.md`](CURRENT_STATUS.md)
4. [`DECISIONS_AND_CONSTRAINTS.md`](DECISIONS_AND_CONSTRAINTS.md)
5. [`AI_WORKING_GUIDE.md`](AI_WORKING_GUIDE.md)
6. [`CONVERSATION_ARCHIVE.md`](CONVERSATION_ARCHIVE.md)

Dokumen teknis otoritatif yang tetap harus dibaca:

- [`../product/rename-ready-cloud-renovation-roadmap.md`](../product/rename-ready-cloud-renovation-roadmap.md)
- [`../product/r2-cloud-data-model-design.md`](../product/r2-cloud-data-model-design.md)
- [`../product/r3-cloud-audio-upload-design.md`](../product/r3-cloud-audio-upload-design.md)
- [`../../AGENTS.md`](../../AGENTS.md)

## Batas Keamanan

Folder ini sengaja tidak berisi token, password, OAuth secret, Cloudflare credential, R2 access key, `.dev.vars`, database Codex, atau nilai rahasia lain. Secret harus dipasang kembali melalui secret manager dan login resmi pada perangkat baru.

**Terakhir diperbarui:** 11 November 2026, Asia/Seoul.
