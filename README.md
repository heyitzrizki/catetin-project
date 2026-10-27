# Catetin

Catetin adalah aplikasi transkripsi dan pengolah naskah percakapan *local-first*. Rekaman audio, transkrip, project, folder, dan tag disimpan secara lokal di browser menggunakan IndexedDB.

## Fitur Utama

- **Local-First Audio & Transcription:** Whisper AI berjalan langsung di browser via Transformers.js (WebGPU/WASM). Berkas audio dan naskah tidak dikirim ke server.
- **Continuous Transcript Editor:** Penyuntingan segmen real-time dengan pemutar audio sinkron dan stempel waktu.
- **Portabilitas & Keamanan Data:** Ekspor dan impor arsip terenkapsulasi `.catetin` dengan verifikasi integritas SHA-256.
- **Account Foundation (Stage 4A):** Autentikasi akun Google opsional via Cloudflare Worker, Better Auth, dan Cloudflare D1. Mode guest tetap berfungsi penuh tanpa kewajiban login.

## Panduan Operasional

Untuk petunjuk konfigurasi Cloudflare D1, Worker secrets, dan Google OAuth, lihat:
[Panduan Operasional Pondasi Akun](docs/account-foundation-operations.md)

## Pengembangan Lokal

```bash
# Pasang dependensi
npm install

# Terminal 1: Jalankan Worker lokal (port 8787)
npx wrangler dev --port 8787

# Terminal 2: Jalankan server pengembangan Vite (port 3000, proxy /api)
npm run dev

# Jalankan pengujian unit
npm test

# Verifikasi tipe dan linting
npm run lint

# Buat berkas build produksi
npm run build
```
