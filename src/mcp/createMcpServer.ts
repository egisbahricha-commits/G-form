import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ExamQuestion, ExamSession, QuestionType } from '../shared/types.ts';
import { QUESTION_TYPE_LABELS } from '../shared/types.ts';
import { getAuthorizedGoogleToken } from '../server/authBridge.ts';
import {
  analyzeSessionMaterials,
  extractTextFromSingleMaterial,
  generateExplanationsForQuestions,
  generateOrVerifyAnswerKeys,
  generateQuestionsWithGemini,
  validateExamQuestions,
} from '../server/geminiEngine.ts';
import {
  configureQuizAndInsertQuestions,
  createGoogleFormResource,
  getGoogleFormLinks,
  GoogleFormsAuthError,
} from '../server/googleFormsService.ts';
import { ensureLocalOAuthBridge, tryOpenBrowser } from '../server/localOAuthServer.ts';
import {
  createTypedTextMaterial,
  parseUploadedBuffer,
} from '../server/materialParser.ts';
import {
  createSession,
  getOrCreateSession,
  getSession,
  saveSession,
} from '../server/store.ts';

export interface McpExecutionContext {
  googleAccessToken?: string;
  publicBaseUrl?: string;
  localOAuthFallback?: boolean;
}

const QuestionTypeEnum = z.enum([
  'multiple_choice_4',
  'multiple_choice_5',
  'complex_multiple_choice',
  'true_false',
  'matching',
  'short_answer',
  'essay',
  'case_analysis',
  'stimulus_based',
]);

const InlineQuestionSchema = z.object({
  id: z.string().optional(),
  order: z.number().int().optional(),
  type: QuestionTypeEnum.default('multiple_choice_4'),
  cognitiveLevel: z.enum(['LOTS', 'HOTS']).default('LOTS'),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']).default('Medium'),
  stimulus: z.string().optional(),
  question: z.string().min(1),
  options: z.array(z.string()).optional(),
  matchingPairs: z
    .array(z.object({ prompt: z.string(), match: z.string() }))
    .optional(),
  answerKey: z.union([z.string(), z.array(z.string())]),
  explanation: z.string().default(''),
  competencyIndicator: z.string().default(''),
  sourceReference: z.string().default('Materi Sumber'),
  points: z.number().nonnegative().default(10),
});

const ParticipantIdentitySchema = z.object({
  includeFullName: z.boolean().optional(),
  includeParticipantId: z.boolean().optional(),
  includeClassOrOrg: z.boolean().optional(),
  customFields: z.array(z.string()).optional(),
});

const InlineFileSchema = z.object({
  filename: z
    .string()
    .describe(
      'Nama file lengkap beserta ekstensi (.jpg, .jpeg, .png, .webp, .pdf, .docx, .pptx, .txt).'
    ),
  mimeType: z.string().optional().describe('MIME type file.'),
  base64Content: z
    .string()
    .optional()
    .describe('Isi file biner dalam Base64 (mendukung data URI atau raw base64).'),
  fileUrl: z
    .string()
    .optional()
    .describe('URL HTTPS publik untuk mengunduh file materi.'),
  filePath: z
    .string()
    .optional()
    .describe('Path file lokal pada host MCP (untuk mode lokal).'),
  textContent: z
    .string()
    .optional()
    .describe('Isi teks mentah untuk dokumen teks atau hasil bacaan awal.'),
});

function isGeminiConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key !== 'MY_GEMINI_API_KEY');
}

function normalizeInlineQuestions(
  rawQuestions: Array<z.infer<typeof InlineQuestionSchema>>
): ExamQuestion[] {
  return rawQuestions.map((q, idx) => ({
    id: q.id?.trim() || `q_${idx + 1}_${crypto.randomUUID().slice(0, 4)}`,
    order: q.order ?? idx + 1,
    type: q.type,
    cognitiveLevel: q.cognitiveLevel ?? 'LOTS',
    difficulty: q.difficulty ?? 'Medium',
    ...(q.stimulus ? { stimulus: q.stimulus } : {}),
    question: q.question.trim(),
    ...(q.options ? { options: q.options } : {}),
    ...(q.matchingPairs ? { matchingPairs: q.matchingPairs } : {}),
    answerKey: q.answerKey,
    explanation: q.explanation || '',
    competencyIndicator: q.competencyIndicator || '',
    sourceReference: q.sourceReference || 'Materi Sumber',
    points: Math.max(0, Math.round(Number(q.points) || 0)),
  }));
}

function createSessionOrLoadForDirectPublish(
  title?: string,
  description?: string
): ExamSession {
  return createSession({
    title: title?.trim() || 'Asesmen Evaluasi Multimodal',
    description:
      description?.trim() ||
      'Formulir asesmen yang disusun berdasarkan analisis materi sumber.',
  });
}

function jsonResult(payload: unknown, isError = false) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
    isError,
  };
}

function getPublicBaseUrl(ctx?: McpExecutionContext): string {
  const raw =
    ctx?.publicBaseUrl ||
    process.env.APP_URL ||
    `http://localhost:${process.env.PORT || 3000}`;
  return raw.replace(/\/+$/, '');
}

function resolveAccessToken(
  sessionId: string,
  argToken?: string,
  ctx?: McpExecutionContext
): string | null {
  if (argToken?.trim()) return argToken.trim();
  if (ctx?.googleAccessToken?.trim()) return ctx.googleAccessToken.trim();
  const bridged = getAuthorizedGoogleToken(sessionId);
  if (bridged?.accessToken) return bridged.accessToken;
  return null;
}

