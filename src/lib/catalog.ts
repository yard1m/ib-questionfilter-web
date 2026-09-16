/**
 * The private catalog downloaded after sign-in (schema version 1, written by
 * Scripts/build_web_corpus.py from the desktop app's own resolver). It lists one canonical row per
 * duplicate/shared component, in the desktop app's display order, with slice coordinates.
 */

/** A rectangular region of a source page, in displayed page coordinates (origin bottom-left). */
export interface Slice {
  page: number;
  lower: number;
  upper: number;
  left: number | null;
  right: number | null;
}

export interface SourceDocument {
  id: string;
  subject: string;
  name: string;
  year: number;
  session: 'May' | 'November';
  level: string;
  paper: string;
  paperOption: string | null;
  timeZone: string;
  paperKey: string;
  markschemeKey: string | null;
  order: number;
}

export interface SourceReference {
  sourceFile: string;
  question: string;
  paper: string;
  page: string;
}

export interface Question {
  id: string;
  subject: string;
  document: SourceDocument;
  label: string;
  order: number;
  topics: string[];
  needsReview: boolean;
  grouping: string | null;
  questionSlices: Slice[];
  answerSlices: Slice[] | null;
  answerSkipReason: string | null;
  references: SourceReference[];
}

export interface Subject {
  id: string;
  name: string;
  topics: string[];
  years: number[];
  sessions: string[];
  levels: string[];
  papers: string[];
}

export interface Catalog {
  generatedAt: string;
  subjects: Subject[];
  questions: Question[];
}

export class CatalogError extends Error {}

type Raw = Record<string, unknown>;
const SUPPORTED_SUBJECT_NAMES = {
  chemistry: 'Chemistry',
  physics: 'Physics',
  mathematics: 'Mathematics',
} as const;
const SUPPORTED_LEVELS = new Set(['HL', 'SL']);

function isSupportedSubject(value: string): value is keyof typeof SUPPORTED_SUBJECT_NAMES {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_SUBJECT_NAMES, value);
}

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value) throw new CatalogError(`Catalog ${what} is missing`);
  return value;
}

function num(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new CatalogError(`Catalog ${what} is not a number`);
  return value;
}

function slices(value: unknown, horizontal: boolean, what: string): Slice[] {
  if (!Array.isArray(value) || value.length === 0) throw new CatalogError(`Catalog ${what} has no slices`);
  return value.map((row, index) => {
    if (!Array.isArray(row) || row.length < 3) throw new CatalogError(`Catalog ${what} slice ${index} is malformed`);
    const slice: Slice = {
      page: num(row[0], `${what} page`),
      lower: num(row[1], `${what} lower`),
      upper: num(row[2], `${what} upper`),
      left: horizontal && typeof row[3] === 'number' ? row[3] : null,
      right: horizontal && typeof row[4] === 'number' ? row[4] : null,
    };
    if (!Number.isInteger(slice.page) || slice.page < 0 || slice.upper <= slice.lower) {
      throw new CatalogError(`Catalog ${what} slice ${index} has invalid bounds`);
    }
    if (slice.left !== null && slice.right !== null && slice.right <= slice.left) {
      throw new CatalogError(`Catalog ${what} slice ${index} has invalid horizontal bounds`);
    }
    return slice;
  });
}

const PAPER_ORDER: Record<string, number> = { 'paper 1': 0, 'paper 1a': 0, 'paper 1b': 1, 'paper 2': 2, 'paper 3': 3 };

export function paperOrder(label: string): number {
  return PAPER_ORDER[label.toLowerCase()] ?? 99;
}

