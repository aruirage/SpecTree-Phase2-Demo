import { Router } from 'express';
import multer from 'multer';
import { appendSystemEvent, store } from '../store.js';

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

router.get('/current', (_req, res) => {
  res.json(buildLicenseResponse());
});

router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file is required' });
  const uploadedAt = new Date().toISOString();
  store.license = {
    ...store.license,
    fileName: req.file.originalname,
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
    note: req.file.originalname,
  });
  res.json(buildLicenseResponse());
});

export default router;
