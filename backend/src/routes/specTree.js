import { Router } from 'express';
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
} from '../store.js';

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

function fileMeta(file) {
  return {
    id: nextId('file'),
    name: file.originalname,
    size: file.size,
    mimeType: file.mimetype,
    uploadedAt: new Date().toISOString(),
  };
}

function resolveRootFileIds(body = {}) {
  const { rootFileId, rootFileIds } = body;
  if (Array.isArray(rootFileIds) && rootFileIds.length > 0) {
    return [...new Set(rootFileIds.filter(Boolean))];
  }
  if (rootFileId) return [rootFileId];
  return [];
}

function ensureSpecTreeSession(sessionId) {
  if (!sessionId) return null;
  const existing = store.specTreeSessions.get(sessionId);
  if (existing) return existing;
  if (!String(sessionId).startsWith('st-')) return null;

  const session = createSpecTreeSession([], { sessionId });
  const job = store.jobs.find((item) => item.sessionId === sessionId);
  if (job?.status === 'completed') {
    session.result = createSpecTreeResult();
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

function startSpecTreeJobs(sourceSession, rootIds, { clientRunId, factory, ipAddress } = {}) {
  const entries = createSpecTreeJobsForRoots(sourceSession, rootIds);
  const isBatch = rootIds.length > 1;
  const started = [];

  for (let i = 0; i < entries.length; i += 1) {
    const { job, session: targetSession, rootFileId } = entries[i];
    const runId = !isBatch && clientRunId ? clientRunId : nextId('run');
    
    // キャッシュをチェック
    const files = targetSession.files || [];
    const cached = getCachedResult('spec_tree', files, { rootFileId });
    
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
        site: factory || '不明',
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
      targetSession.factory = factory || '不明';
      targetSession.ipAddress = ipAddress;
      job.factory = factory || '不明';
      job.ipAddress = ipAddress;
      
      enqueueTask({
        type: 'spec_tree',
        session: targetSession,
        files,
        options: { rootFileId },
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

router.put('/upload/documents', upload.array('files'), (req, res) => {
  const files = (req.files || []).map(fileMeta);
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

router.put('/upload/supplement', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file is required' });
  const { ipAddress, factory } = getClientInfo(req);
  
  store.excelConfig.supplement = {
    ...fileMeta(req.file),
    fileName: req.file.originalname,
  };
  appendSystemEvent({
    site: factory,
    ipAddress: ipAddress,
    actionType: 'Excel変更',
    feature: 'スペックツリー',
    pages: 0,
    detail: '補完リスト',
    operator: 'demo-user',
    note: req.file.originalname,
  });
  res.json(store.excelConfig.supplement);
});

router.put('/upload/deletion', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file is required' });
  const { ipAddress, factory } = getClientInfo(req);
  
  store.excelConfig.deletion = {
    ...fileMeta(req.file),
    fileName: req.file.originalname,
  };
  appendSystemEvent({
    site: factory,
    ipAddress: ipAddress,
    actionType: 'Excel変更',
    feature: 'スペックツリー',
    pages: 0,
    detail: '削除対象リスト',
    operator: 'demo-user',
    note: req.file.originalname,
  });
  res.json(store.excelConfig.deletion);
});

router.post('/jobs', (req, res) => {
  const { sessionId } = req.body || {};
  const rootIds = resolveRootFileIds(req.body);
  const session = store.specTreeSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'session not found' });
  if (rootIds.length === 0) return res.status(400).json({ error: 'rootFileId or rootFileIds is required' });

  const { ipAddress, factory } = getClientInfo(req);
  const jobs = startSpecTreeJobs(session, rootIds, { factory, ipAddress });
  res.status(202).json({
    jobs,
    jobId: jobs[0]?.jobId,
    runId: jobs[0]?.runId,
    sessionId: jobs[0]?.sessionId,
  });
});

// ── Phase 1 compatible routes (existing frontend) ─────────────────────────

router.post('/upload', upload.array('files'), (req, res) => {
  const files = (req.files || []).map(fileMeta);
  const session = createSpecTreeSession(files);
  res.json({ sessionId: session.sessionId, files });
});

router.post('/generate/start', (req, res) => {
  const { sessionId, clientRunId } = req.body || {};
  const rootIds = resolveRootFileIds(req.body);
  const session = ensureSpecTreeSession(sessionId);
  if (!session) return res.status(404).json({ error: 'session not found', code: 404 });
  if (rootIds.length === 0) {
    return res.status(400).json({ error: 'rootFileId or rootFileIds is required', code: 400 });
  }

  try {
    const { ipAddress, factory } = getClientInfo(req);
    const jobs = startSpecTreeJobs(session, rootIds, { clientRunId, factory, ipAddress });
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
  const content = format === 'excel'
    ? 'Spec Number,Spec Name,Level\nM000378,ASTM A36,0\nASTM A572,Grade 50,1'
    : 'spec_number,spec_name,level\nM000378,ASTM A36,0\nASTM A572,Grade 50,1';
  const mime = format === 'excel'
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'text/csv';
  const ext = format === 'excel' ? 'xlsx' : 'csv';
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `attachment; filename="spec-tree.${ext}"`);
  res.send(content);
});

export default router;
