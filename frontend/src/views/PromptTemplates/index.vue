<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { analyzePromptTemplate, createPromptTemplate, deletePromptTemplate, fetchPromptTemplates, resetPromptTemplate, updatePromptTemplate } from '@/api/promptTemplates';

const templates = ref([]);
const selectedId = ref('isajt');
const loading = ref(false);
const saving = ref(false);
const search = ref('');
const editingTemplateId = ref('');
const editingTemplateName = ref('');
const renaming = ref(false);
const form = reactive({ modules: [] });

const expanded = reactive({});
const checks = reactive({});
const checking = reactive({});

const filteredTemplates = computed(() => {
  const keyword = search.value.trim().toLowerCase();
  if (!keyword) return templates.value;
  return templates.value.filter((item) => item.name.toLowerCase().includes(keyword));
});

const selectedTemplate = computed(
  () => filteredTemplates.value.find((item) => item.id === selectedId.value) || filteredTemplates.value[0] || null,
);

// 編集画面に出すモジュール。hidden（処理形式）は出さない。
// 中身が空のモジュールは出さないが、「追加ルール」だけは追記用に空でも残す。
const visibleModules = computed(() =>
  form.modules.filter((mod) => {
    if (mod.hidden) return false;
    if ((mod.rules || []).some((rule) => rule.layer !== 'system')) return true;
    return mod.id === 'series_rules';
  }),
);

// 1期共通テンプレートは 1 期の 1 セットそのもの。全テンプレートの基準なので読み取り専用。
const readOnlyTemplate = computed(() => selectedTemplate.value?.readOnly === true);

// そのモジュールの規則を編集できるか。1期共通テンプレートは読み取り専用。
function isLockedModule() {
  return readOnlyTemplate.value;
}

// 画面に出す行。system 層は業務抽出ルールではないので出さない。
function visibleRules(mod) {
  return (mod.rules || [])
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule.layer !== 'system');
}

// その 1 行を読み取り専用で出すか。1期共通テンプレートはモジュールごと読み取り専用。
function isLockedRule(mod) {
  return isLockedModule(mod);
}

function copyToForm(template) {
  if (!template) return;
  form.modules = template.modules ? JSON.parse(JSON.stringify(template.modules)) : [];
  for (const key of Object.keys(checks)) delete checks[key];
  for (const key of Object.keys(expanded)) delete expanded[key];
}

