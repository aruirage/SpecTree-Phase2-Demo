<script setup>
import { ref, onMounted, computed } from 'vue';
import { ElMessage, ElTable, ElTableColumn } from 'element-plus';
import { fetchSystemLogs, downloadLogExport } from '@/api/logs';
import { 
  getQueueStatus, 
  getFactoryInfo, 
} from '@/api/system';
import {
  filterSystemLogs,
  formatLogDateTime,
  formatLogFeature,
  formatLogPageCount,
  formatLogStatus,
  formatLogTarget,
  formatLogTotalPageCount,
  getVisiblePageNumbers,
  LOG_FEATURE_FILTERS,
  paginateItems,
  sortSystemLogs,
} from '@/utils/systemLogs';

const logs = ref([]);
const loading = ref(false);
const queueStatus = ref(null);
const factoryInfo = ref(null);
const filterForm = ref({
  dateRange: [],
  keyword: '',
  feature: '',
});
const appliedFilters = ref({
  dateRange: [],
  keyword: '',
  feature: '',
});
const currentPage = ref(1);
const pageSize = ref(10);
const jumpPage = ref(1);
const tableSort = ref({
  prop: '',
  order: '',
});

async function loadLogs() {
  loading.value = true;
  try {
    const data = await fetchSystemLogs();
    logs.value = data.events || [];
  } catch (e) {
    ElMessage.error('ログの取得に失敗しました');
    console.error(e);
  } finally {
    loading.value = false;
  }
}

async function loadSystemStatus() {
  try {
    queueStatus.value = await getQueueStatus();
    factoryInfo.value = await getFactoryInfo();
  } catch (e) {
    console.error('Failed to load system status', e);
  }
}

function handleExportCsv() {
  downloadLogExport('csv');
  ElMessage.success('CSVファイルのダウンロードを開始しました');
}

function handleSearch() {
  appliedFilters.value = {
    dateRange: [...(filterForm.value.dateRange || [])],
    keyword: filterForm.value.keyword,
    feature: filterForm.value.feature,
  };
  currentPage.value = 1;
  jumpPage.value = 1;
}

function handleReset() {
  filterForm.value = {
    dateRange: [],
    keyword: '',
    feature: '',
  };
  handleSearch();
}

onMounted(async () => {
  await Promise.all([loadLogs(), loadSystemStatus()]);
  
  // 定期的にキュー状態を更新
  setInterval(loadSystemStatus, 5000);
});

const processedPages = computed(() => {
  return filteredLogs.value.reduce((sum, log) => sum + formatLogPageCount(log), 0);
});

const totalPages = computed(() => {
  return filteredLogs.value.reduce((sum, log) => sum + formatLogTotalPageCount(log), 0);
});

const filteredLogs = computed(() => filterSystemLogs(logs.value, appliedFilters.value));
const sortedLogs = computed(() => sortSystemLogs(filteredLogs.value, tableSort.value));
const totalLogPages = computed(() => Math.max(1, Math.ceil(filteredLogs.value.length / pageSize.value)));
const pagedLogs = computed(() => paginateItems(sortedLogs.value, currentPage.value, pageSize.value));
const visiblePageNumbers = computed(() => getVisiblePageNumbers(currentPage.value, totalLogPages.value));

function goToPage(page) {
  currentPage.value = Math.min(Math.max(1, Number(page) || 1), totalLogPages.value);
  jumpPage.value = currentPage.value;
}

function handlePageSizeChange() {
  goToPage(1);
}

function handleJumpPage() {
  goToPage(jumpPage.value);
}

function handleSortChange({ prop, order }) {
  tableSort.value = { prop: prop || '', order: order || '' };
  goToPage(1);
}

</script>

