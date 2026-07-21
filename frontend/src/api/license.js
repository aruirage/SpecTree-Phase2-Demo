function mapLicense(data) {
  const used = data.monthlyUsed ?? 0;
  const max = data.monthlyLimit ?? 0;
  return {
    siteId: data.siteCode,
    expiresAt: data.expiresAt,
    usedPages: used,
    maxPages: max,
    remainingPages: Math.max(0, max - used),
    status: data.status,
    fileName: data.fileName,
    dataClearAt: data.dataClearAt,
    retentionDays: data.retentionDays,
    retentionPolicy: data.retentionPolicy,
    usagePercent: data.usagePercent,
  };
}

async function parseJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export async function fetchCurrentLicense() {
  const res = await fetch('/api/license/current', { cache: 'no-store' });
  return mapLicense(await parseJson(res));
}

export async function uploadLicenseFile(file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/license/upload', { method: 'POST', body: form });
  return mapLicense(await parseJson(res));
}

export function downloadLogExport(format) {
  const a = document.createElement('a');
  a.href = `/api/logs/export?format=${encodeURIComponent(format)}`;
  a.download = format === 'audit' ? 'audit_log.enc' : 'operation_log.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
