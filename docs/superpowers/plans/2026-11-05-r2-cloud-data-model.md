# R2 Cloud Data Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengimplementasikan skema data model cloud, integritas referensial multi-tenant berbasis composite foreign keys, kontrak sinkronisasi delta berbasis monotonic sequence, validasi otorisasi workspace, kontrol konkurensi optimistik, dan kontrak durable account deletion outbox pada Cloudflare D1 tanpa mengubah kode antarmuka frontend, tanpa mengubah format penyimpanan *local-first*, dan tanpa memanggil layanan eksternal Cloudflare R2 atau Cloudflare Queue.

**Architecture:** Skema cloud menggunakan Cloudflare D1 (SQLite) dengan partisi peran multi-tenant (`workspace_membership`), tabel rekaman terstruktur, model dokumen transkrip kanonikal di D1 (maksimal 1 MB safety limit dihitung dari panjang byte UTF-8), log perubahan monotonik (`workspace_change_log`) untuk sinkronisasi delta berbasis sequence mencakup seluruh syncable entities (project, folder, recording, transcript, tag, audio_asset, speaker, recording_tag), penanganan idempotensi mutasi berskala `(workspace_id, user_id, client_mutation_id)` (retensi 7 hari), serta antrean penghapusan akun berdaya tahan tinggi (`account_deletion_job` dan `account_deletion_object`) yang dapat bertahan hidup secara mandiri tanpa cascade dari tabel `user`.

**Tech Stack:** TypeScript, Cloudflare Workers, Cloudflare D1, SQLite, Vitest / Node tsx test runner.

**Spec:** `docs/product/r2-cloud-data-model-design.md`

---

## Batasan & Prinsip Utama (Global Constraints)

- **Rename-Ready:** Seluruh tabel, kolom, fungsi pembantu, dan tipe data tidak boleh menyertakan nama brand tertentu.
- **Isolasi Penuh dari Frontend:** Tidak memodifikasi komponen React di bawah `src/` atau format IndexedDB lokal v2 (`workspace-store.ts`).
- **Pelestarian Mode Guest:** Pengguna lokal tanpa akun tidak terpengaruh oleh kueri cloud ini.
- **Penanganan Zero Em Dash:** Dilarang menggunakan karakter em dash dalam kode maupun dokumentasi.
- **TDD Disiplin:** Setiap tugas wajib dimulai dengan pembuatan unit test yang gagal sebelum penulisan kode implementasi.
- **Batas Ruang Lingkup R2A:** R2A hanya mengimplementasikan Task 1 (Types/DTO) dan Task 2 (Migration 0004 D1) beserta targeted tests. Task 3 sampai Task 6 dialokasikan untuk fase berikutnya.

---

## Fokus Tinjauan Kualitas & Test Matrix

