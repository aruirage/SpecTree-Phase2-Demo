# AI 交接文档 — LLM OCR 二期 UI 与前端实现

> **用途：** 复制本文档（或下方「启动 Prompt」）给其他 AI，在其上继续改 UI、接 API、拆分组件。  
> **项目路径：** `演示Demo/`（Vue3 前端 + Express 后端 Demo）  
> **原则：** 交互怎么方便怎么来、实现怎么简单怎么来。

---

## 一、启动 Prompt（复制给其他 AI）

```
你是高级 Vue3 前端工程师，正在改 LLM OCR（大金 SpecTree / SpecDiff）二期 UI。

请先阅读项目内以下文件（按顺序）：
1. docs/AI-UI二期交接.md（本文档）
2. docs/UI设计方案.md
3. vue_ai_prompt_template.md（工程规范，必须遵守）

约束：
- 技术栈：Vue3 + script setup + JS + Vite + Element Plus + SCSS
- UI 文案默认日语（与现有页面一致）
- 品牌色 #0076BF，深色侧栏 #1a2332
- 页面禁止直接 fetch/axios，走 api → services → views
- 不要推翻现有双栏布局，在其上增量改
- 不要新增独立 License 页、Excel 资源库页、Dashboard 大页
- 单 vue 文件不要超过 ~300 行，必须拆子组件

当前任务：[在这里写具体任务，例如「实现 P1：规格树页 Excel 两入口 + registry」]
```

---

## 二、项目是什么

**LLM OCR** = 规格树生成 + 规格新旧条款对比，面向日文用户（UI 日语）。

| 模块 | 路由 | 说明 |
|------|------|------|
| スペックツリー | `/spec-tree` | 上传 PDF/TIF，选 Root，生成引用关系 Mermaid 树 |
| スペック新旧比較 | `/clause-comparison` | 旧/新 PDF 对比，字句高亮，日语译文 |
| タスク一覧 | `/tasks` | 全局任务队列（类百度云下载列表） |
| プロンプト設定 | `/prompts` | 4 处 Prompt 编辑 |
| License | 侧栏 Widget + 弹窗 | 非路由 |

**一期现状：** Demo 用 Mock；真实 AI 后端已在现网跑通，本仓库后端仍是 Mock，二期会换 PostgreSQL + 真 Job。

**启动：**

```bash
# 后端
cd backend && npm install && npm start   # http://localhost:3001

# 前端
cd frontend && npm install && npm run dev  # 默认 8080，proxy /api
```

---

## 三、已实现 vs 待实现

### ✅ 已完成（P0 骨架）

| 项 | 文件 |
|----|------|
| 侧栏 4 路由 | `frontend/src/layouts/default.vue` |
| 路由 | `frontend/src/router/routes.js` |
| Design Tokens | `frontend/src/styles/tokens.scss` |
| License Widget | `frontend/src/components/LicenseWidget.vue` |
| License Modal 骨架 | `frontend/src/components/LicenseModal.vue` |
| 任务列表占位 | `frontend/src/views/Tasks/index.vue`（硬编码 demo 数据） |
| Prompt 页骨架 | `frontend/src/views/Prompts/index.vue`（未接 API） |
| 规格树页 | `frontend/src/views/SpecTree/index.vue`（~1000 行，仅 PDF，用 sessionId） |
| 条款对比页 | `frontend/src/views/ClauseComparison/index.vue`（~1300 行，用 sessionId） |

### ❌ 待实现（按优先级）

| 阶段 | 内容 | 关键文件 |
|------|------|----------|
| **P1** | 规格树：PDF/TIF + 补全 Excel + 删除 Excel 三入口；registry「当前文件+更换」 | `SpecTree/index.vue` + 新组件 |
| **P2** | 任务列表接 `GET /api/jobs`；查看跳转 `?jobId=` | `Tasks/index.vue`, `api/jobs.js` |
| **P3** | 对比页：四分类 Badge、StatusBanner、三阶段进度 | `ClauseComparison/` |
| **P4** | Prompt 页接 CRUD API | `Prompts/`, `api/prompts.js` |
| **P5** | License Widget/Modal 接 API；CSV/审计导出按钮 | `License*.vue` |
| **P6** | 拆分 SpecTree / ClauseComparison 巨型单文件 | 见目录结构建议 |
| **P7** | 抽共用组件 | `components/` 见 UI 设计文档 |

