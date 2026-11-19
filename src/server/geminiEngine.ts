import crypto from 'node:crypto';
import { GoogleGenAI, ThinkingLevel, Type, type Part } from '@google/genai';
import type {
  DifficultyLevel,
  ExamQuestion,
  ExamSession,
  GenerationConfig,
  MaterialAnalysis,
  MaterialFile,
  QuestionType,
  ValidationIssue,
  ValidationReport,
} from '../shared/types.ts';
import { QUESTION_TYPE_LABELS } from '../shared/types.ts';
import { loadMaterialBlob } from './store.ts';

const GEMINI_MODEL = 'gemini-4-hydrogen';

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY belum dikonfigurasi pada server. Silakan atur melalui panel Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 35_000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function withRetry<T>(fn: () => Promise<T>, retries = 1): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      console.error(
        `[GeminiEngine] attempt ${attempt + 1} failed (status=${status ?? 'unknown'}):`,
        err instanceof Error ? err.message : err
      );
      // Do not retry non-retryable 4xx errors (except 429 rate-limit) or explicit timeouts
      if (
        (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) ||
        (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError'))
      ) {
        throw err;
      }
      if (attempt < retries) {
        const delayMs = 600 * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastErr;
}

function buildMaterialParts(materials: MaterialFile[]): Part[] {
  const parts: Part[] = [];

  for (const mat of materials) {
    parts.push({
      text: `\n--- MULAI MATERI: "${mat.name}" (ID: ${mat.id}, Jenis: ${mat.kind.toUpperCase()}) ---`,
    });

    if (mat.extractedText && mat.extractedText.trim()) {
      parts.push({
        text: mat.extractedText.slice(0, 60000),
      });
    }

    if (mat.blobPath) {
      const blob = loadMaterialBlob(mat.blobPath);
      if (blob) {
        if (blob.base64Data && (mat.kind === 'image' || mat.kind === 'pdf')) {
          parts.push({
            inlineData: {
              mimeType: blob.mimeType,
              data: blob.base64Data,
            },
          });
        }
        if (blob.embeddedMedia && blob.embeddedMedia.length > 0) {
          for (const media of blob.embeddedMedia) {
            parts.push({
              text: `[Gambar/Diagram tertanam dalam "${mat.name}": ${media.name}]`,
            });
            parts.push({
              inlineData: {
                mimeType: media.mimeType,
                data: media.base64Data,
              },
            });
          }
        }
      }
    }

    parts.push({
      text: `--- AKHIR MATERI: "${mat.name}" ---\n`,
    });
  }

  return parts;
}

export async function extractTextFromSingleMaterial(
  material: MaterialFile
): Promise<{
  extractedText: string;
  readabilityStatus: 'readable' | 'partially_unreadable' | 'unreadable';
  readabilityMessage?: string;
}> {
  if (
    (material.kind === 'txt' || material.kind === 'text' || material.kind === 'docx' || material.kind === 'pptx') &&
    material.extractedText.trim().length >= 10 &&
    !material.embeddedMediaCount
  ) {
    return {
      extractedText: material.extractedText,
      readabilityStatus: 'readable',
    };
  }

  const ai = getAiClient();
  const parts = buildMaterialParts([material]);

  parts.push({
    text: `Tugas Anda adalah mengekstrak seluruh teks (OCR akurat), isi tabel, label diagram, grafik, rumus, dan keterangan ilustrasi dari materi di atas.
Jika gambar buram, terpotong, gelap, rusak, atau tidak terbaca sama sekali, tandai status keterbacaan sebagai "unreadable" atau "partially_unreadable" dan jelaskan bagian mana yang perlu diunggah ulang oleh pengguna.`,
  });

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: { parts },
      config: {
        abortSignal: AbortSignal.timeout(25_000),
        systemInstruction:
          'Anda adalah mesin OCR dan pembaca dokumen multimodal presisi tinggi. Ekstrak seluruh informasi secara jujur tanpa mengarang teks yang tidak ada.',
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            extractedText: {
              type: Type.STRING,
              description: 'Transkripsi teks lengkap termasuk isi tabel, grafik, dan keterangan diagram.',
            },
            readabilityStatus: {
              type: Type.STRING,
              description: 'Salah satu dari: readable, partially_unreadable, unreadable',
            },
            readabilityMessage: {
              type: Type.STRING,
              description: 'Pesan untuk pengguna jika ada bagian yang buram atau tidak terbaca.',
            },
          },
          required: ['extractedText', 'readabilityStatus'],
        },
      },
    })
  );

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    extractedText?: string;
    readabilityStatus?: string;
    readabilityMessage?: string;
  };

  const status =
    parsed.readabilityStatus === 'unreadable'
      ? 'unreadable'
      : parsed.readabilityStatus === 'partially_unreadable'
      ? 'partially_unreadable'
      : 'readable';

  const combinedText = [material.extractedText, parsed.extractedText]
    .filter((s) => s && s.trim())
    .join('\n\n[Ekstraksi Visual/OCR]:\n')
    .trim();

  return {
    extractedText: combinedText,
    readabilityStatus: status,
    readabilityMessage: parsed.readabilityMessage,
  };
}

