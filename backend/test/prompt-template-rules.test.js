import assert from 'node:assert/strict';
import test from 'node:test';
import {
  baseSystemForTemplate,
  createInitialPromptTemplateConfigs,
  renderSpecTreeRulesFromModules,
  STANDARD_TEMPLATE_ID,
  systemPromptFromModules,
} from '../src/store.js';
import { validateRule } from '../src/promptCompiler.js';
import { CLAUSE_COMPARE_BASE_SYSTEM, CLAUSE_COMPARE_BASE_SYSTEM_BLOCKS } from '../src/clauseCompareBaseSystem.js';
import { SPEC_TREE_BASE_SYSTEM, SPEC_TREE_BASE_SYSTEM_BLOCKS } from '../src/specTreeBaseSystem.js';

const templates = Object.fromEntries(createInitialPromptTemplateConfigs().map((item) => [item.id, item]));
// 条項比較のテンプレートは AMS / ISAJT / AQ / FASOP の 4 系列（＋1期共通テンプレート）。
const SERIES_IDS = ['ams', 'isajt', 'aq', 'fasop'];
const RULE_COUNTS = { ams: 2, isajt: 3, aq: 3, fasop: 2 };
const standard = templates[STANDARD_TEMPLATE_ID];

// 1期共通テンプレート＝現行システムが実際に送っている user メッセージ（JSON）。
// 実行時に差し込まれる値は {{...}} プレースホルダ。見出し・ラベル・注記は一切付けない。
const FORBIDDEN_FRAMING = ['▼', '【A】', '【B】', '【C】', 'タスク：', '※', 'この部分だけが変更できます'];

const [scanPayload, textLayerPayload] = standard.promptText.split('\n\n').map((chunk) => JSON.parse(chunk));
const specTreePayload = JSON.parse(standard.specTreePromptText);

function seriesRuleLines(text) {
  const block = text.split('【C】')[1];
  if (!block) return [];
  return block.trim().split('\n').filter((line) => /^\d+\./.test(line));
}

test('standard template carries the two production user messages as JSON', () => {
  assert.deepEqual(Object.keys(scanPayload), ['task', 'page', 'raw_text', 'rules']);
  assert.equal(scanPayload.task, 'Extract clause-like text and table/figure regions from this PDF page.');
  assert.equal(scanPayload.page, '{{page}}');
  assert.equal(scanPayload.raw_text, '{{raw_text}}');
  assert.equal(scanPayload.rules.length, 24);
  assert.equal(scanPayload.rules[0], 'Return valid JSON only.');
  assert.equal(
    scanPayload.rules[23],
    'For ref, use visible caption refs like Table 3 / Figure 2 when clear. Otherwise use an empty string.',
  );

  assert.deepEqual(Object.keys(textLayerPayload), ['task', 'page', 'page_count', 'notes']);
  assert.equal(textLayerPayload.task, 'Extract the clauses visible on this single PDF page image.');
  assert.equal(textLayerPayload.page_count, '{{page_count}}');
  assert.equal(textLayerPayload.notes.length, 6);
  assert.equal(
    textLayerPayload.notes[5],
    'Use table_images as an empty array; table images are attached later by the deterministic pipeline.',
  );
});

test('standard template keeps the production wording verbatim', () => {
  const text = standard.promptText;
  assert.match(text, /Never renumber a list item into a dotted clause id/);
  assert.match(text, /Do not emit a table asset for borderless aligned text that is not a data grid/);
  assert.match(text, /Treat text extraction as transcription, not rewriting\./);
  assert.match(text, /If this page begins with continuation text from the previous page and there is no new clause id, set id to an empty string\./);
});

test('standard template adds no headings, labels or notes of our own', () => {
  for (const token of FORBIDDEN_FRAMING) {
    assert.ok(!standard.promptText.includes(token), `1期共通テンプレートに「${token}」が残っています`);
    assert.ok(!standard.specTreePromptText.includes(token), `仕様ツリープロンプトに「${token}」が残っています`);
  }
});

