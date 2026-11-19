import { createRequire as __assesscraftCreateRequire } from 'node:module';
const require = __assesscraftCreateRequire(import.meta.url);
import u from"node:fs";import l from"node:path";function p(i){let s=new Set,r=[];for(let e of i){let n=String(e||"").replace(/[\r\n]+/g," ").trim();n||(n=`Opsi ${r.length+1}`);let a=n,t=2;for(;s.has(a.toLowerCase());)a=`${n} (${t++})`;s.add(a.toLowerCase()),r.push(a)}return r}function c(i){let s={title:i.title?.trim()||"Asesmen Evaluasi Multimodal",description:i.description?.trim()||"Formulir asesmen kuis yang dibuat otomatis melalui AssessCraft.",includeParticipantIdentity:i.includeParticipantIdentity!==!1,participantIdentity:{includeFullName:i.participantIdentity?.includeFullName??!0,includeParticipantId:i.participantIdentity?.includeParticipantId??!0,includeClassOrOrg:i.participantIdentity?.includeClassOrOrg??!0,customFields:i.participantIdentity?.customFields||[]},questions:i.questions.map((e,n)=>({order:e.order??n+1,type:e.type||"multiple_choice_4",cognitiveLevel:e.cognitiveLevel||"LOTS",difficulty:e.difficulty||"Medium",stimulus:e.stimulus||"",question:String(e.question||"").trim(),options:Array.isArray(e.options)?p(e.options):[],matchingPairs:Array.isArray(e.matchingPairs)?e.matchingPairs:[],answerKey:e.answerKey??"",explanation:e.explanation||"",competencyIndicator:e.competencyIndicator||"",sourceReference:e.sourceReference||"",points:Math.max(0,Math.round(Number(e.points)||0))}))};return`/**
 * AssessCraft Universal \u2014 Google Apps Script Generator (Code.gs)
 * Cara pakai di https://script.google.com:
 * 1. Buka https://script.google.com -> klik "New project" (Proyek baru).
 * 2. Hapus seluruh isi Code.gs bawaan, lalu tempel seluruh skrip ini.
 * 3. Klik tombol "Run" (Jalankan) pada fungsi buatGoogleFormAssessCraft.
 * 4. Jika diminta izin akses Google Forms pertama kali, klik Review permissions -> Allow.
 * 5. Lihat link formulir (Responder & Edit URL) pada Execution Log di bawah!
 */

const ASSESSCRAFT_EXAM_DATA = ${JSON.stringify(s,null,2)};

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
    const helpParts = ['[' + q.type + ' \xB7 ' + q.cognitiveLevel + ' \xB7 ' + pts + ' Poin]'];
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
`}function d(i){let s="",r="";for(let e=0;e<i.length;e++){let n=i[e];(n==="--input"||n==="-i")&&i[e+1]?s=i[++e]:(n==="--out"||n==="-o")&&i[e+1]?r=i[++e]:!n.startsWith("-")&&!s&&(s=n)}return{inputPath:s,outPath:r}}async function m(){let{inputPath:i,outPath:s}=d(process.argv.slice(2));i||(console.error("Penggunaan: node generate-apps-script.mjs --input <exam.json> [--out Code.gs]"),process.exit(1));let r;if(i==="-"){let t=[];for await(let o of process.stdin)t.push(Buffer.isBuffer(o)?o:Buffer.from(o));r=Buffer.concat(t).toString("utf-8")}else r=u.readFileSync(l.resolve(i),"utf-8");let e=JSON.parse(r);if(!Array.isArray(e.questions)||e.questions.length===0)throw new Error('JSON ujian wajib memiliki array "questions" minimal 1 soal.');let n=e.questions.map((t,o)=>({id:t.id||`q_${o+1}`,order:t.order??o+1,type:t.type||"multiple_choice_4",cognitiveLevel:t.cognitiveLevel==="HOTS"?"HOTS":"LOTS",difficulty:t.difficulty==="Easy"||t.difficulty==="Hard"?t.difficulty:"Medium",...t.stimulus?{stimulus:t.stimulus}:{},question:String(t.question||"").trim(),...Array.isArray(t.options)?{options:t.options}:{},...Array.isArray(t.matchingPairs)?{matchingPairs:t.matchingPairs}:{},answerKey:t.answerKey??"",explanation:t.explanation||"",competencyIndicator:t.competencyIndicator||"",sourceReference:t.sourceReference||"Materi Sumber",points:Math.max(0,Math.round(Number(t.points)||10))})),a=c({title:e.title||"Asesmen Evaluasi Multimodal",description:e.description,includeParticipantIdentity:e.includeParticipantIdentity,participantIdentity:e.participantIdentity,questions:n});if(s){let t=l.resolve(s);u.writeFileSync(t,a,"utf-8"),console.log(JSON.stringify({ok:!0,outPath:t,bytes:Buffer.byteLength(a)}))}else process.stdout.write(a)}m().catch(i=>{console.error(i instanceof Error?i.message:"Gagal membuat Google Apps Script."),process.exit(1)});
