<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElButton, ElButtonGroup, ElOption, ElPopconfirm, ElSelect } from 'element-plus'
import { readDragPayload, writeDragPayload } from '../../domain/drag'
import type { PoiSearchResult } from '../../domain/types'
import { usePlansStore } from '../../stores/plans'
import { useWeatherStore } from '../../stores/weather'
import { planDayDateKey } from '../../weather/types'
import WeatherBadge from '../weather/WeatherBadge.vue'
import { mapRuntimeState, planMapProvider } from '../../map/provider'
import { usePlannerStore } from '../../stores/planner'
import ExpenseEditorPopover from '../budget/ExpenseEditorPopover.vue'
import CategoryIcon from '../ui/CategoryIcon.vue'
import PlacePriorityPicker from './PlacePriorityPicker.vue'

const emit = defineEmits<{
  batch: []
  aiImport: []
}>()

const store = usePlannerStore()
const plans = usePlansStore()
const weather = useWeatherStore()
const query = ref('')
const results = ref<PoiSearchResult[]>([])
const loading = ref(false)
const poolViewStorageKey = 'interactiveTravel.pool.view'
const poolSortStorageKey = 'interactiveTravel.pool.sort'
type PoolSortMode = 'custom' | 'recent' | 'oldest'
type CandidateDropPosition = 'before' | 'after'
const viewMode = ref<'card' | 'list'>(localStorage.getItem(poolViewStorageKey) === 'list' ? 'list' : 'card')
const savedSortMode = localStorage.getItem(poolSortStorageKey)
const sortMode = ref<PoolSortMode>(savedSortMode === 'recent' || savedSortMode === 'oldest' ? savedSortMode : 'custom')
const draggingPlaceId = ref<string | null>(null)
const dropTargetId = ref<string | null>(null)
const dropPosition = ref<CandidateDropPosition>('before')
const poolRef = ref<HTMLElement | null>(null)
const poolHeightStorageKey = 'interactiveTravel.pool.height'
const defaultPoolHeight = 330
const minimumPoolHeight = 170
const maximumPoolHeight = 640
const minimumItineraryHeight = 170
const storedPoolHeightValue = localStorage.getItem(poolHeightStorageKey)
const storedPoolHeight = Number(storedPoolHeightValue)
const hasCustomPoolHeight = ref(storedPoolHeightValue !== null && Number.isFinite(storedPoolHeight))
const poolHeight = ref(hasCustomPoolHeight.value ? Math.min(maximumPoolHeight, Math.max(minimumPoolHeight, storedPoolHeight)) : defaultPoolHeight)
const resizingPool = ref(false)
let resizeStartY = 0
let resizeStartHeight = 0
let resizeMaximumHeight = maximumPoolHeight
let previousBodyUserSelect = ''
let previousBodyCursor = ''
let timer = 0
let searchToken = 0

const allCandidates = computed(() => store.candidatePlaces())
const candidateWeatherDate = computed(() => {
  const startAt = plans.activePlan?.metadata.startAt
  return startAt ? planDayDateKey(startAt, store.days, store.selectedDayId) : ''
})
let candidateWeatherToken = 0
watch(() => [candidateWeatherDate.value, weather.selectedProviderId, weather.selectedProviderConfigured, ...allCandidates.value.map((place) => `${place.id}:${place.lng}:${place.lat}`)].join('|'), async () => {
  const token = ++candidateWeatherToken
  const date = candidateWeatherDate.value
  if (!date || weather.selectedProviderId === 'none') return
  const queue = [...allCandidates.value]
  const worker = async () => {
    while (queue.length && token === candidateWeatherToken) {
      const place = queue.shift()!
      await weather.ensureWeather(place, date)
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker))
}, { immediate: true })

const candidates = computed(() => {
  const values = store.candidatePlaces(query.value)
  if (sortMode.value === 'custom') return values
  const direction = sortMode.value === 'recent' ? -1 : 1
  return [...values].sort((left, right) => {
    const difference = (store.placeAddedAt[left.id] ?? 0) - (store.placeAddedAt[right.id] ?? 0)
    if (difference !== 0) return difference * direction
    return store.known.indexOf(left.id) - store.known.indexOf(right.id)
  })
})

watch(viewMode, (value) => localStorage.setItem(poolViewStorageKey, value))
watch(sortMode, (value) => {
  localStorage.setItem(poolSortStorageKey, value)
  dropTargetId.value = null
})
watch(() => store.poolOpen, (open) => {
  if (open) nextTick(constrainPoolHeight)
})

