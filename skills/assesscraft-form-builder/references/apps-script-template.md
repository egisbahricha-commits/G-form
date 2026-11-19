# Google Apps Script (`script.google.com`) Fallback Guide

## Important Clarification for the User

Claude AI (`claude.ai`) **cannot** directly open, log into, or click "Run" inside the user's `https://script.google.com` browser tab on its own. Instead, there are two clean ways to get the quiz directly into Google Forms:

1. **100% Automatic (No `script.google.com` needed)**: Connect the **AssessCraft Remote MCP** (`/mcp`) or run via **Claude Code GitHub Plugin** (`publish_exam` / `scripts/publish-google-form.mjs`). Claude creates the Google Form directly via OAuth 2.0.
2. **1-Paste `script.google.com` (`Code.gs`) Fallback** (for `claude.ai` web/mobile without Remote MCP):
   - Generate `Code.gs` automatically using the bundled script (zero dependencies):
     ```bash
     node "<skill-dir>/scripts/generate-apps-script.mjs" --input /tmp/assesscraft-exam.json --out /tmp/Code.gs
     ```
   - Deliver the `Code.gs` file (or full code block) to the user with these exact 4 steps:
     1. Buka `https://script.google.com` → klik **New project** (Proyek baru).
     2. Hapus isi `Code.gs` default, lalu tempel seluruh kode yang diberikan.
     3. Klik tombol **Run** (`buatGoogleFormAssessCraft`), lalu setujui izin Google Forms saat diminta pertama kali.
     4. Lihat **Execution Log** di bagian bawah untuk mengklik **Link Peserta** dan **Link Edit** Google Form yang sudah jadi.

## Supported Features in Generated `Code.gs`
- `FormApp.create(...)` + `setIsQuiz(true)`
- Participant identity fields (`Nama Lengkap`, `Nomor Induk / ID Peserta`, `Kelas / Program / Instansi`, custom fields) + page break
- All question formats (`multiple_choice_4`, `multiple_choice_5`, `complex_multiple_choice`, `true_false`, `matching` grid, `short_answer`, `essay`, `case_analysis`, `stimulus_based`)
- Point values (`setPoints`), answer keys (`createChoice(..., isCorrect)`), and correct/incorrect/general feedback explanations
