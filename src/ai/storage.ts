import { aiProviderPresets } from './presets'
import { DEFAULT_AI_SYSTEM_PROMPT } from './prompt'
import type { AiProviderProfile, AiProviderState } from './types'

const PROFILE_KEY = 'interactiveTravel.ai.providers.v1'
const SESSION_SECRET_KEY = 'interactiveTravel.ai.secrets.session.v1'
const LOCAL_SECRET_KEY = 'interactiveTravel.ai.secrets.local.v1'

function readRecord(storage: Storage, key: string): Record<string, string> {
  try { return JSON.parse(storage.getItem(key) ?? '{}') as Record<string, string> } catch { return {} }
}

function normalizeProfile(profile: Partial<AiProviderProfile>): AiProviderProfile | null {
  if (!profile.id || !profile.name || !profile.protocol || !profile.baseUrl) return null
  const preset = aiProviderPresets.find((item) => item.id === profile.presetId)
  const model = String(profile.model || profile.models?.[0] || preset?.models[0] || '').trim()
  if (!model) return null
  const sourceModels = profile.models?.length ? profile.models : preset?.models ?? []
  const models = [...new Set([...sourceModels, model].map((item) => String(item).trim()).filter(Boolean))]
  const contextWindowTokens = Number(profile.contextWindowTokens) || preset?.contextWindowTokens || 128000
  const maxOutputTokens = Number(profile.maxOutputTokens) || preset?.maxOutputTokens || 5000
  const maxInputTokens = Number(profile.maxInputTokens) || preset?.maxInputTokens || Math.max(1000, contextWindowTokens - maxOutputTokens)
  return {
    id: profile.id,
    name: profile.name,
    presetId: profile.presetId ?? null,
    protocol: profile.protocol,
    baseUrl: profile.baseUrl,
    models,
    model,
    timeoutSeconds: Number(profile.timeoutSeconds) || 0,
    contextWindowTokens,
    maxInputTokens,
    maxOutputTokens,
    systemPrompt: String(profile.systemPrompt || DEFAULT_AI_SYSTEM_PROMPT),
  }
}

export function readAiProviderState(): AiProviderState {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null') as AiProviderState | null
    const profiles = (saved?.profiles?.map(normalizeProfile).filter((item): item is AiProviderProfile => Boolean(item)) ?? [])
      .filter((profile) => !profile.id.startsWith('preset_') || Boolean(readAiSecret(profile.id).apiKey))
    if (profiles.length) {
      const requestedDefaultId = saved?.defaultId || saved?.activeId
      const defaultId = profiles.some((item) => item.id === requestedDefaultId) ? requestedDefaultId! : profiles[0].id
      return { profiles, activeId: defaultId, defaultId }
    }
  } catch { /* use empty state */ }
  return { profiles: [], activeId: '', defaultId: '' }
}

export function saveAiProviderState(state: AiProviderState): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...state, activeId: state.defaultId || state.activeId, defaultId: state.defaultId || state.activeId }))
}

export function readAiSecret(profileId: string): { apiKey: string; remembered: boolean } {
  const local = readRecord(localStorage, LOCAL_SECRET_KEY)
  if (local[profileId]) return { apiKey: local[profileId], remembered: true }
  const session = readRecord(sessionStorage, SESSION_SECRET_KEY)
  return { apiKey: session[profileId] ?? '', remembered: false }
}

export function saveAiSecret(profileId: string, apiKey: string, remember: boolean): void {
  const session = readRecord(sessionStorage, SESSION_SECRET_KEY)
  const local = readRecord(localStorage, LOCAL_SECRET_KEY)
  delete session[profileId]
  delete local[profileId]
  if (apiKey.trim()) (remember ? local : session)[profileId] = apiKey.trim()
  sessionStorage.setItem(SESSION_SECRET_KEY, JSON.stringify(session))
  localStorage.setItem(LOCAL_SECRET_KEY, JSON.stringify(local))
}

export function deleteAiSecret(profileId: string): void {
  saveAiSecret(profileId, '', false)
}
