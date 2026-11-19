import fs from 'node:fs';
import path from 'node:path';
import { generateAppsScriptCode } from '../shared/appsScriptGenerator.ts';
import type { ExamQuestion, ParticipantIdentityConfig, QuestionType } from '../shared/types.ts';

interface ExamInput {
  title?: string;
  description?: string;
  includeParticipantIdentity?: boolean;
  participantIdentity?: ParticipantIdentityConfig;
  questions?: Array<Partial<ExamQuestion> & { question: string }>;
}

function parseArgs(argv: string[]) {
  let inputPath = '';
  let outPath = '';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--input' || arg === '-i') && argv[i + 1]) {
      inputPath = argv[++i];
    } else if ((arg === '--out' || arg === '-o') && argv[i + 1]) {
      outPath = argv[++i];
    } else if (!arg.startsWith('-') && !inputPath) {
      inputPath = arg;
    }
  }
  return { inputPath, outPath };
}

async function main() {
  const { inputPath, outPath } = parseArgs(process.argv.slice(2));
  if (!inputPath) {
    console.error('Penggunaan: node generate-apps-script.mjs --input <exam.json> [--out Code.gs]');
    process.exit(1);
  }

  let rawJson: string;
  if (inputPath === '-') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    rawJson = Buffer.concat(chunks).toString('utf-8');
  } else {
    rawJson = fs.readFileSync(path.resolve(inputPath), 'utf-8');
  }

  const parsed = JSON.parse(rawJson) as ExamInput;
  if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
    throw new Error('JSON ujian wajib memiliki array "questions" minimal 1 soal.');
  }

  const normalizedQuestions: ExamQuestion[] = parsed.questions.map((q, idx) => ({
    id: q.id || `q_${idx + 1}`,
    order: q.order ?? idx + 1,
    type: (q.type || 'multiple_choice_4') as QuestionType,
    cognitiveLevel: q.cognitiveLevel === 'HOTS' ? 'HOTS' : 'LOTS',
    difficulty: q.difficulty === 'Easy' || q.difficulty === 'Hard' ? q.difficulty : 'Medium',
    ...(q.stimulus ? { stimulus: q.stimulus } : {}),
    question: String(q.question || '').trim(),
    ...(Array.isArray(q.options) ? { options: q.options } : {}),
    ...(Array.isArray(q.matchingPairs) ? { matchingPairs: q.matchingPairs } : {}),
    answerKey: q.answerKey ?? '',
    explanation: q.explanation || '',
    competencyIndicator: q.competencyIndicator || '',
    sourceReference: q.sourceReference || 'Materi Sumber',
    points: Math.max(0, Math.round(Number(q.points) || 10)),
  }));

  const code = generateAppsScriptCode({
    title: parsed.title || 'Asesmen Evaluasi Multimodal',
    description: parsed.description,
    includeParticipantIdentity: parsed.includeParticipantIdentity,
    participantIdentity: parsed.participantIdentity,
    questions: normalizedQuestions,
  });

  if (outPath) {
    const resolvedOut = path.resolve(outPath);
    fs.writeFileSync(resolvedOut, code, 'utf-8');
    console.log(JSON.stringify({ ok: true, outPath: resolvedOut, bytes: Buffer.byteLength(code) }));
  } else {
    process.stdout.write(code);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : 'Gagal membuat Google Apps Script.');
  process.exit(1);
});
