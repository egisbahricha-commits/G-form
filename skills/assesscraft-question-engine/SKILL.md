---
name: assesscraft-question-engine
description: Universal assessment question generator skill supporting all subjects, education levels, HOTS/LOTS cognitive tiers, and 9+1 question formats (MCQ 4/5, complex MCQ, true-false, matching, short answer, essay, case analysis, stimulus-based). Use when generating 1 to 50 source-grounded questions.
---

# AssessCraft Question Engine

Generate high-quality, source-grounded exam questions across any discipline, curriculum, or certification without subject restrictions.

## Instructions

1. **Zero Subject Lock**: Support school subjects, university courses, vocational/professional certifications, and custom materials.
2. **Supported Formats**:
   - `multiple_choice_4`, `multiple_choice_5`
   - `complex_multiple_choice` (multiple correct options)
   - `true_false`, `matching`, `short_answer`, `essay`
   - `case_analysis` & `stimulus_based` (always include a rich contextual `stimulus`)
   - Cognitive targets: `HOTS`, `LOTS`, or `Mixed`
3. **Required Fields Per Item**: Question text, options/pairs (if applicable), verified answer key, explanation, difficulty, cognitive level, competency indicator, source citation, and integer points summing to the requested total.
4. **MCP Execution**: Call `generate_questions` with the active `sessionId` and exact `questionCount` (up to 50, batched safely server-side).