async function resolveAuthRequiredPayload(sessionId: string, ctx?: McpExecutionContext) {
  let authUrl: string;
  const hasRemoteUrl = Boolean(
    ctx?.publicBaseUrl ||
      (process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL')
  );

  if (ctx?.localOAuthFallback && !hasRemoteUrl) {
    const bridge = await ensureLocalOAuthBridge(sessionId);
    authUrl = bridge.connectUrl;
    tryOpenBrowser(authUrl);
  } else {
    const baseUrl = getPublicBaseUrl(ctx);
    authUrl = `${baseUrl}/connect?sessionId=${encodeURIComponent(sessionId)}`;
  }

  return {
    requiresAuthorization: true,
    sessionId,
    authorizationUrl: authUrl,
    message:
      'Akun Google Forms belum terhubung atau sesi OAuth kedaluwarsa. Minta pengguna membuka authorizationUrl (otomatis terbuka di browser atau klik langsung) untuk menyetujui akses Google Forms, lalu panggil ulang tool ini setelah pengguna selesai.',
  };
}

function requireExistingSession(sessionId: string): ExamSession {
  const session = getSession(sessionId);
  if (!session) {
    throw new Error(
      `Sesi "${sessionId}" tidak ditemukan. Kirim materi melalui upload_material atau analyze_material terlebih dahulu.`
    );
  }
  return session;
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.local')) return true;
  if (net.isIP(lower)) {
    if (
      lower === '127.0.0.1' ||
      lower === '::1' ||
      lower.startsWith('10.') ||
      lower.startsWith('192.168.') ||
      lower.startsWith('169.254.') ||
      lower.startsWith('fc') ||
      lower.startsWith('fd')
    ) {
      return true;
    }
    const octets = lower.split('.').map(Number);
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  }
  return false;
}

async function fetchUrlToBuffer(rawUrl: string): Promise<Buffer> {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('fileUrl harus menggunakan protokol https:// atau http://');
  }
  if (isPrivateOrLoopbackHost(parsed.hostname)) {
    throw new Error('Akses fileUrl ke alamat jaringan internal tidak diizinkan.');
  }
  const response = await fetch(parsed.toString());
  if (!response.ok) {
    throw new Error(`Gagal mengunduh fileUrl (HTTP ${response.status}).`);
  }
  const arrayBuf = await response.arrayBuffer();
  if (arrayBuf.byteLength > 25 * 1024 * 1024) {
    throw new Error('Ukuran file dari fileUrl melebihi batas 25 MB.');
  }
  return Buffer.from(arrayBuf);
}

async function ingestMaterialsIntoSession(
  session: ExamSession,
  params: {
    files?: Array<z.infer<typeof InlineFileSchema>>;
    typedText?: string;
    typedTitle?: string;
  }
) {
  const uploaded: Array<{
    id: string;
    name: string;
    kind: string;
    sizeBytes: number;
    readabilityStatus: string;
  }> = [];

  for (const f of params.files || []) {
    let buffer: Buffer;
    if (f.base64Content) {
      const cleanB64 = f.base64Content.replace(/^data:[^;]+;base64,/, '');
      buffer = Buffer.from(cleanB64, 'base64');
    } else if (f.fileUrl) {
      buffer = await fetchUrlToBuffer(f.fileUrl);
    } else if (f.filePath) {
      const resolved = path.resolve(f.filePath);
      if (!fs.existsSync(resolved)) {
        throw new Error(`File tidak ditemukan di path: ${f.filePath}`);
      }
      buffer = fs.readFileSync(resolved);
    } else if (f.textContent !== undefined) {
      buffer = Buffer.from(f.textContent, 'utf-8');
    } else {
      throw new Error(
        `File "${f.filename}" harus menyertakan base64Content, fileUrl, filePath, atau textContent.`
      );
    }

    const parsed = await parseUploadedBuffer({
      filename: f.filename,
      mimeType: f.mimeType,
      buffer,
    });
    session.materials.push(parsed);
    uploaded.push({
      id: parsed.id,
      name: parsed.name,
      kind: parsed.kind,
      sizeBytes: parsed.sizeBytes,
      readabilityStatus: parsed.readabilityStatus,
    });
  }

  if (params.typedText && params.typedText.trim()) {
    const typedMat = createTypedTextMaterial(
      params.typedTitle || 'Materi Ketik Langsung',
      params.typedText
    );
    session.materials.push(typedMat);
    uploaded.push({
      id: typedMat.id,
      name: typedMat.name,
      kind: typedMat.kind,
      sizeBytes: typedMat.sizeBytes,
      readabilityStatus: typedMat.readabilityStatus,
    });
  }

  if (uploaded.length > 0) {
    session.analysis = null;
    session.approvedForPublish = false;
  }

  return uploaded;
}

