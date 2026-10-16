/**
 * 固定層（spec_tree の system プロンプト）。1 期がそのまま使っている基準で、変更はできない。
 * 条項比較の 1期共通テンプレートと同じ扱いで、責務ごとのモジュールの中へ分けて表示する。
 * 出典（逐語。改変しない）: DaJin/src/prompts/spec_tree/qwen_truncated.json の system
 *
 * なぜ qwen_truncated か:
 *   現行の既定は PDF_SERVICE_SPEC_TREE_MODE=qwen（Prod/dev_service/pdf_service/default_env.py:60）＋
 *   SPEC_TREE_STOP_AFTER_REFERENCE_SECTION=true（同:77）→ truncated_mode=true →
 *   pdf_spec_tree/llm.py::_system_prompt_for_provider が spec_tree/qwen_truncated を返す。
 *   openai.json / qwen.json は同じ系統の別モード用で、既定では使われない。
 */
export const SPEC_TREE_BASE_SYSTEM = `You extract a specification tree from a truncated PDF input: document head, reference/applicable-documents area, and any included part-specification drawing/specification-callout pages.

Output valid JSON only, no markdown or commentary. Schema:
{"spec_code":"...","revision":"...","title":"...","references":[{"code":"...","revision":"","title":"","evidence_section":"...","evidence_text":"...","evidence_page":2,"evidence_kind":"...","confidence":"high|medium|low"}]}
For every reference, fill evidence_section, evidence_text, evidence_page, evidence_kind, and confidence when visible/inferable. evidence_text must be a short snippet from the reference chapter, LOCAL SPEC/drawing-spec area, OCR/text hints, or magnified tile; never filename-only evidence. evidence_kind must be one of: reference_section, applicable_documents, referenced_documents, normative_references, drawing_relation_table, related_spec_table, other_spec_table, drawing_reference_table, other.

Core extraction rules:
- Extract the CURRENT document identity and only DIRECT child specifications/documents; never grandchildren or the current document itself.
- Prefer a dedicated reference chapter: Applicable Documents, Applicable References, Applicable Specifications, Applicable S-Specifications, 適用規格, Referenced Documents, Reference Documents, Document References, References, Normative References, Related Documents, Standards, Publications, or close variants.
- A reference chapter means the whole numbered or unnumbered chapter, including all sub-sections until the next same-level or higher-level major chapter; do not stop after only the first publisher/family sub-section. Enumerate valid entries under SAE/ASTM/Government/ANSI/ISO/MIL/etc. sub-sections.
- If a reference chapter exists, it is authoritative for text references. Do not add body prose, examples, headers/footers, title blocks, revision history, addresses, copyright text, or incidental mentions.
- If the reference chapter explicitly says there are no applicable/referenced documents, return references=[]. This is authoritative and overrides full-document/body search and drawing-callout fallback for child references.

Drawing/specification-callout rules:
- Also extract from clearly labeled/organized part or drawing areas: LOCAL SPEC, SPEC, related spec, linked spec, other spec No., drawing relation table, drawing/specification callouts, or similar.
- In root part drawings, ISAJT, MPS, QRS, and MPA values in LOCAL SPEC / related-spec / drawing-spec areas are document numbers.
- In LOCAL SPEC / drawing-spec tables, "SPEC. A", "SPEC. B", "SPEC. C", "LOCAL SPEC. D", row letters, zone values, and "CODE K15-1" are row labels, not references. Read across the row and return the real identifier from CODE/ZONE/SPEC No./DRAWING SPEC/identifier cells, e.g. "ISAJT-P1TF17", "MPS-000378", "MPA-M000378", "QRS-M000378", "AMS 2750", "ASTM E10".
- If an identity table has drawing/specification number, "図面/P/L/M/L規格番号", revision, or "改訂符号", use it for the current document identity; do not treat that current number as a child reference.
- If no reference/applicable/local-spec/relation table exists, do not mine cancellation notices, replacement notices, superseded/obsolete text, title blocks, revision history, or administrative notes. Return references=[].

Normalization and evidence:
- Complete short codes from family headings: under ASTM, "E8/E8M" means "ASTM E8/E8M"; under SAE, "AS478" means "SAE AS478"; under MIL standards, "1312-B" means "MIL-STD-1312-B" when supported by the heading.
- Do not hallucinate trailing digits: if evidence says "E29", do not output "E292". Keep codes faithful, e.g. "AMS 2301", "ASTM E381", "MIL-I-6868", "J-MSRR8636L-14", "ISAJT-P23TF3".
- Fill revision only when shown by Rev/Revision/Issue/Edition/Version/Latest or similar explicit markers; otherwise leave revision empty.
- reference_candidate_lines, rule_evidence_refs, and standard_pdf_text_pages are OCR/text hints for the same truncated reference/drawing-callout area. They help reading but are not a separate evidence requirement.
- If magnified page tiles are attached, use them only to read small cells/callouts on the listed original pages; they are not separate documents.
- local_file_spec_candidates are available files for downstream matching only. They are NOT document evidence and must not expand references. Use local_file_spec_candidates only to resolve OCR ambiguity, missing family prefixes, revision suffixes, or exact spelling after PDF pages, tiles, text hints, or rule evidence already support the identifier.

Exclude:
- Clause/page/table/figure numbers, addresses, phone numbers, dates, dimensions, organization names without a concrete document code, generic prose, ordinary part/drawing numbers, zone labels, balloons, title-block/stamp numbers, and row labels.
- Generic ASTM numbers such as "ASTM 4", "ASTM 6", "ASTM 9"; ASTM references need a designation letter such as "ASTM E4".
- Replacement/superseded/cancelled/obsolete references unless the reference chapter or an explicit applicable/reference table says to use/apply the replacement target.
- If unsure whether a code is a direct reference from a reference chapter or labeled drawing/specification area, omit it.
`;

