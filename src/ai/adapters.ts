import { normalizeImportDurationDays } from './importDuration'
import type { AiImportDraft, AiInputImage, AiProviderProfile } from './types'
import { localizeAiSystemPrompt } from '../i18n'

const placeCategories = ['attraction', 'food', 'lodging', 'viewpoint', 'culture', 'nature', 'transport', 'shopping', 'other']
const transportModes = ['driving', 'walking', 'cycling', 'transit', 'train', 'flight', 'ferry']
const placeKinds = ['poi', 'city', 'scenic-route', 'lodging-area', 'food', 'transport-hub']

const travelDraftSchema = {
  type: 'object', additionalProperties: false,
  required: ['title', 'durationDays', 'origin', 'returnToOrigin', 'days', 'generalNotes', 'uncertainties'],
  properties: {
    title: { type: 'string' }, durationDays: { type: ['integer', 'null'], minimum: 1, description: '攻略明确写出的总行程天数，例如“5天4晚”应为 5；即使只有部分逐日明细也必须保留总天数。' }, origin: { type: ['string', 'null'] }, returnToOrigin: { type: ['boolean', 'null'] },
    days: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['sourceLabel', 'startArea', 'endArea', 'overnightArea', 'places'], properties: {
          sourceLabel: { type: 'string' }, startArea: { type: ['string', 'null'] }, endArea: { type: ['string', 'null'] }, overnightArea: { type: ['string', 'null'] },
          places: {
            type: 'array', items: {
              type: 'object', additionalProperties: false, required: ['name', 'kind', 'category', 'note', 'stayMinutes', 'transportToNext'], properties: {
                name: { type: 'string' }, kind: { type: 'string', enum: placeKinds }, category: { type: 'string', enum: placeCategories }, note: { type: 'string' },
                stayMinutes: { type: ['integer', 'null'] }, transportToNext: { type: ['string', 'null'], enum: [...transportModes, null] },
              }
            }
          },
        }
      }
    },
    generalNotes: { type: 'array', items: { type: 'string' } }, uncertainties: { type: 'array', items: { type: 'string' } },
  },
}

function parseJsonText(text: string): any {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(cleaned) } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1))
    throw new Error('AI 没有返回可解析的 JSON')
  }
}

function normalizeDraft(value: any): AiImportDraft {
  const days = Array.isArray(value?.days) ? value.days : []
  if (!days.length) throw new Error('AI 返回结果中没有可用的按天行程')
  return {
    title: String(value.title || 'AI 导入的旅行计划').trim(),
    durationDays: normalizeImportDurationDays(value.durationDays, days.length, String(value.title ?? '')),
    origin: value.origin ? String(value.origin).trim() : null,
    returnToOrigin: typeof value.returnToOrigin === 'boolean' ? value.returnToOrigin : null,
    days: days.map((day: any, dayIndex: number) => ({
      sourceLabel: String(day.sourceLabel || `D${dayIndex + 1}`),
      startArea: day.startArea ? String(day.startArea).trim() : null,
      endArea: day.endArea ? String(day.endArea).trim() : null,
      overnightArea: day.overnightArea ? String(day.overnightArea).trim() : null,
      places: (Array.isArray(day.places) ? day.places : []).map((place: any) => ({
        name: String(place.name || '').trim(),
        kind: placeKinds.includes(place.kind) ? place.kind : 'poi',
        category: placeCategories.includes(place.category) ? place.category : 'other',
        note: String(place.note || '').trim(),
        stayMinutes: Number.isFinite(place.stayMinutes) ? Math.max(0, Math.min(720, Math.round(place.stayMinutes))) : null,
        transportToNext: transportModes.includes(place.transportToNext) ? place.transportToNext : null,
      })).filter((place: any) => place.name),
    })),
    generalNotes: (Array.isArray(value.generalNotes) ? value.generalNotes : []).map(String).filter(Boolean),
    uncertainties: (Array.isArray(value.uncertainties) ? value.uncertainties : []).map(String).filter(Boolean),
  }
}

function responsesText(data: any): string {
  if (typeof data?.output_text === 'string') return data.output_text
  for (const item of data?.output ?? []) for (const content of item?.content ?? []) if (content?.type === 'output_text' && content.text) return content.text
  throw new Error('Responses API 未返回文本结果')
}

async function createOpenAiClient(profile: AiProviderProfile, apiKey: string): Promise<any> {
  const { default: OpenAI } = await import('openai')
  const timeout = profile.timeoutSeconds && profile.timeoutSeconds > 0 ? profile.timeoutSeconds * 1000 : undefined
  return new OpenAI({ apiKey, baseURL: profile.baseUrl.trim().replace(/\/+$/, ''), timeout, maxRetries: 0, dangerouslyAllowBrowser: true })
}