test('the phase-2 four-group framing is gone from the editable prompt', () => {
  const text = standard.promptText;
  assert.doesNotMatch(text, /除外する内容/);
  assert.doesNotMatch(text, /ページをまたぐ条項/);
  assert.doesNotMatch(text, /表・図の脚注の扱い/);
  assert.doesNotMatch(text, /改行の入れ方/);
  assert.doesNotMatch(text, /→\s*table_images/);
  assert.doesNotMatch(text, /すべての block を必ず処置/);
  assert.doesNotMatch(text, /思考の連鎖/);
});

test('standard template is marked as the shared baseline and has no series rules', () => {
  assert.equal(standard.id, STANDARD_TEMPLATE_ID);
  assert.equal(standard.isStandard, true);
  assert.equal(standard.isDefault, true);
  assert.deepEqual(standard.series, ['全系列共通']);
  assert.ok(!standard.promptText.includes('【C】'));
});

test('the series list covers the documented dataset', () => {
  const expected = {
    ams: [24, 2],
    isajt: [38, 2],
    aq: [3, 1],
    fasop: [9, 2],
  };
  for (const [id, [trainingFiles, sampleCount]] of Object.entries(expected)) {
    assert.ok(templates[id], `${id} テンプレートがありません`);
    assert.equal(templates[id].trainingFiles, trainingFiles, `${id}.trainingFiles`);
    assert.equal(templates[id].problemSamples.length, sampleCount, `${id}.problemSamples`);
  }
});

test('templates carry no display note in the list', () => {
  for (const item of Object.values(templates)) {
    assert.equal(item.note, undefined, `${item.id} に一覧表示用の注記が残っています`);
  }
});

test('every series template is built on the shared baseline', () => {
  for (const id of SERIES_IDS) {
    assert.equal(templates[id].isStandard, false, `${id}.isStandard`);
    assert.ok(
      templates[id].promptText.startsWith(standard.promptText),
      `${id}.promptText が1期共通テンプレートの原文から始まっていません`,
    );
    assert.equal(templates[id].specTreePromptText, standard.specTreePromptText, `${id}.specTreePromptText`);
  }
});

test('each series template carries its own 【C】 rules, or states it has none', () => {
  for (const id of SERIES_IDS) {
    const lines = seriesRuleLines(templates[id].promptText);
    assert.equal(lines.length, RULE_COUNTS[id], `${id} の【C】ルール数`);
    if (RULE_COUNTS[id]) {
      assert.match(templates[id].promptText, /【C】[^\n]*のカスタムルール（この系列だけに適用）/);
    } else {
      assert.match(templates[id].promptText, /【C】[^\n]*のカスタムルールはまだありません。/);
    }
  }
  // ルールを持つ系列どうしは内容が重複しない（＝テンプレートが分かれている）
  const withRules = SERIES_IDS.filter((id) => RULE_COUNTS[id]);
  const blocks = withRules.map((id) => seriesRuleLines(templates[id].promptText).join('\n'));
  assert.equal(new Set(blocks).size, withRules.length, '系列別ルールが重複しています');
});

test('series rules cite the documented phase-1 findings', () => {
  // AMS 系：網掛け本文 / 記載内容の改行
  assert.match(templates.ams.promptText, /grey or shaded background is still clause body text/);
  assert.match(templates.ams.promptText, /Keep every line break of the 記載内容 \(content\) column/);
  // ISAJT 系：日文欠落 / 切出し欠落 / 2-1・別紙英字付き
  assert.match(templates.isajt.promptText, /Do not skip a clause just because it is written only in Japanese\./);
  assert.match(templates.isajt.promptText, /do not drop the text inside that region/);
  assert.match(templates.isajt.promptText, /2-1.*別紙 3A \/ 3B|別紙 3A \/ 3B/);
  // AQ 系：条項内仕様一覧はテキスト / 入力に無い情報を出さない
  assert.match(templates.aq.promptText, /A specification list or table inside a clause must be extracted as clause text\./);
  assert.match(templates.aq.promptText, /Do not output any information that is not present in the input\./);
  // FASOP 系：全編日本語 / 全角数字
  assert.match(templates.fasop.promptText, /because there is no English side/);
  assert.match(templates.fasop.promptText, /Full-width \(全角\) clause numbers/);
});

