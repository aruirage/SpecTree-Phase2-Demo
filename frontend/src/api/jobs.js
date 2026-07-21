import { formatRelativeTime } from '@/utils/formatTime';

function mapJobToPanel(job) {
  return {
    id: job.id,
    type: job.type,
    name: job.title,
    status: job.status,
    timeLabel: formatRelativeTime(job.updatedAt),
    progress: job.progress ?? null,
    sessionId: job.sessionId,
    title: job.title,
    rootFileId: job.rootFileId || '',
    rootFileIds: Array.isArray(job.rootFileIds) ? job.rootFileIds : [],
    queuePosition: job.queuePosition ?? null,
    factory: job.factory || '',
    ipAddress: job.ipAddress || '',
    retentionExpiresAt: job.retentionExpiresAt || '',
    retentionDaysLeft: job.retentionDaysLeft ?? null,
    expired: Boolean(job.expired),
    cacheHit: Boolean(job.cacheHit),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

async function parseJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export async function fetchJobsByType(type) {
  const [activeRes, historyRes] = await Promise.all([
    fetch(`/api/jobs?type=${encodeURIComponent(type)}&scope=active`, { cache: 'no-store' }),
    fetch(`/api/jobs?type=${encodeURIComponent(type)}&scope=history`, { cache: 'no-store' }),
  ]);
  const active = (await parseJson(activeRes)).jobs || [];
  const history = (await parseJson(historyRes)).jobs || [];
  return [...active, ...history].map(mapJobToPanel);
}

export async function getJob(id) {
  const res = await fetch(`/api/jobs/${encodeURIComponent(id)}`, { cache: 'no-store' });
  return parseJson(res);
}

export async function cancelJob(id) {
  const res = await fetch(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
  return parseJson(res);
}

export async function rerunJob(id) {
  const res = await fetch(`/api/jobs/${encodeURIComponent(id)}/rerun`, { method: 'POST' });
  return parseJson(res);
}

export async function loadSpecTreeResult(sessionId) {
  const res = await fetch(`/api/spec-tree/result?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
  if (res.status === 202) return null;
  return parseJson(res);
}

export async function loadClauseCompareResult(sessionId) {
  const res = await fetch(`/api/clause-compare/result?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
  if (res.status === 202) return null;
  return parseJson(res);
}