export const MCP_TOOL_METADATA = [
  {
    name: 'upload_material',
    title: 'Upload Multimodal Material',
    description:
      'Mengunggah file gambar (JPG/JPEG/PNG/WEBP), PDF, DOCX, PPTX, TXT (via base64Content, fileUrl, filePath, atau textContent) dan/atau materi teks langsung ke sesi.',
  },
  {
    name: 'extract_text',
    title: 'Extract Text & OCR',
    description:
      'Mengekstrak teks penuh dari dokumen (PDF/DOCX/PPTX/TXT) serta melakukan OCR multimodal pada gambar dan diagram. Mendukung input materi langsung jika sesi baru dibuat.',
  },
  {
    name: 'analyze_material',
    title: 'Analyze Multimodal Material',
    description:
      'Menganalisis materi menggunakan Gemini Multimodal untuk membaca teks OCR, tabel, diagram, grafik, pokok pembahasan, konsep penting, ringkasan, dan keterbacaan. Dapat menerima materi inline langsung.',
  },
  {
    name: 'generate_questions',
    title: 'Generate Universal Questions',
    description:
      'Menghasilkan soal universal via Gemini API (1–50 soal, bebas mata pelajaran & jenjang) mendukung PG 4/5 opsi, PG Kompleks, Benar-Salah, Menjodohkan, Isian Singkat, Esai, HOTS, LOTS, Analisis Kasus, dan Stimulus.',
  },
  {
    name: 'generate_answer_key',
    title: 'Generate / Verify Answer Key',
    description:
      'Menghasilkan dan memverifikasi kunci jawaban agar akurat dan selaras dengan materi sumber tanpa mengarang jawaban.',
  },
  {
    name: 'generate_explanations',
    title: 'Generate Explanations',
    description:
      'Menyusun dan memperkaya pembahasan pedagogis, indikator kompetensi, serta rujukan bagian materi untuk setiap soal.',
  },
  {
    name: 'validate_questions',
    title: 'Validate Exam Quality',
    description:
      'Memvalidasi ketepatan jumlah soal, total bobot nilai, deteksi duplikasi, konsistensi soal-jawaban, dan keterikatan terhadap materi sumber.',
  },
  {
    name: 'preview_exam',
    title: 'Preview Exam & Request Approval',
    description:
      'Menampilkan pratinjau lengkap ujian (judul, identitas peserta, seluruh soal, kunci jawaban, pembahasan, bobot poin) untuk konfirmasi pengguna sebelum membuat Google Form.',
  },
  {
    name: 'create_google_form',
    title: 'Create Google Form',
    description:
      'Membuat formulir Google Form baru beserta bagian identitas peserta (Nama Lengkap, ID Peserta, Kelas/Instansi) menggunakan Google OAuth 2.0.',
  },
  {
    name: 'configure_quiz',
    title: 'Configure Quiz Mode & Items',
    description:
      'Mengaktifkan mode kuis (isQuiz: true) pada Google Form dan memasukkan seluruh pertanyaan, kunci jawaban, bobot poin, serta pembahasan.',
  },
  {
    name: 'publish_exam',
    title: 'Publish Exam (Approval-Gated)',
    description:
      'Alur gabungan satu langkah membuat Google Form, mengaktifkan kuis, dan memasukkan seluruh soal setelah mendapat persetujuan eksplisit pengguna (approved: true).',
  },
  {
    name: 'get_form_links',
    title: 'Get Google Form Links',
    description:
      'Mengembalikan link formulir untuk peserta (responderUri) dan link edit untuk pembuat soal (editUrl).',
  },
] as const;

