import { DEFAULT_AI_SYSTEM_PROMPT } from './prompt'
import type { AiProtocol, AiProviderProfile } from './types'

export interface AiProviderPreset {
  id: string
  name: string
  protocol: AiProtocol
  baseUrl: string
  models: string[]
  contextWindowTokens: number
  maxInputTokens: number
  maxOutputTokens: number
}

export const aiProviderPresets: AiProviderPreset[] = [
  { id: 'openai-responses', name: 'OpenAI · Responses', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', models: ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.5'], contextWindowTokens: 200000, maxInputTokens: 60000, maxOutputTokens: 6000 },
  { id: 'openai-chat', name: 'OpenAI · Chat Completions', protocol: 'openai-chat-completions', baseUrl: 'https://api.openai.com/v1', models: ['gpt-5.6-luna', 'gpt-5.5', 'gpt-4.1-mini'], contextWindowTokens: 200000, maxInputTokens: 60000, maxOutputTokens: 6000 },
  { id: 'anthropic', name: 'Anthropic', protocol: 'anthropic-messages', baseUrl: 'https://api.anthropic.com', models: ['claude-sonnet-5', 'claude-opus-4-6', 'claude-haiku-4-5'], contextWindowTokens: 200000, maxInputTokens: 60000, maxOutputTokens: 6000 },
  { id: 'deepseek', name: 'DeepSeek', protocol: 'openai-responses', baseUrl: 'https://api.deepseek.com', models: ['deepseek-v4-flash', 'deepseek-v4-pro'], contextWindowTokens: 128000, maxInputTokens: 50000, maxOutputTokens: 6000 },
  { id: 'qwen', name: '阿里云百炼 · Qwen', protocol: 'openai-chat-completions', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-max', 'qwen-turbo'], contextWindowTokens: 128000, maxInputTokens: 50000, maxOutputTokens: 6000 },
  { id: 'openrouter', name: 'OpenRouter', protocol: 'openai-chat-completions', baseUrl: 'https://openrouter.ai/api/v1', models: ['~openai/gpt-latest', '~anthropic/claude-sonnet-latest', 'openrouter/auto'], contextWindowTokens: 128000, maxInputTokens: 50000, maxOutputTokens: 6000 },
]

export const aiProtocolLabels: Record<AiProtocol, string> = {
  'openai-responses': 'OpenAI Responses',
  'openai-chat-completions': 'OpenAI Chat Completions',
  'anthropic-messages': 'Anthropic Messages',
}

export function profileFromPreset(presetId: string, id = `ai_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`): AiProviderProfile {
  const preset = aiProviderPresets.find((item) => item.id === presetId) ?? aiProviderPresets[0]
  return {
    id,
    name: preset.name,
    presetId: preset.id,
    protocol: preset.protocol,
    baseUrl: preset.baseUrl,
    models: [...preset.models],
    model: preset.models[0],
    timeoutSeconds: 0,
    contextWindowTokens: preset.contextWindowTokens,
    maxInputTokens: preset.maxInputTokens,
    maxOutputTokens: preset.maxOutputTokens,
    systemPrompt: DEFAULT_AI_SYSTEM_PROMPT,
  }
}
