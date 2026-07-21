import assert from 'node:assert/strict';
import {
  filterSystemLogs,
  filterLogByFeature,
  formatLogDateTime,
  formatLogFeature,
  formatLogPageCount,
  formatLogStatus,
  formatLogTarget,
  formatLogTotalPageCount,
  getVisiblePageNumbers,
  isUsageLog,
  LOG_FEATURE_FILTERS,
  paginateItems,
  sortSystemLogs,
} from './systemLogs.js';

assert.deepEqual(LOG_FEATURE_FILTERS.map((item) => item.text), [
  'スペックツリー',
  'スペック新旧比較',
]);

assert.equal(formatLogFeature('条項比較'), 'スペック新旧比較');
assert.equal(formatLogFeature('spec_tree'), 'スペックツリー');
assert.equal(filterLogByFeature('スペック新旧比較', { feature: '条項比較' }), true);
assert.equal(filterLogByFeature('スペックツリー', { feature: '条項比較' }), false);
assert.equal(formatLogDateTime('2026-06-30T10:00:00'), '2026-06-30 10:00:00');
assert.equal(formatLogTarget({ note: 'M000378.pdf', detail: 'ツリー作成' }), 'M000378.pdf');
assert.equal(formatLogTarget({ note: '', detail: '差分抽出' }), '差分抽出');
assert.equal(formatLogStatus({ actionType: 'タスク開始' }), '処理中');
assert.equal(formatLogStatus({ actionType: 'タスク完了' }), '成功');
assert.equal(formatLogStatus({ actionType: 'タスク中止' }), '中止');
assert.equal(formatLogPageCount({ pages: 86 }), 86);
assert.equal(formatLogTotalPageCount({ pages: 42, totalPages: 118 }), 118);
assert.equal(isUsageLog({ feature: 'スペックツリー', actionType: 'タスク開始', pages: 0, totalPages: 92 }), false);
assert.equal(isUsageLog({ feature: 'システム', actionType: 'License更换', pages: 0, totalPages: 0 }), false);
assert.equal(isUsageLog({ feature: '条項比較', actionType: 'タスク中止', pages: 42, totalPages: 118 }), true);

const sampleLogs = [
  {
    at: '2026-06-30T10:00:00',
    ipAddress: '192.168.1.10',
    site: '桶川工場',
    feature: '条項比較',
    actionType: 'タスク完了',
    note: 'AMS2750E.pdf;AMS2750F.pdf',
    pages: 86,
    totalPages: 86,
  },
  {
    at: '2026-06-28T16:20:00',
    ipAddress: '192.168.2.10',
    site: '安来工場',
    feature: 'スペックツリー',
    actionType: 'タスク完了',
    note: 'M000388.pdf',
    pages: 92,
    totalPages: 92,
  },
  {
    at: '2026-06-28T11:40:00',
    ipAddress: '192.168.1.10',
    site: '桶川工場',
    feature: '条項比較',
    actionType: 'タスク中止',
    note: 'AMS5510J.pdf;AMS5510K.pdf',
    pages: 42,
    totalPages: 118,
  },
  {
    at: '2026-06-28T11:20:00',
    ipAddress: '192.168.1.10',
    site: '桶川工場',
    feature: '条項比較',
    actionType: 'タスク開始',
    note: 'AMS5510J.pdf;AMS5510K.pdf',
    pages: 0,
    totalPages: 118,
  },
];

assert.deepEqual(
  filterSystemLogs(sampleLogs, {
    dateRange: ['2026-06-30', '2026-06-30'],
    keyword: 'ams2750',
    feature: 'スペック新旧比較',
  }).map((log) => log.note),
  ['AMS2750E.pdf;AMS2750F.pdf'],
);
assert.deepEqual(filterSystemLogs(sampleLogs, { keyword: '中止' }).map((log) => log.note), ['AMS5510J.pdf;AMS5510K.pdf']);

assert.deepEqual(paginateItems([1, 2, 3, 4, 5], 2, 2), [3, 4]);
assert.deepEqual(paginateItems([1, 2, 3], 9, 2), [1, 2]);
assert.deepEqual(getVisiblePageNumbers(1, 11), [1, 2, 3, 4, 5, 6, 'ellipsis', 11]);
assert.deepEqual(getVisiblePageNumbers(6, 11), [1, 'ellipsis-left', 4, 5, 6, 7, 8, 'ellipsis-right', 11]);
assert.deepEqual(sortSystemLogs(sampleLogs.slice(0, 3), { prop: 'pages', order: 'ascending' }).map((log) => log.pages), [42, 86, 92]);
assert.deepEqual(sortSystemLogs(sampleLogs.slice(0, 3), { prop: 'pages', order: 'descending' }).map((log) => log.pages), [92, 86, 42]);
assert.deepEqual(sortSystemLogs(sampleLogs.slice(0, 3), { prop: 'totalPages', order: 'ascending' }).map((log) => log.totalPages), [86, 92, 118]);
assert.deepEqual(sortSystemLogs(sampleLogs.slice(0, 3), { prop: 'totalPages', order: 'descending' }).map((log) => log.totalPages), [118, 92, 86]);