---

## 四、UI 信息架构（定稿，勿改）

```
侧栏
├── スペックツリー          /spec-tree
├── スペック新旧比較        /clause-comparison
├── タスク一覧              /tasks
├── プロンプト設定          /prompts
└─ [利用状況 Widget]        → LicenseModal 弹窗
```

**刻意不做：** 主菜单子菜单、License 独立页、Excel 资源库管理页、Dashboard 图表页、Word 上传。

---

## 五、规格树业务规则（UI 必须体现）

### 5.1 抽取规则 R1～R6

| # | 规则 |
|---|------|
| R1 | 读全部文件 → 规范编号、名称、修订、子规范引用 |
| R2 | 从 Applicable / Referenced Documents 段识别子规范 |
| R3 | 用户指定 Root（二期可多根） |
| R4 | **无 PDF 的引用**（可能是网站）→ 不递归；用 **补全 Excel** 向父节点插入子节点 |
| R5 | 有 PDF → 递归读取 |
| R6 | 未被引用 → -1 层，不输出子级 |

### 5.2 三个独立上传入口（顺序由后端固定，与上传先后无关）

| 入口 | 格式 | 结构 | 处理阶段 |
|------|------|------|----------|
| ① 规格文档 | PDF、TIF | 多文件 | extract + LLM |
| ② 補完リスト | Excel | **多 Sheet，Sheet 名 = 插入的父节点** | 补全插入 |
| ③ 削除対象リスト | Excel | **单 Sheet，左 Spec Number / 右 Spec 名称** | 全局匹配删除+级联 |

**流水线：** ① PDF/TIF + LLM → ② 补全 Excel → ③ 删除 Excel → 最终树

### 5.3 Excel 长期复用（轻量，无资源库页）

- 系统各保留 **一份当前 Excel**（按 site 一行配置）
- 规格树页显示：`当前：xxx.xlsx` + **[更换]**
- 日常只传 PDF/TIF + Root；②③ 默认用当前文件
- Job 创建时 **快照 file_id**，换 Excel 不影响历史

### 5.4 规格树页 UI 线框

```
┌─ 左 Panel 320px ─────────────────┐
│ ① 規格文档（PDF/TIF）  [拖拽区]   │
│ ルート指定 [下拉/多选]            │
│ ② 補完リスト  当前：xxx  [更换]   │
│ ③ 削除リスト  当前：yyy  [更换]   │
│ [ 生成を開始 ]                    │
└──────────────────────────────────┘
┌─ 右 Panel ───────────────────────┐
│ Mermaid + 缩放/导出               │
└──────────────────────────────────┘
```

进度四阶段文案：`PDF/TIF解析 → LLM生成 → 補完適用 → 削除適用`

---

## 六、条款对比业务规则

### 6.1 变更分类（固定四枚举）

| 值 | 含义 | 日文 |
|----|------|------|
| `added` | 新增 | 追加 |
| `deleted` | 删除 | 削除 |
| `changed` | 变更 | 変更 |
| `unchanged` | 无 | 変更なし |

由 `cross_clause` 一步输出，**不单独第五 Prompt**。纯新增/删除 **不做字句级高亮**。

### 6.2 流水线三阶段

`extract → cross_clause → translate`（一次 run 串行；二期可选异步 translate，当前从简不做）

### 6.3 UI 增强

- 过滤：全部 / 新增 / 删除 / 变更 / 无
- StatusBanner：Prompt 过期、缓存命中
- 颜色见 `tokens.scss` 中 `--change-*`

---

## 七、任务管理 UI

