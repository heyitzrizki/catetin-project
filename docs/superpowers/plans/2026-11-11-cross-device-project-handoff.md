# Cross-Device Project Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat paket konteks Catetin yang aman, versioned, dan cukup lengkap agar Codex di laptop baru dapat melanjutkan proyek tanpa mengandalkan database percakapan lokal komputer kantor.

**Architecture:** Sumber konteks utama berupa dokumen Markdown terkurasi di `docs/handoff/`. Status teknis dan keputusan produk dipisah agar mudah diperbarui, sementara arsip percakapan hanya menyimpan ringkasan keputusan penting. R3B-A disimpan pada branch travel terpisah karena masih merupakan spike dan belum layak masuk production.

**Tech Stack:** Markdown, Git, GitHub private repository, PowerShell.

**Spec:** Permintaan pengguna pada 2026-11-11 untuk memindahkan konteks proyek dan kolaborasi AI ke repo private tanpa mengunggah data internal Codex atau credential.

## Global Constraints

- Jangan commit `C:\Users\neo\.codex`, `auth.json`, database SQLite Codex, `.dev.vars`, `.env`, token, credential, atau secret asli.
- Stage hanya file allowlist; seluruh `.design/**`, `docs/qa/**`, rencana lama, spike lama, dan file untracked pengguna tetap di luar commit.
- `main` menerima R3A dan context pack saja.
- Harness R3B-A disimpan pada branch `travel/r3b-a-spike`, bukan production `main`.
- Jangan deploy Worker, membuat bucket R2, mengaktifkan R2, atau menjalankan migration remote.

## Review Focus

- Dokumen tidak boleh memuat secret atau nilai credential nyata.
- Status commit dan branch harus membedakan deployed, committed lokal, dan uncommitted spike.
- Keputusan bisnis yang belum final harus ditandai draft, bukan fakta terkunci.
- Instruksi laptop harus dapat dijalankan dari clone bersih.
- Codex baru harus tahu batas R3B-A dan tidak menganggap local tests sebagai bukti interoperabilitas remote.

---

### Task 1: Curated Context Pack

**Files:**
- Create: `docs/handoff/README.md`
- Create: `docs/handoff/CATETIN_PROJECT_CONTEXT.md`
- Create: `docs/handoff/CURRENT_STATUS.md`
- Create: `docs/handoff/DECISIONS_AND_CONSTRAINTS.md`
- Create: `docs/handoff/AI_WORKING_GUIDE.md`
- Create: `docs/handoff/CONVERSATION_ARCHIVE.md`
- Create: `docs/handoff/START_HERE_ON_NEW_DEVICE.md`

**Interfaces:**
- Consumes: repository history, product roadmap, R3 design, current git status.
- Produces: versioned context source for human and AI collaborators.

- [ ] **Step 1:** Write the seven handoff documents with cross-links and explicit freshness dates.
- [ ] **Step 2:** Scan documents for credential patterns, private local paths, and unsupported claims.
- [ ] **Step 3:** Run `git diff --check` and manually inspect the staged allowlist.
- [ ] **Step 4:** Commit the handoff documents on `main`.
- [ ] **Step 5:** Push `main`, which also carries the already committed R3A design.

### Task 2: Preserve R3B-A Harness

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `spikes/r2-multipart-interoperability/**`

**Interfaces:**
- Consumes: R3 upload design and `aws4fetch`.
- Produces: isolated local/remote interoperability harness on a non-production branch.

- [ ] **Step 1:** Create branch `travel/r3b-a-spike` from the updated `main`.
- [ ] **Step 2:** Verify the harness contains placeholders only and remains isolated from `src/**`, `worker/**`, and production `wrangler.jsonc`.
- [ ] **Step 3:** Run the targeted spike tests and TypeScript lint.
- [ ] **Step 4:** Commit only the harness and dependency files.
- [ ] **Step 5:** Push `travel/r3b-a-spike` without deploying or provisioning Cloudflare resources.

### Task 3: Travel Handoff Verification

**Files:**
- Verify only.

**Interfaces:**
- Consumes: pushed Git refs.
- Produces: exact laptop bootstrap commands and remote commit hashes.

- [ ] **Step 1:** Verify `origin/main` and `origin/travel/r3b-a-spike` point to expected commits.
- [ ] **Step 2:** Confirm all unrelated untracked files remain untouched.
- [ ] **Step 3:** Report clone, checkout, install, test, and Codex bootstrap instructions.
