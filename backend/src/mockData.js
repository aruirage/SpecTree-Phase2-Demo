/** @typedef {{ id: string, key: string, version: number, name: string, systemPrompt: string, userTemplate: string, isActive: boolean, changedBy: string, createdAt: string }} PromptVersion */

const DEFAULT_PROMPTS = {
  'spec_tree.pipeline': {
    systemPrompt: 'You are an aerospace specification analyst. Extract spec numbers, names, revision symbols, and referenced child specifications from PDF/TIF documents.',
    userTemplate: 'Analyze the following document pages and build a hierarchical spec tree.\n\nDocument text:\n{{pdfText}}\n\nRoot spec: {{rootSpec}}',
  },
  'clause_compare.extract': {
    systemPrompt: 'Extract numbered clauses from aerospace specification PDFs. Preserve clause numbers and full text.',
    userTemplate: 'Extract all clauses from:\n\n{{pdfText}}',
  },
  'clause_compare.cross_clause': {
    systemPrompt: 'Compare two versions of a specification clause-by-clause. Classify as added, deleted, changed, or unchanged. Handle clause renumbering by content alignment.',
    userTemplate: 'Old clauses:\n{{oldClauses}}\n\nNew clauses:\n{{newClauses}}',
  },
  'clause_compare.translate': {
    systemPrompt: 'Translate aerospace specification clauses between English and Japanese accurately.',
    userTemplate: 'Translate the following clause content:\n\n{{clauseText}}',
  },
};

function mockEvidenceImage(label, accent = '#0076bf') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
    <rect width="320" height="200" rx="12" fill="#f8fafc"/>
    <rect x="18" y="18" width="284" height="164" rx="8" fill="#ffffff" stroke="#cbd5e1"/>
    <rect x="36" y="42" width="112" height="12" rx="3" fill="${accent}"/>
    <rect x="36" y="72" width="236" height="8" rx="3" fill="#94a3b8"/>
    <rect x="36" y="92" width="204" height="8" rx="3" fill="#cbd5e1"/>
    <rect x="36" y="112" width="248" height="8" rx="3" fill="#cbd5e1"/>
    <rect x="36" y="138" width="84" height="24" rx="4" fill="${accent}" opacity="0.14"/>
    <text x="48" y="154" fill="${accent}" font-size="12" font-family="Arial, sans-serif">${label}</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export const MOCK_SPEC_TREE_MMD = `flowchart LR
  root["M000378 Rev:C\\nASTM A36 / Structural Steel"]
  n1["ASTM A572 Grade 50"]
  n2["ASTM A588 / Weathering Steel"]
  n3["AMS2750E\\nPyrometry"]
  root --> n1
  root --> n2
  n2 --> n3`;

export const MOCK_CLAUSE_COMPARE = {
  totalClauses: 6,
  changedClauses: 3,
  clauses: [
    {
      id: 'c1',
      oldClauseNumber: '3.1',
      newClauseNumber: '3.1',
      oldContent: 'Furnace temperature uniformity shall be verified per Table 1.',
      oldTranslation: '炉温均一性は、表1に従って検証されなければならない。',
      oldImages: [{ url: mockEvidenceImage('OLD 3.1', '#64748b'), label: '旧 画像1' }],
      newContent: 'Furnace temperature uniformity shall be verified per Table 1 and Table 1A.',
      newTranslation: '炉温均一性は、表1および表1Aに従って検証されなければならない。',
      newImages: [
        { url: mockEvidenceImage('NEW 3.1', '#0076bf'), label: '新 画像1' },
        { url: mockEvidenceImage('TABLE 1A', '#14a88b'), label: '新 画像2' },
      ],
      status: '変更',
    },
    {
      id: 'c2',
      oldClauseNumber: '3.2',
      newClauseNumber: '3.2',
      oldContent: 'Thermocouples shall be calibrated annually.',
      oldTranslation: '熱電対は年1回校正されなければならない。',
      oldImages: [{ url: mockEvidenceImage('OLD 3.2', '#64748b'), label: '旧 画像1' }],
      newContent: 'Thermocouples shall be calibrated every 90 days per AMS2750F.',
      newTranslation: '熱電対は、AMS2750Fに従い90日ごとに校正されなければならない。',
      newImages: [{ url: mockEvidenceImage('NEW 3.2', '#0076bf'), label: '新 画像1' }],
      status: '変更',
    },
    {
      id: 'c3',
      oldClauseNumber: '4.1',
      newClauseNumber: '4.1',
      oldContent: 'Survey intervals shall not exceed 12 months.',
      oldTranslation: 'サーベイ間隔は12か月を超えてはならない。',
      oldImages: [],
      newContent: 'Survey intervals shall not exceed 12 months.',
      newTranslation: 'サーベイ間隔は12か月を超えてはならない。',
      newImages: [],
      status: '無',
    },
    {
      id: 'c4',
      oldClauseNumber: '5.3',
      newClauseNumber: '5.4',
      oldContent: 'TUS (Temperature Uniformity Survey) records must be retained for 5 years.',
      oldTranslation: 'TUS（温度均一性サーベイ）記録は5年間保管しなければならない。',
      oldImages: [{ url: mockEvidenceImage('OLD 5.3', '#64748b'), label: '旧 画像1' }],
      newContent: 'TUS records must be retained for 7 years and include digital signatures.',
      newTranslation: 'TUS記録は7年間保管し、デジタル署名を含めなければならない。',
      newImages: [{ url: mockEvidenceImage('NEW 5.4', '#0076bf'), label: '新 画像1' }],
      status: '変更',
    },
    {
      id: 'c5',
      oldClauseNumber: '6.2',
      newClauseNumber: '',
      oldContent: 'Legacy furnace class D requirements apply to equipment installed before 2010.',
      oldTranslation: '2010年以前に設置された設備には、旧型炉クラスDの要求事項が適用される。',
      oldImages: [{ url: mockEvidenceImage('OLD 6.2', '#ef4444'), label: '旧 画像1' }],
      newContent: '',
      newTranslation: '',
      newImages: [],
      status: '削除',
    },
    {
      id: 'c6',
      oldClauseNumber: '',
      newClauseNumber: '7.1',
      oldContent: '',
      oldTranslation: '',
      oldImages: [],
      newContent: 'Satellite thermocouple placement shall follow Figure 3-2 for Class 1 furnaces.',
      newTranslation: 'クラス1炉における補助熱電対の配置は、図3-2に従わなければならない。',
      newImages: [{ url: mockEvidenceImage('NEW 7.1', '#14a88b'), label: '新 画像1' }],
      status: '追加',
    },
  ],
};

/** @returns {Record<string, PromptVersion[]>} */
export function createInitialPrompts() {
  const now = new Date().toISOString();
  /** @type {Record<string, PromptVersion[]>} */
  const store = {};
  for (const [key, content] of Object.entries(DEFAULT_PROMPTS)) {
    store[key] = [
      {
        id: `${key}-v1`,
        key,
        version: 1,
        name: '系统默认',
        systemPrompt: content.systemPrompt,
        userTemplate: content.userTemplate,
        isActive: false,
        changedBy: 'system',
        createdAt: now,
      },
      {
        id: `${key}-v2`,
        key,
        version: 2,
        name: '2606_顧客確認版',
        systemPrompt: content.systemPrompt,
        userTemplate: content.userTemplate + '\n\n# Demo override\nUse conservative extraction.',
        isActive: true,
        changedBy: 'admin',
        createdAt: '2026-06-05T00:00:00.000Z',
      },
    ];
  }
  return store;
}

export function createInitialJobs() {
  return [];
}

export { DEFAULT_PROMPTS };
