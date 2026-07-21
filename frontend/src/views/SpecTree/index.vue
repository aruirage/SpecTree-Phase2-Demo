<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { ElMessage } from 'element-plus';
import { useJobProgress } from '@/composables/useJobProgress';
import { fetchJobsByType, cancelJob, rerunJob, loadSpecTreeResult } from '@/api/jobs';
import { closeResultTab, upsertResultTab } from '@/utils/resultTabs';

defineOptions({ name: 'SpecTree' });

const SPEC_TREE_PROGRESS_STAGES = {
  submitting: { value: 5, cap: 12, label: '処理を準備中...' },
  queued: { value: 10, cap: 16, label: '処理を準備中...' },
  running: { value: 14, cap: 20, label: '処理を準備中...' },
  extracting_sources: { value: 22, cap: 34, label: '処理中...' },
  building_spec_tree: { value: 38, cap: 92, requestDriven: true, label: '処理中...' },
  packaging: { value: 95, cap: 98, label: '結果を準備中...' },
  succeeded: { value: 98, cap: 99, label: '結果を準備中...' },
};

// ── State ──────────────────────────────────────────────────────────────────
const isDragging    = ref(false);
const uploading     = ref(false);
const uploadProgress = ref(0);
const sessionId     = ref(null);
const uploadedFiles = ref([]);   // [{ id, name, size, mimeType }]
const rootFileIds  = ref([]);
const excelSupplement = ref(null);
const excelDeletion = ref(null);
const excelSettingsOpen = ref(false);
const treeResultTabs = ref([]);
const treeResultsBySession = ref({});
const activeResultSessionId = ref('');
const treeData      = ref(null); // { mmdContent, nodeCount }
const status        = ref('');
const error         = ref('');
const generating    = ref(false);
const direction     = ref('LR');   // 'LR' 横向き | 'TD' 縦向き
const activeJobId = ref('');
const taskJobs = ref([]);
const activeSpecTreeTab = ref('generate');
const activeTaskStatusTab = ref('all');
const selectedCompletedJobIds = ref([]);
const SPEC_TREE_LABEL_WRAP_LIMIT = {
  LR: 34,
  TD: 26,
};
const SPEC_TREE_MIN_FIT_ZOOM = {
  LR: 0.01,
  TD: 0.01,
};
const SPEC_TREE_MIN_ZOOM = 0.01;
const SPEC_TREE_MAX_ZOOM = 5;

// Zoom / Pan
const zoom   = ref(1);
const panX   = ref(0);
const panY   = ref(0);
const isPanning = ref(false);
let panStart = null;

// DOM refs
const fileInputRef       = ref(null);
const folderInputRef     = ref(null);
const supplementInputRef = ref(null);
const deletionInputRef = ref(null);
const mermaidContainer   = ref(null);
const rightPanelRef = ref(null);
const MAX_IMAGE_EXPORT_SIDE = 12000;
const MAX_IMAGE_EXPORT_PIXELS = 80000000;
const MAX_UPLOAD_FILE_SIZE = 50 * 1024 * 1024;
const FILE_SIZE_LIMIT_MESSAGE = 'ファイルサイズが50MBを超えています。50MB以下のファイルをアップロードしてください。';
const UI_FONT_FAMILY = '"Noto Sans JP", sans-serif';
const SPEC_TREE_RECOVERY_KEY = 'daikin:spec_tree:recovery:v1';
let generateAbortController = null;
let generateRequestSeq = 0;
let activeGenerateRunId = null;
let restoringSpecTreeRecovery = false;
let taskRefreshTimer = null;
const SPEC_TREE_TASK_STATUS_TABS = [
  { key: 'all', label: 'すべて' },
  { key: 'queued', label: '待機中' },
  { key: 'running', label: '実行中' },
  { key: 'completed', label: '完了' },
  { key: 'stopped', label: '失敗 / 中止' },
];
const TASK_STATUS_META = {
  queued: { label: '待機中', className: 'queued' },
  running: { label: '実行中', className: 'running' },
  completed: { label: '完了', className: 'completed' },
  failed: { label: '失敗', className: 'failed' },
  cancelled: { label: '中止', className: 'cancelled' },
};
const {
  progress: generateProgress,
  label: generateProgressLabel,
  progressSummary: generateProgressSummary,
  start: startGenerateProgress,
  complete: completeGenerateProgress,
  stop: stopGenerateProgress,
} = useJobProgress({
  progressUrl: '/api/spec-tree/progress',
  stages: SPEC_TREE_PROGRESS_STAGES,
  fallbackLabel: '処理中...',
});

// ── Helpers ────────────────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shortenFileName(name, max = 22) {
  const text = String(name || 'ツリー');
  if (text.length <= max) return text;
  const ext = text.includes('.') ? text.slice(text.lastIndexOf('.')) : '';
  const base = ext ? text.slice(0, -ext.length) : text;
  const keep = Math.max(8, max - ext.length - 1);
  return `${base.slice(0, keep)}…${ext}`;
}

function syncRootSelectionWithFiles() {
  const valid = new Set(uploadedFiles.value.map((f) => f.id));
  rootFileIds.value = rootFileIds.value.filter((id) => valid.has(id));
}

function isRootSelected(fileId) {
  return rootFileIds.value.includes(fileId);
}

function rootSelectionIndex(fileId) {
  const index = rootFileIds.value.indexOf(fileId);
  return index >= 0 ? index + 1 : null;
}

function toggleRootFile(fileId) {
  if (!canUpload.value) return;
  if (isRootSelected(fileId)) {
    rootFileIds.value = rootFileIds.value.filter((id) => id !== fileId);
  } else {
    rootFileIds.value = [...rootFileIds.value, fileId];
  }
  saveSpecTreeRecovery(false);
}

function selectTreeTab(tab) {
  activeResultSessionId.value = tab.sessionId;
  treeData.value = treeResultsBySession.value[tab.sessionId] ?? null;
  resetView();
  if (treeData.value?.mmdContent) {
    nextTick(() => renderMermaid(treeData.value.mmdContent));
  }
}

function upsertTreeResultTab(tab, data) {
  treeResultsBySession.value = {
    ...treeResultsBySession.value,
    [tab.sessionId]: data,
  };

  treeResultTabs.value = upsertResultTab(treeResultTabs.value, tab);
  selectTreeTab(tab);
}

function closeTreeResultTab(tab) {
  const result = closeResultTab(treeResultTabs.value, tab.sessionId, activeResultSessionId.value);
  if (!result.closed) return;

  const { [tab.sessionId]: _closedResult, ...remainingResults } = treeResultsBySession.value;
  treeResultTabs.value = result.tabs;
  treeResultsBySession.value = remainingResults;

  if (activeResultSessionId.value !== tab.sessionId) return;
  const nextTab = result.tabs.find((item) => item.sessionId === result.activeSessionId);
  if (nextTab) {
    selectTreeTab(nextTab);
  } else {
    activeResultSessionId.value = '';
    treeData.value = null;
    resetView();
  }
}

function clearTreeResults() {
  treeResultTabs.value = [];
  treeResultsBySession.value = {};
  activeResultSessionId.value = '';
  treeData.value = null;
}

async function loadTaskJobs() {
  try {
    taskJobs.value = await fetchJobsByType('spec_tree');
  } catch (e) {
    console.warn('jobs load failed', e);
  }
}

async function onTaskSelect(job) {
  activeJobId.value = job.id;
  activeSpecTreeTab.value = 'generate';
  error.value = '';
  if (!job.sessionId) return;
  try {
    sessionId.value = job.sessionId;
    const data = await loadSpecTreeResult(job.sessionId);
    if (!data?.mmdContent) {
      treeData.value = null;
      status.value = 'このタスクの結果はまだ利用できません';
      return;
    }
    const normalized = normalizeSpecTreeResult(data);
    upsertTreeResultTab({
      sessionId: job.sessionId,
      rootFileId: job.rootFileId || '',
      label: shortenFileName(job.name || job.title || 'ツリー'),
      closable: true,
    }, normalized);
    status.value = `タスク結果を読み込みました: 合計 ${data.nodeCount} ノード`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'タスク結果の読み込みに失敗しました';
    status.value = '';
  }
}

async function onTaskRerun(job) {
  try {
    await rerunJob(job.id);
    await loadTaskJobs();
    ElMessage.success('再実行をキューに追加しました');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '再実行に失敗しました');
  }
}

async function onTaskStop(job) {
  try {
    await cancelJob(job.id);
    await loadTaskJobs();
    ElMessage.success('タスクを停止しました');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '停止に失敗しました');
  }
}

async function loadExcelConfig() {
  try {
    const res = await fetch('/api/spec-tree/excel');
    if (!res.ok) return;
    const data = await res.json();
    excelSupplement.value = data.supplement;
    excelDeletion.value = data.deletion;
  } catch (e) {
    console.warn('excel config load failed', e);
  }
}

