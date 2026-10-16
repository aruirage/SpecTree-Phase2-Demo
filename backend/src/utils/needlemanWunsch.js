// Needleman-Wunsch によるコンテンツ類似度（トークン列の大域アラインメント）
const MATCH = 2;
const MISMATCH = -1;
const GAP = -1;

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/)
    .filter(Boolean);
}

/**
 * 2つのテキストの内容類似度 (0..1)。
 * トークン列を Needleman-Wunsch で大域アラインメントし、最大スコアで正規化する。
 */
export function needlemanWunschSimilarity(a, b) {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.length && !tb.length) return 1;
  if (!ta.length || !tb.length) return 0;

  const n = ta.length;
  const m = tb.length;
  // DP 表（n+1 x m+1）
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i += 1) dp[i][0] = i * GAP;
  for (let j = 0; j <= m; j += 1) dp[0][j] = j * GAP;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const diag = dp[i - 1][j - 1] + (ta[i - 1] === tb[j - 1] ? MATCH : MISMATCH);
      dp[i][j] = Math.max(diag, dp[i - 1][j] + GAP, dp[i][j - 1] + GAP);
    }
  }
  const maxScore = Math.max(n, m) * MATCH;
  return Math.max(0, Math.min(1, dp[n][m] / maxScore));
}
