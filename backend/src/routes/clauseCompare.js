import { Router } from 'express';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import multer from 'multer';
import {
  addJob,
  cancelSessionRun,
  createClauseCompareResult,
  createClauseCompareSession,
  nextId,
  refreshSessionRun,
  startClauseCompareRun,
  store,
  getCachedResult,
  cacheResult,
  enqueueTask,
  getFactoryFromIP,
  appendSystemEvent,
} from '../store.js';
import { normalizeUploadedFileName } from '../utils/fileNames.js';

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();
const EXPORT_FONT_NAME = 'Noto Sans JP';
const REPORT_COLUMNS = [
  { header: '【旧】項', key: 'oldClauseNumber', width: 10 },
  { header: '【旧】記載内容', key: 'oldContent', width: 42 },
  { header: '【旧】日本語訳（参考）', key: 'oldTranslation', width: 34 },
  { header: '【新】項', key: 'newClauseNumber', width: 10 },
  { header: '【新】記載内容', key: 'newContent', width: 42 },
  { header: '【新】日本語訳（参考）', key: 'newTranslation', width: 34 },
  { header: '比較区分', key: 'status', width: 12 },
];
const COLORS = {
  header: 'FF1E3A5F',
  subHeader: 'FF2D5282',
  border: 'FFD9E2EC',
  deletedFill: 'FFE5E7EB',
  addedFill: 'FFE6F6D8',
  deletedText: 'FFDC2626',
  addedText: 'FF0076BF',
  changedOldText: 'FFDC2626',
  changedNewText: 'FF0076BF',
  bodyText: 'FF334155',
};
const MAX_TOKEN_DIFF_CELLS = 24_000;
const BODY_FONT = { name: EXPORT_FONT_NAME, size: 10, color: { argb: COLORS.bodyText } };

function timestampForFileName(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join('');
}

function baseName(fileName = '') {
  return String(fileName || 'result').replace(/\.[^.]+$/, '');
}

function safeDownloadName(fileName) {
  return String(fileName || 'download').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
}

