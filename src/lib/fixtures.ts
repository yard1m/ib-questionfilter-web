/** Synthetic catalog used by the unit tests. It contains no IB content. */
export function fixtureCatalog() {
  return {
    schemaVersion: 1,
    generatedAt: '2026-09-16T00:00:00Z',
    subjects: [
      { id: 'physics', name: 'Physics', topics: ['Kinematics', 'Gravitation', 'Unused Topic'] },
      { id: 'chemistry', name: 'Chemistry', topics: ['The mole', 'Rates', 'Needs review'] },
    ],
    documents: [
      { id: 'physics-p1-hl-2024', subject: 'physics', name: 'Synthetic_physics_paper_1_HL_2024', year: 2024, session: 'May', level: 'HL', paper: 'Paper 1A', paperOption: null, timeZone: 'TZ1', paperKey: 'test/papers/physics-p1-hl-2024.pdf', markschemeKey: 'test/markschemes/physics-p1-hl-2024.pdf' },
      { id: 'physics-p2-sl-2019', subject: 'physics', name: 'Synthetic_physics_paper_2_SL_2019', year: 2019, session: 'November', level: 'SL', paper: 'Paper 2', paperOption: null, timeZone: 'TZ0', paperKey: 'test/papers/physics-p2-sl-2019.pdf', markschemeKey: null },
      { id: 'chemistry-p2-hl-2021', subject: 'chemistry', name: 'Synthetic_chemistry_paper_2_HL_2021', year: 2021, session: 'May', level: 'HL', paper: 'Paper 2', paperOption: null, timeZone: 'TZ2', paperKey: 'test/papers/chemistry-p2-hl-2021.pdf', markschemeKey: 'test/markschemes/chemistry-p2-hl-2021.pdf' },
    ],
    questions: [
      { id: 'physics-p1-hl-2024::Q2', doc: 0, label: 'Q2', order: 1, topics: ['Gravitation'], needsReview: false, grouping: null, q: [[0, 400, 700]], a: [[0, 400, 440, 50, 120]], aSkip: null, refs: [] },
      { id: 'physics-p1-hl-2024::Q1', doc: 0, label: 'Q1', order: 0, topics: ['Kinematics', 'Gravitation'], needsReview: false, grouping: 'shared', q: [[0, 100, 400], [1, 500, 800]], a: [[0, 500, 540, 50, 120]], aSkip: null, refs: [['Synthetic_physics_paper_1_HL_2024.pdf', 'Q1', 'Paper 1A', 'Page 3'], ['Synthetic_physics_paper_1_SL_2024.pdf', 'Q1', 'Paper 1A', 'Page 3']] },
      { id: 'physics-p2-sl-2019::Q1', doc: 1, label: 'Q1', order: 0, topics: ['Kinematics'], needsReview: false, grouping: null, q: [[0, 50, 780]], a: null, aSkip: 'No markscheme is mapped for this source paper.', refs: [] },
      { id: 'chemistry-p2-hl-2021::Q1', doc: 2, label: 'Q1', order: 0, topics: ['Needs review'], needsReview: true, grouping: null, q: [[0, 100, 700]], a: [[0, 300, 500, null, null]], aSkip: null, refs: [] },
    ],
  };
}