async function uploadExcelConfig(kind, file) {
  const endpoint = kind === 'supplement' ? '/api/spec-tree/upload/supplement' : '/api/spec-tree/upload/deletion';
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(endpoint, { method: 'PUT', body: formData });
  if (!res.ok) {
    throw new Error('Excel のアップロードに失敗しました');
  }
  const data = await res.json();
  if (kind === 'supplement') excelSupplement.value = data;
  else excelDeletion.value = data;
  ElMessage.success(kind === 'supplement' ? '補完リストを更新しました' : '削除リストを更新しました');
}

function onSupplementExcelChange(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file || !canUpload.value) return;
  uploadExcelConfig('supplement', file).catch((err) => {
    ElMessage.error(err instanceof Error ? err.message : 'アップロードに失敗しました');
  });
}

function onDeletionExcelChange(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file || !canUpload.value) return;
  uploadExcelConfig('deletion', file).catch((err) => {
    ElMessage.error(err instanceof Error ? err.message : 'アップロードに失敗しました');
  });
}

function buildTreeResultTabs(jobs = []) {
  return jobs.map((job) => ({
    sessionId: job.sessionId,
    rootFileId: job.rootFileId,
    runId: job.runId,
    jobId: job.jobId,
    label: shortenFileName(uploadedFiles.value.find((f) => f.id === job.rootFileId)?.name || 'ツリー'),
  }));
}

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
      return 'Another spec tree generation is already running. Please wait for it to finish, then try again.';
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
  if (/生成|generate|spec.?tree|スペックツリー/i.test(text)) {
    return 'Processing failed.';
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

function normalizeSpecTreeResult(result) {
  return {
    mmdContent: result.mmdContent,
    nodeCount: result.nodeCount ?? result.treeNodes?.length ?? 0,
    treeNodes: Array.isArray(result.treeNodes) ? result.treeNodes : null,
  };
}

function warnIfSpecTreeHasNoChildNodes(result) {
  const treeNodes = Array.isArray(result?.treeNodes) ? result.treeNodes : null;
  const hasChildNode = treeNodes !== null
    ? treeNodes.some(node => Number(node?.level || 0) > 0)
    : Number(result?.nodeCount || 0) > 1;
  if (!hasChildNode) {
    ElMessage.warning('子ノードが見つかりませんでした。アップロードしたファイルが正しいか、または破損していないか確認してください。');
  }
}

// ── Mermaid rendering ──────────────────────────────────────────────────────
async function renderMermaid(content) {
  await nextTick();
  if (!mermaidContainer.value) return;
  const directed = normalizeSpecTreeMermaid(content);
  try {
    const mermaid = (await import('mermaid')).default;
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      flowchart: {
        htmlLabels: true,
        nodeSpacing: direction.value === 'TD' ? 34 : 48,
        rankSpacing: direction.value === 'TD' ? 56 : 72,
        padding: 12,
      },
      themeVariables: {
        primaryColor: '#0076BF',
        primaryTextColor: '#ffffff',
        primaryBorderColor: '#005a9e',
        lineColor: '#94a3b8',
        secondaryColor: '#e0f0fb',
        tertiaryColor: '#f1f5f9',
        fontFamily: UI_FONT_FAMILY,
        fontSize: '13px',
      },
    });
    const id = `mermaid-${Date.now()}`;
    const { svg } = await mermaid.render(id, directed);
    mermaidContainer.value.innerHTML = svg;
    normalizeRenderedSvgSize();
    fitTreeToCanvas();
  } catch (e) {
    console.error('Mermaid render failed', e);
  }
}

function normalizeSpecTreeMermaid(content) {
  return wrapMermaidNodeLabels(
    content.replace(/^(graph|flowchart)\s+\w+/m, `flowchart ${direction.value}`),
    SPEC_TREE_LABEL_WRAP_LIMIT[direction.value] || SPEC_TREE_LABEL_WRAP_LIMIT.LR,
  );
}

function wrapMermaidNodeLabels(content, lineLimit) {
  return String(content || '')
    .split(/\r?\n/)
    .map(line => line.replace(/(\b[\w-]+)\["([^"]*)"\]/g, (match, nodeId, label) => {
      const wrapped = label
        .split(/<br\s*\/?>/i)
        .flatMap(part => wrapLabelSegment(part, lineLimit));
      return `${nodeId}["${wrapped.join('<br/>')}"]`;
    }))
    .join('\n');
}

function wrapLabelSegment(text, lineLimit) {
  const segment = String(text || '').trim();
  if (!segment) return [''];
  if (/^Rev:/i.test(segment) || displayWidth(segment) <= lineLimit) return [segment];

  const words = segment.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return splitByDisplayWidth(segment, lineLimit);

  const lines = [];
  let line = '';
  words.forEach(word => {
    const candidate = line ? `${line} ${word}` : word;
    if (displayWidth(candidate) <= lineLimit) {
      line = candidate;
      return;
    }
    if (line) lines.push(line);
    if (displayWidth(word) > lineLimit) {
      const splitWord = splitByDisplayWidth(word, lineLimit);
      lines.push(...splitWord.slice(0, -1));
      line = splitWord[splitWord.length - 1] || '';
    } else {
      line = word;
    }
  });
  if (line) lines.push(line);
  return lines;
}

function splitByDisplayWidth(text, lineLimit) {
  const lines = [];
  let line = '';
  let width = 0;
  Array.from(String(text || '')).forEach(char => {
    const charWidth = displayWidth(char);
    if (line && width + charWidth > lineLimit) {
      lines.push(line);
      line = char;
      width = charWidth;
      return;
    }
    line += char;
    width += charWidth;
  });
  if (line) lines.push(line);
  return lines;
}

function displayWidth(text) {
  return Array.from(String(text || '')).reduce((sum, char) => {
    return sum + (/[\u3000-\u9fff\uff00-\uffef]/u.test(char) ? 2 : 1);
  }, 0);
}

function normalizeRenderedSvgSize() {
  const svgEl = mermaidContainer.value?.querySelector('svg');
  if (!svgEl) return;
  const viewBox = svgEl.getAttribute('viewBox')?.split(/\s+/).map(Number);
  if (viewBox && viewBox.length === 4 && viewBox.every(Number.isFinite)) {
    svgEl.setAttribute('width', String(Math.ceil(Math.max(viewBox[2], 1))));
    svgEl.setAttribute('height', String(Math.ceil(Math.max(viewBox[3], 1))));
  }
  svgEl.style.maxWidth = 'none';
  svgEl.style.height = 'auto';
}

async function fitTreeToCanvas() {
  await nextTick();
  const svgEl = mermaidContainer.value?.querySelector('svg');
  const canvasEl = mermaidContainer.value?.closest('.canvas');
  if (!svgEl || !canvasEl) return;

  const { width, height } = getSvgSize(svgEl);
  const availableWidth = Math.max(canvasEl.clientWidth - 96, 240);
  const availableHeight = Math.max(canvasEl.clientHeight - 96, 180);
  const fitZoom = Math.min(availableWidth / width, availableHeight / height, 1);
  const minZoom = SPEC_TREE_MIN_FIT_ZOOM[direction.value] || SPEC_TREE_MIN_FIT_ZOOM.LR;
  zoom.value = Number(Math.max(minZoom, Math.min(1.1, fitZoom)).toFixed(2));
  panX.value = 0;
  panY.value = 0;
}

// Re-render whenever treeData content changes
watch(() => treeData.value?.mmdContent, (content) => {
  if (content) renderMermaid(content);
});

// Re-render when direction toggle changes
watch(direction, () => {
  if (treeData.value?.mmdContent) renderMermaid(treeData.value.mmdContent);
});


// ── File upload ────────────────────────────────────────────────────────────
const SPEC_TREE_ACCEPTED_EXTENSIONS = ['.pdf', '.tif', '.tiff'];
const SPEC_TREE_ACCEPTED_MIME_TYPES = new Set(['application/pdf', 'image/tif', 'image/tiff']);

function isAcceptedSpecTreeFile(file) {
  const name = String(file?.name || '').toLowerCase();
  return SPEC_TREE_ACCEPTED_EXTENSIONS.some(ext => name.endsWith(ext)) || SPEC_TREE_ACCEPTED_MIME_TYPES.has(file?.type);
}

