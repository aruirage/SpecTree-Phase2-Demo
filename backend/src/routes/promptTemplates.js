import { Router } from 'express';
import multer from 'multer';
import { baseSystemForTemplate, buildCompiledUserMessage, createInitialPromptTemplateConfigs, renderSpecTreeRulesFromModules, renderUserRulesFromModules, store } from '../store.js';
import { compileUserRules, SWITCHES } from '../promptCompiler.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
// 条項比較のテンプレートは AMS / ISAJT / AQ / FASOP の 4 系列＋標準（2026-10-16 ユーザー指定）。
const SERIES_OPTIONS = ['AMS', 'ISAJT', 'AQ', 'FASOP', 'その他'];

/**
 * 条項比較の 1 期 system は定数（clauseCompareBaseSystem.js）から返す。
 * 仕様ツリーの 1 期 system はモジュールへ分かれて載っており、ここから組み立てる
 * （本文の出所は specTreeBaseSystem.js。二重定義しない）。
 */

function findTemplate(id) {
  return store.promptTemplateConfigs.find((item) => item.id === id);
}

function publicTemplate(template) {
  return {
    ...template,
    // テンプレート自身が持つ system プロンプトを組み立てる。二期でテンプレートごとに
    // 差し替えれば、この値も自動で追随する。
    baseSystem: {
      scan: baseSystemForTemplate(template, 'scan'),
      textLayer: baseSystemForTemplate(template, 'textLayer'),
    },
    specTreeBaseSystem: baseSystemForTemplate(template, 'specTree'),
  };
}

router.get('/', (_req, res) => {
  res.json({ templates: store.promptTemplateConfigs.map(publicTemplate), limit: 10, seriesOptions: SERIES_OPTIONS });
});

router.post('/', (req, res) => {
  // 上限はユーザーが追加したテンプレートだけを数える（初期テンプレートは対象外）。
  const customCount = store.promptTemplateConfigs.filter((item) => !item.isDefault).length;
  if (customCount >= 10) return res.status(400).json({ error: '追加できるテンプレートは最大10件までです' });
  const source = findTemplate(req.body?.sourceId) || store.promptTemplateConfigs[0];
  const template = {
    ...source,
    id: `custom-${Date.now()}`,
    name: String(req.body?.name || `${source.name} コピー`).trim(),
    isDefault: false,
    isStandard: false,
    readOnly: false,
    series: Array.isArray(req.body?.series) && req.body.series.length ? req.body.series : ['その他'],
    sampleFiles: [],
    version: 'v1.0',
    status: 'active',
    published: false,
    updatedAt: new Date().toISOString(),
    updatedBy: 'demo-user',
  };
  store.promptTemplateConfigs.push(template);
  res.status(201).json({ template: publicTemplate(template) });
});

router.get('/:id', (req, res) => {
  const template = findTemplate(req.params.id);
  if (!template) return res.status(404).json({ error: 'prompt template not found' });
  res.json({ template: publicTemplate(template) });
});

router.put('/:id', (req, res) => {
  const template = findTemplate(req.params.id);
  if (!template) return res.status(404).json({ error: 'prompt template not found' });
  // 1期共通テンプレートは条項比較の基準なので読み取り専用（変更する場合はコピーしてから編集する）。
  // ただし仕様ツリーの抽出ルールは全規格で 1 本しかなく、これ自体が編集対象なので保存を許可する。
  const CLAUSE_COMPARE_FIELDS = ['name', 'modules', 'userRules', 'promptText', 'published'];
  const touchesClauseCompare = CLAUSE_COMPARE_FIELDS.some((field) => Object.hasOwn(req.body || {}, field));
  if (template.readOnly && touchesClauseCompare) {
    return res.status(400).json({ error: '1期共通テンプレートは読み取り専用です（変更する場合はコピーしてから編集してください）' });
  }

  // 先に組み立て結果を仮計算し、無効ルールがあれば保存しない（テンプレートを汚さない）。
  const next = { ...template };
  const editable = ['name', 'modules', 'userRules', 'specTreeModules', 'specTreeUserRules', 'promptText', 'specTreePromptText', 'published'];
  for (const field of editable) {
    if (Object.hasOwn(req.body || {}, field)) next[field] = req.body[field];
  }
  if (Array.isArray(req.body?.modules) && !Object.hasOwn(req.body, 'userRules')) {
    next.userRules = renderUserRulesFromModules(req.body.modules);
  }
  if (Array.isArray(req.body?.specTreeModules) && !Object.hasOwn(req.body, 'specTreeUserRules')) {
    next.specTreeUserRules = renderSpecTreeRulesFromModules(req.body.specTreeModules);
  }

  const toValidate = [];
  if (Array.isArray(req.body?.modules) || Object.hasOwn(req.body || {}, 'userRules')) {
    toValidate.push({ kind: 'clause_compare', text: next.userRules || '' });
  }
  if (Array.isArray(req.body?.specTreeModules) || Object.hasOwn(req.body || {}, 'specTreeUserRules')) {
    toValidate.push({ kind: 'spec_tree', text: next.specTreeUserRules || '' });
  }
  const rejected = toValidate.flatMap((item) =>
    compileUserRules(item.text).rejected.map((rule) => ({
      ...rule,
      promptType: item.kind,
    })),
  );
  if (rejected.length) {
    return res.status(400).json({
      error: `無効なルールが ${rejected.length} 件あるため保存できません。修正または削除してから再度保存してください。`,
      rejected: rejected.map((rule) => ({ line: rule.line, reason: rule.reason, promptType: rule.promptType })),
    });
  }

  for (const field of editable) {
    if (Object.hasOwn(next, field) && Object.hasOwn(req.body || {}, field)) {
      template[field] = next[field];
    }
  }
  if (Array.isArray(req.body?.modules) && !Object.hasOwn(req.body, 'userRules')) {
    template.userRules = next.userRules;
  }
  if (Array.isArray(req.body?.specTreeModules) && !Object.hasOwn(req.body, 'specTreeUserRules')) {
    template.specTreeUserRules = next.specTreeUserRules;
  }
  template.updatedAt = new Date().toISOString();
  res.json({ template: publicTemplate(template) });
});