function contentDisposition(fileName) {
  const encoded = encodeURIComponent(fileName);
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function clauseDownloadBaseName(session) {
  return safeDownloadName(`comp_${baseName(session?.newFile?.fileName || 'new')}_${timestampForFileName()}`);
}

function imageBufferFromDataUrl(dataUrl = '') {
  const [, payload = ''] = String(dataUrl).split(',');
  return Buffer.from(decodeURIComponent(payload), 'utf8');
}

function imageFileName(prefix, index) {
  return `${prefix} 画像${index}.png`;
}

async function buildClauseImagesZip(result) {
  const zip = new JSZip();
  const newFolder = zip.folder('new')?.folder('Images');
  const oldFolder = zip.folder('old')?.folder('Images');
  let newIndex = 1;
  let oldIndex = 1;

  for (const clause of result.clauses || []) {
    for (const image of clause.newImages || []) {
      newFolder?.file(imageFileName('新', newIndex), imageBufferFromDataUrl(image.url));
      newIndex += 1;
    }
    for (const image of clause.oldImages || []) {
      oldFolder?.file(imageFileName('旧', oldIndex), imageBufferFromDataUrl(image.url));
      oldIndex += 1;
    }
  }

  return zip.generateAsync({ type: 'nodebuffer' });
}

function getOrCreateSession(sessionId) {
  if (sessionId && store.clauseCompareSessions.has(sessionId)) {
    return store.clauseCompareSessions.get(sessionId);
  }
  if (sessionId && String(sessionId).startsWith('cc-')) {
    return createClauseCompareSession({ sessionId });
  }
  return createClauseCompareSession();
}

function ensureClauseCompareSession(sessionId) {
  if (!sessionId) return null;
  const existing = store.clauseCompareSessions.get(sessionId);
  if (existing) return existing;
  if (!String(sessionId).startsWith('cc-')) return null;

  const session = createClauseCompareSession({ sessionId });
  const job = store.jobs.find((item) => item.sessionId === sessionId);
  if (job?.status === 'completed') {
    session.result = createClauseCompareResult();
    session.run = {
      runId: nextId('run'),
      jobId: job.id,
      type: 'clause_compare',
      status: 'completed',
      startedAt: Date.now(),
    };
    session.progress = { running: false, stage: 'succeeded', progress: 100 };
  }
  return session;
}

// クライアントIPから工場情報を取得するヘルパー
function getClientInfo(req) {
  const clientIP = req.ip || req.connection.remoteAddress || '127.0.0.1';
  const xForwardedFor = req.headers['x-forwarded-for'];
  const ipAddress = xForwardedFor ? xForwardedFor.split(',')[0].trim() : clientIP;
  const factory = getFactoryFromIP(ipAddress);
  return { ipAddress, factory };
}

function normalizeStatus(clause) {
  const status = String(clause.status || '').trim();
  if (status === '追加' || status === '削除' || status === '変更' || status === '無') return status;
  if (status === '有') {
    if (!clause.oldContent && clause.newContent) return '追加';
    if (clause.oldContent && !clause.newContent) return '削除';
    return '変更';
  }
  return status || '無';
}

function clauseToReportRow(clause) {
  return {
    oldClauseNumber: clause.oldClauseNumber || '',
    oldContent: clause.oldContent || '',
    oldTranslation: clause.oldTranslation || '',
    newClauseNumber: clause.newClauseNumber || '',
    newContent: clause.newContent || '',
    newTranslation: clause.newTranslation || '',
    status: normalizeStatus(clause),
  };
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function buildClauseCompareCsv(result) {
  const rows = [
    REPORT_COLUMNS.map((column) => column.header),
    ...result.clauses.map((clause) => {
      const row = clauseToReportRow(clause);
      return REPORT_COLUMNS.map((column) => row[column.key]);
    }),
  ];
  return `\ufeff${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}`;
}

function applyCellBorder(cell) {
  cell.border = {
    top: { style: 'thin', color: { argb: COLORS.border } },
    left: { style: 'thin', color: { argb: COLORS.border } },
    bottom: { style: 'thin', color: { argb: COLORS.border } },
    right: { style: 'thin', color: { argb: COLORS.border } },
  };
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

function normalizeTokenForDiff(token) {
  return String(token || '')
    .replace(/([A-Za-z0-9])\s*-\s*([A-Za-z0-9])/g, '$1-$2')
    .toLocaleLowerCase();
}

function tokensEqualForDiff(a, b) {
  if (a === b) return true;
  if (isWhitespaceToken(a) && isWhitespaceToken(b)) return true;
  return normalizeTokenForDiff(a) === normalizeTokenForDiff(b);
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

function segmentFont(segment, side) {
  if (side === 'old' && segment.type === 'removed') {
    return { ...BODY_FONT, color: { argb: COLORS.changedOldText }, strike: true };
  }
  if (side === 'new' && segment.type === 'added') {
    return { ...BODY_FONT, color: { argb: COLORS.changedNewText } };
  }
  return BODY_FONT;
}

function applyRichDiff(cell, segments, side) {
  cell.value = {
    richText: segments.map((segment) => ({
      text: segment.text,
      font: segmentFont(segment, side),
    })),
  };
}

function applyBodyCellStyle(cell, status, key) {
  cell.alignment = { vertical: 'top', wrapText: true };
  cell.font = BODY_FONT;
  applyCellBorder(cell);

  if (status === '削除') {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.deletedFill } };
    return;
  }

  if (status === '追加') {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.addedFill } };
    return;
  }
}

