---
name: assesscraft-material-reader
description: Multimodal material reader and OCR extractor skill for photos (JPG/JPEG/PNG/WEBP), PDF, DOCX, PPTX, TXT, and typed text. Use when the user uploads study materials or documents and wants text extraction, diagram/table/chart interpretation, or readability checks before generating questions.
---

# AssessCraft Material Reader

Read and transcribe multimodal educational and training materials accurately without hallucinating content.

## Instructions

1. **Accepted Formats**: Photos (`JPG`, `JPEG`, `PNG`, `WEBP`), `PDF`, `DOCX`, `PPTX`, `TXT`, and typed text, including multi-file batches.
2. **Multimodal Inspection**:
   - Extract visible text accurately via OCR.
   - Transcribe and interpret tables, diagrams, charts, graphs, formulas, and illustrations.
   - Identify core topics, key concepts, subject domain, education/training level, and language.
3. **Readability Gate**:
   - If any image or document page is blurry, cropped, low-resolution, or unreadable, flag that specific file/section and ask the user to re-upload a clearer copy before proceeding.
4. **MCP Execution**:
   - Call `upload_material` / `extract_text` / `analyze_material` when AssessCraft MCP tools are connected.
   - If the user needs to upload large binary files from a phone or browser, provide the `/upload` portal URL returned by `upload_material`.