export async function analyzeSessionMaterials(session: ExamSession): Promise<MaterialAnalysis> {
  if (session.materials.length === 0) {
    throw new Error('Belum ada materi yang diunggah atau diketik untuk dianalisis.');
  }

  const ai = getAiClient();
  const parts = buildMaterialParts(session.materials);

  parts.push({
    text: `Analisis seluruh materi sumber di atas secara mendalam dan menyeluruh.
Konteks tambahan dari pengguna (jika ada):
- Bidang/Mata Pelajaran: ${session.config.subject || 'Deteksi otomatis dari materi'}
- Jenjang/Konteks: ${session.config.educationLevel || 'Deteksi otomatis dari materi'}

Lakukan hal berikut:
1. Periksa apakah setiap file terbaca dengan baik. Jika ada foto buram, terpotong, terlalu kecil, atau file kosong/rusak sehingga tidak dapat dipahami, masukkan ke "unreadableFiles" dengan alasan dan instruksi spesifik agar pengguna mengunggah ulang bagian tersebut.
2. Lakukan OCR penuh untuk gambar/PDF pindaian, dan jelaskan setiap tabel, diagram, grafik, rumus, atau ilustrasi yang muncul.
3. Identifikasi bidang ilmu/topik secara universal (tanpa membatasi mata pelajaran apa pun), jenjang yang sesuai, bahasa materi, pokok pembahasan, konsep penting, dan ringkasan materi internal yang komprehensif.`,
  });

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: { parts },
      config: {
        abortSignal: AbortSignal.timeout(25_000),
        systemInstruction:
          'Anda adalah Analis Materi Multimodal Universal. Baca teks, foto OCR, tabel, diagram, grafik, PDF, Word, dan slide PowerPoint dengan akurat. Jangan mengarang isi yang tidak ada di sumber.',
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isReadable: { type: Type.BOOLEAN },
            unreadableFiles: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  fileId: { type: Type.STRING },
                  fileName: { type: Type.STRING },
                  reason: { type: Type.STRING },
                  actionRequired: { type: Type.STRING },
                },
                required: ['fileId', 'fileName', 'reason', 'actionRequired'],
              },
            },
            detectedSubject: { type: Type.STRING },
            detectedLevel: { type: Type.STRING },
            language: { type: Type.STRING },
            coreTopics: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            keyConcepts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  term: { type: Type.STRING },
                  definition: { type: Type.STRING },
                  sourceFile: { type: Type.STRING },
                },
                required: ['term', 'definition', 'sourceFile'],
              },
            },
            visualElements: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  sourceFile: { type: Type.STRING },
                  type: { type: Type.STRING },
                  description: { type: Type.STRING },
                  extractedData: { type: Type.STRING },
                },
                required: ['sourceFile', 'type', 'description', 'extractedData'],
              },
            },
            internalSummary: { type: Type.STRING },
            ocrTranscripts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  fileId: { type: Type.STRING },
                  fileName: { type: Type.STRING },
                  text: { type: Type.STRING },
                },
                required: ['fileId', 'fileName', 'text'],
              },
            },
          },
          required: [
            'isReadable',
            'unreadableFiles',
            'detectedSubject',
            'detectedLevel',
            'language',
            'coreTopics',
            'keyConcepts',
            'visualElements',
            'internalSummary',
            'ocrTranscripts',
          ],
        },
      },
    })
  );

  const parsed = JSON.parse((response.text ?? '{}').trim()) as Omit<
    MaterialAnalysis,
    'sessionId' | 'analyzedAt'
  >;

  return {
    sessionId: session.id,
    isReadable: Boolean(parsed.isReadable),
    unreadableFiles: parsed.unreadableFiles || [],
    detectedSubject: parsed.detectedSubject || session.config.subject || 'Materi Umum',
    detectedLevel: parsed.detectedLevel || session.config.educationLevel || 'Universal',
    language: parsed.language || session.config.language || 'Bahasa Indonesia',
    coreTopics: parsed.coreTopics || [],
    keyConcepts: parsed.keyConcepts || [],
    visualElements: (parsed.visualElements || []).map((v) => ({
      ...v,
      type: (['table', 'diagram', 'chart', 'illustration', 'formula', 'ocr_text'].includes(
        v.type
      )
        ? v.type
        : 'ocr_text') as MaterialAnalysis['visualElements'][number]['type'],
    })),
    internalSummary: parsed.internalSummary || '',
    ocrTranscripts: parsed.ocrTranscripts || [],
    analyzedAt: new Date().toISOString(),
  };
}

