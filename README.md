# AssessCraft Universal — Claude Skill & Google Forms Agent

**AssessCraft Universal** mengubah foto catatan (`JPG/PNG/WEBP`), `PDF`, `DOCX`, `PPTX`, `TXT`, atau materi ketik langsung menjadi soal evaluasi berkualitas (semua mata pelajaran & jenjang, hingga 50 soal per sesi) dan menerbitkannya **langsung ke Google Forms Anda dalam mode kuis** (lengkap dengan identitas peserta, kunci jawaban, bobot poin, dan pembahasan) melalui **OAuth 2.0**.

---

## Instal Langsung dari Link GitHub (Siap Pakai Tanpa `npm install`)

Repositori ini sudah dilengkapi **bundled zero-dependency scripts** (`skills/assesscraft-form-builder/scripts/*.mjs`), `.mcp.json`, dan `.claude-plugin/` sehingga langsung berjalan setelah diinstal dari GitHub:

### 1. Claude Code (Plugin + MCP Server Otomatis)
Masukkan link GitHub repositori Anda di Claude Code:
```bash
/plugin marketplace add <LINK_GITHUB_REPO_ANDA>
/plugin install assesscraft-skill@assesscraft-skill
```
Setelah terpasang, server MCP `assesscraft-universal` (`.mcp.json`) langsung aktif otomatis.

### 2. Agent Skills CLI (`npx skills`)
```bash
npx skills add <LINK_GITHUB_REPO_ANDA>
```
Skill ini membawa `scripts/extract-material.mjs` dan `scripts/publish-google-form.mjs` siap jalan dengan Node.js 20+ tanpa instalasi paket tambahan.

### 3. Claude.ai (Web / Desktop / Mobile)
1. Unduh **`assesscraft-form-builder.zip`** dari tab **Remote MCP Hub** (`GET /api/skills/download?skill=assesscraft-form-builder`), lalu unggah di **Claude.ai → Customize / Settings → Skills → Upload skill**.
2. Untuk ekspor langsung ke Google Forms dari `claude.ai`, deploy server ini ke HTTPS publik (mis. Google Cloud Run) dan tambahkan `https://<DOMAIN_ANDA>/mcp` di **Claude.ai → Settings → Connectors**.

---

## Cara Kerja hingga Masuk ke Google Form Anda

1. Kirim foto materi, PDF, DOCX, PPTX, atau teks ke Claude dan perintahkan:
   > *"Buatkan 40 soal pilihan ganda dari materi ini dan masukkan ke Google Form baru."*
2. Claude membaca & memvalidasi keterbacaan materi, menyusun soal + kunci jawaban + pembahasan + bobot poin, lalu menampilkan **pratinjau untuk persetujuan Anda**.
3. Setelah Anda menyetujui, Claude memanggil publisher Google Forms (via MCP `publish_exam` atau `scripts/publish-google-form.mjs`):
   - Jika belum terhubung ke Google, tautan **OAuth 2.0 (`http://localhost:<port>/connect` atau `/connect`)** terbuka di browser Anda.
   - Klik **Sign in with Google**, setujui izin **Google Forms**, dan form kuis beserta seluruh soal, kunci jawaban, serta bobot nilai langsung tersimpan di **Google Forms / Google Drive Anda**.
   - Claude mengembalikan **Link Formulir (Peserta)** dan **Link Edit (Pembuat Soal)**.

---

## Pengembangan & Build Lokal

```bash
npm install
npm run dev                 # Menjalankan Web UI + Remote MCP Server (port 3000)
npm run build:skill-scripts # Memperbarui bundle zero-dependency di skills/assesscraft-form-builder/scripts/
npm run lint                # TypeScript check
npm run build               # Production Vite build
```

Lihat [DEPLOYMENT.md](DEPLOYMENT.md) untuk panduan deployment Docker / Google Cloud Run dan daftar 12 MCP Tools.