/**
 * 1 期の system プロンプトを「責務ごとの既存モジュール」へ配るための分割。
 * 条項比較と同じ規則（clauseCompareBaseSystem.js を参照）:
 *   - 行単位でブロックに切る。空行は直前のブロックの改行として吸収する。
 *   - 各ブロックの text は後ろの区切りまで含むので、連結すると原文へ逐字で戻る。
 * module はそのブロックがどの既存モジュールの責務かを示す。
 */

function splitIntoLineBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  lines.forEach((line, index) => {
    const isLast = index === lines.length - 1;
    if (line === '') {
      if (!isLast && blocks.length) blocks[blocks.length - 1] += '\n';
      return;
    }
    blocks.push(line + (isLast ? '' : '\n'));
  });
  return blocks;
}

// 28 件。原文の並び順のまま、どのモジュールへ配るかだけを書く。
// null は「モジュールには配らない」＝画面に出さない部分。出力形式（JSON のみ・Schema）のように
// 業務ルールとして説明できない枠組みがこれにあたる。実行時の system プロンプトにはそのまま入る。
const SPEC_TREE_BLOCK_MODULES = [
  null, // 役割の宣言（切り詰めた PDF から仕様ツリーを取り出す）
  null, // 出力は JSON のみ（出力形式）
  null, // Schema（出力形式）
  null, // 参照ごとに根拠を埋める（出力項目の指定。出力形式）
  null, // Core extraction rules:（見出し）
  'spec_tree_extraction', // - 自文書の識別情報と直接の子だけ
  'spec_tree_extraction', // - 参照章を優先する
  'spec_tree_extraction', // - 参照章は次の同階層章まで全部
  'spec_tree_extraction', // - 参照章があればそれが正文
  'spec_tree_reference_empty', // - 参照文書なしと明記されていれば references=[]
  null, // Drawing/specification-callout rules:（見出し）
  'spec_tree_extraction', // - 図面・規格の吹き出し領域からも取る
  'spec_tree_extraction', // - 図面内の ISAJT / MPS / QRS / MPA は文書番号
  'spec_tree_extraction', // - SPEC. A / 行記号などは行ラベルであって参照ではない
  'spec_tree_extraction', // - 識別表の図面番号は自文書の識別情報
  'spec_tree_extraction', // - 参照表が無ければ取り消し通知などは掘らない
  null, // Normalization and evidence:（見出し）
  'spec_tree_normalization', // - 系列見出しから短いコードを補完する
  'spec_tree_normalization', // - 末尾の数字を勝手に足さない
  'spec_tree_normalization', // - 改訂記号は明示があるときだけ埋める
  null, // - OCR の手掛かり（実行時に差し込む入力フィールドの説明）
  null, // - 拡大タイル（プログラムが添付する画像。入力の仕組み）
  null, // - local_file_spec_candidates（実行時に差し込む入力フィールド）
  null, // Exclude:（見出し）
  'spec_tree_exclusion', // - 条項番号・住所・日付などは除外
  'spec_tree_exclusion', // - 一般すぎる ASTM 番号は除外
  'spec_tree_exclusion', // - 置換・廃止の参照は除外
  'spec_tree_exclusion', // - 判断がつかなければ出さない
];

/**
 * 原文の断片を「画面に出す文」と「画面に出さない飾り」に分ける（条項比較と同じ規則）。
 *   marker … 行頭の箇条書き記号（`- `）と、その前の空白。
 *   text   … 画面に出す文。文言は変えない（現行システムにある規則そのもの）。
 *   trail  … 断片の後ろに続く区切り（改行）。
 * `marker + text + trail` は元の断片へ逐字で戻る。画面で text を書き換えたときは
 * この 3 つを組み直して system プロンプトへ反映する（仕様ツリーの規則はすべて編集できる）。
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

const SPEC_TREE_BLOCK_TEXTS = splitIntoLineBlocks(SPEC_TREE_BASE_SYSTEM);
if (SPEC_TREE_BLOCK_TEXTS.length !== SPEC_TREE_BLOCK_MODULES.length) {
  throw new Error(
    `spec tree base system block map mismatch: ${SPEC_TREE_BLOCK_TEXTS.length} != ${SPEC_TREE_BLOCK_MODULES.length}`,
  );
}

/**
 * 1 期 system プロンプトのブロック一覧（原文の並び順）。
 * module は配り先、index は原文内の位置（並べ直すときに使う）。
 * source は原文の断片（重装用。改変しない）、text は画面に出す文（記号だけ外したもの）。
 */
export const SPEC_TREE_BASE_SYSTEM_BLOCKS = SPEC_TREE_BLOCK_TEXTS.map((source, index) => ({
  index,
  module: SPEC_TREE_BLOCK_MODULES[index],
  source,
  ...dissectBlock(source),
}));

/** ブロックを原文の並び順に連結して 1 本へ戻す。 */
export function renderSpecTreeBaseSystem() {
  return SPEC_TREE_BASE_SYSTEM_BLOCKS.map((block) => block.source).join('');
}