async function createAnthropicClient(profile: AiProviderProfile, apiKey: string): Promise<any> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const timeout = profile.timeoutSeconds && profile.timeoutSeconds > 0 ? profile.timeoutSeconds * 1000 : undefined
  return new Anthropic({ apiKey, baseURL: profile.baseUrl.trim().replace(/\/+$/, ''), timeout, maxRetries: 0, dangerouslyAllowBrowser: true })
}

function normalizeSdkError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error('AI 请求失败')
  if (/abort|aborted/i.test(`${error.name} ${error.message}`)) return new Error('AI 请求已取消')
  if (/timeout|timed out/i.test(error.message)) return new Error('AI 请求超时，请检查供应商或网络')
  if (/connection|fetch|network|cors|failed to fetch/i.test(`${error.name} ${error.message}`)) return new Error('无法连接 AI 供应商，可能是 URL、网络或浏览器 CORS 限制')
  return error
}

function sourceInstruction(sourceText: string): string {
  return sourceText.trim() || '请根据用户提供的图片识别旅行分享内容并生成结构化计划草稿。'
}

function dataUrlBase64(image: AiInputImage): string {
  return image.dataUrl.slice(image.dataUrl.indexOf(',') + 1)
}

interface StructuredOutputRequest {
  schemaName: string
  toolName: string
  toolDescription: string
  schema: Record<string, unknown>
  userText: string
  systemPrompt: string
  images?: AiInputImage[]
  signal?: AbortSignal
}

async function callResponses(profile: AiProviderProfile, apiKey: string, request: StructuredOutputRequest): Promise<any> {
  const client = await createOpenAiClient(profile, apiKey)
  const images = request.images ?? []
  const data = await client.responses.create({
    model: profile.model,
    input: [
      { role: 'system', content: [{ type: 'input_text', text: request.systemPrompt }] },
      { role: 'user', content: [{ type: 'input_text', text: request.userText }, ...images.map((image) => ({ type: 'input_image', image_url: image.dataUrl }))] },
    ],
    text: { format: { type: 'json_schema', name: request.schemaName, strict: true, schema: request.schema } },
    max_output_tokens: profile.maxOutputTokens,
  }, { signal: request.signal })
  return parseJsonText(responsesText(data))
}

async function callChat(profile: AiProviderProfile, apiKey: string, request: StructuredOutputRequest): Promise<any> {
  const client = await createOpenAiClient(profile, apiKey)
  const images = request.images ?? []
  const baseBody = {
    model: profile.model,
    messages: [
      { role: 'system', content: request.systemPrompt },
      { role: 'user', content: [{ type: 'text', text: request.userText }, ...images.map((image) => ({ type: 'image_url', image_url: { url: image.dataUrl } }))] },
    ],
    max_tokens: profile.maxOutputTokens,
  }
  let data: any
  try {
    data = await client.chat.completions.create({ ...baseBody, response_format: { type: 'json_schema', json_schema: { name: request.schemaName, strict: true, schema: request.schema } } }, { signal: request.signal })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (!/schema|response_format|unsupported|400|422/i.test(message)) throw error
    data = await client.chat.completions.create(baseBody, { signal: request.signal })
  }
  const content = data?.choices?.[0]?.message?.content
  return parseJsonText(typeof content === 'string' ? content : JSON.stringify(content))
}

async function callAnthropic(profile: AiProviderProfile, apiKey: string, request: StructuredOutputRequest): Promise<any> {
  const client = await createAnthropicClient(profile, apiKey)
  const images = request.images ?? []
  const data = await client.messages.create({
    model: profile.model,
    system: request.systemPrompt,
    messages: [{
      role: 'user', content: [
        { type: 'text', text: request.userText },
        ...images.map((image) => ({ type: 'image', source: { type: 'base64', media_type: image.mimeType, data: dataUrlBase64(image) } })),
      ]
    }],
    max_tokens: profile.maxOutputTokens,
    tools: [{ name: request.toolName, description: request.toolDescription, input_schema: request.schema }],
    tool_choice: { type: 'tool', name: request.toolName },
  }, { signal: request.signal })
  const toolUse = data?.content?.find((item: any) => item.type === 'tool_use' && item.name === request.toolName)
  if (!toolUse?.input) throw new Error('Anthropic 没有返回结构化工具结果')
  return toolUse.input
}

export function estimateTokenCount(text: string): number {
  let units = 0
  for (const character of text) units += /[\u3400-\u9fff\uf900-\ufaff]/.test(character) ? 1 : 0.28
  return Math.max(1, Math.ceil(units))
}

export function estimateMultimodalTokens(text: string, imageCount: number, systemPrompt = ''): number {
  return estimateTokenCount(`${systemPrompt}\n${text}`) + imageCount * 1500
}

