import { Router } from 'express';
import {
  addJob,
  appendSystemEvent,
  cancelSessionRun,
  cloneSpecTreeSession,
  createClauseCompareSession,
  enqueueTask,
  getFactoryFromIP,
  nextId,
  normalizeClientIP,
  refreshWorkQueue,
  store,
} from '../store.js';

const router = Router();

const VALID_JOB_TYPES = new Set(['spec_tree', 'clause_compare']);
const VALID_SCOPES = new Set(['active', 'history']);
const ACTIVE_STATUSES = new Set(['running', 'queued']);
const HISTORY_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function getClientContext(req) {
  if (req.clientContext) return req.clientContext;
  const clientIP = req.ip || req.connection.remoteAddress || '127.0.0.1';
  const xForwardedFor = req.headers['x-forwarded-for'];
  const ipAddress = normalizeClientIP(xForwardedFor ? xForwardedFor.split(',')[0].trim() : clientIP);
  return {
    ipAddress,
    factory: getFactoryFromIP(ipAddress),
  };
}

function getRetention(job) {
  const fallbackUpdatedAt = Date.parse(job.updatedAt || job.createdAt || new Date().toISOString());
  const expiresAt = job.retentionExpiresAt
    ? new Date(job.retentionExpiresAt)
    : new Date(fallbackUpdatedAt + store.license.retentionDays * 24 * 60 * 60 * 1000);
  const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  return {
    retentionExpiresAt: expiresAt.toISOString(),
    retentionDaysLeft: Math.max(0, daysLeft),
    expired: daysLeft <= 0,
  };
}

function getQueuePositions(type) {
  const queue = store.jobs
    .filter((j) => j.type === type && ACTIVE_STATUSES.has(j.status))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return new Map(queue.map((job, index) => [job.id, index + 1]));
}

function enrichJob(job, context, queuePositions) {
  const factory = job.factory || context.factory;
  const ipAddress = job.ipAddress || context.ipAddress;
  return {
    ...job,
    factory,
    ipAddress,
    queuePosition: queuePositions.get(job.id) || null,
    ...getRetention(job),
  };
}

function filterJobs({ type, scope, context }) {
  let jobs = store.jobs
    .filter((j) => j.type === type)
    .filter((j) => !j.ipAddress || normalizeClientIP(j.ipAddress) === context.ipAddress);
  if (scope === 'active') {
    jobs = jobs.filter((j) => ACTIVE_STATUSES.has(j.status));
  } else if (scope === 'history') {
    // History must never include queued/running jobs.
    jobs = jobs.filter((j) => HISTORY_STATUSES.has(j.status));
  }
  const queuePositions = getQueuePositions(type);
  return jobs
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .map((job) => enrichJob(job, context, queuePositions));
}

function getSessionForJob(job) {
  if (job.type === 'spec_tree') return store.specTreeSessions.get(job.sessionId);
  if (job.type === 'clause_compare') return store.clauseCompareSessions.get(job.sessionId);
  return null;
}

function getTaskFiles(job, session) {
  if (job.type === 'spec_tree') return session?.files || [];
  return [session?.oldFile, session?.newFile].filter(Boolean);
}

function removeQueuedTask(jobId) {
  const before = store.taskQueue.length;
  store.taskQueue = store.taskQueue.filter((task) => task.jobId !== jobId);
  return before !== store.taskQueue.length;
}

function enqueueJobRun(job, session, context) {
  const runId = nextId('run');
  job.status = 'queued';
  job.progress = 0;
  job.factory = job.factory || context.factory;
  job.ipAddress = job.ipAddress || context.ipAddress;
  job.updatedAt = new Date().toISOString();
  enqueueTask({
    type: job.type,
    session,
    files: getTaskFiles(job, session),
    options: job.type === 'spec_tree' ? { rootFileId: job.rootFileId } : {},
    factory: job.factory,
    ipAddress: job.ipAddress,
    runId,
    jobId: job.id,
  });
  return runId;
}

function createRerunSession(source, sourceSession) {
  if (source.type === 'spec_tree') {
    return cloneSpecTreeSession(sourceSession, source.rootFileId);
  }
  const session = createClauseCompareSession();
  session.oldFile = sourceSession.oldFile ? { ...sourceSession.oldFile } : null;
  session.newFile = sourceSession.newFile ? { ...sourceSession.newFile } : null;
  return session;
}

router.get('/', (req, res) => {
  refreshWorkQueue();
  const { type } = req.query;
  const scope = req.query.scope || 'active';
  if (!type || !VALID_JOB_TYPES.has(type)) {
    return res.status(400).json({
      error: 'type query param is required (spec_tree | clause_compare)',
    });
  }
  if (!VALID_SCOPES.has(scope)) {
    return res.status(400).json({
      error: 'scope must be active or history',
    });
  }
  res.json({ jobs: filterJobs({ type, scope, context: getClientContext(req) }) });
});

router.get('/:id', (req, res) => {
  refreshWorkQueue();
  const job = store.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json(enrichJob(job, getClientContext(req), getQueuePositions(job.type)));
});

router.post('/:id/cancel', (req, res) => {
  const job = store.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  if (job.status === 'completed' || job.status === 'cancelled') {
    return res.status(400).json({ error: `cannot cancel job in status ${job.status}` });
  }
  const session = getSessionForJob(job);
  removeQueuedTask(job.id);
  if (session) cancelSessionRun(session);
  job.status = 'cancelled';
  job.progress = job.progress || 0;
  job.updatedAt = new Date().toISOString();
  appendSystemEvent({
    site: job.factory || getClientContext(req).factory,
    ipAddress: job.ipAddress || getClientContext(req).ipAddress,
    actionType: 'タスク停止',
    feature: job.type === 'spec_tree' ? 'スペックツリー' : '条項比較',
    pages: 0,
    detail: job.type === 'spec_tree' ? 'ツリー作成' : '差分抽出',
    operator: 'demo-user',
    note: job.title,
  });
  res.json(enrichJob(job, getClientContext(req), getQueuePositions(job.type)));
});

router.post('/:id/rerun', (req, res) => {
  const context = getClientContext(req);
  const source = store.jobs.find((j) => j.id === req.params.id);
  if (!source) return res.status(404).json({ error: 'job not found' });
  const sourceSession = getSessionForJob(source);
  if (!sourceSession) return res.status(404).json({ error: 'source session not found' });
  const session = createRerunSession(source, sourceSession);
  const job = addJob({
    type: source.type,
    title: `${source.title} (再実行)`,
    sessionId: session.sessionId,
    rootFileId: source.rootFileId,
    rootFileIds: source.rootFileIds,
    factory: source.factory,
    ipAddress: source.ipAddress,
  });
  const runId = enqueueJobRun(job, session, context);
  res.status(202).json({
    jobId: job.id,
    runId,
    sessionId: job.sessionId,
    rerunOf: source.id,
  });
});

export default router;