test('spec tree prompt is the production user message as JSON', () => {
  assert.equal(
    specTreePayload.task,
    'Read the attached PDF page images and extract the current specification identity and its direct referenced specifications for a specification tree.',
  );
  assert.equal(specTreePayload.source_path, '{{source_path}}');
  assert.deepEqual(Object.keys(specTreePayload.filename_hint), ['spec_code', 'revision', 'title']);
  assert.equal(specTreePayload.instructions.length, 5);
  assert.equal(specTreePayload.instructions[0], 'Use the attached PDF page images as the primary source of truth.');
  assert.equal(specTreePayload.instructions[1], 'Extract direct child specifications/documents only.');
  assert.match(specTreePayload.instructions[3], /return references=\[\] and do not fall back to body text/);
  assert.match(specTreePayload.instructions[4], /This request covers ONLY PDF pages \{start\}-\{end\}\./);
  // 実行時フィールドも payload の構造として保持している
  for (const key of ['rule_evidence_refs', 'reference_candidate_lines', 'standard_pdf_text_pages', 'llm_only', 'reference_section_policy']) {
    assert.ok(key in specTreePayload, `仕様ツリー payload に ${key} がありません`);
  }
});

test('templates keep the production rule sets for reset', () => {
  for (const item of [standard, ...SERIES_IDS.map((id) => templates[id])]) {
    assert.equal(item.clauseCompareRules.scan.rules.length, 24);
    assert.equal(item.clauseCompareRules.textLayer.rules.length, 6);
    assert.equal(item.specTreeRules.instructions.length, 3);
    assert.equal(item.specTreeRules.conditional.length, 2);
  }
});

// 削除権限：初期状態に戻す基準を持つテンプレートは消せない。
// 標準 + 11 系列はすべて isDefault=true、うち standard だけが isStandard=true。
test('only the standard template is flagged standard, and every initial template stays reset-anchored', () => {
  const list = createInitialPromptTemplateConfigs();
  const standards = list.filter((item) => item.isStandard);
  assert.equal(standards.length, 1);
  assert.equal(standards[0].id, STANDARD_TEMPLATE_ID);
  assert.ok(
    list.every((item) => item.isDefault === true),
    'all initial templates must remain restorable, so none of them may be deleted',
  );
  for (const id of SERIES_IDS) {
    assert.equal(templates[id].isStandard, false, `${id} must not be flagged as standard`);
    assert.equal(templates[id].isDefault, true, `${id} must stay reset-anchored`);
  }
});

// コピーで作ったテンプレートは標準版ではない（初期値を持たないので削除できる）。
test('a copy is not a standard template and carries no reset anchor', () => {
  const source = templates[STANDARD_TEMPLATE_ID];
  const copy = { ...source, id: 'custom-1', isDefault: false, isStandard: false };
  assert.equal(copy.isStandard, false);
  assert.equal(copy.isDefault, false);
});

// 編集画面の業務ルールは去重合併済み。処理形式（Return JSON / Schema 等）は userRules に出さない。
test('the editable rules are the deduped business set, without processing format', () => {
  assert.ok(standard.userRules.includes('## スキャン文書（画像から読み取る）'));
  assert.ok(standard.userRules.includes('Treat text extraction as transcription'));
  assert.ok(!standard.userRules.includes('Return valid JSON only.'));
  assert.ok(!standard.userRules.includes('## 翻訳'));
  assert.ok(!standard.userRules.includes('【C】'));
});

