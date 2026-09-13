export type SubjectId = 'chemistry' | 'mathematics' | 'physics';
export type LevelId = 'hl' | 'sl';

/** A block of renderable question content. No IB source text is ever shipped. */
export type ContentBlock =
  | { kind: 'text'; text: string }
  | { kind: 'formula'; text: string }
  | { kind: 'table'; caption?: string; headers: string[]; rows: string[][] }
  | { kind: 'diagram'; caption?: string; svg: string }
  | { kind: 'options'; options: { label: string; text: string }[] };

export interface QuestionRecord {
  /** Stable id: subject + exam year + paper + question number. */
  id: string;
  subject: SubjectId;
  /** Verified examination year carried from the source manifest, never parsed from a file name. */
  examYear: number;
  session: 'May' | 'November';
  level: LevelId;
  paper: string;          // 'paper1' | 'paper2' | 'paper3'
  paperType: string;      // display label, e.g. 'Paper 1A'
  timeZone: string;       // 'TZ1' | 'TZ2'
  questionNumber: string; // 'Q1'
  topicIds: string[];
  content: ContentBlock[];
  /** Answer slice for THIS question only. Never a whole markscheme. */
  answer: { markschemeRef: string; lines: string[] } | null;
  /** Source provenance label. Demo data carries a synthetic reference. */
  sourceRef: string;
  needsReview?: boolean;
}

/** A duplicate/shared group. Scoped to one subject and ONE examination year. */
export interface SharedGroup {
  groupId: string;
  subject: SubjectId;
  examYear: number;
  /** Question id that stays visible and selectable. */
  canonicalId: string;
  /** Question ids suppressed from selection and export, kept only as provenance. */
  suppressedIds: string[];
  basis: string;
}

export interface Topic { id: string; label: string; subject: SubjectId }
export interface Corpus {
  /** True when the shipped data is synthetic. Drives the demo banner. */
  isDemoData: boolean;
  label: string;
  topics: Topic[];
  questions: QuestionRecord[];
  sharedGroups: SharedGroup[];
}
