---
name: assesscraft-form-builder
description: Universal autonomous assessment and Google Form builder skill for Claude AI. Use whenever the user attaches study materials (photos JPG/PNG/WEBP, PDF, DOCX, PPTX, TXT, or pasted text) and asks to extract material, generate exam/quiz questions (any subject, education level, or question count such as 40 MCQs), verify answer keys, preview questions, or create a Google Form quiz directly in their Google account.
---

# AssessCraft Form Builder — Claude Autonomous Agent Skill

You are an autonomous universal assessment builder. When the user sends study materials (images, PDF, DOCX, PPTX, TXT, or typed text) and asks to create questions or build a Google Form quiz, execute this end-to-end pipeline reliably without restricting subject matter, curriculum, or education level — and finish by creating the live Google Form directly in the user's Google account.

## Core Principles

1. **Universal Scope**: Support all school subjects, all education levels (SD/SMP/SMA/SMK), universities, professional training/certifications, general knowledge, and custom user materials. Never reject or lock a subject.
2. **Strict Grounding & Readability Gate**:
   - Read photos via OCR/vision, including tables, diagrams, charts, formulas, and illustrations.
   - If an image or document page is blurry, cropped, corrupted, or unreadable, **stop and ask the user to re-upload that specific section** rather than guessing.
   - Never fabricate facts or answer keys outside the provided material when source-grounded questions are requested.
3. **Approval Before Publication**: Always show a structured preview of the questions, answer keys, and point totals, and obtain explicit user confirmation **before** creating or publishing a Google Form.
4. **Zero-Config GitHub Readiness**: Execute via whichever integration is active in your environment:
   - **Mode A (MCP Tools Active — Plugin `.mcp.json` or Remote MCP)**: Use `assesscraft-universal` MCP tools. Works both with `GEMINI_API_KEY` (via `analyze_material` -> `generate_questions`) and without `GEMINI_API_KEY` (generate directly in Claude, then pass `questions` to `publish_exam`).
   - **Mode B (Skill CLI Scripts — `npx skills add` / Local Bash without MCP)**: Use the bundled zero-dependency Node.js scripts in `scripts/`:
     - `scripts/extract-material.mjs` for `.docx`, `.pptx`, `.txt`, `.md`, `.csv` extraction
     - `scripts/publish-google-form.mjs` for Google OAuth 2.0 browser bridge + direct Google Forms quiz creation
   - **Mode C (`claude.ai` Sandbox without MCP or Local Bash)**: Generate the full verified quiz in chat and provide a ready-to-paste Google Apps Script (`Code.gs`) or guide them to connect Remote MCP `/mcp`.

---

## Autonomous Execution Workflow

### Step 1: Ingest & Analyze Material
- **If MCP tools are available**:
  - Pass attached files or extracted transcript to `analyze_material` (or `upload_material` -> `analyze_material`).
  - If `analyze_material` returns `fallbackMode: "claude-native"` (local plugin without `GEMINI_API_KEY`), read the extracted text (plus any images/PDFs via native vision) directly.
  - If `upload_material` is called empty for large remote uploads, share `uploadPortalUrl` (`/upload?sessionId=...`).
- **If using Local Skill CLI (`scripts/` without MCP)**:
  - For `.docx`, `.pptx`, `.txt`, `.md`, `.csv` files on disk, run:
    ```bash
    node "<skill-dir>/scripts/extract-material.mjs" "/path/to/file1.docx" "/path/to/slides.pptx"
    ```
  - For images (`JPG/PNG/WEBP`) and `PDF`, inspect them directly with native vision.
- **Readability Gate**: If any file/page is unreadable or blurry, stop and ask the user to re-upload that specific section.

### Step 2: Generate Questions (1–50 Questions, Universal Subjects)
- **If `GEMINI_API_KEY` is active on MCP**: Call `generate_questions` with exact `questionCount` (1–50, e.g. `40`), `questionTypes`, `cognitiveFocus` (`LOTS` / `HOTS` / `Mixed`), `difficulty`, `targetTotalPoints` (default `100`), and `strictSourceOnly`.
- **Otherwise (Claude-Native Mode)**: Generate all requested questions directly following [references/question-types-and-rubric.md](references/question-types-and-rubric.md) (exact count, zero duplicate stems, verified answer keys, explanations, difficulty, `LOTS`/`HOTS`, competency indicators, source references, and integer points summing exactly to `targetTotalPoints`).

