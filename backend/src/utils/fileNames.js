export function normalizeUploadedFileName(fileName = '') {
  const raw = String(fileName || '').trim();
  if (!raw) return '';
  if (/[^\u0000-\u00ff]/.test(raw)) return raw;

  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  if (decoded && decoded !== raw && !decoded.includes('\uFFFD')) {
    return decoded;
  }

  return raw;
}
