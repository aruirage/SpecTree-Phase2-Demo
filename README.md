# SpecTree Phase 2 Demo

二期演示用原型。前端为 Vue 3 + Vite + Element Plus，后端为 Express 模拟服务；数据保存在内存中，不连接真实 DB / LLM。

## 目录结构

```text
phase2-demo/
├── backend/                 # Express Mock API
│   ├── src/
│   │   ├── routes/          # 规格树、新旧比较、任务、日志、License 等接口
│   │   ├── mockData.js      # 演示用模拟数据
│   │   └── store.js         # 内存状态
│   └── server.js            # 本地 Mock 服务入口，默认端口 3002
├── frontend/                # Vue 3 + Vite + Element Plus
│   ├── src/
│   │   ├── api/             # 前端 API 封装
│   │   ├── components/      # 共通组件
│   │   ├── layouts/         # 共通布局
│   │   ├── router/          # 路由配置
│   │   ├── services/        # 导出、展示用前端服务
│   │   ├── styles/          # 设计 token
│   │   ├── utils/           # 表格、Tab、时间等工具
│   │   └── views/
│   │       ├── SpecTree/          # スペックツリー：生成 / タスク管理
│   │       ├── ClauseComparison/  # スペック新旧比較：比較実行 / タスク管理
│   │       └── SystemLogs/        # 利用状況管理
│   └── vite.config.js       # 本地开发代理到 backend:3002
├── package.json             # npm workspaces / Vercel build 入口
└── vercel.json              # Vercel 部署配置
```

> Phase 2 Demo 不包含 Prompt 设置页面，也不暴露 Prompt CRUD API。

## 本地运行

安装依赖：

```bash
npm install
```

启动后端：

```bash
npm run dev:backend
```

启动前端：

```bash
npm run dev:frontend
```

本地预览地址：

```text
http://localhost:8888
```

健康检查：

```text
http://localhost:3002/health
```

## 页面

| 菜单 | 路由 | 说明 |
| --- | --- | --- |
| スペックツリー | `/spec-tree` | 上传规格树文件，生成层级树，查看任务和下载结果 |
| スペック新旧比較 | `/clause-comparison` | 上传新旧文件，执行比较，查看任务和下载结果 |
| 利用状況管理 | `/system-logs` | 查看使用量、处理页数、总页数、导出操作日志和结算用计数文件 |
| 今月の利用状況 | 弹窗 | 右上角 License / 保存期限信息 |

## Mock API

后端入口：`backend/src/app.js`

主要接口：

| 模块 | Prefix |
| --- | --- |
| スペックツリー | `/api/spec-tree` |
| スペック新旧比較 | `/api/clause-compare` |
| タスク | `/api/jobs` |
| License | `/api/license` |
| 利用状況 / 操作ログ | `/api/logs` |
| システム计数文件 | `/api/system` |

## 构建与测试

构建前端：

```bash
npm run build
```

运行测试：

```bash
npm test
```

## Vercel 部署

仓库根目录已经包含 `vercel.json`，Vercel 连接 GitHub 仓库后使用根目录部署即可。

建议设置：

```text
Framework Preset: Other
Root Directory: ./
Build Command: npm run vercel-build
Output Directory: frontend/dist
Install Command: npm install
Node.js Version: 24.x
```

当前配置通过 `vercel.json` 将静态前端和 Mock API 分别部署：

- 前端：`frontend/`
- 后端：`backend/`
- `/api/*` 与 `/health` 转发到后端
- 其他路径转发到前端 SPA

## 说明

- 本项目是演示原型，后端数据为内存 Mock，服务重启后状态会重置。
- 导出的 Excel / ZIP 为演示格式，用于确认 UI、字段、文件命名和下载流程。
- 一期 demo 不属于本项目部署范围，提交时不要包含 `frontend-phase1/`。
