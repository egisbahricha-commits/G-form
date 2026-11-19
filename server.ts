import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import JSZip from 'jszip';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createAssessCraftMcpServer, MCP_TOOL_METADATA } from './src/mcp/createMcpServer.ts';
import {
  clearAuthorizedGoogleToken,
  getAuthBridgeSummary,
  setAuthorizedGoogleToken,
} from './src/server/authBridge.ts';
import {
  analyzeSessionMaterials,
  extractTextFromSingleMaterial,
  generateExplanationsForQuestions,
  generateOrVerifyAnswerKeys,
  generateQuestionsWithGemini,
  validateExamQuestions,
} from './src/server/geminiEngine.ts';
import {
  configureQuizAndInsertQuestions,
  createGoogleFormResource,
  createTestGoogleForm,
  GoogleFormsAuthError,
  verifyGoogleOAuthToken,
} from './src/server/googleFormsService.ts';
import {
  createTypedTextMaterial,
  parseUploadedBuffer,
} from './src/server/materialParser.ts';
import {
  createSession,
  deleteMaterialBlob,
  deleteSession,
  getOrCreateSession,
  getSession,
  listSessions,
  saveSession,
} from './src/server/store.ts';
import type { ExamQuestion, GenerationConfig, ParticipantIdentityConfig } from './src/shared/types.ts';

const PORT = Number(process.env.PORT || 3000);

