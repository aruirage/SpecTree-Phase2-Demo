import { v4 as uuidv4 } from 'uuid';
import { SPEC_TREE_BASE_SYSTEM, SPEC_TREE_BASE_SYSTEM_BLOCKS } from './specTreeBaseSystem.js';
import { CLAUSE_COMPARE_BASE_SYSTEM, CLAUSE_COMPARE_BASE_SYSTEM_BLOCKS } from './clauseCompareBaseSystem.js';
import {
  createInitialJobs,
  createInitialPrompts,
  MOCK_CLAUSE_COMPARE,
  MOCK_CLAUSE_COMPARE_RISKY,
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
  // ルール定数（CLAUSE_COMPARE_RULES / SPEC_TREE_RULES）は本オブジェクトより後に宣言しているため、
  // ここでは空にしておき、モジュール評価の最後（ファイル末尾）で初期化する。
  promptTemplateConfigs: [],
  extractionTemplates: {
    ams: { templateId: 'ams', templateName: 'AMS 標準抽出', templateVersion: 'v1.0' },
    astm: { templateId: 'astm', templateName: 'ASTM 標準抽出', templateVersion: 'v1.0' },
    isajt: { templateId: 'isajt', templateName: 'ISAJT 標準抽出', templateVersion: 'v1.0' },
    dmf: { templateId: 'dmf', templateName: 'DMF・DOC 標準抽出', templateVersion: 'v1.0' },
    msj: { templateId: 'msj', templateName: 'MSJ 標準抽出', templateVersion: 'v1.0' },
    fasop: { templateId: 'fasop', templateName: 'FASOP 標準抽出', templateVersion: 'v1.0' },
    aq: { templateId: 'aq', templateName: 'AQ 標準抽出', templateVersion: 'v1.0' },
    kq: { templateId: 'kq', templateName: 'KQ 標準抽出', templateVersion: 'v1.0' },
    rr: { templateId: 'rr', templateName: 'RR 標準抽出', templateVersion: 'v1.0' },
    mil: { templateId: 'mil', templateName: 'MIL 標準抽出', templateVersion: 'v1.0' },
    default: { templateId: 'default', templateName: '1期共通テンプレート', templateVersion: 'v1.0' },
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

/**
 * 条項比較の抽出ルール。現行システムが実際にモデルへ送っている「ユーザー側」プロンプトの原文。
 *
 * 出典（逐語。改変しない）:
 *   - スキャン文書   : src/prompts/clause_compare/gemini_page_rules.json の task / rules
 *   - テキスト層あり : src/pdf_clause_csv/llm_openai.py::_build_page_image_only_prompt の task / notes
 * 現行システムは系列ごとの差を持たず、全系列で同じ 1 セットを使う。
 */
const CLAUSE_COMPARE_RULES = {
  scan: {
    label: 'スキャン文書（画像から読み取る）',
    task: `Extract clause-like text and table/figure regions from this PDF page.`,
    // 実際の payload のキー順: task → page → raw_text → rules
    rulesKey: 'rules',
    runtimeFields: { page: '{{page}}', raw_text: '{{raw_text}}' },
    rules: [
      `Return valid JSON only.`,
      `Schema: {"page":N,"clauses":[{"id":"...","text":"..."}],"assets":[{"kind":"table|figure","ref":"Table 1","caption":"...","bbox":[x0,y0,x1,y1],"clause_ids":["..."]}]}`,
      `Use bbox normalized to 0..1000 relative to the full page image.`,
      `Only include clause-like content, not headers, footers, page numbers, table of contents, or copyright lines.`,
      `Only use numbered clause ids such as '1', '1.1', or '3.4.5'. Do not emit front matter headings like 'RATIONALE' as clauses.`,
      `Never invent clause ids: use only clause numbers visibly printed in the document.`,
      `List markers like '1)', '2)', 'a)', 'b)', '(1)', '(2)' (also full-width '1）', '（1）', 'a）') are list items, not clause ids. Keep them inside the text of the current parent numbered clause in reading order; do not output them as separate clauses and do not fabricate dotted ids such as '6.7.2.2' or '6.7.2.2.a' for them. Never renumber a list item into a dotted clause id (for example '2)' under '6.8.5.1' must not become '6.8.5.1.2').`,
      `Only emit a table asset when the region is a table by these rules: (1) it has visible table border lines (grid lines), or (2) it has a visible table title/caption such as '表3', 'Table 3', or '様式N', or (3) it is borderless but is genuine tabular data — a grid of value cells like 'P / S / P+S' with percentage values, or '焼準 / 焼戻 / 硬さ' with temperature or hardness values.`,
      `Do not emit a table asset for borderless aligned text that is not a data grid: specification lists, label/value rows, and form-like rows where each line is a label with prose (for example '・図面またはスペック | SPS-0203 修正意見書') are clause text, not tables.`,
      `Do not transcribe the content of a region that you emit as a table/figure asset into clause text; clause text and table assets must not duplicate the same content. EXCEPTION: if the region continues content from the previous page (cross-page continuation), transcribe its textual content as a continuation clause with an empty id in addition to emitting the asset.`,
      `If a table or list on this page is the continuation of a clause from the previous page (for example a standards list, specification list, or clause body that continues across the page break, possibly rendered as table rows), you MUST transcribe its visible text as a clause with an empty id so the previous page's clause is complete. Do not drop continuation content just because it looks like a table.`,
      `If a table is cut off at the bottom edge of this page (rows continue on the next page) or starts at the top edge as a continuation of a table from the previous page, still emit the visible portion as a table asset with its bbox covering the visible part. Never skip a table because it is partially visible.`,
      `Preserve normal word spacing in English text. Do not concatenate words: output 'APPLICABLE DOCUMENTS', not 'APPLICABLEDOCUMENTS'; 'is equivalent to a dead band', not 'isequivalenttoadeadband'.`,
      `Treat text extraction as transcription, not rewriting. Preserve exact words, singular/plural forms, verb forms, and word endings: do not change 'Control' to 'Controls' or 'represented' to 'represents'.`,
      `Preserve any wording exactly. Do not paraphrase synonymous expressions`,
      `Do not correct grammar, style, or terminology. If raw_text and the image differ only by a possible OCR/vision ambiguity, prefer the exact token sequence from raw_text for clause text.`,
      `Use the provided raw_text as a spacing hint when the page image OCR is ambiguous, but keep text faithful to the visible document.`,
      `If this page begins with continuation text from the previous page and there is no new clause id, set id to an empty string.`,
      `If this page begins with list items (markers like 'l)', '3)', 'a)', '(4)', '（2）') whose parent clause is on a previous page, do NOT use those markers as clause ids. Emit them as clauses with an EMPTY id, keeping the list marker at the start of the text so they merge into the previous page's clause.`,
      `Combine a clause heading and its body into a single text field when both are visible on this page. Use a newline (\\n) to separate the heading title from the body text: for example, '3.1 Composition' followed by 'Shall conform to...' should become 'Composition\\nShall conform to...' (heading title, then \\n, then body). This preserves the visual structure from the PDF where the title is on one line and the body starts on the next line.`,
      `Do NOT merge a numbered parent heading with a numbered child clause. For example, '1. 目的' and '1.1 ...' must be returned as two separate clause items in reading order.`,
      `Only emit assets when a clear table or figure region is visible on the page.`,
      `If a clause contains a separate table region that qualifies by the table rules above, keep the clause sentence in clauses and also emit the table region as a table asset with its own bbox.`,
      `For ref, use visible caption refs like Table 3 / Figure 2 when clear. Otherwise use an empty string.`,
    ],
  },
  textLayer: {
    label: 'テキスト層がある文書（ページ画像から抽出）',
    task: `Extract the clauses visible on this single PDF page image.`,
    // 実際の payload のキー順: task → page → page_count → notes
    rulesKey: 'notes',
    runtimeFields: { page: '{{page}}', page_count: '{{page_count}}' },
    rules: [
      `Use only the attached full-page image as input.`,
      `Do not use or request text blocks, chunk payloads, raw_text hints, or OCR side channels.`,
      `Return clauses in visible reading order for this page.`,
      `If a page has no clauses, return an empty clauses array.`,
      `Do not include footer/disclaimer/copyright/order/contact/license/watermark text, document-distribution boilerplate, or legal boilerplate in any clause text.`,
      `Use table_images as an empty array; table images are attached later by the deterministic pipeline.`,
    ],
  },
  // 翻訳の規則は**置かない**。1 期に翻訳は存在しない。
  // 現行 system prompt（src/prompts/clause_compare/gemini_page.json）が
  // "Do not translate keys" / "Keep the original language of the document text" と明記している。
  // 翻訳は二期の追加機能で、系列テンプレートが SERIES_DEFS[].translationRules で
  // 自前の規則を持ったときだけ「翻訳」モジュールに中身が入る。1期共通テンプレートでは空。
};

/**
 * テンプレートを構成する「モジュール」。1 モジュール＝1 責務。
 *
 * 画面に出す業務ルールは、1期共通テンプレートでは 1 期原文を去重したもの（layer 'fixed'）、
 * 系列テンプレートでは実 PDF の版式に合わせた系列固有のルール（layer 'user'）。
 * 実行時の 1 期原文（CLAUSE_COMPARE_RULES / clauseCompareBaseSystem）は別途保持し、
 * demo の送信内容は変えない。
 *
 * hidden モジュールは処理形式（JSON / Schema 等）。画面には出さない。
 */
const TEMPLATE_MODULES = [
  {
    id: 'text_extraction',
    name: 'テキスト抽出',
    responsibility: '条項の本文を読み取る。読み取った文字をそのまま書き写す（転写）原則。',
    businessRules: [
      {
        timing: 'scan',
        text: 'Treat text extraction as transcription, not rewriting. Preserve exact words, singular/plural forms, verb forms, and word endings; do not paraphrase or correct grammar, style, or terminology.',
      },
      {
        timing: 'scan',
        text: 'Keep the original language of the document text. Do not translate keys or body text unless a translation rule is configured.',
      },
      {
        timing: 'scan',
        text: 'When the page image is ambiguous, use raw_text (if provided) only as a spacing/token hint while keeping the visible document wording.',
      },
    ],
  },
  {
    id: 'page_handling',
    name: 'ページの扱い',
    responsibility: 'ページをまたぐ続き、ページ端で切れた表、読取り順。',
    businessRules: [
      {
        timing: 'scan',
        text: 'If this page continues a clause, table, or list from the previous page (including list markers whose parent clause is on a previous page), emit the continuation with an empty clause id so it can merge into the previous clause.',
      },
      {
        timing: 'scan',
        text: 'If a table is cut off at the page edge, still emit the visible portion as a table asset. Never skip a partially visible table.',
      },
      {
        timing: 'text',
        text: 'Return clauses in visible reading order for this page.',
      },
    ],
  },
  {
    id: 'asset_boundary',
    name: '画像・テキストの境界',
    responsibility: 'どの領域を画像として切り出し、どれを本文にするか。キャプションの帰属。',
    businessRules: [
      {
        timing: 'scan',
        text: 'Emit a table asset only when the region has visible table border lines, a visible table title/caption (表N / Table N / 様式N), or is borderless but genuine tabular data (value grids). Borderless aligned text, specification lists, and label/value prose rows are clause text, not tables.',
      },
      {
        timing: 'scan',
        text: 'Do not transcribe into clause text a region that you emit as a table/figure asset (no duplicate content), except for cross-page continuation which must also be transcribed with an empty id.',
      },
      {
        timing: 'scan',
        text: 'Only emit assets when a clear table or figure region is visible. Keep the clause sentence in clauses and also emit a qualifying separate table region as its own asset. For ref, use visible captions like Table 3 / Figure 2 when clear; otherwise leave ref empty. If ref or bbox is unclear, leave ref empty or skip the asset.',
      },
    ],
  },
  {
    id: 'clause_id',
    name: '条項番号',
    responsibility: '番号の拾い方・正規化。番号のない項目（リスト記号など）の帰属。',
    businessRules: [
      {
        timing: 'scan',
        text: "Only use numbered clause ids such as '1', '1.1', or '3.4.5'. Do not emit front matter headings like 'RATIONALE' as clauses. Never invent clause ids — use only numbers visibly printed as standalone clause numbers.",
      },
      {
        timing: 'scan',
        text: "List/enumeration markers such as '1)', '2)', 'a)', '(1)' (including full-width forms) are list items inside the current numbered clause, not clause ids. Keep them in the parent clause text; do not emit them as separate clauses or fabricate dotted ids.",
      },
      {
        timing: 'scan',
        text: "Keep each explicitly printed numbered clause as its own row. Do not merge a parent heading with its numbered child (for example '1' and '1.1' stay separate).",
      },
    ],
  },
  {
    id: 'exclusion',
    name: '除外',
    responsibility: 'ヘッダー・フッター・ページ番号・目次・著作権・免責を本文に含めない。',
    businessRules: [
      {
        timing: 'scan',
        text: 'Do not include headers, footers, page numbers, table of contents, copyright, disclaimer, watermark, document-distribution or legal boilerplate in clause text. Omit the clause id from the text field when it appears as a label.',
      },
    ],
  },
  {
    id: 'layout',
    name: 'レイアウト',
    responsibility: '改行・語間スペース・見出しと本文の結合。',
    businessRules: [
      {
        timing: 'scan',
        text: 'Preserve normal word spacing in English text (do not concatenate words). Preserve visual line breaks as \\n; merge hyphenated line-break word splits only (e.g. represen-ted → represented).',
      },
      {
        timing: 'scan',
        text: 'When a clause heading and its body are both visible on this page, combine them into one text field with a newline between title and body. Do not merge a numbered parent heading with a numbered child clause.',
      },
    ],
  },
  {
    id: 'translation',
    name: '翻訳',
    responsibility: '訳文を付けるか、どの言語へ。規格番号・改訂記号は原文のまま。',
    businessRules: [],
  },
  {
    // 処理形式。画面には出さない。1 期の user メッセージ原文と揃えるためデータは保持する。
    id: 'output_format',
    name: '出力形式',
    responsibility: 'JSON・Schema・座標系・入力チャネルなど、システム側の処理形式。画面には出さない。',
    hidden: true,
    entries: [
      { timing: 'scan', section: 'scan', index: 0 },
      { timing: 'scan', section: 'scan', index: 1 },
      { timing: 'scan', section: 'scan', index: 2 },
      { timing: 'text', section: 'textLayer', index: 0 },
      { timing: 'text', section: 'textLayer', index: 1 },
      { timing: 'text', section: 'textLayer', index: 3 },
      { timing: 'text', section: 'textLayer', index: 5 },
    ],
  },
];

/**
 * 系列定義。【C】系列別ルールと、その根拠データをまとめて持つ。
 *
 * 系列の切り方＝「規格番号のプレフィックス体系」＝顧客ごとの規格体系。
 * 根拠:
 *   - 正式版/一期/本番チューニングData（本番チューニング用の実 PDF 255 件。分類＝顧客フォルダ名）
 *   - 正式版/一期/训练数据明细.xlsx（分類 / ファイル名 / 抽出章節）
 *   - 正式版/二期/一期问题汇总/260903_comp不具合・260903_st不具合（二期の不具合サンプル）
 *   - 正式版/二期/一期问题汇总/D空调一期客户反馈问题汇总.xlsx（問題 No. 1〜12）
 *
 * 現行システムには系列別の分岐が無い（全系列で同じ 1 セット）ため、これらは
 * 二期で導入する「系列別テンプレート」のドラフト。顧客サンプルと期待抽出結果で確定させる。
 */

/**
 * 4 系列テンプレートの「系列差分」ルール。
 * アップロード時はテンプレート単体が適用されるため、共通抽出ルールは TEMPLATE_MODULES.businessRules
 * を必ず土台にし、ここに書いた差分だけを後ろへ足す（置換しない）。
 * 単一 PDF 名に過学習せず、系列版式の特徴だけを書く。根拠 PPT：規格ごとのプロンプト説明資料。
 */
const SERIES_MODULE_RULES = {
  ams: {
    // AMS 系：英文テキスト層・網掛け本文・(1)(2) は条項にしない・Table/Figure 有無両方
    text_extraction: [
      { timing: 'text', text: 'AMS-series documents are English-only material/process specifications, usually with a text layer.' },
      { timing: 'text', text: 'Text printed on a grey or shaded background is still clause body. Extract it; do not skip shaded paragraphs.' },
    ],
    asset_boundary: [
      { timing: 'text', text: 'Do not treat grey/shaded backgrounds as table borders. Shading alone does not make a region a table asset.' },
      { timing: 'text', text: 'Emit a table asset both for regions labeled Table/Figure and for unlabeled tabular grids that are clearly tables.' },
    ],
    clause_id: [
      { timing: 'text', text: 'AMS uses decimal clause ids such as 1, 1.1, 1.2. Markers like (1)(2) inside the body are not separate clause ids — keep them inside the parent clause text.' },
    ],
    layout: [
      { timing: 'text', text: 'Keep every line break of the content column; do not collapse multi-line AMS body into a single line.' },
    ],
  },
  isajt: {
    // ISAJT 系：日英同等・ハイフン条項（2-1）・英字付き節/別紙・切出し後も本文を残す
    text_extraction: [
      { timing: 'scan', text: 'ISAJT-series specifications typically have Japanese and English with equal content. Extract Japanese clause text with the same completeness as English; do not skip Japanese-only paragraphs.' },
    ],
    page_handling: [
      { timing: 'scan', text: 'Include 別紙 / appendix blocks that continue across pages in the same reading-order pass as the main clauses.' },
    ],
    asset_boundary: [
      { timing: 'scan', text: 'When a region is cut out as a table/figure image, do not drop the text inside that region; keep its textual content as clause text as well.' },
      { timing: 'scan', text: 'Also treat clear image regions without a “Table”/“Figure” caption as assets when they are visual blocks. Borderless bilingual label/value rows stay as clause text.' },
    ],
    clause_id: [
      { timing: 'scan', text: 'ISAJT often uses hyphen section ids such as 2-1 (not rewritten as 2.1). Keep the printed form.' },
      { timing: 'scan', text: 'Letter-suffixed ids such as 別紙 3A / 3B are valid clause ids. Keep them as printed.' },
    ],
    layout: [
      { timing: 'scan', text: 'Preserve line breaks between Japanese and English lines when both appear in the same clause block.' },
    ],
  },
  aq: {
    // AQ 系：日英併記（日本語の直後に英語）・条項内の仕様一覧はテキスト・入力に無い情報を出さない
    text_extraction: [
      { timing: 'scan', text: 'AQ-series documents are bilingual quality-control procedures. Extract Japanese clause lines completely; do not skip Japanese text that sits with English.' },
      { timing: 'scan', text: 'Do not output any information that is not present in the input. Never invent missing procedure steps or clause numbers.' },
    ],
    asset_boundary: [
      { timing: 'scan', text: 'A specification list or table inside an AQ clause must be extracted as clause text. Do not replace it with a table image only.' },
    ],
    clause_id: [
      { timing: 'scan', text: 'List markers such as 1), 2), a), b) under an AQ parent belong inside that parent clause text, not as separate clause ids.' },
    ],
    layout: [
      { timing: 'scan', text: 'AQ often places a Japanese paragraph immediately followed by its English. Keep them as consecutive separate lines; do not smash into one line.' },
    ],
  },
  fasop: {
    // FASOP 系：全編日本語・全角数字の条項
    text_extraction: [
      { timing: 'scan', text: 'FASOP-series documents are written in Japanese throughout. Extract Japanese clause text completely; do not skip paragraphs because they lack English.' },
    ],
    clause_id: [
      { timing: 'scan', text: 'FASOP often prints clause numbers in full-width digits (全角). Keep them as printed; do not force-normalize to half-width as a reason to drop or renumber.' },
    ],
    layout: [
      { timing: 'scan', text: 'Preserve Japanese line breaks and indentation used for 項/号 lists.' },
    ],
  },
};

const SERIES_DEFS = [
  {
    id: 'ams',
    series: ['AMS'],
    name: 'AMS 標準抽出',
    trainingFiles: 24,
    problemSamples: ['AMS5662 N', 'AMS5662 P'],
    rules: [
      // 問題 #4 AMS5662P「英文条款灰色部分未提取」
      'Text printed on a grey or shaded background is still clause body text. Extract it; do not skip it and do not treat the shading as a table border.',
      // 問題 #12 AMS5662P「記載内容列内の書式が改行されない」
      'Keep every line break of the 記載内容 (content) column; do not collapse multiple lines into a single line.',
    ],
    // デモ用の記入例。顧客がやりがちな「効かない書き方」を 2 件だけ置いてある。
    // 編集画面の「追加ルール」に出る。チェックで「無効」と判定され、保存も拒否される。
    // コンパイル時にも弾かれるため、出力（モデルへ渡す内容）には混ざらない。
    draftRules: [
      'When a clause has no number, invent a sequential clause id so that every row has one.',
      'Output plain text, not in JSON, so that the result is easy to read.',
    ],
    // AMS 系：英文のみ → 原文保持＋日本語訳が必要（系列共通）
    translationRules: [
      'AMS-series source text is English only. Translate every extracted clause into Japanese.',
      'Keep the original English clause text and add the Japanese translation as a separate field.',
    ],
  },
  {
    id: 'astm',
    series: ['ASTM'],
    name: 'ASTM 標準抽出',
    trainingFiles: 18,
    problemSamples: [],
    rules: [],
  },
  {
    id: 'isajt',
    series: ['ISAJT'],
    name: 'ISAJT 標準抽出',
    trainingFiles: 38,
    problemSamples: ['ISAJT-02280 AK', 'ISAJT-02280 AL'],
    rules: [
      // ISAJT 系の系列特徴（単一ファイルに過学習しない）
      'Japanese clause text must be extracted with the same completeness as English text. Do not skip a clause just because it is written only in Japanese.',
      'When a region is cut out as a table/figure image, do not drop the text inside that region; keep its textual content as clause text as well.',
      'Hyphen section ids such as 2-1, and letter-suffixed ids such as 別紙 3A / 3B, are valid clause ids. Keep the printed form.',
    ],
    // ISAJT 系：日英同等 → 日本語を本文として出す（再翻訳しない）
    translationRules: [
      'ISAJT-series specifications contain a Japanese version and an English version with equal content.',
      'Output the Japanese version as the clause text, as-is. Do not re-translate the English side.',
    ],
  },
  {
    id: 'dmf',
    series: ['DMF', 'DOC'],
    name: 'DMF・DOC 標準抽出',
    trainingFiles: 20,
    problemSamples: ['DMF12713-01 E', 'DOC00300273 A'],
    rules: [
      // 問題 #5「枠線があるため抽出できない」（DMF12713-01 / DOC00300273）
      'A chapter or table enclosed by a border/frame is still a chapter. Do not skip it because it has a frame.',
    ],
  },
  {
    id: 'msj',
    series: ['MSJ'],
    name: 'MSJ 標準抽出',
    trainingFiles: 39,
    problemSamples: ['MSJ4000 改AB'],
    rules: [
      // 問題 #1 MSJ4000「日本語条項の欠落」
      'Japanese clause text must be extracted with the same completeness as English text. Do not skip a clause just because it is written only in Japanese.',
      // 問題 #6 MSJ4000「入力に無い情報を出力」
      'Do not output any information that is not present in the input.',
    ],
  },
  {
    id: 'fasop',
    series: ['FASOP'],
    name: 'FASOP 標準抽出',
    trainingFiles: 9,
    problemSamples: ['FASOP Q-009 H', 'FASOP Q-009 I'],
    rules: [
      // FASOP 系：全編日本語・全角数字の条項を落さない
      'Japanese clause text must be extracted completely. Do not skip a clause because there is no English side.',
      'Full-width (全角) clause numbers are valid; keep them as printed and do not drop them when normalizing digits.',
    ],
    // FASOP 系：全編日本語 → 翻訳不要
    translationRules: [
      'FASOP-series source text is already written in Japanese.',
      'Output it as-is. Do not translate into English.',
    ],
  },
  {
    id: 'aq',
    series: ['AQ'],
    name: 'AQ 標準抽出',
    trainingFiles: 3,
    problemSamples: ['AQ-112 BA'],
    rules: [
      // AQ 系の系列特徴
      'Japanese clause text must be extracted with the same completeness as English text. Do not skip a clause just because it is written only in Japanese.',
      'A specification list or table inside a clause must be extracted as clause text. Do not replace it with a table image only.',
      'Do not output any information that is not present in the input.',
    ],
    // AQ 系：日本語段落の直後に英語。併記英語は再翻訳しない
    translationRules: [
      'AQ-series documents are bilingual: a Japanese paragraph is often followed immediately by English.',
      'Output the Japanese line as the clause text, as-is. Do not re-translate the paired English.',
    ],
  },
  {
    id: 'kq',
    series: ['KQ'],
    name: 'KQ 標準抽出',
    trainingFiles: 6,
    problemSamples: ['KQ-7201 Rev.z', 'KQ-7201 Rev.aa'],
    rules: [
      // 問題 #7 KQ-7201「本来テキストの条項を画像として抽出」
      'A specification list inside a clause is clause text, not a table image.',
      // 問題 #2 KQ-7201「画像切り出し後に情報が欠落」
      'When a region is cut out as a table/figure image, include the whole region; never cut text at the boundary.',
    ],
  },
  {
    id: 'rr',
    series: ['RR'],
    name: 'RR 標準抽出',
    trainingFiles: 20,
    problemSamples: [],
    rules: [],
  },
  {
    id: 'mil',
    series: ['MIL'],
    name: 'MIL 標準抽出',
    trainingFiles: 6,
    problemSamples: [],
    rules: [],
  },
  {
    id: 'default',
    series: ['その他'],
    name: 'その他（汎用）',
    trainingFiles: 3,
    problemSamples: [],
    rules: [],
  },
];

const SERIES_BY_ID = Object.fromEntries(SERIES_DEFS.map((item) => [item.id, item]));

/**
 * テンプレートとして公開する系列（2026-10-16 ユーザー指定）。
 * AMS / ISAJT / AQ / FASOP の 4 系列＋1期共通テンプレート。
 * SERIES_DEFS には他系列の根拠データも残してあるが、画面には出さない。
 */
const TEMPLATE_SERIES_IDS = ['ams', 'isajt', 'aq', 'fasop'];
const TEMPLATE_SERIES_DEFS = TEMPLATE_SERIES_IDS.map((id) => SERIES_BY_ID[id]).filter(Boolean);

/** 時機の表示名。userRules の見出しと、モジュール内のグルーピングに使う。 */
const TIMING_LABELS = {
  scan: CLAUSE_COMPARE_RULES.scan.label,
  text: CLAUSE_COMPARE_RULES.textLayer.label,
  // 1 期に翻訳規則は無いので、これは二期で追加する区分の名前（系列テンプレートだけが持つ）。
  common: '翻訳（抽出した条項に訳文を付ける）',
  series: '追加ルール',
};
const TIMING_ORDER = ['scan', 'text', 'common', 'series'];

/**
 * 業務ルール配列を結合する。同じ本文は 1 回だけ残す（共通＋系列差分の重複を避ける）。
 */
function mergeBusinessRuleItems(baseItems = [], extraItems = []) {
  const seen = new Set();
  const out = [];
  for (const item of [...baseItems, ...extraItems]) {
    const text = typeof item === 'string' ? item : item?.text;
    if (!text) continue;
    const key = text.replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      timing: (typeof item === 'string' ? 'scan' : item.timing) || 'scan',
      text,
    });
  }
  return out;
}

