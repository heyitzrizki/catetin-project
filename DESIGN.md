# CATETIN — DESIGN SYSTEM & SPECIFICATION (DESIGN.md)

> **Status:** APPROVED (Phase 1 Baseline)  
> **Source Repository:** https://github.com/heyitzrizki/catetin-project  
> **Framework & Foundation:** React 19 + TypeScript + Vite + Tailwind CSS v4  
> **Design Philosophy:** Editorial Minimal + Friendly Productivity (Anti-Slop Certified)

---

## 1. Executive Summary & Design Direction

### 1.1 Brand & Product Identity
**Catetin** adalah studio transkripsi audio dan video berbasis peramban (in-browser) yang mengedepankan privasi 100% lokal (*zero-cloud upload*) berkinerja tinggi. Desain visual Catetin diarahkan untuk memberikan pengalaman kerja yang tenang, presisi, transparan, dan dapat diandalkan oleh para profesional, jurnalis, peneliti, kreator, dan tim kerja modern.

### 1.2 Approved Design Persona
- **Direction:** Editorial Minimal + Friendly Productivity
- **Information Density:** Balanced (kepadatan informasi proporsional; tidak renggang seperti landing page pemasaran generik, tidak sesak seperti software telemetri rumit)
- **Themes:** Light Mode (default bersih) & Dark Mode (kontras tinggi, nyaman di mata)
- **Personality Traits:**
  - **Calm:** Suasana visual jernih tanpa ornamen visual yang bersaing merebut perhatian.
  - **Thoughtful:** Setiap kontrol diletakkan dengan rasionalitas konteks dan kegunaan nyata.
  - **Professional:** Penampilan tegas, presisi teknik tinggi, dan terpercaya.
  - **Friendly:** Bahasa teks ramah, lugas, bersahabat, tanpa jargon kecerdasan buatan hiperbolis.
  - **Refined:** Tipografi tajam, radius sudut terukur, kontras teks memenuhi standar aksesibilitas internasional.
  - **Approachable:** Alur transkripsi audio dapat dipahami seketika tanpa kurva belajar yang melelahkan.
  - **Reliable:** Penjelasan teknis jujur mengenai konsumsi memori (RAM), ukuran model Whisper, dan penyimpanan lokal (IndexedDB).

### 1.3 Liveliness Dial Configuration (Anti-Slop Standard)
1. **ENERGY (Level 2 — Seimbang):** Kepribadian visual tegas dan rapi dengan sentuhan aksen Navy yang terarah.
2. **RHYTHM (Level 2 — Teratur dengan Variasi Fungsional):** Tata letak berstruktur jelas; seksi showcase hardware MacBook, tabel komparasi model Whisper, workspace transkripsi dua kolom, dan matriks harga transparan.
3. **MOTION (Level 1 — Mikro-interaksi Presisi):** Transisi hover halus (100ms–150ms), umpan balik klik nyata, tanpa animasi dekoratif atau partikel melayang yang mengalihkan perhatian.

---

## 2. Anti-Slop Governance & Rule Enforcement Matrix

Semua keputusan visual dan interaksi dalam Catetin tunduk mutlak pada aturan keahlian *anti-slop* (`AGENTS.md` / `antislop.md`):

