import { Router } from 'express';
import ExcelJS from 'exceljs';
import multer from 'multer';
import {
  appendSystemEvent,
  cancelSessionRun,
  createSpecTreeJobsForRoots,
  createSpecTreeResult,
  createSpecTreeSession,
  nextId,
  refreshSessionRun,
  startSpecTreeRun,
  store,
  getCachedResult,
  cacheResult,
  enqueueTask,
  getFactoryFromIP,
  normalizeExtractionTemplate,
} from '../store.js';
import { normalizeUploadedFileName } from '../utils/fileNames.js';

const MB = 1024 * 1024;
const SPEC_TREE_FILE_SIZE_LIMIT_MB = 30;
const EXCEL_FILE_SIZE_LIMIT_MB = 5;
const specTreeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SPEC_TREE_FILE_SIZE_LIMIT_MB * MB },
});
const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: EXCEL_FILE_SIZE_LIMIT_MB * MB },
});
const router = Router();
const EXPORT_FONT_NAME = 'Noto Sans JP';
const SPEC_TREE_EXPORT_ROWS = [
  { specNo: 'M000378', level: 0, specName: 'SHAFT, LPT CONE', revision: 'C' },
  { specNo: 'ISAJT-P3TF2', level: 1, specName: 'FLUORESCENT PENETRANT INSPECTION (FPI)', revision: 'S29' },
  { specNo: 'MIL-C-5541', level: 2, specName: 'Chromate Coating', revision: '', changeType: '削除' },
  { specNo: 'MIL-C-13924', level: 3, specName: 'Black Oxide Coating', revision: '' },
  { specNo: 'MIL-STD-792', level: 3, specName: 'Identification Marking Requirements for Special Purpose Components', revision: '' },
  { specNo: '8311253', level: 2, specName: 'Fluorescent Penetrant Inspection (FPI) Standards', revision: '' },
  { specNo: 'D50TF8', level: 2, specName: 'Temporary Marking Materials for Engine Components', revision: '' },
  { specNo: 'P2TF1', level: 2, specName: 'Regulated Materials', revision: '' },
  { specNo: 'P3TF41', level: 2, specName: 'Control of Nondestructive Inspection Standards', revision: '' },
  { specNo: 'P3TF45', level: 2, specName: 'Types of Records to be Retained for NDE (Nondestructive Evaluation)', revision: '' },
  { specNo: 'ISAJT-P4TF2', level: 2, specName: 'Etching of Superalloys', revision: 'S15', changeType: '補完' },
  { specNo: 'AMS 5596', level: 3, specName: 'Nickel Alloy, Corrosion and Heat Resistant, Sheet, Strip, and Plate', revision: '' },
  { specNo: 'ARP 1755', level: 3, specName: 'Effect of Cleaning Methods on Aircraft Engine Materials, Stock Loss Test Method', revision: '' },
  { specNo: 'P2TF1', level: 3, specName: 'Regulated Materials', revision: '' },
  { specNo: 'P4TF3', level: 2, specName: 'Cleaning of Titanium', revision: '' },
  { specNo: 'ISAJT-P4TF8', level: 2, specName: 'Swab Etching', revision: 'S6' },
];

function withInheritedChangeTypes(rows = []) {
  const inheritedChangeTypes = [];
  return rows.map((row) => {
    const level = Math.max(0, Number(row.level) || 0);
    inheritedChangeTypes.length = level + 1;
    const inheritedChangeType = inheritedChangeTypes[level - 1] || '';
    const changeType = row.changeType || inheritedChangeType || '';
    inheritedChangeTypes[level] = changeType;
    return { ...row, changeType };
  });
}

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
  return String(fileName || 'root').replace(/\.[^.]+$/, '');
}

function safeDownloadName(fileName) {
  return String(fileName || 'download').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
}