function distributePoints(count: number, targetTotal: number): number[] {
  if (count <= 0) return [];
  const safeTotal = Math.max(count, Math.round(targetTotal));
  const base = Math.floor(safeTotal / count);
  let remainder = safeTotal - base * count;
  const pts: number[] = [];
  for (let i = 0; i < count; i++) {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder--;
    pts.push(base + extra);
  }
  return pts;
}

function normalizeQuestionTypes(types: QuestionType[]): QuestionType[] {
  const valid: QuestionType[] = [
    'multiple_choice_4',
    'multiple_choice_5',
    'complex_multiple_choice',
    'true_false',
    'matching',
    'short_answer',
    'essay',
    'case_analysis',
    'stimulus_based',
  ];
  const filtered = types.filter((t) => valid.includes(t));
  return filtered.length > 0 ? filtered : ['multiple_choice_5'];
}

function normalizeGeneratedQuestion(
  raw: Record<string, unknown>,
  index: number,
  fallbackPoints: number,
  allowedTypes: QuestionType[]
): ExamQuestion {
  const rawType = String(raw.type || allowedTypes[index % allowedTypes.length]) as QuestionType;
  const type = allowedTypes.includes(rawType)
    ? rawType
    : allowedTypes[index % allowedTypes.length];

  const cognitiveLevel =
    String(raw.cognitiveLevel).toUpperCase() === 'HOTS' ? 'HOTS' : 'LOTS';

  const difficultyRaw = String(raw.difficulty || 'Medium');
  const difficulty: DifficultyLevel =
    difficultyRaw === 'Easy' || difficultyRaw === 'Hard' ? difficultyRaw : 'Medium';

  let options: string[] | undefined = Array.isArray(raw.options)
    ? raw.options.map((o) => String(o).trim()).filter(Boolean)
    : undefined;

  if (type === 'multiple_choice_4') {
    if (!options || options.length < 4) {
      options = [
        ...(options || []),
        'Opsi A',
        'Opsi B',
        'Opsi C',
        'Opsi D',
      ].slice(0, 4);
    } else if (options.length > 4) {
      options = options.slice(0, 4);
    }
  } else if (type === 'multiple_choice_5') {
    if (!options || options.length < 5) {
      options = [
        ...(options || []),
        'Opsi A',
        'Opsi B',
        'Opsi C',
        'Opsi D',
        'Opsi E',
      ].slice(0, 5);
    } else if (options.length > 5) {
      options = options.slice(0, 5);
    }
  } else if (type === 'true_false') {
    if (!options || options.length !== 2) {
      options = ['Benar', 'Salah'];
    }
  } else if (type === 'complex_multiple_choice') {
    if (!options || options.length < 3) {
      options = [...(options || []), 'Pernyataan 1', 'Pernyataan 2', 'Pernyataan 3', 'Pernyataan 4'].slice(0, 4);
    }
  } else if (type === 'short_answer' || type === 'essay' || type === 'matching') {
    options = undefined;
  }

  // Deduplicate options if model repeated any option text
  if (options) {
    const seen = new Set<string>();
    options = options.map((opt, idx) => {
      let candidate = opt;
      while (seen.has(candidate.toLowerCase())) {
        candidate = `${opt} (${idx + 1})`;
      }
      seen.add(candidate.toLowerCase());
      return candidate;
    });
  }

  const matchingPairs =
    type === 'matching' && Array.isArray(raw.matchingPairs)
      ? raw.matchingPairs
          .map((p) => {
            const pair = p as Record<string, unknown>;
            return {
              prompt: String(pair.prompt || '').trim(),
              match: String(pair.match || '').trim(),
            };
          })
          .filter((p) => p.prompt && p.match)
      : undefined;

  let answerKey: string | string[];
  if (type === 'complex_multiple_choice') {
    const rawList = Array.isArray(raw.answerKeyList)
      ? raw.answerKeyList.map((x) => String(x).trim()).filter(Boolean)
      : raw.answerKey
      ? [String(raw.answerKey).trim()]
      : [];
    if (options && rawList.length > 0) {
      const matched = rawList
        .map((ans) => matchOptionValue(ans, options!))
        .filter((v): v is string => Boolean(v));
      answerKey = matched.length > 0 ? Array.from(new Set(matched)) : [options[0]];
    } else {
      answerKey = rawList.length > 0 ? rawList : options ? [options[0]] : ['Jawaban 1'];
    }
  } else if (type === 'matching' && matchingPairs) {
    answerKey = matchingPairs.map((p) => `${p.prompt} -> ${p.match}`);
  } else {
    const singleKey = String(raw.answerKey || '').trim();
    if (options && options.length > 0) {
      answerKey = matchOptionValue(singleKey, options) || options[0];
    } else {
      answerKey = singleKey || 'Lihat rubrik pembahasan';
    }
  }

  const rawPoints = Number(raw.points);
  const points = Number.isFinite(rawPoints) && rawPoints > 0 ? Math.round(rawPoints) : fallbackPoints;

  return {
    id: `q_${crypto.randomUUID().slice(0, 8)}`,
    order: index + 1,
    type,
    cognitiveLevel,
    difficulty,
    stimulus: raw.stimulus ? String(raw.stimulus).trim() : undefined,
    question: String(raw.question || `Pertanyaan ${index + 1}`).trim(),
    options,
    matchingPairs,
    answerKey,
    explanation: String(raw.explanation || 'Pembahasan berdasarkan materi sumber.').trim(),
    competencyIndicator: String(
      raw.competencyIndicator || 'Memahami dan menerapkan konsep dari materi sumber'
    ).trim(),
    sourceReference: String(
      raw.sourceReference || 'Materi sumber yang diunggah'
    ).trim(),
    points,
  };
}

