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
      oldImages: [{ url: mockEvidenceImage('OLD 3.1', '#64748b'), label: '旧版 3.1 抜粋' }],
      newContent: 'Furnace temperature uniformity shall be verified per Table 1 and Table 1A.',
      newTranslation: '炉温均一性は、表1および表1Aに従って検証されなければならない。',
      newImages: [
        { url: mockEvidenceImage('NEW 3.1', '#0076bf'), label: '新版 3.1 抜粋' },
        { url: mockEvidenceImage('TABLE 1A', '#14a88b'), label: '新版 Table 1A' },
      ],
      status: '変更',
    },
    {
      id: 'c2',
      oldClauseNumber: '3.2',
      newClauseNumber: '3.2',
      oldContent: 'Thermocouples shall be calibrated annually.',
      oldTranslation: '熱電対は年1回校正されなければならない。',
      oldImages: [{ url: mockEvidenceImage('OLD 3.2', '#64748b'), label: '旧版 3.2 抜粋' }],
      newContent: 'Thermocouples shall be calibrated every 90 days per AMS2750F.',
      newTranslation: '熱電対は、AMS2750Fに従い90日ごとに校正されなければならない。',
      newImages: [{ url: mockEvidenceImage('NEW 3.2', '#0076bf'), label: '新版 3.2 抜粋' }],
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
      oldImages: [{ url: mockEvidenceImage('OLD 5.3', '#64748b'), label: '旧版 5.3 抜粋' }],
      newContent: 'TUS records must be retained for 7 years and include digital signatures.',
      newTranslation: 'TUS記録は7年間保管し、デジタル署名を含めなければならない。',
      newImages: [{ url: mockEvidenceImage('NEW 5.4', '#0076bf'), label: '新版 5.4 抜粋' }],
      status: '変更',
    },
    {
      id: 'c5',
      oldClauseNumber: '6.2',
      newClauseNumber: '',
      oldContent: 'Legacy furnace class D requirements apply to equipment installed before 2010.',
      oldTranslation: '2010年以前に設置された設備には、旧型炉クラスDの要求事項が適用される。',
      oldImages: [{ url: mockEvidenceImage('OLD 6.2', '#ef4444'), label: '旧版 6.2 削除条項' }],
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
      newImages: [{ url: mockEvidenceImage('NEW 7.1', '#14a88b'), label: '新版 7.1 追加条項' }],
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
  /** Demo jobs — always tagged with type: spec_tree | clause_compare; lists are filtered by API. */
  return [
    {
      id: 'job-001',
      type: 'spec_tree',
      title: 'M000378 · ASTM系',
      status: 'running',
      progress: 67,
      promptVersionName: '2606_顧客確認版',
      sessionId: 'st-history-001',
      createdAt: '2026-06-30T08:10:00.000Z',
      updatedAt: '2026-06-30T08:45:00.000Z',
    },
    {
      id: 'job-003',
      type: 'spec_tree',
      title: 'M000412 · NDT',
      status: 'queued',
      progress: 0,
      promptVersionName: '2606_顧客確認版',
      sessionId: null,
      createdAt: '2026-06-30T09:00:00.000Z',
      updatedAt: '2026-06-30T09:00:00.000Z',
    },
    {
      id: 'job-004',
      type: 'spec_tree',
      title: 'M000378 · 再生成(0605)',
      status: 'completed',
      progress: 100,
      promptVersionName: '2606_顧客確認版',
      sessionId: 'st-history-002',
      createdAt: '2026-06-28T10:20:00.000Z',
      updatedAt: '2026-06-28T11:05:00.000Z',
    },
    {
      id: 'job-005',
      type: 'spec_tree',
      title: 'M000501 · 溶接規格',
      status: 'completed',
      progress: 100,
      promptVersionName: 'システムデフォルト',
      sessionId: 'st-history-003',
      createdAt: '2026-06-25T14:30:00.000Z',
      updatedAt: '2026-06-25T15:12:00.000Z',
    },
    {
      id: 'job-006',
      type: 'spec_tree',
      title: 'M000388 · 熱処理',
      status: 'failed',
      progress: 42,
      promptVersionName: '2606_顧客確認版',
      sessionId: 'st-history-004',
      createdAt: '2026-06-22T09:00:00.000Z',
      updatedAt: '2026-06-22T09:28:00.000Z',
    },
    {
      id: 'job-007',
      type: 'spec_tree',
      title: 'M000320 · 材料一覧',
      status: 'cancelled',
      progress: 18,
      promptVersionName: '2606_顧客確認版',
      sessionId: 'st-history-005',
      createdAt: '2026-06-20T16:00:00.000Z',
      updatedAt: '2026-06-20T16:08:00.000Z',
    },
    {
      id: 'job-002',
      type: 'clause_compare',
      title: 'AMS2750E vs F',
      status: 'completed',
      progress: 100,
      promptVersionName: '2606_顧客確認版',
      sessionId: 'cc-history-001',
      createdAt: '2026-06-29T14:00:00.000Z',
      updatedAt: '2026-06-29T14:32:00.000Z',
    },
    {
      id: 'job-008',
      type: 'clause_compare',
      title: 'AS9100D vs E',
      status: 'running',
      progress: 54,
      promptVersionName: '2606_顧客確認版',
      sessionId: 'cc-history-002',
      createdAt: '2026-06-30T07:30:00.000Z',
      updatedAt: '2026-06-30T08:00:00.000Z',
    },
    {
      id: 'job-009',
      type: 'clause_compare',
      title: 'NADCAP AC7108 Rev B vs C',
      status: 'completed',
      progress: 100,
      promptVersionName: '2606_顧客確認版',
      sessionId: 'cc-history-003',
      createdAt: '2026-06-27T11:00:00.000Z',
      updatedAt: '2026-06-27T11:45:00.000Z',
    },
    {
      id: 'job-010',
      type: 'clause_compare',
      title: 'AMS4928 vs AMS4928A',
      status: 'completed',
      progress: 100,
      promptVersionName: 'システムデフォルト',
      sessionId: 'cc-history-004',
      createdAt: '2026-06-24T13:20:00.000Z',
      updatedAt: '2026-06-24T14:05:00.000Z',
    },
    {
      id: 'job-011',
      type: 'clause_compare',
      title: 'ASTM E1417 vs E1417M',
      status: 'failed',
      progress: 71,
      promptVersionName: '2606_顧客確認版',
      sessionId: 'cc-history-005',
      createdAt: '2026-06-21T10:00:00.000Z',
      updatedAt: '2026-06-21T10:35:00.000Z',
    },
    {
      id: 'job-012',
      type: 'clause_compare',
      title: 'MIL-STD-810H vs G',
      status: 'cancelled',
      progress: 22,
      promptVersionName: '2606_顧客確認版',
      sessionId: 'cc-history-006',
      createdAt: '2026-06-19T15:40:00.000Z',
      updatedAt: '2026-06-19T15:52:00.000Z',
    },
  ];
}

export { DEFAULT_PROMPTS };