/**
 * テンプレート 1 件分のモジュールを組み立てる。
 * モジュールの並びと名前は全テンプレートで同じ（固定）。違いは中身だけ:
 *   - 業務抽出ルール: 全テンプレートが 1期共通の businessRules を土台にする。
 *     系列テンプレートは SERIES_MODULE_RULES（系列差分）をその後ろへ足す。
 *     ※アップロード時は選んだテンプレートだけが効くので、共通を落とすと漏れる。
 *   - 1 期の system プロンプト: 画面には載せない（実行時は baseSystemForTemplate が定数から返す）
 *   - 翻訳: 1 期に翻訳規則は無い。系列が自前の規則（translationRules）を持つときだけ入る
 *   - 追加ルール: 系列固有のルール（rules）。1期共通テンプレートでは空
 */
export function buildModulesForTemplate(seriesId = null) {
  const def = seriesId ? SERIES_BY_ID[seriesId] : null;
  const modules = TEMPLATE_MODULES.map((mod) => {
    let rules;
    if (mod.id === 'translation') {
      // 1 期に翻訳は無いので共通の雛形は持たない。系列が自前の規則を持つときだけ入る。
      const texts = def && Array.isArray(def.translationRules) ? def.translationRules : [];
      rules = texts.map((text, index) => ({ timing: 'common', layer: 'user', order: index, text }));
    } else if (mod.hidden && Array.isArray(mod.entries)) {
      // 処理形式：1 期 user メッセージ原文をデータとして保持（画面には出さない）。
      rules = mod.entries.map((entry) => ({
        timing: entry.timing,
        section: entry.section,
        order: entry.index,
        layer: 'user',
        text: CLAUSE_COMPARE_RULES[entry.section].rules[entry.index],
      }));
    } else {
      // 共通抽出ルールを土台にし、系列差分だけを後ろへ足す（置換しない）。
      const seriesExtra = def?.id ? SERIES_MODULE_RULES[def.id]?.[mod.id] : null;
      const source = mergeBusinessRuleItems(mod.businessRules || [], Array.isArray(seriesExtra) ? seriesExtra : []);
      rules = source.map((item, index) => ({
        timing: item.timing || 'scan',
        layer: 'user',
        order: index,
        text: item.text,
      }));
    }
    return {
      id: mod.id,
      name: mod.name,
      responsibility: mod.responsibility,
      hidden: mod.hidden === true,
      rules,
    };
  });
  // 系列別の追加ルールは、どのテンプレートにも同じ位置・同じ名前で置く。
  // 中身だけがテンプレートごとに違う（1期共通テンプレートは空）。
  // draftRules は編集画面にだけ出る記入例。チェックで弾かれるため出力には混ざらない。
  const seriesModule = {
    id: 'series_rules',
    name: '追加ルール',
    responsibility: 'このテンプレートだけに適用する追加ルール。',
    rules: [...(def?.rules || []), ...(def?.draftRules || [])].map((text, index) => ({
      timing: 'series',
      layer: 'user',
      order: index,
      text,
    })),
  };
  modules.splice(modules.length - 1, 0, seriesModule);
  return modules;
}

