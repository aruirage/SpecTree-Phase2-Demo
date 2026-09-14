<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { createPromptTemplate, deletePromptTemplate, fetchPromptTemplates, resetPromptTemplate, updatePromptTemplate } from '@/api/promptTemplates';

const templates = ref([]);
const selectedId = ref('isajt');
const loading = ref(false);
const saving = ref(false);
const search = ref('');
const seriesOptions = ref(['AMS', 'ASTM', 'DMF', 'ISAJT', 'その他']);
const promptType = ref('clause_compare');
const editingTemplateId = ref('');
const editingTemplateName = ref('');
const renaming = ref(false);
const form = reactive({ promptText: '' });

const filteredTemplates = computed(() => {
  const keyword = search.value.trim().toLowerCase();
  if (!keyword) return templates.value;
  return templates.value.filter((item) => item.name.toLowerCase().includes(keyword));
});
const selectedTemplate = computed(() => templates.value.find((item) => item.id === selectedId.value) || null);

function copyToForm(template) {
  if (!template) return;
  form.promptText = promptType.value === 'spec_tree'
    ? (template.specTreePromptText || '')
    : (template.promptText || '');
}

async function loadTemplates() {
  loading.value = true;
  try {
    const data = await fetchPromptTemplates();
    templates.value = data.templates || [];
    seriesOptions.value = data.seriesOptions || seriesOptions.value;
    if (!templates.value.some((item) => item.id === selectedId.value)) selectedId.value = templates.value[0]?.id || '';
    copyToForm(selectedTemplate.value);
  } catch (error) {
    ElMessage.error(error.message || 'テンプレートの取得に失敗しました');
  } finally {
    loading.value = false;
  }
}

function selectTemplate(id) {
  selectedId.value = id;
  copyToForm(selectedTemplate.value);
}

async function createTemplate() {
  try {
    const data = await createPromptTemplate({ sourceId: selectedTemplate.value?.id });
    templates.value.push(data.template);
    selectTemplate(data.template.id);
    ElMessage.success('テンプレートを作成しました');
  } catch (error) { ElMessage.error(error.message || '作成に失敗しました'); }
}

function beginRename(template) {
  editingTemplateId.value = template.id;
  editingTemplateName.value = template.name;
}

async function finishRename(template) {
  if (editingTemplateId.value !== template.id || renaming.value) return;
  const name = editingTemplateName.value.trim();
  if (!name || name === template.name) {
    editingTemplateId.value = '';
    return;
  }
  renaming.value = true;
  try {
    const data = await updatePromptTemplate(template.id, { name });
    const index = templates.value.findIndex((item) => item.id === template.id);
    if (index >= 0) templates.value[index] = data.template;
    editingTemplateId.value = '';
    ElMessage.success('テンプレート名を保存しました');
  } catch (error) {
    ElMessage.error(error.message || '名称の変更に失敗しました');
  } finally {
    renaming.value = false;
  }
}

function cancelRename() {
  editingTemplateId.value = '';
  editingTemplateName.value = '';
}

async function handleTemplateCommand(command, template) {
  if (command === 'copy') {
    try {
      const data = await createPromptTemplate({ sourceId: template.id, name: `${template.name} コピー` });
      templates.value.push(data.template);
      selectTemplate(data.template.id);
      ElMessage.success('テンプレートをコピーしました');
    } catch (error) { ElMessage.error(error.message || 'コピーに失敗しました'); }
  }
  if (command === 'delete') {
    if (template.id === 'default') return;
    try {
      await ElMessageBox.confirm(`「${template.name}」を削除しますか？`, '確認', { confirmButtonText: '削除', cancelButtonText: 'キャンセル' });
      await deletePromptTemplate(template.id);
      templates.value = templates.value.filter((item) => item.id !== template.id);
      if (selectedId.value === template.id) selectTemplate(templates.value[0]?.id || '');
      ElMessage.success('テンプレートを削除しました');
    } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(error.message || '削除に失敗しました'); }
  }
}

function clearPrompt() {
  form.promptText = '';
}

async function saveTemplate() {
  if (!selectedTemplate.value) return;
  saving.value = true;
  try {
    const payload = promptType.value === 'spec_tree'
      ? { name: selectedTemplate.value.name, specTreePromptText: form.promptText }
      : { name: selectedTemplate.value.name, promptText: form.promptText };
    const data = await updatePromptTemplate(selectedTemplate.value.id, payload);
    const index = templates.value.findIndex((item) => item.id === selectedTemplate.value.id);
    if (index >= 0) templates.value[index] = data.template;
    copyToForm(data.template);
    ElMessage.success('テンプレートを保存しました');
  } catch (error) {
    ElMessage.error(error.message || '保存に失敗しました');
  } finally {
    saving.value = false;
  }
}

