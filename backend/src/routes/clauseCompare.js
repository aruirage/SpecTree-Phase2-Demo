import { Router } from 'express';
import ExcelJS from 'exceljs';
import multer from 'multer';
import {
  addJob,
  cancelSessionRun,
  createClauseCompareSession,
  nextId,
  startClauseCompareRun,
  store,
  getCachedResult,
  cacheResult,
  enqueueTask,
  getFactoryFromIP,
  appendSystemEvent,
} from '../store.js';

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();
const REPORT_COLUMNS = [
  { header: '【旧】項', key: 'oldClauseNumber', width: 10 },
  { header: '【旧】記載内容', key: 'oldContent', width: 42 },
  { header: '【旧】日本語訳（参考）', key: 'oldTranslation', width: 38 },
  { header: '【旧】画像', key: 'oldImageLabel', width: 14 },
  { header: '【新】項', key: 'newClauseNumber', width: 10 },
  { header: '【新】記載内容', key: 'newContent', width: 42 },
  { header: '【新】日本語訳（参考）', key: 'newTranslation', width: 38 },
  { header: '【新】画像', key: 'newImageLabel', width: 14 },
  { header: '比較区分', key: 'status', width: 12 },
];
const COLORS = {
  header: 'FF1E3A5F',
  subHeader: 'FF2D5282',
  border: 'FFD9E2EC',
  deletedFill: 'FFE5E7EB',
  addedFill: 'FFDCFCE7',
  deletedText: 'FFDC2626',
  addedText: 'FF0076BF',
  changedOldText: 'FFDC2626',
  changedNewText: 'FF0076BF',
  bodyText: 'FF334155',
};

function getOrCreateSession(sessionId) {
  if (sessionId && store.clauseCompareSessions.has(sessionId)) {
    return store.clauseCompareSessions.get(sessionId);
  }
  return createClauseCompareSession();
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

function firstImageLabel(images = []) {
  return Array.isArray(images) && images.length > 0 ? images[0].label || '画像あり' : '';
}

function clauseToReportRow(clause) {
  return {
    oldClauseNumber: clause.oldClauseNumber || '',
    oldContent: clause.oldContent || '',
    oldTranslation: clause.oldTranslation || '',
    oldImageLabel: firstImageLabel(clause.oldImages),
    newClauseNumber: clause.newClauseNumber || '',
    newContent: clause.newContent || '',
    newTranslation: clause.newTranslation || '',
    newImageLabel: firstImageLabel(clause.newImages),
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

function applyBodyCellStyle(cell, status, key) {
  const isOldField = key.startsWith('old') && key !== 'oldClauseNumber' && key !== 'oldImageLabel';
  const isNewField = key.startsWith('new') && key !== 'newClauseNumber' && key !== 'newImageLabel';
  cell.alignment = { vertical: 'top', wrapText: true };
  cell.font = { name: 'Meiryo', size: 10, color: { argb: COLORS.bodyText } };
  applyCellBorder(cell);

  if (status === '削除') {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.deletedFill } };
    if (isOldField) {
      cell.font = { ...cell.font, color: { argb: COLORS.deletedText }, strike: true };
    }
    return;
  }

  if (status === '追加') {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.addedFill } };
    if (isNewField) {
      cell.font = { ...cell.font, color: { argb: COLORS.addedText } };
    }
    return;
  }

  if (status === '変更') {
    if (isOldField) {
      cell.font = { ...cell.font, color: { argb: COLORS.changedOldText }, strike: true };
    }
    if (isNewField) {
      cell.font = { ...cell.font, color: { argb: COLORS.changedNewText } };
    }
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

  sheet.mergeCells('A1:D1');
  sheet.mergeCells('E1:H1');
  sheet.getCell('A1').value = '【旧】REV';
  sheet.getCell('E1').value = '【新】REV';
  sheet.getCell('I1').value = '比較区分';
  sheet.getCell('I1').alignment = { vertical: 'middle', horizontal: 'center' };

  ['A1', 'E1', 'I1'].forEach((address) => {
    const cell = sheet.getCell(address);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.header } };
    cell.font = { name: 'Meiryo', bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    applyCellBorder(cell);
  });

  sheet.getRow(2).values = REPORT_COLUMNS.map((column) => column.header.replace(/^【[旧新]】/, ''));
  sheet.getRow(2).eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.subHeader } };
    cell.font = { name: 'Meiryo', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    applyCellBorder(cell);
  });

  sheet.columns = REPORT_COLUMNS.map((column) => ({
    key: column.key,
    width: column.width,
  }));

  result.clauses.map(clauseToReportRow).forEach((rowData) => {
    const row = sheet.addRow(rowData);
    row.height = rowData.status === '削除' || rowData.status === '追加' ? 46 : 58;
    REPORT_COLUMNS.forEach((column, index) => {
      applyBodyCellStyle(row.getCell(index + 1), rowData.status, column.key);
    });
  });

  return workbook;
}

