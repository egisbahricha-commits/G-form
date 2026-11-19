import type { ExamQuestion, ParticipantIdentityConfig } from './types.ts';

export interface AppsScriptPayload {
  title: string;
  description?: string;
  includeParticipantIdentity?: boolean;
  participantIdentity?: ParticipantIdentityConfig;
  questions: ExamQuestion[];
}

function sanitizeOptionsForScript(rawOptions: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of rawOptions) {
    let val = String(raw || '').replace(/[\r\n]+/g, ' ').trim();
    if (!val) val = `Opsi ${out.length + 1}`;
    let unique = val;
    let suffix = 2;
    while (seen.has(unique.toLowerCase())) {
      unique = `${val} (${suffix++})`;
    }
    seen.add(unique.toLowerCase());
    out.push(unique);
  }
  return out;
}

export function generateAppsScriptCode(payload: AppsScriptPayload): string {
  const normalizedData = {
    title: payload.title?.trim() || 'Asesmen Evaluasi Multimodal',
    description:
      payload.description?.trim() ||
      'Formulir asesmen kuis yang dibuat otomatis melalui AssessCraft.',
    includeParticipantIdentity: payload.includeParticipantIdentity !== false,
    participantIdentity: {
      includeFullName: payload.participantIdentity?.includeFullName ?? true,
      includeParticipantId: payload.participantIdentity?.includeParticipantId ?? true,
      includeClassOrOrg: payload.participantIdentity?.includeClassOrOrg ?? true,
      customFields: payload.participantIdentity?.customFields || [],
    },
    questions: payload.questions.map((q, idx) => ({
      order: q.order ?? idx + 1,
      type: q.type || 'multiple_choice_4',
      cognitiveLevel: q.cognitiveLevel || 'LOTS',
      difficulty: q.difficulty || 'Medium',
      stimulus: q.stimulus || '',
      question: String(q.question || '').trim(),
      options: Array.isArray(q.options) ? sanitizeOptionsForScript(q.options) : [],
      matchingPairs: Array.isArray(q.matchingPairs) ? q.matchingPairs : [],
      answerKey: q.answerKey ?? '',
      explanation: q.explanation || '',
      competencyIndicator: q.competencyIndicator || '',
      sourceReference: q.sourceReference || '',
      points: Math.max(0, Math.round(Number(q.points) || 0)),
    })),
  };

  const jsonLiteral = JSON.stringify(normalizedData, null, 2);

  return `/**
 * AssessCraft Universal — Google Apps Script Generator (Code.gs)
 * Cara pakai di https://script.google.com:
 * 1. Buka https://script.google.com -> klik "New project" (Proyek baru).
 * 2. Hapus seluruh isi Code.gs bawaan, lalu tempel seluruh skrip ini.
 * 3. Klik tombol "Run" (Jalankan) pada fungsi buatGoogleFormAssessCraft.
 * 4. Jika diminta izin akses Google Forms pertama kali, klik Review permissions -> Allow.
 * 5. Lihat link formulir (Responder & Edit URL) pada Execution Log di bawah!
 */

const ASSESSCRAFT_EXAM_DATA = ${jsonLiteral};

function matchChoiceText_(rawKey, options) {
  const cleanKey = String(rawKey || '').trim();
  if (!cleanKey || !options.length) return options[0] || '';
  const exact = options.find((opt) => opt.toLowerCase() === cleanKey.toLowerCase());
  if (exact) return exact;

  // Support letter keys like "A", "B", "C", "D", "E"
  const letterMatch = cleanKey.match(/^([A-Ea-e])(?:[).:\\s]|$)/);
  if (letterMatch) {
    const idx = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
    if (idx >= 0 && idx < options.length) return options[idx];
  }
  return options[0];
}

function buatGoogleFormAssessCraft() {
  const data = ASSESSCRAFT_EXAM_DATA;
  const form = FormApp.create(data.title);
  form.setDescription(data.description);
  form.setIsQuiz(true);
  form.setShowLinkToRespondAgain(false);

  // Bagian Identitas Peserta
  const idCfg = data.participantIdentity || {};
  const hasIdentity =
    data.includeParticipantIdentity &&
    (idCfg.includeFullName ||
      idCfg.includeParticipantId ||
      idCfg.includeClassOrOrg ||
      (idCfg.customFields && idCfg.customFields.length > 0));

  if (hasIdentity) {
    form.addSectionHeaderItem()
      .setTitle('Identitas Peserta')
      .setHelpText('Mohon lengkapi data identitas sebelum mengerjakan soal.');

    if (idCfg.includeFullName) {
      form.addTextItem().setTitle('Nama Lengkap').setRequired(true);
    }
    if (idCfg.includeParticipantId) {
      form.addTextItem().setTitle('Nomor Induk / ID Peserta').setRequired(true);
    }
    if (idCfg.includeClassOrOrg) {
      form.addTextItem().setTitle('Kelas / Program / Instansi').setRequired(true);
    }
    (idCfg.customFields || []).forEach(function (field) {
      const label = String(field || '').trim();
      if (label) {
        form.addTextItem().setTitle(label).setRequired(true);
      }
    });

    form.addPageBreakItem()
      .setTitle('Bagian Soal Asesmen')
      .setHelpText('Bacalah setiap soal dan stimulus dengan saksama sebelum menjawab.');
  }

  // Memasukkan seluruh butir soal
  data.questions.forEach(function (q, idx) {
    const num = idx + 1;
    const pts = Math.max(0, Math.round(Number(q.points) || 0));
    const helpParts = ['[' + q.type + ' · ' + q.cognitiveLevel + ' · ' + pts + ' Poin]'];
    if (q.stimulus) helpParts.push('Stimulus:\\n' + q.stimulus);
    if (q.competencyIndicator) helpParts.push('Indikator: ' + q.competencyIndicator);
    const helpText = helpParts.join('\\n\\n');

    const feedbackParts = [];
    if (q.explanation) feedbackParts.push('Pembahasan: ' + q.explanation);
    if (q.sourceReference) feedbackParts.push('Sumber Materi: ' + q.sourceReference);
    const feedbackText = feedbackParts.join('\\n');

    // 1. Menjodohkan (Grid)
    if (q.type === 'matching' && q.matchingPairs && q.matchingPairs.length > 0) {
      const cols = [];
      q.matchingPairs.forEach(function (p) {
        const val = String(p.match || '').trim();
        if (val && cols.indexOf(val) === -1) cols.push(val);
      });
      const keySummary = q.matchingPairs
        .map(function (p, i) { return (i + 1) + '. ' + p.prompt + ' -> ' + p.match; })
        .join('\\n');

      form.addGridItem()
        .setTitle(num + '. ' + q.question)
        .setHelpText(helpText + '\\n\\nKunci Penilaian (' + pts + ' Poin):\\n' + keySummary)
        .setRows(q.matchingPairs.map(function (p) { return String(p.prompt || '').trim(); }))
        .setColumns(cols)
        .setRequired(true);
      return;
    }

    // 2. Pilihan Ganda Kompleks (Checkbox)
    if (q.type === 'complex_multiple_choice' && q.options && q.options.length >= 2) {
      const rawKeys = Array.isArray(q.answerKey) ? q.answerKey : [String(q.answerKey || '')];
      const matchedKeys = rawKeys.map(function (k) { return matchChoiceText_(k, q.options); });
      const item = form.addCheckboxItem()
        .setTitle(num + '. ' + q.question)
        .setHelpText(helpText)
        .setPoints(pts)
        .setRequired(true);
      item.setChoices(
        q.options.map(function (opt) {
          return item.createChoice(opt, matchedKeys.indexOf(opt) !== -1);
        })
      );
      if (feedbackText) {
        item.setFeedbackForCorrect(FormApp.createFeedback().setText(feedbackText).build());
        item.setFeedbackForIncorrect(
          FormApp.createFeedback()
            .setText('Kunci: ' + matchedKeys.join(', ') + '\\n\\n' + feedbackText)
            .build()
        );
      }
      return;
    }

    // 3. Pilihan Ganda / Benar-Salah / Soal Berbasis Opsi
    if (q.options && q.options.length >= 2 && q.type !== 'short_answer' && q.type !== 'essay') {
      const singleKey = Array.isArray(q.answerKey) ? q.answerKey[0] : q.answerKey;
      const correctVal = matchChoiceText_(singleKey, q.options);
      const item = form.addMultipleChoiceItem()
        .setTitle(num + '. ' + q.question)
        .setHelpText(helpText)
        .setPoints(pts)
        .setRequired(true);
      item.setChoices(
        q.options.map(function (opt) {
          return item.createChoice(opt, opt === correctVal);
        })
      );
      if (feedbackText) {
        item.setFeedbackForCorrect(FormApp.createFeedback().setText(feedbackText).build());
        item.setFeedbackForIncorrect(
          FormApp.createFeedback()
            .setText('Kunci: ' + correctVal + '\\n\\n' + feedbackText)
            .build()
        );
      }
      return;
    }

    // 4. Isian Singkat
    if (q.type === 'short_answer') {
      const keyStr = Array.isArray(q.answerKey) ? q.answerKey.join(', ') : String(q.answerKey || '');
      const item = form.addTextItem()
        .setTitle(num + '. ' + q.question)
        .setHelpText(helpText)
        .setPoints(pts)
        .setRequired(true);
      item.setGeneralFeedback(
        FormApp.createFeedback()
          .setText('Kunci Jawaban: ' + keyStr + (feedbackText ? '\\n\\n' + feedbackText : ''))
          .build()
      );
      return;
    }

    // 5. Esai / Analisis Kasus / Stimulus Terbuka
    const rubricStr = Array.isArray(q.answerKey) ? q.answerKey.join('; ') : String(q.answerKey || '');
    const item = form.addParagraphTextItem()
      .setTitle(num + '. ' + q.question)
      .setHelpText(helpText)
      .setPoints(pts)
      .setRequired(true);
    item.setGeneralFeedback(
      FormApp.createFeedback()
        .setText('Kunci / Rubrik Penilaian:\\n' + rubricStr + (feedbackText ? '\\n\\n' + feedbackText : ''))
        .build()
    );
  });

  Logger.log('=== GOOGLE FORM BERHASIL DIBUAT ===');
  Logger.log('Judul Form: ' + data.title);
  Logger.log('Link Peserta (Responder URL): ' + form.getPublishedUrl());
  Logger.log('Link Edit (Editor URL): ' + form.getEditUrl());

  return {
    title: data.title,
    responderUri: form.getPublishedUrl(),
    editUrl: form.getEditUrl()
  };
}
`;
}