function getPublicBaseUrl(req: Request): string {
  const envUrl = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL;
  if (envUrl && envUrl !== 'MY_APP_URL' && /^https?:\/\//i.test(envUrl)) {
    return envUrl.replace(/\/+$/, '');
  }
  const protoHeader = req.headers['x-forwarded-proto'];
  const hostHeader = req.headers['x-forwarded-host'] || req.get('host');
  const proto =
    typeof protoHeader === 'string'
      ? protoHeader.split(',')[0].trim()
      : req.protocol || 'http';
  if (hostHeader) {
    const host = typeof hostHeader === 'string' ? hostHeader.split(',')[0].trim() : '';
    if (host) return `${proto}://${host}`.replace(/\/+$/, '');
  }
  return `http://localhost:${PORT}`;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB per file
    files: 20,
  },
});

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);

  app.use(
    cors({
      origin: true,
      credentials: true,
      exposedHeaders: ['Mcp-Session-Id'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id', 'Accept'],
    })
  );
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Health check
  app.get('/api/health', (req: Request, res: Response) => {
    const baseUrl = getPublicBaseUrl(req);
    const authSummary = getAuthBridgeSummary();
    res.json({
      ok: true,
      service: 'AssessCraft Universal Remote MCP',
      version: '2.0.0',
      geminiConfigured: Boolean(
        process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
      ),
      oauthBridgeConnected: authSummary.connected,
      oauthBridgeEmail: authSummary.email || null,
      mcpEndpoint: `${baseUrl}/mcp`,
      sseEndpoint: `${baseUrl}/sse`,
      connectUrl: `${baseUrl}/connect`,
      uploadUrl: `${baseUrl}/upload`,
    });
  });

  // Session CRUD
  app.get('/api/sessions', (_req: Request, res: Response) => {
    res.json({ sessions: listSessions() });
  });

  app.post('/api/sessions', (req: Request, res: Response) => {
    const body = (req.body || {}) as {
      title?: string;
      description?: string;
      config?: Partial<GenerationConfig>;
    };
    const session = createSession({
      title: body.title,
      description: body.description,
      config: body.config ? { ...createSession().config, ...body.config } : undefined,
    });
    res.status(201).json({ session });
  });

  app.get('/api/sessions/:id', (req: Request, res: Response) => {
    const session = getSession(String(req.params.id));
    if (!session) {
      res.status(404).json({ error: 'Sesi tidak ditemukan.' });
      return;
    }
    res.json({ session });
  });

  app.patch('/api/sessions/:id', (req: Request, res: Response) => {
    const session = getSession(String(req.params.id));
    if (!session) {
      res.status(404).json({ error: 'Sesi tidak ditemukan.' });
      return;
    }
    const body = (req.body || {}) as {
      title?: string;
      description?: string;
      config?: Partial<GenerationConfig>;
      questions?: ExamQuestion[];
      participantIdentity?: Partial<ParticipantIdentityConfig>;
      approvedForPublish?: boolean;
    };

    if (body.title !== undefined) session.title = body.title;
    if (body.description !== undefined) session.description = body.description;
    if (body.config) session.config = { ...session.config, ...body.config };
    if (body.questions) {
      session.questions = body.questions.map((q, idx) => ({ ...q, order: idx + 1 }));
      session.approvedForPublish = false;
    }
    if (body.participantIdentity) {
      session.participantIdentity = {
        ...session.participantIdentity,
        ...body.participantIdentity,
      };
    }
    if (body.approvedForPublish !== undefined) {
      session.approvedForPublish = body.approvedForPublish;
      session.approvalTimestamp = body.approvedForPublish
        ? new Date().toISOString()
        : undefined;
    }

    const updated = saveSession(session);
    res.json({ session: updated });
  });

  app.delete('/api/sessions/:id', (req: Request, res: Response) => {
    const ok = deleteSession(String(req.params.id));
    if (!ok) {
      res.status(404).json({ error: 'Sesi tidak ditemukan.' });
      return;
    }
    res.json({ deleted: true });
  });

  // Upload multiple files &/or typed material
  app.post(
    '/api/sessions/:id/materials',
    upload.array('files', 20),
    async (req: Request, res: Response) => {
      try {
        const session = getSession(String(req.params.id));
        if (!session) {
          res.status(404).json({ error: 'Sesi tidak ditemukan.' });
          return;
        }

        const files = (req.files as Express.Multer.File[]) || [];
        const typedText = typeof req.body?.typedText === 'string' ? req.body.typedText : '';
        const typedTitle = typeof req.body?.typedTitle === 'string' ? req.body.typedTitle : '';

        if (files.length === 0 && !typedText.trim()) {
          res.status(400).json({
            error: 'Kirim minimal satu file (JPG/PNG/WEBP/PDF/DOCX/PPTX/TXT) atau ketik teks materi.',
          });
          return;
        }

        const addedMaterials = [];
        for (const file of files) {
          const parsed = await parseUploadedBuffer({
            filename: file.originalname,
            mimeType: file.mimetype,
            buffer: file.buffer,
          });
          session.materials.push(parsed);
          addedMaterials.push(parsed);
        }

        if (typedText.trim()) {
          const typed = createTypedTextMaterial(typedTitle || 'Materi Ketik Langsung', typedText);
          session.materials.push(typed);
          addedMaterials.push(typed);
        }

        session.analysis = null;
        session.approvedForPublish = false;
        const saved = saveSession(session);

        res.json({
          addedCount: addedMaterials.length,
          session: saved,
        });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Gagal memproses unggahan materi.',
        });
      }
    }
  );

  // Delete single material
  app.delete('/api/sessions/:id/materials/:materialId', (req: Request, res: Response) => {
    const session = getSession(String(req.params.id));
    if (!session) {
      res.status(404).json({ error: 'Sesi tidak ditemukan.' });
      return;
    }
    const target = session.materials.find((m) => m.id === req.params.materialId);
    if (!target) {
      res.status(404).json({ error: 'Materi tidak ditemukan.' });
      return;
    }
    deleteMaterialBlob(target.blobPath);
    session.materials = session.materials.filter((m) => m.id !== req.params.materialId);
    session.analysis = null;
    const saved = saveSession(session);
    res.json({ session: saved });
  });

  // Extract OCR/Text for specific or all materials
  app.post('/api/sessions/:id/extract', async (req: Request, res: Response) => {
    try {
      const session = getSession(String(req.params.id));
      if (!session) {
        res.status(404).json({ error: 'Sesi tidak ditemukan.' });
        return;
      }
      const materialId = typeof req.body?.materialId === 'string' ? req.body.materialId : undefined;
      const targets = materialId
        ? session.materials.filter((m) => m.id === materialId)
        : session.materials;

      for (const mat of targets) {
        const result = await extractTextFromSingleMaterial(mat);
        mat.extractedText = result.extractedText;
        mat.readabilityStatus = result.readabilityStatus;
        mat.readabilityMessage = result.readabilityMessage;
      }

      const saved = saveSession(session);
      res.json({ session: saved });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal mengekstrak teks materi.',
      });
    }
  });

  // Multimodal analysis
  app.post('/api/sessions/:id/analyze', async (req: Request, res: Response) => {
    try {
      const session = getSession(String(req.params.id));
      if (!session) {
        res.status(404).json({ error: 'Sesi tidak ditemukan.' });
        return;
      }

      const analysis = await analyzeSessionMaterials(session);
      session.analysis = analysis;

      for (const t of analysis.ocrTranscripts) {
        const mat = session.materials.find((m) => m.id === t.fileId || m.name === t.fileName);
        if (mat && t.text && !mat.extractedText.includes(t.text)) {
          mat.extractedText = [mat.extractedText, t.text].filter(Boolean).join('\n\n');
          mat.readabilityStatus = 'readable';
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

      const saved = saveSession(session);
      res.json({ session: saved, analysis });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal menganalisis materi.',
      });
    }
  });

  // Generate questions
  app.post('/api/sessions/:id/generate', async (req: Request, res: Response) => {
    try {
      const session = getSession(String(req.params.id));
      if (!session) {
        res.status(404).json({ error: 'Sesi tidak ditemukan.' });
        return;
      }

      const override = (req.body?.config || req.body || {}) as Partial<GenerationConfig>;
      session.config = { ...session.config, ...override };

      const questions = await generateQuestionsWithGemini(session, override);
      session.questions = questions;
      session.approvedForPublish = false;
      session.validation = await validateExamQuestions(
        session,
        session.config.questionCount,
        session.config.targetTotalPoints
      );

      const saved = saveSession(session);
      res.json({ session: saved });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal membuat soal dengan Gemini.',
      });
    }
  });

  // Verify answer keys
  app.post('/api/sessions/:id/verify-keys', async (req: Request, res: Response) => {
    try {
      const session = getSession(String(req.params.id));
      if (!session) {
        res.status(404).json({ error: 'Sesi tidak ditemukan.' });
        return;
      }
      const questionIds = Array.isArray(req.body?.questionIds)
        ? (req.body.questionIds as string[])
        : undefined;
      session.questions = await generateOrVerifyAnswerKeys(session, questionIds);
      session.validation = await validateExamQuestions(session);
      const saved = saveSession(session);
      res.json({ session: saved });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal memeriksa kunci jawaban.',
      });
    }
  });

  // Enrich explanations
  app.post('/api/sessions/:id/explanations', async (req: Request, res: Response) => {
    try {
      const session = getSession(String(req.params.id));
      if (!session) {
        res.status(404).json({ error: 'Sesi tidak ditemukan.' });
        return;
      }
      const questionIds = Array.isArray(req.body?.questionIds)
        ? (req.body.questionIds as string[])
        : undefined;
      session.questions = await generateExplanationsForQuestions(session, questionIds);
      const saved = saveSession(session);
      res.json({ session: saved });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal memperkaya pembahasan soal.',
      });
    }
  });

  // Validate exam quality
  app.post('/api/sessions/:id/validate', async (req: Request, res: Response) => {
    try {
      const session = getSession(String(req.params.id));
      if (!session) {
        res.status(404).json({ error: 'Sesi tidak ditemukan.' });
        return;
      }
      const validation = await validateExamQuestions(
        session,
        req.body?.requestedCount,
        req.body?.targetTotalPoints
      );
      session.validation = validation;
      const saved = saveSession(session);
      res.json({ session: saved, validation });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal memvalidasi soal.',
      });
    }
  });

  // Publish exam to Google Forms (Approval-Gated + OAuth Bearer Token)
  app.post('/api/sessions/:id/publish', async (req: Request, res: Response) => {
    try {
      const session = getSession(String(req.params.id));
      if (!session) {
        res.status(404).json({ error: 'Sesi tidak ditemukan.' });
        return;
      }

      const authHeader = req.headers.authorization || '';
      const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (!accessToken) {
        res.status(401).json({
          error: 'Autentikasi Google OAuth diperlukan. Silakan klik Sign in with Google terlebih dahulu.',
        });
        return;
      }

      const body = (req.body || {}) as {
        approved?: boolean;
        title?: string;
        description?: string;
        participantIdentity?: Partial<ParticipantIdentityConfig>;
      };

      if (body.approved !== true) {
        res.status(400).json({
          error: 'Persetujuan eksplisit pengguna diperlukan sebelum mempublikasikan Google Form.',
          requiresApproval: true,
        });
        return;
      }

      if (session.questions.length === 0) {
        res.status(400).json({ error: 'Belum ada soal untuk dipublikasikan.' });
        return;
      }

      if (body.title) session.title = body.title;
      if (body.description) session.description = body.description;
      if (body.participantIdentity) {
        session.participantIdentity = {
          ...session.participantIdentity,
          ...body.participantIdentity,
        };
      }

      session.approvedForPublish = true;
      session.approvalTimestamp = new Date().toISOString();

      const created = await createGoogleFormResource(accessToken, {
        title: session.title,
        description: session.description,
        participantIdentity: session.participantIdentity,
      });

      const hasIdentity =
        session.participantIdentity.includeFullName ||
        session.participantIdentity.includeParticipantId ||
        session.participantIdentity.includeClassOrOrg ||
        (session.participantIdentity.customFields?.length || 0) > 0;

      const published = await configureQuizAndInsertQuestions(
        accessToken,
        created.formId,
        session.questions,
        hasIdentity
      );

      session.googleForm = published;
      const saved = saveSession(session);
      res.json({ session: saved, googleForm: published });
    } catch (err) {
      if (err instanceof GoogleFormsAuthError) {
        res.status(err.statusCode).json({
          error: err.message,
          code: 'TOKEN_EXPIRED',
        });
        return;
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal membuat Google Form.',
      });
    }
  });

  // Verify Google OAuth Bearer token status (email, expiry, forms.body scope)
  app.get('/api/auth/google/status', async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization || '';
      const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (!accessToken) {
        res.status(401).json({
          valid: false,
          hasFormsScope: false,
          scopes: [],
          code: 'TOKEN_MISSING',
        });
        return;
      }
      const status = await verifyGoogleOAuthToken(accessToken);
      if (!status.valid) {
        res.status(401).json({ ...status, code: 'TOKEN_EXPIRED' });
        return;
      }
      res.json(status);
    } catch (err) {
      res.status(500).json({
        valid: false,
        error: err instanceof Error ? err.message : 'Gagal memverifikasi status OAuth Google.',
      });
    }
  });

  // Test creating a real Google Form using the authorized Google account
  app.post('/api/forms/test', async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization || '';
      const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (!accessToken) {
        res.status(401).json({
          error: 'Autentikasi Google OAuth diperlukan. Hubungkan akun Google Anda terlebih dahulu.',
          code: 'TOKEN_EXPIRED',
        });
        return;
      }

      const body = (req.body || {}) as { approved?: boolean };
      if (body.approved !== true) {
        res.status(400).json({
          error: 'Konfirmasi pengguna diperlukan sebelum membuat Google Form uji.',
          requiresApproval: true,
        });
        return;
      }

      const tokenStatus = await verifyGoogleOAuthToken(accessToken);
      if (!tokenStatus.valid) {
        res.status(401).json({
          error: 'Sesi Google OAuth telah kedaluwarsa. Memperbarui otorisasi...',
          code: 'TOKEN_EXPIRED',
        });
        return;
      }
      if (!tokenStatus.hasFormsScope) {
        res.status(403).json({
          error: 'Izin Google Forms (forms.body) belum diberikan pada akun ini. Silakan hubungkan ulang akun Google.',
          code: 'MISSING_SCOPE',
        });
        return;
      }

      const googleForm = await createTestGoogleForm(accessToken);
      res.json({ googleForm, verifiedEmail: tokenStatus.email });
    } catch (err) {
      if (err instanceof GoogleFormsAuthError) {
        res.status(err.statusCode).json({
          error: err.message,
          code: 'TOKEN_EXPIRED',
        });
        return;
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal menguji pembuatan Google Form.',
      });
    }
  });

  // Mobile & Remote OAuth Bridge for Claude MCP
  app.post('/api/mcp/auth-session', async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization || '';
      const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (!accessToken) {
        res.status(401).json({ error: 'Bearer access token wajib dikirim.' });
        return;
      }

      const status = await verifyGoogleOAuthToken(accessToken);
      if (!status.valid) {
        res.status(401).json({
          error: 'Token Google OAuth tidak valid atau telah kedaluwarsa.',
          code: 'TOKEN_EXPIRED',
        });
        return;
      }
      if (!status.hasFormsScope) {
        res.status(403).json({
          error: 'Izin Google Forms (forms.body) belum disetujui pada akun Google.',
          code: 'MISSING_SCOPE',
        });
        return;
      }

      const sessionId =
        typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined;

      setAuthorizedGoogleToken({
        key: sessionId,
        accessToken,
        email: status.email,
        expiresInSeconds: status.expiresInSeconds,
      });

      res.json({
        connected: true,
        email: status.email,
        expiresInSeconds: status.expiresInSeconds,
        sessionId: sessionId || 'default',
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal mengikat sesi OAuth MCP.',
      });
    }
  });

  app.get('/api/mcp/auth-status', (req: Request, res: Response) => {
    const sessionId =
      typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
    res.json(getAuthBridgeSummary(sessionId));
  });

  app.post('/api/mcp/auth-logout', (req: Request, res: Response) => {
    const sessionId =
      typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined;
    clearAuthorizedGoogleToken(sessionId);
    res.json({ connected: false });
  });

  // Mobile quick-upload portal endpoint (creates/reuses session for Claude)
  app.post(
    '/api/sessions/quick-upload',
    upload.array('files', 20),
    async (req: Request, res: Response) => {
      try {
        const requestedSessionId =
          typeof req.body?.sessionId === 'string' && req.body.sessionId.trim()
            ? req.body.sessionId.trim()
            : undefined;
        const session = getOrCreateSession(requestedSessionId);

        if (typeof req.body?.title === 'string' && req.body.title.trim()) {
          session.title = req.body.title.trim();
        }

        const files = (req.files as Express.Multer.File[]) || [];
        const typedText = typeof req.body?.typedText === 'string' ? req.body.typedText : '';
        const typedTitle = typeof req.body?.typedTitle === 'string' ? req.body.typedTitle : '';

        if (files.length === 0 && !typedText.trim()) {
          res.status(400).json({
            error: 'Pilih minimal satu file (JPG/PNG/WEBP/PDF/DOCX/PPTX/TXT) atau ketik materi.',
          });
          return;
        }

        let addedCount = 0;
        for (const file of files) {
          const parsed = await parseUploadedBuffer({
            filename: file.originalname,
            mimeType: file.mimetype,
            buffer: file.buffer,
          });
          session.materials.push(parsed);
          addedCount += 1;
        }

        if (typedText.trim()) {
          const typed = createTypedTextMaterial(typedTitle || 'Materi Ketik Langsung', typedText);
          session.materials.push(typed);
          addedCount += 1;
        }

        session.analysis = null;
        session.approvedForPublish = false;
        const saved = saveSession(session);
        res.json({
          sessionId: saved.id,
          addedCount,
          session: saved,
        });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Gagal memproses unggahan materi.',
        });
      }
    }
  );

  // Claude AI Skills Discovery & ZIP Packaging (/api/skills & /api/skills/download)
  function parseSkillFrontmatter(skillMdPath: string): { name: string; description: string } {
    const raw = fs.readFileSync(skillMdPath, 'utf-8');
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return { name: path.basename(path.dirname(skillMdPath)), description: '' };
    const block = match[1];
    const nameMatch = block.match(/^name:\s*(.+)$/m);
    const descMatch = block.match(/^description:\s*(.+)$/m);
    return {
      name: nameMatch ? nameMatch[1].trim().replace(/^['"]|['"]$/g, '') : path.basename(path.dirname(skillMdPath)),
      description: descMatch ? descMatch[1].trim().replace(/^['"]|['"]$/g, '') : '',
    };
  }

  function addDirectoryToZip(zipTarget: JSZip, fsDir: string): number {
    let count = 0;
    const entries = fs.readdirSync(fsDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(fsDir, entry.name);
      if (entry.isDirectory()) {
        const subZip = zipTarget.folder(entry.name);
        if (subZip) count += addDirectoryToZip(subZip, fullPath);
      } else if (entry.isFile()) {
        zipTarget.file(entry.name, fs.readFileSync(fullPath));
        count += 1;
      }
    }
    return count;
  }

  app.get('/api/skills', (_req: Request, res: Response) => {
    const skillsRoot = path.resolve(process.cwd(), 'skills');
    if (!fs.existsSync(skillsRoot)) {
      res.json({ skills: [] });
      return;
    }
    const dirs = fs
      .readdirSync(skillsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort((a, b) => (a === 'assesscraft-form-builder' ? -1 : b === 'assesscraft-form-builder' ? 1 : a.localeCompare(b)));

    const skills = dirs
      .map((dirName) => {
        const skillMd = path.join(skillsRoot, dirName, 'SKILL.md');
        if (!fs.existsSync(skillMd)) return null;
        const meta = parseSkillFrontmatter(skillMd);
        return {
          id: dirName,
          name: meta.name,
          description: meta.description,
          primary: dirName === 'assesscraft-form-builder',
          downloadUrl: `/api/skills/download?skill=${encodeURIComponent(dirName)}`,
        };
      })
      .filter(Boolean);

    res.json({
      skills,
      suiteDownloadUrl: '/api/skills/download?skill=all-suite',
    });
  });

  app.get('/api/skills/download', async (req: Request, res: Response) => {
    try {
      const requested = typeof req.query.skill === 'string' && req.query.skill.trim()
        ? req.query.skill.trim()
        : 'assesscraft-form-builder';
      const skillsRoot = path.resolve(process.cwd(), 'skills');
      const pluginRoot = path.resolve(process.cwd(), '.claude-plugin');

      const zip = new JSZip();
      let filename = 'assesscraft-form-builder.zip';

      if (requested === 'all-suite') {
        filename = 'assesscraft-skill-suite.zip';
        const suiteFolder = zip.folder('assesscraft-skill');
        if (!suiteFolder) throw new Error('Gagal membuat folder arsip skill.');
        const skillsFolder = suiteFolder.folder('skills');
        if (skillsFolder && fs.existsSync(skillsRoot)) {
          addDirectoryToZip(skillsFolder, skillsRoot);
        }
        const pluginFolder = suiteFolder.folder('.claude-plugin');
        if (pluginFolder && fs.existsSync(pluginRoot)) {
          addDirectoryToZip(pluginFolder, pluginRoot);
        }
        const mcpConfigFile = path.resolve(process.cwd(), '.mcp.json');
        if (fs.existsSync(mcpConfigFile)) {
          suiteFolder.file('.mcp.json', fs.readFileSync(mcpConfigFile));
        }
      } else {
        // Prevent path traversal
        if (!/^[a-z0-9-]+$/i.test(requested)) {
          res.status(400).json({ error: 'Nama skill tidak valid.' });
          return;
        }
        const skillDir = path.join(skillsRoot, requested);
        if (!fs.existsSync(skillDir) || !fs.existsSync(path.join(skillDir, 'SKILL.md'))) {
          res.status(404).json({ error: `Skill "${requested}" tidak ditemukan.` });
          return;
        }
        filename = `${requested}.zip`;
        const rootFolder = zip.folder(requested);
        if (!rootFolder) throw new Error('Gagal membuat folder arsip skill.');
        addDirectoryToZip(rootFolder, skillDir);
      }

      const buffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 },
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', String(buffer.length));
      res.send(buffer);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal mengemas skill .zip.',
      });
    }
  });

  // In-app MCP Inspector & Direct Runner endpoints
  app.get('/api/mcp/tools', (req: Request, res: Response) => {
    const baseUrl = getPublicBaseUrl(req);
    res.json({
      serverName: 'assesscraft-universal-mcp',
      version: '2.0.0',
      transports: {
        httpStreamable: `${baseUrl}/mcp`,
        sse: `${baseUrl}/sse`,
        messages: `${baseUrl}/messages`,
        stdioCommand: 'node src/mcp/stdio.ts',
      },
      tools: MCP_TOOL_METADATA,
    });
  });

  app.post('/api/mcp/invoke', async (req: Request, res: Response) => {
    try {
      const { toolName, args } = (req.body || {}) as {
        toolName?: string;
        args?: Record<string, unknown>;
      };
      if (!toolName) {
        res.status(400).json({ error: 'toolName wajib diisi.' });
        return;
      }

      const authHeader = req.headers.authorization || '';
      const googleAccessToken = authHeader.replace(/^Bearer\s+/i, '').trim() || undefined;
      const publicBaseUrl = getPublicBaseUrl(req);

      const mcpServer = createAssessCraftMcpServer({ googleAccessToken, publicBaseUrl });
      const client = new Client(
        { name: 'assesscraft-web-inspector', version: '2.0.0' },
        { capabilities: {} }
      );
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([
        mcpServer.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      const result = await client.callTool({
        name: toolName,
        arguments: args || {},
      });

      await Promise.all([client.close(), mcpServer.close()]);
      res.json({ result });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal memanggil MCP tool.',
      });
    }
  });

  // Remote Streamable HTTP MCP Endpoint (/mcp) for Claude Remote Connectors / MCP Inspector
  const mcpSessions = new Map<
    string,
    { transport: StreamableHTTPServerTransport; server: ReturnType<typeof createAssessCraftMcpServer> }
  >();

  app.post('/mcp', async (req: Request, res: Response) => {
    try {
      const sessionIdHeader = req.headers['mcp-session-id'];
      const mcpSessionId =
        typeof sessionIdHeader === 'string' ? sessionIdHeader : undefined;

      if (mcpSessionId && mcpSessions.has(mcpSessionId)) {
        const entry = mcpSessions.get(mcpSessionId)!;
        await entry.transport.handleRequest(req, res, req.body);
        return;
      }

      const authHeader = req.headers.authorization || '';
      const googleAccessToken = authHeader.replace(/^Bearer\s+/i, '').trim() || undefined;
      const publicBaseUrl = getPublicBaseUrl(req);

      // Support both stateful initialization and stateless one-shot tool calls
      const isInitialize =
        req.body &&
        typeof req.body === 'object' &&
        (req.body as { method?: string }).method === 'initialize';

      if (isInitialize) {
        const server = createAssessCraftMcpServer({ googleAccessToken, publicBaseUrl });
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (newSid) => {
            mcpSessions.set(newSid, { transport, server });
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) {
            mcpSessions.delete(transport.sessionId);
          }
        };
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // Stateless fallback for direct JSON-RPC calls without mcp-session-id
      const server = createAssessCraftMcpServer({ googleAccessToken, publicBaseUrl });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: err instanceof Error ? err.message : 'Internal MCP server error',
          },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', async (req: Request, res: Response) => {
    const mcpSessionId = req.headers['mcp-session-id'];
    if (typeof mcpSessionId === 'string' && mcpSessions.has(mcpSessionId)) {
      const entry = mcpSessions.get(mcpSessionId)!;
      await entry.transport.handleRequest(req, res);
      return;
    }
    const baseUrl = getPublicBaseUrl(req);
    res.status(200).json({
      name: 'assesscraft-universal-mcp',
      version: '2.0.0',
      transport: 'streamable-http',
      endpoints: {
        streamableHttp: `${baseUrl}/mcp`,
        sse: `${baseUrl}/sse`,
        messages: `${baseUrl}/messages`,
        connectOAuth: `${baseUrl}/connect`,
        mobileUpload: `${baseUrl}/upload`,
      },
      oauthConnected: getAuthBridgeSummary().connected,
      toolsCount: MCP_TOOL_METADATA.length,
      tools: MCP_TOOL_METADATA.map((t) => t.name),
    });
  });

  app.delete('/mcp', async (req: Request, res: Response) => {
    const mcpSessionId = req.headers['mcp-session-id'];
    if (typeof mcpSessionId === 'string' && mcpSessions.has(mcpSessionId)) {
      const entry = mcpSessions.get(mcpSessionId)!;
      await entry.transport.handleRequest(req, res);
      await entry.server.close();
      mcpSessions.delete(mcpSessionId);
      return;
    }
    res.status(404).json({ error: 'MCP session not found' });
  });

  // Legacy HTTP+SSE MCP Endpoints (/sse + /messages) for broad Claude connector compatibility
  const sseSessions = new Map<
    string,
    { transport: SSEServerTransport; server: ReturnType<typeof createAssessCraftMcpServer> }
  >();

  app.get('/sse', async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization || '';
      const googleAccessToken = authHeader.replace(/^Bearer\s+/i, '').trim() || undefined;
      const publicBaseUrl = getPublicBaseUrl(req);

      const transport = new SSEServerTransport('/messages', res);
      const server = createAssessCraftMcpServer({ googleAccessToken, publicBaseUrl });
      sseSessions.set(transport.sessionId, { transport, server });

      res.on('close', () => {
        sseSessions.delete(transport.sessionId);
        void server.close();
      });

      await server.connect(transport);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Failed to open SSE MCP stream',
        });
      }
    }
  });

  app.post('/messages', async (req: Request, res: Response) => {
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
    const entry = sseSessions.get(sessionId);
    if (!entry) {
      res.status(404).json({ error: 'SSE MCP session not found' });
      return;
    }
    await entry.transport.handlePostMessage(req, res, req.body);
  });

  // Frontend Vite middleware (dev) or static dist serving (prod)
  const distDir = path.resolve(process.cwd(), 'dist');
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(distDir);

  if (isProd) {
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AssessCraft Universal server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start AssessCraft Universal server:', err);
  process.exit(1);
});
