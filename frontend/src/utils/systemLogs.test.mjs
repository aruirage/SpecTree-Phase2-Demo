import assert from 'node:assert/strict';
import {
  filterSystemLogs,
  filterLogByFeature,
  formatLogFeature,
  formatLogStatus,
  formatLogTarget,
  LOG_FEATURE_FILTERS,
} from './systemLogs.js';

assert.deepEqual(LOG_FEATURE_FILTERS.map((item) => item.text), [
  'スペックツリー',
  'スペック新旧比較',
]);

assert.equal(formatLogFeature('条項比較'), 'スペック新旧比較');
assert.equal(formatLogFeature('spec_tree'), 'スペックツリー');
assert.equal(filterLogByFeature('スペック新旧比較', { feature: '条項比較' }), true);
assert.equal(filterLogByFeature('スペックツリー', { feature: '条項比較' }), false);
assert.equal(formatLogTarget({ note: 'M000378.pdf', detail: 'ツリー作成' }), 'M000378.pdf');
assert.equal(formatLogTarget({ note: '', detail: '差分抽出' }), '差分抽出');
assert.equal(formatLogStatus({ actionType: 'タスク開始' }), '処理中');
assert.equal(formatLogStatus({ actionType: 'タスク完了' }), '成功');

const sampleLogs = [
  {
    at: '2026-06-30T10:00:00',
    ipAddress: '192.168.1.10',
    site: '桶川工場',
    feature: '条項比較',
    actionType: 'タスク完了',
    note: 'AMS2750E.pdf;AMS2750F.pdf',
    pages: 86,
  },
  {
    at: '2026-06-28T16:20:00',
    ipAddress: '192.168.2.10',
    site: '安来工場',
    feature: 'スペックツリー',
    actionType: 'タスク完了',
    note: 'M000388.pdf',
    pages: 92,
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
