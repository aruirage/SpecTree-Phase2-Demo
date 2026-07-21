<script setup>
import { ref, computed, watch, nextTick, onActivated, onMounted } from 'vue';
import { ElSelect, ElOption, ElMessage } from 'element-plus';
import { useJobProgress } from '@/composables/useJobProgress';

defineOptions({ name: 'SpecTree' });

const SPEC_TREE_PROGRESS_STAGES = {
  submitting: { value: 5, cap: 12, label: '処理を準備中...' },
  queued: { value: 10, cap: 16, label: '待機中...' },
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
const rootFileId    = ref('');
const treeData      = ref(null); // { mmdContent, nodeCount }
const status        = ref('');
const error         = ref('');
const generating    = ref(false);
const direction     = ref('LR');   // 'LR' 横向き | 'TD' 縦向き
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

// Zoom / pan
const zoom   = ref(1);
const panX   = ref(0);
const panY   = ref(0);
const isPanning = ref(false);
let panStart = null;

// DOM refs
const fileInputRef       = ref(null);
const folderInputRef     = ref(null);
const mermaidContainer   = ref(null);
const MAX_IMAGE_EXPORT_SIDE = 12000;
const MAX_IMAGE_EXPORT_PIXELS = 80000000;
const MAX_UPLOAD_FILE_SIZE_MB = uploadFileSizeMb();
const MAX_UPLOAD_FILE_SIZE = MAX_UPLOAD_FILE_SIZE_MB * 1024 * 1024;
const FILE_SIZE_LIMIT_MESSAGE = `ファイルサイズが${MAX_UPLOAD_FILE_SIZE_MB}MBを超えています。${MAX_UPLOAD_FILE_SIZE_MB}MB以下のファイルをアップロードしてください。`;
const SPEC_TREE_RECOVERY_KEY = 'daikin.specTree.activeRun';
const UI_FONT_FAMILY = '"Noto Sans JP", sans-serif';
let generateAbortController = null;
let generateRequestSeq = 0;
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
function uploadFileSizeMb() {
  const mb = Number(import.meta.env.VITE_MAX_UPLOAD_FILE_SIZE_MB || 50);
  return Number.isFinite(mb) && mb > 0 ? mb : 50;
}

function formatBytes(bytes) {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
    console.error('Mermaid render error', e);
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

watch(rootFileId, () => {
  saveSpecTreeRecovery(generating.value);
});


// ── File upload ────────────────────────────────────────────────────────────
const SPEC_TREE_ACCEPTED_EXTENSIONS = ['.pdf', '.tif', '.tiff'];
const SPEC_TREE_ACCEPTED_MIME_TYPES = new Set(['application/pdf', 'image/tif', 'image/tiff']);

function isAcceptedSpecTreeFile(file) {
  const name = String(file?.name || '').toLowerCase();
  return SPEC_TREE_ACCEPTED_EXTENSIONS.some(ext => name.endsWith(ext)) || SPEC_TREE_ACCEPTED_MIME_TYPES.has(file?.type);
}

async function handleFiles(files) {
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
      let message = `アップロードに失敗しました (${res.status})`;
      try { const j = await res.json(); message = j.error || message; } catch {}
      throw new Error(message);
    }

    const data = await res.json();
    uploadProgress.value = 100;
    sessionId.value = data.sessionId;

    // Merge without duplicates
    const existing = new Map(uploadedFiles.value.map(f => [f.name, f]));
    data.files.forEach(f => existing.set(f.name, f));
    uploadedFiles.value = Array.from(existing.values());

    status.value = `${data.files.length} 件のファイルを認識しました`;
    saveSpecTreeRecovery(false);
  } catch (e) {
    error.value  = e instanceof Error ? e.message : 'アップロードに失敗しました。再試行してください';
    status.value = '';
    uploading.value = false;
    uploadProgress.value = 0;
  } finally {
    // 成功時は100%を少し見せてから消す
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

function onDragOver(e) { e.preventDefault(); isDragging.value = true; }
function onDragLeave()  { isDragging.value = false; }

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

function removeFile(id) {
  uploadedFiles.value = uploadedFiles.value.filter(f => f.id !== id);
  if (rootFileId.value === id) rootFileId.value = '';
  saveSpecTreeRecovery(false);
}

function clearUploadedFiles() {
  if (generating.value) return;
  uploadedFiles.value = [];
  rootFileId.value = '';
  status.value = '';
  error.value = '';
  uploading.value = false;
  uploadProgress.value = 0;
  saveSpecTreeRecovery(false);
}

// ── Generate ───────────────────────────────────────────────────────────────
async function handleGenerate() {
  if (!sessionId.value || !rootFileId.value) return;

  error.value    = '';
  status.value   = 'ファイルを解析中...';
  treeData.value = null;
  generating.value = true;
  saveSpecTreeRecovery(true);
  const requestSeq = ++generateRequestSeq;
  generateAbortController = new AbortController();
  startGenerateProgress(sessionId.value);

  try {
    const res = await fetch('/api/spec-tree/generate/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: generateAbortController.signal,
      body: JSON.stringify({ sessionId: sessionId.value, rootFileId: rootFileId.value }),
    });
    if (requestSeq !== generateRequestSeq) return;
    if (!res.ok) {
      let message = `生成に失敗しました (${res.status})`;
      try { const j = await res.json(); message = j.error || message; } catch {}
      throw new Error(message);
    }
    await res.json();
    const result = await waitForGeneratedSpecTreeResult({ waitMs: 0, pollMs: 3000, requestSeq });
    if (!result) throw new Error('スペックツリー結果が見つかりません');
    if (requestSeq !== generateRequestSeq) return;
    completeGenerateProgress();
    treeData.value = { mmdContent: result.mmdContent, nodeCount: result.nodeCount, treeNodes: result.treeNodes ?? [] };
    status.value = `スペックツリーの生成が完了しました。合計 ${result.nodeCount} ノード`;
    saveSpecTreeRecovery(false);
  } catch (e) {
    if (requestSeq !== generateRequestSeq || e?.name === 'AbortError') return;
    const recovered = await recoverGeneratedSpecTreeResult({ waitMs: 180000, pollMs: 3000 });
    if (recovered) {
      if (requestSeq !== generateRequestSeq) return;
      completeGenerateProgress();
      treeData.value = recovered;
      status.value = `スペックツリーの生成が完了しました。合計 ${recovered.nodeCount} ノード`;
      saveSpecTreeRecovery(false);
      return;
    }
    stopGenerateProgress({ reset: true });
    error.value  = e instanceof Error ? e.message : 'スペックツリーの生成に失敗しました。再試行してください';
    status.value = '';
  } finally {
    if (requestSeq === generateRequestSeq) {
      stopGenerateProgress();
      generating.value = false;
      generateAbortController = null;
      saveSpecTreeRecovery(false);
    }
  }
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
          return { mmdContent: result.mmdContent, nodeCount: result.nodeCount, treeNodes: result.treeNodes ?? [] };
        }
      }
    } catch {}
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, pollMs));
  } while (true);
  return null;
}