/**
 * モジュール群から user メッセージ用のルール本文を組み立てる。
 * 時機ごとに見出し（`## `）を付け、各時機の中は元の並び順を保つ。
 * これにより「編集はモジュール単位、出力は時機単位」の両立ができる。
 *
 * 1 期の system プロンプトはテンプレートには載っているが、
 * user メッセージの一部ではないのでここでは除外する。
 */
export function renderUserRulesFromModules(modules = []) {
  const buckets = new Map();
  for (const mod of modules) {
    // hidden（処理形式）は画面・編集用 userRules に混ぜない。
    if (mod.hidden) continue;
    for (const rule of mod.rules || []) {
      if (rule.layer === 'system' || rule.hidden) continue;
      const timing = rule.timing || 'common';
      if (!buckets.has(timing)) buckets.set(timing, []);
      buckets.get(timing).push(rule);
    }
  }
  return TIMING_ORDER.filter((timing) => (buckets.get(timing) || []).length)
    .map((timing) => {
      const lines = buckets
        .get(timing)
        .slice()
        .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
        .map((rule) => rule.text);
      return [`## ${TIMING_LABELS[timing] || timing}`, ...lines].join('\n');
    })
    .join('\n\n');
}

// 1期共通テンプレートの中身＝現行システムが実際に送っている user メッセージそのもの（JSON）。
// 実行時にシステムが差し込む値は {{...}} のプレースホルダで示す。見出し・注記は付けない。
function renderClauseComparePrompt(seriesId = null) {
  const blocks = [CLAUSE_COMPARE_RULES.scan, CLAUSE_COMPARE_RULES.textLayer].map((section) => {
    const payload = {
      task: section.task,
      ...section.runtimeFields,
      [section.rulesKey]: section.rules,
    };
    return JSON.stringify(payload, null, 2);
  });
  const def = seriesId ? SERIES_BY_ID[seriesId] : null;
  if (def && def.rules.length) {
    const seriesLines = [`【C】${def.name} の追加ルール（この系列だけに適用）`];
    def.rules.forEach((rule, index) => seriesLines.push(`${index + 1}. ${rule}`));
    blocks.push(seriesLines.join('\n'));
  } else if (def) {
    blocks.push(`【C】${def.name} の追加ルールはまだありません。`);
  }
  return blocks.join('\n\n');
}

