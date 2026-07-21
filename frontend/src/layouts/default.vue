<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, RouterLink, RouterView } from 'vue-router';
import { ElMessage } from 'element-plus';
import logo from '@/assets/llm-ocr-logo.png';
import LicenseWidget from '@/components/LicenseWidget.vue';
import LicenseModal from '@/components/LicenseModal.vue';
import { fetchCurrentLicense, uploadLicenseFile } from '@/api/license';

const collapsed = ref(false);
const licenseModalOpen = ref(false);
const route = useRoute();

const navItems = [
  { label: 'スペックツリー', path: '/spec-tree' },
  { label: 'スペック新旧比較', path: '/clause-comparison' },
  { label: 'システムログ', path: '/system-logs' },
];

const licenseInfo = ref({
  siteId: '—',
  expiresAt: '—',
  usedPages: 0,
  maxPages: 5000,
  remainingPages: 5000,
});

async function loadLicense() {
  try {
    licenseInfo.value = await fetchCurrentLicense();
  } catch (e) {
    console.warn('license load failed', e);
  }
}

function handleLicenseUpload() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.lic,.license,*';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      licenseInfo.value = await uploadLicenseFile(file);
      ElMessage.success('License をアップロードしました');
    } catch (e) {
      ElMessage.error(e.message || 'アップロードに失敗しました');
    }
  };
  input.click();
}

onMounted(loadLicense);

function isActive(path) {
  return route.path === path || route.path.startsWith(path + '/');
}

</script>

<template>
  <div class="app-layout">
    <!-- Sidebar -->
    <aside class="sidebar" :class="{ collapsed }">
      <!-- Logo -->
      <div class="sidebar-logo" :class="{ 'sidebar-logo--collapsed': collapsed }">
        <img :src="logo" alt="Logo" class="logo-img" />
      </div>

      <!-- Navigation -->
      <nav class="sidebar-nav">
        <RouterLink
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          :class="{ active: isActive(item.path) }"
          :title="collapsed ? item.label : undefined"
        >
          <!-- Spec Tree Icon -->
          <svg v-if="item.path === '/spec-tree'" class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="6" y1="3" x2="6" y2="15"/>
            <circle cx="18" cy="6" r="3"/>
            <circle cx="6" cy="18" r="3"/>
            <path d="M18 9a9 9 0 0 1-9 9"/>
          </svg>
          <!-- Clause Compare Icon -->
          <svg v-else-if="item.path === '/clause-comparison'" class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14,2 14,8 20,8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10,9 9,9 8,9"/>
          </svg>
          <svg v-else-if="item.path === '/system-logs'" class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <line x1="10" y1="9" x2="8" y2="9"/>
          </svg>

          <span v-if="!collapsed" class="nav-label">{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="sidebar-footer">
        <LicenseWidget
          :collapsed="collapsed"
          :used-pages="licenseInfo.usedPages"
          :max-pages="licenseInfo.maxPages"
          @click="licenseModalOpen = true"
        />
      </div>

      <!-- Collapse Toggle -->
      <button class="collapse-btn" @click="collapsed = !collapsed" :aria-label="collapsed ? 'サイドバーを展開' : 'サイドバーを折りたたむ'">
        <svg v-if="collapsed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.25" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9,18 15,12 9,6"/>
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.25" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15,18 9,12 15,6"/>
        </svg>
      </button>

    </aside>

    <!-- Main Content -->
    <main class="main-content">
      <div class="main-view">
        <RouterView v-slot="{ Component, route }">
          <template v-if="route.name === 'SpecTree' || route.name === 'ClauseComparison'">
            <KeepAlive include="SpecTree,ClauseComparison">
              <component :is="Component" :key="route.name" />
            </KeepAlive>
          </template>
          <component
            v-else
            :is="Component"
            :key="route.name"
          />
        </RouterView>
      </div>
    </main>

    <LicenseModal
      :visible="licenseModalOpen"
      :license="licenseInfo"
      @close="licenseModalOpen = false"
      @upload="handleLicenseUpload"
    />
  </div>
</template>

<style scoped lang="scss">
.app-layout {
  display: flex;
  height: 100vh;
  width: 100%;
  overflow: hidden;
  background: #f0f2f5;
}

/* ── Sidebar ── */
.sidebar {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 184px;
  min-width: 184px;
  background: #1a2332;
  border-right: 1px solid #243044;
  transition: width 0.2s ease, min-width 0.2s ease;
  flex-shrink: 0;
  overflow: visible;
  z-index: 2;

  &.collapsed {
    width: 56px;
    min-width: 56px;
  }
}

.sidebar-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  border-bottom: 1px solid #243044;
  min-height: 64px;
  flex-shrink: 0;

  &.sidebar-logo--collapsed {
    padding: 12px 8px;
  }
}

.logo-img {
  max-height: 40px;
  max-width: 100%;
  object-fit: contain;
  filter: brightness(0) invert(1);
}

/* ── Nav ── */
.sidebar-nav {
  flex: 1;
  padding: 12px 6px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
}

.sidebar-footer {
  flex-shrink: 0;
  min-width: 0;
  width: 100%;
  padding: 0 6px 6px;
  box-sizing: border-box;
  overflow: visible;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 9px;
  border-radius: 8px;
  text-decoration: none;
  color: rgba(255, 255, 255, 0.65);
  font-size: 13px;
  font-weight: 500;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
  overflow: hidden;

  &:hover {
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.9);
  }

  &.active {
    background: #0076bf;
    color: #ffffff;
  }

  .sidebar.collapsed & {
    justify-content: center;
    padding: 10px 0;
  }
}

.nav-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.nav-label {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.3;
  min-width: 0;
}

/* ── Collapse button ── */
.collapse-btn {
  position: absolute;
  top: 72px;
  right: -13px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(148, 163, 184, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #ffffff;
  z-index: 10;
  box-shadow: 0 3px 10px rgba(15, 23, 42, 0.24);
  transition: background 0.15s, border-color 0.15s, box-shadow 0.15s, transform 0.15s;

  svg {
    width: 14px;
    height: 14px;
  }

  &:hover {
    background: #0076bf;
    border-color: rgba(255, 255, 255, 0.9);
    box-shadow: 0 5px 14px rgba(0, 118, 191, 0.32);
    transform: scale(1.04);
  }

  &:focus-visible {
    outline: 3px solid rgba(0, 118, 191, 0.28);
    outline-offset: 2px;
  }

  &:active {
    transform: scale(0.98);
  }
}

/* ── Main ── */
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
  position: relative;
  z-index: 1;
}

.main-view {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;

  > * {
    flex: 1;
    min-width: 0;
    min-height: 0;
  }
}
</style>
