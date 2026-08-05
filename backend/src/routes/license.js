import { Router } from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import { appendSystemEvent, store } from '../store.js';
import { normalizeUploadedFileName } from '../utils/fileNames.js';

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

const MS_PER_DAY = 86_400_000;
/** 課金周期（3 か月ごとに精算） */
const BILLING_PERIOD_MONTHS = 3;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function toDateOnly(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addMonths(date, months) {
  const next = new Date(date.getTime());
  next.setMonth(next.getMonth() + months);
  return next;
}

/**
 * 起算日（licenseStartedAt）から 3 か月ごとの課金期間を算出。
 * 現在日時を含む期間の start / end を返す。end は start + 3 か月の同日。
 */
export function currentBillingPeriod(startedAt, now = new Date()) {
  const anchor = startedAt ? new Date(startedAt) : new Date(now.getFullYear(), now.getMonth(), 1);
  let start = new Date(anchor.getTime());
  let end = addMonths(start, BILLING_PERIOD_MONTHS);
  // 現在を含む期間まで進める
  while (end <= now) {
    start = end;
    end = addMonths(start, BILLING_PERIOD_MONTHS);
  }
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    startDate: toDateOnly(start),
    endDate: toDateOnly(end),
    label: `${toDateOnly(start)} 〜 ${toDateOnly(end)}`,
  };
}

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
    monthlyQuota,
    status,
    fileName,
    retentionDays,
    licenseStartedAt,
    uploadedAt,
  } = store.license;

  const anchor = licenseStartedAt || uploadedAt;
  const dataClearAt = computeDataClearAt(anchor, retentionDays);
  const period = currentBillingPeriod(anchor);

  return {
    status,
    /** 有効期限（課金期間の終了日、日付精度） */
    expiresAt: period.endDate,
    /** 課金対象期間 */
    billingPeriodStart: period.startDate,
    billingPeriodEnd: period.endDate,
    billingPeriodLabel: period.label,
    // 旧フィールド（互換のため残す）
    billingMonth: period.startDate.slice(0, 7),
    billingMonthLabel: period.label,
    monthlyUsed,
    monthlyQuota,
    dataClearAt,
    retentionDays,
    licenseStartedAt: anchor,
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

function resolveDurationMinutes(event) {
  return Number(event.durationMinutes) || 0;
}

function resolveProcessedPages(event) {
  if (resolveResult(event) === '失敗') return 0;
  return Number(event.pages) || 0;
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
  const period = currentBillingPeriod(store.license.licenseStartedAt || store.license.uploadedAt);
  const records = store.systemEvents
    .filter(isBillableEvent)
    .slice()
    .reverse()
    .map((event, index) => ({
      seq: index + 1,
      at: event.at,
      site: event.site || '全体',
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
    licenseFileName: store.license.fileName,
    billingMetric: 'total_pages',
    billingPeriod: {
      from: period.startDate,
      to: period.endDate,
    },
    summary: {
      recordCount: chainedRecords.length,
      totalPages: chainedRecords.reduce((sum, record) => sum + record.totalPages, 0),
      monthlyUsed: store.license.monthlyUsed,
      monthlyQuota: store.license.monthlyQuota,
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
  const stamp = [
    now.getFullYear(),
    pad2(now.getMonth() + 1),
    pad2(now.getDate()),
    pad2(now.getHours()),
    pad2(now.getMinutes()),
  ].join('');
  return `settlement_counter_${stamp}.enc`;
}

function parseDateBoundary(value, endOfDay = false) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) date.setHours(23, 59, 59, 999);
  else date.setHours(0, 0, 0, 0);
  return date.getTime();
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

/**
 * 期間指定で利用ログを CSV エクスポート。
 * query: from=YYYY-MM-DD, to=YYYY-MM-DD（未指定なら全期間）
 */
router.get('/usage-log/export', (req, res) => {
  const fromTime = parseDateBoundary(req.query.from, false);
  const toTime = parseDateBoundary(req.query.to, true);

  const events = store.systemEvents.filter((event) => {
    if (!isBillableEvent(event)) return false;
    const at = Date.parse(event.at || '');
    if (!Number.isFinite(at)) return false;
    if (fromTime !== null && at < fromTime) return false;
    if (toTime !== null && at > toTime) return false;
    return true;
  });

  const header = '利用日時,処理時間（分）,IPアドレス,工場・拠点,機能,操作対象,処理ページ数,総ページ数,処理結果';
  const rows = events.map((event) => [
    event.at,
    resolveDurationMinutes(event),
    event.ipAddress || '',
    event.site,
    formatFeature(event.feature),
    event.note || event.detail || '',
    resolveProcessedPages(event),
    resolveTotalPages(event),
    resolveResult(event),
  ].join(','));
  const csv = '﻿' + [header, ...rows].join('\n');

  const fromLabel = req.query.from || 'all';
  const toLabel = req.query.to || 'all';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="usage_log_${fromLabel}_${toLabel}.csv"`,
  );
  res.send(csv);
});

export default router;
