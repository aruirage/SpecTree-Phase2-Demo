import { Router } from 'express';
import {
  getQueueStatus,
  cleanupExpiredData,
  getFactoryFromIP,
  getCachedResult,
  enqueueTask,
  appendSystemEvent,
  store,
  createSpecTreeSession,
  createClauseCompareSession,
  createSpecTreeJobsForRoots,
  addJob,
  nextId,
} from '../store.js';

const router = Router();

// キュー状態を取得
router.get('/queue/status', (req, res) => {
  const status = getQueueStatus();
  res.json(status);
});

// 手動でクリーンアップを実行
router.post('/cleanup', (req, res) => {
  cleanupExpiredData();
  res.json({ status: 'ok', message: 'クリーンアップが完了しました' });
});

// 現在の工場情報を取得（IPから判別）
router.get('/factory', (req, res) => {
  const clientIP = req.ip || req.connection.remoteAddress || '127.0.0.1';
  // プロキシ経由の場合のヘッダーチェック
  const xForwardedFor = req.headers['x-forwarded-for'];
  const ipAddress = xForwardedFor ? xForwardedFor.split(',')[0].trim() : clientIP;
  
  const factory = getFactoryFromIP(ipAddress);
  
  res.json({
    ipAddress,
    factory,
    isRecognized: factory !== '不明',
  });
});

// キャッシュ状態を取得
router.get('/cache/status', (req, res) => {
  const cacheKeys = Array.from(store.resultCache.keys());
  const cacheEntries = Array.from(store.resultCache.entries()).map(([key, value]) => ({
    key,
    cachedAt: value.cachedAt,
    factory: value.factory,
    sessionId: value.sessionId,
  }));
  
  res.json({
    cacheCount: cacheKeys.length,
    entries: cacheEntries,
  });
});

// キャッシュをクリア
router.delete('/cache', (req, res) => {
  const count = store.resultCache.size;
  store.resultCache.clear();
  res.json({
    status: 'ok',
    clearedCount: count,
    message: `${count}件のキャッシュをクリアしました`,
  });
});

// デモ用：キャッシュをテストするエンドポイント
router.post('/cache/test', (req, res) => {
  res.json({
    message: 'キャッシュ機能のデモエンドポイント',
    note: '実際のフローは仕事の実行時に自動的に適用されます',
  });
});

export default router;
