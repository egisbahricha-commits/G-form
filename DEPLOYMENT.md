# AssessCraft Universal — Remote MCP Server & Claude Autonomous Agent

Sistem agen pembuat soal universal berbasis **Remote Model Context Protocol (MCP) Server** di atas HTTPS untuk **Claude AI**, **Google Gemini Multimodal API**, dan **Google Forms API (OAuth 2.0)**.

## Endpoint Remote MCP & Infrastruktur Backend

Server Express + Vite berjalan pada port `3000` (`server.ts`) dan menyediakan endpoint berikut:

- **Streamable HTTP MCP (Utama untuk Claude Remote Connectors)**: `POST / GET / DELETE /mcp`
- **Legacy HTTP+SSE MCP (Kompatibilitas Penuh)**: `GET /sse` dan `POST /messages`
- **Local Stdio MCP Transport**: `npm run mcp:stdio` (`src/mcp/stdio.ts`)
- **Portal OAuth 2.0 Mobile-Friendly**: `/connect` (mengikat izin akun Google Forms langsung ke Remote MCP Server tanpa menyalin token manual)
- **Portal Unggah Multi-File (Foto/PDF/DOCX/PPTX/TXT)**: `/upload`
- **Health Check & Discovery**: `GET /api/health` dan `GET /api/mcp/tools`

## 12 MCP Tools yang Tersedia untuk Claude

1. `upload_material` — Unggah foto (`JPG/JPEG/PNG/WEBP`), `PDF`, `DOCX`, `PPTX`, `TXT`, atau teks langsung (mendukung `base64Content`, `fileUrl`, `filePath`, `textContent`).
2. `extract_text` — Ekstraksi teks penuh dokumen dan OCR multimodal gambar/diagram (mendukung lampiran inline langsung).
3. `analyze_material` — Analisis multimodal Gemini (membaca teks OCR, tabel, grafik, diagram, pokok bahasan, konsep penting, ringkasan internal, dan keterbacaan file).
4. `generate_questions` — Pembuat soal universal hingga 50 soal per panggilan (otomatis di-batch per 15 soal untuk mencegah pemotongan JSON pada 40+ soal). Mendukung PG 4/5 opsi, PG Kompleks, Benar-Salah, Menjodohkan, Isian Singkat, Esai, HOTS, LOTS, Analisis Kasus, dan Stimulus.
5. `generate_answer_key` — Verifikasi & pembuatan kunci jawaban akurat berdasar materi sumber.
6. `generate_explanations` — Pembahasan pedagogis, indikator kompetensi, dan sumber rujukan materi.
7. `validate_questions` — Audit ketepatan jumlah soal, total bobot nilai, deteksi duplikasi, konsistensi soal-jawaban, dan keterikatan materi.
8. `preview_exam` — Pratinjau ujian lengkap untuk ditinjau & disetujui pengguna sebelum Google Form dibuat.
9. `create_google_form` — Membuat Google Form baru beserta bagian **Identitas Peserta**. Jika belum terhubung ke Google OAuth, mengembalikan `requiresAuthorization: true` dan tautan `/connect?sessionId=...` yang dapat diklik dari HP/laptop.
10. `configure_quiz` — Mengaktifkan mode kuis (`isQuiz: true`) dan memasukkan seluruh pertanyaan, kunci jawaban, bobot poin, serta pembahasan (di-batch otomatis per 25 item).
11. `publish_exam` — Alur gabungan satu langkah membuat form + kuis + soal setelah `approved: true`.
12. `get_form_links` — Mengembalikan `responderUri` (link peserta) dan `editUrl` (link edit pembuat soal).

## Cara Memasang Remote MCP di Claude AI (Web, Desktop, & HP)

1. Deploy server ini ke lingkungan HTTPS publik (lihat bagian Deployment di bawah) atau gunakan URL Cloud Run aktif Anda.
2. Buka **Claude (`claude.ai`)** -> **Settings** -> **Connectors** -> **Add custom connector**.
3. Masukkan URL Remote MCP Server Anda:
   - Utama (Streamable HTTP): `https://<DOMAIN_HTTPS_ANDA>/mcp`
   - Alternatif (SSE): `https://<DOMAIN_HTTPS_ANDA>/sse`
4. Jika menggunakan **Claude Desktop** lokal, salin blok yang sesuai dari `claude_desktop_config.example.json`.

## Menghubungkan Akun Google Forms (OAuth 2.0 Tanpa Token Manual)

1. Buka `https://<DOMAIN_HTTPS_ANDA>/connect` (atau tab **Remote MCP Hub** di aplikasi web, berfungsi di browser HP maupun desktop).
2. Ketuk **Hubungkan Akun Google (OAuth 2.0)** dan setujui izin `https://www.googleapis.com/auth/forms.body`.
3. Token OAuth otomatis tersimpan aman di memori jembatan otorisasi server untuk sesi Claude Remote MCP Anda. Jika kedaluwarsa saat sesi berjalan, cukup ketuk tautan `/connect` yang diberikan Claude atau klik **Perbarui Sesi OAuth**.

## Contoh Alur Penggunaan Otonom di Claude

