# Catetin Account Foundation Operations Guide

Panduan operasional dan deployment untuk autentikasi akun Google berbasis Cloudflare Worker, Better Auth, dan Cloudflare D1 pada Catetin.

---

## 1. Prinsip Local-First dan Batasan Data

Catetin dirancang dengan arsitektur **local-first**:
1. **Penyimpanan Konten Lokal:** Audio rekaman, naskah transkrip, judul rekaman, nama berkas, metadata project, folder, tag, nama pembicara, dan kueri pencarian lokal disimpan **secara lokal di browser pengguna** (IndexedDB). Data konten ini tidak pernah dikirim atau disimpan di server cloud.
2. **Penyimpanan Akun di Cloud:** Hanya identitas akun pengguna (nama, email, avatar) dan token sesi yang disimpan di server cloud (Cloudflare D1) melalui Better Auth dengan HTTP-only cookies aman.
3. **Guest Mode Sepenuhnya Berfungsi:** Pengguna dapat menggunakan seluruh fitur Studio dan landing page tanpa kewajiban login. Login bersifat opsional untuk mengaitkan profil akun.
4. **Resiliensi Kegagalan:** Jika layanan akun (auth/D1) offline atau mengalami gangguan jaringan, aplikasi tetap berfungsi normal sebagai guest tanpa hambatan.

---

## 2. Arsitektur Komponen

- **Worker Entrypoint (`worker/index.ts`, `worker/env.ts`):** Mengelola rute `/api/health` dan `/api/auth/*`. Di `wrangler.jsonc`, `run_worker_first: ["/api/*"]` memastikan Worker-first routing hanya berlaku pada rute API. Seluruh aset statis dan navigasi SPA dialihkan ke Cloudflare Assets binding (`env.ASSETS`).
- **Better Auth Server (`worker/auth.ts`, `worker/http.ts`):** Mengelola sesi berbasis HTTP-only cookie aman dan integrasi Google OAuth dengan validasi canonical origin dan allowlist ketat.
- **Cloudflare D1 Database (`catetin-account`):** Menyimpan tabel sesi dan identitas akun (`user`, `session`, `account`, `verification`) via migrasi versioned `migrations/0001_better_auth.sql` dengan validasi skema bawaan aktif.
- **Browser Client (`src/features/account/`):** React hook `useAccountSession` dengan 4 status (`loading`, `guest`, `authenticated`, `unavailable`). Session server selalu menjadi sumber kebenaran (kegagalan sign-out tidak memalsukan status guest).
- **Header Control (`src/components/account/AccountControl.tsx`):** Kontrol login minimal pada header yang memenuhi target sentuh 44px, navigasi keyboard, tombol retry saat unavailable, dan proteksi in-flight double-action.

---

## 3. Langkah Setup oleh Owner (Cloudflare & Google)

> **PENTING:** Jangan pernah melakukan commit rahasia nyata (client secret, auth secret) atau database ID privat ke dalam repositori Git.

### A. Persiapan Cloudflare D1

1. **Buat Database D1 di Cloudflare:**
   ```bash
   npx wrangler d1 create catetin-account
   ```
   Wrangler akan menampilkan output berupa `database_name` dan `database_id`.

2. **Perbarui `wrangler.jsonc` Lokal:**
   Ganti nilai placeholder `"placeholder-catetin-account-id"` dengan ID database asli pada mesin lokal / pipeline sebelum deploy.

3. **Terapkan Migrasi ke D1:**
   - Untuk database lokal (pengembangan):
     ```bash
     npx wrangler d1 migrations apply catetin-account --local
     ```
   - Untuk database produksi (Cloudflare remote):
     ```bash
     npx wrangler d1 migrations apply catetin-account --remote
     ```

### B. Konfigurasi Secret Worker

Atur rahasia produksi menggunakan perintah Wrangler Secret (rahasia disimpan aman di Cloudflare, bukan di repositori):

```bash
# Buat string acak 32 karakter atau lebih untuk secret Better Auth:
npx wrangler secret put BETTER_AUTH_SECRET

# Masukkan Client ID dari Google Cloud Console:
npx wrangler secret put GOOGLE_CLIENT_ID

# Masukkan Client Secret dari Google Cloud Console:
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

### C. Konfigurasi Google Cloud Console OAuth 2.0

1. Buka [Google Cloud Console](https://console.cloud.google.com/) -> **APIs & Services** -> **Credentials**.
2. Buat atau pilih OAuth 2.0 Client ID dengan tipe **Web application**.
3. **Authorized JavaScript origins:**
   - `http://localhost:3000` (pengembangan frontend Vite)
   - `http://127.0.0.1:3000` (alternatif loopback)
   - `http://localhost:8787` (pengembangan Wrangler dev lokal)
   - `https://catetin-project.anwars-rizki.workers.dev` (domain Worker produksi)
4. **Authorized redirect URIs:**
   - `http://localhost:3000/api/auth/callback/google` (alur dev lokal via Vite proxy)
   - `https://catetin-project.anwars-rizki.workers.dev/api/auth/callback/google` (alur produksi)
   - `http://localhost:8787/api/auth/callback/google` (alur dev Worker langsung)

---

## 4. Alur Pengembangan Lokal (Vite + Wrangler)

Untuk menjalankan frontend dan backend Worker secara sinkron di lokal:

1. **Siapkan File Rahasia Lokal (`.dev.vars`):**
   Buat file `.dev.vars` pada root project (file ini diabaikan oleh `.gitignore`):
   ```env
   BETTER_AUTH_SECRET=local-dev-secret-string-minimal-32-chars-long
   GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-google-client-secret
   APP_ORIGIN=http://localhost:3000
   ```

2. **Terminal 1: Jalankan Worker Lokal:**
   ```bash
   npx wrangler dev --port 8787
   ```
   Worker berjalan di `http://127.0.0.1:8787` dengan D1 lokal dan secret dari `.dev.vars`.

3. **Terminal 2: Jalankan Frontend Vite:**
   ```bash
   npm run dev
   ```
   Vite berjalan di `http://localhost:3000`. Request `/api/*` secara otomatis diproxy ke `http://localhost:8787/api/*` tanpa mengirim data workspace.

---

## 5. Deployment dan Rollback

### Deployment ke Produksi
```bash
# 1. Pastikan seluruh test dan build lulus
npm test
npm run lint
npm run build

# 2. Deploy Worker dan static assets
npx wrangler deploy
```

### Rollback Cepat
Jika terjadi masalah konfigurasi pada Worker produksi:
```bash
npx wrangler rollback
```

---

## 6. Rencana Tahapan Berikutnya

- **Stage 4A (Selesai):** Account Foundation (Worker, Better Auth, D1, Google sign-in, resilient guest state).
- **Stage 4B (Berikutnya):** Account & Usage (sinkronisasi profil akun, quota meter penggunaan Whisper lokal/cloud assist bila relevan).
- **Stage 4C:** Entitlement dan Pembayaran (paket Free/Pro dan gerbang lisensi).