| Kode Aturan | Kategori | Penerapan pada Catetin |
| :--- | :--- | :--- |
| **C-1** | Intentionality | Setiap elemen visual dan baris salinan teks memiliki alasan fungsional yang eksplisit. |
| **C-2** | Functional Completeness | Seluruh tombol (unggah berkas, pemutar audio, penggantian nama pembicara, ekspor .docx/.srt/.txt, sakelar harga, modal profil) wajib berfungsi nyata. Dilarang membuat tombol ornamen/dummy. |
| **C-3** | Content-Driven Layout | Tata letak disusun mengikuti alur kerja transkripsi audio nyata, bukan sekadar mengisi template standar AI. |
| **C-4** | Resilience & UI States | Setiap panel data wajib memiliki 3 status: *Empty State*, *Loading State* (progress bar nyata), dan *Error State*. |
| **C-5** | Evidence Over Claims | Dilarang mencantumkan angka fiktif ("10k+ users", "99.9% uptime"). Spesifikasi RAM model Whisper diambil dari tolok ukur resmi (Tiny 75MB, Base 140MB, Small 460MB, Medium 1.5GB). |
| **R-01** | Color & Gradients | Dilarang memakai gradien ungu-biru neon atau pastel pudar khas AI. Warna dominan monokromatik netral dengan aksen tunggal Navy Blue. |
| **R-02** | Copywriting | Dilarang menggunakan em dash (`—`) dalam teks UI. Gunakan koma (`,`), titik (`.`), titik dua (`:`), atau tanda kurung `()`. |
| **R-03** | Mobile Responsiveness | Target sentuh tombol minimal 44px. Tabel dan waveform audio dapat digeser secara horizontal dengan anggun tanpa merusak viewport. |
| **R-04** | Icons | Ikon Lucide digunakan secara fungsional (Play, Pause, Download, Copy, Settings, ShieldCheck, ChevronDown), bukan hiasan acak. |
| **R-05** | Anti-Template Layout | Menghilangkan tata letak AI klise; mengusung hero showcase hardware MacBook presisi dengan split view editor transkrip nyata. |
| **R-08** | Button Arrows | Tanda panah hanya dipakai pada navigasi perpindahan alur eksternal, bukan di setiap tombol. |
| **R-09** | Badges | Badge hanya digunakan untuk status nyata: model Whisper yang dipilih ("Tiny / Cepat", "Small / Seimbang"), format file (".WAV / .MP3"), atau status pemrosesan. |
| **R-11** | Border Radius Discipline | Radius sudut dibatasi maksimal 6px untuk komponen umum, 8px untuk kartu, dan 12px untuk modal/chassis laptop. Dilarang membuat *pill button overload*. |
| **R-12/13** | Crisp Shadows | Menolak bayangan buram mengapung (*diffuse floating shadows*). Menggunakan garis tepi tegas (*1px solid border*) dan bayangan mikro tajam. |
| **R-15** | Specific CTAs | Teks ajakan bertindak spesifik konteks: "Buka Studio Transkrip", "Pilih Berkas Audio", "Unduh Dokumen .docx". |
| **R-16** | Anti-Buzzwords | Menghilangkan kata klise seperti "AI-Powered", "Revolutionary", "Seamless". Digantikan penjelasan nyata: "Transkripsi Berbasis Browser", "Privasi Lokal Penuh". |
| **R-24** | Zero Ghost Links | Semua tab navigasi (Studio Transkrip, Spesifikasi Model, Lisensi, FAQ) mengarah ke seksi aktif yang utuh. |
| **R-25** | WCAG AA Contrast | Kontras teks normal minimal 4.5:1 dan teks besar minimal 3:1 pada tema Terang dan Gelap. |
| **R-32** | Keyboard Accessibility | Indikator fokus cincin kontras (`focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2`). Modal dapat ditutup dengan tombol `Escape`. |
| **R-34** | Full Dual Theme | Light mode dan Dark mode dirancang seimbang dengan variabel CSS terpadu. |

---

## 3. Color System & Contrast Ratios

### 3.1 Palette Tokens

#### Light Mode (Default)
| Token Nama | Nilai Heksadesimal / Deskripsi | Peruntukan UI |
| :--- | :--- | :--- |
| `--background` | `#FFFFFF` | Latar belakang dasar halaman utama |
| `--surface-card` | `#FFFFFF` | Permukaan panel kartu, dialog, dan container |
| `--surface-subtle` | `#F8FAFC` (Slate 50) | Latar belakang panel samping, header tabel, dan area sekunder |
| `--surface-elevated` | `#FFFFFF` | Modal dialog, dropdown popover, tooltip |
| `--foreground` | `#0F172A` (Slate 900) | Teks utama dengan kontras tertinggi |
| `--muted-foreground` | `#64748B` (Slate 500) | Teks sekunder, label pembantu, timecode tidak aktif |
| `--border` | `#E2E8F0` (Slate 200) | Garis pemisah panel, bingkai kartu, divider |
| `--input` | `#E2E8F0` (Slate 200) | Garis tepi kontrol formulir dan kotak teks |
| `--primary` | `#1E3A8A` (Navy 900) | Aksen utama terpilih: badge aktif, highlight teks utama, fokus |
| `--primary-foreground` | `#FFFFFF` | Teks di atas warna primary |
| `--accent` | `#EFF6FF` (Blue 50) | Latar belakang badge aktif, hover baris dialog |
| `--accent-foreground` | `#1E3A8A` (Navy 900) | Teks di atas aksen sekunder |
| `--destructive` | `#DC2626` (Red 600) | Peringatan penghapusan berkas, status gagal |