async function waitForGeneratedSpecTreeResult({ waitMs, pollMs, requestSeq = null }) {
  if (!sessionId.value) return null;
  const timeoutMs = Math.max(0, Number(waitMs) || 0);
  const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : null;
  let lastNetworkError = null;
  while (!deadline || Date.now() < deadline) {
    if (requestSeq != null && requestSeq !== generateRequestSeq) return null;
    let res = null;
    try {
      res = await fetch(`/api/spec-tree/result?sessionId=${encodeURIComponent(sessionId.value)}`, { cache: 'no-store' });
      lastNetworkError = null;
    } catch (e) {
      lastNetworkError = e;
      await new Promise(resolve => setTimeout(resolve, pollMs));
      continue;
    }
    if (res.ok) {
      const result = await res.json();
      if (result?.mmdContent) return result;
    } else if (res.status !== 202 && res.status !== 404) {
      let message = `生成に失敗しました (${res.status})`;
      try { const j = await res.json(); message = j.error || message; } catch {}
      throw new Error(message);
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  if (lastNetworkError) {
    throw new Error(`スペックツリー結果の取得がタイムアウトしました: ${lastNetworkError.message || 'fetch failed'}`);
  }
  throw new Error('スペックツリー生成がタイムアウトしました');
}

function handleStopGenerate() {
  if (!generating.value) return;
  generateRequestSeq += 1;
  generateAbortController?.abort();
  generateAbortController = null;
  stopGenerateProgress({ reset: true });
  generating.value = false;
  treeData.value = null;
  error.value = '';
  status.value = '処理を停止しました。ファイルを再アップロードできます。';
  saveSpecTreeRecovery(false);
  ElMessage.success('処理を停止しました');
  if (sessionId.value) {
    fetch('/api/spec-tree/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId.value }),
    }).catch(err => console.error('Cancel spec tree failed', err));
  }
}

// ── Export ─────────────────────────────────────────────────────────────────
function handleExport(format) {
  if (!sessionId.value) return;
  const ext = format === 'excel' ? 'xlsx' : 'csv';
  const a = document.createElement('a');
  a.href = `/api/spec-tree/export?format=${format}&sessionId=${sessionId.value}`;
  a.download = `spec-tree.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function handleDownloadCommand(command) {
  if (command === 'mmd') {
    if (!treeData.value?.mmdContent) {
      ElMessage.warning('保存できるMMDファイルがありません');
      return;
    }
    downloadBlob(new Blob([treeData.value.mmdContent], { type: 'text/plain;charset=utf-8' }), 'spec-tree.mmd');
    return;
  }
  if (command === 'excel' || command === 'csv') {
    handleExport(command);
    return;
  }
  if (command === 'image') {
    handleSaveTreeImage();
  }
}

async function handleSaveTreeImage() {
  const svgEl = mermaidContainer.value?.querySelector('svg');
  if (!svgEl) {
    ElMessage.warning('保存できるスペックツリー画像がありません');
    return;
  }

  const svgText = serializeTreeSvg(svgEl);
  const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });

  try {
    const pngBlob = await renderSvgBlobToPng(svgBlob, svgEl);
    downloadBlob(pngBlob, 'spec-tree.png');
  } catch (e) {
    console.error('Save spec tree image failed', e);
    downloadBlob(svgBlob, 'spec-tree.svg');
    ElMessage.success('SVG画像を保存しました');
  }
}

function serializeTreeSvg(svgEl) {
  const clone = svgEl.cloneNode(true);
  const { width, height } = getSvgSize(svgEl);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(Math.ceil(width)));
  clone.setAttribute('height', String(Math.ceil(height)));
  if (!clone.getAttribute('viewBox')) {
    clone.setAttribute('viewBox', `0 0 ${Math.ceil(width)} ${Math.ceil(height)}`);
  }
  embedSvgFontStyle(clone);
  return new XMLSerializer().serializeToString(clone);
}

function embedSvgFontStyle(svgEl) {
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = `
    svg, text, foreignObject, .nodeLabel, .label, .label div {
      font-family: ${UI_FONT_FAMILY};
    }
  `;
  svgEl.insertBefore(style, svgEl.firstChild);
}

async function renderSvgBlobToPng(svgBlob, svgEl) {
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = new Image();
    img.decoding = 'async';
    const { width, height } = getSvgSize(svgEl);

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('SVG画像の読み込みに失敗しました'));
      img.src = url;
    });

    const scale = getPngExportScale(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width * scale));
    canvas.height = Math.max(1, Math.ceil(height * scale));

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvasを初期化できません');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('PNG画像の生成に失敗しました'));
      }, 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function getPngExportScale(width, height) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const sideScale = Math.min(1, MAX_IMAGE_EXPORT_SIDE / safeWidth, MAX_IMAGE_EXPORT_SIDE / safeHeight);
  const pixelScale = Math.min(1, Math.sqrt(MAX_IMAGE_EXPORT_PIXELS / (safeWidth * safeHeight)));
  return Math.max(0.2, Math.min(2, sideScale, pixelScale));
}

function getSvgSize(svgEl) {
  const viewBox = svgEl.getAttribute('viewBox')?.split(/\s+/).map(Number);
  if (viewBox && viewBox.length === 4 && viewBox.every(Number.isFinite)) {
    return { width: Math.max(viewBox[2], 1), height: Math.max(viewBox[3], 1) };
  }
  const rect = svgEl.getBoundingClientRect();
  return { width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Zoom / Pan ─────────────────────────────────────────────────────────────
function onMouseDown(e) {
  if (e.button !== 0) return;
  isPanning.value = true;
  panStart = { x: e.clientX, y: e.clientY, px: panX.value, py: panY.value };
}
function onMouseMove(e) {
  if (!isPanning.value || !panStart) return;
  panX.value = panStart.px + (e.clientX - panStart.x);
  panY.value = panStart.py + (e.clientY - panStart.y);
}
function onMouseUp()   { isPanning.value = false; panStart = null; }
function onWheel(e) {
  e.preventDefault();
  const delta = e.deltaY < 0 ? 0.15 : -0.15;
  setZoom(zoom.value + delta);
}
function resetView()   { zoom.value = 1; panX.value = 0; panY.value = 0; }
function setZoom(value) {
  zoom.value = Number(Math.min(SPEC_TREE_MAX_ZOOM, Math.max(SPEC_TREE_MIN_ZOOM, value)).toFixed(3));
}

// ── Computed ───────────────────────────────────────────────────────────────
const canGenerate = computed(() =>
  !!sessionId.value &&
  !!rootFileId.value &&
  uploadedFiles.value.length > 0 &&
  !generating.value
);

function saveSpecTreeRecovery(isGenerating = generating.value) {
  if (!sessionId.value) {
    sessionStorage.removeItem(SPEC_TREE_RECOVERY_KEY);
    return;
  }
  sessionStorage.setItem(SPEC_TREE_RECOVERY_KEY, JSON.stringify({
    sessionId: sessionId.value,
    uploadedFiles: uploadedFiles.value,
    rootFileId: rootFileId.value,
    generating: Boolean(isGenerating),
    updatedAt: Date.now(),
  }));
}

function loadSpecTreeRecovery() {
  try {
    return JSON.parse(sessionStorage.getItem(SPEC_TREE_RECOVERY_KEY) || 'null');
  } catch {
    return null;
  }
}

async function restoreSpecTreeRecovery() {
  if (generating.value || treeData.value) return;
  const saved = loadSpecTreeRecovery();
  if (!saved?.sessionId) return;
  sessionId.value = saved.sessionId;
  uploadedFiles.value = Array.isArray(saved.uploadedFiles) ? saved.uploadedFiles : [];
  rootFileId.value = saved.rootFileId || '';
  if (!saved.generating) return;
  error.value = '';
  status.value = 'ファイルを解析中...';
  generating.value = true;
  const requestSeq = ++generateRequestSeq;
  startGenerateProgress(sessionId.value);
  try {
    const result = await waitForGeneratedSpecTreeResult({ waitMs: 0, pollMs: 3000, requestSeq });
    if (!result || requestSeq !== generateRequestSeq) return;
    completeGenerateProgress();
    treeData.value = { mmdContent: result.mmdContent, nodeCount: result.nodeCount, treeNodes: result.treeNodes ?? [] };
    status.value = `スペックツリーの生成が完了しました。合計 ${result.nodeCount} ノード`;
    saveSpecTreeRecovery(false);
  } catch (e) {
    if (requestSeq !== generateRequestSeq) return;
    stopGenerateProgress({ reset: true });
    error.value = e instanceof Error ? e.message : 'スペックツリー結果の復元に失敗しました';
    status.value = '';
    saveSpecTreeRecovery(false);
  } finally {
    if (requestSeq === generateRequestSeq) {
      stopGenerateProgress();
      generating.value = false;
    }
  }
}

onMounted(restoreSpecTreeRecovery);
onActivated(restoreSpecTreeRecovery);
</script>

<template>
  <div class="spec-tree-page">

    <!-- ── Left Panel ─────────────────────────────────────────────────── -->
    <aside class="left-panel">
      <div class="panel-header">
        <span class="panel-header-title">ファイル入力と設定</span>
      </div>

      <div class="panel-body">

        <!-- Upload zone -->
        <div class="section">
          <label class="section-label">ファイルのアップロード</label>
          <div
            class="upload-zone"
            :class="{ dragging: isDragging }"
            @dragover="onDragOver"
            @dragleave="onDragLeave"
            @drop="onDrop"
            @click="fileInputRef?.click()"
          >
            <input
              ref="fileInputRef"
              type="file"
              multiple
              accept=".pdf,.tif,.tiff,image/tif,image/tiff"
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
              style="display:none"
              @click.stop
              @change="onFolderInputChange"
            />
            <!-- Upload icon -->
            <svg class="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="16,16 12,12 8,16"/>
              <line x1="12" y1="12" x2="12" y2="21"/>
              <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
            </svg>
            <p class="upload-hint-primary">PDF対応·単一ファイル上限：{{ MAX_UPLOAD_FILE_SIZE_MB }}MB</p>
            <div class="upload-actions">
              <button
                class="btn btn-primary btn-sm upload-btn"
                @click.stop="fileInputRef?.click()"
              >ファイル選択</button>
              <button
                class="btn btn-outline btn-sm upload-btn"
                @click.stop="folderInputRef?.click()"
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
        <div v-if="uploadedFiles.length > 0" class="section">
          <div class="file-list-header">
            <label class="section-label">
              認識済みファイル
              <span class="section-label-count">({{ uploadedFiles.length }})</span>
            </label>
            <button
              class="clear-files-btn"
              type="button"
              :disabled="generating"
              title="アップロード済みファイルをクリア"
              @click="clearUploadedFiles"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3,6 5,6 21,6"/>
                <path d="M8,6V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"/>
                <path d="M19,6l-1,14a2,2 0 0,1 -2,2H8a2,2 0 0,1 -2,-2L5,6"/>
                <line x1="10" y1="11" x2="10" y2="17"/>
                <line x1="14" y1="11" x2="14" y2="17"/>
              </svg>
              クリア
            </button>
          </div>
          <div class="file-list">
            <div v-for="file in uploadedFiles" :key="file.id" class="file-item">
              <svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="#0076bf" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14,2 14,8 20,8"/>
              </svg>
              <div class="file-info">
                <span class="file-name" :title="file.name">{{ file.name }}</span>
                <span class="file-size">{{ formatBytes(file.size) }}</span>
              </div>
              <button class="file-remove-btn" @click="removeFile(file.id)" title="削除">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        <!-- Root file selector -->
        <div v-if="uploadedFiles.length > 0" class="section">
          <label class="section-label">
            ルートノードを選択
            <span class="required-mark">*</span>
          </label>
          <p class="section-desc">最上位（ルート）となる仕様書ファイルを指定してください</p>
          <ElSelect
            v-model="rootFileId"
            placeholder="ルート仕様ファイルを選択..."
            class="root-select"
            size="small"
          >
            <ElOption
              v-for="file in uploadedFiles"
              :key="file.id"
              :value="file.id"
              :label="file.name"
            />
          </ElSelect>
        </div>

        <!-- Generate button -->
        <button
          class="btn btn-primary btn-full"
          :disabled="!canGenerate"
          @click="handleGenerate"
        >
          <template v-if="generating">
            运行中
          </template>
          <template v-else>
            <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="6" y1="3" x2="6" y2="15"/>
              <circle cx="18" cy="6" r="3"/>
              <circle cx="6" cy="18" r="3"/>
              <path d="M18 9a9 9 0 0 1-9 9"/>
            </svg>
            スペックツリーを生成
          </template>
        </button>

        <button
          v-if="generating"
          class="btn btn-danger btn-full"
          @click="handleStopGenerate"
        >
          <svg class="icon-sm" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2"/>
          </svg>
          停止
        </button>

        <!-- Status -->
        <div v-if="status && !error" class="status-msg">{{ generating ? generateProgressLabel : status }}</div>

        <!-- Error -->
        <div v-if="error" class="error-msg">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>{{ error }}</span>
        </div>

      </div>
    </aside>

    <!-- ── Right Panel ─────────────────────────────────────────────────── -->
    <div class="right-panel">

      <!-- Toolbar -->
      <div class="toolbar">
        <div class="toolbar-left">
          <span class="toolbar-title">スペックツリー可視化</span>
          <span v-if="treeData" class="badge badge-secondary">{{ treeData.nodeCount }} ノード</span>
        </div>
        <div class="toolbar-right">
          <template v-if="treeData">
            <button class="btn btn-outline btn-icon" title="拡大" @click="setZoom(zoom + 0.2)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
              </svg>
            </button>
            <button class="btn btn-outline btn-icon" title="縮小" @click="setZoom(zoom - 0.2)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                <line x1="8" y1="11" x2="14" y2="11"/>
              </svg>
            </button>
            <button class="btn btn-outline btn-icon" title="ビューをリセット" @click="resetView">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15,3 21,3 21,9"/><polyline points="9,21 3,21 3,15"/>
                <path d="M21 3l-7 7M3 21l7-7"/>
              </svg>
            </button>
            <!-- Direction toggle — same group as zoom controls -->
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
          <el-dropdown
            trigger="click"
            :disabled="!treeData"
            @command="handleDownloadCommand"
          >
            <button class="btn btn-primary btn-sm" :disabled="!treeData">
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
                <el-dropdown-item command="mmd" divided>
                  <span class="download-menu-item">MMDダウンロ-ド</span>
                </el-dropdown-item>
                <el-dropdown-item command="image">
                  <span class="download-menu-item">SVGダウンロ-ド</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>

      <!-- Canvas -->
      <div
        class="canvas"
        :style="{ cursor: isPanning ? 'grabbing' : treeData ? 'grab' : 'default' }"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="onMouseUp"
        @mouseleave="onMouseUp"
        @wheel.prevent="onWheel"
      >
        <!-- Empty state -->
        <div v-if="!treeData && !generating" class="canvas-empty">
          <div class="canvas-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="#0076bf" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="6" y1="3" x2="6" y2="15"/>
              <circle cx="18" cy="6" r="3"/>
              <circle cx="6" cy="18" r="3"/>
              <path d="M18 9a9 9 0 0 1-9 9"/>
            </svg>
          </div>
          <p class="canvas-empty-title">スペックツリーはここに表示されます</p>
          <p class="canvas-empty-desc">ファイルをアップロードしてスペックツリーを生成すると、結果がここに表示されます。</p>
        </div>

        <!-- Loading state -->
        <div v-if="generating" class="canvas-loading">
          <div
            class="run-progress"
            role="progressbar"
            aria-label="スペックツリー生成の進捗"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="generateProgress"
          >
            <div class="run-progress-header">
              <span class="canvas-loading-text">{{ generateProgressLabel }}</span>
              <strong class="run-progress-value">{{ generateProgress }}%</strong>
            </div>
            <div class="run-progress-track">
              <div class="run-progress-fill" :style="{ width: `${generateProgress}%` }"></div>
            </div>
            <p v-if="generateProgressSummary" class="run-progress-summary">{{ generateProgressSummary }}</p>
          </div>
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

    </div>
  </div>

</template>

<style scoped lang="scss">
/* ── Page layout ─────────────────────────────────────────────────────────── */
.spec-tree-page {
  display: flex;
  height: 100%;
  overflow: hidden;
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
  font-size: 14px;
  font-weight: 700;
  color: #1e293b;
}

.panel-body {
  flex: 1;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* ── Sections ────────────────────────────────────────────────────────────── */
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

.required-mark {
  color: #ef4444;
  margin-left: 2px;
}

.section-desc {
  font-size: 11px;
  color: #64748b;
  margin: 0 0 6px;
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

  &:hover { border-color: rgba(0,118,191,0.5); background: #f8fafc; }
  &.dragging { border-color: #0076bf; background: rgba(0,118,191,0.04); }
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
  margin: 0 0 2px;
}

.upload-hint-secondary {
  font-size: 11px;
  color: #64748b;
  margin: 0 0 10px;
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
  border-radius: 999px;
  padding: 1px 6px;
}

/* ── Progress ────────────────────────────────────────────────────────────── */
.upload-progress {
  margin-top: 8px;
}

.progress-bar {
  height: 4px;
  background: #e2e8f0;
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: #0076bf;
  border-radius: 2px;
  transition: width 0.2s ease;
}

.progress-text {
  font-size: 10px;
  color: #64748b;
  margin-top: 3px;
  display: block;
}

/* ── File list ───────────────────────────────────────────────────────────── */
.file-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;

  .section-label {
    margin-bottom: 0;
  }
}

.clear-files-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #ffffff;
  color: #64748b;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;

  svg {
    width: 12px;
    height: 12px;
  }

  &:hover:not(:disabled) {
    border-color: #ef4444;
    background: #fff5f5;
    color: #ef4444;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 192px;
  overflow-y: auto;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  background: #f8fafc;

  &:hover .file-remove-btn { opacity: 1; }
}

.file-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.file-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.file-name {
  font-size: 11px;
  font-weight: 600;
  color: #1e293b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-size {
  font-size: 10px;
  color: #94a3b8;
}

.file-remove-btn {
  opacity: 0;
  transition: opacity 0.15s;
  background: none;
  border: none;
  cursor: pointer;
  color: #94a3b8;
  padding: 0;
  display: flex;
  align-items: center;

  svg { width: 12px; height: 12px; }
  &:hover { color: #ef4444; }
}

/* ── Root select ─────────────────────────────────────────────────────────── */
.root-select {
  width: 100%;
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

/* ── Right panel ─────────────────────────────────────────────────────────── */
.right-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
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
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.toolbar-title {
  font-size: 14px;
  font-weight: 700;
  color: #1e293b;
}

.toolbar-divider {
  width: 1px;
  height: 16px;
  background: #e2e8f0;
  margin: 0 2px;
}

/* ── Canvas ──────────────────────────────────────────────────────────────── */
.canvas {
  flex: 1;
  overflow: hidden;
  position: relative;
  background: #f8fafc;
  user-select: none;
}

.canvas-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 32px;
}

.canvas-empty-icon {
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

.canvas-empty-title {
  font-size: 14px;
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 6px;
}

.canvas-empty-desc {
  font-size: 12px;
  color: #64748b;
  max-width: 320px;
  margin: 0;
}

.canvas-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.canvas-loading-text {
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

.canvas-content {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mermaid-container {
  max-width: 100%;
  overflow: visible;
  font-family: "Noto Sans JP", sans-serif;
}

.mermaid-container :deep(svg) {
  display: block;
  max-width: none;
  overflow: visible;
  font-family: "Noto Sans JP", sans-serif;
}

.mermaid-container :deep(.node rect),
.mermaid-container :deep(.node polygon),
.mermaid-container :deep(.node circle),
.mermaid-container :deep(.node ellipse) {
  stroke-width: 1.25px;
}

.mermaid-container :deep(.nodeLabel),
.mermaid-container :deep(.label),
.mermaid-container :deep(.label foreignObject),
.mermaid-container :deep(.label div) {
  line-height: 1.35;
  white-space: normal;
  font-family: "Noto Sans JP", sans-serif;
}

.mermaid-container :deep(.nodeLabel),
.mermaid-container :deep(.label) {
  font-size: 12px;
}

.zoom-indicator {
  position: absolute;
  bottom: 16px;
  right: 16px;
  background: rgba(255,255,255,0.9);
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 11px;
  font-family: "Noto Sans JP", sans-serif;
  color: #64748b;
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

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
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

.btn-sm    { font-size: 13px; }
.btn-full  { width: 100%; }
.btn-icon  { padding: 4px; width: 28px; height: 28px; }

.download-menu-item {
  display: inline-flex;
  align-items: center;
  min-width: 132px;
}

.upload-btn {
  flex: 1 1 0;
  min-width: 0;
  margin-top: 4px;
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
}

.badge-secondary {
  background: #f1f5f9;
  color: #475569;
}

.icon-sm {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}

.icon-xs {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}

/* ── Direction toggle ────────────────────────────────────────────────────── */
.direction-toggle {
  display: flex;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  overflow: hidden;
}

.direction-btn {
  background: #fff;
  color: #374151;
  border: none;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;

  & + & {
    border-left: 1px solid #d1d5db;
  }

  &.active {
    background: #0076bf;
    color: #fff;
  }

  &:not(.active):hover {
    background: #f1f5f9;
  }
}

/* ── Spin animation ──────────────────────────────────────────────────────── */
@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

.spin {
  animation: spin 0.8s linear infinite;
}

</style>