/**
 * コンパイル後の user メッセージ。設定スイッチに命中しなかったルール（自由記述）だけを
 * 末尾に足してモデルへ渡す。命中したルールは switches 側でプログラムが処理する。
 */
export function buildCompiledUserMessage(freeRules = []) {
  return [CLAUSE_COMPARE_RULES.scan, CLAUSE_COMPARE_RULES.textLayer].map((section) => ({
    task: section.task,
    ...section.runtimeFields,
    [section.rulesKey]: [...section.rules, ...freeRules],
  }));
}

/**
 * スペックツリーの user メッセージ。現行システムが実際にモデルへ送っている payload の構造。
 *
 * 出典（逐語。改変しない）:
 *   src/pdf_spec_tree/llm.py::_build_pdf_extract_payload
 * 版式に依存しないため系列別テンプレートは持たず、全規格で共通の 1 セットを使う。
 * キー順は payload の組み立て順に合わせる。
 */
const SPEC_TREE_RULES = {
  // 編集画面のルール本文に付ける見出し（userRules の `## ` 行）。
  label: 'スペックツリー抽出（PDF ページ画像から）',
  task: `Read the attached PDF page images and extract the current specification identity and its direct referenced specifications for a specification tree.`,
  instructions: [
    `Use the attached PDF page images as the primary source of truth.`,
    `Extract direct child specifications/documents only.`,
    `If a specification number appears inside drawings, tables, balloons, notes, or embedded images, include it when it is a real document/spec identifier.`,
  ],
  conditional: [
    {
      label: '参照章に「適用・参照文書なし」と明記されている場合',
      text: `The detected reference/applicable-documents chapter explicitly states that there are no referenced/applicable documents; return references=[] and do not fall back to body text, title blocks, revision history, or drawing callout search.`,
    },
    {
      label: '長い文書をページ単位で分割する場合',
      text: `This request covers ONLY PDF pages {start}-{end}. Extract references visible in these pages. Fill evidence_page with the real 1-based PDF page number. Do not invent references from pages outside this range.`,
    },
  ],
  // 実行時にシステムが差し込むフィールド（プレースホルダで構造だけ示す）
  runtimeFields: {
    source_path: '{{source_path}}',
    filename_hint: {
      spec_code: '{{spec_code}}',
      revision: '{{revision}}',
      title: '{{title}}',
    },
  },
  tailFields: {
    llm_only: '{{llm_only}}',
    has_reference_section: '{{has_reference_section}}',
    reference_section_explicitly_empty: '{{reference_section_explicitly_empty}}',
    reference_section_policy: '{{reference_section_policy}}',
    rule_evidence_refs: [
      { code: '{{code}}', title: '{{title}}', source_line: '{{source_line}}', source_page: '{{source_page}}' },
    ],
    batch_page_range: ['{{start}}', '{{end}}'],
    reference_candidate_lines: ['{{candidate_line}}'],
    local_file_spec_candidates: ['{{filename}}'],
    local_file_spec_candidates_note: '{{local_file_spec_candidates_note}}',
    standard_pdf_text_pages: ['{{page_text}}'],
  },
};

