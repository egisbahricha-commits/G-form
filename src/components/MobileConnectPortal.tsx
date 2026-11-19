import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { CheckCircle2, ExternalLink, Loader2, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  clearMcpAuthSession,
  fetchMcpAuthStatus,
  syncMcpAuthSession,
  type McpAuthBridgeStatus,
} from '../lib/api';

interface MobileConnectPortalProps {
  sessionId?: string;
  user: User | null;
  accessToken: string | null;
  onSignIn: () => Promise<void>;
  onRefresh: () => Promise<string | null>;
  onSignOut: () => Promise<void>;
  onOpenHub: () => void;
}

export const MobileConnectPortal: React.FC<MobileConnectPortalProps> = ({
  sessionId,
  user,
  accessToken,
  onSignIn,
  onRefresh,
  onSignOut,
  onOpenHub,
}) => {
  const [bridgeStatus, setBridgeStatus] = useState<McpAuthBridgeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const refreshStatus = async () => {
    try {
      const status = await fetchMcpAuthStatus(sessionId);
      setBridgeStatus(status);
    } catch {
      // Ignore transient status poll failures
    }
  };

  useEffect(() => {
    void refreshStatus();
  }, [sessionId]);

  useEffect(() => {
    if (!accessToken) return;
    setBusy(true);
    setErrorMsg(null);
    void syncMcpAuthSession(accessToken, sessionId)
      .then((res) => {
        setBridgeStatus(res);
      })
      .catch((err) => {
        setErrorMsg(
          err instanceof Error ? err.message : 'Gagal menyinkronkan otorisasi Google Forms.'
        );
      })
      .finally(() => setBusy(false));
  }, [accessToken, sessionId]);

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      await clearMcpAuthSession(sessionId);
      await onSignOut();
      setBridgeStatus({ connected: false });
    } finally {
      setBusy(false);
    }
  };

  const isConnected = Boolean(bridgeStatus?.connected);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-center px-4 py-8">
      <div className="max-w-md w-full mx-auto bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="space-y-1">
          <p className="text-xs font-mono uppercase tracking-wider text-blue-700">
            Remote MCP · OAuth Google Forms
          </p>
          <h1 className="font-display text-xl font-bold text-slate-900">
            Hubungkan Akun Google Forms ke Claude
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            Otorisasi satu ketukan dari HP atau browser ini agar Claude dapat membuat Google Form,
            mengaktifkan mode kuis, dan memasukkan soal secara langsung tanpa menyalin token manual.
          </p>
        </div>

        {sessionId && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-xs text-slate-700">
            Sesi MCP terkait: <span className="font-mono font-semibold text-slate-900">{sessionId}</span>
          </div>
        )}

        {errorMsg && (
          <div className="bg-red-50 border border-red-200 text-red-900 rounded-lg px-3.5 py-2.5 text-xs">
            {errorMsg}
          </div>
        )}

        {isConnected ? (
          <div className="space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2 text-emerald-900 font-semibold text-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                Google Forms Terhubung ke Agen Claude
              </div>
              <p className="text-xs text-emerald-900 leading-relaxed">
                Akun: <span className="font-medium">{bridgeStatus?.email || user?.email || 'Terotorisasi'}</span>
                {bridgeStatus?.expiresInSeconds
                  ? ` · Aktif ${Math.max(1, Math.round(bridgeStatus.expiresInSeconds / 60))} menit`
                  : ''}
              </p>
              <p className="text-xs text-emerald-800 leading-relaxed">
                Sekarang kembali ke aplikasi Claude Anda dan balas:{' '}
                <span className="font-semibold">&ldquo;Sudah terhubung, silakan lanjutkan buat Google Form.&rdquo;</span>
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void onRefresh()}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Perbarui Otorisasi
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleDisconnect()}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-50"
              >
                <LogOut className="w-3.5 h-3.5" />
                Putuskan
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs text-slate-700 space-y-1.5">
              <div className="flex items-center gap-2 font-semibold text-slate-900">
                <ShieldCheck className="w-4 h-4 text-blue-700 shrink-0" />
                Scope yang Diminta
              </div>
              <p className="font-mono text-[11px] text-slate-700">
                https://www.googleapis.com/auth/forms.body
              </p>
              <p className="text-slate-600">
                Hanya digunakan untuk membuat dan mengisi Google Form kuis atas persetujuan Anda.
              </p>
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => void onSignIn()}
              className="w-full inline-flex items-center justify-center gap-2.5 px-4 py-3 text-sm font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-50"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Hubungkan Akun Google (OAuth 2.0)
            </button>
          </div>
        )}

        <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
          <span>AssessCraft Remote MCP</span>
          <button
            type="button"
            onClick={onOpenHub}
            className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline"
          >
            Buka Konsol MCP <ExternalLink className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
};
