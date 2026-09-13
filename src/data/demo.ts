import type { Corpus, QuestionRecord, SharedGroup } from '../lib/types';

/**
 * SANITIZED DEMONSTRATION CORPUS.
 *
 * This file contains NO IB material. Every stem, option, diagram, table and answer
 * below was written for this demo. No IB question paper text, markscheme text,
 * answer key, source book extract or private catalog export is included, and none
 * is fetched at runtime.
 *
 * Topic labels are IB syllabus section names, which are published guide structure,
 * not question content.
 *
 * The fixtures are arranged to exercise the duplicate/shared invariants:
 *   - DEMO-G01 / DEMO-G02: identical content in the SAME year -> collapses to one row.
 *   - phys 2024 Q5 vs phys 2025 Q5: identical content in DIFFERENT years -> stays separate.
 *   - chem 2025 Q7 vs Q8: similar topic and structure, different substance -> stays separate.
 */

const circuitSvg = `<svg viewBox="0 0 240 130" role="img" aria-label="Series circuit with a cell, an ammeter and two resistors">
  <rect x="6" y="16" width="228" height="100" fill="none" stroke="currentColor" stroke-width="2"/>
  <line x1="28" y1="16" x2="52" y2="16" stroke="currentColor" stroke-width="6"/>
  <line x1="34" y1="24" x2="46" y2="24" stroke="currentColor" stroke-width="2"/>
  <circle cx="130" cy="16" r="13" fill="var(--card)" stroke="currentColor" stroke-width="2"/>
  <text x="130" y="21" text-anchor="middle" font-size="13" fill="currentColor">A</text>
  <rect x="208" y="52" width="26" height="30" fill="var(--card)" stroke="currentColor" stroke-width="2"/>
  <text x="221" y="72" text-anchor="middle" font-size="11" fill="currentColor">R1</text>
  <rect x="104" y="101" width="52" height="24" fill="var(--card)" stroke="currentColor" stroke-width="2"/>
  <text x="130" y="117" text-anchor="middle" font-size="11" fill="currentColor">R2</text>
</svg>`;

const energySvg = `<svg viewBox="0 0 230 158" role="img" aria-label="Energy level diagram with four levels and three labelled transitions">
  <line x1="40" y1="18" x2="178" y2="18" stroke="currentColor" stroke-width="2"/>
  <text x="186" y="22" font-size="11" fill="currentColor">n=4</text>
  <line x1="40" y1="55" x2="178" y2="55" stroke="currentColor" stroke-width="2"/>
  <text x="186" y="59" font-size="11" fill="currentColor">n=3</text>
  <line x1="40" y1="95" x2="178" y2="95" stroke="currentColor" stroke-width="2"/>
  <text x="186" y="99" font-size="11" fill="currentColor">n=2</text>
  <line x1="40" y1="142" x2="178" y2="142" stroke="currentColor" stroke-width="2"/>
  <text x="186" y="146" font-size="11" fill="currentColor">n=1</text>
  <line x1="70" y1="20" x2="70" y2="136" stroke="currentColor" stroke-width="2" marker-end="url(#ar)"/>
  <text x="56" y="86" font-size="11" fill="currentColor">P</text>
  <line x1="112" y1="57" x2="112" y2="89" stroke="currentColor" stroke-width="2" marker-end="url(#ar)"/>
  <text x="98" y="78" font-size="11" fill="currentColor">Q</text>
  <line x1="152" y1="20" x2="152" y2="49" stroke="currentColor" stroke-width="2" marker-end="url(#ar)"/>
  <text x="138" y="40" font-size="11" fill="currentColor">R</text>
  <defs><marker id="ar" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
    <path d="M0,0 L8,4 L0,8 Z" fill="currentColor"/></marker></defs>
</svg>`;

const graphSvg = `<svg viewBox="0 0 230 148" role="img" aria-label="Graph of pressure against volume falling as a curve">
  <line x1="38" y1="12" x2="38" y2="116" stroke="currentColor" stroke-width="2"/>
  <line x1="38" y1="116" x2="212" y2="116" stroke="currentColor" stroke-width="2"/>
  <path d="M52,22 C90,86 120,104 200,110" fill="none" stroke="currentColor" stroke-width="2"/>
  <text x="10" y="64" font-size="11" fill="currentColor">p</text>
  <text x="118" y="138" font-size="11" fill="currentColor">V</text>
</svg>`;

