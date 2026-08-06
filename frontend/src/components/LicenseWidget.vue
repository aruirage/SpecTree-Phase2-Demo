<script setup>
import { computed } from 'vue';

const props = defineProps({
  collapsed: { type: Boolean, default: false },
  usedPages: { type: Number, default: 0 },
  maxPages: { type: Number, default: 15000 },
  quotaPages: { type: Number, default: 15000 },
});

const emit = defineEmits(['click']);

const displayLimit = computed(() => props.quotaPages || props.maxPages || 15000);
const remaining = computed(() => Math.max(0, displayLimit.value - props.usedPages));
const percent = computed(() => {
  if (!displayLimit.value) return 0;
  return Math.min(100, Math.round((props.usedPages / displayLimit.value) * 100));
});

const barClass = computed(() => {
  const left = remaining.value / displayLimit.value;
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
    :data-label="collapsed ? 'ライセンス管理' : undefined"
    @click="emit('click')"
  >
    <template v-if="!collapsed">
      <span class="license-widget__label">ご利用状況</span>
      <span class="license-widget__value">
        {{ usedPages.toLocaleString() }} / {{ displayLimit.toLocaleString() }} ページ
      </span>
      <div class="license-widget__bar">
        <div class="license-widget__fill" :style="{ width: percent + '%' }" />
      </div>
      <span class="license-widget__hint">クリックで詳細</span>
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
  border: 1px solid transparent;
  border-radius: 8px;
  background: #ffffff;
  color: #1f2937;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  flex-shrink: 0;
  box-sizing: border-box;
  overflow: hidden;

  &:hover {
    background: #f8fafc;
    border-color: transparent;
  }

  &.collapsed {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 14px 0;
    position: relative;
    overflow: visible;

    &::after {
      content: attr(data-label);
      position: absolute;
      left: calc(100% + 10px);
      top: 50%;
      transform: translateY(-50%) translateX(-4px);
      padding: 6px 10px;
      background: #1f2937;
      color: #ffffff;
      font-size: 12px;
      font-weight: 500;
      line-height: 1;
      white-space: nowrap;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: opacity 0.15s, transform 0.15s, visibility 0.15s;
      z-index: 100;
    }

    &:hover::after {
      opacity: 1;
      visibility: visible;
      transform: translateY(-50%) translateX(0);
    }
  }

  &__label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #64748b;
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
    background: #e2e8f0;
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
    color: #64748b;
    word-break: break-word;
  }

  &__icon {
    width: 20px;
    height: 20px;
    opacity: 0.75;
  }
}
</style>
