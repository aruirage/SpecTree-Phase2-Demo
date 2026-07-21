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
  formatLogFeature,
  formatLogStatus,
  formatLogTarget,
  LOG_FEATURE_FILTERS,
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

const totalPages = computed(() => {
  return logs.value.reduce((sum, log) => sum + (Number(log.pages) || 0), 0);
});

const filteredLogs = computed(() => filterSystemLogs(logs.value, appliedFilters.value));

</script>

<template>
  <div class="system-logs-page">
    <div class="page-header">
      <div class="header-left">
        <h1 class="page-title">システムログ</h1>
        <p class="page-subtitle">処理実行履歴と利用状況の確認</p>
      </div>
    </div>

    <!-- 工場情報表示 -->
    <div class="info-section" v-if="factoryInfo">
      <div class="info-card">
        <div class="info-label">接続元拠点</div>
        <div class="info-value" :class="{ 'unknown': factoryInfo.factory === '不明' }">
          {{ factoryInfo.factory }}
        </div>
        <div class="info-meta">IP: {{ factoryInfo.ipAddress }}</div>
      </div>
    </div>

    <div class="stats-cards">
      <div class="stat-card">
        <div class="stat-label">総処理数</div>
        <div class="stat-value">{{ logs.length }}</div>
        <div class="stat-unit">件</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">総ページ数</div>
        <div class="stat-value">{{ totalPages }}</div>
        <div class="stat-unit">ページ</div>
      </div>
      <div class="stat-card" v-if="queueStatus">
        <div class="stat-label">待ちタスク</div>
        <div class="stat-value">{{ queueStatus.queued }}</div>
        <div class="stat-unit">件</div>
      </div>
      <div class="stat-card" v-if="queueStatus">
        <div class="stat-label">実行中</div>
        <div class="stat-value">{{ queueStatus.running }}</div>
        <div class="stat-unit">件</div>
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
        <button class="btn btn-primary" @click="handleSearch">検索</button>
        <button class="btn btn-secondary" @click="handleReset">リセット</button>
        <button class="btn btn-secondary" @click="handleExportCsv">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-sm">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          ダウンロード
        </button>
      </div>
      <el-table
        :data="filteredLogs"
        v-loading="loading"
        stripe
        style="width: 100%"
      >
        <el-table-column
          prop="at"
          label="操作日時"
          width="180"
        />
        <el-table-column
          prop="ipAddress"
          label="IP"
          width="150"
        />
        <el-table-column
          prop="site"
          label="工場・拠点"
          width="140"
        />
        <el-table-column
          prop="feature"
          label="機能"
          width="150"
        >
          <template #default="{ row }">
            {{ formatLogFeature(row.feature) }}
          </template>
        </el-table-column>
        <el-table-column
          prop="actionType"
          label="操作種別"
          width="130"
        >
          <template #default="{ row }">
            <span class="action-type">
              {{ row.actionType }}
            </span>
          </template>
        </el-table-column>
        <el-table-column
          prop="note"
          label="操作対象"
          min-width="220"
          show-overflow-tooltip
        >
          <template #default="{ row }">
            {{ formatLogTarget(row) }}
          </template>
        </el-table-column>
        <el-table-column
          prop="pages"
          label="処理件数"
          width="120"
          sortable
        >
          <template #default="{ row }">
            <span class="pages-count">{{ row.pages || 0 }}</span>
          </template>
        </el-table-column>
        <el-table-column
          label="ステータス"
          width="120"
        >
          <template #default="{ row }">
            <span class="status-pill" :class="`status-pill--${formatLogStatus(row)}`">
              {{ formatLogStatus(row) }}
            </span>
          </template>
        </el-table-column>
      </el-table>
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

.info-section {
  margin-bottom: 24px;
}

.info-card {
  background: white;
  padding: 16px 24px;
  border-radius: 8px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 400px;
}

.info-label {
  font-size: 12px;
  color: #909399;
  text-transform: uppercase;
}

.info-value {
  font-size: var(--font-size-metric);
  font-weight: 600;
  color: #0076bf;
  
  &.unknown {
    color: #e6a700;
  }
}

.info-meta {
  font-size: 13px;
  color: #606266;
}

.stats-cards {
  display: flex;
  gap: 16px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.stat-card {
  flex: 1;
  min-width: 160px;
  max-width: 280px;
  background: white;
  padding: 20px 24px;
  border-radius: 8px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.05);
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.stat-label {
  font-size: var(--font-size-base);
  color: #64748b;
  margin-right: 12px;
}

.stat-value {
  font-size: var(--font-size-metric);
  font-weight: 600;
  color: #1e293b;
}

.stat-unit {
  font-size: var(--font-size-base);
  color: #64748b;
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

.action-type {
  color: #303133;
  font-weight: 500;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 54px;
  height: 24px;
  padding: 0 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  background: #f1f5f9;
  color: #475569;
}

.status-pill--成功 {
  background: #ecfdf5;
  color: #047857;
}

.status-pill--処理中 {
  background: #eff6ff;
  color: #1d4ed8;
}

.status-pill--失敗,
.status-pill--中止 {
  background: #fef2f2;
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
  background: #0076bf;
  color: white;
}

.btn-primary:hover {
  background: #0066a8;
}

.btn-secondary {
  background: white;
  color: #606266;
  border: 1px solid #dcdfe6;
}

.btn-secondary:hover {
  background: #f5f7fa;
}

.icon-sm {
  width: 18px;
  height: 18px;
}
</style>