export function matchOptionValue(candidate: string, options: string[]): string | null {
  const clean = candidate.trim();
  if (!clean) return null;

  // Direct exact or case-insensitive match
  const exact = options.find((o) => o.toLowerCase() === clean.toLowerCase());
  if (exact) return exact;

  // Handle letter labels like "A", "B", "A.", "Opsi A"
  const letterMatch = clean.match(/^(?:opsi\s*)?([A-E])\.?$/i);
  if (letterMatch) {
    const idx = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
    if (idx >= 0 && idx < options.length) return options[idx];
  }

  // Handle prefixed answers like "A. Teks jawaban"
  const stripped = clean.replace(/^[A-E][\.\)\:\-]\s*/i, '').trim();
  const byStripped = options.find(
    (o) =>
      o.toLowerCase() === stripped.toLowerCase() ||
      o.replace(/^[A-E][\.\)\:\-]\s*/i, '').trim().toLowerCase() === stripped.toLowerCase()
  );
  if (byStripped) return byStripped;

  // Substring fallback
  const partial = options.find(
    (o) => o.toLowerCase().includes(clean.toLowerCase()) || clean.toLowerCase().includes(o.toLowerCase())
  );
  return partial || null;
}

export async function generateQuestionsWithGemini(
  session: ExamSession,
  overrideConfig?: Partial<GenerationConfig>
): Promise<ExamQuestion[]> {
  if (session.materials.length === 0) {
    throw new Error('Unggah atau ketik materi terlebih dahulu sebelum membuat soal.');
  }

  const cfg: GenerationConfig = {
    ...session.config,
    ...(overrideConfig || {}),
  };

  const questionTypes = normalizeQuestionTypes(cfg.questionTypes);
  const count = Math.max(1, Math.min(50, Math.round(cfg.questionCount || 10)));
  const pointDistribution = distributePoints(count, cfg.targetTotalPoints || 100);

  const ai = getAiClient();
  const baseParts = buildMaterialParts(session.materials);

  const analysisContext = session.analysis
    ? `\nRingkasan Analisis Materi Sebelumnya:
- Bidang Terdeteksi: ${session.analysis.detectedSubject}
- Jenjang Terdeteksi: ${session.analysis.detectedLevel}
- Pokok Bahasan: ${session.analysis.coreTopics.join('; ')}
- Ringkasan Internal: ${session.analysis.internalSummary}`
    : '';

  const typeDescriptions = questionTypes
    .map((t) => `- ${t}: ${QUESTION_TYPE_LABELS[t]}`)
    .join('\n');

  const questionSchema = {
    type: Type.OBJECT,
    properties: {
      questions: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            type: { type: Type.STRING },
            cognitiveLevel: { type: Type.STRING },
            difficulty: { type: Type.STRING },
            stimulus: { type: Type.STRING },
            question: { type: Type.STRING },
            options: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            matchingPairs: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  prompt: { type: Type.STRING },
                  match: { type: Type.STRING },
                },
                required: ['prompt', 'match'],
              },
            },
            answerKey: { type: Type.STRING },
            answerKeyList: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            explanation: { type: Type.STRING },
            competencyIndicator: { type: Type.STRING },
            sourceReference: { type: Type.STRING },
            points: { type: Type.INTEGER },
          },
          required: [
            'type',
            'cognitiveLevel',
            'difficulty',
            'question',
            'explanation',
            'competencyIndicator',
            'sourceReference',
            'points',
          ],
        },
      },
    },
    required: ['questions'],
  };

  let normalized: ExamQuestion[] = [];
  const MAX_BATCH_SIZE = 15;
  let safetyAttempts = 0;

  while (normalized.length < count && safetyAttempts < 6) {
    safetyAttempts++;
    const remaining = count - normalized.length;
    const batchTarget = Math.min(MAX_BATCH_SIZE, remaining);
    const existingStems =
      normalized.length > 0
        ? `\nSOAL YANG SUDAH DIBUAT SEBELUMNYA (DILARANG DUPLIKAT / MENGULANG TOPIK SAMA PERSIS):\n${normalized
            .map((q, i) => `${i + 1}. ${q.question}`)
            .join('\n')}`
        : '';

    const parts: Part[] = [
      ...baseParts,
      {
        text: `${analysisContext}

SPESIFIKASI PEMBUATAN SOAL UNIVERSAL:
- Bidang / Mata Pelajaran: ${cfg.subject || 'Universal (sesuai isi materi)'}
- Jenjang Pendidikan / Konteks: ${cfg.educationLevel || 'Sesuai materi'}
- Kurikulum / Konteks Tambahan: ${cfg.curriculumOrContext || 'Umum / Fleksibel'}
- Jumlah Soal pada batch ini TEPAT: ${batchTarget} butir soal (bagian dari total ${count} soal).
- Jenis Soal yang diminta (distribusikan secara merata atau proporsional):
${typeDescriptions}
- Fokus Kognitif: ${cfg.cognitiveFocus} (LOTS = C1-C3 Mengingat/Memahami/Menerapkan; HOTS = C4-C6 Menganalisis/Mengevaluasi/Mencipta; Mixed = kombinasi seimbang LOTS & HOTS).
- Tingkat Kesulitan: ${cfg.difficulty}
- Bahasa Soal: ${cfg.language || 'Sesuai bahasa materi'}
- Aturan Grounding Sumber: ${
          cfg.strictSourceOnly
            ? 'KETAT BERBASIS MATERI: Seluruh pertanyaan, stimulus, opsi, dan kunci jawaban WAJIB memiliki dasar eksplisit dari materi yang diberikan. Dilarang membuat pertanyaan di luar materi atau mengarang kunci jawaban.'
            : 'Berbasis materi utama dan dapat diperkaya dengan konteks keilmuan relevan.'
        }
${cfg.customInstructions ? `- Instruksi Tambahan Pengguna: ${cfg.customInstructions}` : ''}${existingStems}

ATURAN FORMAT PER TIPE SOAL:
1. multiple_choice_4: WAJIB punya tepat 4 string di "options" (tanpa awalan huruf A./B./C./D., cukup isi teks opsi). "answerKey" harus persis sama dengan salah satu string di "options".
2. multiple_choice_5: WAJIB punya tepat 5 string di "options" (tanpa awalan huruf A./B./C./D./E.). "answerKey" harus persis sama dengan salah satu string di "options".
3. complex_multiple_choice: WAJIB punya 4-5 pernyataan/opsi di "options" dan minimal 2 jawaban benar di "answerKeyList" yang persis sama dengan string di "options".
4. true_false: WAJIB punya tepat 2 opsi di "options" (["Benar", "Salah"] atau ["True", "False"] sesuai bahasa soal). "answerKey" harus persis salah satunya.
5. matching: WAJIB isi "matchingPairs" minimal 3 pasangan { prompt, match }.
6. short_answer: Tidak perlu "options". Isi "answerKey" dengan jawaban singkat yang tepat dan pasti.
7. essay: Tidak perlu "options". Isi "answerKey" dengan poin-poin kunci rubrik penilaian lengkap.
8. case_analysis: Wajib punya "stimulus" berisi narasi kasus nyata/kontekstual dari materi, lalu pertanyaan analisis.
9. stimulus_based: Wajib punya "stimulus" berisi kutipan teks, deskripsi tabel/grafik/diagram dari materi, lalu pertanyaan berbasis stimulus tersebut.

ATURAN KUALITAS WAJIB:
- Tidak boleh ada dua soal yang duplikat atau menanyakan hal yang sama persis.
- Setiap soal wajib menyertakan: question, answerKey (atau answerKeyList), explanation (pembahasan pedagogis yang jelas), difficulty (Easy/Medium/Hard), cognitiveLevel (LOTS/HOTS), competencyIndicator (indikator/kompetensi), sourceReference (nama file + bagian/halaman/slide/diagram materi sumber), dan points (integer).`,
      },
    ];

    const response = await withRetry(() =>
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: { parts },
        config: {
          abortSignal: AbortSignal.timeout(35_000),
          systemInstruction:
            'Anda adalah Mesin Pembuat Soal Asesmen Universal profesional untuk semua bidang ilmu dan jenjang tanpa batasan mata pelajaran. Hasilkan soal berkualitas tinggi, tervalidasi, tanpa duplikasi, dan patuhi format JSON schema secara ketat.',
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.LOW,
          },
          responseMimeType: 'application/json',
          responseSchema: questionSchema,
        },
      })
    );

    const parsed = JSON.parse((response.text ?? '{"questions":[]}').trim()) as {
      questions?: Array<Record<string, unknown>>;
    };

    const batchItems = (parsed.questions || []).slice(0, remaining);
    if (batchItems.length === 0) break;

    const startIdx = normalized.length;
    const mapped = batchItems.map((raw, idx) =>
      normalizeGeneratedQuestion(
        raw,
        startIdx + idx,
        pointDistribution[startIdx + idx] ?? 10,
        questionTypes
      )
    );
    normalized = [...normalized, ...mapped];
  }

  // Rebalance points so sum matches targetTotalPoints
  const targetTotal = Math.max(normalized.length, Math.round(cfg.targetTotalPoints || 100));
  const currentSum = normalized.reduce((acc, q) => acc + q.points, 0);
  if (currentSum !== targetTotal && normalized.length > 0) {
    const balanced = distributePoints(normalized.length, targetTotal);
    normalized = normalized.map((q, idx) => ({
      ...q,
      order: idx + 1,
      points: balanced[idx],
    }));
  }

  return normalized;
}

