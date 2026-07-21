import { Router } from 'express';
import { refreshWorkQueue, store } from '../store.js';

const router = Router();

function formatFeature(feature = '') {
  if (feature === '条項比較' || feature === 'clause_compare') return 'スペック新旧比較';
  if (feature === 'spec_tree') return 'スペックツリー';
  return feature || '不明';
}

function resolveResult(event) {
  const actionType = String(event.actionType || '');
  if (actionType.includes('開始')) return '処理中';
  if (actionType.includes('失敗')) return '失敗';
  if (actionType.includes('中止') || actionType.includes('停止')) return '中止';
  return '成功';
}

function resolveTotalPages(event) {
  return Number(event.totalPages ?? event.pages) || 0;
}

function resolveProcessedPages(event) {
  if (resolveResult(event) === '失敗') return 0;
  return Number(event.pages) || 0;
}

function resolveDurationMinutes(event) {
  return Number(event.durationMinutes) || 0;
}

function isUsageEvent(event) {
  const feature = formatFeature(event.feature);
  if (feature !== 'スペックツリー' && feature !== 'スペック新旧比較') return false;
  if (resolveResult(event) === '処理中') return false;
  return resolveTotalPages(event) > 0;
}

router.get('/list', (req, res) => {
  refreshWorkQueue();
  const events = store.systemEvents.filter(isUsageEvent);
  res.json({
    total: events.length,
    events,
  });
});

router.get('/export', (req, res) => {
  refreshWorkQueue();
  const format = req.query.format || 'csv';

  if (format === 'audit') {
    const payload = {
      exportedAt: new Date().toISOString(),
      site: store.license.siteCode,
      records: store.systemEvents.map((e, i) => ({
        seq: i + 1,
        ...e,
        prev_hash: i === 0 ? 'GENESIS' : `hash-${i}`,
        record_hash: `hash-${i + 1}`,
        signature: 'mock-signature',
      })),
    };
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="audit_log.enc"');
    return res.send(Buffer.from(JSON.stringify(payload, null, 2), 'utf-8'));
  }

  const events = store.systemEvents.filter(isUsageEvent);
  const header = '利用日時,処理時間（分）,IPアドレス,工場・拠点,機能,操作対象,処理ページ数,総ページ数,処理結果';
  const rows = events.map((e) => [
    e.at,
    resolveDurationMinutes(e),
    e.ipAddress || '',
    e.site,
    formatFeature(e.feature),
    e.note || e.detail || '',
    resolveProcessedPages(e),
    resolveTotalPages(e),
    resolveResult(e),
  ].join(','));
  const csv = '\ufeff' + [header, ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="operation_log.csv"');
  res.send(csv);
});

export default router;
