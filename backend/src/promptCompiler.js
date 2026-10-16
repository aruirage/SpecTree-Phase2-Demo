/**
 * ユーザーが自然言語で書いたルールを、システム側の設定スイッチに照合する。
 *
 * ねらい:
 *   1. ユーザーのルールをそのままシステムプロンプトへ連結しない。
 *   2. まず「どの設定スイッチに当たるか」を判定し、命中したものはプログラム側で反映する。
 *   3. 命中しなかったルールだけを自由記述としてモデルへ渡す。
 *   4. 逸脱した指示（出力形式の変更・指示の上書き・内容の捏造）はここで弾く。
 *
 * スイッチの区分は二期設計の可変層（除外 / ページ跨ぎ / 画像抽出 / レイアウト）に、
 * ユーザーが追加できる「翻訳」を加えた 5 組。
 *
 * 判定は 2 段階。まず strong（動作を表す語）を見て、当たればそのスイッチに確定する。
 * 名詞だけの弱い手がかり（「表」「図」など）は、動作語が無いときだけ使う。
 * これにより「表の中の箇条書きは 1 条項にまとめる」が画像抽出ではなくレイアウトに入る。
 */

export const SWITCHES = [
  {
    key: 'exclusion',
    label: '除外',
    description: 'ヘッダー・フッター・ページ番号・著作権・透かし・印章・注釈を条項本文に含めない',
    strong: ['除外', '含めない', '含まない', '除く', 'exclude', 'not include', 'do not include', 'do not output'],
    keywords: [
      'header', 'footer', 'page number', 'copyright', 'watermark', 'table of contents', 'disclaimer', 'boilerplate',
      'ヘッダー', 'フッター', 'ページ番号', '著作権', '透かし', '注釈', '脚注',
    ],
    value: {
      exclude_header: true,
      exclude_footer: true,
      exclude_page_number: true,
      exclude_copyright: true,
      exclude_watermark: true,
      exclude_annotation: true,
    },
  },
  {
    key: 'cross_page',
    label: 'ページ跨ぎ',
    description: 'ページをまたぐ条項・表・リストを 1 つの条項として結合する',
    strong: ['ページをまたぐ', 'ページにまたが', 'ページ跨ぎ', 'continuation', 'previous page', 'next page', 'page break'],
    keywords: ['またぐ', '次ページ', '前ページ', '継続', 'across the page', 'cross-page'],
    value: { merge_across_pages: true },
  },
  {
    key: 'image_extraction',
    label: '画像抽出',
    description: '表・図を画像として切り出す。キャプションをどう扱うかも指定できる',
    strong: ['画像として', '画像で抽出', '切り出', 'table asset', 'table image', 'as an image', 'as image'],
    keywords: ['table_images', 'figure', 'caption', 'bbox', 'region', '画像', '図', '表', 'キャプション', 'トリミング'],
    value: { include_caption: true, caption_to_text: false },
  },
  {
    key: 'layout',
    label: 'レイアウト',
    description: '改行・結合・語間スペース・読取り順・言語分離の扱い',
    strong: ['まとめ', '結合', 'つなげ', '統合', 'merge', 'combine', '改行'],
    keywords: [
      'newline', 'line break', 'word spacing', 'reading order', 'indent', 'language',
      '連結', '分割', '言語', 'インデント', 'レイアウト', '読取り順',
    ],
    value: {
      newline_policy: 'preserve',
      merge_policy: 'merge_numbered',
      language_separation: true,
    },
  },
  {
    key: 'translation',
    label: '翻訳',
    description: '抽出した条項に訳文を付ける',
    strong: ['翻訳', '訳を付', '日本語訳', '対訳', 'translate'],
    keywords: ['translation', 'bilingual', '訳文'],
    value: { enabled: true, target_language: 'ja' },
  },
];

/**
 * 逸脱した指示。ここに当たったルールは受理せず、理由を返す。
 * 理由は「どの層・どのモジュールの、どの規則と衝突するか」まで書く。
 * 画面ではルールの下にそのまま出るので、業務の言葉で読める文にすること。
 */
const REJECT_RULES = [
  {
    pattern: /(ignore|disregard|forget)\s+(all\s+)?(the\s+)?(previous|above|prior|earlier)\s+(instructions?|rules?|prompts?)/i,
    reason: '固定層（システムプロンプト）の指示を上書きする要求です。固定層の「役割定義とハード制約は変更できない」と矛盾するため受理できません。',
  },
  {
    pattern: /(これまで|上記|前述|以前)の(指示|命令|ルール|プロンプト)を?(無視|忘れ|破棄)/,
    reason: '固定層（システムプロンプト）の指示を上書きする要求です。固定層の「役割定義とハード制約は変更できない」と矛盾するため受理できません。',
  },
  {
    pattern: /(markdown|マークダウン|md)\s*(形式)?\s*(で)?\s*(出力|返|書)/i,
    reason: '固定層のハード制約「有効な JSON のみを出力し、Markdown や説明文を追加しない」と矛盾します。出力形式はお客様側では変更できません。',
  },
  {
    pattern: /(json\s*(以外|ではなく)|not\s+(in\s+)?json|プレーンテキストで出力)/i,
    reason: '固定層のハード制約「有効な JSON のみを出力し、Markdown や説明文を追加しない」と矛盾します。JSON 以外の形式は受理できません。',
  },
  {
    pattern: /you\s+are\s+(now\s+)?(a|an)\s+/i,
    reason: '固定層の役割定義「あなたは PDF 構造化分析の専門家です」と矛盾します。モデルの役割は変更できません。',
  },
  {
    pattern: /(あなたは|これからは).*(として振る舞|になりき|役割)/,
    reason: '固定層の役割定義「あなたは PDF 構造化分析の専門家です」と矛盾します。モデルの役割は変更できません。',
  },
];

