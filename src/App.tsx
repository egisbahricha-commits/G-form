import React, { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  AlertCircle,
  Loader2,
  LogOut,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  analyzeSession,
  ApiTokenExpiredError,
  clearMcpAuthSession,
  createNewSession,
  deleteSessionById,
  enrichSessionExplanations,
  extractSessionMaterialText,
  fetchSessions,
  generateSessionQuestions,
  publishToGoogleForms,
  removeSessionMaterial,
  syncMcpAuthSession,
  testCreateGoogleForm,
  updateSessionData,
  uploadSessionMaterials,
  validateSession,
  verifySessionAnswerKeys,
} from './lib/api';
import {
  initGoogleAuth,
  isAccessTokenExpiringSoon,
  refreshGoogleAccessToken,
  signInWithGoogleForms,
  signOutGoogle,
} from './lib/firebaseAuth';
import { MaterialWorkspace } from './components/MaterialWorkspace';
import { QuestionEditor } from './components/QuestionEditor';
import { GoogleFormPublisher } from './components/GoogleFormPublisher';
import { McpControlCenter } from './components/McpControlCenter';
import { MobileConnectPortal } from './components/MobileConnectPortal';
import { MobileUploadPortal } from './components/MobileUploadPortal';
import type {
  ExamQuestion,
  ExamSession,
  GenerationConfig,
  GoogleFormResult,
  ParticipantIdentityConfig,
} from './shared/types';

type ActiveTab = 'mcp' | 'studio' | 'editor' | 'publish';