function contentDisposition(fileName) {
  const encoded = encodeURIComponent(fileName);
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function rootSpecNameForSession(session) {
  const rootFile = (session?.files || []).find((file) => file.id === session.rootFileId);
  const fallbackFile = (session?.files || [])[0];
  return baseName(rootFile?.name || rootFile?.fileName || fallbackFile?.name || fallbackFile?.fileName || session?.rootFileId || 'root');
}

function specTreeDownloadBaseName(session) {
  return safeDownloadName(`st_${rootSpecNameForSession(session)}_${timestampForFileName()}`);
}

function fileMeta(file) {
  const fileName = normalizeUploadedFileName(file.originalname);
  return {
    id: nextId('file'),
    name: fileName,
    size: file.size,
    mimeType: file.mimetype,
    uploadedAt: new Date().toISOString(),
  };
}

function fileMetaFromPayload(file) {
  const fileName = normalizeUploadedFileName(file?.name || file?.fileName || file?.originalname || 'upload.pdf');
  return {
    id: nextId('file'),
    name: fileName,
    size: Number(file?.size || 0),
    mimeType: file?.mimeType || file?.type || 'application/octet-stream',
    uploadedAt: new Date().toISOString(),
  };
}

function validateFileSize(files = [], limitMb, res) {
  const overLimit = files.find((file) => Number(file.size || 0) > limitMb * MB);
  if (!overLimit) return true;
  res.status(413).json({
    code: 'UPLOAD_FILE_SIZE_LIMIT',
    error: `file size must be ${limitMb}MB or less`,
  });
  return false;
}

function specTreeFilesFromRequest(req) {
  const payloadFiles = Array.isArray(req.body?.files) ? req.body.files : [];
  if (payloadFiles.length > 0) return payloadFiles.map(fileMetaFromPayload);
  return (req.files || []).map(fileMeta);
}

function excelFileFromRequest(req) {
  if (req.file) {
    return {
      ...fileMeta(req.file),
      fileName: normalizeUploadedFileName(req.file.originalname),
    };
  }
  const payload = req.body?.file;
  if (!payload) return null;
  const meta = fileMetaFromPayload(payload);
  return {
    ...meta,
    fileName: meta.name,
  };
}

function applyExportBorder(cell) {
  cell.border = {
    top: { style: 'thin', color: { argb: 'FF1F2937' } },
    left: { style: 'thin', color: { argb: 'FF1F2937' } },
    bottom: { style: 'thin', color: { argb: 'FF1F2937' } },
    right: { style: 'thin', color: { argb: 'FF1F2937' } },
  };
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

async function buildSpecTreeWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Phase2 Demo Mock Backend';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('スペックツリー');
  sheet.columns = [
    { header: 'スペックNo', key: 'specNo', width: 28 },
    { header: '階層', key: 'level', width: 10 },
    { header: 'スペック名称', key: 'specName', width: 86 },
    { header: '改訂記号', key: 'revision', width: 12 },
    { header: '区分', key: 'changeType', width: 12 },
  ];

  sheet.getRow(1).height = 24;
  sheet.getRow(1).eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF003B7A' } };
    cell.font = { name: EXPORT_FONT_NAME, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    applyExportBorder(cell);
  });

  withInheritedChangeTypes(SPEC_TREE_EXPORT_ROWS).forEach((rowData) => {
    const row = sheet.addRow(rowData);
    row.height = 18;
    row.eachCell((cell, colNumber) => {
      cell.font = { name: EXPORT_FONT_NAME, size: 9, color: { argb: 'FF111827' } };
      cell.alignment = {
        vertical: 'middle',
        horizontal: colNumber === 2 || colNumber === 4 || colNumber === 5 ? 'center' : 'left',
        wrapText: colNumber === 3,
        indent: colNumber === 1 ? Math.max(0, Number(rowData.level) || 0) : 0,
      };
      applyExportBorder(cell);
    });
  });

  return workbook;
}

function resolveRootFileIds(body = {}) {
  const { rootFileId, rootFileIds } = body;
  if (Array.isArray(rootFileIds) && rootFileIds.length > 0) {
    return [...new Set(rootFileIds.filter(Boolean))];
  }
  if (rootFileId) return [rootFileId];
  return [];
}

function resolveTemplateByRootFileId(body = {}) {
  const entries = Array.isArray(body.templateAssignments) ? body.templateAssignments : [];
  return Object.fromEntries(entries.map((entry) => [
    entry.rootFileId,
    normalizeExtractionTemplate(entry),
  ]).filter(([rootFileId]) => Boolean(rootFileId)));
}

function ensureSpecTreeSession(sessionId) {
  if (!sessionId) return null;
  const existing = store.specTreeSessions.get(sessionId);
  if (existing) return existing;
  if (!String(sessionId).startsWith('st-')) return null;

  const session = createSpecTreeSession([], { sessionId });
  const job = store.jobs.find((item) => item.sessionId === sessionId);
  if (job?.status === 'completed') {
    session.result = createSpecTreeResult(job);
    session.run = {
      runId: nextId('run'),
      jobId: job.id,
      type: 'spec_tree',
      status: 'completed',
      startedAt: Date.now(),
    };
    session.progress = { running: false, stage: 'succeeded', progress: 100 };
  }
  return session;
}