<template>
  <div class="system-logs-page">
    <div class="page-header">
      <div class="header-left">
        <h1 class="page-title">システムログ</h1>
        <p class="page-subtitle">処理実行履歴と利用状況の確認</p>
      </div>
      <button class="btn btn-primary download-button" @click="handleExportCsv">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-sm">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        ダウンロード
      </button>
    </div>

    <div class="overview-section">
      <!-- 工場情報表示 -->
      <div class="info-card">
        <div class="info-label">接続元拠点</div>
        <div class="info-value" :class="{ 'unknown': factoryInfo?.factory === '不明' }">
          {{ factoryInfo?.factory || '-' }}
        </div>
        <div class="info-meta">IP: {{ factoryInfo?.ipAddress || '-' }}</div>
      </div>

      <div class="stats-cards">
        <div class="stat-card">
          <div class="stat-label">処理ページ数</div>
          <div class="stat-number">
            <span class="stat-value">{{ processedPages }}</span>
            <span class="stat-unit">ページ</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">総ページ数</div>
          <div class="stat-number">
            <span class="stat-value">{{ totalPages }}</span>
            <span class="stat-unit">ページ</span>
          </div>
        </div>
        <div class="stat-card" v-if="queueStatus">
          <div class="stat-label">待ちタスク</div>
          <div class="stat-number">
            <span class="stat-value">{{ queueStatus.queued }}</span>
            <span class="stat-unit">件</span>
          </div>
        </div>
        <div class="stat-card" v-if="queueStatus">
          <div class="stat-label">実行中</div>
          <div class="stat-number">
            <span class="stat-value">{{ queueStatus.running }}</span>
            <span class="stat-unit">件</span>
          </div>
        </div>
      </div>
    </div>

    <!-- キュー状態表示 -->
    <div class="system-status-section" v-if="queueStatus && queueStatus.queue.length > 0">
      <h3 class="section-title">タスクキュー</h3>
      <div class="queue-list">
        <div class="queue-item" v-for="item in queueStatus.queue" :key="item.runId">
          <div class="queue-item-title">
            {{ item.type === 'spec_tree' ? 'スペックツリー' : 'スペック新旧比較' }}
          </div>
          <div class="queue-item-meta">
            <span class="badge" style="background: #0066cc">待ち</span>
            <span class="queue-factory">{{ item.factory }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="logs-table-container">
      <div class="logs-toolbar">
        <el-date-picker
          v-model="filterForm.dateRange"
          class="filter-date"
          style="width: 260px; flex: 0 0 260px"
          type="daterange"
          range-separator="〜"
          start-placeholder="開始日"
          end-placeholder="終了日"
          value-format="YYYY-MM-DD"
          clearable
        />
        <el-input
          v-model="filterForm.keyword"
          class="filter-keyword"
          style="width: 190px"
          placeholder="キーワード"
          clearable
          @keyup.enter="handleSearch"
        />
        <el-select
          v-model="filterForm.feature"
          class="filter-feature"
          style="width: 170px"
          placeholder="機能"
          clearable
        >
          <el-option
            v-for="item in LOG_FEATURE_FILTERS"
            :key="item.value"
            :label="item.text"
            :value="item.value"
          />
        </el-select>
        <button class="btn btn-primary btn-icon-only" title="検索" aria-label="検索" @click="handleSearch">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-sm">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </button>
        <button class="btn btn-outline btn-icon-only" title="リセット" aria-label="リセット" @click="handleReset">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="icon-sm">
            <path d="M3 12a9 9 0 0 1 15.55-6.2"/>
            <path d="M21 12a9 9 0 0 1-15.55 6.2"/>
            <polyline points="18 2 18 6 22 6"/>
            <polyline points="6 22 6 18 2 18"/>
          </svg>
        </button>
      </div>
      <el-table
        :data="pagedLogs"
        v-loading="loading"
        stripe
        fit
        style="width: 100%"
        @sort-change="handleSortChange"
      >
        <el-table-column
          prop="at"
          label="利用日時"
          min-width="160"
        >
          <template #default="{ row }">
            {{ formatLogDateTime(row.at) }}
          </template>
        </el-table-column>
        <el-table-column
          prop="ipAddress"
          label="IP"
          min-width="130"
        />
        <el-table-column
          prop="site"
          label="工場・拠点"
          min-width="120"
        />
        <el-table-column
          prop="feature"
          label="機能"
          min-width="140"
        >
          <template #default="{ row }">
            {{ formatLogFeature(row.feature) }}
          </template>
        </el-table-column>
        <el-table-column
          prop="note"
          label="操作対象"
          min-width="180"
          show-overflow-tooltip
        >
          <template #default="{ row }">
            {{ formatLogTarget(row) }}
          </template>
        </el-table-column>
        <el-table-column
          prop="pages"
          label="処理ページ数"
          min-width="130"
          sortable="custom"
        >
          <template #default="{ row }">
            <span class="pages-count">{{ formatLogPageCount(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column
          prop="totalPages"
          label="総ページ数"
          min-width="130"
          sortable="custom"
        >
          <template #default="{ row }">
            <span class="pages-count">{{ formatLogTotalPageCount(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column
          label="処理結果"
          min-width="120"
        >
          <template #default="{ row }">
            <span class="status-pill" :class="`status-pill--${formatLogStatus(row)}`">
              {{ formatLogStatus(row) }}
            </span>
          </template>
        </el-table-column>
      </el-table>
      <div class="logs-pagination">
        <span class="pagination-total">検索結果 {{ filteredLogs.length }} 件中</span>
        <el-select
          v-model="pageSize"
          class="page-size-select"
          style="width: 128px"
          @change="handlePageSizeChange"
        >
          <el-option :value="10" label="10件ずつ" />
          <el-option :value="20" label="20件ずつ" />
          <el-option :value="50" label="50件ずつ" />
        </el-select>
        <button
          class="page-button"
          :disabled="currentPage === 1"
          aria-label="前のページ"
          @click="goToPage(currentPage - 1)"
        >
          ‹
        </button>
        <template v-for="page in visiblePageNumbers" :key="page">
          <span v-if="String(page).startsWith('ellipsis')" class="page-ellipsis">...</span>
          <button
            v-else
            class="page-button"
            :class="{ 'is-active': currentPage === page }"
            @click="goToPage(page)"
          >
            {{ page }}
          </button>
        </template>
        <button
          class="page-button"
          :disabled="currentPage === totalLogPages"
          aria-label="次のページ"
          @click="goToPage(currentPage + 1)"
        >
          ›
        </button>
        <el-input
          v-model.number="jumpPage"
          class="jump-input"
          style="width: 56px"
          @keyup.enter="handleJumpPage"
          @blur="handleJumpPage"
        />
        <span class="pagination-go">ページへ</span>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.system-logs-page {
  padding: 24px;
  height: 100%;
  overflow: auto;
  background: #f5f7fa;
  font-size: var(--font-size-base);
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e4e7ed;
}

.header-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.page-title {
  margin: 0;
  font-size: var(--font-size-page-title);
  font-weight: 700;
  color: #0f172a;
}

.page-subtitle {
  margin: 0;
  font-size: var(--font-size-caption);
  color: #64748b;
}

.download-button {
  flex-shrink: 0;
}

.overview-section {
  display: grid;
  grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
  gap: 16px;
  align-items: stretch;
  margin-bottom: 24px;
}

.info-card {
  background: white;
  min-height: 80px;
  padding: 14px 20px;
  border-radius: 8px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  text-align: center;
}

.info-label {
  font-size: 12px;
  color: #909399;
  text-transform: uppercase;
}

.info-value {
  font-size: clamp(20px, 1.8vw, 26px);
  line-height: 1;
  font-weight: 700;
  color: #0076bf;
  
  &.unknown {
    color: #e6a700;
  }
}

.info-meta {
  font-size: var(--font-size-caption);
  color: #606266;
}

.stats-cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(150px, 1fr));
  gap: 16px;
}

.stat-card {
  background: white;
  min-height: 80px;
  padding: 14px 18px;
  border-radius: 8px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  text-align: center;
}

@media (max-width: 1180px) {
  .overview-section {
    grid-template-columns: 1fr;
  }

  .stats-cards {
    grid-template-columns: repeat(2, minmax(180px, 1fr));
  }
}

@media (max-width: 720px) {
  .stats-cards {
    grid-template-columns: 1fr;
  }
}

.stat-label {
  font-size: var(--font-size-base);
  color: #64748b;
  line-height: 1.3;
  white-space: nowrap;
}

.stat-number {
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
  gap: 6px;
  min-width: 0;
}

.stat-value {
  font-size: clamp(24px, 1.8vw, 32px);
  line-height: 1;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}

.stat-unit {
  font-size: clamp(12px, 0.9vw, 14px);
  line-height: 1.2;
  color: #64748b;
  white-space: nowrap;
}

.system-status-section {
  margin-bottom: 24px;
}

.section-title {
  font-size: var(--font-size-title);
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 12px 0;
}

.queue-list {
  background: white;
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.05);
}

.queue-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid #e4e7ed;
  
  &:last-child {
    border-bottom: none;
  }
}

.queue-item-title {
  font-weight: 500;
  color: #303133;
}

.queue-item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  color: white;
}

.queue-factory {
  font-size: 13px;
  color: #606266;
}

.logs-table-container {
  background: white;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.05);
}

.logs-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.filter-date {
  width: 260px !important;
  flex: 0 0 260px;
}

.filter-keyword {
  width: 190px;
}

.filter-feature {
  width: 170px;
}

.pages-count {
  font-weight: 500;
  color: #0076bf;
}

:deep(.el-table th .cell) {
  white-space: nowrap;
}

:deep(.el-table .caret-wrapper) {
  flex-shrink: 0;
}

.status-pill {
  display: inline;
  min-width: 0;
  height: auto;
  padding: 0;
  border-radius: 0;
  font-size: 12px;
  font-weight: 600;
  color: #475569;
}

.logs-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #e2e8f0;
  color: #606266;
}