// 系列テンプレート＝共通抽出ルール（土台）＋系列差分。アップロード時はテンプレート単体が効く。
test('each series template keeps shared extraction rules and appends series deltas', () => {
  const shownText = (template, moduleId) =>
    (template.modules.find((mod) => mod.id === moduleId)?.rules || []).map((rule) => rule.text).join('\n');
  const shownRules = (template, moduleId) =>
    (template.modules.find((mod) => mod.id === moduleId)?.rules || []).map((rule) => rule.text);

  // 共通の抽出ルールが系列テンプレートにも残っている（置換されていない）。
  const sharedModules = ['text_extraction', 'page_handling', 'asset_boundary', 'clause_id', 'exclusion', 'layout'];
  for (const id of SERIES_IDS) {
    for (const moduleId of sharedModules) {
      const baseline = shownRules(standard, moduleId);
      const series = shownRules(templates[id], moduleId);
      for (const text of baseline) {
        assert.ok(
          series.includes(text),
          `${id}/${moduleId} に共通ルールが欠けています: ${text.slice(0, 60)}`,
        );
      }
      assert.ok(series.length >= baseline.length, `${id}/${moduleId} が共通より短くなっています`);
    }
  }

  // 系列差分により、系列どうしも互いに違う。
  const fingerprints = SERIES_IDS.map((id) =>
    ['text_extraction', 'asset_boundary', 'clause_id', 'layout']
      .map((moduleId) => shownText(templates[id], moduleId))
      .join('||'),
  );
  assert.equal(new Set(fingerprints).size, SERIES_IDS.length, '系列テンプレートのモジュール文言が重複しています');

  // 系列版式の特徴語（差分）が入っている。
  assert.match(shownText(templates.ams, 'text_extraction'), /AMS-series|grey or shaded/);
  assert.match(shownText(templates.ams, 'clause_id'), /\(1\)\(2\)|decimal clause/);
  assert.match(shownText(templates.ams, 'asset_boundary'), /Table\/Figure|grey\/shaded/);
  assert.match(shownText(templates.isajt, 'clause_id'), /2-1|別紙 3A/);
  assert.match(shownText(templates.isajt, 'asset_boundary'), /do not drop the text inside that region/);
  assert.match(shownText(templates.aq, 'layout'), /Japanese paragraph immediately followed by English|consecutive separate lines/);
  assert.match(shownText(templates.aq, 'asset_boundary'), /specification list or table inside an AQ clause/);
  assert.match(shownText(templates.fasop, 'clause_id'), /full-width|全角/);
  assert.match(shownText(templates.fasop, 'text_extraction'), /FASOP-series|Japanese throughout/);
});

// 1期共通テンプレートの画面＝去重合併した業務ルール。翻訳・追加ルールは空。
// 処理形式は hidden モジュールに残すが、画面モジュールには出さない。
test('the shared baseline shows only deduped business rules on screen', () => {
  const shown = standard.modules
    .filter((mod) => !mod.hidden)
    .flatMap((mod) => mod.rules.filter((rule) => rule.layer !== 'system'));
  assert.equal(shown.length, 15, '条項比較の画面ルール数が去重合併後の 15 条と一致しません');
  assert.deepEqual(standard.modules.find((mod) => mod.id === 'translation').rules, []);
  assert.deepEqual(standard.modules.find((mod) => mod.id === 'series_rules').rules, []);
  assert.ok(shown.every((rule) => !/Return valid JSON|Schema:|bbox normalized|table_images as an empty/.test(rule.text)));
  assert.ok(!standard.userRules.includes('You are extracting structured content'));
  // 1 期の送信原文は別フィールドに保持。
  assert.equal(standard.clauseCompareRules.scan.rules.length, 24);
  assert.equal(standard.clauseCompareRules.textLayer.rules.length, 6);
});