export async function generateOrVerifyAnswerKeys(
  session: ExamSession,
  questionIds?: string[]
): Promise<ExamQuestion[]> {
  if (session.questions.length === 0) {
    throw new Error('Belum ada soal di sesi ini untuk diperiksa kunci jawabannya.');
  }

  const targetIds = new Set(
    questionIds && questionIds.length > 0
      ? questionIds
      : session.questions.map((q) => q.id)
  );
  const targets = session.questions.filter((q) => targetIds.has(q.id));

  const ai = getAiClient();
  const parts = buildMaterialParts(session.materials);
  parts.push({
    text: `Periksa dan verifikasi kunci jawaban untuk soal-soal berikut berdasarkan materi sumber. Jangan mengarang kunci jawaban yang tidak didukung materi.
Daftar soal:
${JSON.stringify(
  targets.map((q) => ({
    id: q.id,
    type: q.type,
    stimulus: q.stimulus,
    question: q.question,
    options: q.options,
    matchingPairs: q.matchingPairs,
    currentAnswerKey: q.answerKey,
  })),
  null,
  2
)}`,
  });

  const res = await withRetry(() =>
    ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: { parts },
      config: {
        abortSignal: AbortSignal.timeout(25_000),
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            verified: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  answerKey: { type: Type.STRING },
                  answerKeyList: { type: Type.ARRAY, items: { type: Type.STRING } },
                  sourceReference: { type: Type.STRING },
                },
                required: ['id', 'sourceReference'],
              },
            },
          },
          required: ['verified'],
        },
      },
    })
  );

  const parsed = JSON.parse((res.text ?? '{"verified":[]}').trim()) as {
    verified?: Array<{
      id: string;
      answerKey?: string;
      answerKeyList?: string[];
      sourceReference?: string;
    }>;
  };

  const map = new Map((parsed.verified || []).map((v) => [v.id, v]));

  return session.questions.map((q) => {
    const v = map.get(q.id);
    if (!v) return q;
    let updatedKey = q.answerKey;
    if (q.type === 'complex_multiple_choice' && v.answerKeyList && q.options) {
      const matched = v.answerKeyList
        .map((ans) => matchOptionValue(ans, q.options!))
        .filter((x): x is string => Boolean(x));
      if (matched.length > 0) updatedKey = Array.from(new Set(matched));
    } else if (v.answerKey) {
      updatedKey = q.options ? matchOptionValue(v.answerKey, q.options) || q.answerKey : v.answerKey;
    }
    return {
      ...q,
      answerKey: updatedKey,
      sourceReference: v.sourceReference || q.sourceReference,
    };
  });
}