.pagination-total,
.pagination-go {
  font-size: var(--font-size-base);
  white-space: nowrap;
}

.page-size-select {
  margin: 0 8px;
}

.page-button,
.page-ellipsis {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 2px;
  font-size: var(--font-size-base);
  font-weight: 500;
}

.page-button {
  border: none;
  background: #f1f5f9;
  color: #334155;
  cursor: pointer;
}

.page-button:hover:not(:disabled) {
  background: #e2e8f0;
}

.page-button:disabled {
  cursor: not-allowed;
  color: #cbd5e1;
  background: #f8fafc;
}

.page-button.is-active {
  background: var(--color-primary);
  color: #ffffff;
}

.page-ellipsis {
  background: #f1f5f9;
  color: #334155;
}

.jump-input {
  margin-left: 20px;
}

.status-pill--成功 {
  color: #047857;
}

.status-pill--処理中 {
  color: #1d4ed8;
}

.status-pill--失敗,
.status-pill--中止 {
  color: #b91c1c;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 10px 16px;
  border-radius: 6px;
  font-size: var(--font-size-base);
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}

.btn-primary {
  background: var(--color-primary);
  color: white;
}

.btn-primary:hover {
  background: var(--color-primary-hover);
}

.btn-secondary {
  background: white;
  color: #606266;
  border: 1px solid #dcdfe6;
}

.btn-secondary:hover {
  background: #f5f7fa;
}

.btn-outline {
  background: #ffffff;
  color: #374151;
  border: 1px solid #d1d5db;
}

.btn-outline:hover {
  background: #f8fafc;
  border-color: #9ca3af;
  color: #1f2937;
}

.btn-icon-only {
  justify-content: center;
  width: 40px;
  padding: 0;
}

.icon-sm {
  width: 18px;
  height: 18px;
}
</style>