test('the spec tree editable rules come from the live qwen_truncated path only', () => {
  const lines = standard.specTreeUserRules.split('\n');
  assert.equal(lines[0], '## スペックツリー抽出（PDF ページ画像から）');
  assert.ok(lines[1].includes('CURRENT document identity'));
  // llm_sft（微调用）は現行デフォルトでは呼ばれないので画面に出さない
  assert.ok(!standard.specTreeUserRules.includes('KIE情報抽出'));
  // 見出し + 抽出13 + 正規化3 + 除外4（追加ルールは空）
  assert.equal(lines.length, 1 + 13 + 3 + 4);
});

// 仕様ツリーは現行呼び出し原文の業務ルール＋追記用の追加ルール。
test('the spec tree template uses live business modules plus an empty add-on slot', () => {
  assert.deepEqual(
    standard.specTreeModules.map((mod) => mod.id),
    ['spec_tree_extraction', 'spec_tree_normalization', 'spec_tree_exclusion', 'spec_tree_series_rules'],
  );
  assert.ok(!standard.specTreeUserRules.includes('{{source_path}}'));
  assert.ok(!standard.specTreeUserRules.includes('rule_evidence_refs'));
  const counts = Object.fromEntries(
    standard.specTreeModules.map((mod) => [mod.id, mod.rules.length]),
  );
  assert.deepEqual(counts, {
    spec_tree_extraction: 13,
    spec_tree_normalization: 3,
    spec_tree_exclusion: 4,
    spec_tree_series_rules: 0,
  });
  // qwen_truncated の業務 bullet はすべて原文のまま載っている
  for (const block of SPEC_TREE_BASE_SYSTEM_BLOCKS.filter((item) => item.module)) {
    assert.ok(
      standard.specTreeUserRules.includes(block.text),
      `qwen_truncated 業務文が欠けています: ${block.text.slice(0, 60)}`,
    );
  }
  for (const id of SERIES_IDS) {
    assert.equal(templates[id].specTreeUserRules, standard.specTreeUserRules, `${id}.specTreeUserRules`);
  }
});

// 設定スイッチはルール本文から自動導出するので、画面に別途持たない（ルールとの二重管理を避ける）。
test('modules carry no editable switches', () => {
  for (const item of [standard, ...SERIES_IDS.map((id) => templates[id])]) {
    for (const mod of [...item.modules, ...item.specTreeModules]) {
      assert.equal(mod.switches, undefined, `${item.id}/${mod.id} に編集可能なスイッチが残っています`);
    }
  }
});

// モジュールの並びと名前は全テンプレートで同じ（固定）。違いは中身だけ。
// 1 期の system プロンプトはモジュールとして括り出さず、責務ごとにこの中へ配る。
test('every template exposes the same module names in the same order', () => {
  // 画面に出すモジュール（hidden の出力形式は出さない）。
  const shown = (mods) => mods.filter((mod) => !mod.hidden);
  const names = shown(standard.modules).map((mod) => mod.name);
  assert.deepEqual(names, [
    'テキスト抽出',
    'ページの扱い',
    '画像・テキストの境界',
    '条項番号',
    'レイアウト',
    '翻訳',
    '除外',
    'カスタムルール',
  ]);
  for (const id of SERIES_IDS) {
    assert.deepEqual(
      shown(templates[id].modules).map((mod) => mod.name),
      names,
      `${id} のモジュール名が標準と違います`,
    );
  }
  assert.deepEqual(
    shown(standard.specTreeModules).map((mod) => mod.name),
    ['抽出の基本', '正規化', '除外', 'カスタムルール'],
  );
  // Ph1共通テンプレートのカスタムルールは空（中身だけがテンプレートごとに違う）。
  assert.deepEqual(standard.modules.find((mod) => mod.id === 'series_rules').rules, []);
  assert.equal(templates.isajt.modules.find((mod) => mod.id === 'series_rules').rules.length, 3);
});

// 画面の業務ルールは重複なく、hidden の処理形式だけが 1 期原文 index を持つ。
test('business rules are unique on screen; format rules stay hidden', () => {
  const shownTexts = standard.modules
    .filter((mod) => !mod.hidden)
    .flatMap((mod) => mod.rules.map((rule) => rule.text));
  assert.equal(new Set(shownTexts).size, shownTexts.length, '画面ルールが重複しています');
  const format = standard.modules.find((mod) => mod.id === 'output_format');
  assert.equal(format.hidden, true);
  assert.equal(format.rules.length, 7);
});

