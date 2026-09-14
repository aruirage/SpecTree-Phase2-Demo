import { v4 as uuidv4 } from 'uuid';
import {
  createInitialJobs,
  createInitialPrompts,
  MOCK_CLAUSE_COMPARE,
  MOCK_SPEC_TREE_MMD,
} from './mockData.js';

/** @type {import('./mockData.js').PromptVersion[]} */
function getActiveVersion(versions) {
  return versions.find((v) => v.isActive) || versions[versions.length - 1];
}

export function normalizeClientIP(ipAddress = '') {
  const raw = String(ipAddress || '').trim();
  if (!raw || raw === '::1') return '127.0.0.1';
  if (raw.startsWith('::ffff:')) return raw.slice('::ffff:'.length);
  return raw;
}

// ファイルからフィンガープリント（キャッシュキー）を生成するヘルパー関数
function generateFileFingerprint(file) {
  if (!file) return '';
  const name = file.name || file.fileName || file.originalname || file.id || file.fileId || 'file';
  return `${name}-${file.size || 0}-${file.lastModified || 0}`;
}

// 複数ファイルからキャッシュキーを生成
function generateCacheKey(type, files, options = {}) {
  const fileKeys = files.map(f => generateFileFingerprint(f)).sort().join('|');
  const optionKey = Object.entries(options)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}:${v}`)
    .join('|');
  return `${type}:${fileKeys}:${optionKey}`;
}

export const store = {
  excelConfig: {
    supplement: null,
    deletion: null,
  },
  license: {
    status: 'active',
    expiresAt: '2026-08-17',
    monthlyUsed: 2000,
    monthlyQuota: 5000,
    /** 履歴データ保持日数（固定 45 日） */
    retentionDays: 45,
    /** 保持期間・課金期間の起算日（ライセンス適用開始 / アップロード日） */
    licenseStartedAt: '2026-05-17T00:00:00.000Z',
    fileName: 'license_tokyo01.lic',
    uploadedAt: '2026-05-17T00:00:00.000Z',
  },
  prompts: createInitialPrompts(),
  promptTemplateConfigs: createInitialPromptTemplateConfigs(),
  extractionTemplates: {
    ams: { templateId: 'ams', templateName: 'AMS テンプレート', templateVersion: 'v1.0' },
    astm: { templateId: 'astm', templateName: 'ASTM テンプレート', templateVersion: 'v1.0' },
    dmf: { templateId: 'dmf', templateName: 'DMF テンプレート', templateVersion: 'v1.0' },
    isajt: { templateId: 'isajt', templateName: 'ISAJT テンプレート', templateVersion: 'v1.0' },
    default: { templateId: 'default', templateName: '標準テンプレート', templateVersion: 'v1.0' },
  },
  jobs: createInitialJobs(),
  /** @type {Map<string, object>} */
  specTreeSessions: new Map(),
  /** @type {Map<string, object>} */
  clauseCompareSessions: new Map(),
  // 工場とIPアドレスのマッピング
  factoryIPMap: {
    '桶川工場': '192.168.1.10',
    '安来工場': '192.168.2.10',
  },
  // IPから工場名への逆マッピング
  ipFactoryMap: {
    '192.168.1.10': '桶川工場',
    '192.168.2.10': '安来工場',
    '127.0.0.1': '安来工場',
  },
  // 結果キャッシュ（フィンガープリント → セッションID）
  /** @type {Map<string, object>} */
  resultCache: new Map(),
  // タスクキュー
  taskQueue: [],
  // 実行中のタスク（同時実行数を制限）
  runningTasks: [],
  maxConcurrentTasks: 1, // 同時に実行できるGPUタスク数
  systemEvents: [
    {
      site: '安来工場',
      ipAddress: '127.0.0.1',
      at: '2026-08-17T09:25:00',
      actionType: 'タスク開始',
      feature: 'スペックツリー',
      processCount: 1,
      pages: 0,
      totalPages: 124,
      durationMinutes: 0,
      detail: 'ツリー作成',
      operator: 'system',
      note: 'M000501.pdf',
    },
    {
      site: '安来工場',
      ipAddress: '127.0.0.1',
      at: '2026-08-17T09:21:00',
      actionType: 'タスク開始',
      feature: '条項比較',
      processCount: 2,
      pages: 0,
      totalPages: 86,
      durationMinutes: 0,
      detail: '差分抽出',
      operator: 'system',
      note: 'JIS-H-4600_旧.pdf;JIS-H-4600_新.pdf',
    },
    {
      site: '安来工場',
      ipAddress: '127.0.0.1',
      at: '2026-08-16T15:42:00',
      actionType: 'タスク完了',
      feature: 'スペックツリー',
      processCount: 3,
      pages: 180,
      totalPages: 180,
      durationMinutes: 34,
      detail: 'ツリー作成',
      operator: 'user02',
      note: 'M000378.pdf;M000412.pdf;M000501.pdf',
    },
    {
      site: '安来工場',
      ipAddress: '127.0.0.1',
      at: '2026-08-15T11:08:00',
      actionType: 'タスク完了',
      feature: '条項比較',
      processCount: 2,
      pages: 96,
      totalPages: 96,
      durationMinutes: 22,
      detail: '差分抽出',
      operator: 'user03',
      note: 'AS9100D.pdf;AS9100E.pdf',
    },
    {
      site: '安来工場',
      ipAddress: '127.0.0.1',
      at: '2026-08-14T16:47:00',
      actionType: 'タスク失敗',
      feature: '条項比較',
      processCount: 2,
      pages: 0,
      totalPages: 72,
      durationMinutes: 5,
      detail: '差分抽出',
      operator: 'user04',
      note: 'AMS4911A.pdf;AMS4911B.pdf',
    },
    {
      site: '安来工場',
      ipAddress: '127.0.0.1',
      at: '2026-08-13T10:24:00',
      actionType: 'タスク中止',
      feature: 'スペックツリー',
      processCount: 1,
      pages: 41,
      totalPages: 92,
      durationMinutes: 8,
      detail: 'ツリー作成',
      operator: 'user05',
      note: 'P2TF1.pdf',
    },
    {
      site: '桶川工場',
      ipAddress: '192.168.1.10',
      at: '2026-08-12T09:45:00',
      actionType: 'タスク完了',
      feature: 'スペックツリー',
      processCount: 2,
      pages: 132,
      totalPages: 132,
      durationMinutes: 28,
      detail: 'ツリー作成',
      operator: 'user01',
      note: 'HT-STD-009.pdf;QA-REC-014.pdf',
    },
    {
      site: '東京工場',
      ipAddress: '192.168.3.10',
      at: '2026-08-11T13:18:00',
      actionType: 'タスク完了',
      feature: '条項比較',
      processCount: 2,
      pages: 118,
      totalPages: 118,
      durationMinutes: 31,
      detail: '差分抽出',
      operator: 'user06',
      note: 'ASTM-B117_2021.pdf;ASTM-B117_2024.pdf',
    },
    {
      site: '東京工場',
      ipAddress: '192.168.3.10',
      at: '2026-08-10T17:02:00',
      actionType: 'タスク失敗',
      feature: 'スペックツリー',
      processCount: 1,
      pages: 0,
      totalPages: 64,
      durationMinutes: 4,
      detail: 'ツリー作成',
      operator: 'user07',
      note: 'NADCAP-AC7102.pdf',
    },
    {
      site: '桶川工場',
      ipAddress: '192.168.1.10',
      at: '2026-06-30T10:00:00',
      actionType: 'タスク完了',
      feature: '条項比較',
      processCount: 2,
      pages: 200,
      totalPages: 200,
      durationMinutes: 18,
      detail: '差分抽出',
      operator: 'user01',
      note: 'AMS2750E.pdf;AMS2750F.pdf',
    },
    {
      site: '安来工場',
      ipAddress: '192.168.2.10',
      at: '2026-06-30T14:30:00',
      actionType: 'タスク完了',
      feature: 'スペックツリー',
      processCount: 2,
      pages: 30,
      totalPages: 30,
      durationMinutes: 26,
      detail: 'ツリー作成',
      operator: 'user02',
      note: 'M000378.pdf;M000412.pdf',
    },
    {
      site: '安来工場',
      ipAddress: '192.168.2.10',
      at: '2026-06-30T15:45:00',
      actionType: 'タスク完了',
      feature: 'スペックツリー',
      processCount: 1,
      pages: 25,
      totalPages: 25,
      durationMinutes: 14,
      detail: 'ツリー作成',
      operator: 'user03',
      note: 'M000501.pdf',
    },
    {
      site: '桶川工場',
      ipAddress: '192.168.1.10',
      at: '2026-06-29T09:15:00',
      actionType: 'タスク完了',
      feature: '条項比較',
      processCount: 2,
      pages: 250,
      totalPages: 250,
      durationMinutes: 32,
      detail: '差分抽出',
      operator: 'user01',
      note: 'AS9100D.pdf;AS9100E.pdf',
    },
    {
      site: '安来工場',
      ipAddress: '192.168.2.10',
      at: '2026-06-28T16:20:00',
      actionType: 'タスク完了',
      feature: 'スペックツリー',
      processCount: 1,
      pages: 40,
      totalPages: 40,
      durationMinutes: 21,
      detail: 'ツリー作成',
      operator: 'user04',
      note: 'M000388.pdf',
    },
    {
      site: '桶川工場',
      ipAddress: '192.168.1.10',
      at: '2026-06-28T11:40:00',
      actionType: 'タスク中止',
      feature: '条項比較',
      pages: 60,
      totalPages: 150,
      durationMinutes: 9,
      detail: '差分抽出',
      operator: 'user01',
      note: 'AMS5510J.pdf;AMS5510K.pdf',
    },
    {
      site: '安来工場',
      ipAddress: '192.168.2.10',
      at: '2026-06-27T17:10:00',
      actionType: 'タスク失敗',
      feature: 'スペックツリー',
      pages: 0,
      totalPages: 25,
      durationMinutes: 6,
      detail: 'ツリー作成',
      operator: 'user03',
      note: 'M000621.pdf',
    },
  ],
};

export function createInitialPromptTemplateConfigs() {
  const now = new Date().toISOString();
  const base = {
    promptText: 'Business extraction rules:\n- Exclude non-clause content such as tables of contents, prefaces, references, disclaimers, copyright notices, order information, contact information, licenses, watermarks, and document-distribution notices.\n- Preserve the original wording, terminology, numbers, punctuation, and meaning. Do not correct grammar, paraphrase, summarize, or add information that is not present in the document.\n- Keep every explicitly stated clause number in the original order. Start each clause on a new line. Merge only unnumbered continuation text that clearly belongs to the preceding clause.\n- Keep a clause heading, clause number, and clause body on separate lines when they appear as separate lines in the source. Do not merge them into one line.\n- Keep every paragraph on a separate line. Keep every numbered or bulleted list item on a separate line, including items beginning with 1), 2), (1), (2), -, ・, or •.\n- Treat parenthesized lists such as (1), (2), and (3) as part of the current clause, but preserve each list item on its own line.\n- If Japanese, English, or another language appears in separate source lines, preserve the language boundaries and keep those lines separate.\n- Preserve intentional line breaks in headings, paragraphs, and lists. Join only line breaks that are clearly caused by PDF layout within the same sentence.\n- Remove repeated headers, footers, and boilerplate even when they appear in the middle of a clause.\n- Treat numbered lists and bulleted lists as text. Classify content as a table or image only when its layout clearly has a table or image structure.\n- Do not infer, complete, reorder, or invent missing clause numbers, specifications, versions, prefixes, or suffixes.',
    specTreePromptText: 'PDF から仕様ツリーのノードと参照関係を抽出してください。\n\n業務ルール：\n- 仕様書名、仕様番号、ノード名、改訂記号、参照関係を原文どおりに保持する。\n- 本文、一覧、表、図面内の仕様書参照を確認し、親子関係を構成する。\n- すべての階層を抽出し、削除または補完されたノードの子ノードも同じ変更状態として扱う。\n- 入力に存在しない仕様番号、ファイル名、ノードを番号順から推測して追加しない。\n- 不明な参照は原文のまま保持し、黙って削除しない。',
    promptSections: {
      clause_compare: {
        extraction: 'タイトル、本文、条項番号、箇条書き、番号付きリスト、子条項を抽出し、原文と原番号を保持する。',
        structure: '条項番号から次の同階層番号の直前までを同一条項とし、番号のない続きのブロックを直前の条項に統合する。',
        textLayout: 'タイトルと本文、異なる言語の文章を改行して保持する。通常のリストや整列した文章はテキストとして抽出する。',
        mediaExceptions: '明確な行列構造を持つ表や図だけを画像として抽出し、端部の文字、脚注、注記を含める。ヘッダー、フッター、透かし、印章、注釈は除外し、項目番号を推測しない。',
      },
      spec_tree: {
        extraction: '仕様書名、仕様番号、ノード名、改訂記号、参照関係を原文どおりに抽出する。',
        structure: '原文の参照関係から親子階層を構成し、すべての階層を抽出する。削除または補完されたノードの子ノードも同じ変更状態として扱う。',
        textLayout: 'ノード名、仕様番号、ファイル名、必要な原文の改行を保持し、一覧や本文を漏れなく抽出する。',
        mediaExceptions: '表や図を途中で切断せず、端部の文字や脚注を含めて抽出する。入力にないノード、番号、ファイル名を生成しない。',
      },
    },
    exclusionRules: 'ヘッダー、フッター、著作権、透かし、印章、注釈は抽出しない。',
    crossPageRules: 'ヘッダーとフッターを除外したうえで、ページをまたぐ条項を継続して統合する。',
    newlinePolicy: '段落、リスト項目、番号付き項目、サブタイトルの前で改行する。',
    mergePolicy: 'PDF の行中にある意図しない改行だけを結合し、段落間の改行は保持する。',
    languageSeparation: '同一条項内の日本語と英語は改行して分ける。',
    includeCaption: true,
    captionToText: false,
    updatedAt: now,
    published: false,
  };
  const seriesPrompts = {
    default: base.promptText,
    ams: `${base.promptText}\n- For AMS documents, preserve the standard designation, slash suffix, revision letter, and table or figure references exactly as shown.`,
    astm: `${base.promptText}\n- For ASTM documents, preserve designations such as ASTM A370 and ASTM E8/E8M exactly, including letters, numbers, slashes, and revision suffixes.`,
    isajt: `${base.promptText}\n- For ISAJT documents, preserve Japanese and English lines separately, keep definition subitems under the current clause, and do not merge reference lists into one line.`,
    dmf: `${base.promptText}\n- For DMF documents, keep document numbers, revision marks, boxed text, and numbered requirements in their visible reading order without inferring missing items.`,
  };
  return [
    { id: 'default', series: ['その他'], name: 'その他（汎用）', isDefault: true, ...base, promptText: seriesPrompts.default },
    { id: 'ams', series: ['AMS'], name: 'AMS 標準抽出', isDefault: true, ...base, promptText: seriesPrompts.ams },
    { id: 'astm', series: ['ASTM'], name: 'ASTM 標準抽出', isDefault: true, ...base, promptText: seriesPrompts.astm },
    { id: 'isajt', series: ['ISAJT'], name: 'ISAJT 標準抽出', isDefault: true, ...base, promptText: seriesPrompts.isajt },
    { id: 'dmf', series: ['DMF'], name: 'DMF 標準抽出', isDefault: true, ...base, promptText: seriesPrompts.dmf },
  ];
}

function promptKeyForJobType(type) {
  return type === 'spec_tree' ? 'spec_tree.pipeline' : 'clause_compare.extract';
}

export function normalizeExtractionTemplate(template = {}) {
  const templateId = template.templateId || template.id || 'default';
  const fallback = store.extractionTemplates[templateId] || store.extractionTemplates.default;
  return {
    templateId,
    templateName: template.templateName || template.name || fallback.templateName,
    templateVersion: template.templateVersion || template.version || fallback.templateVersion,
  };
}

function variantIndex(seed = '', count = 1) {
  const text = String(seed || '');
  const total = Array.from(text).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return Math.abs(total) % Math.max(1, count);
}

const SPEC_TREE_VARIANTS = [
  {
    rootNo: 'M000378',
    rootLabel: 'M000378 Rev:C\\nSHAFT, LPT CONE',
    nodes: [
      { id: 'n1', label: 'ISAJT-P3TF2\\nFluorescent Penetrant Inspection', level: 1 },
      { id: 'n2', label: 'ISAJT-P4TF2\\nEtching of Superalloys', level: 1, changeType: '補完' },
      { id: 'n3', label: 'AMS 5596\\nNickel Alloy Sheet', level: 2 },
      { id: 'n4', label: 'P2TF1\\nRegulated Materials', level: 2 },
    ],
  },
  {
    rootNo: 'M000412',
    rootLabel: 'M000412 Rev:A\\nHEAT TREAT CONTROL',
    nodes: [
      { id: 'n1', label: 'AMS2750F\\nPyrometry', level: 1, changeType: '補完' },
      { id: 'n2', label: 'ASTM E220\\nThermocouple Calibration', level: 2 },
      { id: 'n3', label: 'SAE ARP1962\\nTemperature Sensors', level: 2 },
      { id: 'n4', label: 'NADCAP AC7102\\nHeat Treat Audit Criteria', level: 1, changeType: '削除' },
      { id: 'n5', label: 'HT-STD-009\\nBatch Records', level: 2 },
    ],
  },
  {
    rootNo: 'M000501',
    rootLabel: 'M000501 Rev:B\\nSURFACE TREATMENT',
    nodes: [
      { id: 'n1', label: 'MIL-C-5541\\nChromate Coating', level: 1, changeType: '削除' },
      { id: 'n2', label: 'MIL-C-13924\\nBlack Oxide Coating', level: 1 },
      { id: 'n3', label: 'ASTM B117\\nSalt Spray Test', level: 2 },
      { id: 'n4', label: 'ISO 9227\\nCorrosion Tests', level: 2 },
      { id: 'n5', label: 'P4TF8\\nSwab Etching', level: 1, changeType: '補完' },
      { id: 'n6', label: 'QA-REC-014\\nInspection Records', level: 2 },
    ],
  },
];

const CLAUSE_VARIANT_OVERRIDES = [
  {
    totalClauses: 6,
    changedClauses: 3,
    mutate(clauses) {
      return clauses;
    },
  },
  {
    totalClauses: 7,
    changedClauses: 4,
    mutate(clauses) {
      clauses[0].oldClauseNumber = '4.2';
      clauses[0].newClauseNumber = '4.2';
      clauses[0].oldContent = 'Quality records shall be retained for 5 years after shipment.';
      clauses[0].oldTranslation = '品質記録は出荷後5年間保管しなければならない。';
      clauses[0].newContent = 'Quality records shall be retained for 10 years after shipment and be traceable by lot number.';
      clauses[0].newTranslation = '品質記録は出荷後10年間保管し、ロット番号で追跡可能でなければならない。';
      clauses[1].oldClauseNumber = '5.1';
      clauses[1].newClauseNumber = '5.1';
      clauses[1].oldContent = 'Sampling shall be performed once per production lot.';
      clauses[1].oldTranslation = 'サンプリングは生産ロットごとに1回実施しなければならない。';
      clauses[1].newContent = 'Sampling shall be performed once per production lot and after each equipment change.';
      clauses[1].newTranslation = 'サンプリングは生産ロットごと、および設備変更ごとに実施しなければならない。';
      clauses[4].oldClauseNumber = '8.3';
      clauses[4].oldContent = 'Manual approval stamps are acceptable for legacy inspection records.';
      clauses[4].oldTranslation = '旧検査記録には手動承認印を使用できる。';
      clauses[5].newClauseNumber = '9.1';
      clauses[5].newContent = 'Electronic approval workflow shall be applied to all new inspection records.';
      clauses[5].newTranslation = 'すべての新規検査記録には電子承認ワークフローを適用しなければならない。';
      clauses.push({
        id: 'c7',
        oldClauseNumber: '',
        newClauseNumber: '9.2',
        oldContent: '',
        oldTranslation: '',
        oldImages: [],
        newContent: 'Audit trail data shall be exported with the monthly settlement counter.',
        newTranslation: '監査証跡データは月次精算用カウントとともに出力しなければならない。',
        newImages: [],
        status: '追加',
      });
      return clauses;
    },
  },
  {
    totalClauses: 5,
    changedClauses: 2,
    mutate(clauses) {
      const selected = [clauses[0], clauses[2], clauses[3], clauses[4], clauses[5]].map((clause) => ({ ...clause }));
      selected[0].oldClauseNumber = '2.1';
      selected[0].newClauseNumber = '2.1';
      selected[0].oldContent = 'Supplier certificates shall identify material grade and revision.';
      selected[0].oldTranslation = 'サプライヤ証明書には材料グレードおよび改訂を記載しなければならない。';
      selected[0].newContent = 'Supplier certificates shall identify material grade, revision, and country of origin.';
      selected[0].newTranslation = 'サプライヤ証明書には材料グレード、改訂、および原産国を記載しなければならない。';
      selected[1].oldClauseNumber = '2.2';
      selected[1].newClauseNumber = '2.2';
      selected[1].oldContent = 'Certificate review is required before receiving inspection.';
      selected[1].oldTranslation = '受入検査前に証明書レビューが必要である。';
      selected[1].newContent = 'Certificate review is required before receiving inspection.';
      selected[1].newTranslation = '受入検査前に証明書レビューが必要である。';
      selected[1].status = '無';
      selected[2].oldClauseNumber = '6.4';
      selected[2].newClauseNumber = '6.5';
      selected[2].oldContent = 'Dimensional inspection results shall be recorded on Form Q-12.';
      selected[2].oldTranslation = '寸法検査結果はフォームQ-12に記録しなければならない。';
      selected[2].newContent = 'Dimensional inspection results shall be recorded on Form Q-18 with digital measurement data.';
      selected[2].newTranslation = '寸法検査結果はデジタル測定データとともにフォームQ-18に記録しなければならない。';
      selected[3].oldClauseNumber = '7.8';
      selected[3].oldContent = 'Fax submission of deviation requests is permitted.';
      selected[3].oldTranslation = '逸脱申請はFAX提出を許可する。';
      selected[4].newClauseNumber = '8.1';
      selected[4].newContent = 'Deviation requests shall be submitted through the controlled portal.';
      selected[4].newTranslation = '逸脱申請は管理ポータルを通じて提出しなければならない。';
      return selected;
    },
  },
];

function seedHistorySessions() {
  for (const job of store.jobs) {
    if (!job.sessionId) continue;
    if (job.type === 'spec_tree' && !store.specTreeSessions.has(job.sessionId)) {
      store.specTreeSessions.set(job.sessionId, {
        sessionId: job.sessionId,
        files: [],
        run: { status: job.status, jobId: job.id },
        result: job.status === 'completed'
          ? {
              ...createSpecTreeResult(job)
            }
          : null,
        progress: { running: job.status === 'running', stage: job.status, progress: job.progress || 0 },
        createdAt: Date.parse(job.createdAt),
      });
    }
    if (job.type === 'clause_compare' && !store.clauseCompareSessions.has(job.sessionId)) {
      const [oldName = 'old.pdf', newName = 'new.pdf'] = job.title.includes(' vs ')
        ? job.title.split(' vs ')
        : ['old.pdf', 'new.pdf'];
      store.clauseCompareSessions.set(job.sessionId, {
        sessionId: job.sessionId,
        oldFile: { fileId: 'file-old', fileName: oldName.trim(), fileType: 'old' },
        newFile: { fileId: 'file-new', fileName: newName.trim(), fileType: 'new' },
        run: { status: job.status, jobId: job.id },
        result: job.status === 'completed' ? createClauseCompareResult(job) : null,
        progress: { running: job.status === 'running', stage: job.status, progress: job.progress || 0 },
        createdAt: Date.parse(job.createdAt),
      });
    }
  }
}

seedHistorySessions();

export function nextId(prefix = 'id') {
  return `${prefix}-${uuidv4().slice(0, 8)}`;
}

export function listPromptKeys() {
  return Object.keys(store.prompts).map((key) => {
    const versions = store.prompts[key];
    const active = getActiveVersion(versions);
    return {
      key,
      activeVersionId: active?.id,
      activeVersionName: active?.name,
      versionCount: versions.length,
    };
  });
}

export function getPromptDetail(key) {
  const versions = store.prompts[key];
  if (!versions) return null;
  const active = getActiveVersion(versions);
  return {
    key,
    activeVersion: active,
    versions: [...versions].sort((a, b) => b.version - a.version),
  };
}

export function createSpecTreeSession(files = [], {
  rootFileId = null,
  parentSessionId = null,
  sessionId = nextId('st'),
  templateByRootFileId = {},
} = {}) {
  const session = {
    sessionId,
    files,
    rootFileId,
    parentSessionId,
    templateByRootFileId,
    run: null,
    result: null,
    progress: { running: false, stage: 'queued' },
    createdAt: Date.now(),
  };
  store.specTreeSessions.set(sessionId, session);
  return session;
}

export function cloneSpecTreeSession(sourceSession, rootFileId) {
  return createSpecTreeSession(
    [...(sourceSession.files || [])],
    {
      rootFileId,
      parentSessionId: sourceSession.sessionId,
      templateByRootFileId: { ...(sourceSession.templateByRootFileId || {}) },
    },
  );
}

function rootFileLabel(session, rootFileId) {
  const file = (session.files || []).find((f) => f.id === rootFileId);
  return file?.name?.replace(/\.[^.]+$/, '') || rootFileId || 'root';
}

export function createSpecTreeJobsForRoots(session, rootFileIds = []) {
  const roots = rootFileIds.length > 0 ? rootFileIds : [session.rootFileId || null];
  const jobs = [];

  for (const rootFileId of roots) {
    const targetSession = roots.length > 1
      ? cloneSpecTreeSession(session, rootFileId)
      : session;
    targetSession.rootFileId = rootFileId;
    const title = `${rootFileLabel(session, rootFileId)} スペックツリー`;
    const template = normalizeExtractionTemplate(session.templateByRootFileId?.[rootFileId]);
    const job = addJob({
      type: 'spec_tree',
      title,
      sessionId: targetSession.sessionId,
      rootFileId,
      rootFileIds: roots.length > 1 ? [rootFileId] : roots,
      template,
    });
    jobs.push({ job, session: targetSession, rootFileId });
  }

  return jobs;
}

export function createClauseCompareSession({ sessionId = nextId('cc') } = {}) {
  const session = {
    sessionId,
    oldFile: null,
    newFile: null,
    selectedTemplate: normalizeExtractionTemplate(),
    run: null,
    result: null,
    progress: { running: false, stage: 'queued' },
    createdAt: Date.now(),
  };
  store.clauseCompareSessions.set(sessionId, session);
  return session;
}

const SPEC_TREE_STAGES = [
  { stage: 'queued', delay: 250, progress: 8 },
  { stage: 'running', delay: 350, progress: 14 },
  { stage: 'extracting_sources', delay: 700, progress: 28, pdfTotal: 3, pdfCompleted: 1 },
  { stage: 'building_spec_tree', delay: 900, progress: 72, requestTotal: 12, requestCompleted: 8 },
  { stage: 'packaging', delay: 400, progress: 94 },
  { stage: 'succeeded', delay: 150, progress: 100 },
];

const CLAUSE_STAGES = [
  { stage: 'queued', delay: 250, progress: 8 },
  { stage: 'running', delay: 350, progress: 14 },
  { stage: 'extracting_old_new', delay: 900, progress: 64, pageTotal: 86, pageCompleted: 42 },
  { stage: 'comparing', delay: 900, progress: 86, pageTotal: 86, pageCompleted: 76 },
  { stage: 'packaging', delay: 400, progress: 94, pageTotal: 86, pageCompleted: 86 },
  { stage: 'succeeded', delay: 150, progress: 100, pageTotal: 86, pageCompleted: 86 },
];

export function createSpecTreeResult(context = {}) {
  const seed = `${context.sessionId || ''}:${context.title || ''}:${context.rootFileId || ''}`;
  const variant = SPEC_TREE_VARIANTS[variantIndex(seed, SPEC_TREE_VARIANTS.length)];
  const annotatedNodes = [];
  const inheritedChangeTypes = [];
  for (const node of variant.nodes) {
    const level = Math.max(0, Number(node.level) || 0);
    inheritedChangeTypes.length = level;
    const inheritedChangeType = inheritedChangeTypes[level - 1] || '';
    const changeType = node.changeType || inheritedChangeType || '';
    inheritedChangeTypes[level] = changeType;
    annotatedNodes.push({ ...node, changeType });
  }
  const nodes = [
    { id: 'root', label: variant.rootLabel.replace('\\n', ' '), level: 0, changeType: '' },
    ...annotatedNodes,
  ];
  const lines = [
    'flowchart LR',
    `  root["${variant.rootLabel}"]`,
    ...annotatedNodes.map((node) => `  ${node.id}["${node.label}"]`),
    '  classDef supplementNode fill:#EAF7EF,stroke:#15803D,stroke-width:2px,color:#14532D',
    '  classDef deletedNode fill:#F1F5F9,stroke:#94A3B8,stroke-width:2px,color:#64748B,stroke-dasharray: 4 3',
  ];
  let parentId = 'root';
  for (const node of annotatedNodes) {
    if (node.level <= 1) {
      lines.push(`  root --> ${node.id}`);
      parentId = node.id;
    } else {
      lines.push(`  ${parentId} --> ${node.id}`);
    }
    if (node.changeType === '補完') {
      lines.push(`  class ${node.id} supplementNode`);
    } else if (node.changeType === '削除') {
      lines.push(`  class ${node.id} deletedNode`);
    }
  }
  return {
    mmdContent: lines.join('\n'),
    nodeCount: nodes.length,
    treeNodes: nodes,
  };
}

export function createClauseCompareResult(context = {}) {
  const title = `${context.title || ''}:${context.oldFile?.fileName || ''}:${context.newFile?.fileName || ''}`;
  if (/AMS2750/i.test(title)) {
    const result = structuredClone(MOCK_CLAUSE_COMPARE);
    const variant = CLAUSE_VARIANT_OVERRIDES[0];
    result.clauses = variant.mutate(structuredClone(result.clauses));
    result.totalClauses = variant.totalClauses;
    result.changedClauses = variant.changedClauses;
    return result;
  }
  const seed = `${context.sessionId || ''}:${context.title || ''}:${context.newFile?.fileName || ''}`;
  const variant = CLAUSE_VARIANT_OVERRIDES[variantIndex(seed, CLAUSE_VARIANT_OVERRIDES.length)];
  const result = structuredClone(MOCK_CLAUSE_COMPARE);
  result.clauses = variant.mutate(structuredClone(result.clauses));
  result.totalClauses = variant.totalClauses;
  result.changedClauses = variant.changedClauses;
  return result;
}

function stagesForType(type) {
  return type === 'spec_tree' ? SPEC_TREE_STAGES : CLAUSE_STAGES;
}

function resultForType(type, session = {}) {
  const job = store.jobs.find((item) => item.id === session.run?.jobId);
  const context = {
    ...session,
    title: job?.title || '',
  };
  return type === 'spec_tree' ? createSpecTreeResult(context) : createClauseCompareResult(context);
}

function composeProgressState(stages, stageIndex, running) {
  const state = {
    running,
    stage: stages[stageIndex]?.stage || stages[stages.length - 1].stage,
    progress: stages[stageIndex]?.progress || 0,
    pdfTotal: 0,
    pdfCompleted: 0,
    pageTotal: 0,
    pageCompleted: 0,
    requestTotal: 0,
    requestCompleted: 0,
  };

  for (let i = 0; i <= stageIndex; i += 1) {
    const step = stages[i];
    state.pdfTotal = step.pdfTotal ?? state.pdfTotal;
    state.pdfCompleted = step.pdfCompleted ?? state.pdfCompleted;
    state.pageTotal = step.pageTotal ?? state.pageTotal;
    state.pageCompleted = step.pageCompleted ?? state.pageCompleted;
    state.requestTotal = step.requestTotal ?? state.requestTotal;
    state.requestCompleted = step.requestCompleted ?? state.requestCompleted;
  }

  return state;
}

function getPipelineState(type, startedAt) {
  const stages = stagesForType(type);
  const elapsed = Math.max(0, Date.now() - Number(startedAt || Date.now()));
  const totalDuration = stages.reduce((sum, step) => sum + Math.max(0, Number(step.delay) || 0), 0);
  let stageIndex = stages.length - 1;
  let elapsedBoundary = 0;

  for (let i = 0; i < stages.length; i += 1) {
    elapsedBoundary += Math.max(0, Number(stages[i].delay) || 0);
    if (elapsed < elapsedBoundary) {
      stageIndex = i;
      break;
    }
  }

  return {
    complete: elapsed >= totalDuration,
    progress: composeProgressState(stages, stageIndex, elapsed < totalDuration),
  };
}

function removeRunningTask(jobId) {
  if (!jobId) return null;
  const index = store.runningTasks.findIndex((task) => task.jobId === jobId);
  if (index < 0) return null;
  const [task] = store.runningTasks.splice(index, 1);
  return task;
}

export function resolveTaskTarget(task, fallbackTitle = '') {
  if (task.type === 'spec_tree') {
    const names = (task.files || [])
      .map((file) => file.name || file.fileName || file.originalname)
      .filter(Boolean);
    if (names.length > 0) return names.join(';');
  }
  return fallbackTitle || '';
}

export function resolveRunDurationMinutes(startedAt, endedAt = Date.now()) {
  const start = Number(startedAt);
  if (!Number.isFinite(start) || start <= 0) return 0;
  return Math.max(1, Math.round((Number(endedAt) - start) / 60000));
}

function completeRunningTask(session) {
  const task = removeRunningTask(session.run?.jobId);
  if (!task) return;

  if (session.result) {
    cacheResult(task.type, task.files, session, task.options);
  }

  const completedJob = store.jobs.find((j) => j.id === task.jobId);
  if (completedJob && session.run?.status === 'completed') {
    appendSystemEvent({
      site: task.factory,
      ipAddress: task.ipAddress,
      actionType: 'タスク完了',
      feature: task.type === 'spec_tree' ? 'スペックツリー' : '条項比較',
      processCount: task.type === 'spec_tree' ? Math.max(1, task.files?.length || 1) : 2,
      pages: task.type === 'spec_tree' ? 124 : 86,
      totalPages: task.type === 'spec_tree' ? 124 : 86,
      durationMinutes: resolveRunDurationMinutes(session.run?.startedAt),
      detail: task.type === 'spec_tree' ? 'ツリー作成' : '差分抽出',
      operator: 'system',
      note: resolveTaskTarget(task, completedJob.title),
    });
  }

  processQueue();
}

export function refreshSessionRun(session) {
  if (!session?.run || session.run.status !== 'running') return session;
  if (!store.runningTasks.some((task) => task.jobId === session.run.jobId)) return session;
  const type = session.run.type;
  if (!type) return session;

  const { complete, progress } = getPipelineState(type, session.run.startedAt);
  session.progress = progress;

  const job = store.jobs.find((j) => j.id === session.run.jobId);
  if (job) {
    job.status = complete ? 'completed' : 'running';
    job.progress = complete ? 100 : Math.max(job.progress || 0, progress.progress || 0);
    job.updatedAt = new Date().toISOString();
  }

  if (complete) {
    session.result = resultForType(type, session);
    session.run.status = 'completed';
    session.progress = {
      ...composeProgressState(stagesForType(type), stagesForType(type).length - 1, false),
      progress: 100,
    };
    completeRunningTask(session);
  }

  return session;
}

export function refreshWorkQueue() {
  for (const task of [...store.runningTasks]) {
    refreshSessionRun(task.session);
  }
  processQueue();
}

export function startSpecTreeRun(session, { runId, jobId }) {
  if (session.run?.status === 'running') {
    const err = new Error('Another spec tree generation is already running');
    err.code = 'FEATURE_RUN_IN_PROGRESS';
    throw err;
  }
  session.result = null;
  session.run = { runId, jobId, type: 'spec_tree', status: 'running', startedAt: Date.now() };
  session.progress = composeProgressState(SPEC_TREE_STAGES, 0, true);
  const job = store.jobs.find((j) => j.id === jobId);
  if (job) {
    job.status = 'running';
    job.progress = 10;
    job.updatedAt = new Date().toISOString();
  }
}

export function startClauseCompareRun(session, { runId, jobId }) {
  session.result = null;
  session.run = { runId, jobId, type: 'clause_compare', status: 'running', startedAt: Date.now() };
  session.progress = composeProgressState(CLAUSE_STAGES, 0, true);
  const job = store.jobs.find((j) => j.id === jobId);
  if (job) {
    job.status = 'running';
    job.progress = 15;
    job.updatedAt = new Date().toISOString();
  }
}

export function cancelSessionRun(session) {
  if (session.run) {
    session.run.status = 'cancelled';
    const job = store.jobs.find((j) => j.id === session.run.jobId);
    if (job) {
      job.status = 'cancelled';
      job.updatedAt = new Date().toISOString();
    }
    removeRunningTask(session.run.jobId);
    processQueue();
  }
  session.progress = { running: false, stage: 'cancelled' };
  session.result = null;
}

export function addJob({
  type,
  title,
  sessionId = null,
  rootFileId = null,
  rootFileIds = null,
  factory = '',
  ipAddress = '',
  cacheHit = false,
  template = null,
}) {
  const promptKey = promptKeyForJobType(type);
  const activeVersion = getActiveVersion(store.prompts[promptKey]);
  const extractionTemplate = normalizeExtractionTemplate(template);
  const job = {
    id: nextId('job'),
    type,
    title,
    status: 'queued',
    progress: 0,
    promptVersionName: activeVersion?.name || '—',
    templateId: extractionTemplate.templateId,
    templateName: extractionTemplate.templateName,
    templateVersion: extractionTemplate.templateVersion,
    sessionId,
    rootFileId,
    rootFileIds: rootFileIds || (rootFileId ? [rootFileId] : null),
    factory,
    ipAddress: normalizeClientIP(ipAddress),
    cacheHit,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.jobs.unshift(job);
  return job;
}

export function appendSystemEvent(event) {
  const normalizedEvent = {
    site: event.site || '全体',
    at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    ...event,
    ipAddress: normalizeClientIP(event.ipAddress || ''),
  };
  store.systemEvents.unshift(normalizedEvent);

  const isBillableFeature = normalizedEvent.feature === 'スペックツリー' || normalizedEvent.feature === '条項比較';
  const isStarted = String(normalizedEvent.actionType || '').includes('開始');
  if (isBillableFeature && !isStarted) {
    store.license.monthlyUsed += Number(normalizedEvent.pages) || 0;
  }
}

// IPアドレスから工場名を取得する
export function getFactoryFromIP(ipAddress) {
  return store.ipFactoryMap[normalizeClientIP(ipAddress)] || '安来工場';
}

// 結果キャッシュをチェックする
export function getCachedResult(type, files, options = {}) {
  const cacheKey = generateCacheKey(type, files, options);
  const cached = store.resultCache.get(cacheKey);
  
  if (!cached) return null;
  
  // キャッシュが有効期限内かチェック
  const now = Date.now();
  const maxAge = 7 * 24 * 60 * 60 * 1000; // 7日間
  if (now - cached.cachedAt > maxAge) {
    store.resultCache.delete(cacheKey);
    return null;
  }
  
  return cached;
}

// 結果をキャッシュする
export function cacheResult(type, files, session, options = {}) {
  const cacheKey = generateCacheKey(type, files, options);
  store.resultCache.set(cacheKey, {
    sessionId: session.sessionId,
    result: session.result,
    cachedAt: Date.now(),
    factory: session.factory || '安来工場',
  });
}

// タスクをキューに追加する
export function enqueueTask(task) {
  store.taskQueue.push({
    ...task,
    queuedAt: Date.now(),
  });
  // キューをチェックして実行可能なら実行
  processQueue();
}

// キューを処理する
function processQueue() {
  for (const task of [...store.runningTasks]) {
    refreshSessionRun(task.session);
  }

  // 実行中のタスクが最大数に達していたら何もしない
  if (store.runningTasks.length >= store.maxConcurrentTasks) {
    return;
  }
  
  // キューから次のタスクを取得
  const task = store.taskQueue.shift();
  if (!task) return;
  
  // タスクを実行中リストに追加
  store.runningTasks.push(task);
  
  // タスク実行
  executeTask(task);
}

// タスクを実行する
function executeTask(task) {
  const { type, session, files, options, factory, ipAddress, jobId } = task;
  const job = store.jobs.find((j) => j.id === jobId);
  if (job) {
    job.factory = factory || job.factory || '安来工場';
    job.ipAddress = normalizeClientIP(ipAddress || job.ipAddress || '');
    job.status = 'running';
    job.updatedAt = new Date().toISOString();
  }
  
  appendSystemEvent({
    site: factory,
    ipAddress: ipAddress,
    actionType: 'タスク開始',
    feature: type === 'spec_tree' ? 'スペックツリー' : '条項比較',
    pages: 0,
    totalPages: type === 'spec_tree' ? 124 : 86,
    detail: type === 'spec_tree' ? 'ツリー作成' : '差分抽出',
    operator: 'system',
    note: `キャッシュなし - 新規実行`,
  });
  
  // 実際のタスク実行
  if (type === 'spec_tree') {
    startSpecTreeRun(session, { runId: task.runId, jobId: task.jobId });
  } else {
    startClauseCompareRun(session, { runId: task.runId, jobId: task.jobId });
  }
}

// キューの状態を取得する
export function getQueueStatus() {
  refreshWorkQueue();
  return {
    queued: store.taskQueue.length,
    running: store.runningTasks.length,
    maxConcurrent: store.maxConcurrentTasks,
    queue: [...store.taskQueue],
    runningTasks: [...store.runningTasks],
  };
}

// 期限切れデータをクリーンアップする
export function cleanupExpiredData() {
  const now = Date.now();
  const retentionMs = store.license.retentionDays * 24 * 60 * 60 * 1000;
  
  // キャッシュをクリーンアップ
  for (const [key, cached] of store.resultCache.entries()) {
    if (now - cached.cachedAt > retentionMs) {
      store.resultCache.delete(key);
    }
  }
  
  // 古いジョブをクリーンアップ（保持日数を超えたもの）
  const cutoff = now - retentionMs;
  store.jobs = store.jobs.filter(job => {
    const jobTime = Date.parse(job.updatedAt);
    return jobTime > cutoff;
  });
  
  // 古いセッションをクリーンアップ
  for (const [id, session] of store.specTreeSessions.entries()) {
    if (session.createdAt < cutoff) {
      store.specTreeSessions.delete(id);
    }
  }
  for (const [id, session] of store.clauseCompareSessions.entries()) {
    if (session.createdAt < cutoff) {
      store.clauseCompareSessions.delete(id);
    }
  }
  
  appendSystemEvent({
    site: 'システム',
    ipAddress: '127.0.0.1',
    actionType: 'クリーンアップ',
    feature: 'メンテナンス',
    pages: 0,
    detail: '期限切れデータ削除',
    operator: 'system',
    note: `保持期間${store.license.retentionDays}日を超えたデータをクリーンアップ`,
  });
}