function availableMaximumPoolHeight(): number {
  const itinerary = poolRef.value?.parentElement?.querySelector<HTMLElement>('.itinerary')
  if (!itinerary) return maximumPoolHeight
  const currentHeight = poolRef.value?.getBoundingClientRect().height ?? poolHeight.value
  return Math.max(minimumPoolHeight, Math.min(maximumPoolHeight, currentHeight + itinerary.clientHeight - minimumItineraryHeight))
}

function setPoolHeight(value: number, maximum = availableMaximumPoolHeight()): void {
  hasCustomPoolHeight.value = true
  poolHeight.value = Math.round(Math.min(maximum, Math.max(minimumPoolHeight, value)))
}

function persistPoolHeight(): void {
  if (hasCustomPoolHeight.value) localStorage.setItem(poolHeightStorageKey, String(poolHeight.value))
  else localStorage.removeItem(poolHeightStorageKey)
}

function resizePool(event: PointerEvent): void {
  if (!resizingPool.value) return
  setPoolHeight(resizeStartHeight + resizeStartY - event.clientY, resizeMaximumHeight)
}

function finishPoolResize(): void {
  if (!resizingPool.value) return
  resizingPool.value = false
  document.body.style.userSelect = previousBodyUserSelect
  document.body.style.cursor = previousBodyCursor
  window.removeEventListener('pointermove', resizePool)
  window.removeEventListener('pointerup', finishPoolResize)
  window.removeEventListener('pointercancel', finishPoolResize)
  persistPoolHeight()
}

function startPoolResize(event: PointerEvent): void {
  if (event.button !== 0 || !store.poolOpen) return
  resizeStartY = event.clientY
  resizeStartHeight = poolRef.value?.getBoundingClientRect().height ?? poolHeight.value
  resizeMaximumHeight = availableMaximumPoolHeight()
  resizingPool.value = true
  previousBodyUserSelect = document.body.style.userSelect
  previousBodyCursor = document.body.style.cursor
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'ns-resize'
  window.addEventListener('pointermove', resizePool)
  window.addEventListener('pointerup', finishPoolResize)
  window.addEventListener('pointercancel', finishPoolResize)
}

function resetPoolHeight(): void {
  hasCustomPoolHeight.value = false
  localStorage.removeItem(poolHeightStorageKey)
  nextTick(() => { poolHeight.value = Math.round(poolRef.value?.getBoundingClientRect().height ?? defaultPoolHeight) })
}

function resizePoolByKeyboard(event: KeyboardEvent): void {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  event.preventDefault()
  const step = event.shiftKey ? 48 : 24
  setPoolHeight(poolHeight.value + (event.key === 'ArrowUp' ? step : -step))
  persistPoolHeight()
}

function constrainPoolHeight(): void {
  if (!store.poolOpen) return
  if (!hasCustomPoolHeight.value) {
    poolHeight.value = Math.round(poolRef.value?.getBoundingClientRect().height ?? defaultPoolHeight)
    return
  }
  setPoolHeight(poolHeight.value)
  persistPoolHeight()
}

function onInput(): void {
  window.clearTimeout(timer)
  searchToken += 1
  results.value = []
  const keyword = query.value.trim()
  loading.value = keyword.length >= 2
  if (keyword.length >= 2) timer = window.setTimeout(() => search(keyword), 450)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter') return
  event.preventDefault()
  window.clearTimeout(timer)
  if (query.value.trim().length >= 2) search(query.value.trim())
}

async function search(keyword: string): Promise<void> {
  const token = ++searchToken
  loading.value = true
  results.value = []
  try {
    const value = await planMapProvider.searchPlaces(keyword)
    if (token !== searchToken) return
    results.value = value
  } catch (error) {
    if (token !== searchToken) return
    results.value = []
    store.notify(error instanceof Error ? error.message : `${mapRuntimeState.providerDefinition.shortName} POI 搜索失败`)
  } finally {
    if (token === searchToken) loading.value = false
  }
}

function focusPlaceOnMap(placeId: string): void {
  const place = store.places[placeId]
  if (!place) return
  store.selectPlace(place.id)
  planMapProvider.focusPlace(place)
}

function addResult(place: PoiSearchResult): void {
  store.addCustomPlace(place)
  query.value = ''
  results.value = []
}

function startDrag(event: DragEvent, placeId: string): void {
  draggingPlaceId.value = placeId
  writeDragPayload(event, { type: 'pool', placeId })
}

function finishDrag(): void {
  draggingPlaceId.value = null
  dropTargetId.value = null
}