Targeted tests wajib mencakup skenario:
1. **Ordering sequence sinkronisasi:** Dua mutasi dengan timestamp identik tetap terurut rapi tanpa kehilangan data berdasarkan `change_seq`.
2. **Kursor sinkronisasi & kedaluwarsa:** Permintaan delta dengan `since_seq < min_valid_sync_seq` mengembalikan galat terstruktur `FULL_RESYNC_REQUIRED` (`minValidSeq`, `currentSeq`), sedangkan `since_seq = min_valid_sync_seq` tetap valid. Purge worker pada fase berikutnya wajib memperbarui `min_valid_sync_seq` dalam transaksi atomik yang sama dengan penghapusan baris change-log.
3. **Pencegahan kebangkitan entitas terhapus (no resurrection):** Mutasi offline lama terhadap entitas dengan `deleted_at IS NOT NULL` ditolak.
4. **Idempotensi muatan identik:** Kunci idempotensi yang sama dengan payload identik dalam scope user dan workspace yang sama mengembalikan respons kanonikal yang sama.
5. **Konflik idempotensi muatan berbeda:** Kunci idempotensi yang sama dengan payload berbeda ditolak dengan status HTTP 409.
6. **Idempotensi lintas scope:** Kunci idempotensi sama dari user berbeda atau workspace berbeda diperbolehkan.
7. **Folder per project:** Folder wajib bernaung di bawah project, tidak ada nested folder, dan recording menolak penautan folder dari project atau workspace lain.
8. **Folder deletion safety:** Menghapus folder otomatis menyetel `recording.folder_id` menjadi `NULL`, bukan menghapus rekaman.
9. **Project hard delete restriction:** Hard delete project yang masih memiliki rekaman aktif ditolak oleh `ON DELETE RESTRICT` hingga seluruh rekaman dilepas dari folder dan project.
10. **Transcript revision multiplicity:** Satu transcript dapat memiliki banyak revisi bertahap dengan composite FK tunggal `(workspace_id, transcript_id, recording_id) REFERENCES transcript(workspace_id, id, recording_id)`.
11. **Multi-tenant referential integrity:** Composite foreign keys menolak relasi cross-workspace pada project, folder, recording, audio_asset, speaker, transcript, transcript_revision, dan recording_tag.
12. **Perlindungan pemilik terakhir tim:** Pemilik terakhir pada workspace tim ditolak saat mencoba menghapus akun (`LAST_TEAM_OWNER_CANNOT_DELETE`).
13. **Penghapusan akun setelah transfer kepemilikan:** Setelah kepemilikan tim dialihkan, penghapusan akun dapat dimulai.
14. **Kelestarian team workspace saat user keluar:** Shared team workspace tidak ikut terhapus ketika pengguna anggota (*member*) menghapus akunnya.
15. **Pencabutan akses seketika:** Sesi login valid tetap ditolak jika status keanggotaan pengguna di workspace telah dicabut.
16. **Pencegahan tebakan resource:** Kueri rekaman pada workspace lain mengembalikan status HTTP 404 (bukan 403).
17. **Uji batas ukuran transkrip 1 MB riil D1:** Pengujian batas ukuran dihitung berdasarkan panjang byte UTF-8 serialisasi. Naskah mendekati 1 MB berhasil disimpan via bound parameter INSERT/UPDATE; naskah melebihi batas ditolak sebelum kueri dieksekusi.
18. **Konflik konkurensi optimistik:** Ketidakcocokan versi pada operasi CAS mengembalikan status HTTP 409 dan snapshot data server terkini tanpa menimpa versi server.
19. **Durable deletion progress & retry:** Pekerjaan penghapusan akun dapat dicoba ulang (*retryable*) saat gagal di tengah proses pembersihan objek R2.
20. **Integritas urutan pembersihan:** Baris konten D1 tidak boleh dihapus sebelum seluruh objek R2 terkonfirmasi berstatus `deleted`.
21. **Kelangsungan hidup deletion job:** Baris `account_deletion_job` dan `account_deletion_object` tetap bertahan dan dapat dibaca meskipun baris identitas `user` telah dipurge dari database.
22. **Normalisasi Tag Handal:** Tag dinormalisasi (trim, lowercase, whitespace collapse) sehingga dua tag dengan representasi ekuivalen dalam satu workspace ditolak.
23. **Audit Index & Query Plan:** Tepat 16 indeks eksplisit aktual diverifikasi menggunakan `EXPLAIN QUERY PLAN` memanfaatkan indeks tanpa full table scan.
24. **Privasi Kunci Objek:** Public DTO tidak mengekspos kunci internal R2 (`r2_key` / `object_key`).

---

### Task 1: Type Definitions & DTO Contracts (Selesai pada R2A)

Mendefinisikan kontrak tipe data TypeScript netral untuk workspace, project, folder per project, rekaman, transkrip kanonikal, perubahan sequence, idempotensi, dan penghapusan akun outbox.

**Files:**
- Create: `worker/types/cloud-model.ts`
- Create: `tests/cloud-model/cloud-model-types.test.ts`

**Interfaces:**
- Produces: `WorkspaceDTO`, `WorkspaceMembershipDTO`, `ProjectDTO`, `FolderDTO` (dengan projectId, tanpa parent_id), `RecordingDTO`, `TranscriptDTO`, `AudioAssetDTO`, `SpeakerDTO`, `RecordingTagDTO`, `TagDTO`, `SyncChangeItem`, `SyncDeltaRequest`, `SyncDeltaResponse`, `FullResyncRequiredResponse`, `AccountDeletionJobDTO`.

