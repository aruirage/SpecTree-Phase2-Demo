<script setup>
defineProps({
  visible: { type: Boolean, default: false },
  license: { type: Object, default: () => ({}) },
});

const emit = defineEmits(['close', 'upload', 'download-settlement-counter']);
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="license-overlay" @click.self="emit('close')">
      <div class="license-modal" role="dialog" aria-labelledby="license-modal-title">
        <header class="license-modal__header">
          <h2 id="license-modal-title">ライセンス管理</h2>
          <button type="button" class="license-modal__close" aria-label="閉じる" @click="emit('close')">
            ×
          </button>
        </header>

        <div class="license-modal__body">
          <dl class="license-info">
            <div class="license-info__row">
              <dt>拠点</dt>
              <dd>{{ license.siteId || '—' }}</dd>
            </div>
            <div class="license-info__row">
              <dt>有効期限</dt>
              <dd>{{ license.expiresAt || '—' }}</dd>
            </div>
            <div class="license-info__row">
              <dt>残りページ数</dt>
              <dd>{{ license.remainingPages ?? '—' }} / {{ license.maxPages ?? '—' }}</dd>
            </div>
          </dl>

          <div class="license-modal__actions">
            <button type="button" class="btn btn-primary" @click="emit('upload')">
              License ファイルをアップロード
            </button>
            <button type="button" class="btn btn-secondary" @click="emit('download-settlement-counter')">
              <svg class="btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7,10 12,15 17,10" />
                <line x1="12" y1="15" x2="12" y2="3" />
                <path d="M16 6V5a4 4 0 0 0-8 0v1" />
              </svg>
              精算用カウントファイルをダウンロード
            </button>
          </div>

          <p class="license-modal__hint">License の更新は進行中のタスクに影響しません。</p>
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

.license-modal__hint {
  margin: 16px 0 0;
  font-size: 12px;
  color: var(--color-text-secondary);
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