async function handleFiles(files) {
  if (!canUpload.value) {
    isDragging.value = false;
    return;
  }
  const validFiles = files.filter(isAcceptedSpecTreeFile);
  if (validFiles.length === 0) return;
  if (validFiles.some(file => file.size > MAX_UPLOAD_FILE_SIZE)) {
    error.value = FILE_SIZE_LIMIT_MESSAGE;
    status.value = '';
    uploading.value = false;
    uploadProgress.value = 0;
    return;
  }

  error.value    = '';
  uploading.value = true;
  uploadProgress.value = 10;
  status.value   = 'ファイルをアップロード中...';

  try {
    const formData = new FormData();
    validFiles.forEach(f => formData.append('files', f));

    uploadProgress.value = 40;
    const res = await fetch('/api/spec-tree/upload', { method: 'POST', body: formData });
    uploadProgress.value = 80;

    if (!res.ok) {
      throw new Error(await readErrorPayload(res, 'Upload failed.'));
    }

    const data = await res.json();
    uploadProgress.value = 100;
    sessionId.value = data.sessionId;

    // Merge without duplicates
    const existing = new Map(uploadedFiles.value.map(f => [f.name, f]));
    data.files.forEach(f => existing.set(f.name, f));
    uploadedFiles.value = Array.from(existing.values());
    syncRootSelectionWithFiles();
    if (rootFileIds.value.length === 0 && uploadedFiles.value[0]) {
      rootFileIds.value = [uploadedFiles.value[0].id];
    }
    saveSpecTreeRecovery(false);

    status.value = `${data.files.length} 件のファイルをアップロードしました`;
  } catch (e) {
    error.value  = formatCaughtError(e, 'Upload failed.');
    status.value = '';
    uploading.value = false;
    uploadProgress.value = 0;
  } finally {
    // Success - show 100% for a moment then hide
    if (!error.value) {
      await new Promise(r => setTimeout(r, 600));
      uploading.value = false;
      uploadProgress.value = 0;
    }
  }
}

function onFileInputChange(e) {
  handleFiles(Array.from(e.target.files || []));
  e.target.value = '';
}

function onFolderInputChange(e) {
  handleFiles(Array.from(e.target.files || []));
  e.target.value = '';
}

function onDragOver(e) {
  e.preventDefault();
  if (!canUpload.value) return;
  isDragging.value = true;
}
function onDragLeave() {
  isDragging.value = false;
}

// ── Folder drag-and-drop helpers ───────────────────────────────────────────
async function readAllEntries(dirReader) {
  const allEntries = [];
  const readBatch = () => new Promise((resolve) => {
    dirReader.readEntries((batch) => {
      if (batch.length === 0) { resolve(); return; }
      allEntries.push(...batch);
      readBatch().then(resolve);
    });
  });
  await readBatch();
  return allEntries;
}

async function entryToFile(entry) {
  if (entry.isFile) {
    return new Promise((resolve) => entry.file(resolve));
  }
  return null;
}

async function collectFiles(entry) {
  if (entry.isFile) {
    const file = await entryToFile(entry);
    return file ? [file] : [];
  }
  if (entry.isDirectory) {
    const entries = await readAllEntries(entry.createReader());
    const nested = await Promise.all(entries.map(collectFiles));
    return nested.flat();
  }
  return [];
}

async function onDrop(e) {
  e.preventDefault();
  isDragging.value = false;
  if (!canUpload.value) return;
  const items = Array.from(e.dataTransfer.items || []);
  if (items.length === 0) return;

  const entries = items.map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  if (entries.length === 0) {
    // fallback for browsers without webkitGetAsEntry
    handleFiles(Array.from(e.dataTransfer.files));
    return;
  }
  const nested = await Promise.all(entries.map(collectFiles));
  handleFiles(nested.flat());
}

function removeFile(fileId) {
  if (!canUpload.value) return;
  uploadedFiles.value = uploadedFiles.value.filter(f => f.id !== fileId);
  syncRootSelectionWithFiles();
  saveSpecTreeRecovery(false);
}

function clearUploadedFiles() {
  if (!canUpload.value) return;
  uploadedFiles.value = [];
  rootFileIds.value = [];
  clearTreeResults();
  status.value = '';
  error.value = '';
  uploading.value = false;
  uploadProgress.value = 0;
  clearSpecTreeRecovery();
}

// ── Generate (Phase 2) ───────────────────────────────────────────────────────
async function handleGenerate() {
  if (!canGenerate.value || !sessionId.value) return;
  if (rootFileIds.value.length === 0) {
    ElMessage.warning('ルートファイルを1つ以上選択してください');
    return;
  }

  error.value = '';
  status.value = '';
  generating.value = true;
  generateRequestSeq += 1;
  activeGenerateRunId = `run:${generateRequestSeq}`;
  const requestSeq = generateRequestSeq;
  clearTreeResults();
  try {
    const startRes = await fetch('/api/spec-tree/generate/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId.value, rootFileIds: rootFileIds.value, clientRunId: activeGenerateRunId }),
    });
    if (requestSeq !== generateRequestSeq) return;
    if (!startRes.ok) {
      throw new Error(await readErrorPayload(startRes, 'スペックツリーの生成を開始できませんでした'));
    }

    const startPayload = await startRes.json();
    const { jobs, cacheHit } = startPayload;

    if (cacheHit) {
      ElMessage.success('キャッシュから結果を取得しました');
    }

    if (!jobs || jobs.length === 0) {
      throw new Error('No jobs returned');
    }

    activeSpecTreeTab.value = 'tasks';
    activeTaskStatusTab.value = 'all';
    startGenerateProgress(jobs[0].sessionId, jobs[0].runId || activeGenerateRunId);
    saveSpecTreeRecovery(true, jobs[0]);

    const results = await waitForGeneratedSpecTreeResultsForJobs({
      jobs,
      requestSeq,
      pollMs: 700,
      timeoutMs: Math.max(15000, jobs.length * 6000),
    });
    const validResults = results.filter((r) => r.success);

    if (validResults.length > 0) {
      treeResultTabs.value = validResults.map(({ job, data }) => {
        const normalized = normalizeSpecTreeResult(data);
        treeResultsBySession.value[job.sessionId] = normalized;
        return {
          sessionId: job.sessionId,
          rootFileId: job.rootFileId,
          label: shortenFileName(uploadedFiles.value.find((f) => f.id === job.rootFileId)?.name || 'ツリー'),
          closable: true,
        };
      });

      if (treeResultTabs.value.length > 0) {
        activeResultSessionId.value = treeResultTabs.value[0].sessionId;
        treeData.value = treeResultsBySession.value[treeResultTabs.value[0].sessionId];
        await nextTick();
        renderMermaid(treeData.value.mmdContent);
      }

      activeSpecTreeTab.value = 'generate';
      status.value = `${validResults.length} 件のスペックツリーを生成しました`;
      saveSpecTreeRecovery(false, jobs[0]);
    } else {
      status.value = 'タスクをキューに追加しました。タスク管理から結果を確認できます';
    }

    await loadTaskJobs();
    selectedCompletedJobIds.value = [];
  } catch (e) {
    if (requestSeq !== generateRequestSeq) return;
    error.value = formatCaughtError(e, 'スペックツリーの生成に失敗しました');
  } finally {
    if (requestSeq === generateRequestSeq) {
      generating.value = false;
      completeGenerateProgress();
    }
  }
}