async function loadTemplates() {
  loading.value = true;
  try {
    const data = await fetchPromptTemplates();
    templates.value = data.templates || [];
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
  // 読み取り専用テンプレート（1期共通）は名前も変えない。
  if (template.readOnly) return;
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

function isOpen(id) {
  return expanded[id] === true;
}

function toggleModule(id) {
  expanded[id] = !expanded[id];
}

function ruleStatus(moduleId, index) {
  const map = checks[moduleId];
  const entry = map ? map[index] : null;
  return entry ? entry.status : null;
}

// 無効と判定された理由。ルールの下に出して、どの規則と衝突しているかを見せる。
function ruleReason(moduleId, index) {
  const map = checks[moduleId];
  const entry = map ? map[index] : null;
  return entry && entry.status === 'ng' ? entry.reason : '';
}

function statusLabel(moduleId, index) {
  const status = ruleStatus(moduleId, index);
  if (status === 'ok') return '有効';
  if (status === 'ng') return '無効';
  return '';
}

// ルールを 1 行足す。時機（内部の区分）は直前のルールを引き継ぎ、
// 並び順は同じ時機の最大値＋1 にして末尾に置く。
function addRule(mod) {
  const last = mod.rules[mod.rules.length - 1];
  const timing = last?.timing || 'scan';
  let maxOrder = -1;
  for (const item of form.modules) {
    for (const rule of item.rules || []) {
      if ((rule.timing || 'common') === timing) maxOrder = Math.max(maxOrder, rule.order ?? 0);
    }
  }
  mod.rules.push({ timing, layer: 'user', order: maxOrder + 1, text: '' });
  delete checks[mod.id];
  expanded[mod.id] = true;
}

function removeRule(mod, index) {
  mod.rules.splice(index, 1);
  delete checks[mod.id];
}

// 解析結果を各モジュールのチェック表示へ反映し、無効件数を返す。
function applyAnalysisChecks(modules, analysis) {
  const byText = {};
  for (const item of analysis?.rules || []) byText[String(item.line).trim()] = item;
  let ng = 0;
  for (const mod of modules) {
    const map = {};
    (mod.rules || []).forEach((rule, index) => {
      if (rule.layer === 'system' || rule.hidden) return;
      const text = String(rule.text || '').trim();
      if (!text) return;
      const hit = byText[text];
      if (hit && hit.status === 'rejected') {
        map[index] = { status: 'ng', reason: hit.reason || '' };
        ng += 1;
        expanded[mod.id] = true;
      } else {
        map[index] = { status: 'ok', reason: '' };
      }
    });
    checks[mod.id] = map;
  }
  return ng;
}

// モジュール単体をチェックし、ルールごとに有効／無効だけを返す。
async function checkModule(mod) {
  if (!selectedTemplate.value) return;
  checking[mod.id] = true;
  try {
    const data = await analyzePromptTemplate(selectedTemplate.value.id, { modules: [mod] });
    const ng = applyAnalysisChecks([mod], data.analysis);
    expanded[mod.id] = true;
    if (ng) ElMessage.warning(`無効なルールが ${ng} 件あります`);
    else ElMessage.success('すべて有効です');
  } catch (error) {
    ElMessage.error(error.message || 'チェックに失敗しました');
  } finally {
    checking[mod.id] = false;
  }
}

async function saveTemplate() {
  if (!selectedTemplate.value) return;
  saving.value = true;
  try {
    // 保存前に全ルールを検証。無効があれば画面に理由を出し、保存しない。
    const analysis = await analyzePromptTemplate(selectedTemplate.value.id, { modules: form.modules });
    const ng = applyAnalysisChecks(form.modules, analysis.analysis);
    if (ng > 0) {
      ElMessage.error(`無効なルールが ${ng} 件あるため保存できません。修正または削除してください。`);
      return;
    }
    const payload = { name: selectedTemplate.value.name, modules: form.modules };
    const data = await updatePromptTemplate(selectedTemplate.value.id, payload);
    const index = templates.value.findIndex((item) => item.id === selectedTemplate.value.id);
    if (index >= 0) templates.value[index] = data.template;
    copyToForm(data.template);
    ElMessage.success('テンプレートを保存しました');
  } catch (error) {
    if (error.rejected?.length) {
      applyAnalysisChecks(form.modules, {
        rules: error.rejected.map((item) => ({ line: item.line, status: 'rejected', reason: item.reason })),
      });
    }
    ElMessage.error(error.message || '保存に失敗しました');
  } finally {
    saving.value = false;
  }
}

async function resetTemplate() {
  if (!selectedTemplate.value) return;
  await ElMessageBox.confirm('このテンプレートを初期状態に戻しますか？', '確認', { confirmButtonText: 'OK', cancelButtonText: 'キャンセル' });
  try {
    const data = await resetPromptTemplate(selectedTemplate.value.id);
    const index = templates.value.findIndex((item) => item.id === selectedTemplate.value.id);
    if (index >= 0) templates.value[index] = data.template;
    copyToForm(data.template);
    ElMessage.success('初期状態に戻しました');
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
        <div class="list-heading">抽出テンプレート</div>
        <el-input v-model="search" placeholder="検索" clearable class="template-search" />
        <el-button type="primary" class="create-button" @click="createTemplate">＋ 追加</el-button>
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
          <span v-if="editingTemplateId !== template.id" class="template-copy">
            <b>{{ template.name }}<em v-if="template.isStandard" class="standard-tag">標準</em></b>
          </span>
          <span v-else class="rename-wrap"><input v-model="editingTemplateName" :disabled="renaming" autofocus @click.stop @keydown.enter.prevent.stop="finishRename(template)" @keydown.esc.prevent.stop="cancelRename" @blur="finishRename(template)" /></span>
          <el-dropdown trigger="click" @command="(command) => handleTemplateCommand(command, template)" @click.stop>
            <button type="button" class="more-button" aria-label="操作" @click.stop>•••</button>
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
          <h2>
            {{ selectedTemplate.name }}
          </h2>
          <div class="editor-actions">
            <template v-if="!readOnlyTemplate">
              <el-button @click="resetTemplate">初期状態に戻す</el-button>
              <el-button type="primary" :loading="saving" @click="saveTemplate">保存</el-button>
            </template>
            <span v-else class="readonly-hint">1 期の内容そのまま。変更する場合はコピーしてから編集します。</span>
          </div>
        </div>

        <div class="module-list">
          <article
            v-for="mod in visibleModules"
            :key="mod.id"
            class="module-card"
            :class="{ open: isOpen(mod.id), locked: isLockedModule(mod) }"
          >
            <header class="module-head" @click="toggleModule(mod.id)">
              <span class="caret" aria-hidden="true"></span>
              <h3>{{ mod.name }}</h3>
              <el-button v-if="!isLockedModule(mod)" size="small" class="check-btn" :loading="checking[mod.id]" @click.stop="checkModule(mod)">チェック</el-button>
            </header>

            <div v-show="isOpen(mod.id)" class="module-body">
              <!-- 画面には業務抽出ルールだけを出す。 -->
              <ul class="rule-list">
                <li v-for="({ rule, index }, displayIndex) in visibleRules(mod)" :key="index" class="rule-item">
                  <span class="rule-index" aria-hidden="true">{{ displayIndex + 1 }}</span>
                  <template v-if="isLockedRule(mod)">
                    <pre class="rule-readonly">{{ rule.text }}</pre>
                  </template>
                  <template v-else>
                    <el-input v-model="rule.text" type="textarea" :autosize="{ minRows: 1, maxRows: 6 }" />
                    <div class="rule-actions">
                      <span v-if="ruleStatus(mod.id, index)" class="rule-status" :class="ruleStatus(mod.id, index)">{{ statusLabel(mod.id, index) }}</span>
                      <button type="button" class="rule-remove" title="削除" @click="removeRule(mod, index)">×</button>
                    </div>
                    <p v-if="ruleReason(mod.id, index)" class="rule-reason">{{ ruleReason(mod.id, index) }}</p>
                  </template>
                </li>
              </ul>
              <button v-if="!isLockedModule(mod)" type="button" class="add-rule" @click="addRule(mod)">＋ ルールを追加</button>
            </div>
          </article>
        </div>
      </main>
      <div v-else class="empty-state">テンプレートがありません</div>
    </div>
  </section>
</template>

<style scoped>
.prompt-page {
  min-height: 100%;
  padding: 18px 22px 26px;
  background: #f5f7fa;
  color: #1e3a5f;
  font-family: "Noto Sans JP", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.workspace {
  display: grid;
  grid-template-columns: 230px minmax(0, 1fr);
  min-height: calc(100vh - 106px);
  border: 1px solid #e6ebf1;
  border-radius: 6px;
  background: #fff;
  overflow: hidden;
}

.template-list { padding: 14px 10px; border-right: 1px solid #e6ebf1; background: #fafbfd; }
.list-heading { padding: 0 8px 10px; color: #64748b; font-size: 13px; }
.template-search { margin-bottom: 10px; }
.template-search :deep(.el-input__wrapper) { border-radius: 4px; box-shadow: 0 0 0 1px #dbe3ec inset; }

.create-button {
  width: 100%;
  height: 34px;
  margin-bottom: 10px;
  border-color: #0076bf;
  border-radius: 4px;
  background: #0076bf;
}

.template-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 9px 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #334155;
  text-align: left;
  cursor: pointer;
}

.template-item:hover { background: #eef4fa; }
.template-item.active { background: #e8f1fb; color: #0076bf; }
.template-copy { display: grid; flex: 1; }
.template-copy b { font-size: 13.5px; font-weight: 500; }

.standard-tag {
  margin-left: 6px;
  padding: 0 5px;
  border-radius: 3px;
  background: #e8f1fb;
  color: #0076bf;
  font-size: 10px;
  font-style: normal;
  font-weight: 600;
}

.more-button { border: 0; background: transparent; color: #b0bcc9; letter-spacing: 2px; cursor: pointer; }
.rename-wrap { flex: 1; }
.rename-wrap input { width: 100%; box-sizing: border-box; padding: 4px 6px; border: 1px solid #84adff; border-radius: 4px; color: #344054; font: inherit; }

.editor-pane { min-width: 0; padding: 20px 26px 26px; background: #fff; }

.editor-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 14px;
  border-bottom: 1px solid #eef1f5;
}

.editor-title h2 { margin: 0; color: #1e3a5f; font-size: 18px; font-weight: 600; }
.editor-actions { display: flex; gap: 8px; }
.editor-actions :deep(.el-button) { height: 30px; padding: 0 13px; border-radius: 4px; }
.editor-actions :deep(.el-button--primary) { border-color: #0076bf; background: #0076bf; }

/* 1期共通テンプレートは読み取り専用。操作ボタンの代わりに説明を出す。 */
.readonly-hint { color: #94a3b8; font-size: 12px; }

.module-card.locked .rule-item { grid-template-columns: 22px minmax(0, 1fr); }
.rule-readonly {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid #eef1f5;
  border-radius: 4px;
  background: #fafbfd;
  color: #475569;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.module-list { display: grid; gap: 8px; margin-top: 16px; }

.module-card { border: 1px solid #eef1f5; border-radius: 6px; background: #fff; }

.module-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
}

.module-head:hover { background: #fafbfd; }

.caret {
  width: 0;
  height: 0;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 5px solid #b0bcc9;
  transition: transform 0.15s ease;
}

.module-card.open .caret { transform: rotate(90deg); }

.module-head h3 { margin: 0; color: #1e3a5f; font-size: 14px; font-weight: 500; }

.check-btn { margin-left: auto; border-radius: 4px; }

.module-body { padding: 0 14px 12px 27px; }

.rule-list { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }

.rule-item {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  gap: 6px;
  align-items: start;
}

.rule-index {
  padding-top: 7px;
  color: #94a3b8;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  line-height: 1.7;
  text-align: right;
  user-select: none;
}

.rule-item :deep(.el-textarea__inner) {
  min-height: 30px !important;
  padding: 5px 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: #f1f5f9;
  color: #334155;
  font-size: 12.5px;
  line-height: 1.7;
  box-shadow: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}

.rule-item :deep(.el-textarea__inner:hover) { background: #e8eef5; }
.rule-item :deep(.el-textarea__inner:focus) { border-color: #0076bf; background: #fff; box-shadow: 0 0 0 2px rgba(0, 118, 191, 0.1); }

.rule-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 30px;
}

.rule-status { font-size: 11px; font-weight: 600; white-space: nowrap; }
.rule-status.ok { color: #1d9e75; }
.rule-status.ng { color: #d85a30; }

.rule-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: #fdece6;
  color: #d85a30;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease;
}

.rule-item:hover .rule-remove { opacity: 1; }
.rule-remove:hover { background: #f8d5cb; }

/* 無効なルールの下に、どの規則と衝突しているかを出す。 */
.rule-reason {
  grid-column: 2 / 3;
  margin: 1px 0 5px;
  padding: 0;
  background: transparent;
  color: #d93025;
  font-size: 11.5px;
  line-height: 1.65;
}

.add-rule {
  margin: 6px 0 0;
  padding: 3px 8px;
  border: 1px dashed #dbe3ec;
  border-radius: 4px;
  background: transparent;
  color: #98a2b3;
  font-size: 12px;
  cursor: pointer;
}

.add-rule:hover { border-color: #0076bf; color: #0076bf; }

.empty-state { display: grid; place-items: center; color: #98a2b3; }

@media (max-width: 900px) {
  .workspace { grid-template-columns: 1fr; }
  .template-list { border-right: 0; border-bottom: 1px solid #e6ebf1; }
  .editor-pane { padding: 20px 18px; }
}
</style>
