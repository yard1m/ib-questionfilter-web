import { describe, expect, it } from 'vitest';
import { CatalogError, parseCatalog, questionTitle } from './catalog';
import { fixtureCatalog } from './fixtures';

describe('parseCatalog', () => {
  it('builds subjects, documents and questions', () => {
    const catalog = parseCatalog(fixtureCatalog());
    expect(catalog.subjects.map((s) => s.id)).toEqual(['physics', 'chemistry']);
    const physics = catalog.subjects[0];
    expect(physics.years).toEqual([2024, 2019]);
    expect(physics.levels).toEqual(['HL', 'SL']);
    expect(physics.sessions).toEqual(['May', 'November']);
    expect(physics.papers).toEqual(['Paper 1A', 'Paper 2']);
    expect(physics.topics).toEqual(['Kinematics', 'Gravitation', 'Unused Topic']);
    expect(catalog.questions).toHaveLength(4);
  });

  it('keeps slices and the answer skip reason', () => {
    const catalog = parseCatalog(fixtureCatalog());
    const q1 = catalog.questions.find((q) => q.id === 'physics-p1-hl-2024::Q1')!;
    expect(q1.questionSlices).toEqual([
      { page: 0, lower: 100, upper: 400, left: null, right: null },
      { page: 1, lower: 500, upper: 800, left: null, right: null },
    ]);
    expect(q1.answerSlices).toEqual([{ page: 0, lower: 500, upper: 540, left: 50, right: 120 }]);
    expect(q1.references).toHaveLength(2);
    const noMarkscheme = catalog.questions.find((q) => q.id === 'physics-p2-sl-2019::Q1')!;
    expect(noMarkscheme.answerSlices).toBeNull();
    expect(noMarkscheme.answerSkipReason).toMatch(/No markscheme/);
  });

  it('titles questions with paper, level, zone and session', () => {
    const catalog = parseCatalog(fixtureCatalog());
    expect(questionTitle(catalog.questions[0])).toBe('Q2 · Paper 1A HL TZ1 · May 2024');
  });

  it('rejects malformed catalogs', () => {
    expect(() => parseCatalog({ schemaVersion: 2 })).toThrow(CatalogError);
    const badSlice = fixtureCatalog();
    badSlice.questions[0].q = [[0, 700, 400]];
    expect(() => parseCatalog(badSlice)).toThrow(/invalid bounds/);
    const duplicate = fixtureCatalog();
    duplicate.questions[1].id = duplicate.questions[0].id;
    expect(() => parseCatalog(duplicate)).toThrow(/twice/);
    const missingDoc = fixtureCatalog();
    missingDoc.questions[0].doc = 9;
    expect(() => parseCatalog(missingDoc)).toThrow(/missing document/);
  });

  it('rejects unsupported subjects and levels instead of rendering them', () => {
    const unsupportedDocumentSubject = fixtureCatalog();
    unsupportedDocumentSubject.documents[0].subject = 'biology';
    expect(() => parseCatalog(unsupportedDocumentSubject)).toThrow(/unsupported: biology/);

    const unsupportedLevel = fixtureCatalog();
    unsupportedLevel.documents[0].level = 'MYP';
    expect(() => parseCatalog(unsupportedLevel)).toThrow(/level is unsupported: MYP/);

    const unsupportedSubject = fixtureCatalog();
    unsupportedSubject.subjects[0].id = 'biology';
    expect(() => parseCatalog(unsupportedSubject)).toThrow(/subject is unsupported: biology/);

    const unsupportedSubjectName = fixtureCatalog();
    unsupportedSubjectName.subjects[0].name = 'Biology';
    expect(() => parseCatalog(unsupportedSubjectName)).toThrow(/subject name is unsupported: Biology/);
  });
});