function onCandidateDragOver(event: DragEvent, targetPlaceId: string): void {
  if (sortMode.value !== 'custom' || !draggingPlaceId.value || draggingPlaceId.value === targetPlaceId) return
  event.preventDefault()
  event.stopPropagation()
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  dropPosition.value = viewMode.value === 'card'
    ? event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after'
    : event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
  dropTargetId.value = targetPlaceId
}

function onCandidateDrop(event: DragEvent, targetPlaceId: string): void {
  event.preventDefault()
  event.stopPropagation()
  const payload = readDragPayload(event)
  if (payload?.type === 'stop') {
    store.removeStop(payload.uid)
  } else if (payload?.type === 'pool' && sortMode.value === 'custom') {
    store.moveCandidatePlace(payload.placeId, targetPlaceId, dropPosition.value)
  }
  finishDrag()
}

function dropToPool(event: DragEvent): void {
  event.preventDefault()
  const payload = readDragPayload(event)
  if (payload?.type === 'stop') store.removeStop(payload.uid)
  finishDrag()
}

onMounted(() => {
  const value = new URLSearchParams(location.search).get('poi')
  if (value) { query.value = value; search(value) }
  nextTick(constrainPoolHeight)
  window.addEventListener('resize', constrainPoolHeight)
})

onBeforeUnmount(() => {
  window.clearTimeout(timer)
  finishPoolResize()
  window.removeEventListener('resize', constrainPoolHeight)
})
</script>