export async function generateExplanationsForQuestions(
  session: ExamSession,
  questionIds?: string[]
): Promise<ExamQuestion[]> {
  if (session.questions.length === 0) {
    throw new Error('Belum ada soal di sesi ini untuk dibuatkan pembahasan.');
  }

  const targetIds = new Set(
    questionIds && questionIds.length > 0
      ? questionIds
      : session.questions.map((q) => q.id)
  );
  const targets = session.questions.filter((q) => targetIds.has(q.id));

  const ai = getAiClient();
  const parts = buildMaterialParts(session.materials);
  parts.push({
    text: `Buat atau perkaya pembahasan (explanation), indikator kompetensi (competencyIndicator), dan rujukan sumber materi (sourceReference) untuk setiap soal berikut agar akurat, jelas, dan edukatif:
${JSON.stringify(
  targets.map((q) => ({
    id: q.id,
    type: q.type,
    stimulus: q.stimulus,
    question: q.question,
    options: q.options,
    answerKey: q.answerKey,
  })),
  null,
  2
)}`,
  });

  const res = await withRetry(() =>
    ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: { parts },
      config: {
        abortSignal: AbortSignal.timeout(25_000),
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            explanations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  explanation: { type: Type.STRING },
                  competencyIndicator: { type: Type.STRING },
                  sourceReference: { type: Type.STRING },
                },
                required: ['id', 'explanation', 'competencyIndicator', 'sourceReference'],
              },
            },
          },
          required: ['explanations'],
        },
      },
    })
  );

  const parsed = JSON.parse((res.text ?? '{"explanations":[]}').trim()) as {
    explanations?: Array<{
      id: string;
      explanation: string;
      competencyIndicator: string;
      sourceReference: string;
    }>;
  };

  const map = new Map((parsed.explanations || []).map((e) => [e.id, e]));
  return session.questions.map((q) => {
    const e = map.get(q.id);
    if (!e) return q;
    return {
      ...q,
      explanation: e.explanation || q.explanation,
      competencyIndicator: e.competencyIndicator || q.competencyIndicator,
      sourceReference: e.sourceReference || q.sourceReference,
    };
  });
}

