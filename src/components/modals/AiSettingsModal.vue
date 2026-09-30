<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  ElAutocomplete,
  ElButton,
  ElDialog,
  ElInput,
  ElInputNumber,
  ElOption,
  ElPopconfirm,
  ElSelect,
  ElSwitch,
  ElTag,
} from "element-plus";
import { listAiModels, testAiConnection } from "../../ai/adapters";
import {
  aiProtocolLabels,
  aiProviderPresets,
  profileFromPreset,
} from "../../ai/presets";
import { DEFAULT_AI_SYSTEM_PROMPT } from "../../ai/prompt";
import type { AiProviderProfile } from "../../ai/types";
import { useAiProvidersStore } from "../../stores/aiProviders";
import { usePlannerStore } from "../../stores/planner";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const providers = useAiProvidersStore();
const planner = usePlannerStore();
const selectedId = ref("");
const draft = ref<AiProviderProfile | null>(null);
const apiKey = ref("");
const remember = ref(false);
const testing = ref(false);
const fetchingModels = ref(false);
const fetchedModelCount = ref(0);
let fetchedModelSignature = "";
const advancedOpen = ref(false);

const selectedProfile = computed(
  () => providers.profiles.find((item) => item.id === selectedId.value) ?? null,
);
const contextUsage = computed(
  () =>
    (draft.value?.maxInputTokens ?? 0) + (draft.value?.maxOutputTokens ?? 0),
);
const contextValid = computed(
  () =>
    Boolean(draft.value) &&
    contextUsage.value <= (draft.value?.contextWindowTokens ?? 0),
);

function loadProfile(id: string): void {
  const profile = providers.profiles.find((item) => item.id === id);
  if (!profile) return;
  selectedId.value = id;
  draft.value = JSON.parse(JSON.stringify(profile)) as AiProviderProfile;
  const secret = providers.readSecret(id);
  apiKey.value = secret.apiKey;
  remember.value = secret.remembered;
  fetchedModelCount.value = 0;
  fetchedModelSignature = "";
}

function createInstanceDraft(presetId = "openai-responses"): void {
  const profile = profileFromPreset(presetId);
  profile.name = `${profile.name} 接入`;
  selectedId.value = "";
  draft.value = profile;
  apiKey.value = "";
  remember.value = false;
  fetchedModelCount.value = 0;
  fetchedModelSignature = "";
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    advancedOpen.value = false;
    if (providers.activeProfile) loadProfile(providers.activeProfile.id);
    else createInstanceDraft();
  },
);
watch(selectedProfile, (profile) => {
  if (profile && draft.value?.id !== profile.id) loadProfile(profile.id);
});

function applyPreset(presetId: string): void {
  if (draft.value) draft.value = providers.applyPreset(draft.value, presetId);
  fetchedModelCount.value = 0;
  fetchedModelSignature = "";
}

function addProfile(): void {
  createInstanceDraft();
}

function setDefaultProfile(): void {
  if (!selectedId.value) return;
  providers.setDefault(selectedId.value);
  planner.notify("已设为默认 AI 接入实例");
}

