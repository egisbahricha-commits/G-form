import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileCheck2,
  FlaskConical,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { verifyGoogleTokenStatus, type GoogleTokenStatusResponse } from '../lib/api';
import type {
  ExamSession,
  GoogleFormResult,
  ParticipantIdentityConfig,
} from '../shared/types';

interface GoogleFormPublisherProps {
  session: ExamSession;
  user: User | null;
  accessToken: string | null;
  busyAction: string | null;
  onSignIn: () => Promise<void>;
  onRefreshToken: () => Promise<void>;
  onUpdateMeta: (payload: {
    title?: string;
    description?: string;
    participantIdentity?: Partial<ParticipantIdentityConfig>;
  }) => Promise<void>;
  onTestForm: () => Promise<GoogleFormResult | null>;
  onPublishForm: (payload: {
    approved: boolean;
    title: string;
    description: string;
    participantIdentity: ParticipantIdentityConfig;
  }) => Promise<void>;
}

export const GoogleFormPublisher: React.FC<GoogleFormPublisherProps> = ({
  session,
  user,
  accessToken,
  busyAction,
  onSignIn,
  onRefreshToken,
  onUpdateMeta,
  onTestForm,
  onPublishForm,
}) => {
  const [title, setTitle] = useState(session.title);
  const [description, setDescription] = useState(session.description);
  const [identity, setIdentity] = useState<ParticipantIdentityConfig>(
    session.participantIdentity
  );
  const [newCustomField, setNewCustomField] = useState('');
  const [approvalChecked, setApprovalChecked] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [confirmTestModalOpen, setConfirmTestModalOpen] = useState(false);
  const [testResult, setTestResult] = useState<GoogleFormResult | null>(null);
  const [tokenStatus, setTokenStatus] = useState<GoogleTokenStatusResponse | null>(null);
  const [checkingToken, setCheckingToken] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    setTitle(session.title);
    setDescription(session.description);
    setIdentity(session.participantIdentity);
    setApprovalChecked(false);
  }, [session.id, session.title, session.description, session.participantIdentity]);

  useEffect(() => {
    if (!accessToken) {
      setTokenStatus(null);
      return;
    }
    let cancelled = false;
    setCheckingToken(true);
    void verifyGoogleTokenStatus(accessToken)
      .then((res) => {
        if (!cancelled) setTokenStatus(res);
      })
      .catch(() => {
        if (!cancelled) setTokenStatus({ valid: false, hasFormsScope: false, scopes: [] });
      })
      .finally(() => {
        if (!cancelled) setCheckingToken(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const totalPoints = session.questions.reduce(
    (acc, q) => acc + (Number(q.points) || 0),
    0
  );

  const handleCopy = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 1800);
  };

  const handleAddCustomField = () => {
    const clean = newCustomField.trim();
    if (!clean) return;
    const next = {
      ...identity,
      customFields: [...(identity.customFields || []), clean],
    };
    setIdentity(next);
    setNewCustomField('');
    void onUpdateMeta({ participantIdentity: next });
  };

  const handleConfirmPublish = async () => {
    setConfirmModalOpen(false);
    await onPublishForm({
      approved: true,
      title: title.trim() || session.title,
      description: description.trim(),
      participantIdentity: identity,
    });
  };

  const handleConfirmTestForm = async () => {
    setConfirmTestModalOpen(false);
    const created = await onTestForm();
    if (created) {
      setTestResult(created);
    }
  };

  const isOAuthReady = Boolean(accessToken && (!tokenStatus || tokenStatus.valid));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left: Google OAuth Connection + Configuration & Approval Gate */}
      <div className="lg:col-span-7 space-y-6">
        {/* Mobile-Friendly Google OAuth 2.0 Connection Card */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Koneksi Google OAuth 2.0 (Google Forms)
              </h2>
              <p className="text-sm text-slate-600 mt-0.5">
                Hubungkan akun Google Anda melalui halaman persetujuan resmi Google — tanpa menempelkan token manual.
              </p>
            </div>
            {checkingToken && (
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Memeriksa izin...
              </span>
            )}
          </div>

          {isOAuthReady ? (
            <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <ShieldCheck className="w-5 h-5 text-emerald-700 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-emerald-950 truncate">
                      {tokenStatus?.email || user?.email || 'Akun Google Terhubung'}
                    </p>
                    <p className="text-xs text-emerald-800">
                      Izin Google Forms (forms.body) aktif
                      {tokenStatus?.expiresInSeconds
                        ? ` · Masa aktif sesi ~${Math.max(1, Math.round(tokenStatus.expiresInSeconds / 60))} menit`
                        : ''}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => void onRefreshToken()}
                    disabled={busyAction !== null}
                    className="flex-1 sm:flex-initial min-h-[44px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Perbarui Izin
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmTestModalOpen(true)}
                    disabled={busyAction !== null}
                    className="flex-1 sm:flex-initial min-h-[44px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-blue-800 bg-white border border-blue-300 rounded-lg hover:bg-blue-50 whitespace-nowrap"
                  >
                    {busyAction === 'test-form' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FlaskConical className="w-3.5 h-3.5" />
                    )}
                    Uji Buat Google Form
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-2.5 text-xs text-slate-700 leading-relaxed">
                <Lock className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-slate-900">
                    {user
                      ? `Sesi Google Forms untuk ${user.email || 'akun Anda'} perlu diperbarui`
                      : 'Akun Google belum terhubung'}
                  </p>
                  <p className="mt-0.5">
                    Ketuk tombol di samping untuk membuka halaman persetujuan Google OAuth. Mendukung browser HP maupun desktop dan otomatis memperbarui izin bila kedaluwarsa.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void (user ? onRefreshToken() : onSignIn())}
                className="gsi-material-button min-h-[44px] w-full sm:w-auto shrink-0"
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
                  <span className="gsi-material-button-contents">
                    {user ? 'Perbarui Izin Google' : 'Hubungkan Akun Google'}
                  </span>
                </div>
              </button>
            </div>
          )}

          {testResult && (
            <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200 space-y-2 text-xs">
              <div className="flex items-center gap-2 font-semibold text-blue-950">
                <CheckCircle2 className="w-4 h-4 text-blue-700" />
                Uji Pembuatan Google Form Berhasil
              </div>
              <p className="text-blue-900">
                Form uji <span className="font-semibold">{testResult.title}</span> berhasil dibuat dengan mode kuis aktif.
              </p>
              <div className="flex flex-wrap gap-3 pt-1">
                <a
                  href={testResult.responderUri}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline"
                >
                  Buka Link Peserta
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <a
                  href={testResult.editUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline"
                >
                  Buka Editor Form
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          )}
        </section>

        {/* Form Metadata, Participant Identity & Approval Gate */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Konfigurasi Publikasi Ujian
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              Sistem akan membuat Google Form baru, mengaktifkan mode kuis, menambahkan identitas peserta, serta memasukkan seluruh pertanyaan, kunci jawaban, dan bobot poin.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Judul Google Form
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => void onUpdateMeta({ title })}
                className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Deskripsi &amp; Petunjuk Pengerjaan
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => void onUpdateMeta({ description })}
                className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            {/* Participant Identity Config */}
            <div className="pt-4 border-t border-slate-200 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Identitas Peserta (Ditambahkan di Awal Formulir)
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <label className="flex items-center gap-2.5 p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs font-medium text-slate-800 cursor-pointer min-h-[44px]">
                  <input
                    type="checkbox"
                    checked={identity.includeFullName}
                    onChange={(e) => {
                      const next = { ...identity, includeFullName: e.target.checked };
                      setIdentity(next);
                      void onUpdateMeta({ participantIdentity: next });
                    }}
                    className="h-4 w-4 rounded text-blue-700"
                  />
                  Nama Lengkap
                </label>

                <label className="flex items-center gap-2.5 p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs font-medium text-slate-800 cursor-pointer min-h-[44px]">
                  <input
                    type="checkbox"
                    checked={identity.includeParticipantId}
                    onChange={(e) => {
                      const next = { ...identity, includeParticipantId: e.target.checked };
                      setIdentity(next);
                      void onUpdateMeta({ participantIdentity: next });
                    }}
                    className="h-4 w-4 rounded text-blue-700"
                  />
                  Nomor Induk / ID
                </label>

                <label className="flex items-center gap-2.5 p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs font-medium text-slate-800 cursor-pointer min-h-[44px]">
                  <input
                    type="checkbox"
                    checked={identity.includeClassOrOrg}
                    onChange={(e) => {
                      const next = { ...identity, includeClassOrOrg: e.target.checked };
                      setIdentity(next);
                      void onUpdateMeta({ participantIdentity: next });
                    }}
                    className="h-4 w-4 rounded text-blue-700"
                  />
                  Kelas / Instansi
                </label>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newCustomField}
                  onChange={(e) => setNewCustomField(e.target.value)}
                  placeholder="Tambah kolom identitas lain (misal: Email Peserta / Departemen)"
                  className="flex-1 px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                />
                <button
                  type="button"
                  onClick={handleAddCustomField}
                  className="min-h-[40px] inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Tambah
                </button>
              </div>

              {identity.customFields && identity.customFields.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {identity.customFields.map((field, idx) => (
                    <div
                      key={idx}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-slate-100 border border-slate-200 rounded-md text-slate-800"
                    >
                      <span>{field}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const next = {
                            ...identity,
                            customFields: identity.customFields!.filter((_, i) => i !== idx),
                          };
                          setIdentity(next);
                          void onUpdateMeta({ participantIdentity: next });
                        }}
                        className="text-slate-500 hover:text-red-700"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Explicit Approval Gate */}
            <div className="pt-4 border-t border-slate-200 space-y-4">
              <label className="flex items-start gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={approvalChecked}
                  onChange={(e) => setApprovalChecked(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded text-blue-700"
                />
                <div className="text-xs text-slate-700 leading-relaxed">
                  <strong className="text-slate-900 block text-sm mb-0.5">
                    Persetujuan Publikasi Pengguna
                  </strong>
                  Saya telah meninjau pratinjau {session.questions.length} soal (total{' '}
                  <span className="font-mono font-semibold tabular-nums">{totalPoints}</span>{' '}
                  poin), kunci jawaban, dan identitas peserta, serta menyetujui pembuatan formulir kuis di akun Google saya.
                </div>
              </label>

              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmModalOpen(true)}
                  disabled={
                    busyAction !== null ||
                    !isOAuthReady ||
                    !approvalChecked ||
                    session.questions.length === 0
                  }
                  className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
                >
                  {busyAction === 'publish' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  Buat &amp; Publikasikan Google Form
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Right: Summary & Published Form Links */}
      <aside className="lg:col-span-5 space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h3 className="text-base font-semibold text-slate-900">
            Ringkasan Kuis Siap Ekspor
          </h3>
          <dl className="divide-y divide-slate-200 text-sm">
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-600">Status OAuth Google</dt>
              <dd className="font-semibold text-slate-900">
                {isOAuthReady ? 'Terhubung' : 'Menunggu Login'}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-600">Mode Formulir</dt>
              <dd className="font-semibold text-slate-900">Kuis Otomatis (isQuiz)</dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-600">Jumlah Butir Soal</dt>
              <dd className="font-mono tabular-nums font-semibold text-slate-900">
                {session.questions.length}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-600">Total Bobot Poin</dt>
              <dd className="font-mono tabular-nums font-semibold text-slate-900">
                {totalPoints}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-600">Validasi Kualitas</dt>
              <dd className="font-semibold text-slate-900">
                {session.validation?.valid ? 'Tervalidasi' : 'Siap Ditinjau'}
              </dd>
            </div>
          </dl>
        </div>

        {session.googleForm && (
          <div className="bg-white border border-emerald-300 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-emerald-800">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <h3 className="text-base font-semibold">
                Google Form Berhasil Dibuat
              </h3>
            </div>
            <p className="text-xs text-slate-600">
              Mode kuis aktif · {session.googleForm.totalQuestions} soal ·{' '}
              <span className="font-mono tabular-nums">
                {session.googleForm.totalPoints}
              </span>{' '}
              poin
            </p>

            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold text-slate-700 mb-1">
                  Link Formulir (Untuk Peserta)
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={session.googleForm.responderUri}
                    className="flex-1 px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-800"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      void handleCopy('responder', session.googleForm!.responderUri)
                    }
                    className="min-h-[40px] min-w-[40px] flex items-center justify-center p-2 border border-slate-300 rounded-lg hover:bg-slate-50"
                    title="Salin link formulir"
                  >
                    {copiedField === 'responder' ? (
                      <Check className="w-4 h-4 text-emerald-700" />
                    ) : (
                      <Copy className="w-4 h-4 text-slate-700" />
                    )}
                  </button>
                  <a
                    href={session.googleForm.responderUri}
                    target="_blank"
                    rel="noreferrer"
                    className="min-h-[40px] min-w-[40px] flex items-center justify-center p-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-blue-700"
                    title="Buka formulir"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-700 mb-1">
                  Link Edit (Untuk Pembuat Soal)
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={session.googleForm.editUrl}
                    className="flex-1 px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-800"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      void handleCopy('edit', session.googleForm!.editUrl)
                    }
                    className="min-h-[40px] min-w-[40px] flex items-center justify-center p-2 border border-slate-300 rounded-lg hover:bg-slate-50"
                    title="Salin link edit"
                  >
                    {copiedField === 'edit' ? (
                      <Check className="w-4 h-4 text-emerald-700" />
                    ) : (
                      <Copy className="w-4 h-4 text-slate-700" />
                    )}
                  </button>
                  <a
                    href={session.googleForm.editUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="min-h-[40px] min-w-[40px] flex items-center justify-center p-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-blue-700"
                    title="Buka editor Google Form"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* Mandatory Explicit Confirmation Dialog before Google Forms Write */}
      {confirmModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-2.5 text-slate-900">
              <FileCheck2 className="w-5 h-5 text-blue-700 shrink-0" />
              <h3 className="text-base font-semibold">
                Konfirmasi Pembuatan Google Form
              </h3>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed">
              Aplikasi akan membuat formulir kuis baru di Google Drive/Forms Anda dengan judul{' '}
              <strong className="text-slate-900">&ldquo;{title}&rdquo;</strong> berisi bagian identitas peserta,{' '}
              <strong className="font-mono tabular-nums">{session.questions.length}</strong>{' '}
              pertanyaan, kunci jawaban, dan total{' '}
              <strong className="font-mono tabular-nums">{totalPoints}</strong> poin.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmModalOpen(false)}
                className="min-h-[40px] px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmPublish()}
                className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800"
              >
                Setuju &amp; Buat Google Form
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Explicit Confirmation Dialog for Test Google Form Creation */}
      {confirmTestModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-2.5 text-slate-900">
              <FlaskConical className="w-5 h-5 text-blue-700 shrink-0" />
              <h3 className="text-base font-semibold">
                Konfirmasi Uji Pembuatan Google Form
              </h3>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed">
              Sistem akan membuat 1 formulir uji berjudul{' '}
              <strong className="text-slate-900">
                Uji Koneksi Google Forms — AssessCraft
              </strong>{' '}
              di akun Google Anda ({tokenStatus?.email || user?.email || 'terotorisasi'}) untuk membuktikan pembuatan kuis, kunci jawaban, dan tautan form berjalan nyata.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmTestModalOpen(false)}
                className="min-h-[40px] px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmTestForm()}
                className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800"
              >
                Buat Form Uji Sekarang
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