watch(promptType, () => copyToForm(selectedTemplate.value));

async function resetTemplate() {
  if (!selectedTemplate.value) return;
  await ElMessageBox.confirm('このテンプレートを標準設定に戻しますか？', '確認', { confirmButtonText: 'OK', cancelButtonText: 'キャンセル' });
  try {
    const data = await resetPromptTemplate(selectedTemplate.value.id);
    const index = templates.value.findIndex((item) => item.id === selectedTemplate.value.id);
    if (index >= 0) templates.value[index] = data.template;
    copyToForm(data.template);
    ElMessage.success('標準設定に戻しました');
  } catch (error) {
    ElMessage.error(error.message || '復元に失敗しました');
  }
}

onMounted(loadTemplates);
</script>

<template>
  <section class="prompt-page">
    <div class="workspace" v-loading="loading">
      <aside class="template-list">
        <div class="list-heading"><span>抽出テンプレート</span></div>
        <el-input v-model="search" placeholder="テンプレートを検索" clearable class="template-search" />
        <el-button type="primary" class="create-button" @click="createTemplate">＋ テンプレート追加</el-button>
        <div
          v-for="template in filteredTemplates"
          :key="template.id"
          type="button"
          class="template-item"
          role="button"
          tabindex="0"
          :class="{ active: selectedId === template.id }"
          @click="selectTemplate(template.id)"
          @dblclick="beginRename(template)"
        >
          <span v-if="editingTemplateId !== template.id" class="template-copy"><b>{{ template.name }}</b></span>
          <span v-else class="rename-wrap"><input v-model="editingTemplateName" :disabled="renaming" autofocus @click.stop @keydown.enter.prevent.stop="finishRename(template)" @keydown.esc.prevent.stop="cancelRename" @blur="finishRename(template)" /></span>
          <el-dropdown trigger="click" @command="(command) => handleTemplateCommand(command, template)" @click.stop>
            <button type="button" class="more-button" aria-label="テンプレート操作" @click.stop>•••</button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="copy">コピー</el-dropdown-item>
                <el-dropdown-item command="delete" :disabled="template.isDefault">削除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </aside>

      <main v-if="selectedTemplate" class="editor-pane">
        <div class="editor-title">
          <div class="editor-heading"><h2>{{ selectedTemplate.name }}</h2><p>抽出ルール</p></div>
          <div class="editor-actions"><el-button @click="resetTemplate">標準に戻す</el-button><el-button type="primary" :loading="saving" @click="saveTemplate">保存</el-button></div>
        </div>

        <div class="prompt-editor">
          <div class="prompt-input-wrap"><el-input v-model="form.promptText" type="textarea" :rows="18" resize="vertical" placeholder="抽出ルールを入力してください" /><el-button class="clear-prompt-btn" title="Promptをクリア" @click="clearPrompt"><svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="3,6 5,6 21,6" /><path d="M8,6V4a2 2 0,0 1 2,-2h4a2 2 0,0 1 2,2v2" /><path d="M19,6l-1,14a2 2,0 0,1 -2,2H8a2 2,0 0,1 -2,-2L5,6" /></svg>クリア</el-button></div>
        </div>
      </main>
      <div v-else class="empty-state">テンプレートがありません</div>
    </div>
  </section>
</template>