1. Buka Claude AI (HP atau Desktop), lampirkan foto catatan / PDF / DOCX / PPTX (atau unggah lewat `/upload` lalu berikan `sessionId` ke Claude).
2. Ketik perintah:
   > *"Buatkan 40 soal pilihan ganda dari materi ini dan masukkan ke Google Form baru."*
3. Claude akan memanggil `analyze_material` -> `generate_questions` -> `generate_answer_key` -> `validate_questions` -> `preview_exam`.
4. Tinjau pratinjau yang ditampilkan Claude dan balas **"Setuju, buat Google Form"**.
5. Claude memanggil `create_google_form` -> `configure_quiz` -> `get_form_links`, lalu memberikan tautan formulir & tautan edit Google Form kepada Anda.

## Deployment (Docker / Google Cloud Run)

1. Pastikan variabel lingkungan berikut disetel di runtime (jangan pernah commit key ke repository):
   - `GEMINI_API_KEY`: API Key Gemini server-side.
   - `APP_URL`: URL HTTPS publik layanan Anda (mis. `https://assesscraft-mcp-xxx.run.app`).
   - `PORT`: `3000`.
2. Build & jalankan via Docker:
   ```bash
   docker build -t assesscraft-mcp .
   docker run -p 3000:3000 -e GEMINI_API_KEY=... -e APP_URL=https://... assesscraft-mcp
   ```
3. Atau deploy langsung ke Google Cloud Run:
   ```bash
   gcloud run deploy assesscraft-mcp \
     --source . \
     --port 3000 \
     --allow-unauthenticated \
     --set-env-vars GEMINI_API_KEY=...,APP_URL=https://...
   ```

## Instal Skill di Claude AI (`SKILL.md` Suite)

Selain Remote MCP Server, repositori ini menyertakan paket **Agent Skills** modular bergaya `replica-skill`:

- `skills/assesscraft-form-builder/` — Skill utama (orchestrator + `references/question-types-and-rubric.md`, `references/google-forms-and-oauth.md`, `references/mcp-workflow.md`)
- `skills/assesscraft-material-reader/` — Sub-skill ekstraksi OCR & pembacaan materi multimodal
- `skills/assesscraft-question-engine/` — Sub-skill pembuat 9+1 tipe soal universal & HOTS/LOTS
- `skills/assesscraft-quality-auditor/` — Sub-skill verifikasi kunci jawaban, pembahasan, & anti-duplikasi
- `skills/assesscraft-google-forms/` — Sub-skill publikasi Google Forms dengan persetujuan pengguna
- `.claude-plugin/plugin.json` & `.claude-plugin/marketplace.json` — Manifest plugin untuk Claude Code

### Cara Pasang Skill di `claude.ai` (Web & HP)

1. Unduh **`assesscraft-form-builder.zip`** langsung dari aplikasi (`GET /api/skills/download?skill=assesscraft-form-builder` atau tombol **Unduh Skill Claude.ai (.zip)** di tab **Remote MCP Hub**).
2. Buka **`claude.ai`** &rarr; **Customize / Settings** &rarr; **Skills** &rarr; **Upload skill**, lalu pilih file `.zip` tersebut dan aktifkan.
3. Agar Claude juga dapat mengekspor langsung ke akun Google Forms Anda dan mem-batch 40+ soal lewat Gemini API, hubungkan juga **Remote MCP Server** (`https://<DOMAIN_PUBLIK_ANDA>/mcp`) di **Settings &rarr; Connectors**.

### Cara Pasang di Claude Code / Agent Skills via Link GitHub (Zero-Config)

Repositori ini menyertakan `.mcp.json`, `.claude-plugin/`, serta skrip terbundel zero-dependency di `skills/assesscraft-form-builder/scripts/` (`assesscraft-mcp.mjs`, `publish-google-form.mjs`, `extract-material.mjs`) sehingga dapat langsung dijalankan setelah instalasi tanpa `npm install`:

```bash
# Opsi 1: Claude Code Plugin (Skill + MCP Server + Local OAuth Bridge otomatis)
/plugin marketplace add https://github.com/<USERNAME>/<REPO_ANDA>
/plugin install assesscraft-skill@assesscraft-skill

# Opsi 2: Agent Skills CLI
npx skills add https://github.com/<USERNAME>/<REPO_ANDA>
```

## Panduan Pengujian Endpoint MCP & Skill

1. Jalankan type-check & build:
   ```bash
   npm run lint
   npm run build
   ```
2. Uji discovery endpoint & skill ZIP packaging:
   ```bash
   curl -s https://<DOMAIN_ANDA>/api/health
   curl -s https://<DOMAIN_ANDA>/mcp
   curl -s https://<DOMAIN_ANDA>/api/skills
   ```
3. Uji protokol penuh Streamable HTTP (`/mcp`) dan SSE (`/sse`) dengan `@modelcontextprotocol/sdk` Client untuk memastikan `initialize`, `listTools` (12 tools), `listPrompts`, `readResource`, `upload_material`, `preview_exam`, dan `create_google_form` (respons `/connect` OAuth bridge) berjalan normal.