async function buildClauseCompareWorkbook(result) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Phase2 Demo Mock Backend';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('条項比較', {
    views: [{ state: 'frozen', ySplit: 2 }],
    properties: { defaultRowHeight: 38 },
  });

  sheet.mergeCells('A1:C1');
  sheet.mergeCells('D1:F1');
  sheet.mergeCells('G1:G2');
  sheet.getCell('A1').value = '【旧】REV';
  sheet.getCell('D1').value = '【新】REV';
  sheet.getCell('G1').value = '比較区分';
  sheet.getCell('G1').alignment = { vertical: 'middle', horizontal: 'center' };

  ['A1', 'D1', 'G1'].forEach((address) => {
    const cell = sheet.getCell(address);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.header } };
    cell.font = { name: EXPORT_FONT_NAME, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    applyCellBorder(cell);
  });

  REPORT_COLUMNS.slice(0, 6).forEach((column, index) => {
    sheet.getRow(2).getCell(index + 1).value = column.header.replace(/^【[旧新]】/, '');
  });
  for (let colNumber = 1; colNumber <= 6; colNumber += 1) {
    const cell = sheet.getRow(2).getCell(colNumber);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.subHeader } };
    cell.font = { name: EXPORT_FONT_NAME, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    applyCellBorder(cell);
  }

  sheet.columns = REPORT_COLUMNS.map((column) => ({
    key: column.key,
    width: column.width,
  }));

  result.clauses.forEach((clause) => {
    const rowData = clauseToReportRow(clause);
    const row = sheet.addRow(rowData);
    row.height = rowData.status === '削除' || rowData.status === '追加' ? 46 : 58;
    REPORT_COLUMNS.forEach((column, index) => {
      applyBodyCellStyle(row.getCell(index + 1), rowData.status, column.key);
    });
    if (rowData.status === '変更' && rowData.oldContent && rowData.newContent) {
      const contentSegments = buildTokenDiffSegments(rowData.oldContent, rowData.newContent);
      applyRichDiff(row.getCell(2), contentSegments.old, 'old');
      applyRichDiff(row.getCell(5), contentSegments.new, 'new');
    }
    if (rowData.status === '変更' && rowData.oldTranslation && rowData.newTranslation) {
      const translationSegments = buildTokenDiffSegments(rowData.oldTranslation, rowData.newTranslation);
      applyRichDiff(row.getCell(3), translationSegments.old, 'old');
      applyRichDiff(row.getCell(6), translationSegments.new, 'new');
    }
  });

  return workbook;
}

router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file is required' });
  const fileType = req.body.fileType || 'old';
  const session = getOrCreateSession(req.body.sessionId);
  const fileName = normalizeUploadedFileName(req.file.originalname);
  const file = {
    fileId: nextId('file'),
    fileName,
    fileType,
    size: req.file.size,
    mimeType: req.file.mimetype,
  };
  if (fileType === 'new') session.newFile = file;
  else session.oldFile = file;
  res.json({
    sessionId: session.sessionId,
    fileId: file.fileId,
    fileName: file.fileName,
    fileType,
  });
});

function beginRun(session, clientRunId, factory, ipAddress) {
  session.oldFile ||= {
    fileId: 'file-old-restored',
    fileName: 'old.pdf',
    fileType: 'old',
    size: 0,
    mimeType: 'application/pdf',
  };
  session.newFile ||= {
    fileId: 'file-new-restored',
    fileName: 'new.pdf',
    fileType: 'new',
    size: 0,
    mimeType: 'application/pdf',
  };

  const files = [];
  if (session.oldFile) files.push(session.oldFile);
  if (session.newFile) files.push(session.newFile);
  
  // キャッシュをチェック
  const cached = getCachedResult('clause_compare', files);
  
  if (cached) {
    // キャッシュヒット
    const job = addJob({
      type: 'clause_compare',
      title: `${session.oldFile?.fileName || 'old'} vs ${session.newFile?.fileName || 'new'}`,
      sessionId: session.sessionId,
      factory,
      ipAddress,
      cacheHit: true,
    });
    job.status = 'completed';
    job.progress = 100;
    job.updatedAt = new Date().toISOString();
    
    session.result = cached.result;
    const runId = clientRunId || nextId('run');
    session.run = { runId, jobId: job.id, status: 'completed', startedAt: Date.now() };
    session.progress = { running: false, stage: 'succeeded' };
    
    appendSystemEvent({
      site: factory || '不明',
      ipAddress: ipAddress,
      actionType: 'キャッシュヒット',
      feature: '条項比較',
      pages: 0,
      detail: '差分抽出',
      operator: 'system',
      note: `キャッシュから再利用: ${cached.sessionId}`,
    });
    
    return { 
      runId, 
      jobId: job.id, 
      sessionId: session.sessionId,
      cacheHit: true,
      cachedSessionId: cached.sessionId,
    };
  }
  
  // キャッシュなし → キューに追加
  const job = addJob({
    type: 'clause_compare',
    title: `${session.oldFile?.fileName || 'old'} vs ${session.newFile?.fileName || 'new'}`,
    sessionId: session.sessionId,
    factory,
    ipAddress,
  });
  const runId = clientRunId || nextId('run');
  
  session.factory = factory || '不明';
  session.ipAddress = ipAddress;
  
  enqueueTask({
    type: 'clause_compare',
    session,
    files,
    options: {},
    factory,
    ipAddress,
    runId,
    jobId: job.id,
  });
  
  job.status = 'queued';
  job.progress = 0;
  job.updatedAt = new Date().toISOString();
  
  return { 
    runId, 
    jobId: job.id, 
    sessionId: session.sessionId,
    cacheHit: false,
  };
}

