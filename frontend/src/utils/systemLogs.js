export const LOG_FEATURE_FILTERS = [
  { text: 'スペックツリー', value: 'スペックツリー' },
  { text: 'スペック新旧比較', value: 'スペック新旧比較' },
];

export function formatLogFeature(feature) {
  if (feature === '条項比較' || feature === 'clause_compare') return 'スペック新旧比較';
  if (feature === 'spec_tree') return 'スペックツリー';
  return feature || '不明';
}

export function filterLogByFeature(value, row) {
  return formatLogFeature(row?.feature) === value;
}

export function formatLogTarget(row) {
  return row?.note || row?.detail || '-';
}

export function formatLogStatus(row) {
  const actionType = String(row?.actionType || '');
  if (actionType.includes('開始')) return '処理中';
  if (actionType.includes('失敗')) return '失敗';
  if (actionType.includes('中止')) return '中止';
  return '成功';
}

function toDayBoundaryTime(value, endOfDay = false) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value) : new Date(String(value));
  if (!Number.isFinite(date.getTime())) return null;
  date.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  return date.getTime();
}

export function filterSystemLogs(logs, filters = {}) {
  const dateRange = Array.isArray(filters.dateRange) ? filters.dateRange : [];
  const startTime = toDayBoundaryTime(dateRange[0], false);
  const endTime = toDayBoundaryTime(dateRange[1], true);
  const keyword = String(filters.keyword || '').trim().toLowerCase();
  const feature = filters.feature || '';

  return logs.filter((log) => {
    const logTime = Date.parse(log?.at || '');
    if (startTime !== null && (!Number.isFinite(logTime) || logTime < startTime)) return false;
    if (endTime !== null && (!Number.isFinite(logTime) || logTime > endTime)) return false;
    if (feature && formatLogFeature(log?.feature) !== feature) return false;
    if (!keyword) return true;

    const searchableText = [
      log?.at,
      log?.ipAddress,
      log?.site,
      formatLogFeature(log?.feature),
      log?.actionType,
      formatLogTarget(log),
      log?.pages,
      formatLogStatus(log),
    ].join(' ').toLowerCase();

    return searchableText.includes(keyword);
  });
}
