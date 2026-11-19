# MCP Tool Reference (12 Tools) & Local Skill Scripts

## 12 MCP Tools (`assesscraft-universal`)

1. `upload_material`: `{ sessionId?, title?, files?: [{ filename, mimeType?, base64Content?, fileUrl?, filePath?, textContent? }], typedText?, typedTitle? }`
   - Returns `sessionId` and uploaded file metadata. If called empty, returns `uploadPortalUrl` (`/upload?sessionId=...`) for browser/mobile upload.
2. `extract_text`: `{ sessionId?, materialId?, files?, typedText? }`
   - Runs document parsing (DOCX/PPTX/TXT work even without `GEMINI_API_KEY`) + Gemini multimodal OCR.
3. `analyze_material`: `{ sessionId?, title?, files?, materialText?, subjectHint?, educationLevelHint? }`
   - Reads OCR, tables, diagrams, charts, core topics, key concepts, internal summary, and checks `unreadableFiles`. Returns `fallbackMode: "claude-native"` if `GEMINI_API_KEY` is not set locally.
4. `generate_questions`: `{ sessionId, subject?, educationLevel?, curriculumOrContext?, questionTypes?, questionCount (1-50), cognitiveFocus?, difficulty?, targetTotalPoints?, language?, strictSourceOnly?, customInstructions? }`
   - Automatically batches >15 questions into chunks of 15 via Gemini.
5. `generate_answer_key`: `{ sessionId, questionIds? }`
   - Verifies or generates accurate source-grounded answer keys.
6. `generate_explanations`: `{ sessionId, questionIds? }`
   - Enriches explanations, competency indicators, and source references.
7. `validate_questions`: `{ sessionId, requestedCount?, targetTotalPoints? }`
   - Checks count match, total points match, lexical/semantic duplicates, option-key alignment, and source grounding.
8. `preview_exam`: `{ sessionId }`
   - Returns the full exam preview for user confirmation.
9. `create_google_form`: `{ sessionId?, title?, description?, includeParticipantIdentity?, participantIdentity?, questions?, approved? }`
   - Creates the Google Form + participant identity fields. Returns `requiresAuthorization: true` + `/connect` URL if unauthenticated.
10. `configure_quiz`: `{ sessionId, formId?, questions? }`
    - Sets `isQuiz: true` and inserts all questions, answer keys, points, and feedback.
11. `publish_exam`: `{ sessionId?, approved: true, title?, description?, includeParticipantIdentity?, participantIdentity?, questions? }`
    - Approval-gated one-step publisher. Supports both existing Gemini `sessionId` and direct Claude-native `questions` array.
12. `get_form_links`: `{ sessionId }`
    - Returns `responderUri` and `editUrl`.

## Zero-Dependency Bundled CLI Scripts (`skills/assesscraft-form-builder/scripts/`)

- `assesscraft-mcp.mjs`: Pre-bundled stdio MCP server (referenced automatically by `.mcp.json`).
- `extract-material.mjs`: Extracts text, tables, and speaker notes from `.docx`, `.pptx`, `.txt`, `.md`, `.csv` without `npm install`.
- `publish-google-form.mjs`: Reads an approved exam JSON (`--input <file.json>`), runs the `http://localhost:<port>/connect` OAuth 2.0 flow if needed, and creates the live Google Form quiz directly in the user's Google account.
