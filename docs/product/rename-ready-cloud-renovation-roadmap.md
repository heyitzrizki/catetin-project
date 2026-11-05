# Roadmap Resmi Renovasi Catetin: Menuju Cloud-First Rename-Ready

Dokumen ini mendefinisikan keputusan arsitektur, arah produk, model ekonomi, serta peta jalan pelaksanaan (roadmap) renovasi Catetin dari aplikasi web *local-first* menjadi layanan transkripsi audio panjang berbasis cloud (*cloud-first*) yang *rename-ready*.

---

## 1. Latar Belakang & Alasan Renovasi

Catetin bermula sebagai pembuktian konsep (PoC) transkripsi *in-browser local-first* menggunakan Whisper via WebAssembly (WASM) dan WebGPU. Meskipun berhasil membuktikan bahwa inferensi lokal dapat berjalan di peramban, model *local-first murni* memiliki batasan fundamental bagi pengguna nyata:

1. **Keterbatasan Durasi & Sumber Daya:** Transkripsi audio panjang (>30–60 menit) memerlukan alokasi memori besar dan pemrosesan komputasi intensif yang kerap mengalami *out-of-memory* (OOM) atau crash pada perangkat laptop standar, tablet, dan ponsel.
2. **Keterikatan Layar & Daya Tahan Baterai:** Pemrosesan lokal mengharuskan peramban dan tab tetap aktif. Pengguna tidak dapat menutup laptop atau beralih aplikasi saat transkripsi rapat 2 jam sedang berlangsung.
3. **Kebutuhan Kolaborasi:** Pengguna membutuhkan hasil transkripsi yang dapat diakses lintas perangkat dan dibagikan ke anggota tim tanpa memindahkan berkas database manual.

Oleh karena itu, Catetin diputuskan berevolusi menjadi produk **Cloud-First** yang andal untuk audio panjang, pemisahan pembicara (*speaker diarization*), serta penyimpanan aman, dengan tetap mempertahankan mode *local-first* sebagai nilai tambah privasi bagi pengguna yang menginginkannya.

---

## 2. Prinsip Arsitektur "Rename-Ready"

Nama **“Catetin”** saat ini digunakan sebagai *working brand* selama fase *private alpha/beta*. Nama produk, logo, serta domain produksi final dapat diperbarui sebelum rilis publik komersial.

Untuk menghindari pengerjaan ulang di masa mendatang, seluruh kode dan infrastruktur baru wajib menerapkan prinsip **Rename-Ready**:
- **Satu Sumber Konfigurasi Identitas:** Nama brand, logo, domain, dan kontak didefinisikan secara terpusat pada file konfigurasi bertipe data ketat (`src/config/product-identity.ts`).
- **Pemisahan Logika Bisnis & Identitas:** Modul transkripsi, kuota, billing, dan database tidak boleh bergantung pada string nama brand tertentu.
- **Identifier Internal Netral:** Penamaan tabel baru, kunci API, bucket penyimpanan, dan skema menggunakan kata umum yang netral (seperti `workspace`, `transcripts`, `audio`, `billing_accounts`), bukan nama brand.
- **Legacy Operational Identifier:** Komponen produksi yang sudah berjalan (seperti nama database D1 `catetin-account-db`, nama repositori, atau nama database IndexedDB `catetin-local`) dipertahankan apa adanya sebagai identitas operasional lama untuk mencegah risiko *downtime* atau kerusakan data migrasi.

---

## 3. Prinsip Pelestarian Local-First

Evolusi ke cloud **TIDAK BOLEH merusak atau menghapus** fitur *local-first* yang telah teruji:
- Editor lokal, audio player, parser timestamp, serta format arsip `.catetin` tetap berfungsi penuh.
- Inferensi Whisper lokal (WebGPU/WASM) tetap tersedia di perangkat pengguna sebagai opsi gratis tanpa akun.
- Batasan privasi lokal dijaga ketat: berkas yang dibuka dalam mode lokal tidak boleh diunggah ke cloud tanpa persetujuan eksplisit dari pengguna.

---

## 4. Spesifikasi Mesin & Struktur Saldo

- **Cloud Transcription Engine:** Direncanakan menggunakan **Deepgram Nova-3 Multilingual** sebagai mesin transkripsi cloud utama untuk keakuratan bahasa Indonesia, kecepatan inferensi, dan efisiensi biaya.
- **Pemisahan Pembicara (Diarization):** Bersifat opsional bagi pengguna saat mengirimkan berkas transkripsi.
- **Model Debit Saldo:**
  - **Transkripsi Standar:** 1x saldo (1 menit durasi rekaman mendebit 1 menit saldo).
  - **Transkripsi dengan Pemisahan Pembicara:** 1,5x saldo (1 menit durasi rekaman mendebit 1,5 menit saldo).

---

## 5. Struktur Paket & Pricing Draft