router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file is required' });
  const fileType = req.body.fileType || 'old';
  const session = getOrCreateSession(req.body.sessionId);
  const file = {
    fileId: nextId('file'),
    fileName: req.file.originalname,
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
  const session = store.clauseCompareSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'session not found' });
  if (!session.oldFile || !session.newFile) {
    return res.status(400).json({ error: 'both files required' });
  }
  const { ipAddress, factory } = getClientInfo(req);
  const accepted = beginRun(session, clientRunId, factory, ipAddress);
  res.status(202).json(accepted);
});

router.post('/run', (req, res) => {
  const { sessionId } = req.body || {};
  const session = store.clauseCompareSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'session not found' });
  const { ipAddress, factory } = getClientInfo(req);
  const accepted = beginRun(session, null, factory, ipAddress);
  res.status(202).json(accepted);
});

router.get('/progress', (req, res) => {
  const session = store.clauseCompareSessions.get(req.query.sessionId);
  if (!session) return res.status(404).json({ error: 'session not found' });
  res.json({ running: session.progress.running, ...session.progress });
});

router.get('/result', (req, res) => {
  const session = store.clauseCompareSessions.get(req.query.sessionId);
  if (!session) return res.status(404).json({ error: 'session not found', code: 404 });
  if (session.run?.status === 'cancelled') {
    return res.status(404).json({ error: 'cancelled', code: 499 });
  }
  if (!session.result) return res.status(202).json({ status: 'processing' });
  res.json(session.result);
});

router.post('/cancel', (req, res) => {
  const { sessionId, runId } = req.body || {};
  const session = store.clauseCompareSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'session not found' });
  if (session.run && runId && session.run.runId !== runId) {
    return res.status(409).json({ error: 'run mismatch' });
  }
  cancelSessionRun(session);
  res.json({ ok: true });
});

router.get('/export', (req, res) => {
  const session = store.clauseCompareSessions.get(req.query.sessionId);
  if (!session?.result) return res.status(404).json({ error: 'no result' });
  const format = req.query.format || 'csv';
  if (format === 'excel') {
    return buildClauseCompareWorkbook(session.result)
      .then((workbook) => workbook.xlsx.writeBuffer())
      .then((buffer) => {
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="clause-comparison.xlsx"');
        res.send(Buffer.from(buffer));
      })
      .catch((err) => {
        res.status(500).json({ error: err.message || 'excel export failed' });
      });
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="clause-comparison.csv"');
  res.send(buildClauseCompareCsv(session.result));
});

router.get('/images/export', (req, res) => {
  const session = store.clauseCompareSessions.get(req.query.sessionId);
  if (!session?.result) return res.status(404).json({ error: 'no result' });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="clause-images.zip"');
  res.send(Buffer.from('PK\x03\x04mock-zip-demo', 'utf8'));
});

export default router;
