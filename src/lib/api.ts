import type {
  ExamQuestion,
  ExamSession,
  GenerationConfig,
  GoogleFormResult,
  MaterialAnalysis,
  ParticipantIdentityConfig,
  ValidationReport,
} from '../shared/types';

export class ApiTokenExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiTokenExpiredError';
  }
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & {
    error?: string;
    code?: string;
  };
  if (!res.ok) {
    if (res.status === 401 && data.code === 'TOKEN_EXPIRED') {
      throw new ApiTokenExpiredError(
        data.error || 'Sesi Google OAuth telah kedaluwarsa.'
      );
    }
    throw new Error(data.error || `Permintaan gagal dengan status ${res.status}`);
  }
  return data;
}

export async function fetchSessions(): Promise<ExamSession[]> {
  const res = await fetch('/api/sessions');
  const data = await parseJsonResponse<{ sessions: ExamSession[] }>(res);
  return data.sessions;
}

export async function createNewSession(title?: string): Promise<ExamSession> {
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  const data = await parseJsonResponse<{ session: ExamSession }>(res);
  return data.session;
}

export async function updateSessionData(
  sessionId: string,
  payload: {
    title?: string;
    description?: string;
    config?: Partial<GenerationConfig>;
    questions?: ExamQuestion[];
    participantIdentity?: Partial<ParticipantIdentityConfig>;
    approvedForPublish?: boolean;
  }
): Promise<ExamSession> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonResponse<{ session: ExamSession }>(res);
  return data.session;
}

export async function deleteSessionById(sessionId: string): Promise<void> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
  await parseJsonResponse<{ deleted: boolean }>(res);
}

export async function uploadSessionMaterials(
  sessionId: string,
  params: {
    files?: File[];
    typedText?: string;
    typedTitle?: string;
  }
): Promise<ExamSession> {
  const formData = new FormData();
  for (const file of params.files || []) {
    formData.append('files', file);
  }
  if (params.typedText && params.typedText.trim()) {
    formData.append('typedText', params.typedText);
  }
  if (params.typedTitle && params.typedTitle.trim()) {
    formData.append('typedTitle', params.typedTitle);
  }

  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/materials`, {
    method: 'POST',
    body: formData,
  });
  const data = await parseJsonResponse<{ session: ExamSession }>(res);
  return data.session;
}

export async function removeSessionMaterial(
  sessionId: string,
  materialId: string
): Promise<ExamSession> {
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/materials/${encodeURIComponent(materialId)}`,
    { method: 'DELETE' }
  );
  const data = await parseJsonResponse<{ session: ExamSession }>(res);
  return data.session;
}

export async function extractSessionMaterialText(
  sessionId: string,
  materialId?: string
): Promise<ExamSession> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ materialId }),
  });
  const data = await parseJsonResponse<{ session: ExamSession }>(res);
  return data.session;
}

export async function analyzeSession(sessionId: string): Promise<{
  session: ExamSession;
  analysis: MaterialAnalysis;
}> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return parseJsonResponse<{ session: ExamSession; analysis: MaterialAnalysis }>(res);
}

export async function generateSessionQuestions(
  sessionId: string,
  config: Partial<GenerationConfig>
): Promise<ExamSession> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  });
  const data = await parseJsonResponse<{ session: ExamSession }>(res);
  return data.session;
}

export async function verifySessionAnswerKeys(sessionId: string): Promise<ExamSession> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/verify-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await parseJsonResponse<{ session: ExamSession }>(res);
  return data.session;
}

export async function enrichSessionExplanations(sessionId: string): Promise<ExamSession> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/explanations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await parseJsonResponse<{ session: ExamSession }>(res);
  return data.session;
}

export async function validateSession(sessionId: string): Promise<{
  session: ExamSession;
  validation: ValidationReport;
}> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return parseJsonResponse<{ session: ExamSession; validation: ValidationReport }>(res);
}

