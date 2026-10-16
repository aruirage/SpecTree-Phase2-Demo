/**
 * 固定層（条項比較の system プロンプト）。1 期がそのまま使っている基準で、変更はできない。
 * 画面では「1期共通テンプレート」にだけ、責務ごとのモジュールの中へ分けて表示する。
 *
 * 現行システムは「時機」ごとに別の system を送っている。ここはその 2 本を**逐字**で持つ。
 * 出典（逐語。改変しない）:
 *   - scan      : DaJin/src/prompts/clause_compare/gemini_page.json の system（3959 字）
 *                 … スキャン文書（画像から読み取る）ページ解析。非標準リンクの主力。
 *   - textLayer : DaJin/src/prompts/clause_compare/openai_image_only.json の system（2119 字）
 *                 … テキスト層がある文書のページ解析。
 * どちらも src/prompts/loader.py::_REQUIRED_FIELDS の白名单内で、import 時に検証される。
 */
export const CLAUSE_COMPARE_BASE_SYSTEM = {
  scan: `You are extracting structured content from non-standard specification PDFs.

You must identify:
1. Clause-like text blocks in reading order.
2. Visible table/figure regions on the page.

Requirements:
- Return JSON only.
- Do not translate keys.
- Keep the original language of the document text.
- Preserve normal word spacing in English text. Do not concatenate adjacent words; for example, output \`APPLICABLE DOCUMENTS\`, not \`APPLICABLEDOCUMENTS\`.
- Treat text extraction as transcription, not rewriting. Preserve exact words, singular/plural forms, verb forms, and word endings; do not change \`Control\` to \`Controls\` or \`represented\` to \`represents\`.
- Preserve any wording exactly. Do not paraphrase synonymous expressions
- Do not correct grammar, style, or terminology. When raw_text is available, use it to verify exact tokens and word endings.
- Use raw text hints to recover missing spaces when the page image is ambiguous, while keeping the visible document wording.
- Be conservative: if a ref or bbox is unclear, leave ref empty or skip the asset.
- For clause ids, keep the visible numbering format when present.
- Only use numbered clause ids such as \`1\`, \`1.1\`, or \`3.4.5\`; do not emit front matter headings such as \`RATIONALE\` as clauses.
- Never invent clause ids. A clause id must be printed in the document as a standalone clause number; if a paragraph instead starts with a list marker, it is list content, not a clause.
- List/enumeration markers such as \`1)\`, \`2)\`, \`a)\`, \`b)\`, \`(1)\`, \`(2)\` (including full-width forms \`1）\`, \`（1）\`, \`a）\`) are list items inside the current numbered clause. Keep them in the parent clause's text in reading order. Do not emit them as separate clauses and do not fabricate dotted ids like \`6.7.2.2\` or \`6.7.2.2.a\` for them. Never renumber a list item into a dotted clause id (for example \`2)\` under \`6.8.5.1\` must not become \`6.8.5.1.2\`).
- If a page shows both a parent heading and subordinate numbered clauses, output each numbered clause separately. Do not merge \`1\` with \`1.1\`, \`2\` with \`2.1\`, etc.
- A region with visible table border lines (grid lines) or a visible table title/caption such as \`表3\`, \`Table 3\`, or \`様式N\` is a table: emit it as a \`table\` asset.
- A borderless region is a table only when it is genuine tabular data such as a grid of value cells (\`P / S / P+S\` percentage columns, \`焼準 / 焼戻 / 硬さ\` temperature or hardness values). A borderless region that is only aligned text — specification lists, label/value rows, or form-like rows where each line is a label with prose — is clause text, not a table.
- Do not transcribe the content of a region that you emit as a table/figure asset into clause text; clause text and table assets must not duplicate the same content. EXCEPTION: if the region continues content from the previous page (cross-page continuation), transcribe its textual content as a continuation clause with an empty id in addition to emitting the asset.
- If a table or list on this page is the continuation of a clause from the previous page (for example a standards list, specification list, or clause body that continues across the page break, possibly rendered as table rows), you MUST transcribe its visible text as a clause with an empty id so the previous page's clause is complete. Do not drop continuation content just because it looks like a table.
- If a table is cut off at the bottom edge of this page (rows continue on the next page) or starts at the top edge as a continuation of a table from the previous page, still emit the visible portion as a table asset with its bbox covering the visible part. Never skip a table because it is partially visible.
- If this page begins with list items (markers like \`l)\`, \`3)\`, \`a)\`, \`(4)\`, \`（2）\`) whose parent clause is on a previous page, do NOT use those markers as clause ids. Emit them as clauses with an EMPTY id, keeping the list marker at the start of the text so they merge into the previous page's clause.
`,
  textLayer: `Extract clause JSON from one PDF page image only.

Schema: {"clauses":[{"id":"...","text":"...","table_images":[]}]}
Use exactly these keys. Read only the visible page image; do not assume hidden text chunks or external OCR text. Preserve source wording and word forms (singular/plural, e.g. represented); do not paraphrase, correct grammar, or invent content. Remove headers/footers and omit the clause id from text. Preserve the document's line breaks exactly: each visual line in the image becomes a \`\\n\` in the text field; do not collapse line breaks into spaces or merge lines. Merge hyphenated word breaks only (e.g. "represen-ted" -> "represented"). Semantically ignore non-clause footer/disclaimer/copyright/order/contact/license/watermark text, including document-distribution or legal boilerplate, even when it appears immediately after a clause on the page. Keep each explicit body clause id as its own row in visible reading order. Numbered clause ids form a hierarchy: keep each explicitly printed clause number as its own row in visible reading order; do not merge a parent heading with its numbered child. Never invent clause ids: use only clause numbers visibly printed in the document. List/enumeration markers such as \`1)\`, \`2)\`, \`a)\`, \`b)\`, \`(1)\`, \`(2)\` (including full-width forms \`1）\`, \`（1）\`, \`a）\`) are list items inside the current numbered clause. Keep them in the parent clause's text in reading order. Do not emit them as separate clauses and do not fabricate dotted ids like \`6.7.2.2\` or \`6.7.2.2.a\` for them. Never renumber a list item into a dotted clause id (for example \`2)\` under \`6.8.5.1\` must not become \`6.8.5.1.2\`). A list item can start a new visual line or a new page while its parent clause heading stays on the previous page; even then the marker \`2)\` is list content of the parent clause and its number must never be emitted as a clause id. Parenthesized inline enumerations such as "(1)", "(2)", and "(3)" are not clause ids; keep them inside the current clause text. For text that visibly continues a clause from a previous page without showing its clause id, use an empty id.
`,
};