- [x] **Step 1: Tulis tes tipe data yang gagal**
- [x] **Step 2: Jalankan tes dan konfirmasi kegagalan**
- [x] **Step 3: Implementasikan minimal tipe data TypeScript**
- [x] **Step 4: Jalankan tes dan konfirmasi berhasil**

---

### Task 2: D1 Database Migration Specification (Selesai pada R2A)

Menyusun berkas migrasi SQL versioned Cloudflare D1 untuk skema workspace, rekaman, transkrip kanonikal, log perubahan sequence, idempotensi, ledger impor, serta outbox penghapusan akun berdaya tahan tinggi.

**Files:**
- Create: `migrations/0004_cloud_workspace_data_model.sql`
- Create: `tests/cloud-model/migration-0004.test.ts`

**Specifications:**
- Menambahkan 16 tabel inti: `workspace` (dengan `latest_change_seq` dan `min_valid_sync_seq`), `workspace_membership`, `project`, `folder` (flat per project), `tag` (dengan normalized_name), `recording` (folder_id ON DELETE SET NULL, project_id ON DELETE RESTRICT), `audio_asset` (retention tier 7d/30d/until_deleted), `recording_tag`, `speaker`, `transcript`, `transcript_revision`, `workspace_change_log`, `mutation_idempotency` (retensi 7 hari), `import_ledger`, `account_deletion_job` (tanpa ON DELETE CASCADE ke user), `account_deletion_object` (relasi per objek R2).
- Menambahkan trigger penegakan scope folder rekaman: `trg_recording_folder_check_ins` dan `trg_recording_folder_check_upd`.
- Menambahkan composite foreign keys untuk multi-tenant referential integrity.
- Menambahkan tepat 16 indeks non-redundant yang terverifikasi via `EXPLAIN QUERY PLAN`.

- [x] **Step 1: Tulis tes integritas sintaks SQL migrasi**
- [x] **Step 2: Jalankan tes dan konfirmasi kegagalan**
- [x] **Step 3: Buat berkas migrasi `migrations/0004_cloud_workspace_data_model.sql`**
- [x] **Step 4: Jalankan tes dan konfirmasi berhasil**

---

### Task 3: Workspace Authorization & Team Ownership Helpers (Fase R2B)

Membangun modul pembantu otorisasi untuk memvalidasi keanggotaan pengguna, perlindungan pemilik terakhir tim, dan isolasi antar workspace.

**Files:**
- Create: `worker/workspace/workspace-auth.ts`
- Create: `tests/cloud-model/workspace-auth.test.ts`

---

### Task 4: Monotonic Change Log & Sync Engine (Fase R2B)

Membangun modul pemroses sinkronisasi delta berbasis monotonic sequence, penanganan kursor kedaluwarsa, dan deteksi idempotensi mutasi.

**Files:**
- Create: `worker/workspace/sync-engine.ts`
- Create: `tests/cloud-model/sync-engine.test.ts`

---

### Task 5: Optimistic Concurrency & Transcript Mutation Handler (Fase R2C)

Membangun modul penyimpanan naskah transkrip kanonikal di D1 dengan kontrol versi CAS dan penegakan batas keamanan 1 MB byte UTF-8.

**Files:**
- Create: `worker/workspace/transcript-store.ts`
- Create: `tests/cloud-model/transcript-store.test.ts`

---

### Task 6: Account Deletion Durable Outbox Contract (Fase R2C)

Membangun kontrak dan mesin status penghapusan akun berdaya tahan tinggi pada tabel `account_deletion_job` dan `account_deletion_object`.

**Files:**
- Create: `worker/workspace/account-deletion-job.ts`
- Create: `tests/cloud-model/account-deletion-job.test.ts`

---

## Verifikasi Akhir

Setelah seluruh tahapan disetujui dan diimplementasikan:
1. Jalankan seluruh unit test suite:
   ```powershell
   npm.cmd test
   ```
2. Jalankan pemeriksaan linter:
   ```powershell
   npm.cmd run lint
   ```
3. Verifikasi ketiadaan whitespace atau konflik:
   ```powershell
   git diff --check
   ```