// ── Export ─────────────────────────────────────────────────────────────────
function handleExport(format) {
  if (!activeResultSessionId.value) return;
  const ext = format === 'excel' ? 'xlsx' : format;
  const a = document.createElement('a');
  a.href = `/api/spec-tree/export?format=${format}&sessionId=${activeResultSessionId.value}`;
  a.download = `spec-tree.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function handleDownloadCommand(command) {
  if (!treeData.value) return;
  if (command === 'excel') {
    handleExport('excel');
  } else if (command === 'csv') {
    handleExport('csv');
  } else if (command === 'mmd') {
    downloadMmd();
  } else if (command === 'image') {
    downloadSvg();
  }
}

function downloadMmd() {
  if (!treeData.value?.mmdContent) return;
  const blob = new Blob([treeData.value.mmdContent], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'spec-tree.mmd';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadSvg() {
  if (!mermaidContainer.value) return;
  const svgEl = mermaidContainer.value.querySelector('svg');
  if (!svgEl) return;
  const svgXml = new XMLSerializer().serializeToString(svgEl);
  const blob = new Blob([svgXml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'spec-tree.svg';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Zoom / Pan ─────────────────────────────────────────────────────────────
function resetView() {
  zoom.value = 1;
  panX.value = 0;
  panY.value = 0;
}

function setZoom(value) {
  zoom.value = Number(Math.min(SPEC_TREE_MAX_ZOOM, Math.max(SPEC_TREE_MIN_ZOOM, value)).toFixed(3));
}

function fitToView() {
  fitTreeToCanvas();
}

function onMouseDown(e) {
  if (!treeData.value) return;
  isPanning.value = true;
  panStart = { x: e.clientX, y: e.clientY, panX: panX.value, panY: panY.value };
}

function onMouseMove(e) {
  if (!isPanning.value || !panStart) return;
  panX.value = panStart.panX + (e.clientX - panStart.x);
  panY.value = panStart.panY + (e.clientY - panStart.y);
}

function onMouseUp() {
  isPanning.value = false;
  panStart = null;
}

function onWheel(e) {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  setZoom(zoom.value + delta);
}

// ── Computed ───────────────────────────────────────────────────────────────
const canUpload = computed(() =>
  !uploading.value && !generating.value
);

const canGenerate = computed(() =>
  canUpload.value && uploadedFiles.value.length > 0 && rootFileIds.value.length > 0
);
const generateButtonLabel = computed(() => {
  if (rootFileIds.value.length > 0) {
    return `生成を開始 ×${rootFileIds.value.length}`;
  }
  return '生成を開始';
});
const excelSupplementName = computed(() => excelSupplement.value?.fileName || '');
const excelDeletionName = computed(() => excelDeletion.value?.fileName || '');
const excelSettingsSummary = computed(() => {
  const supplement = excelSupplementName.value ? '補完設定済み' : '補完なし';
  const deletion = excelDeletionName.value ? '削除設定済み' : '削除なし';
  return `${supplement} / ${deletion}`;
});
const filteredTaskJobs = computed(() => {
  if (activeTaskStatusTab.value === 'all') return taskJobs.value;
  if (activeTaskStatusTab.value === 'stopped') {
    return taskJobs.value.filter((job) => job.status === 'failed' || job.status === 'cancelled');
  }
  return taskJobs.value.filter((job) => job.status === activeTaskStatusTab.value);
});
const completedTaskJobs = computed(() => taskJobs.value.filter((job) => job.status === 'completed' && !job.expired));
const selectedCompletedJobs = computed(() => {
  const selected = new Set(selectedCompletedJobIds.value);
  return completedTaskJobs.value.filter((job) => selected.has(job.id));
});
const allCompletedSelected = computed(() =>
  completedTaskJobs.value.length > 0 && selectedCompletedJobs.value.length === completedTaskJobs.value.length
);
const currentFactorySummary = computed(() => {
  const job = taskJobs.value.find((item) => item.factory || item.ipAddress);
  if (!job) return '現在のIP / 工場単位で表示';
  return `${job.factory || '不明'} / ${job.ipAddress || 'IP未取得'}`;
});

function taskStatusMeta(status) {
  return TASK_STATUS_META[status] || { label: status || '不明', className: 'unknown' };
}

function taskProgress(job) {
  return Math.max(0, Math.min(100, Number(job.progress) || 0));
}

function taskQueueLabel(job) {
  if (job.status === 'completed') return '完了済み';
  if (job.status === 'failed') return '失敗';
  if (job.status === 'cancelled') return '中止';
  if (!job.queuePosition) return 'キュー確認中';
  return `全体キュー ${job.queuePosition}番目`;
}

function taskRetentionLabel(job) {
  if (job.expired) return '保存期限切れ';
  if (job.retentionDaysLeft === null || job.retentionDaysLeft === undefined) return '保存期限確認中';
  return `保存期限：残り${job.retentionDaysLeft}日`;
}

function canOpenTaskResult(job) {
  return job.status === 'completed' && !job.expired && Boolean(job.sessionId);
}

function toggleCompletedJobSelection(job) {
  if (!canOpenTaskResult(job)) return;
  const selected = new Set(selectedCompletedJobIds.value);
  if (selected.has(job.id)) selected.delete(job.id);
  else selected.add(job.id);
  selectedCompletedJobIds.value = [...selected];
}

function toggleAllCompletedJobs() {
  if (allCompletedSelected.value) {
    selectedCompletedJobIds.value = [];
    return;
  }
  selectedCompletedJobIds.value = completedTaskJobs.value.map((job) => job.id);
}

function downloadBySession(sessionId, format, title = 'spec-tree') {
  const ext = format === 'excel' ? 'xlsx' : format;
  const a = document.createElement('a');
  a.href = `/api/spec-tree/export?format=${format}&sessionId=${encodeURIComponent(sessionId)}`;
  a.download = `${title}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function downloadTextFile(content, fileName, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadTaskResult(job, format) {
  if (!canOpenTaskResult(job)) {
    ElMessage.warning('このタスクの結果はダウンロードできません');
    return;
  }
  const title = String(job.name || job.title || 'spec-tree').replace(/[\\/:*?"<>|]/g, '_');
  if (format === 'excel' || format === 'csv') {
    downloadBySession(job.sessionId, format, title);
    return;
  }
  const data = await loadSpecTreeResult(job.sessionId);
  if (!data?.mmdContent) {
    ElMessage.warning('このタスクのツリー内容を取得できませんでした');
    return;
  }
  if (format === 'mmd') {
    downloadTextFile(data.mmdContent, `${title}.mmd`);
    return;
  }
  if (format === 'image') {
    downloadTextFile(data.mmdContent, `${title}.mmd`);
    ElMessage.info('SVGは結果表示画面のダウンロードから取得できます。MMDを保存しました');
  }
}

async function handleTaskDownloadCommand(command) {
  const [jobId, format] = String(command).split(':');
  const job = taskJobs.value.find((item) => item.id === jobId);
  if (!job || !format) return;
  try {
    await downloadTaskResult(job, format);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : 'ダウンロードに失敗しました');
  }
}

async function handleBulkDownloadCommand(format) {
  if (selectedCompletedJobs.value.length === 0) {
    ElMessage.warning('完了タスクを選択してください');
    return;
  }
  try {
    for (const job of selectedCompletedJobs.value) {
      await downloadTaskResult(job, format);
    }
    ElMessage.success(`${selectedCompletedJobs.value.length}件のダウンロードを開始しました`);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '一括ダウンロードに失敗しました');
  }
}

function saveSpecTreeRecovery(isGenerating = generating.value, accepted = null) {
  if (!sessionId.value) {
    clearSpecTreeRecovery();
    return;
  }
  const payload = {
    feature: 'spec_tree',
    sessionId: sessionId.value,
    runId: accepted?.runId || activeGenerateRunId || '',
    jobId: accepted?.jobId || '',
    uploadedFiles: uploadedFiles.value,
    rootFileIds: rootFileIds.value,
    generating: Boolean(isGenerating),
    completed: Boolean(treeData.value?.mmdContent),
    updatedAt: Date.now(),
  };
  try {
    localStorage.setItem(SPEC_TREE_RECOVERY_KEY, JSON.stringify(payload));
  } catch {}
}

function clearSpecTreeRecovery() {
  try {
    localStorage.removeItem(SPEC_TREE_RECOVERY_KEY);
  } catch {}
}

function loadSpecTreeRecovery() {
  try {
    return JSON.parse(localStorage.getItem(SPEC_TREE_RECOVERY_KEY) || 'null');
  } catch {
    return null;
  }
}

async function restoreSpecTreeRecovery() {
  if (generating.value || treeData.value) return;
  const saved = loadSpecTreeRecovery();
  if (!saved?.sessionId || saved.feature !== 'spec_tree') return;
  restoringSpecTreeRecovery = true;
  sessionId.value = saved.sessionId;
  uploadedFiles.value = Array.isArray(saved.uploadedFiles) ? saved.uploadedFiles : [];
  rootFileIds.value = Array.isArray(saved.rootFileIds) ? saved.rootFileIds : [];
  activeGenerateRunId = saved.runId || null;
  error.value = '';

  const requestSeq = ++generateRequestSeq;
  try {
    if (saved.generating) {
      status.value = 'ファイルを解析中...';
      generating.value = true;
      startGenerateProgress(sessionId.value);
      const result = await waitForGeneratedSpecTreeResult({
        waitMs: 0,
        pollMs: 3000,
        requestSeq,
        stopOnNotFound: true,
      });
      if (!result || requestSeq !== generateRequestSeq) return;
      completeGenerateProgress();
      treeData.value = normalizeSpecTreeResult(result);
      warnIfSpecTreeHasNoChildNodes(treeData.value);
      status.value = `スペックツリーの生成が完了しました。合計 ${treeData.value.nodeCount} ノード`;
      saveSpecTreeRecovery(false, { runId: saved.runId, jobId: saved.jobId });
      return;
    }

    const res = await fetch(`/api/spec-tree/result?sessionId=${encodeURIComponent(sessionId.value)}`, { cache: 'no-store' });
    if (requestSeq !== generateRequestSeq) return;
    if (res.ok) {
      const result = await res.json();
      if (result?.mmdContent) {
        treeData.value = normalizeSpecTreeResult(result);
        warnIfSpecTreeHasNoChildNodes(treeData.value);
        status.value = `スペックツリーの生成が完了しました。合計 ${treeData.value.nodeCount} ノード`;
        saveSpecTreeRecovery(false, { runId: saved.runId, jobId: saved.jobId });
      }
    } else if (res.status === 404) {
      resetSpecTreeSessionState();
    }
  } catch (e) {
    if (requestSeq !== generateRequestSeq) return;
    stopGenerateProgress({ reset: true });
    const message = formatCaughtError(e, 'スペックツリー結果の復元に失敗しました');
    if (isSessionNotFoundError(message)) {
      resetSpecTreeSessionState({ errorMessage: message });
    } else {
      error.value = message;
      clearSpecTreeRecovery();
    }
    status.value = '';
  } finally {
    if (requestSeq === generateRequestSeq) {
      stopGenerateProgress();
      generating.value = false;
      activeGenerateRunId = null;
    }
    restoringSpecTreeRecovery = false;
  }
}

function isSessionNotFoundError(message) {
  return /^Error code:\s*404\b/i.test(String(message || ''));
}

function resetSpecTreeSessionState({ errorMessage = '' } = {}) {
  generateRequestSeq += 1;
  generateAbortController?.abort();
  generateAbortController = null;
  stopGenerateProgress({ reset: true });
  sessionId.value = null;
  uploadedFiles.value = [];
  rootFileIds.value = [];
  treeData.value = null;
  generating.value = false;
  activeGenerateRunId = null;
  restoringSpecTreeRecovery = false;
  status.value = '';
  error.value = errorMessage;
  clearSpecTreeRecovery();
}

async function waitForGeneratedSpecTreeResult({ waitMs, pollMs, requestSeq = null, stopOnNotFound = false }) {
  if (!sessionId.value) return null;
  return waitForSpecTreeResultBySession(sessionId.value, { waitMs, pollMs, requestSeq, stopOnNotFound });
}

async function waitForSpecTreeResultBySession(sessionIdToPoll, {
  waitMs,
  pollMs,
  requestSeq = null,
  stopOnNotFound = false,
}) {
  if (!sessionIdToPoll) return null;
  const timeoutMs = Math.max(0, Number(waitMs) || 0);
  const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : null;
  let lastNetworkError = null;
  while (!deadline || Date.now() < deadline) {
    if (requestSeq !== null && requestSeq !== generateRequestSeq) return null;
    let res = null;
    try {
      res = await fetch(`/api/spec-tree/result?sessionId=${encodeURIComponent(sessionIdToPoll)}`, { cache: 'no-store' });
      lastNetworkError = null;
    } catch (e) {
      lastNetworkError = e;
      await new Promise(resolve => setTimeout(resolve, pollMs));
      continue;
    }
    if (res.ok) {
      const result = await res.json();
      if (result?.mmdContent) return result;
    } else if (res.status === 404 && stopOnNotFound) {
      throw new Error(await readErrorPayload(res, 'The requested session or result was not found.'));
    } else if (res.status !== 202 && res.status !== 404) {
      throw new Error(await readErrorPayload(res, 'Processing failed.'));
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  if (lastNetworkError) {
    throw new Error(formatCaughtError(lastNetworkError, 'A network error occurred.'));
  }
  throw new Error(createUiErrorMessage({ code: 'UNKNOWN', fallbackMessage: 'The request timed out.' }));
}

async function waitForGeneratedSpecTreeResultsForJobs({
  jobs,
  requestSeq,
  pollMs = 1000,
  timeoutMs = 15000,
}) {
  return Promise.all(jobs.map(async (job) => {
    try {
      const data = await waitForSpecTreeResultBySession(job.sessionId, {
        waitMs: timeoutMs,
        pollMs,
        requestSeq,
        stopOnNotFound: true,
      });
      return { job, data, success: !!data?.mmdContent };
    } catch {
      return { job, data: null, success: false };
    }
  }));
}

async function recoverGeneratedSpecTreeResult({ waitMs = 0, pollMs = 3000 } = {}) {
  if (!sessionId.value) return null;
  const deadline = Date.now() + Math.max(0, waitMs);
  do {
    try {
      const res = await fetch(`/api/spec-tree/result?sessionId=${encodeURIComponent(sessionId.value)}`, { cache: 'no-store' });
      if (res.ok) {
        const result = await res.json();
        if (result?.mmdContent) {
          return normalizeSpecTreeResult(result);
        }
      }
    } catch {}
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, pollMs));
  } while (true);
  return null;
}

function getSvgSize(svgEl) {
  const viewBox = svgEl.getAttribute('viewBox')?.split(/\s+/).map(Number);
  if (viewBox && viewBox.length === 4 && viewBox.every(Number.isFinite)) {
    return { width: Math.max(viewBox[2], 1), height: Math.max(viewBox[3], 1) };
  }
  const rect = svgEl.getBoundingClientRect();
  return { width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) };
}

function createClientRunId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

onMounted(() => {
  loadTaskJobs();
  loadExcelConfig();
  restoreSpecTreeRecovery();
  taskRefreshTimer = window.setInterval(loadTaskJobs, 3000);
});

onUnmounted(() => {
  if (taskRefreshTimer) window.clearInterval(taskRefreshTimer);
});

watch(rootFileIds, () => {
  if (!generating.value && !restoringSpecTreeRecovery) saveSpecTreeRecovery(false);
});

</script>

<template>
  <div class="spec-tree-page">
    <div class="spec-tree-tabbar">
      <button
        type="button"
        class="spec-tree-tabbar-btn"
        :class="{ active: activeSpecTreeTab === 'generate' }"
        @click="activeSpecTreeTab = 'generate'"
      >
        ツリー生成
      </button>
      <button
        type="button"
        class="spec-tree-tabbar-btn"
        :class="{ active: activeSpecTreeTab === 'tasks' }"
        @click="activeSpecTreeTab = 'tasks'"
      >
        タスク管理
        <span v-if="taskJobs.length" class="tab-count">{{ taskJobs.length }}</span>
      </button>
    </div>

    <div v-if="activeSpecTreeTab === 'generate'" class="spec-tree-workspace">
    <!-- Left Panel -->
    <aside class="left-panel">
      <div class="panel-header">
        <span class="panel-header-title">スペックツリー</span>
      </div>

      <div class="panel-body">

        <!-- Upload zone -->
        <div class="section upload-section">
          <div
            class="upload-zone"
            :class="{ dragging: isDragging, disabled: !canUpload }"
            @dragover="onDragOver"
            @dragleave="onDragLeave"
            @drop="onDrop"
            @click="canUpload && fileInputRef?.click()"
          >
            <input
              ref="fileInputRef"
              type="file"
              multiple
              accept=".pdf,.tif,.tiff,image/tif,image/tiff"
              :disabled="!canUpload"
              style="display:none"
              @click.stop
              @change="onFileInputChange"
            />
            <input
              ref="folderInputRef"
              type="file"
              multiple
              webkitdirectory
              directory
              accept=".pdf,.tif,.tiff,image/tif,image/tiff"
              :disabled="!canUpload"
              style="display:none"
              @click.stop
              @change="onFolderInputChange"
            />
            <!-- Upload icon -->
            <svg class="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="16,16 12,12 8,16" />
              <line x1="12" y1="12" x2="12" y2="21" />
              <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
            </svg>
            <p class="upload-hint-primary">PDF/TIF対応・1ファイル上限50MB</p>
            <div class="upload-actions">
              <button
                class="btn btn-primary btn-sm upload-btn"
                :disabled="!canUpload"
                @click.stop="canUpload && fileInputRef?.click()"
              >ファイル選択</button>
              <button
                class="btn btn-outline btn-sm upload-btn"
                :disabled="!canUpload"
                @click.stop="canUpload && folderInputRef?.click()"
              >フォルダ選択</button>
            </div>
            <span v-if="uploadedFiles.length > 0" class="file-count-badge">
              {{ uploadedFiles.length }}
            </span>
          </div>

          <!-- Progress -->
          <div v-if="uploading" class="upload-progress">
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: uploadProgress + '%' }"></div>
            </div>
            <span class="progress-text">アップロード中...</span>
          </div>
        </div>

        <!-- File list -->
        <div v-if="uploadedFiles.length > 0" class="section file-list-section">
          <div class="file-list-header">
            <label class="section-label">
              アップロード済みファイル
              <span class="section-label-count">({{ uploadedFiles.length }})</span>
            </label>
            <button
              class="clear-files-btn"
              type="button"
              :disabled="!canUpload"
              title="アップロード済みファイルをクリア"
              @click="clearUploadedFiles"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3,6 5,6 21,6" />
                <path d="M8,6V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2" />
                <path d="M19,6l-1,14a2,2 0 0,1 -2,2H8a2,2 0 0,1 -2,-2L5,6" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
              クリア
            </button>
          </div>
          <div class="file-list">
            <div
              v-for="file in uploadedFiles"
              :key="file.id"
              class="file-item"
              :class="{ 'file-item--root': isRootSelected(file.id), 'file-item--disabled': !canUpload }"
              role="button"
              :tabindex="canUpload ? 0 : -1"
              :title="isRootSelected(file.id) ? `ツリー ${rootSelectionIndex(file.id)} の指定を解除` : 'クリックしてツリーに指定'"
              @click="toggleRootFile(file.id)"
              @keydown.enter.prevent="toggleRootFile(file.id)"
              @keydown.space.prevent="toggleRootFile(file.id)"
            >
              <div
                class="root-toggle-indicator"
                :class="{ selected: isRootSelected(file.id) }"
              >
                <template v-if="isRootSelected(file.id)">
                  <svg class="root-tree-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="6" y1="3" x2="6" y2="15" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                  <span>{{ rootSelectionIndex(file.id) }}</span>
                </template>
                <span v-else>＋</span>
              </div>
              <svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="#0076bf" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14,2 14,8 20,8" />
              </svg>
              <div class="file-info">
                <span class="file-name" :title="file.name">{{ file.name }}</span>
                <span class="file-size">{{ formatBytes(file.size) }}</span>
              </div>
              <button
                type="button"
                class="file-remove-btn"
                :disabled="!canUpload"
                title="削除"
                @click.stop="removeFile(file.id)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <!-- Excel settings -->
        <div class="section excel-settings-section">
          <button
            type="button"
            class="excel-settings-toggle"
            :aria-expanded="excelSettingsOpen"
            @click="excelSettingsOpen = !excelSettingsOpen"
          >
            <span class="excel-settings-title">補完・削除リスト（Excel）</span>
            <span class="excel-settings-summary">{{ excelSettingsSummary }}</span>
            <svg
              class="excel-settings-chevron"
              :class="{ open: excelSettingsOpen }"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="6,9 12,15 18,9" />
            </svg>
          </button>

          <div v-if="excelSettingsOpen" class="excel-settings-body">
            <div class="excel-card">
              <svg class="excel-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
                <path d="M14 3v5h5" />
              </svg>
              <div class="excel-info">
                <span class="excel-name">補完Excel</span>
                <span class="excel-current">現在: {{ excelSupplementName || 'なし' }}</span>
              </div>
              <button type="button" class="btn btn-outline btn-sm excel-button" :disabled="!canUpload" @click="supplementInputRef?.click()">
                変更
              </button>
              <input ref="supplementInputRef" type="file" accept=".xlsx,.xls,.csv" style="display:none" @change="onSupplementExcelChange" />
            </div>

            <div class="excel-card">
              <svg class="excel-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
                <path d="M14 3v5h5" />
              </svg>
              <div class="excel-info">
                <span class="excel-name">削除Excel</span>
                <span class="excel-current">現在: {{ excelDeletionName || 'なし' }}</span>
              </div>
              <button type="button" class="btn btn-outline btn-sm excel-button" :disabled="!canUpload" @click="deletionInputRef?.click()">
                変更
              </button>
              <input ref="deletionInputRef" type="file" accept=".xlsx,.xls,.csv" style="display:none" @change="onDeletionExcelChange" />
            </div>
          </div>
        </div>

        <!-- Generate button -->
        <button
          v-if="!generating"
          class="btn btn-primary btn-full"
          :disabled="!canGenerate"
          @click="handleGenerate"
        >
          <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          {{ generateButtonLabel }}
        </button>

        <!-- Status -->
        <div v-if="status && !error" class="status-msg">{{ status }}</div>

        <!-- Error -->
        <div v-if="error" class="error-msg">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{{ error }}</span>
        </div>

      </div>
    </aside>

    <!-- Right Panel -->
    <main class="right-panel" ref="rightPanelRef">
      <!-- Tree Tabs -->
      <div v-if="treeResultTabs.length > 0" class="tree-tabs">
        <button
          v-for="tab in treeResultTabs"
          :key="tab.sessionId"
          type="button"
          class="tree-tab"
          :class="{ active: activeResultSessionId === tab.sessionId }"
          :title="tab.label"
          @click="selectTreeTab(tab)"
        >
          <span class="tree-tab-label">{{ tab.label }}</span>
          <span
            v-if="tab.closable"
            class="tree-tab-close"
            title="閉じる"
            role="button"
            tabindex="0"
            @click.stop="closeTreeResultTab(tab)"
            @keydown.enter.stop.prevent="closeTreeResultTab(tab)"
            @keydown.space.stop.prevent="closeTreeResultTab(tab)"
          >
            ×
          </span>
        </button>
      </div>

      <!-- Toolbar -->
      <div class="toolbar">
        <div class="toolbar-left">
          <span class="toolbar-title">スペックツリー表示</span>
          <span v-if="treeData" class="badge">{{ treeData.nodeCount }} ノード</span>
        </div>
        <div class="toolbar-right">
          <template v-if="treeData">
            <button class="btn btn-outline btn-icon" title="拡大" @click="setZoom(zoom + 0.2)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="11" y1="8" x2="11" y2="14" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </button>
            <button class="btn btn-outline btn-icon" title="縮小" @click="setZoom(zoom - 0.2)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </button>
            <button class="btn btn-outline btn-icon" title="ビューをリセット" @click="resetView">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15,3 21,3 21,9" />
                <polyline points="9,21 3,21 3,15" />
                <path d="M21 3l-7 7M3 21l7-7" />
              </svg>
            </button>
            <!-- Direction toggle - same group as zoom controls -->
            <div class="direction-toggle">
              <button
                class="direction-btn"
                :class="{ active: direction === 'LR' }"
                title="横向きに表示"
                @click="direction = 'LR'"
              >横向き</button>
              <button
                class="direction-btn"
                :class="{ active: direction === 'TD' }"
                title="縦向きに表示"
                @click="direction = 'TD'"
              >縦向き</button>
            </div>
            <div class="toolbar-divider"></div>
          </template>
          <el-dropdown trigger="click" :disabled="!treeData" @command="handleDownloadCommand">
            <button class="btn btn-primary btn-sm" :disabled="!treeData">
              <svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7,10 12,15 17,10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              ダウンロード
              <svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6,9 12,15 18,9" />
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
                <el-dropdown-item command="mmd" divided>
                  <span class="download-menu-item">MMDダウンロード</span>
                </el-dropdown-item>
                <el-dropdown-item command="image">
                  <span class="download-menu-item">SVGダウンロード</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>

      <!-- Canvas -->
      <div
        class="canvas"
        :class="{ 'canvas-panning': isPanning, 'canvas-grab': treeData && !isPanning }"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="onMouseUp"
        @mouseleave="onMouseUp"
        @wheel.prevent="onWheel"
      >
        <!-- Empty state -->
        <div v-if="!treeData && !generating" class="canvas-empty">
          <div class="canvas-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
          </div>
          <p class="canvas-empty-title">スペックツリーはここに表示されます</p>
          <p class="canvas-empty-desc">ファイルをアップロードして「スペックツリーを生成」をクリックしてください</p>
        </div>

        <!-- Loading state -->
        <div v-if="generating" class="canvas-loading">
          <div class="loading-spinner"></div>
          <p class="loading-text">{{ generateProgressLabel }}</p>
        </div>

        <!-- Mermaid output -->
        <div
          v-if="treeData"
          class="canvas-content"
          :style="{
            transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
            transformOrigin: 'center center',
            transition: isPanning ? 'none' : 'transform 0.1s ease',
          }"
        >
          <div ref="mermaidContainer" class="mermaid-container"></div>
        </div>

        <!-- Zoom indicator -->
        <div v-if="treeData" class="zoom-indicator">{{ Math.round(zoom * 100) }}%</div>
      </div>
    </main>
    </div>

    <section v-else class="task-management-page">
      <div class="task-page-header">
        <div>
          <h2 class="task-page-title">スペックツリー タスク管理</h2>
          <p class="task-page-subtitle">現在のIP / 工場単位で生成タスクを確認します：{{ currentFactorySummary }}</p>
        </div>
        <div class="task-page-actions">
          <button type="button" class="btn btn-secondary btn-sm" @click="loadTaskJobs">
            更新
          </button>
          <el-dropdown
            trigger="click"
            :disabled="selectedCompletedJobs.length === 0"
            @command="handleBulkDownloadCommand"
          >
            <button class="btn btn-primary btn-sm" :disabled="selectedCompletedJobs.length === 0">
              選択した結果を一括ダウンロード
              <svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6,9 12,15 18,9" />
              </svg>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="excel">Excelエクスポート</el-dropdown-item>
                <el-dropdown-item command="csv">CSVエクスポート</el-dropdown-item>
                <el-dropdown-item command="mmd" divided>MMDダウンロード</el-dropdown-item>
                <el-dropdown-item command="image">SVGダウンロード</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>

      <div class="task-status-tabs">
        <button
          v-for="tab in SPEC_TREE_TASK_STATUS_TABS"
          :key="tab.key"
          type="button"
          class="task-status-tab"
          :class="{ active: activeTaskStatusTab === tab.key }"
          @click="activeTaskStatusTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>

      <div v-if="activeTaskStatusTab === 'completed'" class="completed-select-bar">
        <label class="completed-select-all">
          <input
            type="checkbox"
            :checked="allCompletedSelected"
            :disabled="completedTaskJobs.length === 0"
            @change="toggleAllCompletedJobs"
          />
          完了タスクをすべて選択
        </label>
        <span>{{ selectedCompletedJobs.length }} / {{ completedTaskJobs.length }} 件選択中</span>
      </div>

      <div class="task-list">
        <div v-if="filteredTaskJobs.length === 0" class="task-empty">
          該当するタスクはありません
        </div>
        <article
          v-for="job in filteredTaskJobs"
          :key="job.id"
          class="task-row"
          :class="{ active: activeJobId === job.id, expired: job.expired }"
        >
          <label class="task-checkbox" :class="{ disabled: !canOpenTaskResult(job) }">
            <input
              type="checkbox"
              :checked="selectedCompletedJobIds.includes(job.id)"
              :disabled="!canOpenTaskResult(job)"
              @change="toggleCompletedJobSelection(job)"
            />
          </label>
          <div class="task-main">
            <div class="task-row-top">
              <span class="task-status-badge" :class="taskStatusMeta(job.status).className">
                {{ taskStatusMeta(job.status).label }}
              </span>
              <strong class="task-title">{{ job.name }}</strong>
              <span v-if="job.cacheHit" class="task-cache-badge">既存結果利用</span>
            </div>
            <div class="task-progress-track">
              <div class="task-progress-fill" :style="{ width: taskProgress(job) + '%' }"></div>
            </div>
            <div class="task-row-meta">
              <span>{{ taskProgress(job) }}%</span>
              <span>{{ taskQueueLabel(job) }}</span>
              <span>{{ job.factory || '不明' }} / {{ job.ipAddress || 'IP未取得' }}</span>
              <span>{{ taskRetentionLabel(job) }}</span>
              <span>{{ job.timeLabel }}</span>
            </div>
          </div>
          <div class="task-row-actions">
            <button
              type="button"
              class="btn btn-outline btn-sm"
              :disabled="!canOpenTaskResult(job)"
              @click="onTaskSelect(job)"
            >
              結果表示
            </button>
            <button
              v-if="job.status === 'running' || job.status === 'queued'"
              type="button"
              class="btn btn-secondary btn-sm"
              @click="onTaskStop(job)"
            >
              中断
            </button>
            <button
              v-if="job.status === 'failed' || job.status === 'cancelled'"
              type="button"
              class="btn btn-secondary btn-sm"
              @click="onTaskRerun(job)"
            >
              リトライ
            </button>
            <el-dropdown
              trigger="click"
              :disabled="!canOpenTaskResult(job)"
              @command="handleTaskDownloadCommand"
            >
              <button class="btn btn-primary btn-sm" :disabled="!canOpenTaskResult(job)">
                ダウンロード
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item :command="`${job.id}:excel`">Excelエクスポート</el-dropdown-item>
                  <el-dropdown-item :command="`${job.id}:csv`">CSVエクスポート</el-dropdown-item>
                  <el-dropdown-item :command="`${job.id}:mmd`" divided>MMDダウンロード</el-dropdown-item>
                  <el-dropdown-item :command="`${job.id}:image`">SVGダウンロード</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
