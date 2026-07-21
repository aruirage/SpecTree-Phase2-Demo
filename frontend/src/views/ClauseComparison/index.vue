<script setup>
import { ref, computed, nextTick, onBeforeUnmount, onMounted, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { useJobProgress } from '@/composables/useJobProgress';

defineOptions({ name: 'ClauseComparison' });

const CLAUSE_PROGRESS_STAGES = {
  submitting: { value: 5, cap: 12, label: '処理を準備中...' },
  queued: { value: 10, cap: 16, label: '処理を準備中...' },
  running: { value: 14, cap: 20, label: '処理を準備中...' },
  extracting_old_new: { value: 22, cap: 76, requestDriven: true, label: '処理中...' },
  extracting_old: { value: 22, cap: 48, requestDriven: true, label: '処理中...' },
  extracting_new: { value: 50, cap: 76, requestDriven: true, label: '処理中...' },
  comparing: { value: 80, cap: 91, label: '処理中...' },
  packaging: { value: 94, cap: 98, label: '結果を準備中...' },
  succeeded: { value: 98, cap: 99, label: '結果を準備中...' },
};

// ── State ──────────────────────────────────────────────────────────────────
const oldFile      = ref(null);
const newFile      = ref(null);
const oldUploading = ref(false);
const newUploading = ref(false);
const sharedSessionId = ref(null);
const result       = ref(null);
const status       = ref('');
const error        = ref('');
const running      = ref(false);
const stoppingRun  = ref(false);
const activeStatusFilter = ref('all');
const resultFullscreen = ref(false);

const contentAreaRef = ref(null);
const rightPanelRef = ref(null);
const lightboxTeleportTarget = computed(() => (
  resultFullscreen.value && rightPanelRef.value ? rightPanelRef.value : 'body'
));
const visibleClauseCount = ref(50);
const UNCHANGED_STATUS_LABEL = '無';
const STATUS_FILTERS = [
  { key: 'all', label: 'すべて' },
  { key: '変更', label: '変更' },
  { key: '追加', label: '追加' },
  { key: '削除', label: '削除' },
  { key: '無', label: '無' },
];
const changeStatuses = new Set(['追加', '削除', '変更']);
const detailedChangeTypesEnabled = computed(() => result.value?.detailedChangeTypesEnabled !== false);
const showImageColumns = true;
const revSectionColspan = computed(() => (showImageColumns ? 4 : 3));
const diffSegmentCache = new Map();
const MAX_TOKEN_DIFF_CELLS = 160000;
const MAX_UPLOAD_FILE_SIZE = 50 * 1024 * 1024;
const CLAUSE_RENDER_BATCH_SIZE = 50;
const CLAUSE_SCROLL_THRESHOLD = 360;
const CLAUSE_SCROLL_BOTTOM_EPSILON = 4;
const FILE_SIZE_LIMIT_MESSAGE = 'ファイルサイズが50MBを超えています。50MB以下のファイルをアップロードしてください。';
const CLAUSE_COMPARE_RECOVERY_KEY = 'daikin:clause-compare:recovery:v1';
let runAbortController = null;
let runRequestSeq = 0;
let activeRunId = null;
const {
  progress: runProgress,
  label: runProgressLabel,
  progressSummary: runProgressSummary,
  start: startRunProgress,
  complete: completeRunProgress,
  stop: stopRunProgress,
} = useJobProgress({
  progressUrl: '/api/clause-compare/progress',
  stages: CLAUSE_PROGRESS_STAGES,
  fallbackLabel: '処理中...',
  pollMs: 500,
  smoothPageSummary: true,
  pageSmoothStep: 1,
});

// Lightbox: { images:[{url,label}], idx:number } | null
const lightbox = ref(null);

function openLightbox(images, startIdx = 0) {
  lightbox.value = { images, idx: startIdx };
}
function lightboxPrev() {
  if (!lightbox.value) return;
  const len = lightbox.value.images.length;
  lightbox.value = { ...lightbox.value, idx: (lightbox.value.idx - 1 + len) % len };
}
function lightboxNext() {
  if (!lightbox.value) return;
  const len = lightbox.value.images.length;
  lightbox.value = { ...lightbox.value, idx: (lightbox.value.idx + 1) % len };
}

// ── Helpers ────────────────────────────────────────────────────────────────
async function readErrorPayload(res, fallbackMessage = 'Processing failed.') {
  let payload = null;
  try {
    payload = await res.json();
  } catch {}
  return createUiErrorMessage({
    code: payload?.code || res.status || 'UNKNOWN',
    rawMessage: payload?.error || payload?.message || payload?.detail,
    fallbackMessage,
    status: res.status,
  });
}

function formatCaughtError(e, fallbackMessage = 'Processing failed.') {
  const message = e instanceof Error ? e.message : '';
  if (message.startsWith('Error code:')) return message;
  return createUiErrorMessage({
    code: inferErrorCode(e, message),
    rawMessage: message,
    fallbackMessage,
  });
}

function createUiErrorMessage({ code, rawMessage, fallbackMessage, status = null }) {
  const displayCode = String(code || 'UNKNOWN').trim() || 'UNKNOWN';
  const message = summarizeKnownErrorCode(displayCode) || summarizeErrorMessage(rawMessage, fallbackMessage, status);
  return `Error code: ${displayCode} - ${message}`;
}

function summarizeKnownErrorCode(code) {
  switch (String(code || '').toUpperCase()) {
    case 'FEATURE_RUN_IN_PROGRESS':
      return 'Another clause comparison is already running. Please wait for it to finish, then try again.';
    case 'PDF_ENCRYPTED':
      return 'The PDF is encrypted or password-protected.';
    case 'PDF_DAMAGED':
      return 'The PDF file is damaged or unreadable.';
    case 'INVALID_FILE':
      return 'The selected file is not a valid PDF.';
    case 'LLM_CONNECTION':
      return 'The AI model service connection was interrupted. Please retry, or check the model endpoint/network.';
    default:
      return '';
  }
}

function inferErrorCode(e, message) {
  if (e?.code) return e.code;
  if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|network|fetch|socket|接続/i.test(message)) {
    return 'NETWORK';
  }
  return 'UNKNOWN';
}

function summarizeErrorMessage(rawMessage, fallbackMessage = 'Processing failed.', status = null) {
  const text = String(rawMessage || '').replace(/https?:\/\/\S+/g, '').trim();
  const statusMessage = summarizeHttpStatus(status);
  if (statusMessage) return statusMessage;
  if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|network|fetch failed|failed to fetch|socket|接続/i.test(text)) {
    return 'Backend service is unavailable.';
  }
  if (/ECONN|ETIMEDOUT|network|fetch|socket|接続/i.test(text)) {
    return 'A network error occurred.';
  }
  if (/timeout|timed out|タイムアウト/i.test(text)) {
    return 'The request timed out.';
  }
  if (/upload|アップロード/i.test(text)) {
    return 'Upload failed.';
  }
  if (/compare|比較/i.test(text)) {
    return 'Comparison failed.';
  }
  return fallbackMessage;
}

