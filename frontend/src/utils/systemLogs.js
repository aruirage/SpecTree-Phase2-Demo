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

export function formatLogDateTime(value) {
  return String(value || '').replace('T', ' ');
}

export function formatLogTarget(row) {
  return row?.note || row?.detail || '-';
}

export function formatLogPageCount(row) {
  return Number(row?.pages) || 0;
}

export function formatLogTotalPageCount(row) {
  return Number(row?.totalPages ?? row?.pages) || 0;
}

export function formatLogStatus(row) {
  const actionType = String(row?.actionType || '');
  if (actionType.includes('開始')) return '処理中';
  if (actionType.includes('失敗')) return '失敗';
  if (actionType.includes('中止') || actionType.includes('停止')) return '中止';
  return '成功';
}

export function isUsageLog(row) {
  const feature = formatLogFeature(row?.feature);
  const result = formatLogStatus(row);
  if (!LOG_FEATURE_FILTERS.some((item) => item.value === feature)) return false;
  if (result === '処理中') return false;
  return formatLogTotalPageCount(row) > 0;
}

export function sortSystemLogs(logs, sort = {}) {
  const order = sort?.order;
  const direction = order === 'ascending' ? 1 : order === 'descending' ? -1 : 0;
  if (!direction) return logs;

  const getValue = sort?.prop === 'pages'
      ? formatLogPageCount
      : sort?.prop === 'totalPages'
        ? formatLogTotalPageCount
      : null;

  if (!getValue) return logs;

  return [...logs].sort((a, b) => {
    return (getValue(a) - getValue(b)) * direction;
  });
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
    if (!isUsageLog(log)) return false;
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
      formatLogTarget(log),
      formatLogPageCount(log),
      formatLogTotalPageCount(log),
      formatLogStatus(log),
    ].join(' ').toLowerCase();

    return searchableText.includes(keyword);
  });
}

export function paginateItems(items, page, pageSize) {
  const safePageSize = Number(pageSize) > 0 ? Number(pageSize) : 10;
  const totalPages = Math.max(1, Math.ceil(items.length / safePageSize));
  const requestedPage = Number(page) || 1;
  const safePage = requestedPage > totalPages ? 1 : Math.max(1, requestedPage);
  const start = (safePage - 1) * safePageSize;
  return items.slice(start, start + safePageSize);
}

export function getVisiblePageNumbers(currentPage, totalPages) {
  const safeTotal = Math.max(1, Number(totalPages) || 1);
  const current = Math.min(Math.max(1, Number(currentPage) || 1), safeTotal);
  if (safeTotal <= 8) {
    return Array.from({ length: safeTotal }, (_, index) => index + 1);
  }

  if (current <= 4) {
    return [1, 2, 3, 4, 5, 6, 'ellipsis', safeTotal];
  }

  if (current >= safeTotal - 3) {
    return [1, 'ellipsis-left', safeTotal - 5, safeTotal - 4, safeTotal - 3, safeTotal - 2, safeTotal - 1, safeTotal];
  }

  return [1, 'ellipsis-left', current - 2, current - 1, current, current + 1, current + 2, 'ellipsis-right', safeTotal];
}