// ページに関するルールは 1 つのモジュールにまとめる。
test('page related rules live in the page handling module', () => {
  const page = standard.modules.find((mod) => mod.id === 'page_handling');
  assert.equal(page.name, 'ページの扱い');
  assert.ok(page.rules.every((rule) => rule.layer !== 'system'));
  assert.equal(page.rules.length, 3);
  assert.ok(page.rules.some((rule) => /empty clause id/.test(rule.text)));
  assert.ok(page.rules.some((rule) => /reading order/.test(rule.text)));
});

// 仕様ツリーの 1 期 system プロンプトは、責務ごとのモジュールに分かれて載る。
// 現行の既定は SPEC_TREE_MODE=qwen ＋ SPEC_TREE_STOP_AFTER_REFERENCE_SECTION=true なので、
// 実際にモデルへ送られるのは qwen_truncated.json の system（openai.json ではない）。
test('the spec tree fixed layer is carried verbatim', () => {
  for (const item of [standard, ...SERIES_IDS.map((id) => templates[id])]) {
    const text = baseSystemForTemplate(item, 'specTree');
    assert.equal(typeof text, 'string', `${item.id} の system`);
    assert.match(
      text,
      /^You extract a specification tree from a truncated PDF input:/,
      `${item.id} の system が qwen_truncated.json の system ではありません`,
    );
    assert.match(text, /Output valid JSON only, no markdown or commentary\./);
    // 逐字で持ち回っていること（改変したら字数が変わる）。
    assert.equal(text.length, 5248, `${item.id} の system が改変されています`);
  }
});

// 条項比較の固定層も、1 期の system プロンプト 2 本を逐字で持つ（時機ごとに別の system を送っている）。
test('the clause compare fixed layer is the phase-1 system prompts, verbatim', () => {
  assert.match(
    CLAUSE_COMPARE_BASE_SYSTEM.scan,
    /^You are extracting structured content from non-standard specification PDFs\./,
  );
  // 現行は翻訳しない、というのが 1 期の原文そのもの。
  assert.match(CLAUSE_COMPARE_BASE_SYSTEM.scan, /Do not translate keys\./);
  assert.match(
    CLAUSE_COMPARE_BASE_SYSTEM.textLayer,
    /^Extract clause JSON from one PDF page image only\./,
  );
  assert.equal(CLAUSE_COMPARE_BASE_SYSTEM.scan.length, 3959);
  assert.equal(CLAUSE_COMPARE_BASE_SYSTEM.textLayer.length, 2119);
});

// 画面のモジュールに system 断片は載せない。実行時の system は 1 期原文定数から効く。
test('screens keep only business rules; system stays as the fixed layer', () => {
  for (const item of [standard, ...SERIES_IDS.map((id) => templates[id])]) {
    assert.deepEqual(
      item.modules.flatMap((mod) => mod.rules.filter((rule) => rule.layer === 'system')),
      [],
      `${item.id} の条項比較に system 断片が残っています`,
    );
    assert.deepEqual(
      item.specTreeModules.flatMap((mod) => mod.rules.filter((rule) => rule.layer === 'system')),
      [],
      `${item.id} の仕様ツリーに system 断片が残っています`,
    );
    assert.equal(baseSystemForTemplate(item, 'scan'), CLAUSE_COMPARE_BASE_SYSTEM.scan, `${item.id} scan`);
    assert.equal(baseSystemForTemplate(item, 'textLayer'), CLAUSE_COMPARE_BASE_SYSTEM.textLayer, `${item.id} textLayer`);
    assert.equal(baseSystemForTemplate(item, 'specTree'), SPEC_TREE_BASE_SYSTEM, `${item.id} specTree`);
  }
  assert.equal(systemPromptFromModules(standard.modules, 'scan'), '');
  assert.equal(systemPromptFromModules(standard.specTreeModules, 'specTree'), '');
});