<template>
  <section
    ref="poolRef"
    class="pool"
    :class="{ closed: !store.poolOpen, resizing: resizingPool, 'custom-height': hasCustomPoolHeight && candidates.length > 0, 'no-local-matches': candidates.length === 0 }"
    :style="store.poolOpen && hasCustomPoolHeight && candidates.length > 0 ? { height: `${poolHeight}px` } : undefined"
    @dragover.prevent
    @drop="dropToPool"
  >
    <div
      v-if="store.poolOpen && candidates.length"
      class="pool-resize-handle"
      role="separator"
      aria-label="调整未安排地点面板高度"
      aria-orientation="horizontal"
      :aria-valuenow="poolHeight"
      :aria-valuemin="minimumPoolHeight"
      :aria-valuemax="Math.round(availableMaximumPoolHeight())"
      tabindex="0"
      title="上下拖动调整面板高度，双击恢复默认"
      @pointerdown.stop.prevent="startPoolResize"
      @dblclick.stop.prevent="resetPoolHeight"
      @keydown="resizePoolByKeyboard"
    ><span /></div>
    <div class="poolhead" @click="store.poolOpen = !store.poolOpen">
      <strong>未安排地点</strong>
      <span class="poolcount">{{ candidates.length }} 个本地匹配 · 输入 2 字自动查{{ mapRuntimeState.providerDefinition.shortName }}</span>
      <ElPopconfirm
        v-if="allCandidates.length"
        :title="`清空全部 ${allCandidates.length} 个未安排地点？已安排地点不会受到影响。`"
        width="280"
        confirm-button-text="确认清空"
        cancel-button-text="取消"
        confirm-button-type="danger"
        @confirm="store.clearCandidatePlaces()"
      >
        <template #reference>
          <ElButton text circle size="small" type="danger" class="pool-clear-button" title="一键清空未安排地点" @click.stop><i class="pi pi-trash" /></ElButton>
        </template>
      </ElPopconfirm>
      <ElButtonGroup v-if="candidates.length" class="pool-view-switch" @click.stop>
        <ElButton
          size="small"
          :type="viewMode === 'card' ? 'primary' : 'default'"
          :plain="viewMode !== 'card'"
          title="卡片视图"
          aria-label="卡片视图"
          @click="viewMode = 'card'"
        ><i class="pi pi-th-large" /></ElButton>
        <ElButton
          size="small"
          :type="viewMode === 'list' ? 'primary' : 'default'"
          :plain="viewMode !== 'list'"
          title="列表视图"
          aria-label="列表视图"
          @click="viewMode = 'list'"
        ><i class="pi pi-list" /></ElButton>
      </ElButtonGroup>
      <button class="chev">{{ store.poolOpen ? '⌄' : '⌃' }}</button>
    </div>

    <div class="pooltools">
      <label class="search">
        <i class="pi pi-search" />
        <input
          v-model="query"
          :placeholder="`搜索已有地点或${mapRuntimeState.providerDefinition.shortName} POI`"
          autocomplete="off"
          @input="onInput"
          @keydown="onKeydown"
        >
      </label>
      <ElButton text size="small" class="ai-import-entry" @click="emit('aiImport')"><i class="pi pi-sparkles" />AI 识别</ElButton>
      <ElButton text size="small" class="batchbtn" @click="emit('batch')"><i class="pi pi-copy" />批量粘贴</ElButton>
    </div>

    <div v-if="candidates.length" class="pool-guidance">
      <i class="pi pi-arrows-alt" />
      <span v-if="sortMode === 'custom'">拖动可调整顺序或放入行程，点击 <b>＋</b> 加入当前 Day</span>
      <span v-else>当前按添加时间排序；拖动可放入行程，切换自定义排序后可调整顺序</span>
      <ElSelect v-model="sortMode" size="small" class="pool-sort-select" aria-label="未安排地点排序" @click.stop>
        <template #prefix><i class="pi pi-sort-alt" /></template>
        <ElOption label="自定义排序" value="custom" />
        <ElOption label="最近添加优先" value="recent" />
        <ElOption label="最早添加优先" value="oldest" />
      </ElSelect>
    </div>

    <div v-if="query.trim().length >= 2" class="poi-popover">
      <div v-if="loading" class="poi-message">
        <span class="poi-spinner" />正在{{ mapRuntimeState.providerDefinition.shortName }}搜索“{{ query.trim() }}”…
      </div>
      <template v-else-if="results.length">
        <div class="poi-title">
          <b>{{ mapRuntimeState.providerDefinition.name }}地点搜索</b>
          <span>{{ results.length }} 个结果 · 点击加入地点池</span>
        </div>
        <button v-for="place in results" :key="place.id" class="poi-result" @click="addResult(place)">
          <CategoryIcon :category="place.category" />
          <span class="poi-result-main">
            <b>{{ place.name }}</b>
            <small>{{ place.address || place.type }}</small>
          </span>
          <span class="poi-result-add">加入</span>
        </button>
      </template>
      <div v-else class="poi-message">暂未找到结果，可以换一个更完整的名称</div>
    </div>

    <div v-if="candidates.length" class="poollist" :class="`${viewMode}-view`">
      <div
        v-for="place in candidates"
        :key="place.id"
        class="poolcard"
        :class="{
          selected: store.selectedPlaceId === place.id,
          sortable: sortMode === 'custom',
          dragging: draggingPlaceId === place.id,
          'pool-drop-before': dropTargetId === place.id && dropPosition === 'before',
          'pool-drop-after': dropTargetId === place.id && dropPosition === 'after',
        }"
        :data-place="place.id"
        draggable="true"
        @dragstart="startDrag($event, place.id)"
        @dragend="finishDrag"
        @dragover="onCandidateDragOver($event, place.id)"
        @dragleave="dropTargetId === place.id && (dropTargetId = null)"
        @drop="onCandidateDrop($event, place.id)"
        @click="store.selectPlace(place.id)"
      >
        <div class="poolcard-actions" @click.stop @mousedown.stop>
          <ElButton text circle size="small" class="addmini" title="加入当前日期" @click="store.addPlace(place.id)"><i class="pi pi-plus" /></ElButton>
          <ElPopconfirm
            :title="`从未安排地点中删除“${place.name}”？`"
            width="230"
            confirm-button-text="删除"
            cancel-button-text="取消"
            confirm-button-type="danger"
            @confirm="store.deleteCandidatePlace(place.id)"
          >
            <template #reference>
              <ElButton text circle size="small" type="danger" class="deletemini" title="删除未安排地点"><i class="pi pi-trash" /></ElButton>
            </template>
          </ElPopconfirm>
        </div>
        <div class="pname">
          <button type="button" class="place-map-focus-button" :title="`在地图上定位 ${place.name}`" :aria-label="`在地图上定位 ${place.name}`" @pointerdown.stop @click.stop="focusPlaceOnMap(place.id)"><CategoryIcon :category="place.category" /></button>
          <span>{{ place.name }}</span>
        </div>
        <div class="psub"><span class="pool-place-type">{{ place.type }}</span><WeatherBadge v-if="candidateWeatherDate && weather.weatherFor(place.id, candidateWeatherDate)" :weather="weather.weatherFor(place.id, candidateWeatherDate)!" /><span v-else-if="weather.selectedProviderId !== 'none'" class="pool-weather-loading">查天气…</span><span>·</span><PlacePriorityPicker :model-value="place.priority" @change="store.setPlacePriority(place.id, $event)" /><ExpenseEditorPopover owner-type="place" :owner-id="place.id" :title="`${place.name}费用`" :default-category="place.category === 'lodging' ? 'lodging' : place.category === 'food' ? 'meal' : 'ticket'" /></div>
      </div>
    </div>
  </section>
</template>