export const questions: QuestionRecord[] = [
  // ---- Chemistry 2025: identical HL/SL pair, SAME year -> collapses to one row ----
  {
    id: 'chem-2025-p1a-tz1-sl-q1', subject: 'chemistry', examYear: 2025, session: 'May',
    level: 'sl', paper: 'paper1', paperType: 'Paper 1A', timeZone: 'TZ1', questionNumber: 'Q1',
    topicIds: ['Counting particles by mass: The mole'],
    content: [
      { kind: 'text', text: 'A demo compound contains 40.0 % carbon and 6.7 % hydrogen by mass, the remainder being oxygen. What is its empirical formula?' },
      { kind: 'options', options: [
        { label: 'A', text: 'CHO' }, { label: 'B', text: 'CH2O' },
        { label: 'C', text: 'C2H4O' }, { label: 'D', text: 'C2H4O2' }] },
    ],
    answer: { markschemeRef: 'Demo answer slice, 2025 Paper 1A SL item 1', lines: ['B', 'Mole ratio C : H : O = 3.33 : 6.7 : 3.33 = 1 : 2 : 1'] },
    sourceRef: 'Demo Chemistry 2025 May Paper 1A SL TZ1 Q1',
  },
  {
    id: 'chem-2025-p1a-tz1-hl-q1', subject: 'chemistry', examYear: 2025, session: 'May',
    level: 'hl', paper: 'paper1', paperType: 'Paper 1A', timeZone: 'TZ1', questionNumber: 'Q1',
    topicIds: ['Counting particles by mass: The mole'],
    content: [
      { kind: 'text', text: 'A demo compound contains 40.0 % carbon and 6.7 % hydrogen by mass, the remainder being oxygen. What is its empirical formula?' },
      { kind: 'options', options: [
        { label: 'A', text: 'CHO' }, { label: 'B', text: 'CH2O' },
        { label: 'C', text: 'C2H4O' }, { label: 'D', text: 'C2H4O2' }] },
    ],
    answer: { markschemeRef: 'Demo answer slice, 2025 Paper 1A HL item 1', lines: ['B'] },
    sourceRef: 'Demo Chemistry 2025 May Paper 1A HL TZ1 Q1',
  },

  // ---- Chemistry 2025: similar structure, different substance -> must stay separate ----
  {
    id: 'chem-2025-p1a-tz1-hl-q7', subject: 'chemistry', examYear: 2025, session: 'May',
    level: 'hl', paper: 'paper1', paperType: 'Paper 1A', timeZone: 'TZ1', questionNumber: 'Q7',
    topicIds: ['Electron transfer reactions'],
    content: [
      { kind: 'text', text: 'What are the products when MOLTEN demo bromide is electrolysed using inert electrodes?' },
      { kind: 'table', caption: 'Electrolysis products', headers: ['', 'Cathode', 'Anode'],
        rows: [['A', 'metal', 'bromine'], ['B', 'hydrogen', 'bromine'], ['C', 'metal', 'oxygen'], ['D', 'hydrogen', 'oxygen']] },
    ],
    answer: { markschemeRef: 'Demo answer slice, 2025 Paper 1A HL item 7', lines: ['A', 'In a molten salt only the metal and halide ions are present to be discharged.'] },
    sourceRef: 'Demo Chemistry 2025 May Paper 1A HL TZ1 Q7',
  },
  {
    id: 'chem-2025-p1a-tz1-hl-q8', subject: 'chemistry', examYear: 2025, session: 'May',
    level: 'hl', paper: 'paper1', paperType: 'Paper 1A', timeZone: 'TZ1', questionNumber: 'Q8',
    topicIds: ['Electron transfer reactions'],
    content: [
      { kind: 'text', text: 'What are the products when CONCENTRATED AQUEOUS demo bromide is electrolysed using inert electrodes?' },
      { kind: 'table', caption: 'Electrolysis products', headers: ['', 'Cathode', 'Anode'],
        rows: [['A', 'metal', 'bromine'], ['B', 'hydrogen', 'bromine'], ['C', 'metal', 'oxygen'], ['D', 'hydrogen', 'oxygen']] },
    ],
    answer: { markschemeRef: 'Demo answer slice, 2025 Paper 1A HL item 8', lines: ['B', 'Water is reduced in preference to the reactive metal ion, so hydrogen is released.'] },
    sourceRef: 'Demo Chemistry 2025 May Paper 1A HL TZ1 Q8',
  },

  // ---- Chemistry 2025 Paper 2: diagram + formula, multi-topic ----
  {
    id: 'chem-2025-p2-tz1-hl-q2', subject: 'chemistry', examYear: 2025, session: 'November',
    level: 'hl', paper: 'paper2', paperType: 'Paper 2', timeZone: 'TZ1', questionNumber: 'Q2',
    topicIds: ['Electron configurations', 'The periodic table'],
    content: [
      { kind: 'text', text: 'The diagram shows electronic transitions in a demo atom.' },
      { kind: 'diagram', caption: 'Energy levels with transitions P, Q and R', svg: energySvg },
      { kind: 'text', text: 'Identify the transition that emits the photon of longest wavelength and explain your reasoning.' },
      { kind: 'formula', text: 'E = h f     and     c = f x lambda' },
    ],
    answer: { markschemeRef: 'Demo answer slice, 2025 Paper 2 HL item 2', lines: ['R', 'The smallest energy gap gives the smallest photon energy and therefore the longest wavelength.'] },
    sourceRef: 'Demo Chemistry 2025 November Paper 2 HL TZ1 Q2',
  },

  // ---- Chemistry 2018: identical HL/SL pair, SAME year -> collapses ----
  {
    id: 'chem-2018-p1-tz1-sl-q3', subject: 'chemistry', examYear: 2018, session: 'May',
    level: 'sl', paper: 'paper1', paperType: 'Paper 1', timeZone: 'TZ1', questionNumber: 'Q3',
    topicIds: ['Ideal gases'],
    content: [
      { kind: 'text', text: 'Which graph shows how the pressure of a fixed mass of an ideal demo gas varies with volume at constant temperature?' },
      { kind: 'diagram', caption: 'Pressure against volume', svg: graphSvg },
    ],
    answer: { markschemeRef: 'Demo answer slice, 2018 Paper 1 SL item 3', lines: ['A', 'Pressure is inversely proportional to volume at constant temperature.'] },
    sourceRef: 'Demo Chemistry 2018 May Paper 1 SL TZ1 Q3',
  },
  {
    id: 'chem-2018-p1-tz1-hl-q2', subject: 'chemistry', examYear: 2018, session: 'May',
    level: 'hl', paper: 'paper1', paperType: 'Paper 1', timeZone: 'TZ1', questionNumber: 'Q2',
    topicIds: ['Ideal gases'],
    content: [
      { kind: 'text', text: 'Which graph shows how the pressure of a fixed mass of an ideal demo gas varies with volume at constant temperature?' },
      { kind: 'diagram', caption: 'Pressure against volume', svg: graphSvg },
    ],
    answer: { markschemeRef: 'Demo answer slice, 2018 Paper 1 HL item 2', lines: ['A'] },
    sourceRef: 'Demo Chemistry 2018 May Paper 1 HL TZ1 Q2',
  },
  {
    id: 'chem-2018-p3-tz1-sl-q9', subject: 'chemistry', examYear: 2018, session: 'May',
    level: 'sl', paper: 'paper3', paperType: 'Paper 3', timeZone: 'TZ1', questionNumber: 'Q9',
    topicIds: ['Needs review'],
    content: [{ kind: 'text', text: 'Demo item drawn from a retired syllabus option. No approved topic covers this content, so it is flagged for review rather than forced into an unrelated topic.' }],
    answer: null,
    sourceRef: 'Demo Chemistry 2018 May Paper 3 SL TZ1 Q9',
    needsReview: true,
  },

  // ---- Physics: IDENTICAL content in two DIFFERENT years -> must stay separate ----
  {
    id: 'phys-2024-p1-tz2-hl-q5', subject: 'physics', examYear: 2024, session: 'May',
    level: 'hl', paper: 'paper1', paperType: 'Paper 1', timeZone: 'TZ2', questionNumber: 'Q5',
    topicIds: ['Current and Circuits'],
    content: [
      { kind: 'text', text: 'In the demo circuit shown, what happens to the ammeter reading when the resistance of R1 is increased?' },
      { kind: 'diagram', caption: 'Series demo circuit', svg: circuitSvg },
      { kind: 'options', options: [
        { label: 'A', text: 'It increases' }, { label: 'B', text: 'It decreases' },
        { label: 'C', text: 'It is unchanged' }, { label: 'D', text: 'It falls to zero' }] },
    ],
    answer: { markschemeRef: 'Demo answer slice, 2024 Paper 1 HL item 5', lines: ['B', 'Total circuit resistance rises, so the current falls.'] },
    sourceRef: 'Demo Physics 2024 May Paper 1 HL TZ2 Q5',
  },
  {
    id: 'phys-2025-p1-tz2-hl-q5', subject: 'physics', examYear: 2025, session: 'May',
    level: 'hl', paper: 'paper1', paperType: 'Paper 1', timeZone: 'TZ2', questionNumber: 'Q5',
    topicIds: ['Current and Circuits'],
    content: [
      { kind: 'text', text: 'In the demo circuit shown, what happens to the ammeter reading when the resistance of R1 is increased?' },
      { kind: 'diagram', caption: 'Series demo circuit', svg: circuitSvg },
      { kind: 'options', options: [
        { label: 'A', text: 'It increases' }, { label: 'B', text: 'It decreases' },
        { label: 'C', text: 'It is unchanged' }, { label: 'D', text: 'It falls to zero' }] },
    ],
    answer: { markschemeRef: 'Demo answer slice, 2025 Paper 1 HL item 5', lines: ['B', 'Total circuit resistance rises, so the current falls.'] },
    sourceRef: 'Demo Physics 2025 May Paper 1 HL TZ2 Q5',
  },

  {
    id: 'phys-2025-p2-tz1-sl-q1', subject: 'physics', examYear: 2025, session: 'May',
    level: 'sl', paper: 'paper2', paperType: 'Paper 2', timeZone: 'TZ1', questionNumber: 'Q1',
    topicIds: ['Kinematics', 'Work Energy and Power'],
    content: [
      { kind: 'text', text: 'A demo block is released from rest and falls freely through 20 m before an elastic rope begins to extend.' },
      { kind: 'table', caption: 'Demo measurements', headers: ['Quantity', 'Symbol', 'Value'],
        rows: [['mass', 'm', '80 kg'], ['free-fall drop', 'h', '20 m'], ['extension time', 't', '0.75 s']] },
      { kind: 'text', text: 'Calculate the speed of the block at the moment the rope starts to extend, then describe the energy transfers that follow.' },
      { kind: 'formula', text: 'v^2 = u^2 + 2 a s' },
    ],
    answer: { markschemeRef: 'Demo answer slice, 2025 Paper 2 SL item 1', lines: ['v = 20 m s^-1 (2 s.f.)', 'Gravitational potential energy transfers to kinetic energy, then to elastic potential energy stored in the rope.'] },
    sourceRef: 'Demo Physics 2025 May Paper 2 SL TZ1 Q1',
  },
  {
    id: 'phys-2025-p3-tz1-sl-q4', subject: 'physics', examYear: 2025, session: 'November',
    level: 'sl', paper: 'paper3', paperType: 'Paper 3', timeZone: 'TZ1', questionNumber: 'Q4',
    topicIds: ['Nuclear Physics'],
    content: [
      { kind: 'text', text: 'A demo nuclide has a half-life of 9 hours. A detector reads 260 units against a background of 20 units. What does it read after 36 hours?' },
      { kind: 'options', options: [{ label: 'A', text: '15' }, { label: 'B', text: '35' }, { label: 'C', text: '20' }, { label: 'D', text: '80' }] },
    ],
    answer: { markschemeRef: 'Demo answer slice, 2025 Paper 3 SL item 4', lines: ['B', 'Subtract the background, apply four half-lives, then add the background back.'] },
    sourceRef: 'Demo Physics 2025 November Paper 3 SL TZ1 Q4',
  },
  {
    id: 'phys-2018-p1-tz2-sl-q11', subject: 'physics', examYear: 2018, session: 'May',
    level: 'sl', paper: 'paper1', paperType: 'Paper 1', timeZone: 'TZ2', questionNumber: 'Q11',
    topicIds: ['Thermal Energy Transfer'],
    content: [
      { kind: 'text', text: 'A demo liquid is heated at a constant rate P. Its temperature-time graph has gradient K and the liquid has specific heat capacity c. What is the mass of the liquid?' },
      { kind: 'formula', text: 'm = P / (c K)' },
    ],
    answer: { markschemeRef: 'Demo answer slice, 2018 Paper 1 SL item 11', lines: ['P / (c K)'] },
    sourceRef: 'Demo Physics 2018 May Paper 1 SL TZ2 Q11',
  },

  // ---- Mathematics ----
  {
    id: 'math-2025-p1-tz1-hl-q4', subject: 'mathematics', examYear: 2025, session: 'May',
    level: 'hl', paper: 'paper1', paperType: 'Paper 1', timeZone: 'TZ1', questionNumber: 'Q4',
    topicIds: ['Rules of Differentiation', 'Applications of Differentiation'],
    content: [
      { kind: 'text', text: 'A demo curve is defined for all real x.' },
      { kind: 'formula', text: 'f(x) = x^3 - 6 x^2 + 9 x + 2' },
      { kind: 'text', text: 'Find the coordinates of the stationary points and determine their nature.' },
    ],
    answer: { markschemeRef: 'Demo answer slice, 2025 Paper 1 HL item 4', lines: ["f'(x) = 3x^2 - 12x + 9 = 3(x - 1)(x - 3)", '(1, 6) is a local maximum', '(3, 2) is a local minimum'] },
    sourceRef: 'Demo Mathematics 2025 May Paper 1 HL TZ1 Q4',
  },
  {
    id: 'math-2025-p2-tz2-sl-q6', subject: 'mathematics', examYear: 2025, session: 'May',
    level: 'sl', paper: 'paper2', paperType: 'Paper 2', timeZone: 'TZ2', questionNumber: 'Q6',
    topicIds: ['Probability'],
    content: [
      { kind: 'text', text: 'A demo spinner is biased. The table shows the probability of each outcome.' },
      { kind: 'table', caption: 'Outcome probabilities', headers: ['Outcome x', '1', '2', '3', '4'],
        rows: [['P(X = x)', '0.1', '0.3', 'k', '0.2']] },
      { kind: 'text', text: 'Find the value of k and hence the expected value of X.' },
    ],
    answer: { markschemeRef: 'Demo answer slice, 2025 Paper 2 SL item 6', lines: ['k = 0.4', 'E(X) = 1(0.1) + 2(0.3) + 3(0.4) + 4(0.2) = 2.7'] },
    sourceRef: 'Demo Mathematics 2025 May Paper 2 SL TZ2 Q6',
  },
  {
    id: 'math-2024-p1-tz1-hl-q2', subject: 'mathematics', examYear: 2024, session: 'November',
    level: 'hl', paper: 'paper1', paperType: 'Paper 1', timeZone: 'TZ1', questionNumber: 'Q2',
    topicIds: ['Sequences and Series'],
    content: [
      { kind: 'text', text: 'A demo arithmetic sequence has first term 5 and common difference 3. Find the sum of the first 20 terms.' },
      { kind: 'formula', text: 'S_n = (n / 2)(2a + (n - 1) d)' },
    ],
    answer: { markschemeRef: 'Demo answer slice, 2024 Paper 1 HL item 2', lines: ['S_20 = 10(10 + 57) = 670'] },
    sourceRef: 'Demo Mathematics 2024 November Paper 1 HL TZ1 Q2',
  },
];

export const sharedGroups: SharedGroup[] = [
  {
    groupId: 'DEMO-G01', subject: 'chemistry', examYear: 2025,
    canonicalId: 'chem-2025-p1a-tz1-sl-q1',
    suppressedIds: ['chem-2025-p1a-tz1-hl-q1'],
    basis: 'Identical stem, options and values within the same subject and examination year. The SL occurrence is canonical.',
  },
  {
    groupId: 'DEMO-G02', subject: 'chemistry', examYear: 2018,
    canonicalId: 'chem-2018-p1-tz1-sl-q3',
    suppressedIds: ['chem-2018-p1-tz1-hl-q2'],
    basis: 'Identical stem and stimulus within the same subject and examination year. The SL occurrence is canonical.',
  },
];

const topicIndex = new Map<string, Corpus['topics'][number]>();
for (const item of questions) {
  for (const t of item.topicIds) {
    topicIndex.set(`${item.subject}::${t}`, { id: t, label: t, subject: item.subject });
  }
}

export const demoCorpus: Corpus = {
  isDemoData: true,
  label: 'Sanitized demonstration data. Contains no IB questions, markschemes, answer keys or source books.',
  topics: [...topicIndex.values()],
  questions,
  sharedGroups,
};