/* ── Page layout ─────────────────────────────────────────────────────────── */
.spec-tree-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  font-size: var(--font-size-base);
  font-family: "Noto Sans JP", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #f5f7fa;
}

.spec-tree-tabbar {
  display: flex;
  align-items: flex-end;
  gap: 0;
  height: 44px;
  padding: 0 28px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}

.spec-tree-tabbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 44px;
  padding: 0 18px;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  background: transparent;
  color: #475569;
  font-size: var(--font-size-base);
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  transition: color 0.15s, border-color 0.15s;

  &:hover {
    color: #1e293b;
  }

  &.active {
    color: var(--color-primary);
    border-bottom-color: var(--color-primary);
    font-weight: 600;
  }
}

.tab-count {
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: rgba(0, 118, 191, 0.12);
  color: #0076bf;
  font-size: 11px;
}

.spec-tree-workspace {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* ── Left panel ──────────────────────────────────────────────────────────── */
.left-panel {
  width: 288px;
  min-width: 288px;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border-right: 1px solid #e2e8f0;
  overflow-y: auto;
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
  flex: 1;
  padding: 16px;
  display: flex;
  flex-direction: column;
}

.section {
  margin-bottom: 16px;
}

.upload-section {
  margin-bottom: 8px;
}

.file-list-section {
  margin-bottom: 14px;
}

.section-label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: #1e293b;
  margin-bottom: 6px;
}