#### Dark Mode
| Token Nama | Nilai Heksadesimal / Deskripsi | Peruntukan UI |
| :--- | :--- | :--- |
| `--background` | `#090D16` (Deep Midnight Slate) | Latar belakang dasar gelap dengan nuansa navy |
| `--surface-card` | `#0F172A` (Slate 900) | Permukaan kartu dan panel kontrol |
| `--surface-subtle` | `#141C2E` | Latar belakang panel samping dan bilah status |
| `--surface-elevated` | `#1E293B` (Slate 800) | Modal dialog dan popover mengambang |
| `--foreground` | `#F8FAFC` (Slate 50) | Teks utama pada latar gelap |
| `--muted-foreground` | `#94A3B8` (Slate 400) | Teks sekunder dan timecode sekunder |
| `--border` | `#1E293B` (Slate 800) | Garis pemisah panel dalam mode gelap |
| `--input` | `#1E293B` (Slate 800) | Garis tepi kontrol input |
| `--primary` | `#2563EB` (Blue 600) | Aksen utama mode gelap (memenuhi 5.2:1 WCAG AA vs #FFFFFF) |
| `--primary-foreground` | `#FFFFFF` | Teks di atas warna primary gelap |
| `--accent` | `#1E293B` (Slate 800) | Permukaan hover elemen aktif |
| `--accent-foreground` | `#93C5FD` (Blue 300) | Teks aksen pada status terpilih |
| `--destructive` | `#EF4444` (Red 500) | Indikator kesalahan atau pembatalan |

### 3.2 WCAG AA Accessibility Contrast Verification Table

| Kombinasi Elemen | Warna Teks | Warna Latar | Rasio Kontras | Standar WCAG AA | Hasil Verifikasi |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Teks Utama Light | `#0F172A` | `#FFFFFF` | **15.3 : 1** | Min. 4.5 : 1 | **LULUS (Superior)** |
| Teks Sekunder Light | `#475569` | `#FFFFFF` | **6.2 : 1** | Min. 4.5 : 1 | **LULUS** |
| Teks Muted Light | `#64748B` | `#FFFFFF` | **4.6 : 1** | Min. 4.5 : 1 | **LULUS** |
| Teks Aksen Navy Light | `#1E3A8A` | `#FFFFFF` | **10.6 : 1** | Min. 4.5 : 1 | **LULUS (Superior)** |
| Teks Aksen Navy Light | `#1E3A8A` | `#EFF6FF` | **9.4 : 1** | Min. 4.5 : 1 | **LULUS (Superior)** |
| Teks Putih di Tombol Navy | `#FFFFFF` | `#1E3A8A` | **10.6 : 1** | Min. 4.5 : 1 | **LULUS (Superior)** |
| Teks Utama Dark | `#F8FAFC` | `#090D16` | **16.1 : 1** | Min. 4.5 : 1 | **LULUS (Superior)** |
| Teks Sekunder Dark | `#CBD5E1` | `#090D16` | **11.4 : 1** | Min. 4.5 : 1 | **LULUS (Superior)** |
| Teks Muted Dark | `#94A3B8` | `#090D16` | **7.1 : 1** | Min. 4.5 : 1 | **LULUS** |
| Teks Aksen Blue Dark | `#3B82F6` | `#090D16` | **5.4 : 1** | Min. 4.5 : 1 | **LULUS** |
| Teks Putih di Tombol Accent Dark | `#FFFFFF` | `#2563EB` | **4.6 : 1** | Min. 4.5 : 1 | **LULUS** |

---

## 4. Typography System

### 4.1 Typeface Families
- **Primary Sans:** `Plus Jakarta Sans`, dengan fallback `Inter`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `sans-serif`. Digunakan untuk seluruh heading, navigasi, dialog, salinan teks penjelasan, dan kontrol antarmuka.
- **Monospace Technical:** `JetBrains Mono`, `ui-monospace`, `Menlo`, `Monaco`, `monospace`. Wajib disetel dengan properti `font-variant-numeric: tabular-nums` untuk tampilan angka waktu rekaman (*timecode* `00:14:22`), ukuran alokasi RAM (`460 MB`), bitrate audio (`128 kbps`), dan persentase proses.

### 4.2 Typographic Hierarchy Scale

| Skala Tipografi | Kelas / Ukuran | Bobot Font | Line Height | Letter Spacing | Peruntukan Penggunaan |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Display / Hero** | `text-3xl` s.d. `text-4xl` (32px–40px) | `font-bold` (700) | `1.15` s.d. `1.2` | `-0.025em` (`tracking-tight`) | Headline utama halaman depan |
| **Heading 1 (H1)** | `text-2xl` (24px–28px) | `font-semibold` (600) | `1.25` | `-0.02em` | Judul seksi utama (Spesifikasi, Harga, FAQ) |
| **Heading 2 (H2)** | `text-xl` (20px) | `font-semibold` (600) | `1.3` | `-0.015em` | Judul kartu, header modal, nama pembicara |
| **Heading 3 (H3)** | `text-base` (16px) | `font-semibold` (600) | `1.4` | `normal` | Sub-judul kontrol, header kolom editor |
| **Body Large** | `text-base` (16px) | `font-normal` (400) | `1.6` | `normal` | Paragraf pengantar, kutipan deskripsi |
| **Body Regular** | `text-sm` (14px) | `font-normal` (400) | `1.5` | `normal` | Teks percakapan transkrip, deskripsi fitur |
| **Body Medium** | `text-sm` (14px) | `font-medium` (500) | `1.5` | `normal` | Label input, navigasi tab, tombol aksi |
| **Caption / Small** | `text-xs` (12px) | `font-medium` (500) | `1.4` | `+0.01em` | Badge format, status privasi, footnote |
| **Mono Technical** | `text-xs` / `text-sm` (12px–13px) | `font-mono` (400/500) | `1.35` | `normal` | Timestamp audio, indikator RAM, ukuran file |

---

## 5. Spacing & Spatial Layout System

### 5.1 Base 4px Grid
Seluruh margin, padding, celah tata letak (*gap*), dan tinggi komponen diturunkan secara disiplin dari perkalian 4px:

| Token Spasi | Nilai Pixel | Tailwind Utility | Peruntukan Implementasi |
| :--- | :--- | :--- | :--- |
| `space-1` | 4px | `p-1`, `gap-1`, `m-1` | Ruang antara ikon dan teks mikro, padding badge |
| `space-2` | 8px | `p-2`, `gap-2`, `m-2` | Celah horizontal tombol ganda, padding item dropdown |
| `space-3` | 12px | `p-3`, `gap-3` | Padding dalam tombol standar, celah antar baris transkrip |
| `space-4` | 16px | `p-4`, `gap-4` | Padding kotak input, margin antar paragraf |
| `space-5` | 20px | `p-5`, `gap-5` | Padding dalam kartu komponen, panel samping |
| `space-6` | 24px | `p-6`, `gap-6` | Padding kartu harga, padding container dialog |
| `space-8` | 32px | `p-8`, `gap-8` | Celah dua kolom workspace (dialog vs panel opsi) |
| `space-12` | 48px | `py-12`, `gap-12` | Jarak vertikal antar seksi halaman desktop |
| `space-16` | 64px | `py-16`, `gap-16` | Margin vertikal seksi utama hero dan pricing |

### 5.2 Container Constraints
- **Max Width Halaman:** `max-w-6xl` (1152px) dengan padding horizontal `px-4 sm:px-6 lg:px-8` terpusat (`mx-auto`).
- **Workspace Editor Frame:** `max-w-7xl` (1280px) untuk memberikan ruang nyaman pada split view audio waveform, transkrip percakapan, dan panel ekspor.

---

## 6. Radius System (Anti-Slop Strict Enforcement)

Anti-Slop Engineering menetapkan larangan keras terhadap sudut membulat berlebihan (*bubble pill overload*):

| Kelas Radius | Nilai Pixel | Status | Tempat Penggunaan yang Sah |
| :--- | :--- | :--- | :--- |
| `rounded-none` | 0px | **Wajib** | Pembagi panel split-screen, batas tepi jendela, sel tabel data |
| `rounded-xs` | 2px | **Wajib** | Thumb scrollbar presisi, chip mikro RAM, tag teknis |
| `rounded-sm` | 4px | **Wajib** | Dropdown menu items, badge audio codec, notch kamera laptop |
| `rounded-md` | 6px | **Default Standar** | Tombol aksi utama, formulir input teks, tab navigasi aktif |
| `rounded-lg` | 8px | **Wajib** | Kartu fitur, preview display audio player, layar mockup |
| `rounded-xl` | 12px | **Batas Maksimal** | Modal dialog container, sasis hardware MacBook Pro |
| `rounded-2xl` | 16px | **DILARANG** | Dihapus dari seluruh kartu dan tombol |
| `rounded-3xl` | 24px | **DILARANG** | Dihapus total dari basis kode |
| `rounded-full` | 9999px | **Pengecualian Terbatas** | HANYA untuk indikator titik status (Active/Offline dot) |

---

## 7. Elevation, Borders & Surface Hierarchy

### 7.1 Border-First Architecture
Catetin mengadopsi prinsip desain berbasis ketegasan garis (*stroke over blur*):
- Setiap panel dipisahkan oleh garis batas 1px solid: `border border-slate-200` (Light) atau `border border-slate-800` (Dark).
- Menghindari gradasi latar melayang (*floating blurry gradient blobs*).

### 7.2 Crisp Shadow Specifications
- **Level 0 (Flat):** `box-shadow: none;` — Digunakan pada kolom editor, header baris, tabel data.
- **Level 1 (Card Restrained):** `box-shadow: 0 1px 3px 0 rgba(15, 23, 42, 0.05), 0 1px 2px -1px rgba(15, 23, 42, 0.05);`
- **Level 2 (Hover Elevation):** `box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.07), 0 2px 4px -2px rgba(15, 23, 42, 0.07);`
- **Level 3 (Modal / Hardware Chassis):** `box-shadow: 0 20px 40px -15px rgba(15, 23, 42, 0.2), 0 0 0 1px rgba(15, 23, 42, 0.08);`

---

## 8. Motion, Interaction & Accessibility

### 8.1 Timing & Easing Curves
- **Micro-interaksi (Button hover, tab switch):** `120ms` dengan kurva `ease-out`.
- **Panel Expand / Accordion FAQ:** `200ms` dengan kurva `cubic-bezier(0.16, 1, 0.3, 1)`.
- **Modal Reveal & Backdrop:** `180ms` dengan kurva `ease-out`.

### 8.2 Accessible Reduced Motion
Sesuai standar aksesibilitas WCAG 2.1:
```css
@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

### 8.3 Keyboard Navigation & Focus Ring
- Seluruh elemen interaktif memiliki outline fokus yang terlihat jelas dan kontras tinggi:
  `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-900 focus-visible:ring-offset-2` (Light) dan
  `focus-visible:ring-blue-500 focus-visible:ring-offset-slate-900` (Dark).
- Tombol modal mendukung penutupan via tombol `Escape` dan navigasi `Tab` terkunci (*focus trap*).

---

## 9. Content, Copywriting & Voice Standards

1. **Bahasa:** Bahasa Indonesia natural, lugas, percaya diri, dan profesional.
2. **Larangan Karakter Em Dash (`—`):** Sesuai aturan R-02, dilarang memakai em dash di antarmuka pengguna yang dirancang AI. Gunakan titik (`.`), koma (`,`), titik dua (`:`), atau tanda kurung `()`.
3. **CTA Konkret:**
   - Bukan "Coba Sekarang" melainkan "Buka Studio Transkrip".
   - Bukan "Mulai Gratis" melainkan "Pilih Berkas Audio".
   - Bukan "Download All" melainkan "Ekspor Transkrip (.docx, .srt, .txt)".
4. **Transparansi Privasi:**
   - Menjelaskan secara eksplisit di modal profil dan footer bahwa rekaman suara diproses oleh CPU/WebAssembly peramban lokal dan disimpan di IndexedDB perangkat, tidak pernah diunggah ke peladen pihak ketiga.

---

## 10. Phase-by-Phase Roadmap Alignment

- **Fase 0:** Audit & Revisi Arah Desain *(Selesai)*.
- **Fase 1:** Fondasi Desain & Penyiapan CSS Aman (`DESIGN.md`, `src/index.css`, `index.html`) *(Sedang Berjalan)*.
- **Fase 2:** Komponen Primitif UI & Desain Sistem Terisolasi (Tombol, Input, Dialog, Tab, Badge dalam `src/components/ui/`).
- **Fase 3:** Modularisasi Fitur Workspace & Showcase Hardware.
- **Fase 4:** Integrasi & Perakitan Bersih Tanpa Regresi Fungsional.
- **Fase 5:** Verifikasi Menyeluruh & Uji Kualitas Mutlak.
