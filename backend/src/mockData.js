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

/** リスク警告ヘルパー（source: 'align'=対齐類似度 / 'extract'=抽出品質） */
export function reviewWarning(type, side, reason, source = 'align') {
  return { source, type, side, reason, confirmedAt: null, confirmedBy: null };
}

function buildExtraClauses() {
  const topics = [
    // [番号, 旧内容, 新内容, 旧訳, 新訳, status, risk?]
    ['3.3', 'Furnace load shall not exceed the rated capacity of the work zone.', 'Furnace load shall not exceed the rated capacity of the work zone.', '炉の負荷は、作業ゾーンの定格容量を超えてはならない。', '炉の負荷は、作業ゾーンの定格容量を超えてはならない。', '無'],
    ['3.4', 'Atmosphere control records shall be retained for the life of the part.', 'Atmosphere control records shall be retained for the life of the part.', '雰囲気制御記録は、部品の寿命にわたって保管しなければならない。', '雰囲気制御記録は、部品の寿命にわたって保管しなければならない。', '無'],
    ['3.5', 'Heating rates above 25C per minute require engineering approval.', 'Heating rates above 25C per minute require engineering approval and a validated load pattern.', '毎分25℃を超える加熱速度には、技術承認が必要である。', '毎分25℃を超える加熱速度には、技術承認と検証済みの負荷パターンが必要である。', '変更', { type: 'low-similarity', side: 'pair', reason: '類似度が低いため、正しいペアかどうか確認が必要' }],
    ['5.5', 'Thermocouple calibration records shall include probe depth.', 'Thermocouple calibration records shall include probe depth and immersion length.', '熱電対の校正記録には、プローブ深さを含めなければならない。', '熱電対の校正記録には、プローブ深さと浸漬長さを含めなければならない。', '変更'],
    ['5.6', 'TUS data points shall be positioned per furnace classification.', 'TUS data points shall be positioned per furnace classification and recorded on Form T-4.', 'TUSデータポイントは、炉分類に従って配置しなければならない。', 'TUSデータポイントは、炉分類に従って配置し、様式T-4に記録しなければならない。', '変更', { type: 'low-similarity', side: 'pair', reason: '類似度が低いため、正しいペアかどうか確認が必要' }],
    ['6.3', 'Furnace qualification shall be re-validated after major repairs.', 'Furnace qualification shall be re-validated after major repairs.', '炉の認定は、大規模修理後に再検証されなければならない。', '炉の認定は、大規模修理後に再検証されなければならない。', '無'],
    ['6.4', 'Class 1 furnaces require continuous recorder charts.', 'Class 1 furnaces require continuous recorder charts and electronic logging.', 'クラス1炉には、連続記録計チャートが必要である。', 'クラス1炉には、連続記録計チャートと電子ログが必要である。', '変更'],
    ['8.1', 'Heat treat batch records shall list operator and date.', 'Heat treat batch records shall list operator, date, and furnace used.', '熱処理バッチ記録には、作業者と日付を記載しなければならない。', '熱処理バッチ記録には、作業者、日付、使用炉を記載しなければならない。', '変更'],
    ['8.2', 'Hardness testing shall follow ASTM E18.', 'Hardness testing shall follow ASTM E18.', '硬さ試験は、ASTM E18に従わなければならない。', '硬さ試験は、ASTM E18に従わなければならない。', '無'],
    ['8.3', 'Metallurgical examination shall be performed on one sample per batch.', 'Metallurgical examination shall be performed on one sample per batch.', '金属組織検査は、バッチごとに1サンプル実施しなければならない。', '金属組織検査は、バッチごとに1サンプル実施しなければならない。', '無'],
    ['9.1', 'Quench media temperature shall be verified before each load.', 'Quench media temperature shall be verified before each load.', '焼入れ媒体温度は、各負荷前に検証しなければならない。', '焼入れ媒体温度は、各負荷前に検証しなければならない。', '無'],
    ['9.2', 'Age hardening cycles shall follow the approved schedule.', 'Age hardening cycles shall follow the approved schedule.', '時効硬化サイクルは、承認されたスケジュールに従わなければならない。', '時効硬化サイクルは、承認されたスケジュールに従わなければならない。', '無'],
    ['10.1', 'Material certificates shall identify heat number and grade.', 'Material certificates shall identify heat number, grade, and supplier.', '材料証明書には、熱処理番号とグレードを記載しなければならない。', '材料証明書には、熱処理番号、グレード、供給元を記載しなければならない。', '変更'],
    ['10.2', 'Chemical composition shall be verified against purchase order.', 'Chemical composition shall be verified against purchase order.', '化学成分は、発注書と照合して検証しなければならない。', '化学成分は、発注書と照合して検証しなければならない。', '無'],
    ['11.1', 'Penetrant inspection shall be performed after final machining.', 'Penetrant inspection shall be performed after final machining.', '浸透探傷検査は、最終加工後に実施しなければならない。', '浸透探傷検査は、最終加工後に実施しなければならない。', '無'],
    ['11.2', 'Magnetic particle inspection shall use the wet continuous method.', 'Magnetic particle inspection shall use the wet continuous method.', '磁粉探傷検査は、湿式連続法を用いなければならない。', '磁粉探傷検査は、湿式連続法を用いなければならない。', '無'],
    ['12.1', 'Quality audits shall be scheduled semi-annually.', 'Quality audits shall be scheduled semi-annually.', '品質監査は、半年ごとに計画しなければならない。', '品質監査は、半年ごとに計画しなければならない。', '無'],
    ['12.2', 'Operator training records shall be current and traceable.', 'Operator training records shall be current and traceable.', '作業者の訓練記録は、最新かつ追跡可能でなければならない。', '作業者の訓練記録は、最新かつ追跡可能でなければならない。', '無'],
    ['12.3', 'Nonconformance reports shall be dispositioned within 30 days.', 'Nonconformance reports shall be dispositioned within 30 days.', '不適合報告書は、30日以内に処置されなければならない。', '不適合報告書は、30日以内に処置されなければならない。', '無'],
    ['12.4', 'Subcontracted heat treatment requires prior written approval.', 'Subcontracted heat treatment requires prior written approval and audit access.', '外注熱処理には、事前の書面承認が必要である。', '外注熱処理には、事前の書面承認と監査アクセスが必要である。', '変更', { type: 'low-similarity', side: 'pair', reason: '類似度が低いため、正しいペアかどうか確認が必要' }],
    ['12.5', 'Record retention shall follow the contract data requirements.', 'Record retention shall follow the contract data requirements.', '記録の保管は、契約データ要件に従わなければならない。', '記録の保管は、契約データ要件に従わなければならない。', '無'],
    ['12.6', 'Preventive maintenance of furnaces shall be scheduled monthly.', 'Preventive maintenance of furnaces shall be scheduled monthly.', '炉の予防保守は、毎月計画しなければならない。', '炉の予防保守は、毎月計画しなければならない。', '無'],
  ];
  return topics.map((t, i) => {
    const [num, oldEn, newEn, oldJp, newJp, status, risk] = t;
    const isAdd = status === '追加';
    const isDel = status === '削除';
    const clause = {
      id: `cx${i + 1}`,
      oldClauseNumber: isAdd ? '' : num,
      newClauseNumber: isDel ? '' : num,
      oldContent: isAdd ? '' : oldEn,
      oldTranslation: isAdd ? '' : oldJp,
      oldImages: [],
      newContent: isDel ? '' : newEn,
      newTranslation: isDel ? '' : newJp,
      newImages: [],
      status,
    };
    if (risk) {
      clause.reviewWarnings = [reviewWarning(risk.type, risk.side, risk.reason, risk.source || 'align')];
    }
    return clause;
  });
}