.section-label-count {
  font-weight: 400;
  color: #64748b;
  margin-left: 4px;
}

.section-desc {
  margin: -2px 0 8px;
  font-size: 11px;
  color: #94a3b8;
}

.required-mark {
  color: #ef4444;
  margin-left: 2px;
}

/* ── Upload zone ─────────────────────────────────────────────────────────── */
.upload-zone {
  position: relative;
  border: 2px dashed #cbd5e1;
  border-radius: 10px;
  padding: 20px 16px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;

  &:hover:not(.disabled) {
    border-color: rgba(0,118,191,0.5);
    background: #f8fafc;
  }

  &.dragging {
    border-color: #0076bf;
    background: rgba(0,118,191,0.04);
  }

  &.disabled {
    cursor: not-allowed;
    opacity: 0.65;
    background: #f8fafc;
  }

  &.disabled:hover {
    border-color: #cbd5e1;
    background: #f8fafc;
  }
}

.upload-icon {
  width: 28px;
  height: 28px;
  margin: 0 auto 8px;
  color: #94a3b8;
}

.upload-hint-primary {
  font-size: 12px;
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 10px;
  white-space: nowrap;
}

.upload-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
  flex-wrap: nowrap;
  width: 100%;
}

.file-count-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  background: #64748b;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
}