/**
 * 1 期の system プロンプトを「責務ごとの既存モジュール」へ配るための分割。
 *
 * 分割は原文から機械的に行う（人が書き写さない）。規則:
 *   - 行単位でブロックに切る。空行は直前のブロックの改行として吸収する。
 *   - テキスト層あり文書の本文（3 行目）だけは 1 文 1 ブロックに切る
 *     （文の区切りは「. + 空白 + 大文字」）。
 * 各ブロックの source は「後ろに続く区切り」まで含むので、
 *   BLOCKS[key].map((b) => b.source).join('') === CLAUSE_COMPARE_BASE_SYSTEM[key]
 * が常に成り立つ（テストで担保する）。
 *
 * module はそのブロックがどの既存モジュールの責務かを示す。1 期のプロンプトを
 * 別モジュールとして括り出さず、既存モジュールの中へ配るための対応表。
 *   - モジュール id … そのモジュールの規則として画面に出す（1 期のプロンプトの断片）
 *   - null          … モジュールには配らない。役割の宣言や出力形式（JSON のみ・Schema）のように、
 *                     業務ルールとして説明できない枠組み。画面には出さないが、実行時の system
 *                     プロンプトにはそのまま入る（renderClauseCompareBaseSystem が原文へ戻す）。
 */

function splitIntoLineBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  lines.forEach((line, index) => {
    const isLast = index === lines.length - 1;
    if (line === '') {
      // 空行は直前のブロックに吸収する（末尾の改行も同じ扱い）。
      if (!isLast && blocks.length) blocks[blocks.length - 1] += '\n';
      return;
    }
    blocks.push(line + (isLast ? '' : '\n'));
  });
  return blocks;
}