export function createAssessCraftMcpServer(
  defaultContext?: McpExecutionContext
): McpServer {
  const server = new McpServer(
    {
      name: 'assesscraft-universal-mcp',
      version: '2.0.0',
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
        resources: {},
      },
    }
  );

  // Register autonomous workflow prompt for Claude
  server.registerPrompt(
    'assesscraft_autonomous_workflow',
    {
      title: 'Alur Agen Pembuat Soal Google Forms',
      description:
        'Panduan alur otonom Claude dalam memproses lampiran materi, menghasilkan soal via Gemini, memvalidasi kunci jawaban, meminta persetujuan pengguna, dan menerbitkan ke Google Forms.',
      argsSchema: {
        userGoal: z.string().optional().describe('Permintaan pengguna terkait jumlah/jenis soal.'),
      },
    },
    async ({ userGoal }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Jalankan alur kerja otonom pembuat soal berikut untuk permintaan: "${userGoal || 'Buat soal dan masukkan ke Google Form baru'}":
1. Baca materi lampiran (foto/PDF/DOCX/PPTX/teks) dan panggil analyze_material (atau upload_material -> analyze_material).
2. Jika ada bagian tidak terbaca, minta pengguna mengunggah ulang bagian tersebut.
3. Panggil generate_questions dengan jumlah, jenis soal, dan jenjang sesuai permintaan.
4. Panggil generate_answer_key dan validate_questions untuk memastikan kunci jawaban akurat, tanpa duplikasi, dan jumlah soal/poin sesuai.
5. Panggil preview_exam, tampilkan ringkasan & daftar soal ke pengguna, dan WAJIB minta konfirmasi persetujuan pengguna sebelum membuat Google Form.
6. Setelah pengguna setuju, panggil create_google_form -> configure_quiz -> get_form_links. Jika tool mengembalikan requiresAuthorization: true, berikan tautan authorizationUrl agar pengguna menghubungkan akun Google Forms dari browser/HP, lalu lanjutkan setelah pengguna selesai.
7. Kembalikan link formulir (responderUri) dan link edit (editUrl) kepada pengguna.`,
          },
        },
      ],
    })
  );

  // Register server capabilities resource
  server.registerResource(
    'server_capabilities',
    'assesscraft://capabilities',
    {
      title: 'AssessCraft Remote MCP Capabilities',
      description: 'Informasi kapabilitas multimodal, tautan upload mobile, dan OAuth Google Forms.',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: 'assesscraft://capabilities',
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              server: 'assesscraft-universal-mcp',
              version: '2.0.0',
              supportedInputs: ['JPG', 'JPEG', 'PNG', 'WEBP', 'PDF', 'DOCX', 'PPTX', 'TXT', 'Typed Text'],
              supportedQuestionTypes: Object.keys(QUESTION_TYPE_LABELS),
              connectOAuthUrl: `${getPublicBaseUrl(defaultContext)}/connect`,
              mobileUploadPortalUrl: `${getPublicBaseUrl(defaultContext)}/upload`,
              tools: MCP_TOOL_METADATA.map((t) => t.name),
            },
            null,
            2
          ),
        },
      ],
    })
  );

  // 1. upload_material
  server.registerTool(
    'upload_material',
    {
      title: 'Upload Multimodal Material',
      description: MCP_TOOL_METADATA[0].description,
      inputSchema: {
        sessionId: z.string().optional().describe('ID sesi ujian (opsional, otomatis dibuat jika kosong).'),
        title: z.string().optional().describe('Judul ujian atau sesi asesmen.'),
        files: z.array(InlineFileSchema).optional().describe('Daftar file materi yang diunggah sekaligus.'),
        typedText: z.string().optional().describe('Materi pelajaran yang diketik langsung atau transkrip teks.'),
        typedTitle: z.string().optional().describe('Judul catatan materi.'),
      },
    },
    async (args) => {
      try {
        const session = getOrCreateSession(args.sessionId);
        if (args.title) session.title = args.title;

        const uploaded = await ingestMaterialsIntoSession(session, {
          files: args.files,
          typedText: args.typedText,
          typedTitle: args.typedTitle,
        });

        if (uploaded.length === 0) {
          const baseUrl = getPublicBaseUrl(defaultContext);
          return jsonResult(
            {
              sessionId: session.id,
              requiresFileInput: true,
              uploadPortalUrl: `${baseUrl}/upload?sessionId=${encodeURIComponent(session.id)}`,
              message:
                'Tidak ada data file atau teks yang diterima. Kirim base64Content/fileUrl/textContent pada tool ini, atau arahkan pengguna mengunggah file PDF/DOCX/PPTX/foto melalui uploadPortalUrl.',
            },
            true
          );
        }

        saveSession(session);

        return jsonResult({
          sessionId: session.id,
          uploadedCount: uploaded.length,
          totalMaterialsInSession: session.materials.length,
          uploaded,
          nextStep: 'Panggil extract_text atau analyze_material untuk membaca dan menganalisis isi materi.',
        });
      } catch (err) {
        return jsonResult(
          { error: err instanceof Error ? err.message : 'Gagal mengunggah materi.' },
          true
        );
      }
    }
  );

  // 2. extract_text
  server.registerTool(
    'extract_text',
    {
      title: 'Extract Text & OCR',
      description: MCP_TOOL_METADATA[1].description,
      inputSchema: {
        sessionId: z.string().optional().describe('ID sesi ujian (otomatis dibuat jika menyertakan files/typedText).'),
        materialId: z.string().optional().describe('ID file materi spesifik (opsional).'),
        files: z.array(InlineFileSchema).optional().describe('Opsional: lampirkan file langsung jika belum memanggil upload_material.'),
        typedText: z.string().optional().describe('Opsional: teks materi langsung.'),
      },
    },
    async (args) => {
      try {
        const session =
          args.files?.length || args.typedText
            ? getOrCreateSession(args.sessionId)
            : args.sessionId
            ? requireExistingSession(args.sessionId)
            : (() => {
                throw new Error('Sertakan sessionId atau materi (files / typedText).');
              })();

        if (args.files?.length || args.typedText) {
          await ingestMaterialsIntoSession(session, {
            files: args.files,
            typedText: args.typedText,
          });
          saveSession(session);
        }

        const targets = args.materialId
          ? session.materials.filter((m) => m.id === args.materialId)
          : session.materials;

        if (targets.length === 0) {
          throw new Error('Materi tidak ditemukan dalam sesi.');
        }

        const results: Array<{
          materialId: string;
          name: string;
          readabilityStatus: string;
          readabilityMessage?: string;
          extractedText: string;
        }> = [];

        for (const mat of targets) {
          if (
            !isGeminiConfigured() &&
            (mat.kind === 'docx' || mat.kind === 'pptx' || mat.kind === 'txt' || mat.kind === 'text')
          ) {
            results.push({
              materialId: mat.id,
              name: mat.name,
              readabilityStatus: mat.readabilityStatus,
              readabilityMessage: mat.readabilityMessage,
              extractedText: mat.extractedText,
            });
            continue;
          }
          if (!isGeminiConfigured() && (mat.kind === 'image' || mat.kind === 'pdf')) {
            results.push({
              materialId: mat.id,
              name: mat.name,
              readabilityStatus: 'pending',
              readabilityMessage:
                'GEMINI_API_KEY tidak aktif pada mode plugin lokal — baca lampiran gambar/PDF langsung menggunakan visi bawaan Claude.',
              extractedText: mat.extractedText || '',
            });
            continue;
          }

          const res = await extractTextFromSingleMaterial(mat);
          mat.extractedText = res.extractedText;
          mat.readabilityStatus = res.readabilityStatus;
          mat.readabilityMessage = res.readabilityMessage;
          results.push({
            materialId: mat.id,
            name: mat.name,
            readabilityStatus: mat.readabilityStatus,
            readabilityMessage: mat.readabilityMessage,
            extractedText: mat.extractedText,
          });
        }

        saveSession(session);
        return jsonResult({
          sessionId: session.id,
          extractedFiles: results,
        });
      } catch (err) {
        return jsonResult(
          { error: err instanceof Error ? err.message : 'Gagal mengekstrak teks materi.' },
          true
        );
      }
    }
  );

  // 3. analyze_material
  server.registerTool(
    'analyze_material',
    {
      title: 'Analyze Multimodal Material',
      description: MCP_TOOL_METADATA[2].description,
      inputSchema: {
        sessionId: z.string().optional().describe('ID sesi ujian (opsional jika mengirim files/materialText langsung).'),
        title: z.string().optional().describe('Judul asesmen (opsional).'),
        files: z.array(InlineFileSchema).optional().describe('Opsional: lampirkan foto/PDF/DOCX/PPTX/TXT langsung.'),
        materialText: z.string().optional().describe('Opsional: materi teks atau transkrip isi lampiran dari Claude.'),
        subjectHint: z.string().optional().describe('Petunjuk bidang ilmu/mata pelajaran (opsional).'),
        educationLevelHint: z.string().optional().describe('Petunjuk jenjang pendidikan/pelatihan (opsional).'),
      },
    },
    async (args) => {
      try {
        const session =
          args.files?.length || args.materialText
            ? getOrCreateSession(args.sessionId)
            : args.sessionId
            ? requireExistingSession(args.sessionId)
            : (() => {
                throw new Error('Sertakan sessionId atau lampiran materi (files / materialText).');
              })();

        if (args.title) session.title = args.title;
        if (args.files?.length || args.materialText) {
          await ingestMaterialsIntoSession(session, {
            files: args.files,
            typedText: args.materialText,
          });
          saveSession(session);
        }

        if (args.subjectHint) session.config.subject = args.subjectHint;
        if (args.educationLevelHint) session.config.educationLevel = args.educationLevelHint;

        if (!isGeminiConfigured()) {
          saveSession(session);
          return jsonResult({
            sessionId: session.id,
            geminiConfigured: false,
            fallbackMode: 'claude-native',
            materials: session.materials.map((m) => ({
              id: m.id,
              name: m.name,
              kind: m.kind,
              readabilityStatus: m.readabilityStatus,
              extractedText: m.extractedText,
            })),
            message:
              'GEMINI_API_KEY tidak diatur pada mode lokal. Silakan baca materi/teks di atas secara langsung menggunakan Claude, susun soal dan pratinjau untuk persetujuan pengguna, lalu kirim array questions langsung ke publish_exam.',
          });
        }

        const analysis = await analyzeSessionMaterials(session);
        session.analysis = analysis;

        for (const t of analysis.ocrTranscripts) {
          const mat = session.materials.find((m) => m.id === t.fileId || m.name === t.fileName);
          if (mat && t.text && !mat.extractedText.includes(t.text)) {
            mat.extractedText = [mat.extractedText, t.text].filter(Boolean).join('\n\n');
            if (mat.readabilityStatus === 'pending') {
              mat.readabilityStatus = 'readable';
            }
          }
        }
        for (const u of analysis.unreadableFiles) {
          const mat = session.materials.find((m) => m.id === u.fileId || m.name === u.fileName);
          if (mat) {
            mat.readabilityStatus = 'unreadable';
            mat.readabilityMessage = `${u.reason} ${u.actionRequired}`;
          }
        }
        for (const mat of session.materials) {
          if (mat.readabilityStatus === 'pending') {
            mat.readabilityStatus = 'readable';
          }
        }

        if (!session.config.subject && analysis.detectedSubject) {
          session.config.subject = analysis.detectedSubject;
        }
        if (
          (!session.config.educationLevel ||
            session.config.educationLevel.startsWith('Universal')) &&
          analysis.detectedLevel
        ) {
          session.config.educationLevel = analysis.detectedLevel;
        }
        if (
          session.title === 'Ujian Evaluasi Multimodal Baru' &&
          analysis.coreTopics.length > 0
        ) {
          session.title = `Asesmen: ${analysis.detectedSubject} — ${analysis.coreTopics[0]}`;
        }

        saveSession(session);
        return jsonResult(analysis);
      } catch (err) {
        return jsonResult(
          { error: err instanceof Error ? err.message : 'Gagal menganalisis materi.' },
          true
        );
      }
    }
  );

  // 4. generate_questions
  server.registerTool(
    'generate_questions',
    {
      title: 'Generate Universal Questions',
      description: MCP_TOOL_METADATA[3].description,
      inputSchema: {
        sessionId: z.string().describe('ID sesi ujian.'),
        subject: z.string().optional().describe('Bidang ilmu / mata pelajaran (bebas, tidak dibatasi).'),
        educationLevel: z.string().optional().describe('Jenjang pendidikan atau konteks pelatihan/sertifikasi.'),
        curriculumOrContext: z.string().optional().describe('Kurikulum atau konteks khusus (opsional).'),
        questionTypes: z.array(QuestionTypeEnum).optional().describe('Jenis soal yang ingin dibuat.'),
        questionCount: z.number().int().min(1).max(50).optional().describe('Jumlah soal tepat (1-50).'),
        cognitiveFocus: z.enum(['LOTS', 'HOTS', 'Mixed']).optional().describe('Fokus level kognitif.'),
        difficulty: z.enum(['Mixed', 'Easy', 'Medium', 'Hard']).optional().describe('Tingkat kesulitan.'),
        targetTotalPoints: z.number().int().min(1).optional().describe('Target total bobot poin ujian.'),
        language: z.string().optional().describe('Bahasa soal.'),
        strictSourceOnly: z.boolean().optional().describe('Jika true, seluruh soal wajib berdasar materi sumber.'),
        customInstructions: z.string().optional().describe('Instruksi tambahan pembuat soal.'),
      },
    },
    async (args) => {
      try {
        const session = requireExistingSession(args.sessionId);
        if (!isGeminiConfigured()) {
          return jsonResult({
            sessionId: session.id,
            geminiConfigured: false,
            fallbackMode: 'claude-native',
            message:
              'GEMINI_API_KEY tidak disetel di environment lokal. Claude harus menyusun daftar soal secara langsung sesuai rubrik, menampilkan preview ke pengguna untuk konfirmasi, lalu memanggil publish_exam dengan parameter questions.',
          });
        }

        const override = {
          ...(args.subject !== undefined ? { subject: args.subject } : {}),
          ...(args.educationLevel !== undefined ? { educationLevel: args.educationLevel } : {}),
          ...(args.curriculumOrContext !== undefined ? { curriculumOrContext: args.curriculumOrContext } : {}),
          ...(args.questionTypes !== undefined ? { questionTypes: args.questionTypes as QuestionType[] } : {}),
          ...(args.questionCount !== undefined ? { questionCount: args.questionCount } : {}),
          ...(args.cognitiveFocus !== undefined ? { cognitiveFocus: args.cognitiveFocus } : {}),
          ...(args.difficulty !== undefined ? { difficulty: args.difficulty } : {}),
          ...(args.targetTotalPoints !== undefined ? { targetTotalPoints: args.targetTotalPoints } : {}),
          ...(args.language !== undefined ? { language: args.language } : {}),
          ...(args.strictSourceOnly !== undefined ? { strictSourceOnly: args.strictSourceOnly } : {}),
          ...(args.customInstructions !== undefined ? { customInstructions: args.customInstructions } : {}),
        };

        session.config = { ...session.config, ...override };
        const questions = await generateQuestionsWithGemini(session, override);
        session.questions = questions;
        session.approvedForPublish = false;
        session.validation = await validateExamQuestions(
          session,
          session.config.questionCount,
          session.config.targetTotalPoints
        );
        saveSession(session);

        return jsonResult({
          sessionId: session.id,
          questionCount: questions.length,
          totalPoints: questions.reduce((acc, q) => acc + q.points, 0),
          validation: session.validation,
          questions,
        });
      } catch (err) {
        return jsonResult(
          { error: err instanceof Error ? err.message : 'Gagal membuat soal.' },
          true
        );
      }
    }
  );

  // 5. generate_answer_key
  server.registerTool(
    'generate_answer_key',
    {
      title: 'Generate / Verify Answer Key',
      description: MCP_TOOL_METADATA[4].description,
      inputSchema: {
        sessionId: z.string().describe('ID sesi ujian.'),
        questionIds: z.array(z.string()).optional().describe('Daftar ID soal tertentu (opsional).'),
      },
    },
    async (args) => {
      try {
        const session = requireExistingSession(args.sessionId);
        const updated = await generateOrVerifyAnswerKeys(session, args.questionIds);
        session.questions = updated;
        saveSession(session);

        return jsonResult({
          sessionId: session.id,
          answerKeys: updated.map((q) => ({
            id: q.id,
            order: q.order,
            question: q.question,
            answerKey: q.answerKey,
            sourceReference: q.sourceReference,
          })),
        });
      } catch (err) {
        return jsonResult(
          { error: err instanceof Error ? err.message : 'Gagal memverifikasi kunci jawaban.' },
          true
        );
      }
    }
  );

  // 6. generate_explanations
  server.registerTool(
    'generate_explanations',
    {
      title: 'Generate Explanations',
      description: MCP_TOOL_METADATA[5].description,
      inputSchema: {
        sessionId: z.string().describe('ID sesi ujian.'),
        questionIds: z.array(z.string()).optional().describe('Daftar ID soal tertentu (opsional).'),
      },
    },
    async (args) => {
      try {
        const session = requireExistingSession(args.sessionId);
        const updated = await generateExplanationsForQuestions(session, args.questionIds);
        session.questions = updated;
        saveSession(session);

        return jsonResult({
          sessionId: session.id,
          explanations: updated.map((q) => ({
            id: q.id,
            order: q.order,
            explanation: q.explanation,
            competencyIndicator: q.competencyIndicator,
            sourceReference: q.sourceReference,
          })),
        });
      } catch (err) {
        return jsonResult(
          { error: err instanceof Error ? err.message : 'Gagal menyusun pembahasan soal.' },
          true
        );
      }
    }
  );

  // 7. validate_questions
  server.registerTool(
    'validate_questions',
    {
      title: 'Validate Exam Quality',
      description: MCP_TOOL_METADATA[6].description,
      inputSchema: {
        sessionId: z.string().describe('ID sesi ujian.'),
        requestedCount: z.number().int().optional(),
        targetTotalPoints: z.number().int().optional(),
      },
    },
    async (args) => {
      try {
        const session = requireExistingSession(args.sessionId);
        const report = await validateExamQuestions(
          session,
          args.requestedCount,
          args.targetTotalPoints
        );
        session.validation = report;
        saveSession(session);
        return jsonResult(report);
      } catch (err) {
        return jsonResult(
          { error: err instanceof Error ? err.message : 'Gagal memvalidasi soal.' },
          true
        );
      }
    }
  );

  // 8. preview_exam
  server.registerTool(
    'preview_exam',
    {
      title: 'Preview Exam & Request Approval',
      description: MCP_TOOL_METADATA[7].description,
      inputSchema: {
        sessionId: z.string().describe('ID sesi ujian.'),
      },
    },
    async (args) => {
      try {
        const session = requireExistingSession(args.sessionId);
        const totalPoints = session.questions.reduce((acc, q) => acc + q.points, 0);
        return jsonResult({
          sessionId: session.id,
          title: session.title,
          description: session.description,
          subject: session.config.subject,
          educationLevel: session.config.educationLevel,
          participantIdentity: session.participantIdentity,
          totalQuestions: session.questions.length,
          totalPoints,
          validation: session.validation,
          approvedForPublish: session.approvedForPublish,
          questions: session.questions,
          approvalPrompt:
            'Tampilkan pratinjau soal di atas kepada pengguna dan minta konfirmasi eksplisit sebelum memanggil create_google_form / configure_quiz / publish_exam.',
        });
      } catch (err) {
        return jsonResult(
          { error: err instanceof Error ? err.message : 'Gagal menampilkan pratinjau ujian.' },
          true
        );
      }
    }
  );

  // 9. create_google_form
  server.registerTool(
    'create_google_form',
    {
      title: 'Create Google Form',
      description: MCP_TOOL_METADATA[8].description,
      inputSchema: {
        sessionId: z.string().optional().describe('ID sesi ujian (opsional jika membuat form baru langsung).'),
        title: z.string().optional().describe('Judul Google Form.'),
        description: z.string().optional().describe('Deskripsi Google Form.'),
        includeParticipantIdentity: z
          .boolean()
          .optional()
          .describe('Tambahkan bagian Identitas Peserta di awal form.'),
        participantIdentity: ParticipantIdentitySchema.optional().describe('Konfigurasi detail identitas peserta.'),
        questions: z.array(InlineQuestionSchema).optional().describe('Opsional: simpan daftar soal ke sesi saat form dibuat.'),
        approved: z
          .boolean()
          .optional()
          .describe('Konfirmasi bahwa pengguna telah menyetujui pembuatan Google Form.'),
        accessToken: z
          .string()
          .optional()
          .describe('Opsional: Google OAuth Bearer access token jika dikirim langsung.'),
      },
    },
    async (args) => {
      try {
        const session = args.sessionId
          ? getOrCreateSession(args.sessionId)
          : createSessionOrLoadForDirectPublish(args.title, args.description);

        if (args.questions && args.questions.length > 0) {
          session.questions = normalizeInlineQuestions(args.questions);
        }
        if (args.participantIdentity) {
          session.participantIdentity = {
            ...session.participantIdentity,
            ...args.participantIdentity,
          };
        }

        if (args.approved === false) {
          return jsonResult({
            created: false,
            requiresApproval: true,
            sessionId: session.id,
            message:
              'Pembuatan Google Form ditunda karena belum disetujui pengguna. Tampilkan preview_exam dan minta konfirmasi terlebih dahulu.',
          });
        }

        const token = resolveAccessToken(session.id, args.accessToken, defaultContext);
        if (!token) {
          saveSession(session);
          return jsonResult(await resolveAuthRequiredPayload(session.id, defaultContext));
        }

        if (args.title) session.title = args.title;
        if (args.description) session.description = args.description;
        if (args.approved === true) {
          session.approvedForPublish = true;
          session.approvalTimestamp = new Date().toISOString();
        }

        const identity =
          args.includeParticipantIdentity === false
            ? { includeFullName: false, includeParticipantId: false, includeClassOrOrg: false }
            : session.participantIdentity;

        const created = await createGoogleFormResource(token, {
          title: session.title,
          description: session.description,
          participantIdentity: identity,
        });

        session.googleForm = {
          formId: created.formId,
          title: created.title,
          responderUri: created.responderUri,
          editUrl: created.editUrl,
          isQuiz: false,
          totalQuestions: 0,
          totalPoints: 0,
          participantIdentityIncluded: args.includeParticipantIdentity !== false,
          createdAt: new Date().toISOString(),
        };
        saveSession(session);
        return jsonResult({ sessionId: session.id, ...session.googleForm });
      } catch (err) {
        if (err instanceof GoogleFormsAuthError) {
          return jsonResult(
            await resolveAuthRequiredPayload(args.sessionId || 'default', defaultContext)
          );
        }
        return jsonResult(
          { error: err instanceof Error ? err.message : 'Gagal membuat Google Form.' },
          true
        );
      }
    }
  );

  // 10. configure_quiz
  server.registerTool(
    'configure_quiz',
    {
      title: 'Configure Quiz Mode & Items',
      description: MCP_TOOL_METADATA[9].description,
      inputSchema: {
        sessionId: z.string().describe('ID sesi ujian.'),
        formId: z.string().optional().describe('ID Google Form (opsional jika sudah dibuat di sesi).'),
        questions: z.array(InlineQuestionSchema).optional().describe('Opsional: kirim daftar soal langsung jika belum tersimpan di sesi.'),
        accessToken: z.string().optional().describe('Opsional: Google OAuth Bearer access token.'),
      },
    },
    async (args) => {
      try {
        const session = requireExistingSession(args.sessionId);
        if (args.questions && args.questions.length > 0) {
          session.questions = normalizeInlineQuestions(args.questions);
        }
        const formId = args.formId || session.googleForm?.formId;
        if (!formId) {
          throw new Error('formId belum tersedia. Jalankan create_google_form terlebih dahulu.');
        }

        const token = resolveAccessToken(session.id, args.accessToken, defaultContext);
        if (!token) {
          saveSession(session);
          return jsonResult(await resolveAuthRequiredPayload(session.id, defaultContext));
        }

        const result = await configureQuizAndInsertQuestions(
          token,
          formId,
          session.questions,
          session.googleForm?.participantIdentityIncluded ?? true
        );
        session.googleForm = result;
        saveSession(session);
        return jsonResult(result);
      } catch (err) {
        if (err instanceof GoogleFormsAuthError) {
          return jsonResult(await resolveAuthRequiredPayload(args.sessionId, defaultContext));
        }
        return jsonResult(
          { error: err instanceof Error ? err.message : 'Gagal mengonfigurasi mode kuis Google Form.' },
          true
        );
      }
    }
  );

  // 11. publish_exam
  server.registerTool(
    'publish_exam',
    {
      title: 'Publish Exam (Approval-Gated)',
      description: MCP_TOOL_METADATA[10].description,
      inputSchema: {
        sessionId: z.string().optional().describe('ID sesi ujian (opsional jika mengirim questions langsung).'),
        approved: z
          .boolean()
          .describe('WAJIB true setelah pengguna meninjau pratinjau dan menyetujui publikasi.'),
        title: z.string().optional().describe('Judul Google Form.'),
        description: z.string().optional().describe('Deskripsi Google Form.'),
        includeParticipantIdentity: z.boolean().optional(),
        participantIdentity: ParticipantIdentitySchema.optional(),
        questions: z
          .array(InlineQuestionSchema)
          .optional()
          .describe('Opsional: daftar soal lengkap jika dibuat langsung oleh Claude tanpa Gemini key lokal.'),
        accessToken: z.string().optional().describe('Opsional: Google OAuth Bearer access token.'),
      },
    },
    async (args) => {
      let targetSessionId = args.sessionId || 'direct';
      try {
        const session = args.sessionId
          ? getOrCreateSession(args.sessionId)
          : createSessionOrLoadForDirectPublish(args.title, args.description);
        targetSessionId = session.id;

        if (args.title) session.title = args.title;
        if (args.description) session.description = args.description;
        if (args.participantIdentity) {
          session.participantIdentity = {
            ...session.participantIdentity,
            ...args.participantIdentity,
          };
        }
        if (args.questions && args.questions.length > 0) {
          session.questions = normalizeInlineQuestions(args.questions);
        }

        if (!args.approved) {
          saveSession(session);
          return jsonResult({
            published: false,
            requiresApproval: true,
            sessionId: session.id,
            message:
              'Publikasi dibatalkan karena persetujuan pengguna belum diberikan. Tampilkan preview_exam terlebih dahulu dan minta pengguna menyetujui sebelum memanggil publish_exam dengan approved: true.',
            totalQuestions: session.questions.length,
            totalPoints: session.questions.reduce((acc, q) => acc + q.points, 0),
          });
        }

        if (session.questions.length === 0) {
          throw new Error('Tidak ada soal dalam sesi untuk dipublikasikan. Sertakan parameter questions atau jalankan generate_questions.');
        }

        const token = resolveAccessToken(session.id, args.accessToken, defaultContext);
        if (!token) {
          saveSession(session);
          return jsonResult(await resolveAuthRequiredPayload(session.id, defaultContext));
        }

        session.approvedForPublish = true;
        session.approvalTimestamp = new Date().toISOString();

        const identity =
          args.includeParticipantIdentity === false
            ? { includeFullName: false, includeParticipantId: false, includeClassOrOrg: false }
            : session.participantIdentity;

        const created = await createGoogleFormResource(token, {
          title: session.title,
          description: session.description,
          participantIdentity: identity,
        });

        const published = await configureQuizAndInsertQuestions(
          token,
          created.formId,
          session.questions,
          args.includeParticipantIdentity !== false
        );

        session.googleForm = published;
        saveSession(session);
        return jsonResult({
          published: true,
          sessionId: session.id,
          ...published,
        });
      } catch (err) {
        if (err instanceof GoogleFormsAuthError) {
          return jsonResult(await resolveAuthRequiredPayload(targetSessionId, defaultContext));
        }
        return jsonResult(
          { error: err instanceof Error ? err.message : 'Gagal mempublikasikan ujian ke Google Forms.' },
          true
        );
      }
    }
  );

  // 12. get_form_links
  server.registerTool(
    'get_form_links',
    {
      title: 'Get Google Form Links',
      description: MCP_TOOL_METADATA[11].description,
      inputSchema: {
        sessionId: z.string().describe('ID sesi ujian.'),
        accessToken: z.string().optional().describe('Opsional: Google OAuth Bearer access token untuk refresh live.'),
      },
    },
    async (args) => {
      try {
        const session = requireExistingSession(args.sessionId);
        if (!session.googleForm) {
          throw new Error('Belum ada Google Form yang dibuat pada sesi ini.');
        }

        const token = resolveAccessToken(session.id, args.accessToken, defaultContext);
        if (token) {
          try {
            const fresh = await getGoogleFormLinks(token, session.googleForm.formId);
            session.googleForm.responderUri = fresh.responderUri;
            session.googleForm.editUrl = fresh.editUrl;
            session.googleForm.isQuiz = fresh.isQuiz;
            saveSession(session);
          } catch {
            // Fall back to saved links if token expired when merely reading cached URLs
          }
        }

        return jsonResult({
          formId: session.googleForm.formId,
          title: session.googleForm.title,
          responderUri: session.googleForm.responderUri,
          editUrl: session.googleForm.editUrl,
          isQuiz: session.googleForm.isQuiz,
        });
      } catch (err) {
        return jsonResult(
          { error: err instanceof Error ? err.message : 'Gagal mengambil tautan Google Form.' },
          true
        );
      }
    }
  );

  return server;
}