<style scoped>
.prompt-page { min-height: 100%; padding: 28px 32px 36px; color: #172b4d; font-family: "Noto Sans JP", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.page-header, .editor-title, .list-heading, .header-actions, .switch-row { display: flex; align-items: center; }
.page-header { justify-content: space-between; margin-bottom: 24px; }
h1 { margin: 0; font-size: 24px; font-weight: 700; } h2 { margin: 4px 0 0; font-size: 20px; }
.page-header p { margin: 8px 0 0; color: #667085; font-size: 15px; }
.header-actions { gap: 12px; } .updated-label, .status-text { color: #667085; font-size: 14px; }
.workspace { display: grid; grid-template-columns: 280px minmax(0, 1fr); min-height: 650px; background: #fff; border: 1px solid #e4e7ec; border-radius: 8px; overflow: visible; }
.template-list { border-right: 1px solid #e4e7ec; padding: 20px 14px; background: #fbfcfe; }
.list-heading { justify-content: space-between; padding: 0 8px 14px; font-size: 16px; } .list-heading strong { color: #667085; font-size: 14px; }
.template-search { margin-bottom: 12px; }
.template-select { width: 100%; margin-bottom: 12px; padding: 9px 10px; border: 1px solid #d0d5dd; border-radius: 6px; background: #fff; color: #344054; font: inherit; }
.create-button { width: 100%; margin-bottom: 10px; }
.template-item { display: flex; width: 100%; align-items: center; gap: 10px; padding: 11px 8px; border: 0; border-radius: 6px; background: transparent; color: #344054; text-align: left; cursor: pointer; }
.template-item:hover { background: #f2f4f7; } .template-item.active { background: #e8f1fb; color: #175cd3; }
.series-mark { display: grid; width: 30px; height: 30px; place-items: center; border-radius: 6px; background: #e4e7ec; color: #475467; font-weight: 700; } .active .series-mark { background: #175cd3; color: #fff; }
.template-copy { display: grid; gap: 3px; flex: 1; } .template-copy b { font-size: 15px; } .template-copy small { color: #667085; font-size: 14px; } .active .template-copy small { color: #4e76b5; }
.more-button { border: 0; background: transparent; color: #667085; font-weight: 700; letter-spacing: 2px; cursor: pointer; }
.rename-wrap { flex: 1; } .rename-wrap input { width: 100%; box-sizing: border-box; padding: 5px 7px; border: 1px solid #84adff; border-radius: 4px; color: #344054; font: inherit; }
.sample-side-heading { display: grid; gap: 4px; margin: 24px 8px 12px; padding-top: 18px; border-top: 1px solid #e4e7ec; } .sample-side-heading small, .sample-empty { color: #667085; font-size: 13px; }
.template-list > input[type="file"] { position: absolute; width: 1px; height: 1px; opacity: 0; } .sample-add-button { display: block; padding: 9px; border: 1px dashed #98a2b3; border-radius: 5px; color: #175cd3; text-align: center; cursor: pointer; font-size: 14px; }
.sample-file-list { display: grid; gap: 8px; margin-top: 12px; } .sample-file { display: flex; align-items: center; gap: 7px; min-width: 0; color: #344054; font-size: 13px; } .sample-file span { color: #175cd3; font-size: 11px; font-weight: 700; } .sample-file strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .sample-empty { margin-top: 12px; }
.editor-pane { min-width: 0; padding: 28px 32px; } .editor-title { justify-content: space-between; padding-bottom: 22px; border-bottom: 1px solid #eaecf0; } .eyebrow { color: #667085; font-size: 14px; } .editor-actions { display: flex; gap: 10px; }
.editor-tabs { margin-top: 20px; } .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; padding: 10px 0 24px; }
.field { display: grid; gap: 8px; } .field.wide { grid-column: span 2; } .field > span { color: #344054; font-size: 15px; font-weight: 600; }
.switch-row { flex-wrap: wrap; gap: 12px 16px; padding: 20px 0 0; border-top: 1px solid #eaecf0; } .switch-row div { display: grid; gap: 4px; min-width: 170px; } .switch-row small { color: #667085; font-size: 14px; }
.series-select { width: 100%; }
.prompt-editor { padding: 24px 0; } .prompt-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; } .prompt-heading div:first-child { display: grid; gap: 5px; } .prompt-heading span { color: #344054; font-size: 16px; font-weight: 600; } .prompt-heading small { color: #667085; font-size: 14px; } .prompt-actions { display: flex; gap: 8px; }
.prompt-toggle { width: 32px; height: 32px; padding: 0; } .prompt-toggle svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.prompt-input-wrap { position: relative; } .prompt-input-wrap :deep(.el-textarea__inner) { padding-bottom: 44px; } .clear-prompt-btn { position: absolute; right: 12px; bottom: 12px; z-index: 1; height: 32px; padding: 0 9px; border-color: #cbd5e1; color: #64748b; font-size: 11px; } .clear-prompt-btn svg { width: 13px; height: 13px; margin-right: 4px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; vertical-align: -2px; }
.prompt-editor.collapsed { padding-bottom: 12px; }
.section-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.rule-section { display: grid; gap: 8px; padding: 16px; border: 1px solid #e4e7ec; border-radius: 6px; background: #fbfcfe; }
.rule-heading { display: grid; gap: 4px; } .rule-heading b { color: #344054; font-size: 15px; } .rule-heading small { color: #667085; font-size: 13px; }
.samples-panel { display: flex; align-items: center; gap: 14px; padding: 20px 0; border-top: 1px solid #eaecf0; } .samples-panel div { display: grid; flex: 1; gap: 4px; } .samples-panel small { color: #667085; font-size: 14px; } .samples-panel input { position: absolute; width: 1px; height: 1px; opacity: 0; } .samples-panel label { color: #175cd3; cursor: pointer; font-size: 15px; } .sample-count { color: #667085; font-size: 14px; }
.readonly-panel { margin-top: 12px; padding: 18px; border: 1px solid #e4e7ec; border-radius: 6px; background: #f8fafc; } .readonly-label { color: #667085; font-size: 14px; font-weight: 600; } pre { margin: 14px 0 0; white-space: pre-wrap; word-break: break-word; color: #344054; font: 14px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; }
.empty-state { display: grid; place-items: center; color: #98a2b3; } 
@media (max-width: 900px) { .page-header { align-items: flex-start; flex-direction: column; gap: 16px; } .workspace { grid-template-columns: 1fr; } .template-list { border-right: 0; border-bottom: 1px solid #e4e7ec; } .editor-pane { padding: 22px 20px; } }
@media (max-width: 640px) { .prompt-page { padding: 20px 16px; } .form-grid, .section-grid { grid-template-columns: 1fr; } .field.wide { grid-column: auto; } .editor-title { align-items: flex-start; flex-direction: column; gap: 8px; } .updated-label { display: none; } }

.prompt-page {
  padding: 20px 24px 28px;
  background: #f5f7fa;
  color: #1e3a5f;
}

.workspace {
  min-height: calc(100vh - 112px);
  grid-template-columns: 260px minmax(0, 1fr);
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(30, 58, 95, 0.04);
  overflow: hidden;
}

.template-list {
  padding: 16px 12px;
  border-right-color: #e2e8f0;
  background: #f8fafc;
}

.list-heading {
  padding: 0 8px 12px;
  color: #1e3a5f;
  font-size: 15px;
}

.list-heading strong {
  color: #64748b;
  font-size: 13px;
  font-weight: 500;
}

.template-search :deep(.el-input__wrapper) {
  border-radius: 4px;
  box-shadow: 0 0 0 1px #cbd5e1 inset;
}

.create-button {
  height: 36px;
  margin-bottom: 12px;
  border-color: #0076bf;
  border-radius: 4px;
  background: #0076bf;
}

.template-item {
  min-height: 44px;
  padding: 9px 8px;
  border-radius: 4px;
  color: #334155;
}

.template-item:hover {
  background: #edf4fb;
}

.template-item.active {
  background: #e8f1fb;
  color: #0076bf;
}

.template-copy b {
  font-size: 14px;
  font-weight: 600;
}

.more-button {
  color: #64748b;
}

.editor-pane {
  padding: 22px 28px 28px;
  background: #fff;
}

.editor-title {
  padding-bottom: 16px;
  border-bottom-color: #e2e8f0;
}

.editor-title h2 {
  margin-top: 0;
  color: #1e3a5f;
  font-size: 20px;
}

.editor-actions {
  gap: 8px;
}

.editor-actions :deep(.el-button) {
  height: 32px;
  padding: 0 14px;
  border-radius: 4px;
}

.editor-actions :deep(.el-button--primary) {
  border-color: #0076bf;
  background: #0076bf;
}

.prompt-editor {
  padding: 20px 0 0;
}

.prompt-heading {
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e2e8f0;
}

.prompt-heading span {
  color: #1e3a5f;
  font-size: 15px;
  font-weight: 600;
}

.prompt-heading small {
  color: #64748b;
  font-size: 13px;
}

.prompt-toggle {
  color: #0076bf;
}

.prompt-input-wrap :deep(.el-textarea__inner) {
  min-height: 360px !important;
  padding: 14px 14px 44px;
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  background: #fff;
  color: #334155;
  box-shadow: none;
  line-height: 1.7;
}

.prompt-input-wrap :deep(.el-textarea__inner:focus) {
  border-color: #0076bf;
  box-shadow: 0 0 0 2px rgba(0, 118, 191, 0.12);
}

.clear-prompt-btn {
  border-color: #cbd5e1;
  color: #64748b;
}
</style>
