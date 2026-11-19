---
name: assesscraft-quality-auditor
description: Exam quality auditor skill for verifying answer keys against source material, generating pedagogical explanations, detecting duplicate questions, and validating total question count and point distribution. Use after generating questions and before previewing or publishing.
---

# AssessCraft Quality Auditor

Verify accuracy, zero duplication, and alignment with source materials before presenting the exam for approval.

## Instructions

1. **Answer Key Verification**: Check every question and answer key against the analyzed material. Never invent or guess unverified answers (`generate_answer_key`).
2. **Explanations & Competencies**: Ensure every item includes a clear explanation, competency indicator, and source reference (`generate_explanations`).
3. **Quality Audit (`validate_questions`)**:
   - Exact question count matches the user's request (e.g. 40/40).
   - Total points match the target score.
   - No duplicate or near-duplicate question stems.
   - Option-to-answerKey string matching is exact for MCQ and checkbox items.
4. **Preview Gate**: Call `preview_exam` and present the complete exam for user confirmation before any Google Form export.