function startSpecTreeJobs(sourceSession, rootIds, {
  clientRunId,
  factory,
  ipAddress,
  templateByRootFileId = {},
} = {}) {
  sourceSession.templateByRootFileId = {
    ...(sourceSession.templateByRootFileId || {}),
    ...templateByRootFileId,
  };
  const entries = createSpecTreeJobsForRoots(sourceSession, rootIds);
  const isBatch = rootIds.length > 1;
  const started = [];

  for (let i = 0; i < entries.length; i += 1) {
    const { job, session: targetSession, rootFileId } = entries[i];
    const runId = !isBatch && clientRunId ? clientRunId : nextId('run');
    
    // キャッシュをチェック
    const files = targetSession.files || [];
    const template = normalizeExtractionTemplate(targetSession.templateByRootFileId?.[rootFileId]);
    const cached = getCachedResult('spec_tree', files, {
      rootFileId,
      templateId: template.templateId,
      templateVersion: template.templateVersion,
    });
    
    if (cached) {
      // キャッシュヒット！結果を直接返す
      job.status = 'completed';
      job.progress = 100;
      job.updatedAt = new Date().toISOString();
      
      // セッションにキャッシュ結果をセット
      targetSession.result = cached.result;
      targetSession.run = { runId, jobId: job.id, status: 'completed', startedAt: Date.now() };
      targetSession.progress = { running: false, stage: 'succeeded' };
      
      appendSystemEvent({
        site: factory || '安来工場',
        ipAddress: ipAddress,
        actionType: 'キャッシュヒット',
        feature: 'スペックツリー',
        pages: 0,
        detail: 'ツリー作成',
        operator: 'system',
        note: `キャッシュから再利用: ${cached.sessionId}`,
      });
      
      started.push({
        jobId: job.id,
        runId,
        sessionId: targetSession.sessionId,
        rootFileId,
        cacheHit: true,
        cachedSessionId: cached.sessionId,
      });
    } else {
      // キャッシュにないのでタスクをキューに追加
      targetSession.factory = factory || '安来工場';
      targetSession.ipAddress = ipAddress;
      targetSession.selectedTemplate = template;
      job.factory = factory || '安来工場';
      job.ipAddress = ipAddress;
      
      enqueueTask({
        type: 'spec_tree',
        session: targetSession,
        files,
        options: {
          rootFileId,
          templateId: template.templateId,
          templateVersion: template.templateVersion,
        },
        factory,
        ipAddress,
        runId,
        jobId: job.id,
      });
      
      job.status = 'queued';
      job.progress = 0;
      job.updatedAt = new Date().toISOString();
      
      started.push({
        jobId: job.id,
        runId,
        sessionId: targetSession.sessionId,
        rootFileId,
        cacheHit: false,
      });
    }
  }

  return started;
}

// ── Phase 2 design routes ─────────────────────────────────────────────────

router.get('/excel', (_req, res) => {
  res.json({
    supplement: store.excelConfig.supplement,
    deletion: store.excelConfig.deletion,
  });
});

router.put('/upload/documents', specTreeUpload.array('files'), (req, res) => {
  const files = specTreeFilesFromRequest(req);
  if (!validateFileSize(files, SPEC_TREE_FILE_SIZE_LIMIT_MB, res)) return;
  const session = createSpecTreeSession(files);
  res.json({ sessionId: session.sessionId, files });
});

// クライアントIPから工場情報を取得するヘルパー
function getClientInfo(req) {
  const clientIP = req.ip || req.connection.remoteAddress || '127.0.0.1';
  const xForwardedFor = req.headers['x-forwarded-for'];
  const ipAddress = xForwardedFor ? xForwardedFor.split(',')[0].trim() : clientIP;
  const factory = getFactoryFromIP(ipAddress);
  return { ipAddress, factory };
}

router.put('/upload/supplement', excelUpload.single('file'), (req, res) => {
  const file = excelFileFromRequest(req);
  if (!file) return res.status(400).json({ error: 'file is required' });
  if (!validateFileSize([file], EXCEL_FILE_SIZE_LIMIT_MB, res)) return;
  const { ipAddress, factory } = getClientInfo(req);
  
  store.excelConfig.supplement = file;
  appendSystemEvent({
    site: factory,
    ipAddress: ipAddress,
    actionType: 'Excel変更',
    feature: 'スペックツリー',
    pages: 0,
    detail: '補完リスト',
    operator: 'demo-user',
    note: store.excelConfig.supplement.fileName,
  });
  res.json(store.excelConfig.supplement);
});

router.put('/upload/deletion', excelUpload.single('file'), (req, res) => {
  const file = excelFileFromRequest(req);
  if (!file) return res.status(400).json({ error: 'file is required' });
  if (!validateFileSize([file], EXCEL_FILE_SIZE_LIMIT_MB, res)) return;
  const { ipAddress, factory } = getClientInfo(req);
  
  store.excelConfig.deletion = file;
  appendSystemEvent({
    site: factory,
    ipAddress: ipAddress,
    actionType: 'Excel変更',
    feature: 'スペックツリー',
    pages: 0,
    detail: '削除対象リスト',
    operator: 'demo-user',
    note: store.excelConfig.deletion.fileName,
  });
  res.json(store.excelConfig.deletion);
});

