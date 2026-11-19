# Google Forms Export & OAuth 2.0 Flow

## Form Structure Built in Google Forms API v1

1. **Form Creation**:
   - Creates a new Google Form with the approved `title` and `description`.
   - Adds a **Participant Identity** section at the top when `includeParticipantIdentity` is enabled (`Nama Lengkap`, `Nomor Induk / ID Peserta`, `Kelas / Program / Instansi`, plus optional custom fields) followed by a clean page break before questions.
2. **Quiz Configuration**:
   - Enables quiz mode (`settings.quizSettings.isQuiz = true`).
   - Inserts all questions in batches of 25, attaching `grading.pointValue`, `grading.correctAnswers`, and `grading.whenRight` / `whenWrong` / `generalFeedback` from explanations and source references.
   - Question mapping:
     - `multiple_choice_4`, `multiple_choice_5`, `true_false` -> Radio MCQ (`RADIO`)
     - `complex_multiple_choice` -> Checkbox MCQ (`CHECKBOX`)
     - `short_answer` -> Short text (`paragraph: false`) with exact auto-grade answer key
     - `essay`, `case_analysis`, `stimulus_based` -> Paragraph (`paragraph: true`) with grading rubric feedback (or choice question if options provided)
     - `matching` -> Radio grid (`questionGroupItem`) with row prompts and column choices
3. **Output Links**:
   - `responderUri`: Shareable participant quiz link (`https://docs.google.com/forms/d/e/.../viewform`).
   - `editUrl`: Owner form editor link (`https://docs.google.com/forms/d/<formId>/edit`).

## JSON Schema for `publish_exam` / `scripts/publish-google-form.mjs`

```json
{
  "title": "Evaluasi Biologi — Fotosintesis",
  "description": "Jawablah seluruh pertanyaan dengan saksama.",
  "includeParticipantIdentity": true,
  "participantIdentity": {
    "includeFullName": true,
    "includeParticipantId": true,
    "includeClassOrOrg": true,
    "customFields": []
  },
  "questions": [
    {
      "order": 1,
      "type": "multiple_choice_4",
      "cognitiveLevel": "LOTS",
      "difficulty": "Easy",
      "question": "Di bagian kloroplas manakah reaksi terang fotosintesis berlangsung?",
      "options": ["Tilakoid", "Stroma", "Matriks mitokondria", "Sitoplasma"],
      "answerKey": "Tilakoid",
      "explanation": "Reaksi terang terjadi pada membran tilakoid di dalam kloroplas.",
      "competencyIndicator": "Mengidentifikasi lokasi reaksi terang fotosintesis",
      "sourceReference": "Materi Fotosintesis Hal. 1",
      "points": 10
    }
  ]
}
```

## Zero-Manual-Token OAuth 2.0 Flow

- **Never** ask the user to copy or paste a manual `GOOGLE_FORMS_ACCESS_TOKEN` or Gemini API key.
- **Remote MCP**: Returns `https://<server-host>/connect?sessionId=<sessionId>` for mobile or desktop browser approval.
- **Local GitHub Plugin / CLI Script**: Automatically starts an ephemeral `http://localhost:<port>/connect` Firebase Google OAuth 2.0 bridge in memory, opens the browser for 1-click consent (`https://www.googleapis.com/auth/forms.body`), and publishes immediately to Google Forms.