export function parseCatalog(raw: unknown): Catalog {
  if (!isRecord(raw) || raw.schemaVersion !== 1) throw new CatalogError('Unsupported catalog version');
  if (!Array.isArray(raw.subjects) || !Array.isArray(raw.documents) || !Array.isArray(raw.questions)) {
    throw new CatalogError('Catalog is incomplete');
  }
  const documents: SourceDocument[] = raw.documents.map((item, index) => {
    if (!isRecord(item)) throw new CatalogError('Catalog document is malformed');
    const subject = str(item.subject, 'document subject');
    if (!isSupportedSubject(subject)) throw new CatalogError(`Catalog document subject is unsupported: ${subject}`);
    const session = str(item.session, 'document session');
    if (session !== 'May' && session !== 'November') throw new CatalogError('Catalog document session is invalid');
    const level = str(item.level, 'document level');
    if (!SUPPORTED_LEVELS.has(level)) throw new CatalogError(`Catalog document level is unsupported: ${level}`);
    return {
      id: str(item.id, 'document id'),
      subject,
      name: str(item.name, 'document name'),
      year: num(item.year, 'document year'),
      session,
      level,
      paper: str(item.paper, 'document paper'),
      paperOption: typeof item.paperOption === 'string' ? item.paperOption : null,
      timeZone: typeof item.timeZone === 'string' ? item.timeZone : '',
      paperKey: str(item.paperKey, 'document paper key'),
      markschemeKey: typeof item.markschemeKey === 'string' ? item.markschemeKey : null,
      order: index,
    };
  });

  const questions: Question[] = raw.questions.map((item) => {
    if (!isRecord(item)) throw new CatalogError('Catalog question is malformed');
    const docIndex = num(item.doc, 'question document');
    const document = documents[docIndex];
    if (!document) throw new CatalogError('Catalog question references a missing document');
    const id = str(item.id, 'question id');
    const topics = Array.isArray(item.topics) ? item.topics.filter((t): t is string => typeof t === 'string') : [];
    const answerSlices = item.a === null || item.a === undefined ? null : slices(item.a, true, `${id} answer`);
    return {
      id,
      subject: document.subject,
      document,
      label: str(item.label, 'question label'),
      order: num(item.order, 'question order'),
      topics,
      needsReview: item.needsReview === true,
      grouping: typeof item.grouping === 'string' ? item.grouping : null,
      questionSlices: slices(item.q, false, `${id} question`),
      answerSlices: answerSlices && document.markschemeKey ? answerSlices : null,
      answerSkipReason: typeof item.aSkip === 'string' ? item.aSkip
        : !document.markschemeKey ? 'No markscheme is paired with this source paper.' : null,
      references: Array.isArray(item.refs)
        ? item.refs
          .filter((ref): ref is unknown[] => Array.isArray(ref) && ref.length >= 4)
          .map((ref) => ({ sourceFile: String(ref[0]), question: String(ref[1]), paper: String(ref[2]), page: String(ref[3]) }))
        : [],
    };
  });

  const seen = new Set<string>();
  for (const question of questions) {
    if (seen.has(question.id)) throw new CatalogError(`Catalog lists ${question.id} twice`);
    seen.add(question.id);
  }

  const subjects: Subject[] = raw.subjects.map((item) => {
    if (!isRecord(item)) throw new CatalogError('Catalog subject is malformed');
    const id = str(item.id, 'subject id');
    if (!isSupportedSubject(id)) throw new CatalogError(`Catalog subject is unsupported: ${id}`);
    const name = str(item.name, 'subject name');
    if (name !== SUPPORTED_SUBJECT_NAMES[id]) throw new CatalogError(`Catalog subject name is unsupported: ${name}`);
    const subjectQuestions = questions.filter((q) => q.subject === id);
    const docs = documents.filter((d) => d.subject === id);
    const unique = <T,>(values: T[]) => [...new Set(values)];
    const declaredTopics = Array.isArray(item.topics) ? item.topics.filter((t): t is string => typeof t === 'string') : [];
    const usedTopics = new Set(subjectQuestions.flatMap((q) => q.topics));
    return {
      id,
      name,
      // Keep the desktop app's topic list and order, then any other topic a question carries.
      topics: unique([...declaredTopics, ...usedTopics]),
      years: unique(docs.map((d) => d.year)).sort((a, b) => b - a),
      sessions: unique(docs.map((d) => d.session)).sort(),
      levels: unique(docs.map((d) => d.level)).sort(),
      papers: unique(docs.map((d) => d.paper)).sort((a, b) => paperOrder(a) - paperOrder(b) || a.localeCompare(b)),
    };
  });

  return { generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : '', subjects, questions };
}

export function questionTitle(question: Question): string {
  const doc = question.document;
  const option = doc.paperOption ? ` (${doc.paperOption})` : '';
  const zone = doc.timeZone ? ` ${doc.timeZone}` : '';
  return `${question.label} · ${doc.paper}${option} ${doc.level}${zone} · ${doc.session} ${doc.year}`;
}
