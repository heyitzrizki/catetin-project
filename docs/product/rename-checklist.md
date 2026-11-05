# Checklist Pergantian Brand & Domain (Rename-Ready)

Dokumen ini memuat daftar periksa teknis lengkap saat nama produk final dan domain kustom telah ditentukan untuk menggantikan working brand "Catetin".

---

## 1. Identity Config (Pusat Konfigurasi)
- [ ] Buka berkas `src/config/product-identity.ts`.
- [ ] Perbarui `productName` dengan nama brand baru (misal: `"Naskah"` atau `"Transkrip"`).
- [ ] Perbarui `shortName` untuk label ringkas dan PWA.
- [ ] Perbarui `studioName` (misal: `"{NamaBrand} Studio"`).
- [ ] Perbarui `productDescription` (versi ID dan EN).
- [ ] Perbarui `workingDomain` dengan domain kustom baru (misal: `"transkrip.id"`).
- [ ] Perbarui `productionOrigin` (misal: `"https://transkrip.id"`).
- [ ] Perbarui `supportEmail` dengan alamat email bantuan resmi (misal: `"halo@transkrip.id"`).
- [ ] Perbarui `legalName` jika entitas badan usaha telah didaftarkan.

---

## 2. Aset Grafis & Brand Identitas
- [ ] Siapkan file vektor SVG baru dengan rasio dan dimensi kanonis:
  - `public/brand/{nama}-lockup.svg` (warna gelap / navy untuk latar terang, rasio ~3.16).
  - `public/brand/{nama}-lockup-reversed.svg` (warna terang / ivory untuk latar gelap).
  - `public/brand/{nama}-mark.svg` (simbol tunggal persegi 256x256).
  - `public/brand/{nama}-mark-reversed.svg` (simbol tunggal untuk latar gelap).
- [ ] Siapkan favicon dan ikon raster baru:
  - `public/icons/favicon-32.png` (32x32).
  - `public/icons/favicon-48.png` (48x48).
  - `public/icons/apple-touch-icon.png` (180x180).
  - `public/icons/icon-192.png` (192x192).
  - `public/icons/icon-512.png` (512x512).
  - `public/icons/icon-maskable-512.png` (512x512 dengan safe zone maskable).
- [ ] Siapkan kartu preview media sosial (Open Graph):
  - `public/brand/{nama}-og-1200x630.png` (1200x630 piksel).
- [ ] Perbarui path aset pada `PRODUCT_IDENTITY.logos` di `src/config/product-identity.ts`.

---

## 3. Metadata HTML & SEO
- [ ] Buka `index.html`:
  - Perbarui tag `<title>` bawaan.
  - Perbarui `<meta name="description">`.
  - Perbarui `property="og:url"`.
  - Perbarui `property="og:title"` dan `property="og:description"`.
  - Perbarui `property="og:image"` dengan URL absolut domain baru.
  - Perbarui `name="twitter:image"`.
  - Perbarui path `<link rel="icon">` dan `<link rel="apple-touch-icon">`.

---

## 4. Web App Manifest (PWA)
- [ ] Buka `public/manifest.webmanifest`:
  - Perbarui `name` dan `short_name`.
  - Perbarui `description`.
  - Perbarui path referensi ikon pada array `icons`.

---

## 5. Autentikasi & OAuth Provider
- [ ] **Google Cloud Console (OAuth Client ID):**
  - Tambahkan origin domain baru ke **Authorized JavaScript origins** (misal: `https://transkrip.id`).
  - Tambahkan URL redirect ke **Authorized redirect URIs** (misal: `https://transkrip.id/auth/callback`).
  - Perbarui nama aplikasi dan logo pada layar persetujuan OAuth (*OAuth consent screen*).

---

## 6. Cookie Domain & Sesi Keamanan
- [ ] Buka konfigurasi worker sesi di `worker/`:
  - Pastikan cookie sesi `catetin_session` (atau identifier netral) menyematkan atribut `Domain`, `Path=/`, `SameSite=Lax`, dan `Secure` yang sesuai domain baru.
  - Pastikan pengujian cross-subdomain (jika ada) diarahkan ke root domain yang tepat.

---

## 7. CORS & Trusted Origins
- [ ] Buka konfigurasi middleware Worker:
  - Perbarui allowlist `ALLOWED_ORIGINS` untuk mengizinkan `https://{domain-baru}`.
  - Perbarui verifikasi header `Origin` dan `Referer` pada pencegah serangan CSRF.

---

## 8. Cloudflare Worker & Custom Domain
- [ ] Daftarkan custom domain pada Cloudflare Dashboard:
  - Tambahkan DNS record CNAME atau apex ke Cloudflare Worker.
  - Hubungkan Worker ke Custom Domain melalui menu *Settings > Triggers > Custom Domains*.
  - Perbarui `wrangler.toml` jika mendefinisikan rute produksi kustom.

---

## 9. Alamat Email Dukungan & Komunikasi
- [ ] Konfigurasi DNS untuk email domain baru (MX, SPF, DKIM, DMARC).
- [ ] Hubungkan `supportEmail` ke inbox layanan bantuan.
- [ ] Jika menggunakan layanan email transaksional (seperti Resend atau Postmark), verifikasi domain pengirim baru.

---

## 10. Midtrans Payment Gateway
- [ ] Masuk ke Midtrans Dashboard (Production):
  - Perbarui **Payment Notification URL** (Webhook) ke endpoint Worker domain baru: `https://{domain-baru}/api/billing/webhook`.
  - Perbarui **Finish / Unfinish / Error Redirect URL** ke domain baru.
  - Daftarkan nama merchant atau display brand baru pada QRIS config jika diperlukan.

---

## 11. Identitas Native (Android / Windows Kelak)
- [ ] Android App:
  - Tentukan `applicationId` final (misal: `id.transkrip.app`).
  - Perbarui `android:label` pada `AndroidManifest.xml`.
- [ ] Windows Desktop Package:
  - Tentukan AppUserModelID dan nama executable.
  - Buat sertifikat code-signing dengan nama badan hukum baru.

---

## 12. Verifikasi Pasca-Migrasi
- [ ] Jalankan automated test suite (`npm.cmd test`).
- [ ] Verifikasi login Google OAuth pada domain baru.
- [ ] Verifikasi pembuatan dan pembacaan transkrip lokal (backward compatibility tidak terganggu).
- [ ] Lakukan uji transaksi mikro QRIS pada domain baru.
- [ ] Periksa preview Open Graph melalui debugger media sosial (WhatsApp, Telegram, Twitter/X).
