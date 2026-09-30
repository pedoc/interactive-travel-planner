import type { PlaceCategory, PoiSearchResult, TransportMode, TripParticipant } from '../domain/types'

export type AiProtocol = 'openai-responses' | 'openai-chat-completions' | 'anthropic-messages'
export type AiPlaceKind = 'poi' | 'city' | 'scenic-route' | 'lodging-area' | 'food' | 'transport-hub'

export interface AiProviderProfile {
  id: string
  name: string
  presetId: string | null
  protocol: AiProtocol
  baseUrl: string
  models: string[]
  model: string
  timeoutSeconds?: number
  contextWindowTokens: number
  maxInputTokens: number
  maxOutputTokens: number
  systemPrompt: string
}

export interface AiProviderState {
  profiles: AiProviderProfile[]
  /** Legacy name retained for compatibility; represents the default AI instance. */
  activeId: string
  defaultId?: string
}


export interface AiInputImage {
  id: string
  name: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  dataUrl: string
  size: number
}

export interface AiImportPlace {
  name: string
  kind: AiPlaceKind
  category: PlaceCategory
  note: string
  stayMinutes: number | null
  transportToNext: TransportMode | null
}

export interface AiImportDay {
  sourceLabel: string
  startArea: string | null
  endArea: string | null
  overnightArea: string | null
  places: AiImportPlace[]
}

export interface AiImportDraft {
  title: string
  durationDays: number | null
  origin: string | null
  returnToOrigin: boolean | null
  days: AiImportDay[]
  generalNotes: string[]
  uncertainties: string[]
}

export interface AiResolvedPlace extends AiImportPlace {
  candidates: PoiSearchResult[]
  selectedId: string | null
}

export interface AiResolvedDay extends Omit<AiImportDay, 'places'> {
  places: AiResolvedPlace[]
}

export interface ResolvedPlanImport {
  title: string
  startDate: Date
  durationDays: number
  participants: TripParticipant[]
  budgetLimit: number | null
  days: Array<{
    places: Array<{
      place: PoiSearchResult
      stayMinutes: number | null
      transportToNext: TransportMode | null
    }>
  }>
}

export type AiRouteIssueCategory = 'detour' | 'overlong' | 'duplicate' | 'imbalance' | 'time-conflict' | 'other'
export type AiRouteIssueSeverity = 'info' | 'attention' | 'warning'

export interface AiRouteIssue {
  category: AiRouteIssueCategory
  severity: AiRouteIssueSeverity
  title: string
  detail: string
  dayIds: string[]
  stopUids: string[]
}

export interface AiRouteDayArrangement {
  dayId: string
  stopUids: string[]
}

export interface AiRouteOptimizationDraft {
  summary: string
  issues: AiRouteIssue[]
  dayArrangements: AiRouteDayArrangement[]
  returnToPoolStopUids: string[]
  reasons: string[]
  cautions: string[]
}

export interface AiRouteMetrics {
  totalKm: number
  totalTravelMinutes: number
  warnedDays: number
  conflictCount: number
  pendingSegments: number
}

export interface AiRouteValidation {
  before: AiRouteMetrics
  after: AiRouteMetrics
  routeCache: Record<string, [number, number, number?]>
  providerSegments: number
  estimatedSegments: number
}
