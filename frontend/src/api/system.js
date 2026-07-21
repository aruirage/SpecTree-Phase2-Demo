const API_BASE = '/api/system';

export async function getQueueStatus() {
  const res = await fetch(`${API_BASE}/queue/status`);
  if (!res.ok) throw new Error('Queue status fetch failed');
  return res.json();
}

export async function getCacheStatus() {
  const res = await fetch(`${API_BASE}/cache/status`);
  if (!res.ok) throw new Error('Cache status fetch failed');
  return res.json();
}

export async function clearCache() {
  const res = await fetch(`${API_BASE}/cache`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Cache clear failed');
  return res.json();
}

export async function getFactoryInfo() {
  const res = await fetch(`${API_BASE}/factory`);
  if (!res.ok) throw new Error('Factory info fetch failed');
  return res.json();
}

export async function runCleanup() {
  const res = await fetch(`${API_BASE}/cleanup`, { method: 'POST' });
  if (!res.ok) throw new Error('Cleanup failed');
  return res.json();
}
