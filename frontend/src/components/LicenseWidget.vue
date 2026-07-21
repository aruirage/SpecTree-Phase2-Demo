<script setup>
import { computed } from 'vue';

const props = defineProps({
  collapsed: { type: Boolean, default: false },
  usedPages: { type: Number, default: 0 },
  maxPages: { type: Number, default: 5000 },
});

const emit = defineEmits(['click']);

const remaining = computed(() => Math.max(0, props.maxPages - props.usedPages));
const percent = computed(() => {
  if (!props.maxPages) return 0;
  return Math.min(100, Math.round((props.usedPages / props.maxPages) * 100));
});

const barClass = computed(() => {
  const left = remaining.value / props.maxPages;
  if (left <= 0.1) return 'is-danger';
  if (left <= 0.2) return 'is-warning';
  return '';
});
</script>

<template>
  <button
    type="button"
    class="license-widget"
    :class="{ collapsed, [barClass]: true }"
    :title="collapsed ? '利用状況' : undefined"
    @click="emit('click')"
  >
    <template v-if="!collapsed">
      <span class="license-widget__label">今月の利用状況</span>
      <span class="license-widget__value">
        {{ usedPages.toLocaleString() }} / {{ maxPages.toLocaleString() }} ページ
      </span>
      <div class="license-widget__bar">
        <div class="license-widget__fill" :style="{ width: percent + '%' }" />
      </div>
      <span class="license-widget__hint">残 {{ remaining.toLocaleString() }} ページ · クリックで詳細</span>
    </template>
    <template v-else>
      <svg class="license-widget__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    </template>
  </button>
</template>

<style scoped lang="scss">
.license-widget {
  display: block;
  width: 100%;
  max-width: 100%;
  margin: 0;
  padding: 10px 8px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 8px;
  background: #2b3648;
  color: rgba(255, 255, 255, 0.85);
  text-align: left;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  flex-shrink: 0;
  box-sizing: border-box;
  overflow: hidden;

  &:hover {
    background: #334158;
    border-color: rgba(148, 163, 184, 0.28);
  }

  &.collapsed {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 14px 0;
  }

  &__label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: rgba(255, 255, 255, 0.5);
    margin-bottom: 4px;
  }

  &__value {
    display: block;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.35;
    margin-bottom: 8px;
    word-break: break-word;
  }

  &__bar {
    height: 6px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.12);
    overflow: hidden;
    margin-bottom: 6px;
  }

  &__fill {
    height: 100%;
    border-radius: 3px;
    background: var(--color-primary);
    transition: width 0.3s ease, background 0.2s;
  }

  &.is-warning &__fill {
    background: var(--color-warning);
  }

  &.is-danger &__fill {
    background: var(--color-danger);
  }

  &__hint {
    display: block;
    font-size: 10px;
    line-height: 1.35;
    color: rgba(255, 255, 255, 0.45);
    word-break: break-word;
  }

  &__icon {
    width: 20px;
    height: 20px;
    opacity: 0.75;
  }
}
</style>