// 仕様ツリーの業務ルールを編集しても、固定層の system 原文は変わらない。
test('editing a spec tree business rule updates user rules only', () => {
  const modules = JSON.parse(JSON.stringify(standard.specTreeModules));
  const target = modules.find((mod) => mod.id === 'spec_tree_extraction').rules[0];
  target.text = `${target.text} (edited in the demo)`;
  assert.equal(baseSystemForTemplate({ ...standard, specTreeModules: modules }, 'specTree'), SPEC_TREE_BASE_SYSTEM);
  assert.match(renderSpecTreeRulesFromModules(modules), /\(edited in the demo\)/);
});

// 1期共通テンプレート＝1 期の 1 セットそのもの。条項比較の基準なので読み取り専用。
// 系列テンプレートはこの基準を土台に、二期で中身を差し替えていくので編集できる。
// 仕様ツリーの抽出ルールは全規格で 1 本しかなく、これ自体が編集対象なので別扱い
// （readOnly のテンプレートでも保存できる。API のテストで担保する）。
test('the shared baseline is read-only, the series templates stay editable', () => {
  assert.equal(standard.readOnly, true);
  assert.equal(standard.isStandard, true);
  for (const id of SERIES_IDS) {
    assert.equal(templates[id].readOnly, false, `${id}.readOnly`);
    assert.equal(templates[id].isStandard, false, `${id}.isStandard`);
  }
});