function summarizeHttpStatus(status) {
  switch (Number(status)) {
    case 400:
      return 'Invalid request. Please check the selected files and settings.';
    case 401:
    case 403:
      return 'You are not authorized to perform this action.';
    case 404:
      return 'The requested session or result was not found.';
    case 413:
      return 'The uploaded file is too large.';
    case 429:
      return 'Too many requests. Please try again later.';
    case 499:
      return 'The operation was canceled.';
    case 500:
      return 'Backend processing failed.';
    case 502:
    case 503:
    case 504:
      return 'Backend service is unavailable.';
    default:
      return '';
  }
}

// ── Upload ─────────────────────────────────────────────────────────────────
async function uploadFile(file, fileType) {
  if (!canUpload.value) return;
  const setUploading = fileType === 'old' ? (v) => { oldUploading.value = v; } : (v) => { newUploading.value = v; };
  const setFile      = fileType === 'old' ? (v) => { oldFile.value = v; }      : (v) => { newFile.value = v; };

  if (file.size > MAX_UPLOAD_FILE_SIZE) {
    error.value = FILE_SIZE_LIMIT_MESSAGE;
    return;
  }

  setUploading(true);
  error.value = '';

  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('fileType', fileType);
    if (sharedSessionId.value) formData.append('sessionId', sharedSessionId.value);

    const res = await fetch('/api/clause-compare/upload', { method: 'POST', body: formData });
    if (!res.ok) {
      throw new Error(await readErrorPayload(res, 'Upload failed.'));
    }
    const data = await res.json();
    if (!sharedSessionId.value) sharedSessionId.value = data.sessionId;
    setFile({ sessionId: data.sessionId, fileId: data.fileId, fileName: data.fileName, fileType: data.fileType });
    saveClauseCompareRecovery(false);
  } catch (e) {
    error.value = formatCaughtError(e, 'Upload failed.');
    setUploading(false);
  } finally {
    if (!error.value) {
      await new Promise(r => setTimeout(r, 600));
      setUploading(false);
    }
  }
}

function onDropFile(e, fileType) {
  e.preventDefault();
  if (!canUpload.value) return;
  const file = e.dataTransfer.files[0];
  if (file) uploadFile(file, fileType);
}

function onFileChange(e, fileType) {
  if (!canUpload.value) {
    e.target.value = '';
    return;
  }
  const file = e.target.files?.[0];
  if (file) uploadFile(file, fileType);
  e.target.value = '';
}

// ── Run comparison ─────────────────────────────────────────────────────────
async function handleRun() {
  if (!oldFile.value || !newFile.value || !sharedSessionId.value || running.value || stoppingRun.value) return;

  error.value   = '';
  status.value  = '条項を比較中...';
  result.value  = null;
  resultFullscreen.value = false;
  running.value = true;
  stoppingRun.value = false;
  const requestSeq = ++runRequestSeq;
  const runId = createClientRunId();
  activeRunId = runId;
  runAbortController = new AbortController();
  saveClauseCompareRecovery(true);
  startRunProgress(sharedSessionId.value);

  try {
    const res = await fetch('/api/clause-compare/run/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: runAbortController.signal,
      body: JSON.stringify({
        sessionId: sharedSessionId.value,
        oldFileId: oldFile.value.fileId,
        newFileId: newFile.value.fileId,
        clientRunId: runId,
      }),
    });
    if (requestSeq !== runRequestSeq) return;
    if (!res.ok) {
      throw new Error(await readErrorPayload(res, 'Comparison failed.'));
    }
    const accepted = await res.json();
    if (accepted?.runId) activeRunId = accepted.runId;
    saveClauseCompareRecovery(true, accepted);
    const data = await waitForClauseCompareResult({ requestSeq, pollMs: 3000, stopOnNotFound: true });
    if (!data) throw new Error('比較結果がありません');
    if (requestSeq !== runRequestSeq) return;
    completeRunProgress();
    result.value = data;
    resetVisibleClauses();
    status.value = `比較完了：合計 ${data.totalClauses} 条項、${data.changedClauses} 件変更`;
    saveClauseCompareRecovery(false, accepted);
  } catch (e) {
    if (requestSeq !== runRequestSeq || e?.name === 'AbortError') return;
    stopRunProgress({ reset: true });
    error.value  = formatCaughtError(e, 'Comparison failed.');
    status.value = '';
    if (isSessionNotFoundError(error.value)) {
      resetClauseCompareSessionState({ errorMessage: error.value });
    } else {
      clearClauseCompareRecovery();
    }
  } finally {
    if (requestSeq === runRequestSeq) {
      stopRunProgress();
      running.value = false;
      stoppingRun.value = false;
      runAbortController = null;
      activeRunId = null;
    }
  }
}

