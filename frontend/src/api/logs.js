const API_BASE = '/api/logs';

export async function fetchSystemLogs() {
  const res = await fetch(`${API_BASE}/list`);
  if (!res.ok) {
    throw new Error(`Failed to fetch logs: ${res.status}`);
  }
  return res.json();
}

export function downloadLogExport(format = 'csv') {
  const a = document.createElement('a');
  a.href = `${API_BASE}/export?format=${format}`;
  a.download = format === 'audit' ? 'audit_log.enc' : 'usage_log.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
