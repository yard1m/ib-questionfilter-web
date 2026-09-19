import { describe, expect, it } from 'vitest';
import {
  buildDecisionBlock,
  buildDecisionLine,
  candidatesFor,
  isDecisionLine,
  isNrLine,
  isTopicLine,
  keyIndex,
} from './triageLib';

describe('triage keyboard shortcuts', () => {
  it('maps keys 1-9 to candidate indices 0-8', () => {
    expect(keyIndex('1')).toBe(0);
    expect(keyIndex('9')).toBe(8);
    expect(keyIndex('0')).toBeNull();
    expect(keyIndex('n')).toBeNull();
    expect(keyIndex('S')).toBeNull();
  });
});

describe('decision line shape (must match what apply_triage.py reads)', () => {
  const longReason = 'Part (a) asks for the rate-calculation step covered in the book section named here.';
  it('accepts topic lines with single or combined codes', () => {
    expect(isTopicLine(`  C20.6 | ${longReason}`)).toBe(true);
    expect(isTopicLine(`  C14.2+C14.3 | ${longReason}`)).toBe(true);
    expect(isTopicLine(`  MA17B | ${longReason}`)).toBe(true);
  });

  it('rejects short reasons and unknown shapes', () => {
    expect(isTopicLine('  C20.6 | too short')).toBe(false);
    expect(isTopicLine('  XYZ | ' + longReason)).toBe(false);
    expect(isNrLine('  NR | too short')).toBe(false);
  });

  it('accepts NR lines that keep Needs review with a reason', () => {
    expect(isNrLine(`  NR | ${longReason}`)).toBe(true);
    expect(isDecisionLine(`  NR | ${longReason}`)).toBe(true);
    expect(isDecisionLine(`  C20.6 | ${longReason}`)).toBe(true);
  });
});

describe('decision block format', () => {
  it('builds the exact apply.py block shape', () => {
    const reason = 'The marked part is pure uncertainty handling with no book content at all here.';
    const block = buildDecisionBlock('Chemistry_paper_1__TZ2_SL.pdf::Q29', [buildDecisionLine('NR', reason)]);
    expect(block).toBe(`U Chemistry_paper_1__TZ2_SL.pdf::Q29\n  NR | ${reason}\n`);
  });

  it('orders hinted topics before the full subject list', () => {
    expect(candidatesFor(['B'], ['A', 'B', 'C'])).toEqual(['B', 'A', 'C']);
  });
});