const BASE_CLAUSES = [
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
      reviewWarnings: [
        reviewWarning('misclassified', 'new', '画像「TABLE 1A」は条項 3.1 の内容と一致しない可能性がある（分類の誤り）', 'extract'),
      ],
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
      reviewWarnings: [
        reviewWarning('low-similarity', 'pair', '類似度が低いため、正しいペアかどうか確認が必要'),
        reviewWarning('incomplete', 'new', '文末が途切れている可能性がある（抽出が不完全）', 'extract'),
      ],
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
      reviewWarnings: [
        reviewWarning('low-similarity', 'pair', '類似度が低いため、正しいペアかどうか確認が必要'),
      ],
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
      reviewWarnings: [
        reviewWarning('low-similarity', 'pair', '類似度が低いため、正しいペアかどうか確認が必要'),
      ],
    },
  ];

const EXTRA_CLAUSES = buildExtraClauses();
// リスクデモ版：抽出/対齐リスクを注入した条項リスト
const ALL_CLAUSES_RISKY = [
  ...BASE_CLAUSES,
  ...EXTRA_CLAUSES,
];
// デフォルト（クリーン）版：リスクなし
const ALL_CLAUSES_CLEAN = ALL_CLAUSES_RISKY
  .map(({ reviewWarnings, ...rest }) => ({ ...rest, reviewWarnings: undefined }));

