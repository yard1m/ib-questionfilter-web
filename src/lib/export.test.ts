import { describe, it, expect } from 'vitest';
import { demoCorpus } from '../data/demo';
import { buildExportModel, buildMarkschemeModel, renderQuestionText, headingFor } from './export';

describe('selected-question export', () => {
  it('exports exactly the selected questions', () => {
    const sel = new Set(['chem-2025-p1a-tz1-hl-q7', 'math-2025-p2-tz2-sl-q6']);
    const model = buildExportModel(demoCorpus, sel);
    expect(model.items.map((i) => i.question.id).sort()).toEqual([...sel].sort());
    expect(model.rejected).toEqual([]);
  });

  it('refuses to export a non-canonical occurrence of a shared question', () => {
    const model = buildExportModel(demoCorpus, new Set(['chem-2025-p1a-tz1-hl-q1']));
    expect(model.items).toEqual([]);
    expect(model.rejected[0].reason).toMatch(/Non-canonical occurrence/);
  });

  it('never places two canonical rows from one shared component in a generated PDF', () => {
    const model = buildExportModel(demoCorpus, new Set(['chem-2025-p1a-tz1-sl-q1', 'chem-2025-p1a-tz1-hl-q1']));
    expect(model.items).toHaveLength(1);
    expect(model.items[0].question.id).toBe('chem-2025-p1a-tz1-sl-q1');
  });

  it('carries source provenance for a shared question without adding a selectable row', () => {
    const model = buildExportModel(demoCorpus, new Set(['chem-2025-p1a-tz1-sl-q1']));
    expect(model.items[0].provenance).toHaveLength(2);
  });

  it('renders diagram and table questions in the exported text', () => {
    const withDiagram = demoCorpus.questions.find((q) => q.id === 'chem-2025-p2-tz1-hl-q2')!;
    const lines = renderQuestionText(withDiagram);
    expect(lines.join('\n')).toMatch(/\[diagram: Energy levels/);

    const withTable = demoCorpus.questions.find((q) => q.id === 'phys-2025-p2-tz1-sl-q1')!;
    const t = renderQuestionText(withTable).join('\n');
    expect(t).toMatch(/\[table: Demo measurements\]/);
    expect(t).toMatch(/mass  \|  m  \|  80 kg/);
  });
});

describe('generated markscheme', () => {
  it('contains only the answers for the selected questions', () => {
    const sel = new Set(['chem-2025-p1a-tz1-hl-q7', 'math-2024-p1-tz1-hl-q2']);
    const ms = buildMarkschemeModel(demoCorpus, sel);
    expect(ms.entries.map((e) => e.questionId).sort()).toEqual([...sel].sort());

    // No answer from any unselected question leaks in.
    const text = JSON.stringify(ms.entries);
    expect(text).not.toMatch(/2\.7/);        // maths Q6 answer, not selected
    expect(text).not.toMatch(/local maximum/); // maths Q4 answer, not selected
    expect(text).toMatch(/S_20 = 10\(10 \+ 57\) = 670/);
  });

  it('is never a whole source markscheme', () => {
    const all = new Set(demoCorpus.questions.map((q) => q.id));
    const everything = buildMarkschemeModel(demoCorpus, all);
    const oneOnly = buildMarkschemeModel(demoCorpus, new Set(['phys-2025-p3-tz1-sl-q4']));
    expect(oneOnly.entries).toHaveLength(1);
    expect(oneOnly.entries.length).toBeLessThan(everything.entries.length);
  });

  it('reports a missing answer slice instead of substituting another answer', () => {
    const ms = buildMarkschemeModel(demoCorpus, new Set(['chem-2018-p3-tz1-sl-q9']));
    expect(ms.entries).toEqual([]);
    expect(ms.missing).toHaveLength(1);
    expect(ms.missing[0].reason).toMatch(/no answer slice exists/);
  });

  it('keeps a selected question and its answer slice paired by heading', () => {
    const id = 'phys-2025-p2-tz1-sl-q1';
    const ms = buildMarkschemeModel(demoCorpus, new Set([id]));
    const q = demoCorpus.questions.find((x) => x.id === id)!;
    expect(ms.entries[0].heading).toBe(headingFor(q));
    expect(ms.entries[0].heading).toMatch(/Physics 2025 May - Paper 2 SL TZ1 - Q1/);
  });
});
