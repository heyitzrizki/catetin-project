# Phase R3B-A: Cloudflare R2 Multipart Interoperability Spike

Harness terisolasi untuk membuktikan secara empiris interoperabilitas antara:
1. Native Cloudflare Worker R2 binding (`createMultipartUpload`, `resumeMultipartUpload().complete()`, `head()`, `delete()`, `abort()`, `list()`).
2. Pustaka resmi `aws4fetch` (`AwsClient`) dengan konstruksi URL terstruktur (`URL` dan `URLSearchParams`) tanpa double-encoding.
3. Unggahan langsung dari browser ke presigned `UploadPart` URL R2 (3 part: `8 MiB + 8 MiB + 2 MiB = 18 MiB`), pembacaan header `ETag` lintas CORS (`Access-Control-Expose-Headers: ETag`), dan pembersihan deterministik tanpa meninggalkan orphan.

Seluruh kode dan konfigurasi dalam direktori ini terisolasi penuh dan tidak diimpor oleh kode produksi (`worker/**` maupun `src/**`).

---

## Struktur File Harness

- `wrangler.spike.jsonc`: Konfigurasi Wrangler khusus spike (`catetin-r2-multipart-spike`) yang mengikat `AUDIO_SPIKE_BUCKET` ke bucket `workspace-audio-spike` tanpa mengubah `wrangler.jsonc` produksi.
- `.dev.vars.example`: Contoh template variabel secret lokal tanpa nilai kredensial asli.
- `cors-spike.json`: Aturan CORS format Cloudflare R2 API (`rules[].allowed`, `exposeHeaders: ["ETag", ...]`) untuk origin lokal.
- `lifecycle-spike.json`: Aturan lifecycle R2 untuk membatalkan incomplete multipart upload setelah 7 hari (`604800` detik) pada prefix `v1/spike/`.
- `protocol.ts`: Kontrak tipe data, ukuran part (`8 MiB`, `2 MiB`, total `18 MiB`), `runId`, `objectKeySha256Prefix`, dan skema laporan.
- `presigner.ts`: Konstruksi URL terstruktur via `URL` dan `URLSearchParams` serta penandatanganan presigned `PUT` menggunakan `AwsClient` resmi dari `aws4fetch`.
- `worker.ts`: Worker handler terisolasi yang menegakkan `Authorization: Bearer <SPIKE_CONTROL_TOKEN>` (constant-time SHA-256 digest comparison) pada seluruh endpoint kontrol dan menjalankan operasi native R2 binding.
- `runner.ts`: Pembuat payload deterministik 18 MiB, HTTP control-plane client (mengirim `Authorization` hanya ke Worker, tidak pernah ke presigned R2 URL), pengunggah paralel (maksimal 3 paralel), validator `ETag`, dan pembersih otomatis di blok `finally`.
- `browser-runner.ts` & `browser-runner.html`: Harness browser nyata untuk memvalidasi preflight CORS dan eksposur header `ETag` langsung dari browser Chrome/Edge ke Cloudflare R2.
- `tests/r2-multipart-spike.test.ts`: Unit tests lokal untuk logika presigning `aws4fetch`, encoding `uploadId`, part slicing, autentikasi token, dan pemilihan cleanup. *(Catatan: Node unit tests menguji logika kode secara lokal dan tidak diklaim sebagai bukti CORS browser nyata).*

---

## Tabel Environment Variables & Secrets (`spikes/r2-multipart-interoperability/.dev.vars`)

Salin `.dev.vars.example` menjadi `spikes/r2-multipart-interoperability/.dev.vars` (diabaikan oleh Git). Jangan pernah menyimpan secret asli di dalam Git:

| Nama Variabel | Sumber | Keterangan |
| :--- | :--- | :--- |
| `R2_ACCOUNT_ID` | `wrangler.spike.jsonc` (`vars`) | `56304fb6c6e984eec2317ec554802a2d` |
| `R2_SPIKE_BUCKET_NAME` | `wrangler.spike.jsonc` (`vars`) | `workspace-audio-spike` |
| `SPIKE_ALLOWED_ORIGIN` | `wrangler.spike.jsonc` (`vars`) | `http://localhost:3000` |
| `R2_ACCESS_KEY_ID` | `.dev.vars` (Secret) | Access Key ID dari R2 API Token (scoped ke `workspace-audio-spike`) |
| `R2_SECRET_ACCESS_KEY` | `.dev.vars` (Secret) | Secret Access Key dari R2 API Token |
| `SPIKE_CONTROL_TOKEN` | `.dev.vars` (Secret) | Token bearer acak ber-entropi tinggi (minimal 32 karakter hex) |

---

## Cara Menjalankan Unit Tests Lokal

```powershell
npx.cmd tsx --test spikes/r2-multipart-interoperability/tests/r2-multipart-spike.test.ts
```

---

## Urutan Eksekusi Remote & Browser CORS Test (Setelah R2 Diaktifkan & Disetujui)

1. **Buat Bucket Spike & Terapkan CORS + Lifecycle:**
   ```powershell
   npx.cmd wrangler r2 bucket create workspace-audio-spike
   npx.cmd wrangler r2 bucket cors set workspace-audio-spike --file spikes/r2-multipart-interoperability/cors-spike.json --force
   npx.cmd wrangler r2 bucket lifecycle set workspace-audio-spike --file spikes/r2-multipart-interoperability/lifecycle-spike.json --force
   ```

2. **Jalankan Spike Worker dengan Remote R2 Binding (Port 8789):**
   ```powershell
   npx.cmd wrangler dev --config spikes/r2-multipart-interoperability/wrangler.spike.jsonc --remote --port 8789
   ```

3. **Jalankan Real Browser CORS Test (Port 3000):**
   - Jalankan server dev lokal Vite:
     ```powershell
     npm.cmd run dev
     ```
   - Buka halaman harness di Google Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe`):
     `http://localhost:3000/spikes/r2-multipart-interoperability/browser-runner.html`
   - Masukkan nilai `SPIKE_CONTROL_TOKEN` ke input in-memory dan klik **Run 18 MiB Browser Multipart Spike**.
   - Verifikasi pada `#spike-report-output` bahwa:
     - `succeeded: true`
     - `verifiedHeadBytes: 18874368`
     - `uploadedPartsCount: 3`
     - `cleanup.action: "delete_object"` dan `cleanup.succeeded: true`

4. **Verifikasi Bucket Kosong Sebelum Penghapusan Bucket:**
   - Pastikan `cleanup.succeeded === true` dan verifikasi bucket kosong melalui endpoint `/spike/multipart/verify-empty` serta info bucket:
     ```powershell
     npx.cmd wrangler r2 bucket info workspace-audio-spike --json
     ```
   - Hanya hapus bucket `workspace-audio-spike` apabila `object_count` adalah `0` dan tidak ada multipart aktif:
     ```powershell
     npx.cmd wrangler r2 bucket delete workspace-audio-spike
     ```