- **一张表**混排规格树 + 对比任务（`/tasks`）
- 状态：`queued | running | completed | failed | cancelled`（二期 v1 **可不做 paused**，只做停止+再执行）
- 操作：查看 → 跳业务页 `?jobId=`；running → 停止；完成/失败 → 再执行
- 进度：running 显示 % + 阶段文案

**心智模型变更：** 废弃页面级 `sessionId` 为主键，改为 `fileId` 上传 + `jobId` 任务。

---

## 八、Prompt 管理 UI

**一个页面两个 Tab：**

| Tab | Prompt key |
|-----|------------|
| スペックツリー | `spec_tree.pipeline`（1 卡片） |
| スペック新旧比較 | `clause_compare.extract`、`cross_clause`、`translate`（3 卡片） |

保存后 toast：**仅对新任务生效，历史不自动更新**（方案 A）。

---

## 九、License 与日志 UI

### Widget（侧栏底部）

- 今月 `used / max` ページ + 进度条
- 余量 < 20% 橙色，< 10% 或过期红色
- 点击 → `LicenseModal`

### Modal

- 拠点、有效期、剩余页数
- 上传 License 文件
- **[使用ログ CSV 导出]** — 四列：拠点、日時、処理量（ページ数）、処理内容（差分抽出/ツリー作成）
- **[監査ログ导出]** — 管理员；加密防篡改全量

**日志后端设计：** 一张 `system_events` 表，两种导出格式（CSV 子集 vs 审计全量）。前端只调导出 API。

---

## 十、Design Tokens（必须用）

文件：`frontend/src/styles/tokens.scss`

| 变量 | 值 |
|------|-----|
| `--color-primary` | `#0076BF` |
| `--color-bg-page` | `#f0f2f5` |
| `--left-panel-width` | `320px` |
| 侧栏背景 | `#1a2332` |

新组件优先用 CSS 变量，不要另起一套色板。

---

## 十一、推荐目录结构（拆分目标）

```
frontend/src/
├── api/
│   ├── specTree.js          # 已有
│   ├── clauseComparison.js  # 已有
│   ├── jobs.js              # 待建
│   ├── prompts.js           # 待建
│   └── license.js           # 待建
├── services/                # 对应 api 封装
├── components/
│   ├── FileUploadZone.vue       # 待建
│   ├── ExcelCurrentFile.vue     # 待建
│   ├── StatusBanner.vue         # 待建
│   ├── ProgressBlock.vue        # 待建
│   ├── JobStatusBadge.vue       # 待建
│   ├── LicenseWidget.vue        # 已有
│   └── LicenseModal.vue         # 已有
├── views/
│   ├── SpecTree/
│   │   ├── index.vue            # 编排 <200 行
│   │   ├── SpecTreeConfig.vue   # 左 Panel
│   │   └── SpecTreeCanvas.vue   # 右 Mermaid
│   ├── ClauseComparison/        # 同理拆分
│   ├── Tasks/index.vue
│   └── Prompts/index.vue
└── styles/tokens.scss
```

---

## 十二、后端 API 契约（前端按此对接，后端可逐步实现）

### 已有 Mock API

```
POST /api/spec-tree/upload
POST /api/spec-tree/generate   body: { sessionId, rootFileId }
GET  /api/spec-tree/export

POST /api/clause-compare/upload
POST /api/clause-compare/run
GET  /api/clause-compare/export
```

### 二期新增（前端先 mock 或 stub）

```
# Excel registry
GET  /api/spec-tree/excel
PUT  /api/spec-tree/excel/supplement    multipart
PUT  /api/spec-tree/excel/deletion      multipart

# Jobs
GET  /api/jobs?type=&status=
GET  /api/jobs/:id                      # 含 isOutdated, cacheHit, progress
POST /api/spec-tree/jobs                # 创建规格树任务
POST /api/clause-compare/run            # 扩展为 job 化
POST /api/jobs/:id/cancel
POST /api/jobs/:id/rerun

# Prompts
GET  /api/prompts
GET  /api/prompts/:key
PUT  /api/prompts/:key
POST /api/prompts/:key/reset

# License & logs
GET  /api/license/current
POST /api/license/upload
GET  /api/logs/export?format=csv|audit&from=&to=
```

