import React from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  KeyRound,
  Loader2,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  CognitiveLevel,
  DifficultyLevel,
  ExamQuestion,
  ExamSession,
  QuestionType,
} from '../shared/types';
import { QUESTION_TYPE_LABELS } from '../shared/types';

interface QuestionEditorProps {
  session: ExamSession;
  busyAction: string | null;
  onQuestionsChange: (questions: ExamQuestion[]) => Promise<void>;
  onValidate: () => Promise<void>;
  onVerifyAnswerKeys: () => Promise<void>;
  onEnrichExplanations: () => Promise<void>;
  onProceedToPublish: () => void;
}

const QUESTION_TYPES: QuestionType[] = [
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

export const QuestionEditor: React.FC<QuestionEditorProps> = ({
  session,
  busyAction,
  onQuestionsChange,
  onValidate,
  onVerifyAnswerKeys,
  onEnrichExplanations,
  onProceedToPublish,
}) => {
  const questions = session.questions;
  const totalPoints = questions.reduce((acc, q) => acc + (Number(q.points) || 0), 0);

  const updateQuestion = (index: number, patch: Partial<ExamQuestion>) => {
    const next = questions.map((q, idx) => (idx === index ? { ...q, ...patch } : q));
    void onQuestionsChange(next);
  };

  const moveQuestion = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= questions.length) return;
    const copy = [...questions];
    const [removed] = copy.splice(index, 1);
    copy.splice(target, 0, removed);
    void onQuestionsChange(copy.map((q, i) => ({ ...q, order: i + 1 })));
  };

  const deleteQuestion = (index: number) => {
    const next = questions
      .filter((_, i) => i !== index)
      .map((q, i) => ({ ...q, order: i + 1 }));
    void onQuestionsChange(next);
  };

  const addManualQuestion = () => {
    const newQ: ExamQuestion = {
      id: `q_manual_${Date.now().toString(36)}`,
      order: questions.length + 1,
      type: 'multiple_choice_4',
      cognitiveLevel: 'LOTS',
      difficulty: 'Medium',
      question: 'Pertanyaan baru...',
      options: ['Pilihan A', 'Pilihan B', 'Pilihan C', 'Pilihan D'],
      answerKey: 'Pilihan A',
      explanation: 'Penjelasan jawaban berdasarkan materi.',
      competencyIndicator: 'Indikator kompetensi',
      sourceReference: 'Input manual / materi sumber',
      points: 10,
    };
    void onQuestionsChange([...questions, newQ]);
  };

  const handleTypeChange = (index: number, newType: QuestionType) => {
    const q = questions[index];
    const patch: Partial<ExamQuestion> = { type: newType };
    if (newType === 'multiple_choice_4') {
      const opts = (q.options || ['Opsi A', 'Opsi B', 'Opsi C', 'Opsi D']).slice(0, 4);
      while (opts.length < 4) opts.push(`Opsi ${opts.length + 1}`);
      patch.options = opts;
      patch.answerKey = opts[0];
      patch.matchingPairs = undefined;
    } else if (newType === 'multiple_choice_5') {
      const opts = (q.options || ['Opsi A', 'Opsi B', 'Opsi C', 'Opsi D', 'Opsi E']).slice(0, 5);
      while (opts.length < 5) opts.push(`Opsi ${opts.length + 1}`);
      patch.options = opts;
      patch.answerKey = opts[0];
      patch.matchingPairs = undefined;
    } else if (newType === 'true_false') {
      patch.options = ['Benar', 'Salah'];
      patch.answerKey = 'Benar';
      patch.matchingPairs = undefined;
    } else if (newType === 'complex_multiple_choice') {
      const opts = q.options && q.options.length >= 3 ? q.options : ['Pernyataan 1', 'Pernyataan 2', 'Pernyataan 3', 'Pernyataan 4'];
      patch.options = opts;
      patch.answerKey = [opts[0], opts[1]];
      patch.matchingPairs = undefined;
    } else if (newType === 'matching') {
      patch.options = undefined;
      patch.matchingPairs = q.matchingPairs?.length
        ? q.matchingPairs
        : [
            { prompt: 'Konsep 1', match: 'Pasangan 1' },
            { prompt: 'Konsep 2', match: 'Pasangan 2' },
            { prompt: 'Konsep 3', match: 'Pasangan 3' },
          ];
      patch.answerKey = patch.matchingPairs.map((p) => `${p.prompt} -> ${p.match}`);
    } else if (newType === 'short_answer' || newType === 'essay') {
      patch.options = undefined;
      patch.matchingPairs = undefined;
      patch.answerKey = typeof q.answerKey === 'string' ? q.answerKey : 'Kunci jawaban';
    }
    updateQuestion(index, patch);
  };

  if (questions.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">
          Belum Ada Soal untuk Dipratinjau
        </h2>
        <p className="text-sm text-slate-600 max-w-md mx-auto">
          Unggah materi di tab Studio lalu jalankan pembuatan soal dengan Gemini, atau tambahkan butir soal secara manual.
        </p>
        <button
          type="button"
          onClick={addManualQuestion}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800"
        >
          <Plus className="w-4 h-4" />
          Tambah Soal Manual
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Validation & Action Bar */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
            <div>
              <p className="text-xs text-slate-500">Jumlah Soal</p>
              <p className="text-xl font-semibold font-mono tabular-nums text-slate-900">
                {questions.length}{' '}
                <span className="text-xs font-normal text-slate-500">
                  / target {session.config.questionCount}
                </span>
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Total Bobot Poin</p>
              <p className="text-xl font-semibold font-mono tabular-nums text-slate-900">
                {totalPoints}{' '}
                <span className="text-xs font-normal text-slate-500">
                  / target {session.config.targetTotalPoints}
                </span>
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Duplikasi</p>
              <p className="text-xl font-semibold font-mono tabular-nums text-slate-900">
                {session.validation ? session.validation.duplicates.length : 0}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Status Validasi</p>
              <div className="flex items-center gap-1.5 mt-1">
                {session.validation?.valid ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span className="text-sm font-semibold text-emerald-700">Lolos</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                    <span className="text-sm font-semibold text-amber-700">
                      {session.validation ? 'Perlu Tinjau' : 'Belum Dicek'}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void onValidate()}
              disabled={busyAction !== null}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {busyAction === 'validate' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5" />
              )}
              Validasi Kualitas
            </button>
            <button
              type="button"
              onClick={() => void onVerifyAnswerKeys()}
              disabled={busyAction !== null}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {busyAction === 'verify-keys' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <KeyRound className="w-3.5 h-3.5" />
              )}
              Verifikasi Kunci
            </button>
            <button
              type="button"
              onClick={() => void onEnrichExplanations()}
              disabled={busyAction !== null}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {busyAction === 'explanations' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              Perkaya Pembahasan
            </button>
            <button
              type="button"
              onClick={addManualQuestion}
              disabled={busyAction !== null}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Tambah Soal
            </button>
            <button
              type="button"
              onClick={onProceedToPublish}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 whitespace-nowrap shrink-0"
            >
              Lanjut Publikasi Form
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Detailed Validation Warnings */}
        {session.validation &&
          (session.validation.warnings.length > 0 ||
            session.validation.duplicates.length > 0 ||
            session.validation.alignmentIssues.length > 0 ||
            session.validation.sourceGroundingIssues.length > 0) && (
            <div className="pt-4 border-t border-slate-200 space-y-1.5 text-xs text-amber-900 bg-amber-50/70 p-3 rounded-lg">
              {session.validation.warnings.map((w, i) => (
                <p key={`w_${i}`}>• {w}</p>
              ))}
              {session.validation.duplicates.map((d, i) => (
                <p key={`d_${i}`}>• Duplikasi: {d.reason}</p>
              ))}
              {session.validation.alignmentIssues.map((a, i) => (
                <p key={`a_${i}`}>
                  • Konsistensi ({a.questionId}): {a.issue}
                </p>
              ))}
              {session.validation.sourceGroundingIssues.map((s, i) => (
                <p key={`s_${i}`}>
                  • Sumber Materi ({s.questionId}): {s.issue}
                </p>
              ))}
            </div>
          )}
      </section>

      {/* Editable Question List */}
      <div className="space-y-4">
        {questions.map((q, index) => (
          <article
            key={q.id}
            className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            {/* Card Meta Header (Clean unboxed typography with separators) */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 tabular-nums">
                <span className="font-semibold text-slate-900 font-mono">
                  Soal #{index + 1}
                </span>
                <span aria-hidden="true">·</span>
                <span>{QUESTION_TYPE_LABELS[q.type]}</span>
                <span aria-hidden="true">·</span>
                <span>{q.cognitiveLevel}</span>
                <span aria-hidden="true">·</span>
                <span>{q.difficulty}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono font-semibold text-slate-900">
                  {q.points} Poin
                </span>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => moveQuestion(index, -1)}
                  disabled={index === 0}
                  title="Pindah ke atas"
                  className="p-1.5 text-slate-500 hover:text-slate-900 rounded hover:bg-slate-100 disabled:opacity-30"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => moveQuestion(index, 1)}
                  disabled={index === questions.length - 1}
                  title="Pindah ke bawah"
                  className="p-1.5 text-slate-500 hover:text-slate-900 rounded hover:bg-slate-100 disabled:opacity-30"
                >
                  <ArrowDown className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => deleteQuestion(index)}
                  title="Hapus soal"
                  className="p-1.5 text-slate-500 hover:text-red-700 rounded hover:bg-red-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Settings Row */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Tipe Soal
                </label>
                <select
                  value={q.type}
                  onChange={(e) => handleTypeChange(index, e.target.value as QuestionType)}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                >
                  {QUESTION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {QUESTION_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Level Kognitif
                </label>
                <select
                  value={q.cognitiveLevel}
                  onChange={(e) =>
                    updateQuestion(index, {
                      cognitiveLevel: e.target.value as CognitiveLevel,
                    })
                  }
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                >
                  <option value="LOTS">LOTS (C1–C3)</option>
                  <option value="HOTS">HOTS (C4–C6)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Tingkat Kesulitan
                </label>
                <select
                  value={q.difficulty}
                  onChange={(e) =>
                    updateQuestion(index, {
                      difficulty: e.target.value as DifficultyLevel,
                    })
                  }
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                >
                  <option value="Easy">Mudah (Easy)</option>
                  <option value="Medium">Sedang (Medium)</option>
                  <option value="Hard">Sulit (Hard)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Bobot Poin
                </label>
                <input
                  type="number"
                  min={1}
                  value={q.points}
                  onChange={(e) =>
                    updateQuestion(index, {
                      points: Math.max(1, Number(e.target.value) || 1),
                    })
                  }
                  className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            {/* Stimulus / Case */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Stimulus / Studi Kasus / Data Tabel (Opsional)
              </label>
              <textarea
                rows={2}
                value={q.stimulus || ''}
                onChange={(e) =>
                  updateQuestion(index, { stimulus: e.target.value || undefined })
                }
                placeholder="Tambahkan bacaan, narasi kasus, atau deskripsi grafik jika soal berbasis stimulus..."
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            {/* Question Stem */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Pertanyaan
              </label>
              <textarea
                rows={2}
                value={q.question}
                onChange={(e) => updateQuestion(index, { question: e.target.value })}
                className="w-full px-3 py-2 text-sm font-medium text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            {/* Choice Options */}
            {q.options && q.type !== 'matching' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-600">
                    Pilihan Jawaban (pilih kunci jawaban di sebelah kiri)
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      updateQuestion(index, {
                        options: [...q.options!, `Opsi ${q.options!.length + 1}`],
                      })
                    }
                    className="text-xs font-medium text-blue-700 hover:underline"
                  >
                    + Tambah Opsi
                  </button>
                </div>
                {q.options.map((opt, optIdx) => {
                  const isComplex = q.type === 'complex_multiple_choice';
                  const checked = isComplex
                    ? Array.isArray(q.answerKey) && q.answerKey.includes(opt)
                    : q.answerKey === opt;

                  return (
                    <div key={optIdx} className="flex items-center gap-2">
                      <input
                        type={isComplex ? 'checkbox' : 'radio'}
                        name={`answer_${q.id}`}
                        checked={checked}
                        onChange={() => {
                          if (isComplex) {
                            const curr = Array.isArray(q.answerKey)
                              ? q.answerKey
                              : [];
                            const next = checked
                              ? curr.filter((x) => x !== opt)
                              : [...curr, opt];
                            updateQuestion(index, { answerKey: next });
                          } else {
                            updateQuestion(index, { answerKey: opt });
                          }
                        }}
                        className="h-4 w-4 text-blue-700 border-slate-300"
                      />
                      <span className="text-xs font-mono text-slate-500 w-5">
                        {String.fromCharCode(65 + optIdx)}.
                      </span>
                      <input
                        type="text"
                        value={opt}
                        onChange={(e) => {
                          const newVal = e.target.value;
                          const nextOpts = q.options!.map((o, i) =>
                            i === optIdx ? newVal : o
                          );
                          let nextKey = q.answerKey;
                          if (isComplex && Array.isArray(q.answerKey)) {
                            nextKey = q.answerKey.map((k) => (k === opt ? newVal : k));
                          } else if (q.answerKey === opt) {
                            nextKey = newVal;
                          }
                          updateQuestion(index, { options: nextOpts, answerKey: nextKey });
                        }}
                        className={`flex-1 px-3 py-1.5 text-sm border rounded-lg ${
                          checked
                            ? 'bg-emerald-50/50 border-emerald-400 text-slate-900'
                            : 'bg-white border-slate-300 text-slate-800'
                        }`}
                      />
                      {q.options!.length > 2 && (
                        <button
                          type="button"
                          onClick={() => {
                            const nextOpts = q.options!.filter((_, i) => i !== optIdx);
                            updateQuestion(index, { options: nextOpts });
                          }}
                          className="p-1.5 text-slate-400 hover:text-red-700"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Matching Pairs Editor */}
            {q.type === 'matching' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-600">
                    Pasangan Menjodohkan
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const nextPairs = [
                        ...(q.matchingPairs || []),
                        { prompt: 'Pernyataan baru', match: 'Pasangan baru' },
                      ];
                      updateQuestion(index, {
                        matchingPairs: nextPairs,
                        answerKey: nextPairs.map((p) => `${p.prompt} -> ${p.match}`),
                      });
                    }}
                    className="text-xs font-medium text-blue-700 hover:underline"
                  >
                    + Tambah Pasangan
                  </button>
                </div>
                {(q.matchingPairs || []).map((pair, pIdx) => (
                  <div key={pIdx} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={pair.prompt}
                      onChange={(e) => {
                        const nextPairs = (q.matchingPairs || []).map((p, i) =>
                          i === pIdx ? { ...p, prompt: e.target.value } : p
                        );
                        updateQuestion(index, {
                          matchingPairs: nextPairs,
                          answerKey: nextPairs.map((p) => `${p.prompt} -> ${p.match}`),
                        });
                      }}
                      placeholder="Premis / Kolom Kiri"
                      className="px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg"
                    />
                    <input
                      type="text"
                      value={pair.match}
                      onChange={(e) => {
                        const nextPairs = (q.matchingPairs || []).map((p, i) =>
                          i === pIdx ? { ...p, match: e.target.value } : p
                        );
                        updateQuestion(index, {
                          matchingPairs: nextPairs,
                          answerKey: nextPairs.map((p) => `${p.prompt} -> ${p.match}`),
                        });
                      }}
                      placeholder="Pasangan / Kolom Kanan"
                      className="px-3 py-1.5 text-sm bg-emerald-50/40 border border-emerald-300 rounded-lg"
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Short Answer / Essay Key */}
            {(!q.options || q.type === 'short_answer' || q.type === 'essay') &&
              q.type !== 'matching' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Kunci Jawaban / Rubrik Penilaian
                  </label>
                  <textarea
                    rows={2}
                    value={
                      Array.isArray(q.answerKey)
                        ? q.answerKey.join(', ')
                        : q.answerKey
                    }
                    onChange={(e) =>
                      updateQuestion(index, { answerKey: e.target.value })
                    }
                    className="w-full px-3 py-2 text-sm bg-emerald-50/40 border border-emerald-300 rounded-lg"
                  />
                </div>
              )}

            {/* Explanation, Competency, Source */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-slate-100">
              <div className="md:col-span-3">
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Pembahasan
                </label>
                <textarea
                  rows={2}
                  value={q.explanation}
                  onChange={(e) =>
                    updateQuestion(index, { explanation: e.target.value })
                  }
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Indikator / Kompetensi
                </label>
                <input
                  type="text"
                  value={q.competencyIndicator}
                  onChange={(e) =>
                    updateQuestion(index, { competencyIndicator: e.target.value })
                  }
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Sumber / Bagian Materi
                </label>
                <input
                  type="text"
                  value={q.sourceReference}
                  onChange={(e) =>
                    updateQuestion(index, { sourceReference: e.target.value })
                  }
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                />
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
};
