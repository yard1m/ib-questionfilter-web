/**
 * Pure triage-page helpers (dev only -- never imported by the production app
 * shell; `main.tsx` loads `TriagePage` through a `DEV`-guarded dynamic import
 * so the production bundle never contains this module).
 *
 * A decision for one unit is 1+ lines in the exact shape `apply.py` reads:
 *   `  <code> | <reason naming the marked part>` (40+ character reason), or
 *   `  NR | <reason it stays Needs review>` (40+ character reason).
 */

export interface DossierMember {
  sourceFile: string;
  questionNumber: string;
  topics: string[];
  reason: string;
}

export interface DossierSlice {
  page_index: number;
  lower: number;
  upper: number;
  left?: number | null;
  right?: number | null;
}

export interface DossierUnit {
  unit: string;
  subject: string;
  year: number | null;
  paperType: string;
  members: DossierMember[];
  questionPages: number[];
  questionSlices: DossierSlice[];
  answerSlices: DossierSlice[] | null;
  answerSkip: string | null;
  /** Repo-relative PDF paths (present when the source file was found). */
  paperFile: string | null;
  markschemeFile: string | null;
  questionText: string;
  answerText: string;
}

/** Keyboard shortcut: keys 1-9 select candidates 0-8. */
export function keyIndex(key: string): number | null {
  if (/^[1-9]$/.test(key)) return Number(key) - 1;
  return null;
}

export function isTopicLine(line: string): boolean {
  return /^\s*(?:[CP][0-9]+(?:\.[0-9]+)?|M[CA][0-9]{1,2}[A-Z]?)(?:\+(?:[CP][0-9]+(?:\.[0-9]+)?|M[CA][0-9]{1,2}[A-Z]?))*\s*\|\s*.{40,}\s*$/.test(
    line,
  );
}

export function isNrLine(line: string): boolean {
  return /^\s*NR\s*\|\s*.{40,}\s*$/.test(line);
}

export function isDecisionLine(line: string): boolean {
  return isTopicLine(line) || isNrLine(line);
}

/** Builds the exact `  <code> | <reason>` line the decisions file stores. */
export function buildDecisionLine(code: string, reason: string): string {
  return `  ${code.trim()} | ${reason.trim()}`;
}

/** Builds the exact `U <unit>` block appended to `decisions_<subject>.txt`. */
export function buildDecisionBlock(unit: string, lines: string[]): string {
  return `U ${unit}\n${lines.map((line) => (line.startsWith(' ') ? line : `  ${line}`)).join('\n')}\n`;
}

/** Candidates for keys 1-9: hinted topics first, then the full subject list. */
export function candidatesFor(hints: string[], topics: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const topic of [...hints, ...topics]) {
    if (!seen.has(topic)) {
      seen.add(topic);
      out.push(topic);
    }
  }
  return out;
}
