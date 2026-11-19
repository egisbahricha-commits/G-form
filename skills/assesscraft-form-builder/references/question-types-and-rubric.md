# Question Types & Quality Rubric

## Supported Question Types (Universal)

1. `multiple_choice_4` — Pilihan ganda 4 opsi (`A–D`). Exactly 4 options; `answerKey` must match one option verbatim.
2. `multiple_choice_5` — Pilihan ganda 5 opsi (`A–E`). Exactly 5 options; `answerKey` must match one option verbatim.
3. `complex_multiple_choice` — Pilihan ganda kompleks (multiple correct answers). 4–5 options; `answerKeyList` contains 2 or more exact option strings.
4. `true_false` — Benar / Salah (`["Benar", "Salah"]` or `["True", "False"]`).
5. `matching` — Menjodohkan (`matchingPairs` of `{ prompt, match }`, minimum 3 pairs).
6. `short_answer` — Isian singkat (exact expected answer string).
7. `essay` — Esai / Uraian (rubric / key grading points in `answerKey`).
8. `case_analysis` — Soal analisis kasus (must include a realistic contextual `stimulus` derived from the material).
9. `stimulus_based` — Soal berbasis stimulus (must include a `stimulus` excerpt, table description, chart/diagram summary, or data scenario).

## Cognitive Levels & Metadata

Every generated question must include:
- **Question text** (`question`) + optional `stimulus`
- **Options / Matching Pairs** (when applicable)
- **Answer Key** (`answerKey` or `answerKeyList`)
- **Explanation** (`explanation`) — clear pedagogical reasoning referencing the source material
- **Difficulty** (`Easy`, `Medium`, `Hard`)
- **Cognitive Level** (`LOTS` for C1–C3 Recall/Understand/Apply; `HOTS` for C4–C6 Analyze/Evaluate/Create)
- **Competency Indicator** (`competencyIndicator`)
- **Source Reference** (`sourceReference` — file name + page/slide/diagram/section)
- **Points** (`points` — integer, total sum must equal `targetTotalPoints`)

## Quality Guardrails

- Zero duplicate or near-duplicate stems across large sets (e.g. 40 questions).
- Distractors in MCQs must be plausible, grammatically parallel, and mutually exclusive.
- Never fabricate facts or answer keys outside the material when `strictSourceOnly` is enabled.
