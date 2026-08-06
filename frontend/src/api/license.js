function mapLicense(data) {
  const used = data.monthlyUsed ?? 0;
  const quota = data.monthlyQuota ?? 15000;
  return {
    expiresAt: data.expiresAt,
    validityPeriodLabel: data.validityPeriodLabel,
    billingMonth: data.billingMonth,
    billingMonthLabel: data.billingMonthLabel,
    billingPeriodStart: data.billingPeriodStart,
    billingPeriodEnd: data.billingPeriodEnd,
    billingPeriodLabel: data.billingPeriodLabel,
    usedPages: used,
    quotaPages: quota,
    status: data.status,
    fileName: data.fileName,
    dataClearAt: data.dataClearAt,
    retentionDays: data.retentionDays,
    retentionPolicy: data.retentionPolicy,
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

/**
 * 精算用カウントファイル（暗号化 .enc）を期間指定でダウンロード。
 * @param {string} from 開始日 YYYY-MM-DD
 * @param {string} to 終了日 YYYY-MM-DD
 */
export function downloadUsageLog(from, to) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const a = document.createElement('a');
  a.href = `/api/license/settlement-counter/export?${params.toString()}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