Model bisnis tidak menyediakan paket gratis (*no free tier*) untuk pemrosesan cloud guna memastikan unit ekonomi yang sehat dan mencegah penyalahgunaan sumber daya.

| Paket | Harga | Kuota Saldo | Keterangan |
| :--- | :--- | :--- | :--- |
| **Paket Coba** | Rp10.000 | 30 menit | Satu kali per akun, ditujukan untuk validasi pengguna baru |
| **Plus** | Rp59.000 | 300 menit / bulan | Pengguna individu reguler (mahasiswa, jurnalis, peneliti) |
| **Pro** | Rp149.000 | 900 menit / bulan | Profesional, notulis rapat intensif, podcaster |
| **Team** | Rp399.000 | 2.500 menit / bulan | Kolaborasi tim, maksimal 3 anggota per akun |
| **Top-up** | Rp25.000 | 120 menit | Pembelian saldo tambahan di luar langganan bulanan |

### Ketentuan Pembayaran & Referral
- **Metode Pembayaran:** Mengutamakan QRIS dan e-wallet (GoPay, OVO, ShopeePay, DANA) via payment gateway (Midtrans). **Tidak menggunakan Virtual Account** untuk menyederhanakan alur checkout pengguna lokal.
- **Program Referral:**
  - Kupon referral aktif setelah pengguna yang diundang melakukan transaksi minimum Rp25.000.
  - Memberikan bonus saldo sebesar 30 menit baik untuk pengundang maupun pihak yang diundang.

---

## 6. Peta Jalan Pelaksanaan (R0 hingga R14)

Berikut adalah urutan fase renovasi produk:

### Fase Fondasi & Penataan
- **R0: Freeze Baseline (Fase Ini)**
  - Audit status produksi terkini secara *read-only*.
  - Penyusunan roadmap resmi dan penguncian parameter produk.
- **R1: Rename-Ready Foundation (Fase Ini)**
  - Implementasi konfigurasi identitas terpusat (`PRODUCT_IDENTITY`).
  - Audit dan refaktor komponen antarmuka agar mengonsumsi konfigurasi identitas.
  - Pembuatan checklist rename dan migrasi domain komprehensif.

### Fase Backend Cloud & Mesin Transkripsi
- **R2: Cloud Storage & Audio Upload Pipeline**
  - Implementasi presigned upload / TUS ke Cloudflare R2 untuk menangani audio besar secara resumable.
- **R3: Cloud Transcription Engine Integration**
  - Integrasi API Deepgram Nova-3 Multilingual pada Cloudflare Worker dengan webhook pemrosesan asinkron.
- **R4: Speaker Diarization Engine**
  - Pengaktifan fitur opsional pemisahan pembicara dengan kalkulasi debit 1,5x durasi.
- **R5: Balance, Quota, & Usage Accounting System**
  - Skema database D1 transaksi saldo atomik, pencatatan durasi detik riil, dan penanganan status kedaluwarsa.

### Fase Monetisasi & Pembayaran
- **R6: Payment Gateway Integration**
  - Integrasi Midtrans Core API khusus QRIS dan e-wallet dengan verifikasi signature webhook yang aman.
- **R9: Pricing UI & Subscription Management**
  - Tampilan paket harga (Coba, Plus, Pro, Team, Top-up) dan riwayat pembayaran di pusat akun.

### Fase Kolaborasi & Sinkronisasi
- **R10: Cloud Workspace & Multi-Device Sync**
  - Sinkronisasi naskah antara cloud storage dan peramban lokal secara mulus.
- **R11: Team Collaboration & Sharing**
  - Pengelolaan 3 anggota tim, pembagian rekaman, dan hak akses kerja bersama.

### Fase Pertumbuhan & Transisi Final
- **R8: Referral System**
  - Pelacakan kode referral, validasi transaksi minimum Rp25.000, dan injeksi bonus 30 menit.
- **R12: Final Brand Switch & Custom Domain Migration**
  - Eksekusi checklist rename: penggantian aset SVG, favicon, nama domain produksi, pendaftaran OAuth, dan metadata web.

### Fase Native Companion (Dikerjakan Setelah Web Cloud Terbukti)
- **R13: Windows Local Edition**
  - Paket desktop mandiri untuk transkripsi lokal berkecepatan tinggi tanpa batas browser.
- **R14: Android Cloud/Local Companion App**
  - Aplikasi perekam audio mobile yang terhubung langsung ke pipeline cloud Catetin.

---

## 7. Urutan Eksekusi Rantai

Implementasi wajib mengikuti urutan berantai berikut:
```
R0 → R1 → R2 → R3 → R4 → R5 → R6 → R9 → R10 → R11 → R8 → R12
```

Catatan: Pencarian nama produk dan akuisisi domain final berjalan secara paralel di luar siklus kode teknis.