/** 1 文 1 ブロック。最後の 1 文だけは末尾の区切り（改行）をそのまま持つ。 */
function splitIntoSentenceBlocks(text) {
  const parts = text.split(/(?<=[.])\s+(?=[A-Z(])/);
  return parts.map((part, index) => (index === parts.length - 1 ? part : `${part} `));
}

const TEXT_LAYER_LINE_BLOCKS = splitIntoLineBlocks(CLAUSE_COMPARE_BASE_SYSTEM.textLayer);
// [0] task 行（後ろの空行込み） / [1] Schema 行 / [2] 本文（1 文ずつに切る）
const TEXT_LAYER_BLOCK_TEXTS = [
  TEXT_LAYER_LINE_BLOCKS[0],
  TEXT_LAYER_LINE_BLOCKS[1],
  ...splitIntoSentenceBlocks(TEXT_LAYER_LINE_BLOCKS[2]),
];

// 25 件。原文の並び順のまま、どのモジュールへ配るかだけを書く。
const SCAN_BLOCK_MODULES = [
  null, // 役割の宣言（非標準仕様書から構造化内容を取り出す）
  null, // You must identify:（出力に含めるものの見出し）
  null, // 1. 条項らしいテキストブロック（見出しの下の列挙。規則文ではない）
  null, // 2. ページ上に見えている表・図の領域（同上）
  null, // Requirements:（以降の見出し）
  null, // - Return JSON only.（出力形式。プログラム側の取り決め）
  'text_extraction', // - キーを翻訳しない
  'text_extraction', // - 本文の言語をそのまま保つ
  'layout', // - 英単語の語間スペースを保つ
  'text_extraction', // - 抽出は転写であって書き換えではない
  'text_extraction', // - 言い回しを変えない
  'text_extraction', // - 文法・用語を直さない
  'text_extraction', // - raw_text を空白補完の手掛かりに使う
  'asset_boundary', // - 判断がつかない ref/bbox は空にする
  'clause_id', // - 条項番号は見えている表記を保つ
  'clause_id', // - 番号付きの条項番号だけを使う
  'clause_id', // - 条項番号を捏造しない
  'clause_id', // - リスト記号は条項番号ではない
  'layout', // - 親見出しと子条項を結合しない
  'asset_boundary', // - 表罫線・表題がある領域は表
  'asset_boundary', // - 罫線なしでも実データの格子なら表
  'asset_boundary', // - 表として切り出した内容を本文へ二重転記しない
  'page_handling', // - 前ページからの続きは空 id の条項にする
  'page_handling', // - ページ端で切れた表も可視部分を出す
  'page_handling', // - 前ページの親条項に属するリスト項目
];

// 19 件（task / Schema / 本文 17 文）。同じく原文の並び順。
const TEXT_LAYER_BLOCK_MODULES = [
  null, // task 行（1 ページ画像から条項 JSON を出す）: 役割の宣言
  null, // Schema 行（出力形式）
  null, // Use exactly these keys.（出力形式）
  'text_extraction', // 見えているページ画像だけを読む
  'text_extraction', // 原文の語形を保つ
  'exclusion', // ヘッダー・フッターを外し、本文から条項番号を除く
  'layout', // 改行をそのまま保つ
  'layout', // ハイフン分割された語だけを結合する
  'exclusion', // フッター・免責・著作権などを意味的に無視する
  'clause_id', // 明示された本文の条項番号を 1 行ずつ保つ
  'clause_id', // 番号付き条項は階層を成す
  'clause_id', // 条項番号を捏造しない
  'clause_id', // リスト記号は条項番号ではない
  'clause_id', // 親条項のテキストに残す
  'clause_id', // 別条項として出さず、点線 id も作らない
  'clause_id', // 点線 id へ振り直さない
  'clause_id', // 親見出しが前ページでもリスト記号は本文
  'clause_id', // 丸括弧の列挙は条項番号ではない
  'page_handling', // 前ページからの続きの本文
];

/**
 * 原文の断片を「画面に出す文」と「画面に出さない飾り」に分ける。
 *   marker … 行頭の箇条書き記号（`- ` / `1. `）と、その前の空白。
 *   text   … 画面に出す文。文言は変えない（現行システムにある規則そのもの）。
 *   trail  … 断片の後ろに続く区切り（改行・空白）。原文の断片は区切りまで含むため。
 * `marker + text + trail` は元の断片へ逐字で戻る。画面で text を書き換えたときは
 * この 3 つを組み直して system プロンプトへ反映する（＝画面の編集がそのまま効く）。
 */
function dissectBlock(source) {
  const lead = /^\s*/.exec(source)[0];
  const rest = source.slice(lead.length);
  const markerMatch = /^(-\s+|\d+\.\s+)/.exec(rest);
  const listMarker = markerMatch ? markerMatch[0] : '';
  const body = rest.slice(listMarker.length);
  const text = body.trimEnd();
  return { marker: `${lead}${listMarker}`, text, trail: body.slice(text.length) };
}

function buildBlocks(key, texts, modules) {
  if (texts.length !== modules.length) {
    throw new Error(`base system block map mismatch for ${key}: ${texts.length} != ${modules.length}`);
  }
  return texts.map((source, index) => ({
    index,
    module: modules[index],
    // 原文の断片。並べ直すと 1 期の system プロンプトへ逐字で戻る（改変しない）。
    source,
    ...dissectBlock(source),
  }));
}

/**
 * 1 期 system プロンプトのブロック一覧（原文の並び順）。
 * module は配り先、index は原文内の位置（並べ直すときに使う）。
 */
export const CLAUSE_COMPARE_BASE_SYSTEM_BLOCKS = {
  scan: buildBlocks('scan', splitIntoLineBlocks(CLAUSE_COMPARE_BASE_SYSTEM.scan), SCAN_BLOCK_MODULES),
  textLayer: buildBlocks('textLayer', TEXT_LAYER_BLOCK_TEXTS, TEXT_LAYER_BLOCK_MODULES),
};

/** ブロックを原文の並び順に連結して 1 本へ戻す。 */
export function renderClauseCompareBaseSystem(key) {
  return (CLAUSE_COMPARE_BASE_SYSTEM_BLOCKS[key] || []).map((block) => block.source).join('');
}