router.post('/jobs', (req, res) => {
  const { sessionId } = req.body || {};
  const rootIds = resolveRootFileIds(req.body);
  const templateByRootFileId = resolveTemplateByRootFileId(req.body);
  const session = store.specTreeSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'session not found' });
  if (rootIds.length === 0) return res.status(400).json({ error: 'rootFileId or rootFileIds is required' });

  const { ipAddress, factory } = getClientInfo(req);
  const jobs = startSpecTreeJobs(session, rootIds, { factory, ipAddress, templateByRootFileId });
  res.status(202).json({
    jobs,
    jobId: jobs[0]?.jobId,
    runId: jobs[0]?.runId,
    sessionId: jobs[0]?.sessionId,
  });
});

// ── Phase 1 compatible routes (existing frontend) ─────────────────────────

router.post('/upload', specTreeUpload.array('files'), (req, res) => {
  const files = specTreeFilesFromRequest(req);
  if (!validateFileSize(files, SPEC_TREE_FILE_SIZE_LIMIT_MB, res)) return;
  const session = createSpecTreeSession(files);
  res.json({ sessionId: session.sessionId, files });
});

router.post('/generate/start', (req, res) => {
  const { sessionId, clientRunId } = req.body || {};
  const rootIds = resolveRootFileIds(req.body);
  const templateByRootFileId = resolveTemplateByRootFileId(req.body);
  const session = ensureSpecTreeSession(sessionId);
  if (!session) return res.status(404).json({ error: 'session not found', code: 404 });
  if (rootIds.length === 0) {
    return res.status(400).json({ error: 'rootFileId or rootFileIds is required', code: 400 });
  }

  try {
    const { ipAddress, factory } = getClientInfo(req);
    const jobs = startSpecTreeJobs(session, rootIds, { clientRunId, factory, ipAddress, templateByRootFileId });
    const first = jobs[0];
    res.status(202).json({
      jobs,
      jobId: first?.jobId,
      runId: first?.runId,
      sessionId: first?.sessionId,
      rootFileId: first?.rootFileId,
      rootFileIds: rootIds,
      cacheHit: first?.cacheHit,
    });
  } catch (e) {
    return res.status(409).json({ error: e.message, code: e.code || 'CONFLICT' });
  }
});

router.get('/progress', (req, res) => {
  const session = ensureSpecTreeSession(req.query.sessionId);
  if (!session) return res.status(404).json({ error: 'session not found' });
  refreshSessionRun(session);
  res.json({ running: session.progress.running, ...session.progress });
});

router.get('/excel', (req, res) => {
  res.json({
    supplement: store.excelConfig.supplement,
    deletion: store.excelConfig.deletion,
  });
});

router.get('/result', (req, res) => {
  const session = ensureSpecTreeSession(req.query.sessionId);
  if (!session) return res.status(404).json({ error: 'session not found', code: 404 });
  refreshSessionRun(session);
  if (session.run?.status === 'cancelled') {
    return res.status(404).json({ error: 'cancelled', code: 499 });
  }
  if (!session.result) {
    return res.status(202).json({ status: 'processing' });
  }
  res.json(session.result);
});

router.post('/cancel', (req, res) => {
  const { sessionId, runId } = req.body || {};
  const session = ensureSpecTreeSession(sessionId);
  if (!session) return res.status(404).json({ error: 'session not found' });
  if (session.run && runId && session.run.runId !== runId) {
    return res.status(409).json({ error: 'run mismatch' });
  }
  cancelSessionRun(session);
  res.json({ ok: true });
});

router.get('/export', (req, res) => {
  const { format = 'csv', sessionId } = req.query;
  const session = ensureSpecTreeSession(sessionId);
  if (!session?.result) return res.status(404).json({ error: 'no result' });
  const downloadBaseName = specTreeDownloadBaseName(session);
  if (format === 'excel') {
    return buildSpecTreeWorkbook()
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

  const rows = [
    ['スペックNo', '階層', 'スペック名称', '改訂記号', '区分'],
    ...withInheritedChangeTypes(SPEC_TREE_EXPORT_ROWS).map((row) => [row.specNo, row.level, row.specName, row.revision, row.changeType || '']),
  ];
  const csv = `\ufeff${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', contentDisposition(`${downloadBaseName}.csv`));
  res.send(csv);
});

router.use((err, _req, res, next) => {
  if (!(err instanceof multer.MulterError)) {
    next(err);
    return;
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({
      code: 'UPLOAD_FILE_SIZE_LIMIT',
      error: 'uploaded file is too large',
    });
    return;
  }
  res.status(400).json({ code: err.code, error: err.message });
});

export default router;