// 1期共通テンプレートの中身＝現行システムが実際に送っている user メッセージそのもの（JSON）。
// 条件付きの 2 件は現行では instructions 配列の末尾に追記される。
function renderSpecTreePrompt() {
  const payload = {
    task: SPEC_TREE_RULES.task,
    ...SPEC_TREE_RULES.runtimeFields,
    instructions: [
      ...SPEC_TREE_RULES.instructions,
      ...SPEC_TREE_RULES.conditional.map((item) => item.text),
    ],
    ...SPEC_TREE_RULES.tailFields,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * 仕様ツリー側のモジュール。
 * 画面に出すのは現行で本当に送っている業務ルールだけ:
 *   - system: qwen_truncated.json の業務 bullet（役割・Schema・OCR 入力説明は除く）
 *   - user: instructions/conditional のうち system と重複しない文
 * llm_sft（日语微调用）は現行デフォルトでは呼ばれないので載せない。
 * ユーザー追記は空の「追加ルール」へ。
 */
function specTreeBusinessRulesFromSystem(moduleId) {
  return SPEC_TREE_BASE_SYSTEM_BLOCKS.filter((block) => block.module === moduleId).map((block) => block.text);
}

const SPEC_TREE_MODULES = [
  {
    id: 'spec_tree_extraction',
    name: '抽出の基本',
    responsibility: '何を読み取り、どの範囲を対象にするか。参照章・図面領域・ページ分割。',
    businessRules: [
      ...specTreeBusinessRulesFromSystem('spec_tree_extraction'),
      ...specTreeBusinessRulesFromSystem('spec_tree_reference_empty'),
      // user 側で system と重複しない業務文のみ（instructions[1] / conditional[0] は system と同旨なので除く）
      SPEC_TREE_RULES.instructions[0],
      SPEC_TREE_RULES.instructions[2],
      SPEC_TREE_RULES.conditional[1].text,
    ],
  },
  {
    id: 'spec_tree_normalization',
    name: '正規化',
    responsibility: '規格番号の書き方をそろえる（系列見出しからの補完、末尾数字を足さない、改訂記号）。',
    businessRules: specTreeBusinessRulesFromSystem('spec_tree_normalization'),
  },
  {
    id: 'spec_tree_exclusion',
    name: '除外',
    responsibility: '参照として拾ってはいけないもの。',
    businessRules: specTreeBusinessRulesFromSystem('spec_tree_exclusion'),
  },
  {
    id: 'spec_tree_series_rules',
    name: '追加ルール',
    responsibility: 'このテンプレートだけに追加するルール。',
    businessRules: [],
  },
];

/**
 * 仕様ツリーのモジュールを組み立てる。呼ぶたびに新しい配列を返す。
 * 系列によらず同じ 1 セット（仕様ツリーは版式分岐なし）。画面には業務ルールだけ。
 */
export function buildSpecTreeModules(_seriesId = null) {
  return SPEC_TREE_MODULES.map((mod) => ({
    id: mod.id,
    name: mod.name,
    responsibility: mod.responsibility,
    rules: (mod.businessRules || []).map((text, index) => ({
      timing: 'spec_tree',
      layer: 'user',
      order: index,
      text,
    })),
  }));
}

/**
 * 仕様ツリーのモジュール群から user ルール本文を組み立てる。
 */
export function renderSpecTreeRulesFromModules(modules = []) {
  const rules = [];
  for (const mod of modules) {
    for (const rule of mod.rules || []) {
      if (rule.layer === 'system' || rule.hidden) continue;
      rules.push(rule);
    }
  }
  const lines = rules
    .slice()
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .map((rule) => rule.text);
  return [`## ${SPEC_TREE_RULES.label}`, ...lines].join('\n');
}

/** 1期共通テンプレートの id。現行システムが実際に使っている 1 セット。 */
export const STANDARD_TEMPLATE_ID = 'standard';

/**
 * モジュール群から 1 期の system プロンプトを 1 本に戻す。
 * 本文は責務ごとのモジュールに分かれて載っているので、原文内の位置（block）で並べ直して連結する。
 * 分けた断片は「後ろに続く区切りまで含む」ため、連結すると原文へ逐字で戻る。
 */
export function systemPromptFromModules(modules = [], key) {
  const rules = [];
  for (const mod of modules) {
    for (const rule of mod.rules || []) {
      if (rule.layer === 'system' && rule.systemKey === key) rules.push(rule);
    }
  }
  if (!rules.length) return '';
  // モジュールに配らない部分（役割の宣言・出力形式・実行時フィールドの説明）は画面に出さないので、
  // ブロック表からそのまま足す。足さないと原文へ戻らない。
  for (const block of baseSystemBlocksFor(key)) {
    if (block.module) continue;
    rules.push({ layer: 'system', systemKey: key, block: block.index, source: block.source });
  }
  return rules
    .slice()
    .sort((a, b) => (a.block ?? 0) - (b.block ?? 0))
    .map(systemRuleSource)
    .join('');
}

/**
 * system プロンプトへ入れる 1 ブロック分の本文。
 * 画面に出している規則（marker を持つ）は、画面で書き換えられた text から組み直す。
 * 画面に出さない枠組み（モジュールに配らない役割の宣言・出力形式）は原文のまま。
 */
function systemRuleSource(rule) {
  if (rule.marker === undefined) return rule.source ?? rule.text ?? '';
  return `${rule.marker}${rule.text ?? ''}${rule.trail ?? ''}`;
}

/** その時機の 1 期 system プロンプトのブロック表（原文の並び順）。 */
function baseSystemBlocksFor(key) {
  if (key === 'specTree') return SPEC_TREE_BASE_SYSTEM_BLOCKS;
  return CLAUSE_COMPARE_BASE_SYSTEM_BLOCKS[key] || [];
}

/**
 * そのテンプレートが実行時に使う 1 期の system プロンプト。
 * 画面の業務ルールとは別。モジュールに system 断片が無いときは 1 期原文定数を返す。
 */
export function baseSystemForTemplate(template = {}, key) {
  const source = key === 'specTree' ? template.specTreeModules : template.modules;
  const derived = systemPromptFromModules(source, key);
  if (derived) return derived;
  return key === 'specTree' ? SPEC_TREE_BASE_SYSTEM : CLAUSE_COMPARE_BASE_SYSTEM[key];
}

export function createInitialPromptTemplateConfigs() {
  const now = new Date().toISOString();

  const base = {
    specTreePromptText: renderSpecTreePrompt(),
    specTreeRules: SPEC_TREE_RULES,
    clauseCompareRules: CLAUSE_COMPARE_RULES,
    updatedAt: now,
    published: false,
  };

  // モジュールが唯一のデータ源。userRules / specTreeUserRules はモジュールから組み立てる。
  const build = (seriesId, extra) => {
    const modules = buildModulesForTemplate(seriesId);
    const specTreeModules = buildSpecTreeModules(seriesId);
    return {
      ...extra,
      modules,
      userRules: renderUserRulesFromModules(modules),
      promptText: renderClauseComparePrompt(seriesId),
      ...base,
      specTreeModules,
      specTreeUserRules: renderSpecTreeRulesFromModules(specTreeModules),
    };
  };

  return [
    // 1期共通テンプレート＝1 期が実際に使っている 1 セット（system プロンプト＋抽出ルール）。
    // 全テンプレートの基準なので読み取り専用。顧客に見せるが、書き換えはさせない。
    build(null, {
      id: STANDARD_TEMPLATE_ID,
      series: ['全系列共通'],
      name: '1期共通テンプレート',
      isDefault: true,
      isStandard: true,
      readOnly: true,
    }),
    ...TEMPLATE_SERIES_DEFS.map((def) =>
      build(def.id, {
        id: def.id,
        series: def.series,
        name: def.name,
        trainingFiles: def.trainingFiles,
        problemSamples: def.problemSamples,
        isDefault: true,
        isStandard: false,
        // 系列テンプレートは 1期共通を土台に、二期で中身を差し替えていく。編集可能。
        readOnly: false,
      }),
    ),
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
      { id: 'u1', label: 'AMS 2647', fileName: 'AMS 2647.pdf', referenced: false, unrefType: 'independent', reason: '文書中で単独引用のみ。他規格からの参照なし' },
      { id: 'u2', label: 'MIL-STD-889', fileName: 'MIL-STD-889.pdf', referenced: false, unrefType: 'independent', reason: '文書中で単独引用のみ。他規格からの参照なし' },
      { id: 'u3', label: 'NAS 411', fileName: 'NAS 411.pdf', referenced: false, unrefType: 'independent', reason: '文書中で単独引用のみ。他規格からの参照なし' },
      { id: 'u4', label: 'SAE AS7109', fileName: 'SAE AS7109.pdf', referenced: false, unrefType: 'uncertain', reason: '「SAE AS7109に準拠」の記述あり。親ノードが存在する可能性（抽出漏れの疑い）' },
      { id: 'u5', label: 'MIL-PRF-23419', fileName: 'MIL-PRF-23419.pdf', referenced: false, unrefType: 'independent', reason: '文書中で単独引用のみ。他規格からの参照なし' },
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
      { id: 'u1', label: 'ASTM E21', fileName: 'ASTM E21.pdf', referenced: false, unrefType: 'independent', reason: '文書中で単独引用のみ。他規格からの参照なし' },
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
      { id: 'u1', label: 'ISO 9001', fileName: 'ISO 9001.pdf', referenced: false, unrefType: 'uncertain', reason: '「ISO 9001に基づく」の記述あり。親ノードが存在する可能性（抽出漏れの疑い）' },
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
  // 単一のノード登録表から「参照済みツリー」と「未参照ノード」の2ビューに投影する
  const referencedNodes = [];
  const unreferencedNodes = [];
  const inheritedChangeTypes = [];
  for (const node of variant.nodes) {
    if (node.referenced === false) {
      // 未参照ノード：ツリー構造には属さない（level を持たない）
      unreferencedNodes.push({
        ...node,
        changeType: '',
        unrefType: node.unrefType === 'uncertain' ? 'uncertain' : 'independent',
        reason: node.reason || '',
      });
      continue;
    }
    const level = Number(node.level) || 0;
    inheritedChangeTypes.length = level;
    const inheritedChangeType = inheritedChangeTypes[level - 1] || '';
    const changeType = node.changeType || inheritedChangeType || '';
    inheritedChangeTypes[level] = changeType;
    referencedNodes.push({ ...node, changeType });
  }
  const treeNodes = [
    { id: 'root', label: variant.rootLabel.replace('\\n', ' '), level: 0, changeType: '' },
    ...referencedNodes,
  ];
  const lines = [
    'flowchart LR',
    `  root["${variant.rootLabel}"]`,
    ...referencedNodes.map((node) => `  ${node.id}["${node.label}"]`),
    '  classDef supplementNode fill:#EAF7EF,stroke:#15803D,stroke-width:2px,color:#14532D',
    '  classDef deletedNode fill:#F1F5F9,stroke:#94A3B8,stroke-width:2px,color:#64748B,stroke-dasharray: 4 3',
  ];
  let parentId = 'root';
  for (const node of referencedNodes) {
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
    nodeCount: treeNodes.length + unreferencedNodes.length,
    treeNodes,
    unreferencedNodes,
  };
}

export function createClauseCompareResult(context = {}) {
  const title = `${context.title || ''}:${context.oldFile?.fileName || ''}:${context.newFile?.fileName || ''}`;
  // リスクデモ（?riskDemo=1）のときだけ抽出/対齐リスク付きの条項を使う
  const source = context.riskDemo ? MOCK_CLAUSE_COMPARE_RISKY : MOCK_CLAUSE_COMPARE;
  const applyVariant = (variant) => {
    const result = structuredClone(source);
    result.clauses = variant.mutate(structuredClone(result.clauses));
    // 実条項数に基づいて集計（mock 拡充後も常に正しい件数を表示する）
    result.totalClauses = result.clauses.length;
    result.changedClauses = result.clauses.filter((c) => c.status === '変更').length;
    return result;
  };
  if (/AMS2750/i.test(title)) {
    return applyVariant(CLAUSE_VARIANT_OVERRIDES[0]);
  }
  const seed = `${context.sessionId || ''}:${context.title || ''}:${context.newFile?.fileName || ''}`;
  const variant = CLAUSE_VARIANT_OVERRIDES[variantIndex(seed, CLAUSE_VARIANT_OVERRIDES.length)];
  return applyVariant(variant);
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

// ルール定数の宣言より後に store を初期化する（store 宣言時点では定数が未初期化のため）
store.promptTemplateConfigs = createInitialPromptTemplateConfigs();
