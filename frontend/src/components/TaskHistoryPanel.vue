<script setup>
import { ref, computed } from 'vue';

const props = defineProps({
  jobType: {
    type: String,
    required: true,
    validator: (v) => ['spec_tree', 'clause_compare'].includes(v),
  },
  jobs: { type: Array, default: () => [] },
  activeJobId: { type: String, default: '' },
  collapsed: { type: Boolean, default: false },
});

const emit = defineEmits(['select', 'rerun', 'stop']);

const isExpanded = ref(true);

const statusLabels = {
  queued: '待機',
  running: '実行中',
  completed: '完了',
  failed: '失敗',
  cancelled: '停止',
};

const filteredJobs = computed(() =>
  props.jobs.filter((j) => j.type === props.jobType)
);

function toggleExpand() {
  isExpanded.value = !isExpanded.value;
}
</script>

<template>
  <section class="task-history" :class="{ 'task-history--collapsed-panel': collapsed }">
    <button type="button" class="task-history__header" @click="toggleExpand">
      <span class="task-history__title">タスク履歴</span>
      <span class="task-history__count">{{ filteredJobs.length }}</span>
      <svg
        class="task-history__chevron"
        :class="{ 'is-up': isExpanded }"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <polyline points="6,9 12,15 18,9" />
      </svg>
    </button>

    <div v-show="isExpanded" class="task-history__list">
      <p v-if="filteredJobs.length === 0" class="task-history__empty">履歴がありません</p>

      <button
        v-for="job in filteredJobs"
        :key="job.id"
        type="button"
        class="task-item"
        :class="{ 'task-item--active': job.id === activeJobId }"
        @click="emit('select', job)"
      >
        <div class="task-item__main">
          <span class="task-item__name" :title="job.name">{{ job.name }}</span>
          <span class="task-item__meta">
            <span class="task-item__time">{{ job.timeLabel }}</span>
          </span>
        </div>
        <div class="task-item__side">
          <span class="status-badge" :class="'status-' + job.status">
            {{ statusLabels[job.status] || job.status }}
          </span>
          <button
            v-if="job.status === 'running'"
            type="button"
            class="task-action task-action--danger"
            @click.stop="emit('stop', job)"
          >
            停止
          </button>
          <button
            v-else-if="job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled'"
            type="button"
            class="task-action"
            @click.stop="emit('rerun', job)"
          >
            再実行
          </button>
        </div>
        <div v-if="job.status === 'running' && job.progress != null" class="task-item__progress">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: job.progress + '%' }" />
          </div>
        </div>
      </button>
    </div>
  </section>
</template>

<style scoped lang="scss">
.task-history {
  flex-shrink: 0;
  border-top: 1px solid var(--color-border, #e2e8f0);
  background: #f8fafc;
}

.task-history__header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 16px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;

  &:hover {
    background: #f1f5f9;
  }
}

.task-history__title {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text, #1e293b);
}

.task-history__count {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary, #64748b);
  background: #e2e8f0;
  padding: 1px 6px;
  border-radius: 999px;
}

.task-history__chevron {
  width: 14px;
  height: 14px;
  margin-left: auto;
  color: var(--color-text-secondary, #64748b);
  transition: transform 0.15s;

  &.is-up {
    transform: rotate(180deg);
  }
}

.task-history__list {
  max-height: 220px;
  overflow-y: auto;
  padding: 0 8px 8px;
}

.task-history__empty {
  margin: 0;
  padding: 12px 8px;
  font-size: 12px;
  color: var(--color-text-secondary, #64748b);
  text-align: center;
}

.task-item {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 10px;
  margin-bottom: 4px;
  border: 1px solid transparent;
  border-radius: var(--radius-md, 8px);
  background: #fff;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, box-shadow 0.15s;

  &:hover {
    border-color: var(--color-border, #e2e8f0);
    box-shadow: var(--shadow-panel, 0 1px 3px rgba(0, 0, 0, 0.08));
  }

  &--active {
    border-color: var(--color-primary, #0076bf);
    background: #f0f9ff;
  }
}

.task-item__main {
  flex: 1;
  min-width: 0;
}

.task-item__name {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text, #1e293b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-item__meta {
  display: flex;
  gap: 6px;
  margin-top: 2px;
  font-size: 10px;
  color: var(--color-text-secondary, #64748b);
}

.task-item__side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.status-badge {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;

  &.status-running {
    background: #e0f0fb;
    color: var(--color-primary, #0076bf);
  }

  &.status-completed {
    background: #dcfce7;
    color: #166534;
  }

  &.status-failed {
    background: #fee2e2;
    color: #991b1b;
  }

  &.status-queued,
  &.status-cancelled {
    background: #f1f5f9;
    color: #64748b;
  }
}

.task-action {
  border: none;
  background: none;
  padding: 0;
  font-size: 10px;
  font-weight: 600;
  color: var(--color-primary, #0076bf);
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }

  &--danger {
    color: var(--color-danger, #ef4444);
  }
}

.task-item__progress {
  width: 100%;

  .progress-bar {
    height: 4px;
    background: #e2e8f0;
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--color-primary, #0076bf);
    border-radius: 2px;
  }
}
</style>