### Job 响应建议字段（前端依赖）

```js
{
  id: 'uuid',
  type: 'spec_tree' | 'clause_compare',
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled',
  progress: 67,
  progressLabel: 'PDF/TIF を解析中…',
  promptSnapshot: { 'clause_compare.extract': { version: 3 } },
  isOutdated: false,
  cacheHit: { extract: true, cross: false, translate: true },
  createdAt: 'ISO8601',
}
```

---

## 十三、工程规范摘要

完整规范见 `vue_ai_prompt_template.md`。核心：

1. **分层：** `views` 只调 `services`，`services` 调 `api`，禁止页面里 `fetch`
2. **拆分：** 单文件巨型逻辑必须拆组件；SpecTree/ClauseComparison 是当前技术债
3. **状态：** 页面临时用 `ref/reactive`；仅全局用户/License 等用 Pinia
4. **Mock：** 若 API 未就绪，mock 放 `services` 或 `mock/`，结构对齐真实 API，不要硬编码在 template
5. **样式：** `<style scoped lang="scss">`，用 tokens
6. **语言：** UI 字符串日语；代码注释中/日均可

---

## 十四、常见错误（其他 AI 请勿）

| ❌ 不要 | ✅ 应该 |
|--------|--------|
| 做 Excel 资源库独立管理页 | 规格树页「当前文件 + 更换」 |
| 做 License 独立路由页 | Widget + Modal |
| 删除列表按 Sheet 分父节点 | **单 Sheet 两列**，全局 Spec Number 匹配 |
| 补全与删除共用一个 Excel 入口 | **两个独立入口**，上传时校验格式 |
| 支持 Word | 仅 PDF/TIF + 两类 Excel |
| Prompt 变更自动重跑历史 | 方案 A：Banner + 手动再执行 |
| 页面里直接 fetch | api → services → views |
| 推翻侧栏双栏布局 | 增量改左 Panel |

---

## 十五、分任务示例（可直接指派给其他 AI）

### 任务 A — P1 规格树 Excel

```
1. 新建 components/ExcelCurrentFile.vue
2. 在 SpecTree 左 Panel 增加 ②补全 ③删除 两个 ExcelCurrentFile
3. 新增 api/specTree.js + services 方法：getExcelRegistry, uploadSupplement, uploadDeletion
4. 扩展 accept：文档区 .pdf,.tif；Excel 区仅 .xlsx
5. 更换前 confirm dialog；上传失败 toast
6. 若后端未就绪，services 内 mock registry 响应
```

### 任务 B — P6 拆分 SpecTree

```
1. 把 index.vue 拆为 SpecTreeConfig.vue + SpecTreeCanvas.vue
2. index.vue 只保留状态编排与 API 调用
3. 行为与拆分前一致，npm run build 通过
```

### 任务 C — P2 任务列表

```
1. 新建 api/jobs.js + services/jobs.js
2. Tasks/index.vue 接 getJobs()，去掉硬编码
3. 「結果を見る」→ router.push({ path, query: { jobId } })
4. SpecTree/ClauseComparison 读取 route.query.jobId 加载历史（可先 stub）
```

---

## 十六、相关文档索引

| 文件 | 内容 |
|------|------|
| `docs/UI设计方案.md` | UI 线框、组件清单、验收项 |
| `docs/AI-UI二期交接.md` | 本文档 — 业务 + API + 任务拆分 |
| `vue_ai_prompt_template.md` | 前端工程规范 |
| `README.md` | Demo 使用说明（日语） |

---

## 十七、方案一句话

> 4 路由 + License Widget；规格树三入口（PDF/TIF、补全 Excel、删除 Excel）+ registry 复用；任务一张表；Prompt 一页两 Tab；统一 tokens 与 Banner；Session 迁移到 Job；实现从简、交互从简。
