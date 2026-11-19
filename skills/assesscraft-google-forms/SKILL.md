---
name: assesscraft-google-forms
description: Approval-gated Google Forms quiz publisher skill. Creates a new Google Form with participant identity fields, enables quiz mode, inserts all validated questions with answer keys and points, handles OAuth 2.0 connection links, and returns responder and edit URLs.
---

# AssessCraft Google Forms Publisher

Create and configure Google Forms quizzes safely using OAuth 2.0 after explicit user confirmation.

## Instructions

1. **Explicit Approval Required**: Never create or publish a Google Form until the user confirms the exam preview (`approved: true`).
2. **Publishing via MCP (`create_google_form` + `configure_quiz` or `publish_exam`)**:
   - If the session already has Gemini-generated questions, call `create_google_form` -> `configure_quiz` -> `get_form_links` (or `publish_exam` with `approved: true`).
   - If Claude generated the questions natively without a local `GEMINI_API_KEY`, pass the `questions` array directly into `publish_exam({ approved: true, title, description, participantIdentity, questions })`.
3. **Publishing via Standalone Skill Script (No MCP)**:
   - Write the approved exam JSON `{ title, description, includeParticipantIdentity, questions }` to a temp file and run:
     `node "<assesscraft-form-builder-dir>/scripts/publish-google-form.mjs" --input /tmp/assesscraft-exam.json`
4. **OAuth 2.0 Link Handling**:
   - Never request manual access tokens or API keys.
   - If `requiresAuthorization: true` is returned (or the CLI prints `http://localhost:<port>/connect`), present the clickable `authorizationUrl` so the user can approve Google Forms access in one click, then continue.
5. **Return Links**: Always return both `responderUri` (participant quiz link) and `editUrl` (owner editor link).