export interface GoogleTokenStatusResponse {
  valid: boolean;
  email?: string;
  expiresInSeconds?: number;
  hasFormsScope: boolean;
  scopes: string[];
}

export async function verifyGoogleTokenStatus(
  accessToken: string
): Promise<GoogleTokenStatusResponse> {
  const res = await fetch('/api/auth/google/status', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return parseJsonResponse<GoogleTokenStatusResponse>(res);
}

export async function testCreateGoogleForm(
  accessToken: string
): Promise<{ googleForm: GoogleFormResult; verifiedEmail?: string }> {
  const res = await fetch('/api/forms/test', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ approved: true }),
  });
  return parseJsonResponse<{ googleForm: GoogleFormResult; verifiedEmail?: string }>(res);
}

export async function publishToGoogleForms(
  sessionId: string,
  accessToken: string,
  payload: {
    approved: boolean;
    title: string;
    description: string;
    participantIdentity: ParticipantIdentityConfig;
  }
): Promise<{ session: ExamSession; googleForm: GoogleFormResult }> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse<{ session: ExamSession; googleForm: GoogleFormResult }>(res);
}

export async function fetchMcpTools(): Promise<{
  serverName: string;
  version: string;
  transports: {
    httpStreamable: string;
    sse?: string;
    messages?: string;
    stdioCommand: string;
  };
  tools: Array<{ name: string; title: string; description: string }>;
}> {
  const res = await fetch('/api/mcp/tools');
  return parseJsonResponse(res);
}

export async function invokeMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  accessToken?: string | null
): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  const res = await fetch('/api/mcp/invoke', {
    method: 'POST',
    headers,
    body: JSON.stringify({ toolName, args }),
  });
  const data = await parseJsonResponse<{ result: unknown }>(res);
  return data.result;
}

export interface McpAuthBridgeStatus {
  connected: boolean;
  email?: string;
  expiresInSeconds?: number;
  sessionId?: string;
}

export async function syncMcpAuthSession(
  accessToken: string,
  sessionId?: string
): Promise<McpAuthBridgeStatus> {
  const res = await fetch('/api/mcp/auth-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ sessionId }),
  });
  return parseJsonResponse<McpAuthBridgeStatus>(res);
}

export async function fetchMcpAuthStatus(
  sessionId?: string
): Promise<McpAuthBridgeStatus> {
  const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
  const res = await fetch(`/api/mcp/auth-status${query}`);
  return parseJsonResponse<McpAuthBridgeStatus>(res);
}

export async function clearMcpAuthSession(sessionId?: string): Promise<void> {
  await fetch('/api/mcp/auth-logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
}

export async function quickUploadMaterials(params: {
  sessionId?: string;
  title?: string;
  files?: File[];
  typedText?: string;
  typedTitle?: string;
}): Promise<{ sessionId: string; addedCount: number; session: ExamSession }> {
  const formData = new FormData();
  if (params.sessionId) formData.append('sessionId', params.sessionId);
  if (params.title) formData.append('title', params.title);
  for (const file of params.files || []) {
    formData.append('files', file);
  }
  if (params.typedText && params.typedText.trim()) {
    formData.append('typedText', params.typedText);
  }
  if (params.typedTitle && params.typedTitle.trim()) {
    formData.append('typedTitle', params.typedTitle);
  }
  const res = await fetch('/api/sessions/quick-upload', {
    method: 'POST',
    body: formData,
  });
  return parseJsonResponse<{ sessionId: string; addedCount: number; session: ExamSession }>(
    res
  );
}

export interface ClaudeSkillMeta {
  id: string;
  name: string;
  description: string;
  primary: boolean;
  downloadUrl: string;
}

export async function fetchAvailableSkills(): Promise<{
  skills: ClaudeSkillMeta[];
  suiteDownloadUrl: string;
}> {
  const res = await fetch('/api/skills');
  return parseJsonResponse<{ skills: ClaudeSkillMeta[]; suiteDownloadUrl: string }>(res);
}
