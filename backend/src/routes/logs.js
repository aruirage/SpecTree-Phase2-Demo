import { Router } from 'express';
import { store } from '../store.js';

const router = Router();

router.get('/list', (req, res) => {
  res.json({
    total: store.systemEvents.length,
    events: store.systemEvents,
  });
});

router.get('/export', (req, res) => {
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

  const header = '拠点,IPアドレス,日時,操作種別,機能,処理量（ページ数）,備考';
  const rows = store.systemEvents.map((e) => [
    e.site,
    e.ipAddress || '',
    e.at,
    e.actionType,
    e.feature,
    e.pages,
    e.note,
  ].join(','));
  const csv = '\ufeff' + [header, ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="operation_log.csv"');
  res.send(csv);
});

export default router;
