# Phase 2 Demo

基于 **一期前端**（`frontend.zip`）扩展的二期 UI Demo，与 [../docs/phase2-design.md](../docs/phase2-design.md) 对齐。

## 目录结构

```
phase2-demo/
├── backend/           # Express 模拟后端（内存数据，无真实 LLM/DB）
└── frontend/          # Vue3 + Vite + Element Plus
    ├── src/views/
    │   ├── SpecTree/       # Tab：生成 | 履歴
    │   ├── ClauseComparison/
    │   └── Prompts/        # 独立提示词页
    └── vite.config.js      # API 代理 → localhost:3002
```

## 本地运行

**终端 1 — 模拟后端**

```bash
cd backend && npm install && npm start
```

**终端 2 — 前端**

```bash
cd frontend && npm install && npm run dev
```

**浏览地址：** http://localhost:8888

Vite 将 `/api/*` 代理到 `http://0.0.0.0:3002`。健康检查：`GET http://localhost:3002/health`

## 侧栏

| 菜单 | 路由 |
|------|------|
| スペックツリー | `/spec-tree`（生成 + 履歴） |
| スペック新旧比較 | `/clause-comparison` |
| プロンプト設定 | `/prompts` |
| 今月の利用状況 | License 弹窗 |

## 模拟 API

详见 `backend/src/routes/` — Prompt、Jobs、License、Excel config、规格树/条款对比均为 Mock。

### License 数据保留（Mock）

- `GET /api/license/current` 返回 `retentionDays: 45`、`licenseStartedAt`、`dataClearAt`（起算日 + 45 日周期推算的次回一括削除日時）
- Demo 起算日 `2026-05-17` → 次回削除 **`2026-07-01`** 前后（静态展示用）
- 生产环境由定时任务（cron）在 `dataClearAt` 到达时删除 jobs / 结果等全部履歴；本 Demo 不执行真实删除，仅展示字段与说明

## 状态

- [x] UI 骨架 + Mock 后端
- [x] Prompt / Jobs / License / Excel 基础联调
- [ ] 真实 PostgreSQL / LLM（生产二期）