export default function App() {
  const [pathname, setPathname] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.pathname : '/'
  );
  const [sessions, setSessions] = useState<ExamSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<ActiveTab>('mcp');
  const [loadingInit, setLoadingInit] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [infoBanner, setInfoBanner] = useState<string | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const urlSessionId =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('sessionId') || undefined
      : undefined;

  useEffect(() => {
    const unsubscribe = initGoogleAuth((authState) => {
      setUser(authState.user);
      setAccessToken(authState.accessToken);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    void syncMcpAuthSession(accessToken, urlSessionId).catch(() => {
      // Non-fatal background bridge sync; connect portal handles explicit error display
    });
  }, [accessToken, urlSessionId]);

  const loadAllSessions = useCallback(async (preferSessionId?: string) => {
    try {
      const list = await fetchSessions();
      if (list.length === 0) {
        const created = await createNewSession('Asesmen Evaluasi Multimodal');
        setSessions([created]);
        setActiveSessionId(created.id);
      } else {
        setSessions(list);
        setActiveSessionId((prev) => {
          if (preferSessionId && list.some((s) => s.id === preferSessionId)) {
            return preferSessionId;
          }
          if (prev && list.some((s) => s.id === prev)) {
            return prev;
          }
          return list[0].id;
        });
      }
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Gagal memuat daftar sesi.'
      );
    } finally {
      setLoadingInit(false);
    }
  }, []);

  useEffect(() => {
    void loadAllSessions();
  }, [loadAllSessions]);

  const activeSession =
    sessions.find((s) => s.id === activeSessionId) || sessions[0] || null;

  const replaceSessionInList = (updated: ExamSession) => {
    setSessions((prev) => {
      const exists = prev.some((s) => s.id === updated.id);
      if (!exists) return [updated, ...prev];
      return prev.map((s) => (s.id === updated.id ? updated : s));
    });
  };

  const handleGoogleSignIn = async () => {
    setErrorBanner(null);
    try {
      const res = await signInWithGoogleForms();
      setUser(res.user);
      setAccessToken(res.accessToken);
      await syncMcpAuthSession(res.accessToken, urlSessionId);
      setInfoBanner(
        `Terhubung ke Google Forms & Remote MCP sebagai ${res.user.email || 'pengguna'}.`
      );
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Autentikasi Google gagal.'
      );
    }
  };

  const handleGoogleRefresh = async (): Promise<string | null> => {
    setErrorBanner(null);
    try {
      const res = await refreshGoogleAccessToken();
      setUser(res.user);
      setAccessToken(res.accessToken);
      await syncMcpAuthSession(res.accessToken, urlSessionId);
      setInfoBanner(
        `Sesi Google OAuth diperbarui untuk ${res.user.email || 'pengguna'}.`
      );
      return res.accessToken;
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Gagal memperbarui otorisasi Google.'
      );
      return null;
    }
  };

  const handleGoogleSignOut = async () => {
    await clearMcpAuthSession(urlSessionId);
    await signOutGoogle();
    setUser(null);
    setAccessToken(null);
  };

  const ensureActiveToken = async (): Promise<string | null> => {
    if (accessToken && !isAccessTokenExpiringSoon()) {
      return accessToken;
    }
    return handleGoogleRefresh();
  };

  const handleCreateSession = async () => {
    setErrorBanner(null);
    setBusyAction('create-session');
    try {
      const created = await createNewSession('Ujian Evaluasi Multimodal Baru');
      replaceSessionInList(created);
      setActiveSessionId(created.id);
      setActiveTab('studio');
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Gagal membuat sesi baru.'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteSession = async (id: string) => {
    setErrorBanner(null);
    setBusyAction('delete-session');
    try {
      await deleteSessionById(id);
      await loadAllSessions();
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Gagal menghapus sesi.'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleUploadFiles = async (files: File[]) => {
    if (!activeSession) return;
    setErrorBanner(null);
    setInfoBanner(null);
    setBusyAction('upload');
    try {
      const updated = await uploadSessionMaterials(activeSession.id, { files });
      replaceSessionInList(updated);
      setInfoBanner(`${files.length} file materi berhasil ditambahkan.`);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Gagal mengunggah file materi.'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleAddTypedText = async (title: string, text: string) => {
    if (!activeSession) return;
    setErrorBanner(null);
    setInfoBanner(null);
    setBusyAction('upload');
    try {
      const updated = await uploadSessionMaterials(activeSession.id, {
        typedTitle: title,
        typedText: text,
      });
      replaceSessionInList(updated);
      setInfoBanner('Materi teks berhasil ditambahkan.');
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Gagal menambahkan materi teks.'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteMaterial = async (materialId: string) => {
    if (!activeSession) return;
    setErrorBanner(null);
    setBusyAction('delete-material');
    try {
      const updated = await removeSessionMaterial(activeSession.id, materialId);
      replaceSessionInList(updated);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Gagal menghapus materi.'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleExtractText = async (materialId?: string) => {
    if (!activeSession) return;
    setErrorBanner(null);
    setInfoBanner(null);
    setBusyAction('extract');
    try {
      const updated = await extractSessionMaterialText(activeSession.id, materialId);
      replaceSessionInList(updated);
      setInfoBanner('Ekstraksi teks & OCR multimodal selesai.');
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Gagal mengekstrak teks materi.'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleAnalyzeMaterials = async () => {
    if (!activeSession) return;
    setErrorBanner(null);
    setInfoBanner(null);
    setBusyAction('analyze');
    try {
      const { session: updated } = await analyzeSession(activeSession.id);
      replaceSessionInList(updated);
      setInfoBanner('Analisis materi multimodal selesai.');
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Gagal menganalisis materi.'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleUpdateConfig = async (config: Partial<GenerationConfig>) => {
    if (!activeSession) return;
    try {
      const updated = await updateSessionData(activeSession.id, { config });
      replaceSessionInList(updated);
    } catch {
      // Keep UI responsive on silent background config sync
    }
  };

  const handleGenerateQuestions = async (config: GenerationConfig) => {
    if (!activeSession) return;
    setErrorBanner(null);
    setInfoBanner(null);
    setBusyAction('generate');
    try {
      const updated = await generateSessionQuestions(activeSession.id, config);
      replaceSessionInList(updated);
      setInfoBanner(
        `${updated.questions.length} soal berhasil dibuat. Silakan tinjau atau edit sebelum publikasi.`
      );
      setActiveTab('editor');
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Gagal membuat soal dengan Gemini.'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleQuestionsChange = async (questions: ExamQuestion[]) => {
    if (!activeSession) return;
    const optimistic = { ...activeSession, questions };
    replaceSessionInList(optimistic);
    try {
      const updated = await updateSessionData(activeSession.id, { questions });
      replaceSessionInList(updated);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Gagal menyimpan perubahan soal.'
      );
    }
  };

  const handleValidate = async () => {
    if (!activeSession) return;
    setErrorBanner(null);
    setBusyAction('validate');
    try {
      const { session: updated } = await validateSession(activeSession.id);
      replaceSessionInList(updated);
      setInfoBanner(
        updated.validation?.valid
          ? 'Validasi kualitas soal lolos sepenuhnya.'
          : 'Pemeriksaan kualitas selesai. Tinjau catatan validasi di atas.'
      );
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Gagal memvalidasi kualitas soal.'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleVerifyAnswerKeys = async () => {
    if (!activeSession) return;
    setErrorBanner(null);
    setBusyAction('verify-keys');
    try {
      const updated = await verifySessionAnswerKeys(activeSession.id);
      replaceSessionInList(updated);
      setInfoBanner('Kunci jawaban selesai diverifikasi terhadap materi sumber.');
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Gagal memverifikasi kunci jawaban.'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleEnrichExplanations = async () => {
    if (!activeSession) return;
    setErrorBanner(null);
    setBusyAction('explanations');
    try {
      const updated = await enrichSessionExplanations(activeSession.id);
      replaceSessionInList(updated);
      setInfoBanner('Pembahasan dan indikator kompetensi soal berhasil diperkaya.');
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Gagal memperkaya pembahasan.'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleUpdateMeta = async (payload: {
    title?: string;
    description?: string;
    participantIdentity?: Partial<ParticipantIdentityConfig>;
  }) => {
    if (!activeSession) return;
    try {
      const updated = await updateSessionData(activeSession.id, payload);
      replaceSessionInList(updated);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Gagal memperbarui metadata formulir.'
      );
    }
  };

  const handleTestGoogleForm = async (): Promise<GoogleFormResult | null> => {
    setErrorBanner(null);
    setInfoBanner(null);
    setBusyAction('test-form');
    try {
      const token = await ensureActiveToken();
      if (!token) return null;

      try {
        const res = await testCreateGoogleForm(token);
        setInfoBanner(
          `Uji Google Form berhasil dibuat untuk akun ${res.verifiedEmail || user?.email || 'terotorisasi'}.`
        );
        return res.googleForm;
      } catch (err) {
        if (err instanceof ApiTokenExpiredError) {
          const refreshedToken = await handleGoogleRefresh();
          if (!refreshedToken) return null;
          const retried = await testCreateGoogleForm(refreshedToken);
          setInfoBanner(
            `Sesi diperbarui dan uji Google Form berhasil dibuat untuk ${retried.verifiedEmail || 'akun Anda'}.`
          );
          return retried.googleForm;
        }
        throw err;
      }
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Gagal menguji pembuatan Google Form.'
      );
      return null;
    } finally {
      setBusyAction(null);
    }
  };

  const handlePublishForm = async (payload: {
    approved: boolean;
    title: string;
    description: string;
    participantIdentity: ParticipantIdentityConfig;
  }) => {
    if (!activeSession) return;
    setErrorBanner(null);
    setInfoBanner(null);
    setBusyAction('publish');
    try {
      const token = await ensureActiveToken();
      if (!token) return;

      try {
        const { session: updated } = await publishToGoogleForms(
          activeSession.id,
          token,
          payload
        );
        replaceSessionInList(updated);
        setInfoBanner('Google Form kuis berhasil dibuat dan siap dibagikan.');
      } catch (err) {
        if (err instanceof ApiTokenExpiredError) {
          const refreshedToken = await handleGoogleRefresh();
          if (!refreshedToken) return;
          const { session: updated } = await publishToGoogleForms(
            activeSession.id,
            refreshedToken,
            payload
          );
          replaceSessionInList(updated);
          setInfoBanner('Sesi OAuth diperbarui dan Google Form kuis berhasil dibuat.');
          return;
        }
        throw err;
      }
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Gagal mempublikasikan Google Form.'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const navigateToHub = () => {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/');
      setPathname('/');
    }
    setActiveTab('mcp');
  };

  if (pathname === '/connect') {
    return (
      <MobileConnectPortal
        sessionId={urlSessionId}
        user={user}
        accessToken={accessToken}
        onSignIn={handleGoogleSignIn}
        onRefresh={handleGoogleRefresh}
        onSignOut={handleGoogleSignOut}
        onOpenHub={navigateToHub}
      />
    );
  }

  if (pathname === '/upload') {
    return (
      <MobileUploadPortal
        initialSessionId={urlSessionId}
        onOpenHub={navigateToHub}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Bar Contract: Exactly 3 zones separated by gap-8 */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4 sm:gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('mcp');
            }}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            AssessCraft MCP
          </a>

          {/* Zone 2: 4 Clean Single-Line Nav Links */}
          <nav className="flex items-center gap-4 sm:gap-6 overflow-x-auto">
            {(
              [
                ['mcp', 'Remote MCP Hub'],
                ['studio', 'Inspeksi Materi'],
                ['editor', 'Pratinjau Soal'],
                ['publish', 'Google Forms'],
              ] as Array<[ActiveTab, string]>
            ).map(([tabKey, label]) => {
              const isActive = activeTab === tabKey;
              return (
                <button
                  key={tabKey}
                  type="button"
                  onClick={() => setActiveTab(tabKey)}
                  className={`py-5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'border-blue-700 text-slate-900'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 Primary Auth Action */}
          <div className="shrink-0">
            {accessToken && user ? (
              <button
                type="button"
                onClick={() => void handleGoogleSignOut()}
                title={`Masuk sebagai ${user.email || 'Akun Google'} — klik untuk keluar`}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <span className="max-w-[120px] sm:max-w-[160px] truncate">
                  {user.email || user.displayName}
                </span>
                <LogOut className="w-3.5 h-3.5 text-slate-500" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleGoogleSignIn()}
                className="gsi-material-button"
              >
                <div className="gsi-material-button-content-wrapper">
                  <div className="gsi-material-button-icon">
                    <svg
                      version="1.1"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 48 48"
                      style={{ display: 'block' }}
                    >
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      />
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      />
                    </svg>
                  </div>
                  <span className="gsi-material-button-contents">Sign in with Google</span>
                </div>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Session Workspace Toolbar */}
        {activeSession && (
          <div className="bg-white border border-slate-200 rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3 min-w-0 flex-1">
              <label htmlFor="session-select" className="text-xs font-semibold text-slate-600 shrink-0">
                Sesi Asesmen:
              </label>
              <select
                id="session-select"
                value={activeSession.id}
                onChange={(e) => setActiveSessionId(e.target.value)}
                className="max-w-xs px-3 py-1.5 text-sm font-medium bg-slate-50 border border-slate-300 rounded-lg text-slate-900 truncate"
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} ({s.questions.length} soal)
                  </option>
                ))}
              </select>
              <span className="text-xs font-mono text-slate-500 hidden sm:inline">
                {activeSession.id}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void handleCreateSession()}
                disabled={busyAction !== null}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                Sesi Baru
              </button>
              {sessions.length > 1 && (
                <button
                  type="button"
                  onClick={() => void handleDeleteSession(activeSession.id)}
                  disabled={busyAction !== null}
                  title="Hapus sesi ini"
                  className="p-1.5 text-slate-500 hover:text-red-700 border border-slate-200 rounded-lg hover:bg-red-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Notifications */}
        {errorBanner && (
          <div
            role="alert"
            className="flex items-start justify-between gap-3 bg-red-50 border border-red-200 text-red-900 rounded-xl px-4 py-3 text-sm"
          >
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
              <span>{errorBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              className="text-red-700 hover:text-red-900"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {infoBanner && (
          <div className="flex items-start justify-between gap-3 bg-blue-50 border border-blue-200 text-blue-950 rounded-xl px-4 py-3 text-sm">
            <span>{infoBanner}</span>
            <button
              type="button"
              onClick={() => setInfoBanner(null)}
              className="text-blue-700 hover:text-blue-950"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {loadingInit || !activeSession ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 flex items-center justify-center gap-3 text-sm text-slate-600">
            <Loader2 className="w-5 h-5 animate-spin text-blue-700" />
            Memuat ruang kerja asesmen multimodal...
          </div>
        ) : (
          <>
            {activeTab === 'studio' && (
              <MaterialWorkspace
                session={activeSession}
                busyAction={busyAction}
                onUploadFiles={handleUploadFiles}
                onAddTypedText={handleAddTypedText}
                onDeleteMaterial={handleDeleteMaterial}
                onExtractText={handleExtractText}
                onAnalyzeMaterials={handleAnalyzeMaterials}
                onUpdateConfig={handleUpdateConfig}
                onGenerateQuestions={handleGenerateQuestions}
              />
            )}

            {activeTab === 'editor' && (
              <QuestionEditor
                session={activeSession}
                busyAction={busyAction}
                onQuestionsChange={handleQuestionsChange}
                onValidate={handleValidate}
                onVerifyAnswerKeys={handleVerifyAnswerKeys}
                onEnrichExplanations={handleEnrichExplanations}
                onProceedToPublish={() => setActiveTab('publish')}
              />
            )}

            {activeTab === 'publish' && (
              <GoogleFormPublisher
                session={activeSession}
                user={user}
                accessToken={accessToken}
                busyAction={busyAction}
                onSignIn={handleGoogleSignIn}
                onRefreshToken={async () => {
                  await handleGoogleRefresh();
                }}
                onUpdateMeta={handleUpdateMeta}
                onTestForm={handleTestGoogleForm}
                onPublishForm={handlePublishForm}
              />
            )}

            {activeTab === 'mcp' && (
              <McpControlCenter
                session={activeSession}
                user={user}
                accessToken={accessToken}
                onSignIn={handleGoogleSignIn}
                onRefreshToken={handleGoogleRefresh}
                onRefreshSession={() => loadAllSessions(activeSession.id)}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