// 処理形式（JSON / Schema / 座標系 / 入力チャネル / パイプライン空配列）は
// 業務ルールではないので画面のモジュールには出さない。system プロンプト側の取り決め。
// ただし 1 期の user メッセージにも同じ文言があるので、データとしては保持する
// （落とすと 1 期の 30 条と一致しなくなり、画面に出ないまま規則が消える）。
test('the output format stays out of the module view but remains in the template data', () => {
  const shown = (mods) => mods.filter((mod) => !mod.hidden).map((mod) => mod.id);
  assert.ok(!shown(standard.modules).includes('output_format'));
  // 仕様ツリー側は出力形式の内容が system プロンプトにしか無いので、モジュールごと持たない。
  assert.ok(!standard.specTreeModules.some((mod) => mod.id === 'spec_tree_output'));
  assert.ok(!shown(standard.specTreeModules).includes('spec_tree_output'));

  const hidden = standard.modules.filter((mod) => mod.hidden).map((mod) => mod.id);
  assert.deepEqual(hidden, ['output_format']);
  const outputFormat = standard.modules.find((mod) => mod.id === 'output_format');
  assert.equal(outputFormat.name, '出力形式');
  assert.deepEqual(
    outputFormat.rules.map((rule) => `${rule.section}[${rule.order}]`),
    [
      'scan[0]',
      'scan[1]',
      'scan[2]',
      'textLayer[0]',
      'textLayer[1]',
      'textLayer[3]',
      'textLayer[5]',
    ],
  );
  assert.match(outputFormat.rules[0].text, /^Return valid JSON only\.$/);
  assert.match(outputFormat.rules[1].text, /^Schema: \{"page":N,/);
  assert.match(outputFormat.rules[2].text, /^Use bbox normalized to 0\.\.1000/);
  assert.match(outputFormat.rules[3].text, /^Use only the attached full-page image/);
  assert.match(outputFormat.rules[6].text, /^Use table_images as an empty array/);
  // 画面に出るモジュールには処理形式の文言が混ざらない。
  const shownTexts = standard.modules
    .filter((mod) => !mod.hidden)
    .flatMap((mod) => mod.rules.filter((rule) => rule.layer !== 'system'))
    .map((rule) => rule.text);
  for (const banned of [
    'Return valid JSON only.',
    'Use bbox normalized to 0..1000',
    'Use table_images as an empty array',
    'Do not use or request text blocks, chunk payloads',
  ]) {
    assert.ok(
      shownTexts.every((text) => !text.includes(banned)),
      `画面モジュールに処理形式が残っています: ${banned}`,
    );
  }
  // 系列テンプレートにも同じモジュールが同じ位置にあり、画面には出ない。
  for (const id of SERIES_IDS) {
    assert.ok(!shown(templates[id].modules).includes('output_format'), `${id} に出力形式が出ています`);
  }
});

// 翻訳は二期の追加機能。1 期に翻訳規則は存在しない（現行 system は "Do not translate keys"）。
// したがって 1期共通テンプレートの「翻訳」モジュールは空で、系列が自前の規則を持つときだけ中身が入る。
test('the translation module is empty on the shared baseline and filled only by series', () => {
  assert.deepEqual(
    standard.modules.find((mod) => mod.id === 'translation').rules,
    [],
    '1期共通テンプレートに翻訳規則が入っています',
  );
  assert.ok(!standard.userRules.includes('## 翻訳'), '1期共通テンプレートの userRules に翻訳の区分が出ています');
  for (const id of SERIES_IDS) {
    const mod = templates[id].modules.find((item) => item.id === 'translation');
    assert.ok(mod.rules.length > 0, `${id} の翻訳モジュールが空です`);
    assert.ok(
      templates[id].userRules.includes('## 翻訳（抽出した条項に訳文を付ける）'),
      `${id} に翻訳の区分がありません`,
    );
  }
});

// デモ用データ：チェック機能で「無効」と判定されるルールを 2 件だけ仕込んである。
// 画面ではルールの下に理由が出るので、理由は「どの規則と衝突するか」まで書けていること。
test('the demo data carries rules the check rejects, each with a reason naming the conflict', () => {
  const amsSeries = templates.ams.modules.find((mod) => mod.id === 'series_rules');
  const rejected = amsSeries.rules.map((rule) => ({ text: rule.text, verdict: validateRule(rule.text) }))
    .filter((item) => !item.verdict.ok);
  assert.equal(rejected.length, 2, 'デモ用の無効ルールは 2 件');
  for (const item of rejected) {
    assert.ok(item.verdict.reason, `理由がありません: ${item.text}`);
    // なぜ使えないかが日本語で読めること。
    assert.match(item.verdict.reason, /使えません|指定できません/);
  }
  // 1件は条項番号の規則、もう1件は出力形式の制約。
  assert.match(rejected[0].verdict.reason, /条項番号/);
  assert.match(rejected[1].verdict.reason, /JSON/);
  // 有効なルールはそのまま残る（デモ用に足しても既存の系列ルールは消えない）。
  assert.equal(amsSeries.rules.filter((rule) => validateRule(rule.text).ok).length, 2);
  // 無効なルールは出力（モデルへ渡す内容）には混ざらない。
  assert.equal(seriesRuleLines(templates.ams.promptText).length, RULE_COUNTS.ams);
});

// 無効なルールが残っているテンプレートは保存できない（サーバー側でも拒否）。
test('saving a template with rejected rules is blocked', async () => {
  const { default: app } = await import('../src/app.js');
  const server = app.listen(0);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const ams = templates.ams;
    const res = await fetch(`${baseUrl}/api/prompt-templates/ams`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modules: ams.modules }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /無効なルール/);
    assert.ok(Array.isArray(body.rejected) && body.rejected.length >= 2);

    // 無効ルールを除けば保存できる。
    const cleaned = JSON.parse(JSON.stringify(ams.modules));
    const series = cleaned.find((mod) => mod.id === 'series_rules');
    series.rules = series.rules.filter((rule) => validateRule(rule.text).ok);
    const ok = await fetch(`${baseUrl}/api/prompt-templates/ams`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modules: cleaned }),
    });
    assert.equal(ok.status, 200);
    const saved = await ok.json();
    assert.equal(
      saved.template.modules.find((mod) => mod.id === 'series_rules').rules.length,
      RULE_COUNTS.ams,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
