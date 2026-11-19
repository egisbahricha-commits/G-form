import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  EmbeddedMediaItem,
  ExamSession,
  GenerationConfig,
  ParticipantIdentityConfig,
} from '../shared/types.ts';

const STORAGE_ROOT = process.env.ASSESSCRAFT_DATA_DIR
  ? path.resolve(process.env.ASSESSCRAFT_DATA_DIR)
  : process.env.ASSESSCRAFT_STDIO_MODE === '1'
  ? path.join(os.tmpdir(), 'assesscraft-sessions')
  : path.resolve(process.cwd(), '.assesscraft-sessions');
const SESSIONS_FILE = path.join(STORAGE_ROOT, 'sessions.json');
const BLOBS_DIR = path.join(STORAGE_ROOT, 'blobs');

interface StoredBlob {
  mimeType: string;
  base64Data: string;
  embeddedMedia?: EmbeddedMediaItem[];
}

function ensureDirs(): void {
  if (!fs.existsSync(STORAGE_ROOT)) {
    fs.mkdirSync(STORAGE_ROOT, { recursive: true });
  }
  if (!fs.existsSync(BLOBS_DIR)) {
    fs.mkdirSync(BLOBS_DIR, { recursive: true });
  }
}

function readSessionsMap(): Record<string, ExamSession> {
  ensureDirs();
  if (!fs.existsSync(SESSIONS_FILE)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf-8');
    if (!raw.trim()) return {};
    return JSON.parse(raw) as Record<string, ExamSession>;
  } catch {
    return {};
  }
}

function writeSessionsMap(map: Record<string, ExamSession>): void {
  ensureDirs();
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(map, null, 2), 'utf-8');
}

export function defaultConfig(): GenerationConfig {
  return {
    subject: '',
    educationLevel: 'Universal (Otomatis dari materi)',
    curriculumOrContext: '',
    questionTypes: ['multiple_choice_5', 'complex_multiple_choice', 'short_answer', 'essay'],
    questionCount: 10,
    cognitiveFocus: 'Mixed',
    difficulty: 'Mixed',
    targetTotalPoints: 100,
    language: 'Bahasa Indonesia',
    strictSourceOnly: true,
    customInstructions: '',
  };
}

export function defaultParticipantIdentity(): ParticipantIdentityConfig {
  return {
    includeFullName: true,
    includeParticipantId: true,
    includeClassOrOrg: true,
    customFields: [],
  };
}

export function createSession(partial?: Partial<ExamSession>): ExamSession {
  const now = new Date().toISOString();
  const id = partial?.id || `exam_${crypto.randomUUID().slice(0, 8)}`;
  const session: ExamSession = {
    id,
    title: partial?.title || 'Ujian Evaluasi Multimodal Baru',
    description:
      partial?.description ||
      'Formulir asesmen yang disusun berdasarkan analisis materi sumber.',
    config: { ...defaultConfig(), ...(partial?.config || {}) },
    materials: partial?.materials || [],
    analysis: partial?.analysis ?? null,
    questions: partial?.questions || [],
    validation: partial?.validation ?? null,
    approvedForPublish: partial?.approvedForPublish ?? false,
    approvalTimestamp: partial?.approvalTimestamp,
    participantIdentity: {
      ...defaultParticipantIdentity(),
      ...(partial?.participantIdentity || {}),
    },
    googleForm: partial?.googleForm ?? null,
    createdAt: partial?.createdAt || now,
    updatedAt: now,
  };
  const map = readSessionsMap();
  map[session.id] = session;
  writeSessionsMap(map);
  return session;
}

export function getSession(sessionId: string): ExamSession | null {
  const map = readSessionsMap();
  return map[sessionId] || null;
}

export function getOrCreateSession(sessionId?: string): ExamSession {
  if (sessionId) {
    const existing = getSession(sessionId);
    if (existing) return existing;
    return createSession({ id: sessionId });
  }
  return createSession();
}

export function listSessions(): ExamSession[] {
  const map = readSessionsMap();
  return Object.values(map).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveSession(session: ExamSession): ExamSession {
  const map = readSessionsMap();
  const updated: ExamSession = {
    ...session,
    updatedAt: new Date().toISOString(),
  };
  map[updated.id] = updated;
  writeSessionsMap(map);
  return updated;
}

export function deleteSession(sessionId: string): boolean {
  const map = readSessionsMap();
  const existing = map[sessionId];
  if (!existing) return false;
  for (const mat of existing.materials) {
    if (mat.blobPath && fs.existsSync(mat.blobPath)) {
      try {
        fs.unlinkSync(mat.blobPath);
      } catch {
        // Ignore cleanup failure
      }
    }
  }
  delete map[sessionId];
  writeSessionsMap(map);
  return true;
}

export function saveMaterialBlob(
  materialId: string,
  mimeType: string,
  base64Data: string,
  embeddedMedia?: EmbeddedMediaItem[]
): string {
  ensureDirs();
  const safeId = materialId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const blobPath = path.join(BLOBS_DIR, `${safeId}.json`);
  const payload: StoredBlob = { mimeType, base64Data, embeddedMedia };
  fs.writeFileSync(blobPath, JSON.stringify(payload), 'utf-8');
  return blobPath;
}

export function loadMaterialBlob(blobPath?: string): StoredBlob | null {
  if (!blobPath || !fs.existsSync(blobPath)) return null;
  try {
    const raw = fs.readFileSync(blobPath, 'utf-8');
    return JSON.parse(raw) as StoredBlob;
  } catch {
    return null;
  }
}

export function deleteMaterialBlob(blobPath?: string): void {
  if (blobPath && fs.existsSync(blobPath)) {
    try {
      fs.unlinkSync(blobPath);
    } catch {
      // Ignore cleanup failure
    }
  }
}
