import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Eye,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Layers,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  DifficultyLevel,
  ExamSession,
  GenerationConfig,
  MaterialFile,
  QuestionType,
} from '../shared/types';
import { QUESTION_TYPE_LABELS } from '../shared/types';

interface MaterialWorkspaceProps {
  session: ExamSession;
  busyAction: string | null;
  onUploadFiles: (files: File[]) => Promise<void>;
  onAddTypedText: (title: string, text: string) => Promise<void>;
  onDeleteMaterial: (materialId: string) => Promise<void>;
  onExtractText: (materialId?: string) => Promise<void>;
  onAnalyzeMaterials: () => Promise<void>;
  onUpdateConfig: (config: Partial<GenerationConfig>) => Promise<void>;
  onGenerateQuestions: (config: GenerationConfig) => Promise<void>;
}

const ALL_QUESTION_TYPES: QuestionType[] = [
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

const EDUCATION_LEVEL_PRESETS = [
  'Universal (Otomatis dari materi)',
  'SD / MI',
  'SMP / MTs',
  'SMA / MA / SMK',
  'Perguruan Tinggi (S1 / S2 / Vokasi)',
  'Pelatihan & Sertifikasi Profesional',
  'Pengetahuan Umum / Kompetisi',
  'Kustom',
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const MaterialWorkspace: React.FC<MaterialWorkspaceProps> = ({
  session,
  busyAction,
  onUploadFiles,
  onAddTypedText,
  onDeleteMaterial,
  onExtractText,
  onAnalyzeMaterials,
  onUpdateConfig,
  onGenerateQuestions,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [typedTitle, setTypedTitle] = useState('');
  const [typedText, setTypedText] = useState('');
  const [inspectMaterial, setInspectMaterial] = useState<MaterialFile | null>(null);
  const [localConfig, setLocalConfig] = useState<GenerationConfig>(session.config);

  // Sync localConfig when switching sessions
  React.useEffect(() => {
    setLocalConfig(session.config);
  }, [session.id, session.config]);

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    await onUploadFiles(Array.from(fileList));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await onUploadFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleTypedSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!typedText.trim()) return;
    await onAddTypedText(typedTitle, typedText);
    setTypedTitle('');
    setTypedText('');
  };

  const toggleQuestionType = (type: QuestionType) => {
    const exists = localConfig.questionTypes.includes(type);
    let next: QuestionType[];
    if (exists) {
      next = localConfig.questionTypes.filter((t) => t !== type);
      if (next.length === 0) return;
    } else {
      next = [...localConfig.questionTypes, type];
    }
    const updated = { ...localConfig, questionTypes: next };
    setLocalConfig(updated);
    void onUpdateConfig({ questionTypes: next });
  };

  const unreadableMaterials = session.materials.filter(
    (m) => m.readabilityStatus === 'unreadable' || m.readabilityStatus === 'partially_unreadable'
  );

  const hasUnreadableAnalysis =
    session.analysis &&
    (!session.analysis.isReadable || session.analysis.unreadableFiles.length > 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left Column: Multimodal Material Ingestion & Analysis */}
      <div className="lg:col-span-7 space-y-6">
        {/* Upload Zone */}
        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                1. Sumber Materi Multimodal
              </h2>
              <p className="text-sm text-slate-600 mt-0.5">
                Unggah satu atau banyak file sekaligus (JPG, PNG, WEBP, PDF, DOCX, PPTX, TXT) atau ketik materi langsung.
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {session.materials.length} materi terlampir
            </span>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            className={`border border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
              dragActive
                ? 'border-blue-600 bg-blue-50/60'
                : 'border-slate-300 bg-slate-50/60 hover:border-slate-400 hover:bg-slate-50'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".jpg,.jpeg,.png,.webp,.pdf,.docx,.pptx,.txt,.md,.csv,image/jpeg,image/png,image/webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain"
              className="hidden"
              onChange={(e) => void handleFilesSelected(e.target.files)}
            />
            <div className="mx-auto w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-700 mb-3">
              {busyAction === 'upload' ? (
                <Loader2 className="w-5 h-5 animate-spin text-blue-700" />
              ) : (
                <Upload className="w-5 h-5" />
              )}
            </div>
            <p className="text-sm font-semibold text-slate-900">
              Tarik &amp; lepas file ke sini, atau klik untuk memilih banyak file
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Mendukung foto buku/papan tulis/diagram (JPG, JPEG, PNG, WEBP), PDF, Word DOCX, PowerPoint PPTX, dan TXT (maks. 25 MB/file).
            </p>
          </div>

          {/* Direct Typed Material */}
          <form onSubmit={handleTypedSubmit} className="mt-5 pt-5 border-t border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <label htmlFor="typed-material-text" className="text-sm font-semibold text-slate-800">
                Atau ketik / tempel materi langsung
              </label>
            </div>
            <input
              type="text"
              value={typedTitle}
              onChange={(e) => setTypedTitle(e.target.value)}
              placeholder="Judul catatan materi (opsional, misal: Bab 3 Termodinamika)"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
            />
            <textarea
              id="typed-material-text"
              rows={4}
              value={typedText}
              onChange={(e) => setTypedText(e.target.value)}
              placeholder="Tempelkan ringkasan bab, artikel, studi kasus, transkrip, atau catatan materi apa pun dari bidang apa pun..."
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
            />
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={busyAction !== null || typedText.trim().length < 10}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                Tambahkan Materi Teks
              </button>
            </div>
          </form>

          {/* Uploaded Material List */}
          {session.materials.length > 0 && (
            <div className="mt-6 pt-5 border-t border-slate-200 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  Daftar Materi Terunggah
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void onExtractText()}
                    disabled={busyAction !== null}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {busyAction === 'extract' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FileText className="w-3.5 h-3.5" />
                    )}
                    Ekstrak OCR &amp; Teks
                  </button>
                  <button
                    type="button"
                    onClick={() => void onAnalyzeMaterials()}
                    disabled={busyAction !== null}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {busyAction === 'analyze' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <BookOpen className="w-3.5 h-3.5" />
                    )}
                    Analisis Materi AI
                  </button>
                </div>
              </div>

              <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                {session.materials.map((mat) => (
                  <div
                    key={mat.id}
                    className="flex items-center justify-between gap-4 p-3 bg-white hover:bg-slate-50/70 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {mat.previewDataUrl ? (
                        <img
                          src={mat.previewDataUrl}
                          alt={mat.name}
                          referrerPolicy="no-referrer"
                          className="w-11 h-11 rounded-md object-cover border border-slate-200 shrink-0"
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 shrink-0">
                          {mat.kind === 'image' ? (
                            <ImageIcon className="w-5 h-5" />
                          ) : mat.kind === 'pptx' ? (
                            <Layers className="w-5 h-5" />
                          ) : mat.kind === 'docx' ? (
                            <FileSpreadsheet className="w-5 h-5" />
                          ) : (
                            <FileText className="w-5 h-5" />
                          )}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {mat.name}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 mt-0.5 tabular-nums">
                          <span>{mat.kind.toUpperCase()}</span>
                          <span aria-hidden="true">·</span>
                          <span>{formatBytes(mat.sizeBytes)}</span>
                          {mat.slideOrPageCount ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>
                                {mat.slideOrPageCount}{' '}
                                {mat.kind === 'pptx' ? 'slide' : 'halaman'}
                              </span>
                            </>
                          ) : null}
                          {mat.embeddedMediaCount ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{mat.embeddedMediaCount} gambar tertanam</span>
                            </>
                          ) : null}
                          <span aria-hidden="true">·</span>
                          <span
                            className={
                              mat.readabilityStatus === 'unreadable'
                                ? 'text-red-700 font-medium'
                                : mat.readabilityStatus === 'partially_unreadable'
                                ? 'text-amber-700 font-medium'
                                : mat.readabilityStatus === 'readable'
                                ? 'text-emerald-700 font-medium'
                                : 'text-slate-500'
                            }
                          >
                            {mat.readabilityStatus === 'unreadable'
                              ? 'Tidak terbaca'
                              : mat.readabilityStatus === 'partially_unreadable'
                              ? 'Sebagian buram'
                              : mat.readabilityStatus === 'readable'
                              ? 'Siap dibaca'
                              : 'Menunggu analisis'}
                          </span>
                        </div>
                        {mat.readabilityMessage && (
                          <p className="text-xs text-red-700 mt-1">
                            {mat.readabilityMessage}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => setInspectMaterial(mat)}
                        title="Lihat isi teks & OCR"
                        className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDeleteMaterial(mat.id)}
                        disabled={busyAction !== null}
                        title="Hapus materi"
                        className="p-2 text-slate-500 hover:text-red-700 rounded-lg hover:bg-red-50 disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Unreadable Material Alert */}
        {(unreadableMaterials.length > 0 || hasUnreadableAnalysis) && (
          <section className="bg-amber-50 border border-amber-300 rounded-xl p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-amber-950">
                  Sebagian Materi Tidak Terbaca Jelas — Mohon Unggah Ulang
                </h3>
                <p className="text-xs text-amber-900 leading-relaxed">
                  Pembaca multimodal mendeteksi bagian gambar atau dokumen yang buram/kosong/terpotong. Silakan unggah ulang foto atau halaman yang lebih tajam agar pembuatan soal tetap akurat.
                </p>
                <ul className="space-y-1 text-xs text-amber-950">
                  {session.analysis?.unreadableFiles.map((u, idx) => (
                    <li key={`${u.fileId}_${idx}`}>
                      <span className="font-semibold">{u.fileName}:</span> {u.reason} —{' '}
                      <span className="underline">{u.actionRequired}</span>
                    </li>
                  ))}
                  {unreadableMaterials.map((m) => (
                    <li key={m.id}>
                      <span className="font-semibold">{m.name}:</span>{' '}
                      {m.readabilityMessage || 'Mohon unggah ulang versi yang lebih jelas.'}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        )}

        {/* Multimodal Material Analysis Result */}
        {session.analysis && (
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-700" />
                <h2 className="text-lg font-semibold text-slate-900">
                  2. Hasil Pembacaan Materi AI
                </h2>
              </div>
              <div className="text-xs text-slate-600">
                <span>{session.analysis.detectedSubject}</span>
                <span className="mx-1.5" aria-hidden="true">·</span>
                <span>{session.analysis.detectedLevel}</span>
                <span className="mx-1.5" aria-hidden="true">·</span>
                <span>{session.analysis.language}</span>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-slate-500 mb-1.5">
                Ringkasan Materi Internal
              </h3>
              <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-line">
                {session.analysis.internalSummary}
              </p>
            </div>

            {session.analysis.coreTopics.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-slate-500 mb-2">
                  Pokok Pembahasan
                </h3>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {session.analysis.coreTopics.map((topic, i) => (
                    <li
                      key={i}
                      className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2"
                    >
                      <span className="font-mono text-xs text-slate-500 mr-2 tabular-nums">
                        {String(i + 1).padStart(2, '0')}.
                      </span>
                      {topic}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {session.analysis.keyConcepts.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-slate-500 mb-2">
                  Konsep Penting ({session.analysis.keyConcepts.length})
                </h3>
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                  {session.analysis.keyConcepts.slice(0, 8).map((c, idx) => (
                    <div key={idx} className="p-3 text-sm">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-semibold text-slate-900">{c.term}</span>
                        <span className="text-xs text-slate-500">{c.sourceFile}</span>
                      </div>
                      <p className="text-slate-700 mt-1 text-xs leading-relaxed">
                        {c.definition}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {session.analysis.visualElements.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-slate-500 mb-2">
                  Tabel, Diagram, Grafik, Ilustrasi &amp; OCR Terbaca
                </h3>
                <div className="space-y-2">
                  {session.analysis.visualElements.map((v, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between text-slate-600 font-medium">
                        <span>
                          {v.type.toUpperCase()} · {v.sourceFile}
                        </span>
                      </div>
                      <p className="text-slate-900 font-medium">{v.description}</p>
                      <p className="text-slate-700 whitespace-pre-line">{v.extractedData}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Right Column: Universal Question Generator Engine Controls */}
      <aside className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5 lg:sticky lg:top-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            3. Mesin Pembuat Soal Universal
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Terbuka untuk seluruh mata pelajaran, jenjang sekolah, perguruan tinggi, pelatihan/sertifikasi, hingga materi kustom.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="subject-input" className="block text-xs font-semibold text-slate-700 mb-1">
              Bidang / Mata Pelajaran (Bebas &amp; Universal)
            </label>
            <input
              id="subject-input"
              type="text"
              value={localConfig.subject}
              onChange={(e) => {
                const updated = { ...localConfig, subject: e.target.value };
                setLocalConfig(updated);
              }}
              onBlur={() => void onUpdateConfig({ subject: localConfig.subject })}
              placeholder="Kosongkan untuk deteksi otomatis, atau ketik bidang apa saja..."
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Jenjang / Konteks
              </label>
              <select
                value={
                  EDUCATION_LEVEL_PRESETS.includes(localConfig.educationLevel)
                    ? localConfig.educationLevel
                    : 'Kustom'
                }
                onChange={(e) => {
                  const val = e.target.value;
                  const updated = { ...localConfig, educationLevel: val };
                  setLocalConfig(updated);
                  void onUpdateConfig({ educationLevel: val });
                }}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {EDUCATION_LEVEL_PRESETS.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {lvl}
                  </option>
                ))}
              </select>
              {(!EDUCATION_LEVEL_PRESETS.includes(localConfig.educationLevel) ||
                localConfig.educationLevel === 'Kustom') && (
                <input
                  type="text"
                  value={
                    localConfig.educationLevel === 'Kustom'
                      ? ''
                      : localConfig.educationLevel
                  }
                  onChange={(e) =>
                    setLocalConfig({
                      ...localConfig,
                      educationLevel: e.target.value || 'Kustom',
                    })
                  }
                  onBlur={() =>
                    void onUpdateConfig({ educationLevel: localConfig.educationLevel })
                  }
                  placeholder="Ketik jenjang/konteks khusus..."
                  className="mt-2 w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Kurikulum / Referensi (Opsional)
              </label>
              <input
                type="text"
                value={localConfig.curriculumOrContext}
                onChange={(e) =>
                  setLocalConfig({ ...localConfig, curriculumOrContext: e.target.value })
                }
                onBlur={() =>
                  void onUpdateConfig({ curriculumOrContext: localConfig.curriculumOrContext })
                }
                placeholder="Misal: Merdeka, Kampus, ISO, Umum"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          {/* 10 Supported Question Types */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Jenis Soal yang Didukung (Pilih 1 atau lebih)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ALL_QUESTION_TYPES.map((type) => {
                const active = localConfig.questionTypes.includes(type);
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => toggleQuestionType(type)}
                    className={`text-left px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                      active
                        ? 'bg-blue-50 border-blue-600 text-blue-900'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {QUESTION_TYPE_LABELS[type]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Cognitive Focus & Difficulty */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Fokus Kognitif (HOTS / LOTS)
              </label>
              <select
                value={localConfig.cognitiveFocus}
                onChange={(e) => {
                  const val = e.target.value as GenerationConfig['cognitiveFocus'];
                  setLocalConfig({ ...localConfig, cognitiveFocus: val });
                  void onUpdateConfig({ cognitiveFocus: val });
                }}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="Mixed">Campuran (LOTS + HOTS)</option>
                <option value="HOTS">HOTS (C4–C6 Analisis &amp; Evaluasi)</option>
                <option value="LOTS">LOTS (C1–C3 Pemahaman Dasar)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tingkat Kesulitan
              </label>
              <select
                value={localConfig.difficulty}
                onChange={(e) => {
                  const val = e.target.value as 'Mixed' | DifficultyLevel;
                  setLocalConfig({ ...localConfig, difficulty: val });
                  void onUpdateConfig({ difficulty: val });
                }}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="Mixed">Campuran</option>
                <option value="Easy">Mudah (Easy)</option>
                <option value="Medium">Sedang (Medium)</option>
                <option value="Hard">Sulit (Hard)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Jumlah Soal
              </label>
              <input
                type="number"
                min={1}
                max={50}
                value={localConfig.questionCount}
                onChange={(e) =>
                  setLocalConfig({
                    ...localConfig,
                    questionCount: Math.max(1, Math.min(50, Number(e.target.value) || 1)),
                  })
                }
                className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Target Total Poin
              </label>
              <input
                type="number"
                min={1}
                max={1000}
                value={localConfig.targetTotalPoints}
                onChange={(e) =>
                  setLocalConfig({
                    ...localConfig,
                    targetTotalPoints: Math.max(1, Number(e.target.value) || 100),
                  })
                }
                className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Bahasa Soal
              </label>
              <input
                type="text"
                value={localConfig.language}
                onChange={(e) =>
                  setLocalConfig({ ...localConfig, language: e.target.value })
                }
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <label className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-50 border border-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={localConfig.strictSourceOnly}
              onChange={(e) => {
                const checked = e.target.checked;
                setLocalConfig({ ...localConfig, strictSourceOnly: checked });
                void onUpdateConfig({ strictSourceOnly: checked });
              }}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
            />
            <span className="text-xs text-slate-700 leading-relaxed">
              <strong className="text-slate-900 block">
                Mode Ketat Berbasis Sumber Materi
              </strong>
              Hindari pertanyaan di luar materi sumber. Setiap soal dan kunci jawaban wajib merujuk langsung pada file/teks yang diunggah.
            </span>
          </label>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Instruksi Khusus Tambahan (Opsional)
            </label>
            <textarea
              rows={2}
              value={localConfig.customInstructions || ''}
              onChange={(e) =>
                setLocalConfig({ ...localConfig, customInstructions: e.target.value })
              }
              placeholder="Misal: Sertakan soal yang membahas grafik pada halaman 2 dan studi kasus klinis."
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <button
            type="button"
            onClick={() => void onGenerateQuestions(localConfig)}
            disabled={busyAction !== null || session.materials.length === 0}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {busyAction === 'generate' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            Buat {localConfig.questionCount} Soal dengan Gemini
          </button>
        </div>
      </aside>

      {/* Modal: Inspect Material Extracted Text / OCR */}
      {inspectMaterial && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-slate-900 truncate">
                  {inspectMaterial.name}
                </h3>
                <p className="text-xs text-slate-500">
                  {inspectMaterial.kind.toUpperCase()} · {formatBytes(inspectMaterial.sizeBytes)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectMaterial(null)}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
              >
                Tutup
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4">
              {inspectMaterial.previewDataUrl && (
                <img
                  src={inspectMaterial.previewDataUrl}
                  alt={inspectMaterial.name}
                  referrerPolicy="no-referrer"
                  className="max-h-64 rounded-lg border border-slate-200 mx-auto object-contain"
                />
              )}
              <div>
                <h4 className="text-xs font-semibold text-slate-600 mb-2">
                  Teks / Transkripsi OCR Terekstrak
                </h4>
                {inspectMaterial.extractedText ? (
                  <pre className="text-xs font-mono text-slate-800 bg-slate-50 border border-slate-200 rounded-lg p-4 whitespace-pre-wrap leading-relaxed">
                    {inspectMaterial.extractedText}
                  </pre>
                ) : (
                  <p className="text-sm text-slate-600">
                    Belum ada teks terekstrak. Klik &ldquo;Ekstrak OCR &amp; Teks&rdquo; atau &ldquo;Analisis Materi AI&rdquo; untuk membaca isi file ini secara multimodal.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