router.post('/:id/generate', upload.array('files', 10), async (req, res) => {
  const template = findTemplate(req.params.id);
  if (!template) return res.status(404).json({ error: 'prompt template not found' });
  const sampleNames = (req.files || []).map((file) => file.originalname).join(', ');
  const promptText = req.body?.promptType === 'spec_tree'
    ? `PDF から仕様ツリーのノードと参照関係を抽出してください。\n\n適用サンプル：${sampleNames || 'サンプル未登録'}\n\n業務ルール：\n- 仕様書名、仕様番号、ノード名、改訂記号、参照関係を原文どおりに保持する。\n- 本文、一覧、表、図面内の仕様書参照を確認し、親子関係を構成する。\n- すべての階層を抽出し、削除または補完されたノードの子ノードも同じ変更状態として扱う。\n- 入力に存在しない仕様番号、ファイル名、ノードを番号順から推測して追加しない。\n- 不明な参照は原文のまま保持し、黙って削除しない。`
    : `PDF から条項を完全に抽出してください。\n\n適用サンプル：${sampleNames || 'サンプル未登録'}\n\n業務ルール：\n- タイトル、本文、条項番号、箇条書き、番号付きリスト、子条項を抽出し、原文と原番号を保持する。\n- 条項番号から次の同階層番号の直前までを同一条項とし、番号のない続きのブロックは直前の条項に統合する。\n- タイトルと本文は改行し、異なる言語の文章も分けて保持する。PDF の意図しない改行だけを結合する。\n- 1)、2)、(1)、(2)、・、- で始まる通常のリストはテキストとして抽出し、内容を欠落させない。\n- 明確な行列構造、見出し、セル境界を持つ表だけを画像として抽出し、通常のリストや整列した文章は画像にしない。\n- 表や図の画像は端部の文字、脚注、注記を含めて切り出し、途中で切断しない。\n- ヘッダー、フッター、著作権、透かし、印章、注釈は条項本文に含めない。\n- 入力に存在しない項目番号を番号順から推測して追加しない。`;
  res.json({ mode: process.env.OPENAI_API_KEY ? 'openai-ready' : 'mock', promptText });
});

router.delete('/:id', (req, res) => {
  const index = store.promptTemplateConfigs.findIndex((item) => item.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'prompt template not found' });
  const target = store.promptTemplateConfigs[index];
  // 初期状態に戻す基準を持つテンプレート（標準 + 初期系列）は削除できない。
  if (target.isStandard) return res.status(400).json({ error: '1期共通テンプレートは削除できません（初期状態に戻す際の基準です）' });
  if (target.isDefault) return res.status(400).json({ error: '初期テンプレートは削除できません（初期状態に戻す際の基準です）' });
  store.promptTemplateConfigs.splice(index, 1);
  res.status(204).end();
});

router.post('/:id/reset', (req, res) => {
  const template = findTemplate(req.params.id);
  if (!template) return res.status(404).json({ error: 'prompt template not found' });
  const defaults = createInitialPromptTemplateConfigs();
  const defaultTemplate = defaults.find((item) => item.id === template.id) || defaults[0];
  template.modules = defaultTemplate.modules;
  template.userRules = defaultTemplate.userRules;
  template.specTreeModules = defaultTemplate.specTreeModules;
  template.specTreeUserRules = defaultTemplate.specTreeUserRules;
  template.promptText = defaultTemplate.promptText;
  template.specTreePromptText = defaultTemplate.specTreePromptText;
  template.clauseCompareRules = defaultTemplate.clauseCompareRules;
  template.specTreeRules = defaultTemplate.specTreeRules;
  template.updatedAt = new Date().toISOString();
  res.json({ template: publicTemplate(template) });
});

