import { describe, it, expect } from 'vitest';
import { demoCorpus } from '../data/demo';
import { canonicalQuestions, contentHash, identityKey, undeclaredDuplicates, validateGroups, provenanceFor } from './dedup';
import type { Corpus } from './types';

const byId = (id: string) => demoCorpus.questions.find((q) => q.id === id)!;

describe('year-scoped deduplication', () => {
  it('declares no structurally invalid groups', () => {
    expect(validateGroups(demoCorpus)).toEqual([]);
  });

  it('collapses two occurrences of the same question in one year to a single visible row', () => {
    const visible = canonicalQuestions(demoCorpus).map((q) => q.id);
    expect(visible).toContain('chem-2025-p1a-tz1-sl-q1');
    expect(visible).not.toContain('chem-2025-p1a-tz1-hl-q1');

    const hl = byId('chem-2025-p1a-tz1-hl-q1');
    const sl = byId('chem-2025-p1a-tz1-sl-q1');
    expect(contentHash(hl)).toBe(contentHash(sl));
    expect(identityKey(hl, contentHash(hl))).toBe(identityKey(sl, contentHash(sl)));
  });

  it('keeps the same verified content in two different years as one copy in EACH year', () => {
    const a = byId('phys-2024-p1-tz2-hl-q5');
    const b = byId('phys-2025-p1-tz2-hl-q5');

    // Content is identical...
    expect(contentHash(a)).toBe(contentHash(b));
    // ...but the identity key differs because it includes the examination year.
    expect(identityKey(a, contentHash(a))).not.toBe(identityKey(b, contentHash(b)));

    const visible = canonicalQuestions(demoCorpus).map((q) => q.id);
    expect(visible).toContain('phys-2024-p1-tz2-hl-q5');
    expect(visible).toContain('phys-2025-p1-tz2-hl-q5');
  });

  it('keeps similar-but-not-identical questions separate', () => {
    const molten = byId('chem-2025-p1a-tz1-hl-q7');
    const aqueous = byId('chem-2025-p1a-tz1-hl-q8');
    expect(molten.topicIds).toEqual(aqueous.topicIds);      // same topic
    expect(contentHash(molten)).not.toBe(contentHash(aqueous)); // different content
    const visible = canonicalQuestions(demoCorpus).map((q) => q.id);
    expect(visible).toContain(molten.id);
    expect(visible).toContain(aqueous.id);
  });

  it('introduces no duplicate visible question anywhere in the corpus', () => {
    expect(undeclaredDuplicates(demoCorpus)).toEqual([]);
  });

  it('preserves source references for suppressed occurrences', () => {
    const refs = provenanceFor(demoCorpus, 'chem-2025-p1a-tz1-sl-q1');
    expect(refs).toHaveLength(2);
    expect(refs.some((r) => r.includes('HL'))).toBe(true);
    expect(refs.some((r) => r.includes('SL'))).toBe(true);
  });

  it('rejects a group that would span two examination years', () => {
    const bad: Corpus = {
      ...demoCorpus,
      sharedGroups: [{
        groupId: 'BAD-CROSS-YEAR', subject: 'physics', examYear: 2025,
        canonicalId: 'phys-2024-p1-tz2-hl-q5',
        suppressedIds: ['phys-2025-p1-tz2-hl-q5'],
        basis: 'invalid fixture',
      }],
    };
    const failures = validateGroups(bad);
    expect(failures.join(' ')).toMatch(/spans examination years 2024, 2025/);
  });
});
