import type {
  ExamQuestion,
  GoogleFormResult,
  ParticipantIdentityConfig,
} from '../shared/types.ts';
import { QUESTION_TYPE_LABELS } from '../shared/types.ts';
import { matchOptionValue } from './geminiEngine.ts';

const FORMS_API_BASE = 'https://forms.googleapis.com/v1/forms';

interface GoogleFormApiResponse {
  formId: string;
  info?: {
    title?: string;
    description?: string;
    documentTitle?: string;
  };
  settings?: {
    quizSettings?: {
      isQuiz?: boolean;
    };
  };
  responderUri?: string;
  items?: Array<{ itemId?: string }>;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

export class GoogleFormsAuthError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 401) {
    super(message);
    this.name = 'GoogleFormsAuthError';
    this.statusCode = statusCode;
  }
}

function buildEditUrl(formId: string): string {
  return `https://docs.google.com/forms/d/${encodeURIComponent(formId)}/edit`;
}

async function callFormsApi<T>(
  url: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<T> {
  const token = accessToken.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    throw new GoogleFormsAuthError(
      'Sesi Google OAuth belum aktif atau telah kedaluwarsa. Silakan hubungkan kembali akun Google Anda.',
      401
    );
  }

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const data = (await res.json().catch(() => ({}))) as T & {
    error?: { message?: string; code?: number; status?: string };
  };

  if (!res.ok) {
    const msg =
      data?.error?.message ||
      `Google Forms API mengembalikan status ${res.status}`;
    if (res.status === 401 || data?.error?.status === 'UNAUTHENTICATED') {
      throw new GoogleFormsAuthError(
        'Sesi Google OAuth telah kedaluwarsa. Sistem akan memperbarui otorisasi Anda.',
        401
      );
    }
    throw new Error(msg);
  }

  return data;
}

export async function createGoogleFormResource(
  accessToken: string,
  params: {
    title: string;
    description?: string;
    participantIdentity?: ParticipantIdentityConfig;
  }
): Promise<{
  formId: string;
  title: string;
  responderUri: string;
  editUrl: string;
  itemCount: number;
}> {
  const cleanTitle = params.title.trim() || 'Asesmen Evaluasi Multimodal';

  // Step 1: Create the base Google Form
  const created = await callFormsApi<GoogleFormApiResponse>(FORMS_API_BASE, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      info: {
        title: cleanTitle,
        documentTitle: cleanTitle,
      },
    }),
  });

  const formId = created.formId;
  const safeFormId = encodeURIComponent(formId.trim());
  const requests: Array<Record<string, unknown>> = [];

  if (params.description && params.description.trim()) {
    requests.push({
      updateFormInfo: {
        info: {
          description: params.description.trim(),
        },
        updateMask: 'description',
      },
    });
  }

  let currentIndex = 0;
  const identity = params.participantIdentity;
  const hasIdentity =
    identity &&
    (identity.includeFullName ||
      identity.includeParticipantId ||
      identity.includeClassOrOrg ||
      (identity.customFields && identity.customFields.length > 0));

  if (hasIdentity && identity) {
    requests.push({
      createItem: {
        item: {
          title: 'Identitas Peserta',
          description: 'Mohon lengkapi data identitas sebelum mengerjakan soal.',
          textItem: {},
        },
        location: { index: currentIndex++ },
      },
    });

    if (identity.includeFullName) {
      requests.push({
        createItem: {
          item: {
            title: 'Nama Lengkap',
            questionItem: {
              question: {
                required: true,
                textQuestion: { paragraph: false },
              },
            },
          },
          location: { index: currentIndex++ },
        },
      });
    }

    if (identity.includeParticipantId) {
      requests.push({
        createItem: {
          item: {
            title: 'Nomor Induk / ID Peserta',
            questionItem: {
              question: {
                required: true,
                textQuestion: { paragraph: false },
              },
            },
          },
          location: { index: currentIndex++ },
        },
      });
    }

    if (identity.includeClassOrOrg) {
      requests.push({
        createItem: {
          item: {
            title: 'Kelas / Program / Instansi',
            questionItem: {
              question: {
                required: true,
                textQuestion: { paragraph: false },
              },
            },
          },
          location: { index: currentIndex++ },
        },
      });
    }

    for (const customField of identity.customFields || []) {
      const label = customField.trim();
      if (!label) continue;
      requests.push({
        createItem: {
          item: {
            title: label,
            questionItem: {
              question: {
                required: true,
                textQuestion: { paragraph: false },
              },
            },
          },
          location: { index: currentIndex++ },
        },
      });
    }

    // Add a clean page break section header before exam questions
    requests.push({
      createItem: {
        item: {
          title: 'Bagian Soal Asesmen',
          description: 'Bacalah setiap soal dan stimulus dengan saksama sebelum memilih atau menuliskan jawaban.',
          pageBreakItem: {},
        },
        location: { index: currentIndex++ },
      },
    });
  }

  if (requests.length > 0) {
    await callFormsApi(`${FORMS_API_BASE}/${safeFormId}:batchUpdate`, accessToken, {
      method: 'POST',
      body: JSON.stringify({ requests }),
    });
  }

  const refreshed = await callFormsApi<GoogleFormApiResponse>(
    `${FORMS_API_BASE}/${safeFormId}`,
    accessToken,
    { method: 'GET' }
  );

  return {
    formId,
    title: refreshed.info?.title || cleanTitle,
    responderUri: refreshed.responderUri || `https://docs.google.com/forms/d/${safeFormId}/viewform`,
    editUrl: buildEditUrl(formId),
    itemCount: refreshed.items?.length || currentIndex,
  };
}