export async function requestStructuredOutput(profile: AiProviderProfile, apiKey: string, request: StructuredOutputRequest): Promise<any> {
  if (!apiKey.trim()) throw new Error('请先配置该接入实例的 API Key')
  const images = request.images ?? []
  const estimatedInputTokens = estimateMultimodalTokens(request.userText, images.length, request.systemPrompt)
  if (estimatedInputTokens > profile.maxInputTokens) throw new Error(`输入内容约 ${estimatedInputTokens} Token，超过当前实例设置的 ${profile.maxInputTokens} Token 上限`)
  if (profile.maxInputTokens + profile.maxOutputTokens > profile.contextWindowTokens) throw new Error('输入和输出上限之和超过模型上下文窗口，请检查接入实例配置')
  try {
    return profile.protocol === 'openai-responses'
      ? await callResponses(profile, apiKey, request)
      : profile.protocol === 'openai-chat-completions'
        ? await callChat(profile, apiKey, request)
        : await callAnthropic(profile, apiKey, request)
  } catch (error) {
    throw normalizeSdkError(error)
  }
}

export async function extractTravelPlan(profile: AiProviderProfile, apiKey: string, sourceText: string, images: AiInputImage[] = [], systemPromptOverride?: string, signal?: AbortSignal): Promise<AiImportDraft> {
  if (sourceText.trim().length < 20 && !images.length) throw new Error('请粘贴更完整的旅行分享文字或图片')
  if (sourceText.length > 50_000) throw new Error('文本过长，请控制在 5 万字以内')
  if (images.length > 6) throw new Error('单次最多上传 6 张图片')
  const raw = await requestStructuredOutput(profile, apiKey, {
    schemaName: 'travel_plan_import',
    toolName: 'extract_travel_plan',
    toolDescription: '提取结构化旅行计划',
    schema: travelDraftSchema,
    userText: sourceInstruction(sourceText),
    systemPrompt: localizeAiSystemPrompt(systemPromptOverride?.trim() || profile.systemPrompt),
    images,
    signal,
  })
  return normalizeDraft(raw)
}

export async function generateAiCoverImage(profile: AiProviderProfile, apiKey: string, model: string, prompt: string): Promise<string> {
  if (profile.protocol === 'anthropic-messages') throw new Error('当前 Anthropic 协议实例不提供图片生成接口，请选择 OpenAI 兼容实例')
  if (!apiKey.trim()) throw new Error('请先配置该接入实例的 API Key')
  if (!model.trim()) throw new Error('请填写图片生成模型')
  try {
    const client = await createOpenAiClient(profile, apiKey)
    const response = await client.images.generate({ model: model.trim(), prompt: prompt.trim(), size: '1024x1536', quality: 'medium', output_format: 'png' })
    const image = response?.data?.[0]
    if (image?.b64_json) return `data:image/png;base64,${image.b64_json}`
    if (image?.url) {
      const result = await fetch(image.url)
      if (!result.ok) throw new Error('AI 图片下载失败')
      const blob = await result.blob()
      return await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('AI 图片读取失败')); reader.readAsDataURL(blob) })
    }
    throw new Error('图片生成接口没有返回图片')
  } catch (error) {
    throw normalizeSdkError(error)
  }
}

export async function listAiModels(profile: AiProviderProfile, apiKey: string): Promise<string[]> {
  if (!profile.baseUrl.trim()) throw new Error('请先填写 Base URL')
  if (!apiKey.trim()) throw new Error('请先填写 API Key')
  try {
    const client = profile.protocol === 'anthropic-messages'
      ? await createAnthropicClient(profile, apiKey)
      : await createOpenAiClient(profile, apiKey)
    const page = await client.models.list()
    const ids: string[] = []
    if (page && Symbol.asyncIterator in Object(page)) {
      for await (const model of page) {
        const id = String(model?.id ?? '').trim()
        if (id) ids.push(id)
        if (ids.length >= 500) break
      }
    } else {
      for (const model of page?.data ?? []) {
        const id = String(model?.id ?? '').trim()
        if (id) ids.push(id)
      }
    }
    return [...new Set(ids)]
  } catch (error) {
    throw normalizeSdkError(error)
  }
}

export async function testAiConnection(profile: AiProviderProfile, apiKey: string): Promise<void> {
  if (!apiKey.trim()) throw new Error('请填写 API Key')
  try {
    if (profile.protocol === 'openai-responses') {
      const client = await createOpenAiClient(profile, apiKey)
      await client.responses.create({ model: profile.model, input: '只回复 OK。', max_output_tokens: 8 })
    } else if (profile.protocol === 'openai-chat-completions') {
      const client = await createOpenAiClient(profile, apiKey)
      await client.chat.completions.create({ model: profile.model, messages: [{ role: 'user', content: '只回复 OK。' }], max_tokens: 8 })
    } else {
      const client = await createAnthropicClient(profile, apiKey)
      await client.messages.create({ model: profile.model, messages: [{ role: 'user', content: '只回复 OK。' }], max_tokens: 8 })
    }
  } catch (error) {
    throw normalizeSdkError(error)
  }
}
