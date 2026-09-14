import { Router } from 'express';
import multer from 'multer';
import { createInitialPromptTemplateConfigs, store } from '../store.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const SERIES_OPTIONS = ['AMS', 'ASTM', 'DMF', 'ISAJT', 'その他'];

const FIXED_BASE_SYSTEM = `あなたは PDF 構造化分析を行うアシスタントです。入力された PDF の情報を、指定された JSON 形式で出力してください。

固定制約：
- 有効な JSON のみを出力し、Markdown や説明文を追加しない。
- 出力フィールド名とデータ型を変更しない。
- 入力で確認できる情報だけを使用し、入力にない内容、番号、ファイル名、改訂記号を生成しない。
- 不確実な値を推測で補完せず、入力に存在する原文を優先する。
- 入力で確認できない、欠落の疑いがある、または構造判断が不安定な結果は review_required を true にする。確信度を数値で推測しない。
- 入力データを静かに破棄せず、判断できない場合は指定された出力構造の中で保持する。`;

function findTemplate(id) {
  return store.promptTemplateConfigs.find((item) => item.id === id);
}

function publicTemplate(template) {
  return {
    ...template,
    baseSystem: FIXED_BASE_SYSTEM,
    outputSchema: {
      clauses: '[{ id, text, source_anchor_block_index, source_block_start, source_block_end, source_body_block_indexes, table_images, review_required }]',
    },
  };
}

router.get('/', (_req, res) => {
  res.json({ templates: store.promptTemplateConfigs.map(publicTemplate), limit: 10, seriesOptions: SERIES_OPTIONS });
});

router.post('/', (req, res) => {
  if (store.promptTemplateConfigs.length >= 10) return res.status(400).json({ error: 'テンプレートは最大10件まで作成できます' });
  const source = findTemplate(req.body?.sourceId) || store.promptTemplateConfigs[0];
  const template = {
    ...source,
    id: `custom-${Date.now()}`,
    name: String(req.body?.name || `${source.name} コピー`).trim(),
    isDefault: false,
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
  const editable = [
    'name', 'promptText', 'specTreePromptText', 'promptSections', 'published',
  ];
  for (const field of editable) {
    if (Object.hasOwn(req.body || {}, field)) template[field] = req.body[field];
  }
  if (req.body?.promptSections?.clause_compare) {
    template.promptText = Object.values(req.body.promptSections.clause_compare).join('\n');
  }
  if (req.body?.promptSections?.spec_tree) {
    template.specTreePromptText = Object.values(req.body.promptSections.spec_tree).join('\n');
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
  if (template.isDefault) return res.status(400).json({ error: '標準テンプレートは削除できません' });
  store.promptTemplateConfigs.splice(index, 1);
  res.status(204).end();
});

router.post('/:id/reset', (req, res) => {
  const template = findTemplate(req.params.id);
  if (!template) return res.status(404).json({ error: 'prompt template not found' });
  const defaults = createInitialPromptTemplateConfigs();
  const defaultTemplate = defaults.find((item) => item.id === template.id) || defaults[0];
  template.promptText = defaultTemplate.promptText;
  template.promptText = 'Business extraction rules:\n- Exclude non-clause content such as tables of contents, prefaces, references, disclaimers, copyright notices, order information, contact information, licenses, watermarks, and document-distribution notices.\n- Preserve the original wording, terminology, numbers, punctuation, and meaning. Do not correct grammar, paraphrase, summarize, or add information that is not present in the document.\n- Keep every explicitly stated clause number in the original order. Start each clause on a new line. Merge only unnumbered continuation text that clearly belongs to the preceding clause.\n- Keep a clause heading, clause number, and clause body on separate lines when they appear as separate lines in the source. Do not merge them into one line.\n- Keep every paragraph on a separate line. Keep every numbered or bulleted list item on a separate line, including items beginning with 1), 2), (1), (2), -, ・, or •.\n- Treat parenthesized lists such as (1), (2), and (3) as part of the current clause, but preserve each list item on its own line.\n- If Japanese, English, or another language appears in separate source lines, preserve the language boundaries and keep those lines separate.\n- Preserve intentional line breaks in headings, paragraphs, and lists. Join only line breaks that are clearly caused by PDF layout within the same sentence.\n- Remove repeated headers, footers, and boilerplate even when they appear in the middle of a clause.\n- Treat numbered lists and bulleted lists as text. Classify content as a table or image only when its layout clearly has a table or image structure.\n- Do not infer, complete, reorder, or invent missing clause numbers, specifications, versions, prefixes, or suffixes.';
  template.specTreePromptText = 'PDF から仕様ツリーのノードと参照関係を抽出してください。\n\n業務ルール：\n- 仕様書名、仕様番号、ノード名、改訂記号、参照関係を原文どおりに保持する。\n- 本文、一覧、表、図面内の仕様書参照を確認し、親子関係を構成する。\n- すべての階層を抽出し、削除または補完されたノードの子ノードも同じ変更状態として扱う。\n- 入力に存在しない仕様番号、ファイル名、ノードを番号順から推測して追加しない。\n- 不明な参照は原文のまま保持し、黙って削除しない。';
  template.promptSections = {
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
  };
  template.updatedAt = new Date().toISOString();
  res.json({ template: publicTemplate(template) });
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
      instructions: `${FIXED_BASE_SYSTEM}\n\n客户配置 Prompt：\n${configuredPrompt || ''}`,
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