.upload-progress {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.progress-bar {
  height: 8px;
  background: #e2e8f0;
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: #0076bf;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 12px;
  color: #64748b;
}

/* File list */
.file-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.file-list-header .section-label {
  margin-bottom: 0;
}

.clear-files-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #64748b;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.2s ease;
  font-family: inherit;

  &:hover:not(:disabled) {
    border-color: #ef4444;
    background: #fff1f2;
    color: #ef4444;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  svg {
    width: 12px;
    height: 12px;
  }
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 192px;
  overflow-y: auto;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 34px;
  padding: 3px 8px 3px 5px;
  background: #f8fafc;
  border: 1px solid transparent;
  border-radius: 6px;
  transition: all 0.2s ease;
  cursor: pointer;

  &:hover {
    background: #ecf5ff;
  }

  &.file-item--root {
    background: #ecf5ff;
    border-color: #0076bf;
  }

  &.file-item--disabled {
    cursor: not-allowed;
  }
}

.root-toggle-indicator {
  width: 18px;
  height: 18px;
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  background: #ffffff;
  color: #94a3b8;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  font-family: inherit;

  &.selected {
    background: #0076bf;
    border-color: #0076bf;
    color: #ffffff;
    width: 28px;
    gap: 2px;
  }
}

.file-item:hover .root-toggle-indicator:not(.selected) {
  border-color: #0076bf;
  color: #0076bf;
}

.root-tree-icon {
  width: 9px;
  height: 9px;
  flex-shrink: 0;
}

.file-icon {
  width: 13px;
  height: 13px;
  color: #0076bf;
  flex-shrink: 0;
}

.file-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.file-name {
  font-size: 11px;
  line-height: 1.15;
  color: #1e293b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
}

.file-size {
  font-size: 10px;
  line-height: 1.1;
  color: #94a3b8;
}