/**
 * ユーザーが書いた自然言語ルールの解析。
 * そのままシステムプロンプトへ連結せず、
 *   ① 逸脱した指示の検証  ② 設定スイッチへの照合  ③ モデルへ渡す自由記述の抽出
 * を行う。命中したルールはプログラム側で反映し、モデルには渡さない。
 */
router.post('/:id/analyze', (req, res) => {
  const template = findTemplate(req.params.id);
  if (!template) return res.status(404).json({ error: 'prompt template not found' });
  const promptType = req.body?.promptType === 'spec_tree' ? 'spec_tree' : 'clause_compare';
  const fallback = promptType === 'spec_tree' ? template.specTreeUserRules : template.userRules;
  // モジュール単体チェックにも対応する。条項比較と仕様ツリーで組み立て方が違う。
  const modules = Array.isArray(req.body?.modules)
    ? req.body.modules
    : Array.isArray(req.body?.specTreeModules)
      ? req.body.specTreeModules
      : null;
  const renderModules = promptType === 'spec_tree' ? renderSpecTreeRulesFromModules : renderUserRulesFromModules;
  const text =
    typeof req.body?.text === 'string'
      ? req.body.text
      : modules
        ? renderModules(modules)
        : fallback || '';
  const analysis = compileUserRules(text);
  res.json({
    promptType,
    switches: SWITCHES,
    analysis: {
      ...analysis,
      compiled: promptType === 'spec_tree' ? null : buildCompiledUserMessage(analysis.freeText),
    },
  });
});

router.post('/:id/test', upload.single('file'), async (req, res) => {
  const template = findTemplate(req.params.id);
  if (!template) return res.status(404).json({ error: 'prompt template not found' });
  const isSpecTree = req.body?.promptType === 'spec_tree';
  const configuredPrompt = req.body?.promptOverride || (isSpecTree ? template.specTreePromptText : template.promptText);
  if (!process.env.OPENAI_API_KEY) {
    const isEditedPrompt = Boolean(req.body?.promptOverride);
    return res.json({
      mode: 'mock',
      message: req.body?.promptOverride ? '当前编辑中的 Prompt 的 Mock 预览。' : '已保存 Prompt 的 Mock 预览。',
      output: {
        ...(isSpecTree
          ? { nodes: [{ name: 'Sample specification node', level: 0, source: 'uploaded PDF' }] }
          : {
              clauses: isEditedPrompt
                ? [
                    { id: '3.1', text: 'Furnace temperature uniformity shall be verified per Table 1 and Table 1A.', translation: '炉温均一性は、表1および表1Aに従って検証されなければならない。', confidence: 'high' },
                    { id: '3.2', text: 'Thermocouples shall be calibrated every 90 days per AMS2750F.', translation: '熱電対は、AMS2750Fに従い90日ごとに校正されなければならない。', confidence: 'high' },
                    { id: '4.1', text: 'Survey intervals shall not exceed 12 months.', translation: 'サーベイ間隔は12か月を超えてはならない。', confidence: 'high' },
                    { id: '5.4', text: 'TUS records must be retained for 7 years and include digital signatures.', translation: 'TUS記録は7年間保管し、デジタル署名を含めなければならない。', confidence: 'medium' },
                  ]
                : [
                    { id: '3.1', text: 'Furnace temperature uniformity shall be verified per Table 1.', translation: '炉温均一性は、表1に従って検証されなければならない。', confidence: 'high' },
                    { id: '3.2', text: 'Thermocouples shall be calibrated annually.', translation: '熱電対は年1回校正されなければならない。', confidence: 'high' },
                    { id: '4.1', text: 'Survey intervals shall not exceed 12 months.', translation: 'サーベイ間隔は12か月を超えてはならない。', confidence: 'high' },
                    { id: '5.3', text: 'TUS (Temperature Uniformity Survey) records must be retained for 5 years.', translation: 'TUS（温度均一性サーベイ）記録は5年間保管しなければならない。', confidence: 'medium' },
                  ],
            }),
      },
    });
  }
  if (!req.file) return res.status(400).json({ error: 'PDF ファイルを選択してください' });
  const input = req.body?.input || [
    {
      role: 'user',
      content: [
        { type: 'input_text', text: isSpecTree ? 'この PDF から仕様ツリーを抽出してください。JSON のみ返してください。' : 'この PDF から条款を抽出してください。JSON のみ返してください。' },
        { type: 'input_file', filename: req.file.originalname, file_data: `data:application/pdf;base64,${req.file.buffer.toString('base64')}` },
      ],
    },
  ];
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5',
      // 1 期の system プロンプトはそのテンプレートのモジュールから組み立てる（仕様ツリーは専用の 1 本）。
      instructions: `${baseSystemForTemplate(template, isSpecTree ? 'specTree' : 'scan')}\n\n客户配置 Prompt：\n${configuredPrompt || ''}`,
      input,
      text: { format: { type: 'json_object' } },
      store: false,
    }),
  });
  const data = await response.json();
  if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'OpenAI request failed' });
  res.json({ mode: 'openai', output: data.output_text || data });
});

export default router;