// 禁止の言い回し。「〜するな」は捏造の要求と取り違えない。
// 「しない」単体は「存在しない」にも当たるため、命令形だけを見る。
const NEGATION = /(never|do\s+not|don'?t|must\s+not|しないで|しないこと|しないよう|禁止)/i;
// 捏造・補完の要求。存在しない番号を推測で埋めさせる指示は受理しない。
const FABRICATION_PATTERNS = [
  /(invent|fabricate|make\s+up|捏造|でっち上げ|勝手に(作|生成|補))[^。\n]*?(clause|section|番号|条項|id)/i,
  /(存在しない|欠けている|抜けている)[^。\n]*?(番号|条項|節)[^。\n]*?(補|追加|生成|埋め|推測)/,
  /(推測して|補完して|補って|埋めて)[^。\n]*?(番号|条項|id)/,
];
const FABRICATION_REASON =
  '「条項番号」モジュールの「Never invent clause ids: use only clause numbers visibly printed in the document.」と矛盾します。原文に印字されていない番号を推測で補う指示は受理できません。';

export function validateRule(line) {
  for (const rule of REJECT_RULES) {
    if (rule.pattern.test(line)) return { ok: false, reason: rule.reason };
  }
  if (FABRICATION_PATTERNS.some((pattern) => pattern.test(line)) && !NEGATION.test(line)) {
    return { ok: false, reason: FABRICATION_REASON };
  }
  return { ok: true };
}

function countHits(target, words) {
  let hits = 0;
  for (const word of words || []) {
    if (target.includes(word.toLowerCase())) hits += 1;
  }
  return hits;
}

/** ルール 1 行がどの設定スイッチに当たるかを判定する。当たらなければ null。 */
export function matchSwitch(line) {
  const target = line.toLowerCase();
  for (const sw of SWITCHES) {
    if (countHits(target, sw.strong) > 0) return sw;
  }
  let best = null;
  for (const sw of SWITCHES) {
    const hits = countHits(target, sw.keywords);
    if (hits > 0 && (!best || hits > best.hits)) best = { sw, hits };
  }
  return best ? best.sw : null;
}

/**
 * ルール本文を解析し、3 つに振り分ける。
 *   matched  … 設定スイッチに命中。プログラム側で反映し、モデルには渡さない。
 *   free     … 命中せず。自由記述のままモデルへ渡す。
 *   rejected … 逸脱した指示。受理しない。
 *
 * `## ` で始まる行は「時機（いつ呼ばれるか）」の見出しとして扱い、
 * 以降のルールをその時機に属させる。1 つのテンプレートに複数の時機を収められる。
 */
export function compileUserRules(text) {
  const sections = [];
  let current = { label: '', rules: [] };

  const flush = () => {
    if (current.label || current.rules.length) sections.push(current);
  };

  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('## ')) {
      flush();
      current = { label: line.slice(3).trim(), rules: [] };
      continue;
    }
    const verdict = validateRule(line);
    let entry;
    if (!verdict.ok) {
      entry = { line, status: 'rejected', reason: verdict.reason };
    } else {
      const sw = matchSwitch(line);
      entry = sw
        ? { line, status: 'matched', switchKey: sw.key, switchLabel: sw.label, value: sw.value }
        : { line, status: 'free' };
    }
    entry.section = current.label;
    current.rules.push(entry);
  }
  flush();

  const rules = sections.flatMap((section) => section.rules);
  const matched = rules.filter((item) => item.status === 'matched');
  const free = rules.filter((item) => item.status === 'free');
  const rejected = rules.filter((item) => item.status === 'rejected');
  const countBy = (list, status) => list.filter((item) => item.status === status).length;
  return {
    sections: sections.map((section) => ({
      label: section.label,
      counts: {
        total: section.rules.length,
        matched: countBy(section.rules, 'matched'),
        free: countBy(section.rules, 'free'),
        rejected: countBy(section.rules, 'rejected'),
      },
    })),
    rules,
    matched,
    free,
    rejected,
    switches: matched.reduce((acc, item) => {
      acc[item.switchKey] = item.value;
      return acc;
    }, {}),
    freeText: free.map((item) => item.line),
    counts: { total: rules.length, matched: matched.length, free: free.length, rejected: rejected.length },
  };
}