async function waitForClauseCompareResult({ requestSeq, pollMs = 3000, stopOnNotFound = false } = {}) {
  if (!sharedSessionId.value) return null;
  while (true) {
    if (requestSeq !== runRequestSeq) return null;
    let res = null;
    try {
      res = await fetch(`/api/clause-compare/result?sessionId=${encodeURIComponent(sharedSessionId.value)}`, { cache: 'no-store' });
    } catch (e) {
      await new Promise(resolve => setTimeout(resolve, pollMs));
      continue;
    }
    if (res.ok) {
      const data = await res.json();
      if (data?.clauses) return data;
    } else if (res.status === 404 && stopOnNotFound) {
      throw new Error(await readErrorPayload(res, 'The requested session or result was not found.'));
    } else if (res.status !== 202 && res.status !== 404) {
      throw new Error(await readErrorPayload(res, 'Comparison failed.'));
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}

async function handleStopRun() {
  if (!running.value || stoppingRun.value) return;
  const runId = activeRunId;
  runRequestSeq += 1;
  runAbortController?.abort();
  runAbortController = null;
  stopRunProgress({ reset: true });
  stoppingRun.value = true;
  result.value = null;
  resultFullscreen.value = false;
  error.value = '';
  status.value = '処理を停止しています...';
  try {
    if (sharedSessionId.value) {
      await fetch('/api/clause-compare/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sharedSessionId.value, runId }),
      });
    }
  } catch (err) {
    console.error('Cancel clause comparison failed', err);
  } finally {
    if (runId === activeRunId) {
      activeRunId = null;
    }
    stoppingRun.value = false;
    running.value = false;
    status.value = '処理を停止しました。ファイルを再アップロードできます。';
    clearClauseCompareRecovery();
    ElMessage.success('処理を停止しました');
  }
}

function createClientRunId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ── Export ─────────────────────────────────────────────────────────────────
function handleExport(format) {
  if (!sharedSessionId.value) return;
  const a   = document.createElement('a');
  a.href     = `/api/clause-compare/export?format=${format}&sessionId=${sharedSessionId.value}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function handleDownloadCommand(command) {
  if (command === 'excel' || command === 'csv') {
    handleExport(command);
    return;
  }
  if (command === 'images') {
    handleExportImages();
  }
}

function handleExportImages() {
  if (!sharedSessionId.value) return;
  const a = document.createElement('a');
  a.href = `/api/clause-compare/images/export?sessionId=${sharedSessionId.value}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function toggleResultFullscreen() {
  if (!result.value) return;
  const panel = rightPanelRef.value;
  if (resultFullscreen.value) {
    if (document.fullscreenElement === panel && document.exitFullscreen) {
      await document.exitFullscreen().catch(() => {});
    }
    resultFullscreen.value = false;
    return;
  }

  resultFullscreen.value = true;
  await nextTick();
  if (panel?.requestFullscreen) {
    try {
      await panel.requestFullscreen({ navigationUI: 'hide' });
    } catch {
      // Keep the CSS fullscreen fallback active if native fullscreen is unavailable.
    }
  }
}

function handleDocumentFullscreenChange() {
  const panel = rightPanelRef.value;
  if (document.fullscreenElement === panel) {
    resultFullscreen.value = true;
  } else if (!document.fullscreenElement) {
    resultFullscreen.value = false;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function isChanged(clause) {
  return changeStatuses.has(normalizeChangeStatus(clause));
}

function normalizeChangeStatus(clause) {
  const status = String(clause.status || '').trim();
  if (changeStatuses.has(status)) {
    return detailedChangeTypesEnabled.value ? status : '変更';
  }
  if (status !== '有') return '';
  if (!detailedChangeTypesEnabled.value) return '変更';

  if (!clause.oldContent && clause.newContent) return '追加';
  if (clause.oldContent && !clause.newContent) return '削除';
  return '変更';
}

function rowClass(clause, idx) {
  const status = normalizeChangeStatus(clause);
  if (status === '追加') return 'row-added';
  if (status === '削除') return 'row-deleted';
  if (status === '変更') return 'row-changed';
  return idx % 2 === 0 ? 'row-even' : 'row-odd';
}

function statusClass(clause) {
  const status = normalizeChangeStatus(clause);
  if (status === '追加') return 'status-added';
  if (status === '削除') return 'status-deleted';
  if (status === '変更') return 'status-changed';
  return '';
}

function contentSegments(clause, side) {
  const text = side === 'old' ? clause.oldContent : clause.newContent;
  if (!text) return [];
  if (!detailedChangeTypesEnabled.value || normalizeChangeStatus(clause) !== '変更' || !clause.oldContent || !clause.newContent) {
    return [{ text, type: 'same' }];
  }
  return getDiffSegments(clause, 'content', clause.oldContent, clause.newContent)[side];
}

function translationSegments(clause, side) {
  const text = side === 'old' ? clause.oldTranslation : clause.newTranslation;
  if (!text) return [];
  if (!detailedChangeTypesEnabled.value || normalizeChangeStatus(clause) !== '変更' || !clause.oldTranslation || !clause.newTranslation) {
    return [{ text, type: 'same' }];
  }
  return getDiffSegments(clause, 'translation', clause.oldTranslation, clause.newTranslation)[side];
}

function getDiffSegments(clause, field, oldValue, newValue) {
  const oldText = String(oldValue || '');
  const newText = String(newValue || '');
  const key = `${field}:${clause.id || clause.clauseNumber}:${oldText}\u0000${newText}`;
  if (!diffSegmentCache.has(key)) {
    diffSegmentCache.set(key, buildTokenDiffSegments(oldText, newText));
  }
  return diffSegmentCache.get(key);
}

function buildTokenDiffSegments(oldText, newText) {
  const oldTokens = tokenizeForDiff(oldText);
  const newTokens = tokenizeForDiff(newText);
  let prefix = 0;
  while (prefix < oldTokens.length && prefix < newTokens.length && tokensEqualForDiff(oldTokens[prefix], newTokens[prefix])) {
    prefix += 1;
  }

  let oldEnd = oldTokens.length - 1;
  let newEnd = newTokens.length - 1;
  while (oldEnd >= prefix && newEnd >= prefix && tokensEqualForDiff(oldTokens[oldEnd], newTokens[newEnd])) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  const oldMid = oldTokens.slice(prefix, oldEnd + 1);
  const newMid = newTokens.slice(prefix, newEnd + 1);
  const oldSegments = [];
  const newSegments = [];
  appendSegment(oldSegments, oldTokens.slice(0, prefix).join(''), 'same');
  appendSegment(newSegments, newTokens.slice(0, prefix).join(''), 'same');

  if (oldMid.length * newMid.length > MAX_TOKEN_DIFF_CELLS) {
    appendSegment(oldSegments, oldMid.join(''), 'removed');
    appendSegment(newSegments, newMid.join(''), 'added');
  } else {
    appendMiddleDiff(oldSegments, newSegments, oldMid, newMid);
  }

  appendSegment(oldSegments, oldTokens.slice(oldEnd + 1).join(''), 'same');
  appendSegment(newSegments, newTokens.slice(newEnd + 1).join(''), 'same');
  return { old: oldSegments, new: newSegments };
}

function tokenizeForDiff(text) {
  const tokens = [];
  const re = /[A-Za-z0-9]+(?:[._/][A-Za-z0-9]+|\s*-\s*[A-Za-z0-9]+)*|\s+|./gu;
  for (const match of String(text || '').matchAll(re)) {
    tokens.push(match[0]);
  }
  return tokens;
}

function isWhitespaceToken(token) {
  return /^\s+$/u.test(token);
}

function tokensEqualForDiff(a, b) {
  if (a === b) return true;
  if (isWhitespaceToken(a) && isWhitespaceToken(b)) return true;
  return normalizeTokenForDiff(a) === normalizeTokenForDiff(b);
}

function normalizeTokenForDiff(token) {
  return String(token || '')
    .replace(/([A-Za-z0-9])\s*-\s*([A-Za-z0-9])/g, '$1-$2')
    .toLocaleLowerCase();
}

function appendMiddleDiff(oldSegments, newSegments, oldTokens, newTokens) {
  const dp = Array.from({ length: oldTokens.length + 1 }, () => new Uint32Array(newTokens.length + 1));
  for (let i = oldTokens.length - 1; i >= 0; i -= 1) {
    for (let j = newTokens.length - 1; j >= 0; j -= 1) {
      dp[i][j] = tokensEqualForDiff(oldTokens[i], newTokens[j])
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < oldTokens.length && j < newTokens.length) {
    if (tokensEqualForDiff(oldTokens[i], newTokens[j])) {
      appendSegment(oldSegments, oldTokens[i], 'same');
      appendSegment(newSegments, newTokens[j], 'same');
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      appendSegment(oldSegments, oldTokens[i], isWhitespaceToken(oldTokens[i]) ? 'same' : 'removed');
      i += 1;
    } else {
      appendSegment(newSegments, newTokens[j], isWhitespaceToken(newTokens[j]) ? 'same' : 'added');
      j += 1;
    }
  }
  while (i < oldTokens.length) {
    appendSegment(oldSegments, oldTokens[i], isWhitespaceToken(oldTokens[i]) ? 'same' : 'removed');
    i += 1;
  }
  while (j < newTokens.length) {
    appendSegment(newSegments, newTokens[j], isWhitespaceToken(newTokens[j]) ? 'same' : 'added');
    j += 1;
  }
}

function appendSegment(segments, text, type) {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last && last.type === type) {
    last.text += text;
  } else {
    segments.push({ text, type });
  }
}


const canUpload = computed(() =>
  !oldUploading.value &&
  !newUploading.value &&
  !running.value &&
  !stoppingRun.value
);

const canRun = computed(() => !!oldFile.value && !!newFile.value && !running.value && !stoppingRun.value);

const filteredClauses = computed(() => {
  if (!result.value) return [];
  if (activeStatusFilter.value === 'all') return result.value.clauses;
  return result.value.clauses.filter(c => normalizeChangeStatus(c) === activeStatusFilter.value);
});

const activeStatusFilterLabel = computed(() => {
  return STATUS_FILTERS.find((item) => item.key === activeStatusFilter.value)?.label || 'すべて';
});

function handleStatusFilterCommand(command) {
  activeStatusFilter.value = command;
}

const displayedClauses = computed(() => {
  return filteredClauses.value.slice(0, visibleClauseCount.value);
});

const displayedClauseTotal = computed(() => filteredClauses.value.length);
const addedClauseCount = computed(() => {
  return result.value?.clauses?.filter((clause) => normalizeChangeStatus(clause) === '追加').length || 0;
});
const deletedClauseCount = computed(() => {
  return result.value?.clauses?.filter((clause) => normalizeChangeStatus(clause) === '削除').length || 0;
});

function loadMoreClauses() {
  if (visibleClauseCount.value >= displayedClauseTotal.value) return;
  visibleClauseCount.value = Math.min(
    visibleClauseCount.value + CLAUSE_RENDER_BATCH_SIZE,
    displayedClauseTotal.value,
  );
  ensureScrollableContent();
}

function loadAllClausesInBatches() {
  if (visibleClauseCount.value >= displayedClauseTotal.value) return;
  visibleClauseCount.value = Math.min(
    visibleClauseCount.value + CLAUSE_RENDER_BATCH_SIZE,
    displayedClauseTotal.value,
  );
  nextTick(() => {
    const el = contentAreaRef.value;
    if (el) el.scrollTop = el.scrollHeight;
    if (visibleClauseCount.value < displayedClauseTotal.value) {
      requestAnimationFrame(loadAllClausesInBatches);
    }
  });
}

function onResultsScroll(e) {
  const el = e.currentTarget;
  const remainingScroll = el.scrollHeight - el.scrollTop - el.clientHeight;
  if (remainingScroll <= CLAUSE_SCROLL_BOTTOM_EPSILON) {
    loadAllClausesInBatches();
    return;
  }
  if (remainingScroll <= CLAUSE_SCROLL_THRESHOLD) {
    loadMoreClauses();
  }
}

function resetVisibleClauses() {
  visibleClauseCount.value = CLAUSE_RENDER_BATCH_SIZE;
  nextTick(() => {
    if (contentAreaRef.value) contentAreaRef.value.scrollTop = 0;
    ensureScrollableContent();
  });
}

function ensureScrollableContent() {
  nextTick(() => {
    const el = contentAreaRef.value;
    if (!el || visibleClauseCount.value >= displayedClauseTotal.value) return;
    if (el.scrollHeight <= el.clientHeight + CLAUSE_SCROLL_THRESHOLD) {
      loadMoreClauses();
    }
  });
}

watch(activeStatusFilter, () => {
  resetVisibleClauses();
});

watch(displayedClauseTotal, () => {
  if (visibleClauseCount.value > displayedClauseTotal.value) {
    visibleClauseCount.value = Math.max(CLAUSE_RENDER_BATCH_SIZE, displayedClauseTotal.value);
  }
});

function saveClauseCompareRecovery(isRunning = running.value, accepted = null) {
  if (!sharedSessionId.value) {
    clearClauseCompareRecovery();
    return;
  }
  const payload = {
    feature: 'clause_compare',
    sessionId: sharedSessionId.value,
    runId: accepted?.runId || activeRunId || '',
    jobId: accepted?.jobId || '',
    oldFile: oldFile.value,
    newFile: newFile.value,
    running: Boolean(isRunning),
    completed: Boolean(result.value?.clauses),
    updatedAt: Date.now(),
  };
  try {
    localStorage.setItem(CLAUSE_COMPARE_RECOVERY_KEY, JSON.stringify(payload));
  } catch {}
}

function clearClauseCompareRecovery() {
  try {
    localStorage.removeItem(CLAUSE_COMPARE_RECOVERY_KEY);
  } catch {}
}

function loadClauseCompareRecovery() {
  try {
    return JSON.parse(localStorage.getItem(CLAUSE_COMPARE_RECOVERY_KEY) || 'null');
  } catch {
    return null;
  }
}

async function restoreClauseCompareRecovery() {
  if (running.value || result.value) return;
  const saved = loadClauseCompareRecovery();
  if (!saved?.sessionId || saved.feature !== 'clause_compare') return;
  sharedSessionId.value = saved.sessionId;
  oldFile.value = saved.oldFile || null;
  newFile.value = saved.newFile || null;
  activeRunId = saved.runId || null;
  error.value = '';

  const requestSeq = ++runRequestSeq;
  try {
    if (saved.running) {
      status.value = '条項を比較中...';
      running.value = true;
      startRunProgress(sharedSessionId.value);
      const data = await waitForClauseCompareResult({ requestSeq, pollMs: 3000, stopOnNotFound: true });
      if (!data || requestSeq !== runRequestSeq) return;
      completeRunProgress();
      result.value = data;
      resetVisibleClauses();
      status.value = `比較完了：合計 ${data.totalClauses} 条項、${data.changedClauses} 件変更`;
      saveClauseCompareRecovery(false, { runId: saved.runId, jobId: saved.jobId });
      return;
    }

    const res = await fetch(`/api/clause-compare/result?sessionId=${encodeURIComponent(sharedSessionId.value)}`, { cache: 'no-store' });
    if (requestSeq !== runRequestSeq) return;
    if (res.ok) {
      const data = await res.json();
      if (data?.clauses) {
        result.value = data;
        resetVisibleClauses();
        status.value = `比較完了：合計 ${data.totalClauses} 条項、${data.changedClauses} 件変更`;
        saveClauseCompareRecovery(false, { runId: saved.runId, jobId: saved.jobId });
      }
    } else if (res.status === 404) {
      resetClauseCompareSessionState();
    }
  } catch (e) {
    if (requestSeq !== runRequestSeq) return;
    stopRunProgress({ reset: true });
    const message = formatCaughtError(e, '比較結果の復元に失敗しました');
    if (isSessionNotFoundError(message)) {
      resetClauseCompareSessionState({ errorMessage: message });
    } else {
      error.value = message;
      clearClauseCompareRecovery();
    }
    status.value = '';
  } finally {
    if (requestSeq === runRequestSeq) {
      stopRunProgress();
      running.value = false;
      activeRunId = null;
    }
  }
}

function isSessionNotFoundError(message) {
  return /^Error code:\s*404\b/i.test(String(message || ''));
}

function resetClauseCompareSessionState({ errorMessage = '' } = {}) {
  runRequestSeq += 1;
  runAbortController?.abort();
  runAbortController = null;
  stopRunProgress({ reset: true });
  oldFile.value = null;
  newFile.value = null;
  sharedSessionId.value = null;
  result.value = null;
  resultFullscreen.value = false;
  running.value = false;
  stoppingRun.value = false;
  activeRunId = null;
  status.value = '';
  error.value = errorMessage;
  clearClauseCompareRecovery();
}

onMounted(() => {
  restoreClauseCompareRecovery();
  document.addEventListener('fullscreenchange', handleDocumentFullscreenChange);
});

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', handleDocumentFullscreenChange);
  if (document.fullscreenElement === rightPanelRef.value && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
});
</script>

<template>
  <div class="clause-page">

    <!-- ── Left Panel ─────────────────────────────────────────────────── -->
    <aside class="left-panel">
      <div class="panel-header">
        <span class="panel-header-title">ファイル入力と操作</span>
      </div>

      <div class="panel-body">
        <div class="panel-config">

        <!-- Old file upload -->
        <div class="section">
          <label class="section-label">旧バージョン ファイル</label>
          <label
            class="upload-zone"
            :class="{ uploaded: !!oldFile, disabled: !canUpload }"
            @dragover.prevent
            @drop="onDropFile($event, 'old')"
            @click="!canUpload && $event.preventDefault()"
          >
            <input type="file" accept=".pdf" :disabled="!canUpload" style="display:none" @change="onFileChange($event, 'old')" />
            <template v-if="oldUploading">
              <svg class="spin icon-md" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
              <span class="upload-zone-text">アップロード中...</span>
            </template>
            <template v-else-if="oldFile">
              <svg class="icon-md" style="color:#22c55e" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20,6 9,17 4,12"/>
              </svg>
              <div class="upload-zone-info">
                <span class="upload-zone-filename">{{ oldFile.fileName }}</span>
                <span class="upload-zone-sub" style="color:#16a34a">旧バージョン文書（アップロード済み）</span>
              </div>
            </template>
            <template v-else>
              <svg class="icon-md" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="16,16 12,12 8,16"/>
                <line x1="12" y1="12" x2="12" y2="21"/>
                <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
              </svg>
              <div class="upload-zone-info">
                <span class="upload-zone-text">旧バージョン文書</span>
                <span class="upload-zone-sub">PDF対応・1ファイル上限50MB</span>
              </div>
            </template>
          </label>
        </div>

        <!-- New file upload -->
        <div class="section">
          <label class="section-label">新バージョン ファイル</label>
          <label
            class="upload-zone"
            :class="{ uploaded: !!newFile, disabled: !canUpload }"
            @dragover.prevent
            @drop="onDropFile($event, 'new')"
            @click="!canUpload && $event.preventDefault()"
          >
            <input type="file" accept=".pdf" :disabled="!canUpload" style="display:none" @change="onFileChange($event, 'new')" />
            <template v-if="newUploading">
              <svg class="spin icon-md" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
              <span class="upload-zone-text">アップロード中...</span>
            </template>
            <template v-else-if="newFile">
              <svg class="icon-md" style="color:#22c55e" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20,6 9,17 4,12"/>
              </svg>
              <div class="upload-zone-info">
                <span class="upload-zone-filename">{{ newFile.fileName }}</span>
                <span class="upload-zone-sub" style="color:#16a34a">新バージョン文書（アップロード済み）</span>
              </div>
            </template>
            <template v-else>
              <svg class="icon-md" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="16,16 12,12 8,16"/>
                <line x1="12" y1="12" x2="12" y2="21"/>
                <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
              </svg>
              <div class="upload-zone-info">
                <span class="upload-zone-text">新バージョン文書</span>
                <span class="upload-zone-sub">PDF対応・1ファイル上限50MB</span>
              </div>
            </template>
          </label>
        </div>

        <!-- Run button -->
        <button class="btn btn-primary btn-full" :disabled="!canRun" @click="handleRun">
          <template v-if="running">
            処理中
          </template>
          <template v-else>
            <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14,2 14,8 20,8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            比較を実行
          </template>
        </button>

        <button
          v-if="running"
          class="btn btn-danger btn-full"
          :disabled="stoppingRun"
          @click="handleStopRun"
        >
          <svg class="icon-sm" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2"/>
          </svg>
          {{ stoppingRun ? '停止中' : '停止' }}
        </button>

        <!-- Status -->
        <div v-if="status && !error" class="status-msg">{{ running && !stoppingRun ? runProgressLabel : status }}</div>

        <!-- Error -->
        <div v-if="error" class="error-msg">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>{{ error }}</span>
        </div>

        <!-- Legend -->
        <div v-if="result" class="legend">
          <p class="legend-title">凡例</p>
          <div v-if="detailedChangeTypesEnabled" class="legend-item">
            <span class="henko-mark status-added legend-mark">追加</span>
            <span class="legend-desc">新バージョンにのみ存在する条項</span>
          </div>
          <div v-if="detailedChangeTypesEnabled" class="legend-item">
            <span class="henko-mark status-deleted legend-mark">削除</span>
            <span class="legend-desc">旧バージョンにのみ存在する条項</span>
          </div>
          <div class="legend-item">
            <span class="henko-mark status-changed legend-mark">変更</span>
            <span class="legend-desc">条項内容に差異がある</span>
          </div>
          <div class="legend-item">
            <span class="henko-mark henko-none legend-mark">無</span>
            <span class="legend-desc">変更がない条項</span>
          </div>
        </div>

        </div>
      </div>
    </aside>

    <!-- ── Right Panel ─────────────────────────────────────────────────── -->
    <div ref="rightPanelRef" class="right-panel" :class="{ 'right-panel--fullscreen': resultFullscreen }">

      <!-- Toolbar -->
      <div class="toolbar">
        <div class="toolbar-left">
          <span class="toolbar-title">比較結果</span>
          <template v-if="result">
            <span class="badge badge-secondary">合計 {{ result.totalClauses }} 件</span>
            <span class="badge badge-changed">変更 {{ result.changedClauses }} 件</span>
            <span class="badge badge-added">追加 {{ addedClauseCount }} 件</span>
            <span class="badge badge-deleted">削除 {{ deletedClauseCount }} 件</span>
            <span v-if="activeStatusFilter !== 'all'" class="badge badge-secondary">表示 {{ displayedClauseTotal }} 件</span>
          </template>
        </div>
        <div class="toolbar-right">
          <el-dropdown
            trigger="click"
            :disabled="!result"
            :teleported="!resultFullscreen"
            @command="handleStatusFilterCommand"
          >
            <button
              class="btn btn-sm"
              :class="activeStatusFilter !== 'all' ? 'btn-filter-active' : 'btn-outline'"
              :disabled="!result"
            >
              <svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="22,3 2,3 10,12.46 10,19 14,21 14,12.46 22,3"/>
              </svg>
              {{ activeStatusFilterLabel }}
              <svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6,9 12,15 18,9"/>
              </svg>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  v-for="item in STATUS_FILTERS"
                  :key="item.key"
                  :command="item.key"
                >
                  <span class="filter-menu-item" :class="{ active: activeStatusFilter === item.key }">
                    {{ item.label }}
                  </span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <button
            class="btn btn-outline btn-sm btn-icon"
            :disabled="!result"
            :title="resultFullscreen ? '全画面を終了' : '全画面表示'"
            @click="toggleResultFullscreen"
          >
            <svg v-if="!resultFullscreen" class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15,3 21,3 21,9"/>
              <polyline points="9,21 3,21 3,15"/>
              <line x1="21" y1="3" x2="14" y2="10"/>
              <line x1="3" y1="21" x2="10" y2="14"/>
            </svg>
            <svg v-else class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4,14 10,14 10,20"/>
              <polyline points="20,10 14,10 14,4"/>
              <line x1="10" y1="14" x2="3" y2="21"/>
              <line x1="14" y1="10" x2="21" y2="3"/>
            </svg>
          </button>
          <el-dropdown
            trigger="click"
            :disabled="!result"
            :teleported="!resultFullscreen"
            @command="handleDownloadCommand"
          >
            <button class="btn btn-primary btn-sm" :disabled="!result">
              <svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7,10 12,15 17,10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              ダウンロード
              <svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6,9 12,15 18,9"/>
              </svg>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="excel">
                  <span class="download-menu-item">Excelエクスポート</span>
                </el-dropdown-item>
                <el-dropdown-item command="csv">
                  <span class="download-menu-item">CSVエクスポート</span>
                </el-dropdown-item>
                <el-dropdown-item command="images">
                  <span class="download-menu-item">画像一括ダウンロード</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>

      <!-- Content area -->
      <div
        ref="contentAreaRef"
        class="content-area"
        @scroll="onResultsScroll"
      >

        <!-- Empty state -->
        <div v-if="!result && !running" class="empty-state">
          <div class="empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="#0076bf" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14,2 14,8 20,8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
          </div>
          <p class="empty-title">比較結果はここに表示されます</p>
          <p class="empty-desc">旧バージョンと新バージョンのPDFファイルをアップロードして「比較を実行」をクリックしてください。</p>
        </div>

        <!-- Loading state -->
        <div v-if="running" class="loading-state">
          <div
            class="run-progress"
            role="progressbar"
            aria-label="条項比較の進捗"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="runProgress"
          >
            <div class="run-progress-header">
              <span class="loading-text">{{ runProgressLabel }}</span>
              <strong class="run-progress-value">{{ runProgress }}%</strong>
            </div>
            <div class="run-progress-track">
              <div class="run-progress-fill" :style="{ width: `${runProgress}%` }"></div>
            </div>
            <p v-if="runProgressSummary" class="run-progress-summary">{{ runProgressSummary }}</p>
          </div>
        </div>

        <!-- Results table -->
        <div v-if="result" class="table-wrapper">
          <table class="comparison-table" :class="{ 'comparison-table--no-reference': !showImageColumns }">
            <colgroup>
              <col class="col-clause">
              <col class="col-content">
              <col class="col-translation">
              <col v-if="showImageColumns" class="col-attach">
              <col class="col-clause">
              <col class="col-content">
              <col class="col-translation">
              <col v-if="showImageColumns" class="col-attach">
              <col class="col-henko">
            </colgroup>
            <thead>
              <tr class="thead-group">
                <th class="col-group-header col-group-old" :colspan="revSectionColspan">【旧】REV</th>
                <th class="col-group-header col-group-new" :colspan="revSectionColspan">【新】REV</th>
                <th class="col-henko" rowspan="2">比較区分</th>
              </tr>
              <tr class="thead-sub">
                <th class="col-clause">項</th>
                <th class="col-content">記載内容</th>
                <th class="col-translation">日本語訳<span class="col-sub-label">（参考）</span></th>
                <th v-if="showImageColumns" class="col-attach">画像</th>
                <th class="col-clause">項</th>
                <th class="col-content">記載内容</th>
                <th class="col-translation">日本語訳<span class="col-sub-label">（参考）</span></th>
                <th v-if="showImageColumns" class="col-attach">画像</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(clause, idx) in displayedClauses"
                :key="clause.id"
                :class="rowClass(clause, idx)"
              >
                <td class="cell-num">
                  <span v-if="clause.oldClauseNumber" class="clause-number">{{ clause.oldClauseNumber }}</span>
                  <span v-else class="cell-empty">—</span>
                </td>

                <!-- Old content — plain text, row highlight only -->
                <td class="cell-content">
                  <span v-if="clause.oldContent">
                    <span
                      v-for="(segment, i) in contentSegments(clause, 'old')"
                      :key="`old-${i}`"
                      :class="segment.type !== 'same' ? `diff-${segment.type}` : ''"
                      class="diff-segment"
                    >{{ segment.text }}</span>
                  </span>
                  <span v-else class="cell-empty">—</span>
                </td>

                <td class="cell-translation">
                  <span v-if="clause.oldTranslation">
                    <span
                      v-for="(segment, i) in translationSegments(clause, 'old')"
                      :key="`old-translation-${i}`"
                      :class="segment.type !== 'same' ? `diff-${segment.type}` : ''"
                      class="diff-segment"
                    >{{ segment.text }}</span>
                  </span>
                  <span v-else class="cell-empty">—</span>
                </td>

                <!-- Old images -->
                <td v-if="showImageColumns" class="cell-attach">
                  <div v-if="clause.oldImages && clause.oldImages.length" class="thumbnails">
                    <button
                      class="thumbnail"
                      :title="clause.oldImages[0].label"
                      @click="openLightbox(clause.oldImages, 0)"
                    >
                      <img :src="clause.oldImages[0].url" :alt="clause.oldImages[0].label" @error="$event.target.style.display='none'" />
                      <span v-if="clause.oldImages.length > 1" class="thumbnail-count">+{{ clause.oldImages.length - 1 }}</span>
                      <div class="thumbnail-overlay">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                          <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
                        </svg>
                      </div>
                    </button>
                  </div>
                  <span v-else class="cell-empty">—</span>
                </td>

                <td class="cell-num">
                  <span v-if="clause.newClauseNumber" class="clause-number">{{ clause.newClauseNumber }}</span>
                  <span v-else class="cell-empty">—</span>
                </td>

                <!-- New content — plain text, row highlight only -->
                <td class="cell-content">
                  <span v-if="clause.newContent">
                    <span
                      v-for="(segment, i) in contentSegments(clause, 'new')"
                      :key="`new-${i}`"
                      :class="segment.type !== 'same' ? `diff-${segment.type}` : ''"
                      class="diff-segment"
                    >{{ segment.text }}</span>
                  </span>
                  <span v-else class="cell-empty">—</span>
                </td>

                <td class="cell-translation">
                  <span v-if="clause.newTranslation">
                    <span
                      v-for="(segment, i) in translationSegments(clause, 'new')"
                      :key="`new-translation-${i}`"
                      :class="segment.type !== 'same' ? `diff-${segment.type}` : ''"
                      class="diff-segment"
                    >{{ segment.text }}</span>
                  </span>
                  <span v-else class="cell-empty">—</span>
                </td>

                <!-- New images -->
                <td v-if="showImageColumns" class="cell-attach">
                  <div v-if="clause.newImages && clause.newImages.length" class="thumbnails">
                    <button
                      class="thumbnail"
                      :title="clause.newImages[0].label"
                      @click="openLightbox(clause.newImages, 0)"
                    >
                      <img :src="clause.newImages[0].url" :alt="clause.newImages[0].label" @error="$event.target.style.display='none'" />
                      <span v-if="clause.newImages.length > 1" class="thumbnail-count">+{{ clause.newImages.length - 1 }}</span>
                      <div class="thumbnail-overlay">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                          <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
                        </svg>
                      </div>
                    </button>
                  </div>
                  <span v-else class="cell-empty">—</span>
                </td>

                <!-- 変更状態 -->
                <td class="cell-henko">
                  <span
                    v-if="isChanged(clause)"
                    class="henko-mark"
                    :class="statusClass(clause)"
                  >
                    {{ normalizeChangeStatus(clause) }}
                  </span>
                  <span v-else class="henko-none">{{ UNCHANGED_STATUS_LABEL }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>
    </div>

    <!-- ── Lightbox ────────────────────────────────────────────────────── -->
    <Teleport :to="lightboxTeleportTarget">
      <div v-if="lightbox" class="lightbox-overlay" @click.self="lightbox = null">
        <div class="lightbox-dialog">

          <div class="lightbox-header">
            <span class="lightbox-title">{{ lightbox.images[lightbox.idx].label }}</span>
            <div class="lightbox-header-right">
              <span v-if="lightbox.images.length > 1" class="lightbox-count">
                {{ lightbox.idx + 1 }} / {{ lightbox.images.length }}
              </span>
              <button class="lightbox-close" @click="lightbox = null">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>

          <div class="lightbox-body">
            <!-- Prev arrow -->
            <button
              v-if="lightbox.images.length > 1"
              class="lightbox-nav lightbox-nav--prev"
              @click.stop="lightboxPrev"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15,18 9,12 15,6"/>
              </svg>
            </button>

            <img
              :src="lightbox.images[lightbox.idx].url"
              :alt="lightbox.images[lightbox.idx].label"
              class="lightbox-img"
            />

            <!-- Next arrow -->
            <button
              v-if="lightbox.images.length > 1"
              class="lightbox-nav lightbox-nav--next"
              @click.stop="lightboxNext"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9,18 15,12 9,6"/>
              </svg>
            </button>
          </div>

        </div>
      </div>
    </Teleport>

  </div>
</template>

<style scoped lang="scss">
/* ── Page layout ─────────────────────────────────────────────────────────── */
.clause-page {
  display: flex;
  height: 100%;
  overflow: hidden;
  font-size: var(--font-size-base);
  font-family: "Noto Sans JP", sans-serif;
}

/* ── Left panel ──────────────────────────────────────────────────────────── */
.left-panel {
  width: 288px;
  min-width: 288px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #e2e8f0;
  background: #fff;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  height: 52px;
  padding: 0 16px;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
  flex-shrink: 0;
  box-sizing: border-box;
}

.panel-header-title {
  font-size: var(--font-size-title);
  font-weight: 700;
  color: #1e293b;
}

.panel-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.panel-config {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.section-label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: #1e293b;
  margin-bottom: 6px;
}

/* ── Upload zone ─────────────────────────────────────────────────────────── */
.upload-zone {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 2px dashed #cbd5e1;
  border-radius: 10px;
  padding: 14px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;

  &:hover { border-color: rgba(0,118,191,0.5); }
  &.disabled {
    cursor: not-allowed;
    opacity: 0.65;
    background: #f8fafc;
  }
  &.disabled:hover {
    border-color: #cbd5e1;
  }

  &.uploaded {
    border-style: solid;
    border-color: rgba(34,197,94,0.5);
    background: rgba(34,197,94,0.03);
  }
}

.upload-zone-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.upload-zone-filename {
  font-size: 12px;
  font-weight: 600;
  color: #1e293b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}

.upload-zone-text {
  font-size: 12px;
  font-weight: 600;
  color: #475569;
}

.upload-zone-sub {
  font-size: 10px;
  color: #94a3b8;
  margin-top: 1px;
}

/* ── Status / Error ──────────────────────────────────────────────────────── */
.status-msg {
  font-size: 11px;
  color: #64748b;
  background: #f8fafc;
  border-radius: 6px;
  padding: 8px 12px;
  line-height: 1.6;
}

.error-msg {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 11px;
  color: #ef4444;
  background: rgba(239,68,68,0.06);
  border-radius: 6px;
  padding: 8px 12px;

  svg { width: 14px; height: 14px; flex-shrink: 0; margin-top: 1px; }
}

/* ── Legend ──────────────────────────────────────────────────────────────── */
.legend {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.legend-title {
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  margin: 0;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}

.legend-desc { color: #64748b; }
.legend-mark  { display: inline-block; width: 24px; text-align: center; }

/* ── Right panel ─────────────────────────────────────────────────────────── */
.right-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.right-panel--fullscreen,
.right-panel:fullscreen {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100dvh;
  max-width: none;
  max-height: none;
  margin: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  z-index: 2147483647;
  background: #fff;
}

.right-panel:fullscreen {
  display: flex;
  flex-direction: column;
}

/* ── Toolbar ─────────────────────────────────────────────────────────────── */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 16px;
  border-bottom: 1px solid #e2e8f0;
  background: #fff;
  flex-shrink: 0;
  gap: 8px;
  box-sizing: border-box;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.toolbar-title {
  font-size: var(--font-size-title);
  font-weight: 700;
  color: #1e293b;
}

/* ── Content area ────────────────────────────────────────────────────────── */
.content-area {
  flex: 1;
  overflow: auto;
  position: relative;
}

.empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 32px;
}

.empty-icon {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(0,118,191,0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;

  svg { width: 32px; height: 32px; }
}

.empty-title {
  font-size: 14px;
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 6px;
}

.empty-desc {
  font-size: 12px;
  color: #64748b;
  max-width: 320px;
  margin: 0;
}

.loading-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.loading-text {
  font-size: 13px;
  color: #64748b;
  margin: 0;
}

.run-progress {
  width: min(420px, calc(100% - 48px));
}

.run-progress-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 10px;
}

.run-progress-value {
  color: #1e293b;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.run-progress-track {
  height: 8px;
  overflow: hidden;
  background: #dbe4ea;
  border-radius: 4px;
}

.run-progress-fill {
  height: 100%;
  background: #0076bf;
  border-radius: 4px;
  transition: width 0.45s ease;
}

.run-progress-summary {
  margin: 8px 0 0;
  color: #64748b;
  font-size: 11px;
  text-align: right;
}

/* ── Table ───────────────────────────────────────────────────────────────── */
.table-wrapper {
  min-height: 100%;
  width: 100%;
  overflow-x: hidden;
}

.comparison-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 12px;

  /* ── Two-row grouped header ── */
  .thead-group th {
    background: #1e3a5f;
    color: #fff;
    /* Removed: position: sticky; */
    /* Removed: top: 0; */
    z-index: 6;
    text-align: center;
    padding: 9px 10px;
    font-size: 11px;
    font-weight: 700;
    white-space: nowrap;
    border: none;
    border-right: 1px solid rgba(255,255,255,0.2); /* Added thin white right border */
    border-bottom: 1px solid rgba(255,255,255,0.2); /* Added thin white bottom border */
  }

  .thead-group th[rowspan="2"] {
    vertical-align: middle;
    /* Removed: border-right: none; */
  }

  .thead-sub th {
    background: #2d5282;
    color: rgba(255,255,255,0.9);
    /* Removed: position: sticky; */
    /* Removed: top: 37px; */
    z-index: 5;
    text-align: center;
    padding: 9px 10px; /* Changed from 7px 10px to 9px 10px for alignment */
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
    border: none;
    border-right: 1px solid rgba(255,255,255,0.2); /* Added thin white right border */
    /* only bottom line to separate header from tbody */
    box-shadow: 0 2px 0 0 #e2e8f0; /* Removed: inset -1px 0 0 rgba(255,255,255,0.12), */
  }

  .col-group-old {
    /* Removed: box-shadow: inset -1px 0 0 rgba(255,255,255,0.12), inset 2px 0 0 rgba(255,255,255,0.25) !important; */
  }
  .col-group-new {
    /* Removed: box-shadow: inset -1px 0 0 rgba(255,255,255,0.12), inset 2px 0 0 rgba(255,255,255,0.25) !important; */
  }

  th {
    text-align: left;
    padding: 9px 8px;
    font-size: 11px;
    font-weight: 700;
    color: #64748b;
    border-bottom: 1px solid #e2e8f0;
    white-space: nowrap;
  }

  td {
    padding: 9px 8px;
    vertical-align: top;
    border-bottom: 1px solid #e2e8f0;
  }

  .col-clause  { width: 4%; }
  .col-content { width: 18.5%; }
  .col-translation { width: 18.5%; }
  .col-attach  { width: 5%; }
  .col-henko   { width: 8%; }
}

.col-sub-label {
  font-size: 10px;
  font-weight: 500;
  opacity: 0.85;
}

.comparison-table--no-reference {
  .col-clause { width: 4%; }
  .col-content { width: 27%; }
  .col-translation { width: 17%; }
  .col-henko { width: 4%; }
}

/* Report style: only added/deleted rows carry row-level status color. */
.row-added   { background: #eef8e7; }
.row-deleted { background: #e5e7eb; }
.row-changed { background: #fff; }
.row-even    { background: #fff; }
.row-odd     { background: #fff; }

tr:hover td { filter: brightness(0.97); }

/* Cells */
.cell-num {
  white-space: nowrap;
  padding: 8px 2px;
  text-align: center;
}

.clause-number {
  font-family: "Noto Sans JP", sans-serif;
  font-weight: 700;
  color: #1e293b;
}

.cell-content {
  line-height: 1.6;
  overflow-wrap: anywhere;
  word-break: normal;
  font-size: 11px;
  color: #374151;
}

.cell-translation {
  line-height: 1.6;
  overflow-wrap: anywhere;
  word-break: normal;
  font-size: 11px;
  color: #475569;
}

.diff-added,
.diff-removed {
  border-radius: 2px;
  padding: 0;
  background: transparent;
}

.diff-added {
  color: #0076bf;
}

.diff-removed {
  color: #dc2626;
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}

.cell-empty {
  color: rgba(100,116,139,0.4);
  font-size: 11px;
  font-style: italic;
}

.cell-attach {
  vertical-align: top;
  padding: 8px 4px !important;
}

.cell-no {
  text-align: center;
  color: #94a3b8;
  font-size: 11px;
  vertical-align: middle;
  font-variant-numeric: tabular-nums;
}

.cell-henko {
  text-align: center;
  vertical-align: middle;
}

.henko-mark {
  font-size: 13px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  padding: 2px 6px;
  border-radius: 4px;
}

.henko-none {
  font-size: 13px;
  color: #cbd5e1;
}

.status-added {
  background: rgba(22,163,74,0.12);
  color: #15803d;
}

.status-deleted {
  background: rgba(220,38,38,0.12);
  color: #b91c1c;
}

.status-changed {
  background: rgba(234,88,12,0.1);
  color: #9a3412;
}

/* ── Status badges ───────────────────────────────────────────────────────── */
.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}

.status-unchanged {
  background: #f1f5f9;
  color: #64748b;
}

/* ── Badges (toolbar) ────────────────────────────────────────────────────── */
.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
}

.badge-secondary { background: #f1f5f9; color: #475569; }

.badge-changed {
  background: rgba(234,88,12,0.12);
  color: #9a3412;
}

.badge-added {
  background: #e6f6d8;
  color: #3f7b1f;
}

.badge-deleted {
  background: #e5e7eb;
  color: #475569;
}

/* ── Image thumbnails — horizontal row ───────────────────────────────────── */
.thumbnails {
  display: flex;
  justify-content: center;
}

.thumbnail {
  position: relative;
  width: 40px;
  height: 40px;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  overflow: hidden;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  transition: border-color 0.15s;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  &:hover {
    border-color: #0076bf;

    .thumbnail-overlay { opacity: 1; }
  }
}

.thumbnail-count {
  position: absolute;
  right: 2px;
  bottom: 2px;
  min-width: 16px;
  height: 14px;
  padding: 0 3px;
  border-radius: 999px;
  background: rgba(15,23,42,0.78);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
}

.thumbnail-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0,118,191,0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s;

  svg { width: 16px; height: 16px; color: #0076bf; }
}

/* ── Lightbox ────────────────────────────────────────────────────────────── */
.lightbox-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(2px);
}

.right-panel--fullscreen .lightbox-overlay,
.right-panel:fullscreen .lightbox-overlay {
  position: absolute;
}

.lightbox-dialog {
  background: #fff;
  border-radius: 12px;
  max-width: 720px;
  width: 90vw;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.lightbox-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid #e2e8f0;
  gap: 12px;
}

.lightbox-title {
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.lightbox-header-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.lightbox-count {
  font-size: 11px;
  color: #64748b;
  font-variant-numeric: tabular-nums;
}

.lightbox-close {
  background: none;
  border: none;
  cursor: pointer;
  color: #94a3b8;
  display: flex;
  align-items: center;
  padding: 0;

  svg { width: 16px; height: 16px; }
  &:hover { color: #1e293b; }
}

/* Lightbox body: image with side nav arrows */
.lightbox-body {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f1f5f9;
  padding: 32px 56px;
  min-height: 200px;
}

.lightbox-img {
  max-width: 100%;
  max-height: 60vh;
  object-fit: contain;
  border-radius: 6px;
  display: block;
}

/* Prev / Next arrows */
.lightbox-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(255,255,255,0.9);
  border: 1px solid #e2e8f0;
  border-radius: 50%;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #374151;
  transition: background 0.15s, border-color 0.15s;
  box-shadow: 0 1px 4px rgba(0,0,0,0.1);

  svg { width: 16px; height: 16px; }

  &:hover {
    background: #fff;
    border-color: #0076bf;
    color: #0076bf;
  }

  &--prev { left: 10px; }
  &--next { right: 10px; }
}

/* ── Shared button styles ────────────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
  white-space: nowrap;
  border: 1px solid transparent;

  &:disabled { opacity: 0.4; cursor: not-allowed; }
}

.btn-primary {
  background: #0076bf;
  color: #fff;
  padding: 8px 16px;

  &:not(:disabled):hover { background: #005a9e; }
}

.btn-outline {
  background: #fff;
  color: #374151;
  border-color: #d1d5db;
  padding: 4px 10px;

  &:not(:disabled):hover { border-color: #0076bf; color: #0076bf; }
}

.btn-danger {
  background: #dc2626;
  color: #fff;
  padding: 8px 16px;

  &:not(:disabled):hover { background: #b91c1c; }
}

.btn-filter-active {
  background: rgba(234,88,12,0.1);
  color: #9a3412;
  border-color: rgba(234,88,12,0.3);
  padding: 4px 10px;

  &:not(:disabled):hover { background: rgba(234,88,12,0.15); }
}

.btn-sm   { font-size: 13px; }
.btn-full { width: 100%; }
.btn-icon {
  width: 30px;
  height: 30px;
  padding: 0;
}

.download-menu-item {
  display: inline-flex;
  align-items: center;
  min-width: 132px;
}

.filter-menu-item {
  display: inline-flex;
  align-items: center;
  min-width: 72px;
  font-weight: 500;

  &.active {
    color: #0076bf;
    font-weight: 700;
  }
}

.icon-sm { width: 15px; height: 15px; flex-shrink: 0; }
.icon-md { width: 18px; height: 18px; flex-shrink: 0; }
.icon-xs { width: 12px; height: 12px; flex-shrink: 0; }

/* ── Spin animation ──────────────────────────────────────────────────────── */
@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

.spin { animation: spin 0.8s linear infinite; }
</style>
