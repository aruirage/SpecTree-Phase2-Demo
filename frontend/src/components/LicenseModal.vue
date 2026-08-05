<script setup>
import { ref, watch } from 'vue';

const props = defineProps({
  visible: { type: Boolean, default: false },
  license: { type: Object, default: () => ({}) },
});

const emit = defineEmits(['close', 'upload', 'download-usage-log']);

// ログ导出対象期間（デフォルトは課金期間）
const exportFrom = ref('');
const exportTo = ref('');

watch(
  () => props.visible,
  (open) => {
    if (open) {
      exportFrom.value = props.license.billingPeriodStart || '';
      exportTo.value = props.license.billingPeriodEnd || '';
    }
  },
);

function handleDownloadUsageLog() {
  emit('download-usage-log', { from: exportFrom.value, to: exportTo.value });
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="license-overlay" @click.self="emit('close')">
      <div class="license-modal" role="dialog" aria-labelledby="license-modal-title">
        <header class="license-modal__header">
          <div class="license-modal__title-wrap">
            <h2 id="license-modal-title">ライセンス管理</h2>
            <span class="info-icon" tabindex="0" aria-label="ライセンスについて">
              i
              <span class="info-icon__tooltip" role="tooltip">
                3 か月ごとに精算します。上限 1,500 ページは目安です。超過しても処理は停止しません。
                ログをエクスポートして新しい License をアップロードすると、有効期限・対象期間が更新されます。
              </span>
            </span>
          </div>
          <button type="button" class="license-modal__close" aria-label="閉じる" @click="emit('close')">
            ×
          </button>
        </header>

        <div class="license-modal__body">
          <dl class="license-info">
            <div class="license-info__row">
              <dt>有効期限</dt>
              <dd>{{ license.expiresAt || '—' }}</dd>
            </div>
            <div class="license-info__row">
              <dt>対象期間</dt>
              <dd>{{ license.billingPeriodLabel || '—' }}</dd>
            </div>
            <div class="license-info__row">
              <dt>本期の利用ページ数</dt>
              <dd>
                {{ Number(license.usedPages || 0).toLocaleString() }}
                / {{ Number(license.quotaPages || 1500).toLocaleString() }} ページ
              </dd>
            </div>
          </dl>

          <div class="license-modal__actions">
            <button type="button" class="btn btn-primary" @click="emit('upload')">
              License ファイルをアップロード
            </button>
          </div>

          <div class="export-section">
            <div class="export-section__title">利用ログのエクスポート（期間指定）</div>
            <div class="export-range">
              <label class="export-range__field">
                <span>開始日</span>
                <input v-model="exportFrom" type="date" class="export-range__input" />
              </label>
              <span class="export-range__sep">〜</span>
              <label class="export-range__field">
                <span>終了日</span>
                <input v-model="exportTo" type="date" class="export-range__input" />
              </label>
            </div>
            <button
              type="button"
              class="btn btn-secondary export-section__btn"
              @click="handleDownloadUsageLog"
            >
              <svg class="btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7,10 12,15 17,10" />
                <line x1="12" y1="15" x2="12" y2="3" />
                <path d="M16 6V5a4 4 0 0 0-8 0v1" />
              </svg>
              利用ログをダウンロード
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.license-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.45);
  padding: 24px;
}

.license-modal {
  width: 100%;
  max-width: 480px;
  background: var(--color-bg-panel);
  border-radius: 12px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
  overflow: hidden;
}

.license-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);

  h2 {
    margin: 0;
    font-size: var(--font-size-title);
    font-weight: 600;
    color: var(--color-text);
  }
}

.license-modal__title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.info-icon {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid #c0c4cc;
  color: #909399;
  font-size: 9px;
  font-weight: 600;
  font-style: italic;
  line-height: 1;
  cursor: help;
  user-select: none;
  flex-shrink: 0;

  &:hover,
  &:focus-visible {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  &__tooltip {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 10;
    width: 260px;
    padding: 10px 12px;
    background: #1f2937;
    color: #fff;
    font-size: 12px;
    font-weight: 400;
    font-style: normal;
    line-height: 1.6;
    border-radius: 8px;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.2);
    white-space: normal;
    opacity: 0;
    visibility: hidden;
    transform: translateY(-4px);
    transition: opacity 0.15s, transform 0.15s, visibility 0.15s;
    pointer-events: none;
  }

  &:hover &__tooltip,
  &:focus-visible &__tooltip {
    opacity: 1;
    visibility: visible;
    transform: translateY(0);
  }
}

.license-modal__close {
  border: none;
  background: transparent;
  font-size: var(--font-size-page-title);
  line-height: 1;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 0 4px;

  &:hover {
    color: var(--color-text);
  }
}

.license-modal__body {
  padding: 20px;
}

.license-info {
  margin: 0 0 20px;

  &__row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 0;
    border-bottom: 1px solid var(--color-border);
    font-size: var(--font-size-base);

    dt {
      color: var(--color-text-secondary);
      font-weight: 500;
    }

    dd {
      margin: 0;
      color: var(--color-text);
      font-weight: 600;
      text-align: right;
    }
  }
}

.license-modal__actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.export-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border);

  &__title {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text);
    margin-bottom: 10px;
  }

  &__btn {
    width: 100%;
    margin-top: 8px;
  }
}

.export-range {
  display: flex;
  align-items: flex-end;
  gap: 8px;

  &__field {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;

    span {
      font-size: 12px;
      color: var(--color-text-secondary);
    }
  }

  &__input {
    padding: 7px 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-base);
    color: var(--color-text);
    background: #fff;
    box-sizing: border-box;
    width: 100%;

    &:focus {
      outline: none;
      border-color: var(--color-primary);
    }
  }

  &__sep {
    padding-bottom: 9px;
    color: var(--color-text-secondary);
  }
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 16px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-base);
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.15s, border-color 0.15s;

  &-primary {
    background: var(--color-primary);
    color: #fff;

    &:hover {
      background: var(--color-primary-hover);
    }
  }

  &-secondary {
    background: #fff;
    border-color: var(--color-border);
    color: var(--color-text);

    &:hover {
      background: #f8fafc;
    }
  }

  &-muted {
    color: var(--color-text-secondary);
  }
}

.btn__icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
</style>