function jaccardSimilarity(a: string, b: string): number {
  const tokA = new Set(
    a
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
  const tokB = new Set(
    b
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
  if (tokA.size === 0 || tokB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokA) {
    if (tokB.has(t)) intersection++;
  }
  const union = tokA.size + tokB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export async function validateExamQuestions(
  session: ExamSession,
  requestedCount?: number,
  targetTotalPoints?: number
): Promise<ValidationReport> {
  const reqCount = requestedCount ?? session.config.questionCount ?? session.questions.length;
  const reqPoints = targetTotalPoints ?? session.config.targetTotalPoints ?? 100;
  const actualCount = session.questions.length;
  const actualTotalPoints = session.questions.reduce((acc, q) => acc + (Number(q.points) || 0), 0);

  const duplicates: ValidationReport['duplicates'] = [];
  const alignmentIssues: ValidationIssue[] = [];
  const sourceGroundingIssues: ValidationIssue[] = [];
  const warnings: string[] = [];

  // 1. Lexical duplicate detection
  for (let i = 0; i < session.questions.length; i++) {
    for (let j = i + 1; j < session.questions.length; j++) {
      const sim = jaccardSimilarity(
        session.questions[i].question,
        session.questions[j].question
      );
      if (sim >= 0.72) {
        duplicates.push({
          questionIndexA: i + 1,
          questionIndexB: j + 1,
          reason: `Kemiripan teks tinggi (${Math.round(sim * 100)}%) antara soal #${i + 1} dan #${j + 1}`,
        });
      }
    }
  }

  // 2. Structural & option-key consistency check
  for (const q of session.questions) {
    if (!q.question.trim()) {
      alignmentIssues.push({ questionId: q.id, issue: 'Teks pertanyaan kosong.' });
    }
    if (
      (q.type === 'multiple_choice_4' ||
        q.type === 'multiple_choice_5' ||
        q.type === 'true_false') &&
      q.options
    ) {
      const key = String(q.answerKey);
      if (!q.options.includes(key)) {
        alignmentIssues.push({
          questionId: q.id,
          issue: `Kunci jawaban "${key}" tidak cocok persis dengan salah satu opsi pilihan.`,
        });
      }
    }
    if (q.type === 'complex_multiple_choice' && q.options) {
      const keys = Array.isArray(q.answerKey) ? q.answerKey : [String(q.answerKey)];
      const invalid = keys.filter((k) => !q.options!.includes(k));
      if (keys.length === 0 || invalid.length > 0) {
        alignmentIssues.push({
          questionId: q.id,
          issue: 'Kunci jawaban pilihan ganda kompleks harus sesuai dengan opsi yang tersedia.',
        });
      }
    }
    if (q.points <= 0) {
      alignmentIssues.push({ questionId: q.id, issue: 'Bobot nilai soal harus lebih dari 0.' });
    }
    if (session.config.strictSourceOnly && !q.sourceReference.trim()) {
      sourceGroundingIssues.push({
        questionId: q.id,
        issue: 'Rujukan bagian materi sumber belum tercantum.',
      });
    }
  }

  // 3. Semantic validation with Gemini against source materials
  if (session.questions.length > 0 && session.materials.length > 0) {
    try {
      const ai = getAiClient();
      const parts = buildMaterialParts(session.materials);
      parts.push({
        text: `Audit kualitas soal-soal berikut terhadap materi sumber:
1. Apakah ada soal yang kunci jawabannya keliru atau tidak selaras dengan pertanyaannya?
2. Jika strictSourceOnly=${session.config.strictSourceOnly}, apakah ada soal yang topiknya keluar dari materi sumber?
3. Apakah ada duplikasi makna antar soal?

Daftar soal:
${JSON.stringify(
  session.questions.map((q, idx) => ({
    number: idx + 1,
    id: q.id,
    question: q.question,
    options: q.options,
    answerKey: q.answerKey,
    sourceReference: q.sourceReference,
  }))
)}`,
      });

      const auditRes = await withRetry(() =>
        ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: { parts },
          config: {
            abortSignal: AbortSignal.timeout(20_000),
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                alignmentIssues: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      questionId: { type: Type.STRING },
                      issue: { type: Type.STRING },
                    },
                    required: ['questionId', 'issue'],
                  },
                },
                sourceGroundingIssues: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      questionId: { type: Type.STRING },
                      issue: { type: Type.STRING },
                    },
                    required: ['questionId', 'issue'],
                  },
                },
                semanticDuplicates: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      questionIndexA: { type: Type.INTEGER },
                      questionIndexB: { type: Type.INTEGER },
                      reason: { type: Type.STRING },
                    },
                    required: ['questionIndexA', 'questionIndexB', 'reason'],
                  },
                },
              },
              required: ['alignmentIssues', 'sourceGroundingIssues', 'semanticDuplicates'],
            },
          },
        })
      );

      const parsedAudit = JSON.parse((auditRes.text ?? '{}').trim()) as {
        alignmentIssues?: ValidationIssue[];
        sourceGroundingIssues?: ValidationIssue[];
        semanticDuplicates?: ValidationReport['duplicates'];
      };

      for (const issue of parsedAudit.alignmentIssues || []) {
        alignmentIssues.push(issue);
      }
      if (session.config.strictSourceOnly) {
        for (const issue of parsedAudit.sourceGroundingIssues || []) {
          sourceGroundingIssues.push(issue);
        }
      }
      for (const dup of parsedAudit.semanticDuplicates || []) {
        const exists = duplicates.some(
          (d) =>
            (d.questionIndexA === dup.questionIndexA &&
              d.questionIndexB === dup.questionIndexB) ||
            (d.questionIndexA === dup.questionIndexB &&
              d.questionIndexB === dup.questionIndexA)
        );
        if (!exists) duplicates.push(dup);
      }
    } catch (err) {
      warnings.push(
        `Audit semantik Gemini dilewati karena gangguan koneksi: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }
  }

  const countMatches = actualCount === reqCount;
  const pointsMatch = actualTotalPoints === reqPoints;

  if (!countMatches) {
    warnings.push(
      `Jumlah soal saat ini (${actualCount}) berbeda dari target permintaan (${reqCount}).`
    );
  }
  if (!pointsMatch) {
    warnings.push(
      `Total bobot poin saat ini (${actualTotalPoints}) belum sama dengan target total poin (${reqPoints}).`
    );
  }

  const valid =
    actualCount > 0 &&
    countMatches &&
    pointsMatch &&
    duplicates.length === 0 &&
    alignmentIssues.length === 0 &&
    sourceGroundingIssues.length === 0;

  return {
    valid,
    requestedCount: reqCount,
    actualCount,
    countMatches,
    targetTotalPoints: reqPoints,
    actualTotalPoints,
    pointsMatch,
    duplicates,
    alignmentIssues,
    sourceGroundingIssues,
    warnings,
    checkedAt: new Date().toISOString(),
  };
}
