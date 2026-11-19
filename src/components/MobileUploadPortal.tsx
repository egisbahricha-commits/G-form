import React, { useState } from 'react';
import { Check, Copy, ExternalLink, FileUp, Loader2, Upload } from 'lucide-react';
import { quickUploadMaterials } from '../lib/api';

interface MobileUploadPortalProps {
  initialSessionId?: string;
  onOpenHub: () => void;
}

export const MobileUploadPortal: React.FC<MobileUploadPortalProps> = ({
  initialSessionId,
  onOpenHub,
}) => {
  const [sessionId, setSessionId] = useState<string>(initialSessionId || '');
  const [title, setTitle] = useState<string>('');
  const [files, setFiles] = useState<File[]>([]);
  const [typedText, setTypedText] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [uploadedCount, setUploadedCount] = useState<number>(0);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0 && !typedText.trim()) {
      setErrorMsg('Pilih minimal satu file materi (foto/PDF/DOCX/PPTX/TXT) atau ketik teks.');
      return;
    }

    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await quickUploadMaterials({
        sessionId: sessionId.trim() || undefined,
        title: title.trim() || undefined,
        files,
        typedText: typedText.trim() || undefined,
      });
      setSessionId(res.sessionId);
      setUploadedCount(res.session.materials.length);
      setFiles([]);
      setTypedText('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengunggah materi.');
    } finally {
      setBusy(false);
    }
  };

  const claudePrompt = sessionId
    ? `Analisa materi pada sessionId "${sessionId}" dengan analyze_material, buatkan 40 soal pilihan ganda, tampilkan pratinjau untuk saya setujui, lalu masukkan ke Google Form baru.`
    : '';

  const copyPrompt = async () => {
    if (!claudePrompt) return;
    await navigator.clipboard.writeText(claudePrompt);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 1800);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-center px-4 py-8">
      <div className="max-w-lg w-full mx-auto bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="space-y-1">
          <p className="text-xs font-mono uppercase tracking-wider text-blue-700">
            Remote MCP · Portal Unggah Materi
          </p>
          <h1 className="font-display text-xl font-bold text-slate-900">
            Unggah Foto, PDF, DOCX, PPTX, atau Teks untuk Claude
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            Gunakan portal ini jika Anda ingin mengirim file berukuran besar atau banyak dokumen sekaligus
            dari HP/laptop, lalu teruskan <span className="font-mono">sessionId</span> ke Claude.
          </p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Judul Asesmen (Opsional)
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Contoh: Ujian Harian Biologi Sel"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Pilih File (JPG, PNG, WEBP, PDF, DOCX, PPTX, TXT)
            </label>
            <label className="flex flex-col items-center justify-center gap-2 border border-dashed border-slate-300 rounded-lg p-5 bg-slate-50 hover:bg-slate-100 cursor-pointer text-center">
              <FileUp className="w-5 h-5 text-blue-700" />
              <span className="text-xs font-medium text-slate-800">
                {files.length > 0
                  ? `${files.length} file dipilih: ${files.map((f) => f.name).join(', ')}`
                  : 'Ketuk untuk memilih satu atau beberapa file sekaligus'}
              </span>
              <input
                type="file"
                multiple
                accept=".jpg,.jpeg,.png,.webp,.pdf,.docx,.pptx,.txt,.md,.csv"
                className="hidden"
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
              />
            </label>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Atau Ketik / Tempel Materi Langsung
            </label>
            <textarea
              rows={4}
              value={typedText}
              onChange={(e) => setTypedText(e.target.value)}
              placeholder="Tempel ringkasan bab, artikel, atau catatan materi..."
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          {errorMsg && (
            <div className="bg-red-50 border border-red-200 text-red-900 rounded-lg px-3.5 py-2.5 text-xs">
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Unggah ke Sesi MCP
          </button>
        </form>

        {uploadedCount > 0 && sessionId && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 space-y-3">
            <p className="text-xs font-semibold text-emerald-950">
              Berhasil! {uploadedCount} materi tersimpan di sesi{' '}
              <span className="font-mono">{sessionId}</span>.
            </p>
            <p className="text-xs text-emerald-900">
              Salin perintah ini lalu kirim ke Claude AI:
            </p>
            <div className="bg-white border border-emerald-200 rounded-lg p-2.5 text-xs font-mono text-slate-800">
              {claudePrompt}
            </div>
            <button
              type="button"
              onClick={() => void copyPrompt()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-900 bg-white border border-emerald-300 rounded-lg hover:bg-emerald-100"
            >
              {copiedPrompt ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedPrompt ? 'Perintah Tersalin' : 'Salin Perintah untuk Claude'}
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