.file-remove-btn {
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  background: transparent;
  color: #94a3b8;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.2s ease;

  svg {
    width: 11px;
    height: 11px;
  }

  &:hover:not(:disabled) {
    color: #ef4444;
    background: #fff1f2;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

/* Excel cards */
.excel-settings-section {
  margin-bottom: 14px;
}

.excel-settings-toggle {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #dbe3ee;
  border-radius: 6px;
  background: #ffffff;
  color: #1e293b;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;

  &:hover {
    border-color: #0076bf;
    background: #f8fafc;
  }
}

.excel-settings-title {
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.excel-settings-summary {
  flex: 1;
  min-width: 0;
  color: #64748b;
  font-size: 10px;
  line-height: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.excel-settings-chevron {
  width: 14px;
  height: 14px;
  color: #64748b;
  flex-shrink: 0;
  transition: transform 0.15s ease;

  &.open {
    transform: rotate(180deg);
  }
}

.excel-settings-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.excel-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: #ffffff;
  border-radius: 6px;
  border: 1px solid #dbe3ee;
}

.excel-icon {
  width: 18px;
  height: 18px;
  color: #0076bf;
  flex-shrink: 0;
}

.excel-info {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  gap: 2px;
}

.excel-name {
  font-size: 11px;
  font-weight: 700;
  color: #1e293b;
}

.excel-current {
  font-size: 10px;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.excel-button {
  flex-shrink: 0;
  min-height: 28px;
  height: 28px;
  padding: 0 10px;
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.2s ease;
  font-family: inherit;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &.btn-sm {
    min-height: 32px;
    padding: 6px 10px;
    font-size: 12px;
    border-radius: 6px;
  }

  &.btn-icon {
    width: 36px;
    height: 36px;
    padding: 0;
    border-radius: 6px;
  }

  &.btn-ghost {
    background: transparent;
    border: none;
    color: inherit;
  }

  &.btn-full {
    width: 100%;
  }
}

.btn-primary {
  background: #0076bf;
  color: #ffffff;

  &:hover:not(:disabled) {
    background: #005a9e;
  }
}

.btn-secondary {
  background: #ffffff;
  color: #64748b;
  border: 1px solid #e2e8f0;

  &:hover:not(:disabled) {
    background: #f8fafc;
  }
}

.btn-outline {
  background: #ffffff;
  color: #0076bf;
  border: 1px solid #0076bf;

  &:hover:not(:disabled) {
    background: #ecf5ff;
  }
}

.btn-danger {
  background: #ef4444;
  color: #ffffff;

  &:hover:not(:disabled) {
    background: #dc2626;
  }
}

.icon-sm {
  width: 18px;
  height: 18px;
}

.icon-xs {
  width: 16px;
  height: 16px;
}

.upload-btn {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
}

/* Status/Error messages */
.status-msg {
  margin-top: 12px;
  padding: 10px 14px;
  background: #f0f9eb;
  color: #22c55e;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.4;
}

.error-msg {
  margin-top: 12px;
  padding: 10px 14px;
  background: #fef2f2;
  color: #ef4444;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.4;
  display: flex;
  align-items: flex-start;
  gap: 8px;

  svg {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    margin-top: 1px;
  }
}

/* ── Task management ────────────────────────────────────────────────────── */
.task-management-page {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 20px;
  background: #f5f7fa;
}

.task-page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid #e2e8f0;
}

.task-page-title {
  margin: 0 0 4px;
  font-size: var(--font-size-page-title);
  font-weight: 700;
  color: #1e293b;
}

.task-page-subtitle {
  margin: 0;
  font-size: 13px;
  color: #64748b;
}

.task-page-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-status-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}

.task-status-tab {
  height: 32px;
  padding: 0 12px;
  border: 1px solid #dbe3ee;
  border-radius: 6px;
  background: #ffffff;
  color: #64748b;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;

  &:hover {
    background: #f8fafc;
  }

  &.active {
    border-color: #0076bf;
    background: #ecf5ff;
    color: #0076bf;
  }
}

.completed-select-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  padding: 10px 12px;
  border: 1px solid #dbe3ee;
  border-radius: 6px;
  background: #ffffff;
  color: #475569;
  font-size: 13px;
}

.completed-select-all {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-empty {
  padding: 36px;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  color: #94a3b8;
  text-align: center;
  font-size: 14px;
}

.task-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 14px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);

  &.active {
    border-color: #0076bf;
    box-shadow: 0 0 0 2px rgba(0, 118, 191, 0.08);
  }

  &.expired {
    opacity: 0.68;
  }
}

.task-checkbox {
  display: inline-flex;
  justify-content: center;

  &.disabled {
    opacity: 0.4;
  }
}

.task-main {
  min-width: 0;
}

.task-row-top {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-bottom: 8px;
}

.task-title {
  color: #1e293b;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-status-badge,
.task-cache-badge {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.task-cache-badge {
  background: #f0fdf4;
  color: #15803d;
}

.task-status-badge.queued {
  background: #eff6ff;
  color: #1d4ed8;
}

.task-status-badge.running {
  background: #fffbeb;
  color: #b45309;
}

.task-status-badge.completed {
  background: #f0fdf4;
  color: #15803d;
}

.task-status-badge.failed,
.task-status-badge.cancelled {
  background: #fef2f2;
  color: #b91c1c;
}

.task-progress-track {
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: #e2e8f0;
}

.task-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: #0076bf;
  transition: width 0.25s ease;
}

.task-row-meta {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 8px;
  color: #64748b;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-row-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
}

/* ── Right panel ─────────────────────────────────────────────────────────── */
.right-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
  min-width: 0;
}

/* Tree tabs */
.tree-tabs {
  display: flex;
  align-items: flex-end;
  gap: 0;
  min-height: 42px;
  padding: 0 16px;
  background: #ffffff;
  border-bottom: 1px solid #e4e7ed;
  overflow-x: auto;
  overflow-y: hidden;
  flex-shrink: 0;
}

.tree-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 220px;
  height: 42px;
  padding: 0 10px 0 14px;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  background: transparent;
  color: #475569;
  font-size: var(--font-size-base);
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  font-family: inherit;
  transition: color 0.15s, border-color 0.15s, background 0.15s;

  &:hover {
    color: #1e293b;
    background: #f8fafc;
  }

  &.active {
    color: var(--color-primary);
    border-bottom-color: var(--color-primary);
    font-weight: 600;
  }
}

.tree-tab-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tree-tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  color: #64748b;
  font-size: 14px;
  line-height: 1;
  flex-shrink: 0;

  &:hover {
    background: #e2e8f0;
    color: #1e293b;
  }
}

/* Toolbar */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 16px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  box-sizing: border-box;
  flex-shrink: 0;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-title {
  font-size: 14px;
  font-weight: 700;
  color: #1e293b;
}

.badge {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  background: #ecf5ff;
  color: #0076bf;
  border-radius: 100px;
  font-size: 10px;
  font-weight: 600;
}

.toolbar-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex-wrap: wrap;
}

.toolbar-divider {
  width: 1px;
  height: 16px;
  background: #e2e8f0;
  margin: 0 2px;
}

.toolbar .btn {
  min-height: 28px;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.toolbar .btn-primary {
  height: 32px;
  min-height: 32px;
  padding: 0 14px;
  border: 1px solid #0076bf;
  background: #0076bf;
  color: #ffffff;
}

.toolbar .btn-primary:hover:not(:disabled) {
  background: #0064a3;
  border-color: #0064a3;
}

.toolbar .btn-outline {
  background: #ffffff;
  color: #374151;
  border: 1px solid #d1d5db;
}

.toolbar .btn-outline:hover:not(:disabled) {
  background: #f8fafc;
  border-color: #9ca3af;
  color: #1f2937;
}

.toolbar .btn-icon {
  width: 28px;
  height: 28px;
  min-height: 28px;
  padding: 4px;
}

.toolbar .btn-icon svg {
  width: 16px;
  height: 16px;
}

/* Direction toggle */
.direction-toggle {
  display: inline-flex;
  height: 28px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  overflow: hidden;
}

.direction-btn {
  padding: 0 10px;
  font-size: 11px;
  font-weight: 500;
  border: none;
  background: #ffffff;
  color: #374151;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: inherit;

  &:hover {
    background: #f8fafc;
  }

  &.active {
    background: #0076bf;
    color: #ffffff;
  }
}

.direction-btn + .direction-btn {
  border-left: 1px solid #d1d5db;
}

.download-menu-item {
  font-size: 13px;
}

/* Canvas */
.canvas {
  flex: 1;
  position: relative;
  overflow: hidden;

  &.canvas-grab {
    cursor: grab;
  }

  &.canvas-panning {
    cursor: grabbing;
  }
}

.canvas-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  text-align: center;
}

.canvas-empty-icon {
  width: 80px;
  height: 80px;
  margin-bottom: 16px;
  opacity: 0.6;
  color: #0076bf;
}

.canvas-empty-title {
  font-size: var(--font-size-title);
  font-weight: 600;
  color: #475569;
  margin: 0 0 6px;
}

.canvas-empty-desc {
  font-size: 13px;
  color: #94a3b8;
  margin: 0;
  max-width: 400px;
  line-height: 1.5;
}

.canvas-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #475569;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #e4e7ed;
  border-top-color: #0076bf;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.loading-text {
  margin-top: 16px;
  font-size: 14px;
  color: #475569;
}

.canvas-content {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.mermaid-container {
  pointer-events: auto;
  padding: 20px;
}

.mermaid-error {
  padding: 20px;
  color: #ef4444;
}

.zoom-indicator {
  position: absolute;
  bottom: 16px;
  right: 16px;
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
}
</style>
