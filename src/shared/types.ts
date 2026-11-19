export type QuestionType =
  | 'multiple_choice_4'
  | 'multiple_choice_5'
  | 'complex_multiple_choice'
  | 'true_false'
  | 'matching'
  | 'short_answer'
  | 'essay'
  | 'case_analysis'
  | 'stimulus_based';

export type CognitiveLevel = 'LOTS' | 'HOTS';

export type DifficultyLevel = 'Easy' | 'Medium' | 'Hard';

export type MaterialKind = 'image' | 'pdf' | 'docx' | 'pptx' | 'txt' | 'text';

export type ReadabilityStatus = 'pending' | 'readable' | 'partially_unreadable' | 'unreadable';

export interface EmbeddedMediaItem {
  id: string;
  name: string;
  mimeType: string;
  base64Data: string;
}

export interface MaterialFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: MaterialKind;
  extractedText: string;
  blobPath?: string;
  hasBinaryBlob?: boolean;
  embeddedMediaCount?: number;
  previewDataUrl?: string;
  slideOrPageCount?: number;
  uploadedAt: string;
  readabilityStatus: ReadabilityStatus;
  readabilityMessage?: string;
}

export interface KeyConcept {
  term: string;
  definition: string;
  sourceFile: string;
}

export interface VisualElementInsight {
  sourceFile: string;
  type: 'table' | 'diagram' | 'chart' | 'illustration' | 'formula' | 'ocr_text';
  description: string;
  extractedData: string;
}

export interface UnreadableFileNotice {
  fileId: string;
  fileName: string;
  reason: string;
  actionRequired: string;
}

export interface MaterialAnalysis {
  sessionId: string;
  isReadable: boolean;
  unreadableFiles: UnreadableFileNotice[];
  detectedSubject: string;
  detectedLevel: string;
  language: string;
  coreTopics: string[];
  keyConcepts: KeyConcept[];
  visualElements: VisualElementInsight[];
  internalSummary: string;
  ocrTranscripts: Array<{
    fileId: string;
    fileName: string;
    text: string;
  }>;
  analyzedAt: string;
}

export interface MatchingPair {
  prompt: string;
  match: string;
}

export interface ExamQuestion {
  id: string;
  order: number;
  type: QuestionType;
  cognitiveLevel: CognitiveLevel;
  difficulty: DifficultyLevel;
  stimulus?: string;
  question: string;
  options?: string[];
  matchingPairs?: MatchingPair[];
  answerKey: string | string[];
  explanation: string;
  competencyIndicator: string;
  sourceReference: string;
  points: number;
}

export interface DuplicatePair {
  questionIndexA: number;
  questionIndexB: number;
  reason: string;
}

export interface ValidationIssue {
  questionId: string;
  issue: string;
}

export interface ValidationReport {
  valid: boolean;
  requestedCount: number;
  actualCount: number;
  countMatches: boolean;
  targetTotalPoints: number;
  actualTotalPoints: number;
  pointsMatch: boolean;
  duplicates: DuplicatePair[];
  alignmentIssues: ValidationIssue[];
  sourceGroundingIssues: ValidationIssue[];
  warnings: string[];
  checkedAt: string;
}

export interface ParticipantIdentityConfig {
  includeFullName: boolean;
  includeParticipantId: boolean;
  includeClassOrOrg: boolean;
  customFields?: string[];
}

export interface GoogleFormResult {
  formId: string;
  title: string;
  responderUri: string;
  editUrl: string;
  isQuiz: boolean;
  totalQuestions: number;
  totalPoints: number;
  participantIdentityIncluded: boolean;
  createdAt: string;
}

export interface GenerationConfig {
  subject: string;
  educationLevel: string;
  curriculumOrContext: string;
  questionTypes: QuestionType[];
  questionCount: number;
  cognitiveFocus: 'LOTS' | 'HOTS' | 'Mixed';
  difficulty: 'Mixed' | DifficultyLevel;
  targetTotalPoints: number;
  language: string;
  strictSourceOnly: boolean;
  customInstructions?: string;
}

export interface ExamSession {
  id: string;
  title: string;
  description: string;
  config: GenerationConfig;
  materials: MaterialFile[];
  analysis: MaterialAnalysis | null;
  questions: ExamQuestion[];
  validation: ValidationReport | null;
  approvedForPublish: boolean;
  approvalTimestamp?: string;
  participantIdentity: ParticipantIdentityConfig;
  googleForm: GoogleFormResult | null;
  createdAt: string;
  updatedAt: string;
}

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  multiple_choice_4: 'Pilihan Ganda (4 Opsi)',
  multiple_choice_5: 'Pilihan Ganda (5 Opsi)',
  complex_multiple_choice: 'Pilihan Ganda Kompleks',
  true_false: 'Benar - Salah',
  matching: 'Menjodohkan',
  short_answer: 'Isian Singkat',
  essay: 'Esai / Uraian',
  case_analysis: 'Analisis Kasus',
  stimulus_based: 'Berbasis Stimulus',
};