export const MOCK_CLAUSE_COMPARE = {
  totalClauses: ALL_CLAUSES_CLEAN.length,
  changedClauses: ALL_CLAUSES_CLEAN.filter((c) => c.status === '変更').length,
  clauses: ALL_CLAUSES_CLEAN,
};
export const MOCK_CLAUSE_COMPARE_RISKY = {
  totalClauses: ALL_CLAUSES_RISKY.length,
  changedClauses: ALL_CLAUSES_RISKY.filter((c) => c.status === '変更').length,
  clauses: ALL_CLAUSES_RISKY,
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
  return [
    {
      id: 'job-history-spec-001',
      type: 'spec_tree',
      title: 'M000378 スペックツリー',
      status: 'completed',
      progress: 100,
      promptVersionName: '2606_顧客確認版',
      templateId: 'isajt',
      templateName: 'ISAJT テンプレート',
      templateVersion: 'v1.0',
      sessionId: 'st-history-001',
      rootFileId: 'M000378',
      rootFileIds: ['M000378'],
      factory: '安来工場',
      ipAddress: '127.0.0.1',
      cacheHit: false,
      createdAt: '2026-06-30T14:30:00.000Z',
      updatedAt: '2026-06-30T14:56:00.000Z',
    },
    {
      id: 'job-history-spec-002',
      type: 'spec_tree',
      title: 'M000412 スペックツリー',
      status: 'completed',
      progress: 100,
      promptVersionName: '2606_顧客確認版',
      templateId: 'ams',
      templateName: 'AMS テンプレート',
      templateVersion: 'v1.0',
      sessionId: 'st-history-002',
      rootFileId: 'M000412',
      rootFileIds: ['M000412'],
      factory: '安来工場',
      ipAddress: '127.0.0.1',
      cacheHit: true,
      createdAt: '2026-07-02T09:12:00.000Z',
      updatedAt: '2026-07-02T09:31:00.000Z',
    },
    {
      id: 'job-active-spec-running-001',
      type: 'spec_tree',
      title: 'M000501 スペックツリー',
      status: 'running',
      progress: 58,
      promptVersionName: '2606_顧客確認版',
      templateId: 'default',
      templateName: '1期共通テンプレート',
      templateVersion: 'v1.0',
      sessionId: 'st-active-running-001',
      rootFileId: 'M000501',
      rootFileIds: ['M000501'],
      factory: '安来工場',
      ipAddress: '127.0.0.1',
      cacheHit: false,
      createdAt: '2026-08-17T09:22:00.000Z',
      updatedAt: '2026-08-17T09:26:00.000Z',
    },
    {
      id: 'job-active-spec-queued-001',
      type: 'spec_tree',
      title: 'ISAJT-P4TF2 スペックツリー',
      status: 'queued',
      progress: 0,
      promptVersionName: '2606_顧客確認版',
      templateId: 'isajt',
      templateName: 'ISAJT テンプレート',
      templateVersion: 'v1.0',
      sessionId: 'st-active-queued-001',
      rootFileId: 'ISAJT-P4TF2',
      rootFileIds: ['ISAJT-P4TF2'],
      factory: '安来工場',
      ipAddress: '127.0.0.1',
      cacheHit: false,
      createdAt: '2026-08-17T09:28:00.000Z',
      updatedAt: '2026-08-17T09:28:00.000Z',
    },
    {
      id: 'job-history-spec-failed-001',
      type: 'spec_tree',
      title: 'M000621 スペックツリー',
      status: 'failed',
      progress: 34,
      promptVersionName: '2606_顧客確認版',
      templateId: 'default',
      templateName: '1期共通テンプレート',
      templateVersion: 'v1.0',
      sessionId: 'st-history-failed-001',
      rootFileId: 'M000621',
      rootFileIds: ['M000621'],
      factory: '安来工場',
      ipAddress: '127.0.0.1',
      cacheHit: false,
      createdAt: '2026-08-12T15:10:00.000Z',
      updatedAt: '2026-08-12T15:16:00.000Z',
    },
    {
      id: 'job-history-spec-cancelled-001',
      type: 'spec_tree',
      title: 'P2TF1 スペックツリー',
      status: 'cancelled',
      progress: 46,
      promptVersionName: '2606_顧客確認版',
      templateId: 'default',
      templateName: '1期共通テンプレート',
      templateVersion: 'v1.0',
      sessionId: 'st-history-cancelled-001',
      rootFileId: 'P2TF1',
      rootFileIds: ['P2TF1'],
      factory: '安来工場',
      ipAddress: '127.0.0.1',
      cacheHit: false,
      createdAt: '2026-08-10T11:02:00.000Z',
      updatedAt: '2026-08-10T11:07:00.000Z',
    },
    {
      id: 'job-history-compare-001',
      type: 'clause_compare',
      title: 'AMS2750E.pdf vs AMS2750F.pdf',
      status: 'completed',
      progress: 100,
      promptVersionName: '2606_顧客確認版',
      templateId: 'ams',
      templateName: 'AMS テンプレート',
      templateVersion: 'v1.0',
      sessionId: 'cc-history-001',
      factory: '安来工場',
      ipAddress: '127.0.0.1',
      cacheHit: false,
      createdAt: '2026-06-30T10:00:00.000Z',
      updatedAt: '2026-06-30T10:18:00.000Z',
    },
    {
      id: 'job-history-compare-002',
      type: 'clause_compare',
      title: 'AS9100D.pdf vs AS9100E.pdf',
      status: 'completed',
      progress: 100,
      promptVersionName: '2606_顧客確認版',
      templateId: 'default',
      templateName: '1期共通テンプレート',
      templateVersion: 'v1.0',
      sessionId: 'cc-history-002',
      factory: '安来工場',
      ipAddress: '127.0.0.1',
      cacheHit: false,
      createdAt: '2026-07-01T13:40:00.000Z',
      updatedAt: '2026-07-01T14:06:00.000Z',
    },
    {
      id: 'job-active-compare-running-001',
      type: 'clause_compare',
      title: 'JIS-H-4600_旧.pdf vs JIS-H-4600_新.pdf',
      status: 'running',
      progress: 63,
      promptVersionName: '2606_顧客確認版',
      templateId: 'default',
      templateName: '1期共通テンプレート',
      templateVersion: 'v1.0',
      sessionId: 'cc-active-running-001',
      factory: '安来工場',
      ipAddress: '127.0.0.1',
      cacheHit: false,
      createdAt: '2026-08-17T09:20:00.000Z',
      updatedAt: '2026-08-17T09:25:00.000Z',
    },
    {
      id: 'job-active-compare-queued-001',
      type: 'clause_compare',
      title: 'AMS5510J.pdf vs AMS5510K.pdf',
      status: 'queued',
      progress: 0,
      promptVersionName: '2606_顧客確認版',
      templateId: 'ams',
      templateName: 'AMS テンプレート',
      templateVersion: 'v1.0',
      sessionId: 'cc-active-queued-001',
      factory: '安来工場',
      ipAddress: '127.0.0.1',
      cacheHit: false,
      createdAt: '2026-08-17T09:29:00.000Z',
      updatedAt: '2026-08-17T09:29:00.000Z',
    },
    {
      id: 'job-history-compare-failed-001',
      type: 'clause_compare',
      title: 'AMS4911A.pdf vs AMS4911B.pdf',
      status: 'failed',
      progress: 21,
      promptVersionName: '2606_顧客確認版',
      templateId: 'ams',
      templateName: 'AMS テンプレート',
      templateVersion: 'v1.0',
      sessionId: 'cc-history-failed-001',
      factory: '安来工場',
      ipAddress: '127.0.0.1',
      cacheHit: false,
      createdAt: '2026-08-11T16:42:00.000Z',
      updatedAt: '2026-08-11T16:47:00.000Z',
    },
    {
      id: 'job-history-compare-cancelled-001',
      type: 'clause_compare',
      title: 'ASTM-B117_2021.pdf vs ASTM-B117_2024.pdf',
      status: 'cancelled',
      progress: 49,
      promptVersionName: '2606_顧客確認版',
      templateId: 'astm',
      templateName: 'ASTM テンプレート',
      templateVersion: 'v1.0',
      sessionId: 'cc-history-cancelled-001',
      factory: '安来工場',
      ipAddress: '127.0.0.1',
      cacheHit: false,
      createdAt: '2026-08-09T10:18:00.000Z',
      updatedAt: '2026-08-09T10:24:00.000Z',
    },
  ];
}

export { DEFAULT_PROMPTS };
