import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  configureQuizAndInsertQuestions,
  createGoogleFormResource,
  createTestGoogleForm,
} from '../server/googleFormsService.ts';
import { ensureLocalOAuthBridge, tryOpenBrowser } from '../server/localOAuthServer.ts';
import type { ExamQuestion, ParticipantIdentityConfig, QuestionType } from '../shared/types.ts';

interface ExamPayloadInput {
  title?: string;
  description?: string;
  includeParticipantIdentity?: boolean;
  participantIdentity?: ParticipantIdentityConfig;
  questions?: Array<Partial<ExamQuestion> & { question: string }>;
}

function normalizeQuestion(
  raw: Partial<ExamQuestion> & { question: string },
  index: number
): ExamQuestion {
  const validType = (raw.type || 'multiple_choice_4') as QuestionType;
  return {
    id: raw.id || `q_${index + 1}_${crypto.randomUUID().slice(0, 4)}`,
    order: raw.order ?? index + 1,
    type: validType,
    cognitiveLevel: raw.cognitiveLevel === 'HOTS' ? 'HOTS' : 'LOTS',
    difficulty:
      raw.difficulty === 'Easy' || raw.difficulty === 'Hard' ? raw.difficulty : 'Medium',
    ...(raw.stimulus ? { stimulus: raw.stimulus } : {}),
    question: String(raw.question || '').trim(),
    ...(Array.isArray(raw.options) ? { options: raw.options } : {}),
    ...(Array.isArray(raw.matchingPairs) ? { matchingPairs: raw.matchingPairs } : {}),
    answerKey: raw.answerKey ?? '',
    explanation: raw.explanation || '',
    competencyIndicator: raw.competencyIndicator || '',
    sourceReference: raw.sourceReference || 'Materi Sumber',
    points: Math.max(0, Math.round(Number(raw.points) || 10)),
  };
}

function parseArgs(argv: string[]) {
  let inputPath = '';
  let isTest = false;
  let noOpen = false;
  let timeoutSec = 180;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--input' || arg === '-i') && argv[i + 1]) {
      inputPath = argv[++i];
    } else if (arg === '--test') {
      isTest = true;
    } else if (arg === '--no-open') {
      noOpen = true;
    } else if (arg === '--timeout' && argv[i + 1]) {
      timeoutSec = Math.max(15, Number(argv[++i]) || 180);
    } else if (!arg.startsWith('-') && !inputPath) {
      inputPath = arg;
    }
  }
  return { inputPath, isTest, noOpen, timeoutSec };
}

async function readExamInput(inputPath: string): Promise<ExamPayloadInput> {
  if (inputPath === '-') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as ExamPayloadInput;
  }
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File input tidak ditemukan: ${resolved}`);
  }
  return JSON.parse(fs.readFileSync(resolved, 'utf-8')) as ExamPayloadInput;
}

async function main() {
  const { inputPath, isTest, noOpen, timeoutSec } = parseArgs(process.argv.slice(2));

  if (!isTest && !inputPath) {
    console.error(
      'Penggunaan: node publish-google-form.mjs --input <exam.json> [--timeout 180] [--no-open]'
    );
    console.error('       atau: node publish-google-form.mjs --test');
    process.exit(1);
  }

  let payload: ExamPayloadInput = {};
  if (!isTest) {
    payload = await readExamInput(inputPath);
    if (!Array.isArray(payload.questions) || payload.questions.length === 0) {
      throw new Error('JSON ujian wajib memiliki array "questions" minimal 1 soal.');
    }
  }

  let bridge: Awaited<ReturnType<typeof ensureLocalOAuthBridge>> | null = null;
  try {
    let accessToken = process.env.ASSESSCRAFT_GOOGLE_ACCESS_TOKEN?.trim() || '';
    if (!accessToken) {
      bridge = await ensureLocalOAuthBridge('cli');
      console.error(
        `[AssessCraft OAuth] Buka tautan berikut di browser Anda untuk menyetujui akses Google Forms:\n${bridge.connectUrl}`
      );
      if (!noOpen) {
        tryOpenBrowser(bridge.connectUrl);
      }
      const authResult = await bridge.waitForAuthorization(timeoutSec * 1000);
      accessToken = authResult.accessToken;
      console.error(
        `[AssessCraft OAuth] Terhubung sebagai ${authResult.email || 'akun Google'}. Membuat Google Form...`
      );
    }

    if (isTest) {
      const result = await createTestGoogleForm(accessToken);
      console.log(JSON.stringify({ published: true, ...result }, null, 2));
      return;
    }

    const questions = (payload.questions || []).map((q, idx) => normalizeQuestion(q, idx));
    const includeIdentity = payload.includeParticipantIdentity !== false;
    const identity: ParticipantIdentityConfig = includeIdentity
      ? {
          includeFullName: payload.participantIdentity?.includeFullName ?? true,
          includeParticipantId: payload.participantIdentity?.includeParticipantId ?? true,
          includeClassOrOrg: payload.participantIdentity?.includeClassOrOrg ?? true,
          customFields: payload.participantIdentity?.customFields || [],
        }
      : {
          includeFullName: false,
          includeParticipantId: false,
          includeClassOrOrg: false,
        };

    const created = await createGoogleFormResource(accessToken, {
      title: payload.title?.trim() || 'Asesmen Evaluasi Multimodal',
      description:
        payload.description?.trim() ||
        'Formulir asesmen kuis yang dibuat otomatis melalui AssessCraft.',
      participantIdentity: identity,
    });

    const result = await configureQuizAndInsertQuestions(
      accessToken,
      created.formId,
      questions,
      includeIdentity
    );

    console.log(JSON.stringify({ published: true, ...result }, null, 2));
  } finally {
    if (bridge) {
      await bridge.close();
    }
  }
}

main().catch((err) => {
  console.error(
    JSON.stringify(
      {
        published: false,
        error: err instanceof Error ? err.message : 'Gagal membuat Google Form.',
      },
      null,
      2
    )
  );
  process.exit(1);
});