function duplicateProfile(): void {
  if (!draft.value) return;
  const profile = JSON.parse(JSON.stringify(draft.value)) as AiProviderProfile;
  profile.id = `ai_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
  profile.name = `${profile.name} 副本`;
  selectedId.value = "";
  draft.value = profile;
}

function deleteProfile(): void {
  const id = selectedId.value;
  providers.remove(id);
  if (providers.activeProfile) loadProfile(providers.activeProfile.id);
  else createInstanceDraft();
}

function save(): void {
  if (!draft.value) return;
  if (
    !draft.value.name.trim() ||
    !draft.value.baseUrl.trim() ||
    !draft.value.model.trim()
  ) {
    planner.notify("请填写实例名称、Base URL 和默认模型");
    return;
  }
  if (!draft.value.systemPrompt.trim()) {
    planner.notify("请填写系统提示词，或恢复内置默认提示词");
    return;
  }
  if (!apiKey.value.trim()) {
    planner.notify("请填写 API Key，保存后才会成为可用的 AI 接入实例");
    return;
  }
  if (!contextValid.value) {
    planner.notify("最大输入与最大输出之和不能超过上下文窗口");
    return;
  }
  const models = [
    ...new Set(
      [...draft.value.models, draft.value.model]
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  const saved = {
    ...draft.value,
    name: draft.value.name.trim(),
    baseUrl: draft.value.baseUrl.trim(),
    models,
    model: draft.value.model.trim(),
  };
  providers.updateProfile(saved, apiKey.value, remember.value);
  loadProfile(saved.id);
  planner.notify("AI 接入实例已保存");
}

function modelSuggestions(
  query: string,
  callback: (items: Array<{ value: string }>) => void,
): void {
  const keyword = query.trim().toLowerCase();
  const models = draft.value?.models ?? [];
  callback(
    models
      .filter((model) => !keyword || model.toLowerCase().includes(keyword))
      .map((value) => ({ value })),
  );
}

async function fetchModels(force = true): Promise<void> {
  if (!draft.value || fetchingModels.value) return;
  const signature = `${draft.value.protocol}|${draft.value.baseUrl.trim()}|${apiKey.value.trim()}`;
  if (!force && fetchedModelSignature === signature) return;
  fetchingModels.value = true;
  try {
    const models = await listAiModels(draft.value, apiKey.value);
    if (!models.length) throw new Error("供应商没有返回可用模型");
    draft.value.models = [
      ...new Set(
        [...models, ...draft.value.models, draft.value.model]
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
    fetchedModelCount.value = models.length;
    fetchedModelSignature = signature;
    planner.notify(`已从供应商获取 ${models.length} 个模型`);
  } catch (error) {
    planner.notify(
      error instanceof Error
        ? error.message
        : "模型列表查询失败；仍可手动填写模型 ID",
    );
  } finally {
    fetchingModels.value = false;
  }
}

function maybeFetchModels(): void {
  if (draft.value?.baseUrl.trim() && apiKey.value.trim())
    void fetchModels(false);
}

async function testConnection(): Promise<void> {
  if (!draft.value) return;
  testing.value = true;
  try {
    await testAiConnection(draft.value, apiKey.value);
    planner.notify("AI 接入实例连接测试成功");
  } catch (error) {
    planner.notify(
      error instanceof Error ? error.message : "AI 接入实例连接测试失败",
    );
  } finally {
    testing.value = false;
  }
}
</script>

<template>
  <ElDialog
    :model-value="open"
    class="travel-dialog ai-settings-modal"
    width="760px"
    align-center
    destroy-on-close
    @update:model-value="!$event && emit('close')"
  >
    <template #header>
      <div class="ai-dialog-title">
        <div class="ai-dialog-icon"><i class="pi pi-microchip" /></div>
        <div>
          <h2>AI 接入实例配置</h2>
          <p>
            预置 Provider 只提供参数模板；填写名称、模型、URL 和 API Key
            后才形成一个可用实例。
          </p>
        </div>
      </div>
    </template>

    <div class="ai-settings-toolbar">
      <ElSelect
        v-model="selectedId"
        class="ai-profile-select"
        placeholder="选择已保存的接入实例"
        @change="loadProfile"
      >
        <ElOption
          v-for="profile in providers.profiles"
          :key="profile.id"
          :label="profile.name"
          :value="profile.id"
          ><span class="ai-profile-option"
            ><span>{{ profile.name }}</span
            ><ElTag
              v-if="profile.id === providers.activeId"
              type="success"
              size="small"
              effect="light"
              >默认</ElTag
            ></span
          ></ElOption
        >
      </ElSelect>
      <ElButton @click="addProfile"
        ><i class="pi pi-plus" />新增接入实例</ElButton
      >
      <ElButton
        v-if="selectedId"
        :type="selectedId === providers.activeId ? 'success' : 'default'"
        :disabled="selectedId === providers.activeId"
        @click="setDefaultProfile"
        ><i class="pi pi-star" />{{
          selectedId === providers.activeId ? "默认实例" : "设为默认"
        }}</ElButton
      >
      <ElButton text @click="duplicateProfile"
        ><i class="pi pi-copy" />复制</ElButton
      >
      <ElPopconfirm
        v-if="selectedId"
        title="删除这个 AI 接入实例配置？"
        confirm-button-text="删除"
        cancel-button-text="取消"
        confirm-button-type="danger"
        @confirm="deleteProfile"
      >
        <template #reference
          ><ElButton text type="danger"
            ><i class="pi pi-trash" />删除</ElButton
          ></template
        >
      </ElPopconfirm>
    </div>

    <div v-if="draft" class="ai-settings-form element-form">
      <div class="ai-settings-grid">
        <div class="field">
          <label>接入参数模板</label>
          <ElSelect
            :model-value="draft.presetId"
            placeholder="自定义配置"
            clearable
            @change="applyPreset"
          >
            <ElOption
              v-for="preset in aiProviderPresets"
              :key="preset.id"
              :label="preset.name"
              :value="preset.id"
            />
          </ElSelect>
        </div>
        <div class="field">
          <label>实例名称</label><ElInput v-model="draft.name" />
        </div>
      </div>
      <div class="ai-settings-grid ai-endpoint-grid">
        <div class="field">
          <label>Base URL</label
          ><ElInput
            v-model="draft.baseUrl"
            placeholder="模板仅初始填充，手动填写的 URL 优先"
          /><small
            >实际请求优先使用此处地址，可接入兼容 OpenAI 或 Anthropic
            协议的任意供应商。</small
          >
        </div>
        <div class="field">
          <label>API Key</label
          ><ElInput
            v-model="apiKey"
            type="password"
            show-password
            autocomplete="off"
            placeholder="与 Base URL 共同决定实际接入实例"
          /><small>只保存在当前浏览器，不会写入项目或旅行计划。</small>
        </div>
      </div>
      <div class="field ai-default-model-field">
        <label>默认模型</label>
        <div class="ai-model-combobox">
          <ElAutocomplete
            v-model="draft.model"
            class="ai-default-model-input"
            :fetch-suggestions="modelSuggestions"
            trigger-on-focus
            clearable
            placeholder="可直接输入任意模型 ID，也可从下拉建议中选择"
            @focus="maybeFetchModels"
          />
          <ElButton
            :loading="fetchingModels"
            :disabled="!draft.baseUrl.trim() || !apiKey.trim()"
            @click="fetchModels(true)"
            ><i class="pi pi-refresh" />查询模型</ElButton
          >
        </div>
        <small
          >模板中的模型只是示例；手动输入始终优先。<template
            v-if="fetchedModelCount"
          >
            最近从供应商获取 {{ fetchedModelCount }} 个模型。</template
          ></small
        >
      </div>
      <div v-if="advancedOpen" class="field">
        <label>协议</label>
        <ElSelect v-model="draft.protocol">
          <ElOption
            v-for="(label, value) in aiProtocolLabels"
            :key="value"
            :label="label"
            :value="value"
          />
        </ElSelect>
      </div>
      <div v-if="advancedOpen" class="field ai-model-list-field">
        <label>模型候选列表</label>
        <ElSelect
          v-model="draft.models"
          multiple
          filterable
          allow-create
          default-first-option
          placeholder="可继续手动补充模型 ID"
        >
          <ElOption
            v-for="model in draft.models"
            :key="model"
            :label="model"
            :value="model"
          />
        </ElSelect>
        <small
          >由模板示例、供应商查询结果和手动输入共同组成，不限制供应商实际可用模型。</small
        >
      </div>
      <section v-if="advancedOpen" class="ai-system-prompt-setting">
        <div class="ai-system-prompt-head">
          <div>
            <strong>默认系统提示词</strong
            ><span>用于约束攻略抽取规则，AI 导入时仍可临时修改。</span>
          </div>
          <ElButton
            text
            size="small"
            @click="draft.systemPrompt = DEFAULT_AI_SYSTEM_PROMPT"
            >恢复内置默认</ElButton
          >
        </div>
        <ElInput
          v-model="draft.systemPrompt"
          type="textarea"
          :autosize="{ minRows: 7, maxRows: 14 }"
          resize="vertical"
        />
      </section>
      <div class="ai-secret-option">
        <div class="ai-secret-copy">
          <strong>记住 API Key</strong
          ><span
            >关闭时只存 sessionStorage；开启后保存到当前浏览器
            localStorage。</span
          >
        </div>
        <ElSwitch v-model="remember" class="ai-secret-switch" />
      </div>
      <button
        type="button"
        class="ai-advanced-toggle"
        @click="advancedOpen = !advancedOpen"
      >
        <span><i class="pi pi-sliders-h" />高级设置</span
        ><small>{{
          advancedOpen
            ? "收起协议、模型候选、提示词和上下文配置"
            : "协议、模型候选、提示词和上下文"
        }}</small
        ><i :class="advancedOpen ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" />
      </button>
      <section v-if="advancedOpen" class="ai-context-settings">
        <div class="ai-context-heading">
          <div>
            <strong>上下文与请求大小</strong
            ><span
              >用于在发送请求前做本地限制，不会修改供应商模型本身的上下文能力。</span
            >
          </div>
          <ElTag :type="contextValid ? 'success' : 'danger'" effect="light"
            >{{ contextUsage.toLocaleString() }} /
            {{ draft.contextWindowTokens.toLocaleString() }} Token</ElTag
          >
        </div>
        <div class="ai-context-grid">
          <div class="field">
            <label>上下文窗口</label
            ><ElInputNumber
              v-model="draft.contextWindowTokens"
              :min="1000"
              :max="2000000"
              :step="1000"
              controls-position="right"
            /><small>模型可接受的输入和输出总量。</small>
          </div>
          <div class="field">
            <label>最大输入</label
            ><ElInputNumber
              v-model="draft.maxInputTokens"
              :min="500"
              :max="draft.contextWindowTokens"
              :step="500"
              controls-position="right"
            /><small>攻略正文与系统指令的本地上限。</small>
          </div>
          <div class="field">
            <label>最大输出</label
            ><ElInputNumber
              v-model="draft.maxOutputTokens"
              :min="200"
              :max="draft.contextWindowTokens"
              :step="200"
              controls-position="right"
            /><small>结构化行程草稿的生成上限。</small>
          </div>
          <div class="field">
            <label>请求超时（秒）</label
            ><ElInputNumber
              v-model="draft.timeoutSeconds"
              :min="0"
              :max="300"
              controls-position="right"
            /><small>0 表示无限等待，超过设定值后主动终止本次解析。</small>
          </div>
        </div>
        <div v-if="!contextValid" class="ai-context-error">
          <i
            class="pi pi-exclamation-circle"
          />最大输入与最大输出之和超过上下文窗口。
        </div>
      </section>
      <div v-if="advancedOpen" class="ai-runtime-row">
        <ElTag type="info" effect="light">浏览器直连模式</ElTag
        ><span
          >OpenAI 与 Anthropic 请求分别使用官方 JavaScript / TypeScript
          SDK。</span
        >
      </div>
      <div v-if="advancedOpen" class="ai-direct-warning">
        <i
          class="pi pi-info-circle"
        />请求直接从当前浏览器发送给所选供应商；若供应商不支持浏览器
        CORS，需要改用支持跨域的兼容网关。
      </div>
    </div>

    <template #footer>
      <ElButton text @click="emit('close')">关闭</ElButton>
      <ElButton :loading="testing" @click="testConnection">测试连接</ElButton>
      <ElButton type="primary" @click="save">保存配置</ElButton>
    </template>
  </ElDialog>
</template>