function sanitizeUniqueOptions(rawOptions: string[]): string[] {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const raw of rawOptions) {
    let val = raw.replace(/[\r\n]+/g, ' ').trim();
    if (!val) val = `Opsi ${clean.length + 1}`;
    let uniqueVal = val;
    let suffix = 2;
    while (seen.has(uniqueVal.toLowerCase())) {
      uniqueVal = `${val} (${suffix++})`;
    }
    seen.add(uniqueVal.toLowerCase());
    clean.push(uniqueVal);
  }
  return clean;
}

function buildQuestionCreateRequests(
  q: ExamQuestion,
  indexInForm: number,
  displayNumber: number
): { requests: Array<Record<string, unknown>>; itemsAdded: number } {
  const requests: Array<Record<string, unknown>> = [];
  let idx = indexInForm;

  const pointVal = Math.max(0, Math.round(Number(q.points) || 0));
  const typeLabel = QUESTION_TYPE_LABELS[q.type] || q.type;
  const metaHeader = `[${typeLabel} · ${q.cognitiveLevel} · ${pointVal} Poin]`;
  const itemDescription = [
    metaHeader,
    q.stimulus ? `Stimulus:\n${q.stimulus}` : '',
    q.competencyIndicator ? `Indikator: ${q.competencyIndicator}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const feedbackText = [
    q.explanation ? `Pembahasan: ${q.explanation}` : '',
    q.sourceReference ? `Sumber Materi: ${q.sourceReference}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  // Matching grid question
  if (q.type === 'matching' && q.matchingPairs && q.matchingPairs.length > 0) {
    const columns = sanitizeUniqueOptions(q.matchingPairs.map((p) => p.match));
    const keyLines = q.matchingPairs
      .map((p, i) => `${i + 1}. ${p.prompt} -> ${p.match}`)
      .join('\n');

    requests.push({
      createItem: {
        item: {
          title: `${displayNumber}. ${q.question}`,
          description: `${itemDescription}\n\nCatatan Penilaian (${pointVal} Poin):\n${keyLines}`,
          questionGroupItem: {
            questions: q.matchingPairs.map((pair) => ({
              required: true,
              rowQuestion: {
                title: pair.prompt.replace(/[\r\n]+/g, ' ').trim(),
              },
            })),
            grid: {
              columns: {
                type: 'RADIO',
                options: columns.map((val) => ({ value: val })),
              },
            },
          },
        },
        location: { index: idx++ },
      },
    });
    return { requests, itemsAdded: 1 };
  }

  // Choice-based questions (RADIO or CHECKBOX)
  if (
    q.options &&
    q.options.length >= 2 &&
    q.type !== 'short_answer' &&
    q.type !== 'essay'
  ) {
    const cleanOptions = sanitizeUniqueOptions(q.options);
    const isCheckbox = q.type === 'complex_multiple_choice';

    let correctValues: string[];
    if (isCheckbox) {
      const rawList = Array.isArray(q.answerKey)
        ? q.answerKey
        : [String(q.answerKey)];
      const matched = rawList
        .map((ans) => matchOptionValue(ans, cleanOptions))
        .filter((v): v is string => Boolean(v));
      correctValues = matched.length > 0 ? Array.from(new Set(matched)) : [cleanOptions[0]];
    } else {
      const single = Array.isArray(q.answerKey)
        ? q.answerKey[0] || ''
        : String(q.answerKey || '');
      const matched = matchOptionValue(single, cleanOptions) || cleanOptions[0];
      correctValues = [matched];
    }

    requests.push({
      createItem: {
        item: {
          title: `${displayNumber}. ${q.question}`,
          description: itemDescription,
          questionItem: {
            question: {
              required: true,
              grading: {
                pointValue: pointVal,
                correctAnswers: {
                  answers: correctValues.map((value) => ({ value })),
                },
                ...(feedbackText
                  ? {
                      whenRight: { text: feedbackText },
                      whenWrong: {
                        text: `Kunci: ${correctValues.join(', ')}\n\n${feedbackText}`,
                      },
                    }
                  : {}),
              },
              choiceQuestion: {
                type: isCheckbox ? 'CHECKBOX' : 'RADIO',
                options: cleanOptions.map((value) => ({ value })),
              },
            },
          },
        },
        location: { index: idx++ },
      },
    });
    return { requests, itemsAdded: 1 };
  }

  // Short Answer (supports exact correctAnswers grading in Google Forms API!)
  if (q.type === 'short_answer') {
    const keyText = Array.isArray(q.answerKey)
      ? q.answerKey.join(', ')
      : String(q.answerKey || '').trim();
    const cleanKey = keyText.replace(/[\r\n]+/g, ' ').trim();

    requests.push({
      createItem: {
        item: {
          title: `${displayNumber}. ${q.question}`,
          description: itemDescription,
          questionItem: {
            question: {
              required: true,
              grading: {
                pointValue: pointVal,
                ...(cleanKey
                  ? {
                      correctAnswers: {
                        answers: [{ value: cleanKey }],
                      },
                    }
                  : {}),
                ...(feedbackText
                  ? {
                      generalFeedback: {
                        text: `Kunci Jawaban: ${cleanKey}\n\n${feedbackText}`,
                      },
                    }
                  : {}),
              },
              textQuestion: { paragraph: false },
            },
          },
        },
        location: { index: idx++ },
      },
    });
    return { requests, itemsAdded: 1 };
  }

  // Paragraph / Essay / Open Case Analysis / Open Stimulus-based
  const rubricKey = Array.isArray(q.answerKey)
    ? q.answerKey.join('; ')
    : String(q.answerKey || '').trim();

  requests.push({
    createItem: {
      item: {
        title: `${displayNumber}. ${q.question}`,
        description: itemDescription,
        questionItem: {
          question: {
            required: true,
            grading: {
              pointValue: pointVal,
              generalFeedback: {
                text: `Kunci Jawaban / Rubrik Penilaian:\n${rubricKey}\n\n${feedbackText}`,
              },
            },
            textQuestion: { paragraph: true },
          },
        },
      },
      location: { index: idx++ },
    },
  });

  return { requests, itemsAdded: 1 };
}

export async function configureQuizAndInsertQuestions(
  accessToken: string,
  formId: string,
  questions: ExamQuestion[],
  participantIdentityIncluded = true
): Promise<GoogleFormResult> {
  if (questions.length === 0) {
    throw new Error('Tidak ada soal untuk dimasukkan ke Google Form.');
  }

  const safeFormId = encodeURIComponent(formId.trim());

  // Fetch current form state to know starting item index
  const currentForm = await callFormsApi<GoogleFormApiResponse>(
    `${FORMS_API_BASE}/${safeFormId}`,
    accessToken,
    { method: 'GET' }
  );

  let nextIndex = currentForm.items?.length || 0;
  const requests: Array<Record<string, unknown>> = [
    {
      updateSettings: {
        settings: {
          quizSettings: {
            isQuiz: true,
          },
        },
        updateMask: 'quizSettings.isQuiz',
      },
    },
  ];

  questions.forEach((q, i) => {
    const built = buildQuestionCreateRequests(q, nextIndex, i + 1);
    requests.push(...built.requests);
    nextIndex += built.itemsAdded;
  });

  const CHUNK_SIZE = 25;
  for (let i = 0; i < requests.length; i += CHUNK_SIZE) {
    const chunk = requests.slice(i, i + CHUNK_SIZE);
    await callFormsApi(`${FORMS_API_BASE}/${safeFormId}:batchUpdate`, accessToken, {
      method: 'POST',
      body: JSON.stringify({ requests: chunk }),
    });
  }

  const updatedForm = await callFormsApi<GoogleFormApiResponse>(
    `${FORMS_API_BASE}/${safeFormId}`,
    accessToken,
    { method: 'GET' }
  );

  const totalPoints = questions.reduce((acc, q) => acc + Math.round(Number(q.points) || 0), 0);

  return {
    formId,
    title: updatedForm.info?.title || 'Asesmen Evaluasi',
    responderUri:
      updatedForm.responderUri || `https://docs.google.com/forms/d/${safeFormId}/viewform`,
    editUrl: buildEditUrl(formId),
    isQuiz: updatedForm.settings?.quizSettings?.isQuiz ?? true,
    totalQuestions: questions.length,
    totalPoints,
    participantIdentityIncluded,
    createdAt: new Date().toISOString(),
  };
}

export async function getGoogleFormLinks(
  accessToken: string,
  formId: string
): Promise<{
  formId: string;
  title: string;
  responderUri: string;
  editUrl: string;
  isQuiz: boolean;
}> {
  const safeFormId = encodeURIComponent(formId.trim());
  const form = await callFormsApi<GoogleFormApiResponse>(
    `${FORMS_API_BASE}/${safeFormId}`,
    accessToken,
    { method: 'GET' }
  );

  return {
    formId: form.formId,
    title: form.info?.title || 'Google Form',
    responderUri:
      form.responderUri || `https://docs.google.com/forms/d/${safeFormId}/viewform`,
    editUrl: buildEditUrl(form.formId),
    isQuiz: Boolean(form.settings?.quizSettings?.isQuiz),
  };
}

export interface GoogleTokenStatus {
  valid: boolean;
  email?: string;
  expiresInSeconds?: number;
  hasFormsScope: boolean;
  scopes: string[];
}

export async function verifyGoogleOAuthToken(
  accessToken: string
): Promise<GoogleTokenStatus> {
  const token = accessToken.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return { valid: false, hasFormsScope: false, scopes: [] };
  }

  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`
  );

  if (!res.ok) {
    return { valid: false, hasFormsScope: false, scopes: [] };
  }

  const info = (await res.json()) as {
    email?: string;
    expires_in?: string;
    scope?: string;
  };

  const scopes = (info.scope || '').split(/\s+/).filter(Boolean);
  const hasFormsScope = scopes.includes('https://www.googleapis.com/auth/forms.body');
  const expiresInSeconds = info.expires_in ? Number(info.expires_in) : undefined;

  return {
    valid: true,
    email: info.email,
    expiresInSeconds: Number.isFinite(expiresInSeconds) ? expiresInSeconds : undefined,
    hasFormsScope,
    scopes,
  };
}

export async function createTestGoogleForm(
  accessToken: string
): Promise<GoogleFormResult> {
  const nowLabel = new Date().toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const created = await createGoogleFormResource(accessToken, {
    title: `Uji Koneksi Google Forms — AssessCraft (${nowLabel})`,
    description:
      'Formulir uji otomatis untuk memverifikasi integrasi Google OAuth 2.0 dan pembuatan kuis Google Forms.',
    participantIdentity: {
      includeFullName: true,
      includeParticipantId: false,
      includeClassOrOrg: false,
    },
  });

  const sampleQuestion: ExamQuestion = {
    id: 'test_q_1',
    order: 1,
    type: 'multiple_choice_4',
    cognitiveLevel: 'LOTS',
    difficulty: 'Easy',
    question:
      'Pertanyaan Verifikasi: Apa status integrasi Google Forms kuis pada uji koneksi ini?',
    options: [
      'Terhubung dan mode kuis aktif',
      'Belum terhubung',
      'Memerlukan token manual',
      'Tidak aktif',
    ],
    answerKey: 'Terhubung dan mode kuis aktif',
    explanation:
      'Formulir uji ini dibuat secara otomatis melalui Google Forms REST API v1 dengan mode kuis aktif.',
    competencyIndicator: 'Verifikasi integrasi Google Forms OAuth & Quiz API',
    sourceReference: 'Uji Koneksi Sistem',
    points: 10,
  };

  return configureQuizAndInsertQuestions(accessToken, created.formId, [sampleQuestion], true);
}

