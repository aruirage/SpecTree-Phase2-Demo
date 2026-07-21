import { Router } from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import { appendSystemEvent, store } from '../store.js';
import { normalizeUploadedFileName } from '../utils/fileNames.js';

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

const MS_PER_DAY = 86_400_000;

/** 起算日 + retentionDays の周期で、次回一括削除日時を算出 */
export function computeDataClearAt(startedAt, retentionDays, now = new Date()) {
  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime()) || !retentionDays) return null;
  let clearAt = new Date(start.getTime() + retentionDays * MS_PER_DAY);
  while (clearAt <= now) {
    clearAt = new Date(clearAt.getTime() + retentionDays * MS_PER_DAY);
  }
  return clearAt.toISOString();
}

function buildLicenseResponse() {
  const {
    monthlyUsed,
    monthlyLimit,
    expiresAt,
    status,
    siteCode,
    fileName,
    retentionDays,
    licenseStartedAt,
    uploadedAt,
  } = store.license;

  const anchor = licenseStartedAt || uploadedAt;
  const dataClearAt = computeDataClearAt(anchor, retentionDays);

  return {
    status,
    siteCode,
    expiresAt,
    monthlyUsed,
    monthlyLimit,
    dataClearAt,
    retentionDays,
    licenseStartedAt: anchor,
    usagePercent: Math.round((monthlyUsed / monthlyLimit) * 1000) / 10,
    fileName,
    /** Demo / API 文档：保持ポリシー説明 */
    retentionPolicy:
      '45日保持。期限到達時にジョブ履歴・処理結果など履歴データを一括削除します。',
  };
}

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

function isBillableEvent(event) {
  const feature = formatFeature(event.feature);
  if (feature !== 'スペックツリー' && feature !== 'スペック新旧比較') return false;
  if (resolveResult(event) === '処理中') return false;
  return resolveTotalPages(event) > 0;
}

function hashRecord(record, previousHash) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ previousHash, record }))
    .digest('hex');
}

function buildSettlementCounterPayload() {
  const records = store.systemEvents
    .filter(isBillableEvent)
    .slice()
    .reverse()
    .map((event, index) => ({
      seq: index + 1,
      at: event.at,
      site: event.site || store.license.siteCode,
      ipAddress: event.ipAddress || '',
      feature: formatFeature(event.feature),
      target: event.note || event.detail || '',
      totalPages: resolveTotalPages(event),
      result: resolveResult(event),
    }));

  let previousHash = 'GENESIS';
  const chainedRecords = records.map((record) => {
    const recordHash = hashRecord(record, previousHash);
    const chained = {
      ...record,
      previousHash,
      recordHash,
    };
    previousHash = recordHash;
    return chained;
  });

  const payload = {
    fileType: 'settlement_counter',
    formatVersion: '1.0',
    encrypted: true,
    generatedAt: new Date().toISOString(),
    siteCode: store.license.siteCode,
    licenseFileName: store.license.fileName,
    billingMetric: 'total_pages',
    billingPeriod: {
      from: store.license.licenseStartedAt,
      to: new Date().toISOString(),
    },
    summary: {
      recordCount: chainedRecords.length,
      totalPages: chainedRecords.reduce((sum, record) => sum + record.totalPages, 0),
      monthlyUsed: store.license.monthlyUsed,
      monthlyLimit: store.license.monthlyLimit,
    },
    records: chainedRecords,
    chainHead: previousHash,
    signature: `mock-signature-${previousHash.slice(0, 16)}`,
  };

  return {
    algorithm: 'MOCK-AES256-GCM+SHA256',
    payload: Buffer.from(JSON.stringify(payload, null, 2), 'utf-8').toString('base64'),
  };
}

function settlementCounterFileName() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
  ].join('');
  return `settlement_counter_${store.license.siteCode}_${stamp}.enc`;
}

router.get('/current', (_req, res) => {
  res.json(buildLicenseResponse());
});

router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file is required' });
  const uploadedAt = new Date().toISOString();
  const fileName = normalizeUploadedFileName(req.file.originalname);
  store.license = {
    ...store.license,
    fileName,
    uploadedAt,
    licenseStartedAt: uploadedAt,
    status: 'active',
  };
  appendSystemEvent({
    actionType: 'License更换',
    feature: '系统',
    pages: 0,
    detail: 'License上传',
    operator: 'admin',
    note: fileName,
  });
  res.json(buildLicenseResponse());
});

router.get('/settlement-counter/export', (_req, res) => {
  const envelope = buildSettlementCounterPayload();
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${settlementCounterFileName()}"`);
  res.send(Buffer.from(JSON.stringify(envelope, null, 2), 'utf-8'));
});

export default router;