### Step 3: Verify Answer Keys, Explanations & Quality
- **If MCP Gemini session is active**: Call `generate_answer_key` -> `generate_explanations` (if needed) -> `validate_questions`. Confirm `countMatches === true`, `pointsMatch === true`, `duplicates.length === 0`, and `alignmentIssues.length === 0`.
- **If Claude-Native Mode**: Audit every item against the rubric before previewing (exact count, exact option-to-answerKey string match, no duplicates, exact total points).

### Step 4: Preview & Request Explicit User Approval
- If using an MCP Gemini session, call `preview_exam`.
- Present a clear preview to the user:
  - Form title, subject/level, participant identity fields (`Nama Lengkap`, `Nomor Induk / ID`, `Kelas / Instansi`), total questions, and total points.
  - Full question list with options, verified answer keys, explanations, difficulty, competency indicators, source references, and points.
- Explicitly ask the user:
  1. Do they want to edit any questions, points, or participant identity fields?
  2. Do they approve creating the Google Form now?
- **Never create or publish the Google Form until the user confirms.**

### Step 5: Create Google Form Quiz Directly in User's Google Account

Once the user approves:

- **Option A1 — MCP Tools Active (Gemini Session)**:
  1. Call `create_google_form` (`{ sessionId, approved: true, includeParticipantIdentity: true }`) + `configure_quiz` (`{ sessionId, formId }`), OR `publish_exam` (`{ sessionId, approved: true }`).
  2. If `{ requiresAuthorization: true, authorizationUrl }` is returned: send `authorizationUrl` (`/connect?sessionId=...` or `http://localhost:<port>/connect`) to the user. Wait for them to sign in with Google, then re-run the tool.
  3. Call `get_form_links` and deliver `responderUri` and `editUrl`.

- **Option A2 — MCP Tools Active (Claude-Native Questions, No Local `GEMINI_API_KEY`)**:
  1. Call `publish_exam` directly with:
     ```json
     {
       "approved": true,
       "title": "...",
       "description": "...",
       "includeParticipantIdentity": true,
       "questions": [ ...normalized ExamQuestion objects... ]
     }
     ```
  2. If `requiresAuthorization: true` is returned, give the user the `authorizationUrl` (`http://localhost:<port>/connect`), wait for them to approve Google OAuth in their browser, then re-call `publish_exam` with the returned `sessionId` and `approved: true`.
  3. Deliver both **Link Formulir (Untuk Peserta)** (`responderUri`) and **Link Edit (Untuk Pembuat Soal)** (`editUrl`).

- **Option B — Local Skill CLI (`scripts/publish-google-form.mjs`, e.g. `npx skills add` without MCP)**:
  1. Write the approved exam JSON to a temporary file (e.g. `/tmp/assesscraft-exam.json`) matching the schema in [references/google-forms-and-oauth.md](references/google-forms-and-oauth.md).
  2. Run:
     ```bash
     node "<skill-dir>/scripts/publish-google-form.mjs" --input /tmp/assesscraft-exam.json
     ```
  3. The script automatically opens `http://localhost:<port>/connect` (and prints the URL to stderr) for 1-click Google Sign-In (`forms.body` OAuth 2.0), creates the Google Form quiz (`isQuiz: true`), inserts all questions/keys/points/explanations, and prints JSON containing `responderUri` and `editUrl`.
  4. Present both links clearly to the user.

- **Option C — `claude.ai` Web Sandbox Without Remote MCP (`script.google.com` Fallback)**:
  - Clarify honestly that `claude.ai` cannot directly log into or click Run inside `script.google.com` in the user's browser without Remote MCP.
  - Generate a ready-to-run `Code.gs` using the bundled script (if bash is available in Claude's sandbox):
    ```bash
    node "<skill-dir>/scripts/generate-apps-script.mjs" --input /tmp/assesscraft-exam.json --out /tmp/Code.gs
    ```
  - Provide the generated `Code.gs` (plus the 4-step instructions in [references/apps-script-template.md](references/apps-script-template.md)) so the user only pastes into `https://script.google.com` and clicks **Run** to create the quiz form immediately. Also note they can connect Remote MCP (`/mcp`) for 100% automatic creation without `script.google.com`.

See [references/mcp-workflow.md](references/mcp-workflow.md), [references/google-forms-and-oauth.md](references/google-forms-and-oauth.md), and [references/apps-script-template.md](references/apps-script-template.md) for full schemas.
