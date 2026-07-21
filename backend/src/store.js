import { v4 as uuidv4 } from 'uuid';
import {
  createInitialJobs,
  createInitialPrompts,
  MOCK_CLAUSE_COMPARE,
  MOCK_SPEC_TREE_MMD,
} from './mockData.js';

/** @type {import('./mockData.js').PromptVersion[]} */
function getActiveVersion(versions) {
  return versions.find((v) => v.isActive) || versions[versions.length - 1];
}

export function normalizeClientIP(ipAddress = '') {
  const raw = String(ipAddress || '').trim();
  if (!raw || raw === '::1') return '127.0.0.1';
  if (raw.startsWith('::ffff:')) return raw.slice('::ffff:'.length);
  return raw;
}

// ファイルからフィンガープリント（キャッシュキー）を生成するヘルパー関数
function generateFileFingerprint(file) {
  if (!file) return '';
  const name = file.name || file.fileName || file.originalname || file.id || file.fileId || 'file';
  return `${name}-${file.size || 0}-${file.lastModified || 0}`;
}

// 複数ファイルからキャッシュキーを生成
function generateCacheKey(type, files, options = {}) {
  const fileKeys = files.map(f => generateFileFingerprint(f)).sort().join('|');
  const optionKey = Object.entries(options)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}:${v}`)
    .join('|');
  return `${type}:${fileKeys}:${optionKey}`;
}

export const store = {
  excelConfig: {
    supplement: {
      fileName: 'supplement_default.xlsx',
      uploadedAt: '2026-06-05T10:00:00.000Z',
      size: 245760,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    deletion: {
      fileName: 'deletion_default.xlsx',
      uploadedAt: '2026-06-05T10:05:00.000Z',
      size: 98304,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
  },
  license: {
    status: 'active',
    siteCode: 'TOKYO-01',
    expiresAt: '2027-03-31',
    monthlyUsed: 3842,
    monthlyLimit: 5000,
    /** 履歴データ保持日数（固定 45 日） */
    retentionDays: 45,
    /** 保持期間の起算日（ライセンス適用開始 / アップロード日） */
    licenseStartedAt: '2026-05-17T00:00:00.000Z',
    fileName: 'license_tokyo01.lic',
    uploadedAt: '2026-05-17T00:00:00.000Z',
  },
  prompts: createInitialPrompts(),
  jobs: createInitialJobs(),
  /** @type {Map<string, object>} */
  specTreeSessions: new Map(),
  /** @type {Map<string, object>} */
  clauseCompareSessions: new Map(),
  // 工場とIPアドレスのマッピング
  factoryIPMap: {
    '桶川工場': '192.168.1.10',
    '安来工場': '192.168.2.10',
  },
  // IPから工場名への逆マッピング
  ipFactoryMap: {
    '192.168.1.10': '桶川工場',
    '192.168.2.10': '安来工場',
  },
  // 結果キャッシュ（フィンガープリント → セッションID）
  /** @type {Map<string, object>} */
  resultCache: new Map(),
  // タスクキュー
  taskQueue: [],
  // 実行中のタスク（同時実行数を制限）
  runningTasks: [],
  maxConcurrentTasks: 1, // 同時に実行できるGPUタスク数
  systemEvents: [
    {
      site: '桶川工場',
      ipAddress: '192.168.1.10',
      at: '2026-06-30T10:00:00',
      actionType: 'タスク完了',
      feature: '条項比較',
      processCount: 2,
      pages: 86,
      detail: '差分抽出',
      operator: 'user01',
      note: 'AMS2750E.pdf;AMS2750F.pdf',
    },
    {
      site: '安来工場',
      ipAddress: '192.168.2.10',
      at: '2026-06-30T14:30:00',
      actionType: 'タスク完了',
      feature: 'スペックツリー',
      processCount: 2,
      pages: 124,
      detail: 'ツリー作成',
      operator: 'user02',
      note: 'M000378.pdf;M000412.pdf',
    },
    {
      site: '安来工場',
      ipAddress: '192.168.2.10',
      at: '2026-06-30T15:45:00',
      actionType: 'タスク完了',
      feature: 'スペックツリー',
      processCount: 1,
      pages: 68,
      detail: 'ツリー作成',
      operator: 'user03',
      note: 'M000501.pdf',
    },
    {
      site: '桶川工場',
      ipAddress: '192.168.1.10',
      at: '2026-06-29T09:15:00',
      actionType: 'タスク完了',
      feature: '条項比較',
      processCount: 2,
      pages: 156,
      detail: '差分抽出',
      operator: 'user01',
      note: 'AS9100D.pdf;AS9100E.pdf',
    },
    {
      site: '安来工場',
      ipAddress: '192.168.2.10',
      at: '2026-06-28T16:20:00',
      actionType: 'タスク完了',
      feature: 'スペックツリー',
      processCount: 1,
      pages: 92,
      detail: 'ツリー作成',
      operator: 'user04',
      note: 'M000388.pdf',
    },
  ],
};

function promptKeyForJobType(type) {
  return type === 'spec_tree' ? 'spec_tree.pipeline' : 'clause_compare.extract';
}

function seedHistorySessions() {
  for (const job of store.jobs) {
    if (!job.sessionId) continue;
    if (job.type === 'spec_tree' && !store.specTreeSessions.has(job.sessionId)) {
      store.specTreeSessions.set(job.sessionId, {
        sessionId: job.sessionId,
        files: [],
        run: { status: job.status, jobId: job.id },
        result: job.status === 'completed'
          ? {
              mmdContent: MOCK_SPEC_TREE_MMD,
              nodeCount: 4,
              treeNodes: [
                { id: 'root', label: 'M000378 Rev:C ASTM A36', level: 0 },
                { id: 'n1', label: 'ASTM A572 Grade 50', level: 1 },
                { id: 'n2', label: 'ASTM A588', level: 1 },
                { id: 'n3', label: 'AMS2750E Pyrometry', level: 2 },
              ],
            }
          : null,
        progress: { running: false, stage: job.status },
        createdAt: Date.parse(job.createdAt),
      });
    }
    if (job.type === 'clause_compare' && !store.clauseCompareSessions.has(job.sessionId)) {
      const [oldName = 'old.pdf', newName = 'new.pdf'] = job.title.includes(' vs ')
        ? job.title.split(' vs ')
        : ['old.pdf', 'new.pdf'];
      store.clauseCompareSessions.set(job.sessionId, {
        sessionId: job.sessionId,
        oldFile: { fileId: 'file-old', fileName: oldName.trim(), fileType: 'old' },
        newFile: { fileId: 'file-new', fileName: newName.trim(), fileType: 'new' },
        run: { status: job.status, jobId: job.id },
        result: job.status === 'completed' ? structuredClone(MOCK_CLAUSE_COMPARE) : null,
        progress: { running: job.status === 'running', stage: job.status },
        createdAt: Date.parse(job.createdAt),
      });
    }
  }
}

seedHistorySessions();

export function nextId(prefix = 'id') {
  return `${prefix}-${uuidv4().slice(0, 8)}`;
}

export function listPromptKeys() {
  return Object.keys(store.prompts).map((key) => {
    const versions = store.prompts[key];
    const active = getActiveVersion(versions);
    return {
      key,
      activeVersionId: active?.id,
      activeVersionName: active?.name,
      versionCount: versions.length,
    };
  });
}

export function getPromptDetail(key) {
  const versions = store.prompts[key];
  if (!versions) return null;
  const active = getActiveVersion(versions);
  return {
    key,
    activeVersion: active,
    versions: [...versions].sort((a, b) => b.version - a.version),
  };
}

export function createSpecTreeSession(files = [], {
  rootFileId = null,
  parentSessionId = null,
  sessionId = nextId('st'),
} = {}) {
  const session = {
    sessionId,
    files,
    rootFileId,
    parentSessionId,
    run: null,
    result: null,
    progress: { running: false, stage: 'queued' },
    createdAt: Date.now(),
  };
  store.specTreeSessions.set(sessionId, session);
  return session;
}

export function cloneSpecTreeSession(sourceSession, rootFileId) {
  return createSpecTreeSession(
    [...(sourceSession.files || [])],
    { rootFileId, parentSessionId: sourceSession.sessionId },
  );
}

function rootFileLabel(session, rootFileId) {
  const file = (session.files || []).find((f) => f.id === rootFileId);
  return file?.name?.replace(/\.[^.]+$/, '') || rootFileId || 'root';
}

export function createSpecTreeJobsForRoots(session, rootFileIds = []) {
  const roots = rootFileIds.length > 0 ? rootFileIds : [session.rootFileId || null];
  const jobs = [];

  for (const rootFileId of roots) {
    const targetSession = roots.length > 1
      ? cloneSpecTreeSession(session, rootFileId)
      : session;
    const title = `M000378 · ${rootFileLabel(session, rootFileId)}`;
    const job = addJob({
      type: 'spec_tree',
      title,
      sessionId: targetSession.sessionId,
      rootFileId,
      rootFileIds: roots.length > 1 ? [rootFileId] : roots,
    });
    jobs.push({ job, session: targetSession, rootFileId });
  }

  return jobs;
}

export function createClauseCompareSession({ sessionId = nextId('cc') } = {}) {
  const session = {
    sessionId,
    oldFile: null,
    newFile: null,
    run: null,
    result: null,
    progress: { running: false, stage: 'queued' },
    createdAt: Date.now(),
  };
  store.clauseCompareSessions.set(sessionId, session);
  return session;
}

const SPEC_TREE_STAGES = [
  { stage: 'queued', delay: 250, progress: 8 },
  { stage: 'running', delay: 350, progress: 14 },
  { stage: 'extracting_sources', delay: 700, progress: 28, pdfTotal: 3, pdfCompleted: 1 },
  { stage: 'building_spec_tree', delay: 900, progress: 72, requestTotal: 12, requestCompleted: 8 },
  { stage: 'packaging', delay: 400, progress: 94 },
  { stage: 'succeeded', delay: 150, progress: 100 },
];

const CLAUSE_STAGES = [
  { stage: 'queued', delay: 250, progress: 8 },
  { stage: 'running', delay: 350, progress: 14 },
  { stage: 'extracting_old_new', delay: 900, progress: 64, pageTotal: 86, pageCompleted: 42 },
  { stage: 'comparing', delay: 900, progress: 86, pageTotal: 86, pageCompleted: 76 },
  { stage: 'packaging', delay: 400, progress: 94, pageTotal: 86, pageCompleted: 86 },
  { stage: 'succeeded', delay: 150, progress: 100, pageTotal: 86, pageCompleted: 86 },
];

export function createSpecTreeResult() {
  return {
    mmdContent: MOCK_SPEC_TREE_MMD,
    nodeCount: 4,
    treeNodes: [
      { id: 'root', label: 'M000378 Rev:C ASTM A36', level: 0 },
      { id: 'n1', label: 'ASTM A572 Grade 50', level: 1 },
      { id: 'n2', label: 'ASTM A588', level: 1 },
      { id: 'n3', label: 'AMS2750E Pyrometry', level: 2 },
    ],
  };
}

export function createClauseCompareResult() {
  return structuredClone(MOCK_CLAUSE_COMPARE);
}

function stagesForType(type) {
  return type === 'spec_tree' ? SPEC_TREE_STAGES : CLAUSE_STAGES;
}

function resultForType(type) {
  return type === 'spec_tree' ? createSpecTreeResult() : createClauseCompareResult();
}

function composeProgressState(stages, stageIndex, running) {
  const state = {
    running,
    stage: stages[stageIndex]?.stage || stages[stages.length - 1].stage,
    progress: stages[stageIndex]?.progress || 0,
    pdfTotal: 0,
    pdfCompleted: 0,
    pageTotal: 0,
    pageCompleted: 0,
    requestTotal: 0,
    requestCompleted: 0,
  };

  for (let i = 0; i <= stageIndex; i += 1) {
    const step = stages[i];
    state.pdfTotal = step.pdfTotal ?? state.pdfTotal;
    state.pdfCompleted = step.pdfCompleted ?? state.pdfCompleted;
    state.pageTotal = step.pageTotal ?? state.pageTotal;
    state.pageCompleted = step.pageCompleted ?? state.pageCompleted;
    state.requestTotal = step.requestTotal ?? state.requestTotal;
    state.requestCompleted = step.requestCompleted ?? state.requestCompleted;
  }

  return state;
}

function getPipelineState(type, startedAt) {
  const stages = stagesForType(type);
  const elapsed = Math.max(0, Date.now() - Number(startedAt || Date.now()));
  const totalDuration = stages.reduce((sum, step) => sum + Math.max(0, Number(step.delay) || 0), 0);
  let stageIndex = stages.length - 1;
  let elapsedBoundary = 0;

  for (let i = 0; i < stages.length; i += 1) {
    elapsedBoundary += Math.max(0, Number(stages[i].delay) || 0);
    if (elapsed < elapsedBoundary) {
      stageIndex = i;
      break;
    }
  }

  return {
    complete: elapsed >= totalDuration,
    progress: composeProgressState(stages, stageIndex, elapsed < totalDuration),
  };
}

function removeRunningTask(jobId) {
  if (!jobId) return null;
  const index = store.runningTasks.findIndex((task) => task.jobId === jobId);
  if (index < 0) return null;
  const [task] = store.runningTasks.splice(index, 1);
  return task;
}

function completeRunningTask(session) {
  const task = removeRunningTask(session.run?.jobId);
  if (!task) return;

  if (session.result) {
    cacheResult(task.type, task.files, session, task.options);
  }

  const completedJob = store.jobs.find((j) => j.id === task.jobId);
  if (completedJob && session.run?.status === 'completed') {
    appendSystemEvent({
      site: task.factory,
      ipAddress: task.ipAddress,
      actionType: 'タスク完了',
      feature: task.type === 'spec_tree' ? 'スペックツリー' : '条項比較',
      processCount: task.type === 'spec_tree' ? Math.max(1, task.files?.length || 1) : 2,
      pages: task.type === 'spec_tree' ? 124 : 86,
      detail: task.type === 'spec_tree' ? 'ツリー作成' : '差分抽出',
      operator: 'system',
      note: completedJob.title,
    });
  }

  processQueue();
}

export function refreshSessionRun(session) {
  if (!session?.run || session.run.status !== 'running') return session;
  const type = session.run.type;
  if (!type) return session;

  const { complete, progress } = getPipelineState(type, session.run.startedAt);
  session.progress = progress;

  const job = store.jobs.find((j) => j.id === session.run.jobId);
  if (job) {
    job.status = complete ? 'completed' : 'running';
    job.progress = complete ? 100 : Math.max(job.progress || 0, progress.progress || 0);
    job.updatedAt = new Date().toISOString();
  }

  if (complete) {
    session.result = resultForType(type);
    session.run.status = 'completed';
    session.progress = {
      ...composeProgressState(stagesForType(type), stagesForType(type).length - 1, false),
      progress: 100,
    };
    completeRunningTask(session);
  }

  return session;
}

export function refreshWorkQueue() {
  for (const task of [...store.runningTasks]) {
    refreshSessionRun(task.session);
  }
  processQueue();
}

export function startSpecTreeRun(session, { runId, jobId }) {
  if (session.run?.status === 'running') {
    const err = new Error('Another spec tree generation is already running');
    err.code = 'FEATURE_RUN_IN_PROGRESS';
    throw err;
  }
  session.result = null;
  session.run = { runId, jobId, type: 'spec_tree', status: 'running', startedAt: Date.now() };
  session.progress = composeProgressState(SPEC_TREE_STAGES, 0, true);
  const job = store.jobs.find((j) => j.id === jobId);
  if (job) {
    job.status = 'running';
    job.progress = 10;
    job.updatedAt = new Date().toISOString();
  }
}

export function startClauseCompareRun(session, { runId, jobId }) {
  session.result = null;
  session.run = { runId, jobId, type: 'clause_compare', status: 'running', startedAt: Date.now() };
  session.progress = composeProgressState(CLAUSE_STAGES, 0, true);
  const job = store.jobs.find((j) => j.id === jobId);
  if (job) {
    job.status = 'running';
    job.progress = 15;
    job.updatedAt = new Date().toISOString();
  }
}

export function cancelSessionRun(session) {
  if (session.run) {
    session.run.status = 'cancelled';
    const job = store.jobs.find((j) => j.id === session.run.jobId);
    if (job) {
      job.status = 'cancelled';
      job.updatedAt = new Date().toISOString();
    }
    removeRunningTask(session.run.jobId);
    processQueue();
  }
  session.progress = { running: false, stage: 'cancelled' };
  session.result = null;
}

export function addJob({
  type,
  title,
  sessionId = null,
  rootFileId = null,
  rootFileIds = null,
  factory = '',
  ipAddress = '',
  cacheHit = false,
}) {
  const promptKey = promptKeyForJobType(type);
  const activeVersion = getActiveVersion(store.prompts[promptKey]);
  const job = {
    id: nextId('job'),
    type,
    title,
    status: 'queued',
    progress: 0,
    promptVersionName: activeVersion?.name || '—',
    sessionId,
    rootFileId,
    rootFileIds: rootFileIds || (rootFileId ? [rootFileId] : null),
    factory,
    ipAddress: normalizeClientIP(ipAddress),
    cacheHit,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.jobs.unshift(job);
  return job;
}

export function appendSystemEvent(event) {
  store.systemEvents.unshift({
    site: event.site || store.license.siteCode,
    at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    ...event,
    ipAddress: normalizeClientIP(event.ipAddress || ''),
  });
}

// IPアドレスから工場名を取得する
export function getFactoryFromIP(ipAddress) {
  return store.ipFactoryMap[normalizeClientIP(ipAddress)] || '不明';
}

// 結果キャッシュをチェックする
export function getCachedResult(type, files, options = {}) {
  const cacheKey = generateCacheKey(type, files, options);
  const cached = store.resultCache.get(cacheKey);
  
  if (!cached) return null;
  
  // キャッシュが有効期限内かチェック
  const now = Date.now();
  const maxAge = 7 * 24 * 60 * 60 * 1000; // 7日間
  if (now - cached.cachedAt > maxAge) {
    store.resultCache.delete(cacheKey);
    return null;
  }
  
  return cached;
}

// 結果をキャッシュする
export function cacheResult(type, files, session, options = {}) {
  const cacheKey = generateCacheKey(type, files, options);
  store.resultCache.set(cacheKey, {
    sessionId: session.sessionId,
    result: session.result,
    cachedAt: Date.now(),
    factory: session.factory || '不明',
  });
}

// タスクをキューに追加する
export function enqueueTask(task) {
  store.taskQueue.push({
    ...task,
    queuedAt: Date.now(),
  });
  // キューをチェックして実行可能なら実行
  processQueue();
}

// キューを処理する
function processQueue() {
  for (const task of [...store.runningTasks]) {
    refreshSessionRun(task.session);
  }

  // 実行中のタスクが最大数に達していたら何もしない
  if (store.runningTasks.length >= store.maxConcurrentTasks) {
    return;
  }
  
  // キューから次のタスクを取得
  const task = store.taskQueue.shift();
  if (!task) return;
  
  // タスクを実行中リストに追加
  store.runningTasks.push(task);
  
  // タスク実行
  executeTask(task);
}

// タスクを実行する
function executeTask(task) {
  const { type, session, files, options, factory, ipAddress, jobId } = task;
  const job = store.jobs.find((j) => j.id === jobId);
  if (job) {
    job.factory = factory || job.factory || '不明';
    job.ipAddress = normalizeClientIP(ipAddress || job.ipAddress || '');
    job.status = 'running';
    job.updatedAt = new Date().toISOString();
  }
  
  appendSystemEvent({
    site: factory,
    ipAddress: ipAddress,
    actionType: 'タスク開始',
    feature: type === 'spec_tree' ? 'スペックツリー' : '条項比較',
    pages: 0,
    detail: type === 'spec_tree' ? 'ツリー作成' : '差分抽出',
    operator: 'system',
    note: `キャッシュなし - 新規実行`,
  });
  
  // 実際のタスク実行
  if (type === 'spec_tree') {
    startSpecTreeRun(session, { runId: task.runId, jobId: task.jobId });
  } else {
    startClauseCompareRun(session, { runId: task.runId, jobId: task.jobId });
  }
}

// キューの状態を取得する
export function getQueueStatus() {
  refreshWorkQueue();
  return {
    queued: store.taskQueue.length,
    running: store.runningTasks.length,
    maxConcurrent: store.maxConcurrentTasks,
    queue: [...store.taskQueue],
    runningTasks: [...store.runningTasks],
  };
}

// 期限切れデータをクリーンアップする
export function cleanupExpiredData() {
  const now = Date.now();
  const retentionMs = store.license.retentionDays * 24 * 60 * 60 * 1000;
  
  // キャッシュをクリーンアップ
  for (const [key, cached] of store.resultCache.entries()) {
    if (now - cached.cachedAt > retentionMs) {
      store.resultCache.delete(key);
    }
  }
  
  // 古いジョブをクリーンアップ（保持日数を超えたもの）
  const cutoff = now - retentionMs;
  store.jobs = store.jobs.filter(job => {
    const jobTime = Date.parse(job.updatedAt);
    return jobTime > cutoff;
  });
  
  // 古いセッションをクリーンアップ
  for (const [id, session] of store.specTreeSessions.entries()) {
    if (session.createdAt < cutoff) {
      store.specTreeSessions.delete(id);
    }
  }
  for (const [id, session] of store.clauseCompareSessions.entries()) {
    if (session.createdAt < cutoff) {
      store.clauseCompareSessions.delete(id);
    }
  }
  
  appendSystemEvent({
    site: 'システム',
    ipAddress: '127.0.0.1',
    actionType: 'クリーンアップ',
    feature: 'メンテナンス',
    pages: 0,
    detail: '期限切れデータ削除',
    operator: 'system',
    note: `保持期間${store.license.retentionDays}日を超えたデータをクリーンアップ`,
  });
}