router.post('/run/start', (req, res) => {
  const { sessionId, clientRunId } = req.body || {};
  const session = ensureClauseCompareSession(sessionId);
  if (!session) return res.status(404).json({ error: 'session not found' });
  const { ipAddress, factory } = getClientInfo(req);
  const accepted = beginRun(session, clientRunId, factory, ipAddress);
  res.status(202).json(accepted);
});

router.post('/run', (req, res) => {
  const { sessionId } = req.body || {};
  const session = ensureClauseCompareSession(sessionId);
  if (!session) return res.status(404).json({ error: 'session not found' });
  const { ipAddress, factory } = getClientInfo(req);
  const accepted = beginRun(session, null, factory, ipAddress);
  res.status(202).json(accepted);
});

router.get('/progress', (req, res) => {
  const session = ensureClauseCompareSession(req.query.sessionId);
  if (!session) return res.status(404).json({ error: 'session not found' });
  refreshSessionRun(session);
  res.json({ running: session.progress.running, ...session.progress });
});

router.get('/result', (req, res) => {
  const session = ensureClauseCompareSession(req.query.sessionId);
  if (!session) return res.status(404).json({ error: 'session not found', code: 404 });
  refreshSessionRun(session);
  if (session.run?.status === 'cancelled') {
    return res.status(404).json({ error: 'cancelled', code: 499 });
  }
  if (!session.result) return res.status(202).json({ status: 'processing' });
  res.json(session.result);
});

router.post('/cancel', (req, res) => {
  const { sessionId, runId } = req.body || {};
  const session = ensureClauseCompareSession(sessionId);
  if (!session) return res.status(404).json({ error: 'session not found' });
  if (session.run && runId && session.run.runId !== runId) {
    return res.status(409).json({ error: 'run mismatch' });
  }
  cancelSessionRun(session);
  res.json({ ok: true });
});

router.get('/export', (req, res) => {
  const session = ensureClauseCompareSession(req.query.sessionId);
  if (!session?.result) return res.status(404).json({ error: 'no result' });
  const format = req.query.format || 'csv';
  const downloadBaseName = clauseDownloadBaseName(session);
  if (format === 'excel') {
    return buildClauseCompareWorkbook(session.result)
      .then((workbook) => workbook.xlsx.writeBuffer())
      .then((buffer) => {
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', contentDisposition(`${downloadBaseName}.xlsx`));
        res.send(Buffer.from(buffer));
      })
      .catch((err) => {
        res.status(500).json({ error: err.message || 'excel export failed' });
      });
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', contentDisposition(`${downloadBaseName}.csv`));
  res.send(buildClauseCompareCsv(session.result));
});

router.get('/images/export', (req, res) => {
  const session = ensureClauseCompareSession(req.query.sessionId);
  if (!session?.result) return res.status(404).json({ error: 'no result' });
  buildClauseImagesZip(session.result)
    .then((buffer) => {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', contentDisposition(`${clauseDownloadBaseName(session)}.zip`));
      res.send(buffer);
    })
    .catch((err) => {
      res.status(500).json({ error: err.message || 'image export failed' });
    });
});

export default router;
