import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Check, ChevronDown, Loader2, ExternalLink, AlertTriangle, Settings } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { searchIssues, getIssue, getTransitions, transitionIssue, getStoredIssues, refreshTaskCacheIfStale, isTaskCacheStale, type JiraTransition } from '../lib/jira'
import { cn } from '@/lib/utils'
import {
  formatDomainDisplayLabel,
  formatIssueRefLabel,
  formatLinkedIssueTitle,
  issueRefEquals,
  issueRefKey,
  parseLinkedIssueFromText,
  stripLinkedIssuePrefix,
  type LinkedIssueLinkMode,
} from '@/lib/jiraLink'
import type { JiraIssueRef, SyncedIssueRecord } from '@/types/jira'
import { getStoredJiraConfig } from '@/lib/jiraConfig'

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);
  return debouncedValue;
}

function setTextControlValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) {
    setter.call(input, value)
  } else {
    input.value = value
  }
}

function getEditorValue(editor: HTMLElement | HTMLInputElement | HTMLTextAreaElement): string {
  if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
    return editor.value || ''
  }
  return editor.textContent || ''
}

function setContentEditableCaret(el: HTMLElement, position: number) {
  const selection = window.getSelection()
  if (!selection) return

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let remaining = position
  let targetNode: Node | null = null
  let targetOffset = 0

  while (walker.nextNode()) {
    const current = walker.currentNode
    const textLength = current.textContent?.length || 0
    if (remaining <= textLength) {
      targetNode = current
      targetOffset = remaining
      break
    }
    remaining -= textLength
  }

  if (!targetNode) {
    targetNode = el.lastChild
    targetOffset = targetNode?.textContent?.length || 0
  }

  if (!targetNode) return

  const range = document.createRange()
  range.setStart(targetNode, Math.min(targetOffset, targetNode.textContent?.length || 0))
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

function focusEditorAt(editor: HTMLElement | HTMLInputElement | HTMLTextAreaElement, position: number) {
  editor.focus()
  if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
    const safePos = Math.max(0, Math.min(position, editor.value.length))
    editor.setSelectionRange(safePos, safePos)
    return
  }
  setContentEditableCaret(editor, position)
}

function isEditorFocused(editor: HTMLElement | HTMLInputElement | HTMLTextAreaElement): boolean {
  if (document.activeElement === editor) return true
  if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) return false

  const selection = window.getSelection()
  const anchor = selection?.anchorNode
  return !!anchor && editor.contains(anchor)
}

function waitForFocusTick(): Promise<void> {
  return new Promise(resolve => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }

    requestAnimationFrame(finish)
    setTimeout(finish, 50)
  })
}

async function focusDescriptionEditorWithRetry(
  editor: HTMLElement | HTMLInputElement | HTMLTextAreaElement,
  position: number,
  getLatestEditor: () => HTMLElement | HTMLInputElement | HTMLTextAreaElement | null,
): Promise<boolean> {
  let currentEditor = editor

  for (let attempt = 0; attempt < 5; attempt++) {
    if (!currentEditor.isConnected) {
      const latest = getLatestEditor()
      if (!latest) return false
      currentEditor = latest
    }

    focusEditorAt(currentEditor, position)
    if (isEditorFocused(currentEditor)) return true

    await waitForFocusTick()

    const latest = getLatestEditor()
    if (latest) {
      currentEditor = latest
    }

    if (isEditorFocused(currentEditor)) return true
  }

  return false
}

async function lockDescriptionFocus(
  editor: HTMLElement | HTMLInputElement | HTMLTextAreaElement,
  position: number,
  getLatestEditor: () => HTMLElement | HTMLInputElement | HTMLTextAreaElement | null,
): Promise<boolean> {
  const focused = await focusDescriptionEditorWithRetry(editor, position, getLatestEditor)
  if (!focused) return false

  // Google Calendar can steal focus back to title after async internal updates.
  // Re-assert focus for a short period so caret stays in description.
  const delays = [60, 140, 260, 420, 700]
  for (const delay of delays) {
    await wait(delay)
    const latest = getLatestEditor()
    if (!latest || !latest.isConnected) continue
    if (isEditorFocused(latest)) continue
    focusEditorAt(latest, position)
  }

  const latest = getLatestEditor()
  return !!latest && isEditorFocused(latest)
}

type DescriptionEditor = HTMLElement | HTMLInputElement | HTMLTextAreaElement

const DESCRIPTION_EDITOR_SELECTORS = [
  'textarea[aria-label="Description"]',
  'textarea[aria-label*="description" i]',
  'textarea[aria-label*="description or attachments" i]',
  'textarea[name*="description" i]',
  'div[contenteditable="true"][aria-label="Description"]',
  'div[contenteditable="plaintext-only"][aria-label="Description"]',
  'div[contenteditable="true"][aria-label*="description" i]',
  'div[contenteditable="plaintext-only"][aria-label*="description" i]',
  'div[role="textbox"][contenteditable="true"][aria-label*="description" i]',
  'div[role="textbox"][aria-label*="description" i]',
  'div[role="textbox"][aria-label*="description or attachments" i]',
  'div[contenteditable="true"][data-placeholder*="description" i]',
  'div[contenteditable="plaintext-only"][data-placeholder*="description" i]',
]

function isElementVisible(el: Element): boolean {
  const style = window.getComputedStyle(el as HTMLElement)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

function isEditableElement(el: HTMLElement): boolean {
  return el.isContentEditable || el.getAttribute('role') === 'textbox'
}

function isEditorUsable(editor: DescriptionEditor): boolean {
  if (!editor.isConnected || !isElementVisible(editor) || editor.getClientRects().length === 0) return false
  if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
    return !editor.disabled && !editor.readOnly
  }
  return isEditableElement(editor)
}

function toUsableEditor(candidate: Element | null): DescriptionEditor | null {
  if (!candidate) return null

  if (candidate instanceof HTMLInputElement || candidate instanceof HTMLTextAreaElement) {
    return isEditorUsable(candidate) ? candidate : null
  }

  if (!(candidate instanceof HTMLElement)) return null

  if (isEditableElement(candidate) && isEditorUsable(candidate)) {
    return candidate
  }

  const innerEditable = candidate.querySelector('[contenteditable="true"], [contenteditable="plaintext-only"]')
  if (innerEditable instanceof HTMLElement && isEditorUsable(innerEditable)) {
    return innerEditable
  }

  return null
}

function getDescriptionEditor(roots: ParentNode[]): DescriptionEditor | null {
  for (const root of roots) {
    for (const selector of DESCRIPTION_EDITOR_SELECTORS) {
      const found = root.querySelector(selector)
      const editor = toUsableEditor(found)
      if (editor) return editor
    }
  }

  return null
}

function shouldClickAddDescription(candidate: Element): boolean {
  const label = (candidate.getAttribute('aria-label') || '').toLowerCase()
  const text = (candidate.textContent || '').trim().toLowerCase()
  const content = `${label} ${text}`
  return content.includes('add description') || content.includes('description or attachments')
}

function clickAddDescriptionInRoot(root: ParentNode): boolean {
  const candidates = root.querySelectorAll('button, div[role="button"], span[role="button"]')
  for (const candidate of candidates) {
    if (shouldClickAddDescription(candidate) && candidate instanceof HTMLElement) {
      candidate.click()
      return true
    }
  }

  return false
}

function clickAddDescription(roots: ParentNode[]): boolean {
  for (const root of roots) {
    if (clickAddDescriptionInRoot(root)) return true
  }
  return false
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

interface SuggestionAnchorRect {
  left: number
  top: number
  side: 'left' | 'right'
  panelWidth: number
}

const HIDDEN_SUGGESTION_ANCHOR_STYLE: CSSProperties = {
  position: 'fixed',
  left: -9999,
  top: -9999,
  width: 1,
  height: 1,
  pointerEvents: 'none',
}

function sameSuggestionAnchorRect(
  current: SuggestionAnchorRect | null,
  next: SuggestionAnchorRect,
): boolean {
  if (!current) return false
  return (
    current.left === next.left &&
    current.top === next.top &&
    current.side === next.side &&
    current.panelWidth === next.panelWidth
  )
}

function nearSuggestionAnchorRect(
  current: SuggestionAnchorRect | null,
  next: SuggestionAnchorRect,
): boolean {
  if (!current) return false
  return (
    current.side === next.side &&
    Math.abs(current.left - next.left) <= SUGGESTION_POSITION_SNAP_PX &&
    Math.abs(current.top - next.top) <= SUGGESTION_POSITION_SNAP_PX &&
    Math.abs(current.panelWidth - next.panelWidth) <= SUGGESTION_WIDTH_SNAP_PX
  )
}

const SUGGESTION_PANEL_WIDTH = 400
const SUGGESTION_PANEL_MIN_WIDTH = 260
const SUGGESTION_PANEL_SIDE_OFFSET = 0
const SUGGESTION_PANEL_VIEWPORT_MARGIN = 12
const SUGGESTION_SIDE_SWITCH_HYSTERESIS_PX = 80
const SUGGESTION_POSITION_SNAP_PX = 2
const SUGGESTION_WIDTH_SNAP_PX = 8
const SUGGESTION_PANEL_MAX_ANCHOR_WIDTH = 980
const SUGGESTION_PANEL_MIN_ANCHOR_HEIGHT = 180
const SUGGESTION_ANCHOR_SETTLE_MS = 120
const SUGGESTION_ANCHOR_MAX_WAIT_MS = 300

function stabilizeSuggestionAnchorRect(
  previous: SuggestionAnchorRect | null,
  next: SuggestionAnchorRect,
): SuggestionAnchorRect {
  if (!previous) return next

  const left = Math.abs(next.left - previous.left) <= SUGGESTION_POSITION_SNAP_PX
    ? previous.left
    : next.left
  const top = Math.abs(next.top - previous.top) <= SUGGESTION_POSITION_SNAP_PX
    ? previous.top
    : next.top
  const panelWidth = Math.abs(next.panelWidth - previous.panelWidth) <= SUGGESTION_WIDTH_SNAP_PX
    ? previous.panelWidth
    : next.panelWidth

  return {
    ...next,
    left,
    top,
    panelWidth,
  }
}

function isFullEditLayout(): boolean {
  return window.location.pathname.includes('/eventedit') || document.body.getAttribute('data-viewfamily') === 'EVENT_EDIT'
}

function resolveSuggestionPanelRect(
  anchorElement: HTMLElement | null,
  container?: HTMLElement,
): DOMRect | null {
  const maxUsableWidth = Math.min(
    Math.round(window.innerWidth * 0.9),
    Math.max(SUGGESTION_PANEL_MAX_ANCHOR_WIDTH, 1280),
  )

  const resolveFromElement = (element: HTMLElement): DOMRect | null => {
    if (!element.isConnected || !isElementVisible(element)) return null

    const anchorRect = element.getBoundingClientRect()
    const minWidthFromAnchor = Math.max(Math.round(anchorRect.width * 0.45), 280)

    let node: HTMLElement | null = element.parentElement
    while (node && node !== document.body && node !== document.documentElement) {
      if (node.isConnected && isElementVisible(node)) {
        const rect = node.getBoundingClientRect()
        const isUsableWidth = rect.width >= minWidthFromAnchor && rect.width <= maxUsableWidth
        const isUsableHeight = rect.height >= SUGGESTION_PANEL_MIN_ANCHOR_HEIGHT
        if (isUsableWidth && isUsableHeight) {
          return rect
        }
      }

      if (container && node === container) break
      node = node.parentElement
    }

    if (isFullEditLayout() && anchorRect.width > 0) {
      const fallbackWidth = Math.min(
        maxUsableWidth,
        Math.max(Math.round(anchorRect.width + 120), SUGGESTION_PANEL_MIN_WIDTH),
      )
      return new DOMRect(
        Math.round(anchorRect.left),
        Math.round(anchorRect.top),
        Math.round(fallbackWidth),
        SUGGESTION_PANEL_MIN_ANCHOR_HEIGHT,
      )
    }

    return null
  }

  if (anchorElement) {
    const resolved = resolveFromElement(anchorElement)
    if (resolved) return resolved
  }

  if (container && container.isConnected && isElementVisible(container)) {
    const rect = container.getBoundingClientRect()
    if (rect.width > 0 && rect.width <= maxUsableWidth && rect.height >= SUGGESTION_PANEL_MIN_ANCHOR_HEIGHT) {
      return rect
    }
  }

  return null
}

async function resolveDescriptionEditor(roots: ParentNode[]): Promise<{ editor: DescriptionEditor | null, openControlFound: boolean }> {
  const existing = getDescriptionEditor(roots)
  if (existing) {
    return { editor: existing, openControlFound: false }
  }

  const openControlFound = clickAddDescription(roots)
  if (!openControlFound) {
    return { editor: null, openControlFound: false }
  }

  const waits = [120, 200, 280, 350]
  for (const delay of waits) {
    await wait(delay)
    const editor = getDescriptionEditor(roots)
    if (editor) {
      return { editor, openControlFound: true }
    }
  }

  return { editor: null, openControlFound: true }
}

// Status priority map for sorting
const STATUS_PRIORITY: Record<string, number> = {
  'In Progress': 1,
  'To Do': 2,
  'Done': 3
}

function getStatusPriority(statusName?: string): number {
  if (!statusName) return 99
  return STATUS_PRIORITY[statusName] || 99
}

function getStatusDotClass(statusName?: string): string {
  if (statusName === 'Done') {
    return 'bg-emerald-500'
  }
  if (statusName === 'In Progress') {
    return 'bg-sky-500'
  }
  if (statusName === 'To Do') {
    return 'bg-amber-500'
  }
  return 'bg-muted-foreground'
}

const LINKED_ISSUE_PATTERN = /\[?([A-Z][A-Z0-9]+-\d+)\]?/

function normalizeLinkedText(value: string): string {
  return value.replace(/[\u200B-\u200D\uFEFF]/g, '').trim()
}

function findTitleElement(root: ParentNode, requireKey = false): HTMLElement | undefined {
  const selectors = ['[role="heading"]', '.JAPzS', '.gUD7Lf']
  for (const selector of selectors) {
    const candidates = root.querySelectorAll(selector)
    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLElement)) continue
      if (!isElementVisible(candidate)) continue

      const text = normalizeLinkedText(candidate.textContent || '')
      if (!text) continue
      const hasKey = !!extractIssueKeyLoose(text)

      if (!requireKey || hasKey) {
        return candidate
      }
    }
  }
  return undefined
}

function findVisibleTitleInput(root: ParentNode): HTMLInputElement | null {
  const selectors = [
    'input[aria-label="Add title"]',
    'input[aria-label="Title"]',
    '#xTiIn',
    'input[type="text"][aria-label*="title" i]',
  ]

  for (const selector of selectors) {
    const candidates = root.querySelectorAll(selector)
    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLInputElement)) continue
      if (!isElementVisible(candidate)) continue
      if (candidate.disabled || candidate.readOnly) continue
      return candidate
    }
  }

  return null
}

function extractIssueKeyLoose(value: string): string | null {
  const match = normalizeLinkedText(value).match(LINKED_ISSUE_PATTERN)
  return match ? match[1] : null
}

function getJiraOriginFromIssueSelf(issueSelf?: string): string | null {
  if (!issueSelf) return null
  try {
    return new URL(issueSelf).origin
  } catch {
    return null
  }
}

type KeySource = 'title-input' | 'heading' | 'data-text' | 'none'

interface LinkedRefResolution {
  ref: JiraIssueRef | null
  reason: 'ambiguous-key' | 'domain-not-configured' | null
  linkMode: LinkedIssueLinkMode | null
  source: KeySource
  hasAnyText: boolean
  issueKey?: string
  requestedDomain?: string
}

function findTitleDataText(root: ParentNode): string {
  const nodes = root.querySelectorAll('[data-text]')
  let fallback = ''

  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue
    if (!isElementVisible(node)) continue

    const dataText = normalizeLinkedText(node.getAttribute('data-text') || '')
    if (!dataText) continue
    if (extractIssueKeyLoose(dataText)) return dataText
    if (!fallback) fallback = dataText
  }

  return fallback
}

export default function ContentApp({
  titleInput: initialInput,
  titleElement,
  container
}: {
  titleInput?: HTMLInputElement,
  titleElement?: HTMLElement,
  container?: HTMLElement
}) {
  const [titleInput, setTitleInput] = useState<HTMLInputElement | undefined>(initialInput)
  const [titleEl, setTitleEl] = useState<HTMLElement | undefined>(titleElement)
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, 300)
  const [open, setOpen] = useState(false)
  const [forceApi, setForceApi] = useState(false)
  const [isFocused, setIsFocused] = useState(titleInput ? titleInput === document.activeElement : false)
  const [linkedIssueRef, setLinkedIssueRef] = useState<JiraIssueRef | null>(null)
  const [linkedIssueReason, setLinkedIssueReason] = useState<'ambiguous-key' | 'domain-not-configured' | null>(null)
  const [linkedIssueLinkMode, setLinkedIssueLinkMode] = useState<LinkedIssueLinkMode | null>(null)
  const [linkedIssueRequestedDomain, setLinkedIssueRequestedDomain] = useState<string | null>(null)
  const [linkedIssueHintKey, setLinkedIssueHintKey] = useState<string | null>(null)
  const [configuredDomains, setConfiguredDomains] = useState<string[]>([])
  const [defaultJiraDomain, setDefaultJiraDomain] = useState('')
  const [isConfigReady, setIsConfigReady] = useState(false)
  const [descriptionFocusVisible, setDescriptionFocusVisible] = useState(false)
  const [isCacheRevalidating, setIsCacheRevalidating] = useState(false)
  const [cacheRevalidationFailed, setCacheRevalidationFailed] = useState(false)
  const [suggestionAnchorRect, setSuggestionAnchorRect] = useState<SuggestionAnchorRect | null>(null)
  const [isSuggestionAnchorSettled, setIsSuggestionAnchorSettled] = useState(false)
  const [fallbackFailedIssueRefKey, setFallbackFailedIssueRefKey] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const logPrefix = '[Jira Sync][ContentApp]'
  const isBubbleView = !!titleEl && !titleInput
  const isFullEditView = isFullEditLayout()
  const emptyResolutionCountRef = useRef(0)
  const issueSelectionInFlightRef = useRef(false)
  const cacheRevalidationAttemptRef = useRef<string | null>(null)
  const suggestionAnchorRectRef = useRef<SuggestionAnchorRect | null>(null)
  const suggestionAnchorCandidateRef = useRef<SuggestionAnchorRect | null>(null)
  const suggestionAnchorStableSinceRef = useRef<number>(0)
  const suggestionAnchorFirstSeenAtRef = useRef<number>(0)
  const suggestionAnchorForcedSettledRef = useRef(false)
  const hasMultipleDomains = configuredDomains.length > 1

  useEffect(() => {
    suggestionAnchorRectRef.current = suggestionAnchorRect
  }, [suggestionAnchorRect])

  const commitSuggestionAnchorRect = useCallback((next: SuggestionAnchorRect | null) => {
    if (!next) {
      suggestionAnchorCandidateRef.current = null
      suggestionAnchorStableSinceRef.current = 0
      suggestionAnchorFirstSeenAtRef.current = 0
      suggestionAnchorForcedSettledRef.current = false
      setIsSuggestionAnchorSettled(false)
      setSuggestionAnchorRect(previous => previous ? null : previous)
      return
    }

    const now = Date.now()
    if (!suggestionAnchorFirstSeenAtRef.current) {
      suggestionAnchorFirstSeenAtRef.current = now
    }

    const previousCandidate = suggestionAnchorCandidateRef.current
    if (!previousCandidate || !nearSuggestionAnchorRect(previousCandidate, next)) {
      suggestionAnchorCandidateRef.current = next
      suggestionAnchorStableSinceRef.current = now
      setIsSuggestionAnchorSettled(false)
    }

    const isStableEnough = suggestionAnchorStableSinceRef.current > 0 &&
      now - suggestionAnchorStableSinceRef.current >= SUGGESTION_ANCHOR_SETTLE_MS
    const forceAfterMaxWait = suggestionAnchorFirstSeenAtRef.current > 0 &&
      now - suggestionAnchorFirstSeenAtRef.current >= SUGGESTION_ANCHOR_MAX_WAIT_MS

    if (isStableEnough || forceAfterMaxWait) {
      setIsSuggestionAnchorSettled(true)
      suggestionAnchorForcedSettledRef.current = forceAfterMaxWait && isFullEditLayout()
    } else {
      suggestionAnchorForcedSettledRef.current = false
    }

    setSuggestionAnchorRect((previous) => {
      const stabilized = stabilizeSuggestionAnchorRect(previous, next)
      return sameSuggestionAnchorRect(previous, stabilized) ? previous : stabilized
    })
  }, [])

  const resolveLinkedIssueRef = useCallback((): LinkedRefResolution => {
    const root = container || document

    const parseCandidate = (candidate: string, source: KeySource): LinkedRefResolution | null => {
      const normalized = normalizeLinkedText(candidate)
      if (!normalized) return null

      const parsed = parseLinkedIssueFromText(normalized, configuredDomains, defaultJiraDomain)
      if (parsed.ref) {
        return {
          ref: parsed.ref,
          reason: null,
          linkMode: parsed.linkMode || null,
          source,
          hasAnyText: true,
        }
      }

      if (parsed.reason === 'ambiguous-key' || parsed.reason === 'domain-not-configured') {
        return {
          ref: null,
          reason: parsed.reason,
          linkMode: null,
          source,
          hasAnyText: true,
          issueKey: parsed.issueKey,
          requestedDomain: parsed.requestedDomain,
        }
      }

      return null
    }

    const hasUsableTitleInput = !!titleInput && titleInput.isConnected && isElementVisible(titleInput)
    const inputText = hasUsableTitleInput && titleInput ? normalizeLinkedText(titleInput.value) : ''
    const inputParsed = parseCandidate(inputText, 'title-input')
    if (inputParsed) {
      return inputParsed
    }

    const resolvedTitleEl = titleEl && titleEl.isConnected && isElementVisible(titleEl)
      ? titleEl
      : findTitleElement(root, true)
    const headingText = normalizeLinkedText(resolvedTitleEl?.textContent || '')
    const headingParsed = parseCandidate(headingText, 'heading')
    if (headingParsed) {
      return headingParsed
    }

    const dataText = findTitleDataText(root)
    const dataParsed = parseCandidate(dataText, 'data-text')
    if (dataParsed) {
      return dataParsed
    }

    return {
      ref: null,
      reason: null,
      linkMode: null,
      source: 'none',
      hasAnyText: !!(inputText || headingText || dataText),
    }
  }, [configuredDomains, container, defaultJiraDomain, titleEl, titleInput])

  // Update titleEl if prop changes
  useEffect(() => {
    setTitleEl(titleElement)
  }, [titleElement])

  // Poll for title element if we are in "Bubble view" (i.e. not editing with input)
  useEffect(() => {
    if (titleInput) return // We are in edit mode, different logic

    const findTitle = () => {
      if (titleEl && titleEl.isConnected) {
        const existingText = (titleEl.textContent || '').trim()
        if (existingText.length > 0) {
          return
        }
      }

      const root = container || document
      const newEl = findTitleElement(root)
      if (!newEl) return
      if (newEl !== titleEl) {
        setTitleEl(newEl)
      }
    }

    findTitle()
    const interval = setInterval(findTitle, 500)
    return () => clearInterval(interval)
  }, [titleEl, titleInput, container])

  // Robust Input Detection
  useEffect(() => {
    // If we have a title element (Bubble mode), we don't need to poll for input
    if (titleElement) return

    const isLikelyTitleInput = (el: Element | null): el is HTMLInputElement => {
      if (!(el instanceof HTMLInputElement)) return false
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase()
      return el.id === 'xTiIn' || ariaLabel.includes('title')
    }

    // Otherwise, try to find the active title input
    const findInput = () => {
      const root = container || document

      // Check active element first - if user is typing, this is the one we want!
      if (isLikelyTitleInput(document.activeElement)) {
        const active = document.activeElement
        if (active !== titleInput) {
          setTitleInput(active)
          return
        }
      }

      const input = findVisibleTitleInput(root)

      if (input && input !== titleInput) {
        setTitleInput(input)
      } else if (!input && titleInput && (!titleInput.isConnected || !isElementVisible(titleInput))) {
        setTitleInput(undefined)
      }
    }

    findInput()
    const interval = setInterval(findInput, 500) // Poll faster (500ms)
    // Global focus listener to catch inputs even if they are not found by selectors initially
    const handleGlobalFocus = (e: FocusEvent) => {
      const target = e.target as HTMLElement
      if (isLikelyTitleInput(target)) {
        if (target !== titleInput) {
          setTitleInput(target)
        }
      }
    }

    document.addEventListener('focus', handleGlobalFocus, true) // Capture phase

    return () => {
      clearInterval(interval)
      document.removeEventListener('focus', handleGlobalFocus, true)
    }
  }, [titleInput, titleElement, container])

  // Extract linked issue ref from input, heading, or title data attributes.
  useEffect(() => {
    const checkKey = () => {
      const resolution = resolveLinkedIssueRef()

      setLinkedIssueRef(prev => {
        const next = resolution.ref
        const hasLinkedSignal = !!next || resolution.reason !== null

        if (hasLinkedSignal) {
          emptyResolutionCountRef.current = 0
        } else {
          emptyResolutionCountRef.current += 1
        }

        if (!hasLinkedSignal && prev) {
          if (resolution.hasAnyText) {
            // Keep prior ref while Calendar is still mutating title nodes.
            return prev
          }

          // Guard against transient empty states in dynamic Calendar DOM updates.
          if (emptyResolutionCountRef.current < 8) {
            return prev
          }
        }

        return next
      })

      setLinkedIssueReason(resolution.reason)
      setLinkedIssueLinkMode(resolution.linkMode)
      setLinkedIssueHintKey(resolution.issueKey || null)
      setLinkedIssueRequestedDomain(resolution.requestedDomain || null)
    }

    checkKey()
    const poller = setInterval(checkKey, 500)
    const observeRoot = container || document.body || document.documentElement
    const observer = new MutationObserver(() => checkKey())
    observer.observe(observeRoot, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-text', 'aria-label', 'value'],
    })

    if (titleInput) {
      const handleInput = () => checkKey()
      titleInput.addEventListener('input', handleInput)
      titleInput.addEventListener('change', handleInput) // Also listen to change for programmatic updates
      titleInput.addEventListener('keyup', handleInput) // Catch keyups just in case

      return () => {
        clearInterval(poller)
        observer.disconnect()
        titleInput.removeEventListener('input', handleInput)
        titleInput.removeEventListener('change', handleInput)
        titleInput.removeEventListener('keyup', handleInput)
      }
    } else if (titleEl) {
      // Observe changes to title element text
      const titleObserver = new MutationObserver(checkKey)
      titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true })
      return () => {
        clearInterval(poller)
        observer.disconnect()
        titleObserver.disconnect()
      }
    }

    return () => {
      clearInterval(poller)
      observer.disconnect()
    }
  }, [container, logPrefix, resolveLinkedIssueRef, titleEl, titleInput])

  const isFallbackRelinkRequired = !!(
    linkedIssueRef &&
    linkedIssueLinkMode === 'default-fallback' &&
    fallbackFailedIssueRefKey === issueRefKey(linkedIssueRef)
  )

  useEffect(() => {
    if (!linkedIssueRef || linkedIssueLinkMode !== 'default-fallback') {
      if (fallbackFailedIssueRefKey) {
        setFallbackFailedIssueRefKey(null)
      }
      return
    }

    const currentIssueRefKey = issueRefKey(linkedIssueRef)
    if (fallbackFailedIssueRefKey && fallbackFailedIssueRefKey !== currentIssueRefKey) {
      setFallbackFailedIssueRefKey(null)
    }
  }, [fallbackFailedIssueRefKey, linkedIssueLinkMode, linkedIssueRef])

  const linkedRefLabel = linkedIssueRef
    ? formatIssueRefLabel(linkedIssueRef, configuredDomains.length)
    : linkedIssueHintKey

  // Fetch linked issue details (status)
  const {
    data: linkedIssue,
    refetch: refetchLinkedIssue,
    isError: linkedIssueQueryFailed,
    isSuccess: linkedIssueQuerySucceeded,
  } = useQuery({
    queryKey: ['issue', linkedIssueRef?.domain, linkedIssueRef?.issueKey],
    queryFn: () => getIssue(linkedIssueRef!),
    enabled: !!linkedIssueRef && !isFallbackRelinkRequired,
    staleTime: 1000 * 60 * 5,
  })

  const linkedIssueStatus = linkedIssue?.fields.status?.name
  const jiraBrowseUrl = useMemo(() => {
    if (!linkedIssueRef) return null

    const issueOrigin = getJiraOriginFromIssueSelf(linkedIssue?.self)
    if (issueOrigin) {
      return `${issueOrigin}/browse/${linkedIssueRef.issueKey}`
    }

    return `https://${linkedIssueRef.domain}/browse/${linkedIssueRef.issueKey}`
  }, [linkedIssue?.self, linkedIssueRef])

  const handleOpenJira = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (!jiraBrowseUrl) return
    window.open(jiraBrowseUrl, '_blank', 'noopener,noreferrer')
  }, [jiraBrowseUrl])

  useEffect(() => {
    const loadConfiguredDomains = async () => {
      try {
        const config = await getStoredJiraConfig()
        setConfiguredDomains(config.jiraDomains.map(each => each.domain))
        setDefaultJiraDomain(config.defaultJiraDomain)
      } catch (e) {
        console.warn(`${logPrefix} Failed to load Jira config`, e)
        setConfiguredDomains([])
        setDefaultJiraDomain('')
      } finally {
        setIsConfigReady(true)
      }
    }

    loadConfiguredDomains()
  }, [logPrefix])

  const updateSuggestionAnchorRect = useCallback(() => {
    const root = container || document
    const activeTitleInput = titleInput && titleInput.isConnected && isElementVisible(titleInput)
      ? titleInput
      : findVisibleTitleInput(root)
    const activeTitleElement = titleEl && titleEl.isConnected && isElementVisible(titleEl)
      ? titleEl
      : null
    const anchorElement = activeTitleInput || activeTitleElement
    const panelRect = resolveSuggestionPanelRect(anchorElement, container)
    const fullEdit = isFullEditLayout()

    if (activeTitleInput && activeTitleInput !== titleInput) {
      setTitleInput(activeTitleInput)
    }

    const titleFocused = !!activeTitleInput && document.activeElement === activeTitleInput
    if (titleFocused !== isFocused) {
      setIsFocused(titleFocused)
    }

    if (panelRect) {
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const spaceRight = Math.max(0, viewportWidth - panelRect.right - SUGGESTION_PANEL_VIEWPORT_MARGIN)
      const spaceLeft = Math.max(0, panelRect.left - SUGGESTION_PANEL_VIEWPORT_MARGIN)
      const previous = suggestionAnchorRectRef.current
      const preferredSide: 'left' | 'right' = spaceRight >= spaceLeft ? 'right' : 'left'
      const side = previous && previous.side !== preferredSide && Math.abs(spaceRight - spaceLeft) < SUGGESTION_SIDE_SWITCH_HYSTERESIS_PX
        ? previous.side
        : preferredSide
      const availableWidth = side === 'right' ? spaceRight : spaceLeft
      const panelWidth = Math.max(
        SUGGESTION_PANEL_MIN_WIDTH,
        Math.min(
          SUGGESTION_PANEL_WIDTH,
          Math.floor(availableWidth - SUGGESTION_PANEL_SIDE_OFFSET),
        ),
      )
      const anchorRect = anchorElement?.getBoundingClientRect()
      const preferredTop = anchorRect
        ? (fullEdit ? anchorRect.bottom + 10 : anchorRect.top)
        : panelRect.top + (fullEdit ? 44 : 16)
      const anchorTop = Math.max(
        SUGGESTION_PANEL_VIEWPORT_MARGIN,
        Math.min(
          Math.round(preferredTop),
          viewportHeight - SUGGESTION_PANEL_VIEWPORT_MARGIN,
        ),
      )
      const nextAnchorRect: SuggestionAnchorRect = {
        left: Math.round(side === 'right' ? panelRect.right : panelRect.left),
        top: anchorTop,
        side,
        panelWidth,
      }
      commitSuggestionAnchorRect(nextAnchorRect)
      return
    }

    commitSuggestionAnchorRect(null)
  }, [commitSuggestionAnchorRect, container, isFocused, titleEl, titleInput])

  useEffect(() => {
    let frameId = 0
    const scheduleAnchorUpdate = () => {
      if (frameId) return
      frameId = window.requestAnimationFrame(() => {
        frameId = 0
        updateSuggestionAnchorRect()
      })
    }

    scheduleAnchorUpdate()
    window.addEventListener('resize', scheduleAnchorUpdate)
    window.addEventListener('scroll', scheduleAnchorUpdate, true)
    const periodicUpdate = window.setInterval(() => {
      if (isFocused || open || !isSuggestionAnchorSettled) {
        scheduleAnchorUpdate()
      }
    }, 300)

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId)
      }
      window.clearInterval(periodicUpdate)
      window.removeEventListener('resize', scheduleAnchorUpdate)
      window.removeEventListener('scroll', scheduleAnchorUpdate, true)
    }
  }, [isFocused, isSuggestionAnchorSettled, open, updateSuggestionAnchorRect])

  // Fetch transitions for linked issue
  const { data: transitions, isError: transitionsQueryFailed } = useQuery({
    queryKey: ['transitions', linkedIssueRef?.domain, linkedIssueRef?.issueKey],
    queryFn: () => getTransitions(linkedIssueRef!),
    enabled: !!linkedIssueRef && !isFallbackRelinkRequired,
    staleTime: 1000 * 60 * 5,
  })

  // Transition mutation
  const transitionMutation = useMutation({
    mutationFn: async ({ issueRef, transitionId }: { issueRef: JiraIssueRef, transitionId: string }) => {
      await transitionIssue(issueRef, transitionId)
    },
    onSuccess: () => {
      refetchLinkedIssue()
      queryClient.invalidateQueries({ queryKey: ['transitions', linkedIssueRef?.domain, linkedIssueRef?.issueKey] })
    },
    onError: (error) => {
      console.warn(`${logPrefix} Failed to transition linked issue`, error)
      if (linkedIssueRef && linkedIssueLinkMode === 'default-fallback') {
        setFallbackFailedIssueRefKey(issueRefKey(linkedIssueRef))
      }
    },
  })

  useEffect(() => {
    if (!linkedIssueRef || linkedIssueLinkMode !== 'default-fallback') return

    const currentIssueRefKey = issueRefKey(linkedIssueRef)
    if (linkedIssueQueryFailed || transitionsQueryFailed || transitionMutation.isError) {
      setFallbackFailedIssueRefKey(currentIssueRefKey)
      return
    }

    if (fallbackFailedIssueRefKey === currentIssueRefKey && linkedIssueQuerySucceeded && !transitionMutation.isError) {
      setFallbackFailedIssueRefKey(null)
    }
  }, [
    fallbackFailedIssueRefKey,
    linkedIssueLinkMode,
    linkedIssueQueryFailed,
    linkedIssueQuerySucceeded,
    linkedIssueRef,
    transitionMutation.isError,
    transitionsQueryFailed,
  ])

  // Search Queries
  const { data, isLoading: loading } = useQuery({
    queryKey: ['issues', debouncedQuery, linkedIssueRef?.domain, linkedIssueRef?.issueKey, forceApi],
    queryFn: () => searchIssues(debouncedQuery, linkedIssueRef, forceApi),
    enabled: isFocused && debouncedQuery.length >= 2,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })

  const {
    data: storedIssuesData,
    refetch: refetchStoredIssues,
    isLoading: isStoredIssuesLoading,
    isFetched: isStoredIssuesFetched,
  } = useQuery({
    queryKey: ['stored-issues'],
    queryFn: getStoredIssues,
    enabled: isFocused,
    staleTime: 1000 * 60 * 1,
  })

  useEffect(() => {
    if (!isFocused) {
      cacheRevalidationAttemptRef.current = null
      setIsCacheRevalidating(false)
      return
    }
    if (!isConfigReady || isStoredIssuesLoading || !isStoredIssuesFetched || !storedIssuesData) return
    if (configuredDomains.length === 0) {
      cacheRevalidationAttemptRef.current = null
      setIsCacheRevalidating(false)
      setCacheRevalidationFailed(false)
      return
    }

    const lastSync = storedIssuesData.lastSync
    const hasNoStoredIssues = (storedIssuesData.issues || []).length === 0
    const shouldRevalidate = isTaskCacheStale(lastSync) || hasNoStoredIssues
    if (!shouldRevalidate) {
      cacheRevalidationAttemptRef.current = null
      setIsCacheRevalidating(false)
      setCacheRevalidationFailed(false)
      return
    }

    const revalidationKey = `${lastSync || 'missing-last-sync'}|${hasNoStoredIssues ? 'empty' : 'has-data'}`
    if (cacheRevalidationAttemptRef.current === revalidationKey) {
      return
    }

    cacheRevalidationAttemptRef.current = revalidationKey
    setIsCacheRevalidating(true)
    setCacheRevalidationFailed(false)

    refreshTaskCacheIfStale(lastSync, true)
      .then(async (result) => {
        if (!result) return
        await refetchStoredIssues()
        await queryClient.invalidateQueries({ queryKey: ['issues'] })
      })
      .catch((e) => {
        setCacheRevalidationFailed(true)
        console.error(`${logPrefix} Failed to refresh stale task cache`, e)
      })
      .finally(() => {
        setIsCacheRevalidating(false)
      })
  }, [
    configuredDomains.length,
    isConfigReady,
    isFocused,
    isStoredIssuesFetched,
    isStoredIssuesLoading,
    logPrefix,
    queryClient,
    refetchStoredIssues,
    storedIssuesData,
  ])

  // Process results: Sort by status and ensure linked issue is present
  const results = [...(data?.issues || [])].sort((a, b) => {
    const pA = getStatusPriority(a.issue.fields.status?.name)
    const pB = getStatusPriority(b.issue.fields.status?.name)
    if (pA !== pB) return pA - pB
    if ((a.issue.key || '') !== (b.issue.key || '')) {
      return (a.issue.key || '').localeCompare(b.issue.key || '')
    }
    return a.domain.localeCompare(b.domain)
  })

  const source = data?.source
  const isSuggestionMode = debouncedQuery.length < 2
  const cacheIsStale = isTaskCacheStale(storedIssuesData?.lastSync)
  const hasNoStoredIssues = (storedIssuesData?.issues || []).length === 0
  const cacheRevalidationKey = `${storedIssuesData?.lastSync || 'missing-last-sync'}|${hasNoStoredIssues ? 'empty' : 'has-data'}`
  const canAutoRevalidateCache = configuredDomains.length > 0
  const shouldAutoRevalidateCache = canAutoRevalidateCache && isStoredIssuesFetched && (cacheIsStale || hasNoStoredIssues)
  const isCacheRevalidationPending = shouldAutoRevalidateCache &&
    cacheRevalidationAttemptRef.current !== cacheRevalidationKey &&
    !cacheRevalidationFailed

  const suggestedIssues = useMemo(() => {
    const issues = storedIssuesData?.issues || []
    return [...issues]
      .filter(issue => {
        if (!linkedIssueRef) return true
        return !issueRefEquals(
          linkedIssueRef,
          { domain: issue.domain, issueKey: issue.issue.key || '' },
        )
      })
      .sort((a, b) => {
        const pA = getStatusPriority(a.issue.fields.status?.name)
        const pB = getStatusPriority(b.issue.fields.status?.name)
        if (pA !== pB) return pA - pB
        if ((a.issue.key || '') !== (b.issue.key || '')) {
          return (a.issue.key || '').localeCompare(b.issue.key || '')
        }
        return a.domain.localeCompare(b.domain)
      })
  }, [linkedIssueRef, storedIssuesData?.issues])

  const visibleIssues = isSuggestionMode ? suggestedIssues : results
  const suggestionCacheMessage = useMemo(() => {
    if (!isSuggestionMode || visibleIssues.length > 0 || loading) return null
    if (!isConfigReady || isStoredIssuesLoading || !isStoredIssuesFetched) {
      return {
        tone: 'loading' as const,
        message: 'Loading Jira task suggestions...',
      }
    }
    if (isCacheRevalidating || isCacheRevalidationPending) {
      return {
        tone: 'loading' as const,
        message: 'Syncing Jira tasks in background...',
      }
    }
    if (cacheRevalidationFailed) {
      return {
        tone: 'error' as const,
        message: 'Failed to revalidate task cache. Try syncing from extension popup.',
      }
    }
    return {
      tone: 'empty' as const,
      message: 'No synced Jira tasks found.',
    }
  }, [
    cacheRevalidationFailed,
    isCacheRevalidationPending,
    isCacheRevalidating,
    isConfigReady,
    isSuggestionMode,
    isStoredIssuesFetched,
    isStoredIssuesLoading,
    loading,
    visibleIssues.length,
  ])

  const suggestionAnchorStyle = useMemo<CSSProperties>(() => {
    if (!suggestionAnchorRect) return HIDDEN_SUGGESTION_ANCHOR_STYLE
    return {
      position: 'fixed',
      left: suggestionAnchorRect.left,
      top: suggestionAnchorRect.top,
      width: 1,
      height: 1,
      pointerEvents: 'none',
    }
  }, [suggestionAnchorRect])
  const isSuggestionAnchorReady = !!suggestionAnchorRect && isSuggestionAnchorSettled

  // Listen to input changes for search
  useEffect(() => {
    if (!titleInput) return

    const handleInput = (e: Event) => {
      const target = e.target as HTMLInputElement
      let val = target.value

      // Strip existing Jira Key from query if present
      // Only strip if it matches the extension's format [KEY-123]
      val = stripLinkedIssuePrefix(val)

      setQuery((prev) => {
        if (prev !== val) {
          setForceApi(false)
        }
        return val
      })
    }

    const handleFocus = () => setIsFocused(true)
    const handleBlur = () => {
      // Small delay to allow clicking on results
      setTimeout(() => setIsFocused(false), 200)
    }

    // Initial value
    if (titleInput.value) {
      let val = titleInput.value
      val = stripLinkedIssuePrefix(val)
      if (query !== val) {
        setTimeout(() => setQuery(val), 0)
      }
    }

    // Check if already focused (crucial for reload/autofocus scenarios)
    if (document.activeElement === titleInput) {
      setTimeout(() => setIsFocused(true), 0)
    }

    titleInput.addEventListener('input', handleInput)
    titleInput.addEventListener('focus', handleFocus)
    titleInput.addEventListener('blur', handleBlur)

    return () => {
      titleInput.removeEventListener('input', handleInput)
      titleInput.removeEventListener('focus', handleFocus)
      titleInput.removeEventListener('blur', handleBlur)
    }
  }, [titleInput, query])

  // Open popover when we have results or when searching
  useEffect(() => {
    let nextOpen = false
    const anchorReadyForOpen = isSuggestionAnchorReady || (open && !!suggestionAnchorRect)

    if (!isFocused) {
      nextOpen = false
    } else if (!anchorReadyForOpen) {
      nextOpen = false
    } else if (isSuggestionMode) {
      nextOpen = true
    } else if (results.length > 0) {
      nextOpen = true
    } else if (loading) {
      nextOpen = true
    } else if (source === 'local') {
      nextOpen = true
    } else if (source === 'api' && results.length === 0) {
      nextOpen = true
    }

    setOpen(prev => prev === nextOpen ? prev : nextOpen)
  }, [
    debouncedQuery.length,
    isFocused,
    open,
    isSuggestionAnchorReady,
    isSuggestionAnchorSettled,
    isSuggestionMode,
    loading,
    results.length,
    source,
    suggestionAnchorRect,
  ])

  const handleSelect = async (issue: SyncedIssueRecord) => {
    if (issueSelectionInFlightRef.current) return
    issueSelectionInFlightRef.current = true
    const issueKey = issue.issue.key
    if (!issueKey) {
      issueSelectionInFlightRef.current = false
      return
    }

    try {
      setQuery('')
      setForceApi(false)
      setOpen(false)
      setDescriptionFocusVisible(false)
      setFallbackFailedIssueRefKey(null)

      // Update Google Calendar Title
      const input = titleInput || document.querySelector('input[aria-label="Add title"], input[aria-label="Title"], input[type="text"][aria-label*="title" i]') as HTMLInputElement
      const newTitle = formatLinkedIssueTitle(
        { domain: issue.domain, issueKey },
        issue.issue.fields.summary,
      )

      if (input) {
        // Focus first to simulate user interaction
        input.focus()

        setTextControlValue(input, newTitle)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }

      const roots: ParentNode[] = []
      if (container) roots.push(container)
      roots.push(document)

      const { editor: descriptionEditor, openControlFound } = await resolveDescriptionEditor(roots)
      if (!descriptionEditor) {
        if (!openControlFound) {
          console.warn(`${logPrefix} Step failed: description open control not found`)
        }
        console.warn(`${logPrefix} Step failed: description editor not found`)
        return
      }

      const existingDescription = getEditorValue(descriptionEditor)
      const caretPosition = existingDescription.length

      const updatedEditor = getDescriptionEditor(roots)
      const focusTarget = updatedEditor && updatedEditor.isConnected ? updatedEditor : descriptionEditor
      const focused = await lockDescriptionFocus(
        focusTarget,
        caretPosition,
        () => getDescriptionEditor(roots),
      )
      if (!focused) {
        console.warn(`${logPrefix} Step failed: description focus lock failed`)
        return
      }

      setDescriptionFocusVisible(true)
      setTimeout(() => setDescriptionFocusVisible(false), 2000)
    } finally {
      issueSelectionInFlightRef.current = false
    }
  }

  return (
    <div className={cn('jira-sync-overlay font-sans text-left', isBubbleView ? 'mt-1 w-fit' : 'relative')}>
      {linkedIssueRef && !isFullEditView && !isFallbackRelinkRequired && (
        <div className={cn(isBubbleView ? 'relative inline-flex items-center gap-2' : 'absolute right-0 top-7 z-50 inline-flex items-center gap-2')}>
          <div className="inline-flex items-center gap-2">
            <span className={cn('leading-none whitespace-nowrap text-md text-black dark:text-white')}>
              Jira status:
            </span>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    'inline-flex w-fit max-w-[160px] items-center rounded-full font-medium transition-colors border hover:cursor-pointer',
                    isBubbleView ? 'h-6 gap-1 px-2.5 text-[11px]' : 'h-7 gap-1.5 px-3 text-[12px]',
                    'bg-[#f1f3f4] text-black border-[#dadce0] hover:bg-[#e8eaed]',
                    'dark:bg-[#3c4043] dark:text-white dark:border-[#5f6368] dark:hover:bg-[#5f6368]'
                  )}
                >
                  {transitionMutation.isPending ? <Loader2 className={cn('animate-spin', isBubbleView ? 'h-2.5 w-2.5' : 'h-3 w-3')} /> : null}
                  {!transitionMutation.isPending && (
                    <span className={cn(isBubbleView ? 'h-1.5 w-1.5' : 'h-2 w-2', 'rounded-full opacity-90', getStatusDotClass(linkedIssueStatus))} />
                  )}
                  <span className="truncate text-black dark:text-white">{linkedIssueStatus || 'Loading...'}</span>
                  <ChevronDown className={cn('opacity-50', isBubbleView ? 'h-2.5 w-2.5' : 'h-3 w-3')} />
                </button>
              </PopoverTrigger>
              <PopoverContent
                className={cn(
                  'w-52 p-1.5 rounded-xl border shadow-[0_6px_18px_rgba(0,0,0,0.18)]',
                  'bg-[#ffffff] text-[#3c4043] border-[#dadce0]',
                  'dark:bg-[#333537] dark:text-[#e8eaed] dark:border-[#5f6368]'
                )}
                align="end"
              >
                <div className="text-[11px] font-medium px-2.5 py-1.5 mb-1 text-[#5f6368] dark:text-[#bdc1c6]">
                  Change Status
                </div>
                {transitions?.map((t: JiraTransition) => (
                  <button
                    key={t.id}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      transitionMutation.mutate({ issueRef: linkedIssueRef, transitionId: t.id })
                    }}
                    className={cn(
                      'w-full text-left px-2.5 py-2 text-[13px] rounded-lg flex items-center justify-between transition-colors',
                      'hover:bg-[#f1f3f4] text-[#3c4043]',
                      'dark:hover:bg-[#44474a] dark:text-[#e8eaed]'
                    )}
                  >
                    <span className="truncate">{t.name}</span>
                    {linkedIssueStatus === (t as unknown as { to?: { name: string } }).to?.name && (
                      <Check className="h-3.5 w-3.5 text-[#1a73e8] dark:text-[#8ab4f8]" />
                    )}
                  </button>
                ))}
                {(!transitions || transitions.length === 0) && (
                  <div className="px-2.5 py-2 text-xs text-[#5f6368] dark:text-[#bdc1c6]">
                    No transitions available
                  </div>
                )}
              </PopoverContent>
            </Popover>
            {hasMultipleDomains && (
              <span className={cn(
                'inline-flex items-center rounded-full border font-semibold',
                isBubbleView ? 'h-6 px-2.5 text-[10px]' : 'h-7 px-3 text-[11px]',
                'border-[#d4dae6] bg-[#f7f8fb] text-[#596579] dark:border-[#4b5568] dark:bg-[#2d3440] dark:text-[#c7d2e4]'
              )}>
                {formatDomainDisplayLabel(linkedIssueRef.domain)}
              </span>
            )}
          </div>
          {jiraBrowseUrl && (
            <button
              type="button"
              onClick={handleOpenJira}
              aria-label="Open in Jira"
              title="Open in Jira"
              className={cn(
                'inline-flex items-center justify-center rounded-full border transition-colors hover:cursor-pointer',
                isBubbleView ? 'h-6 w-6' : 'h-7 w-7',
                'bg-[#f1f3f4] text-[#3c4043] border-[#dadce0] hover:bg-[#e8eaed]',
                'dark:bg-[#3c4043] dark:text-[#e8eaed] dark:border-[#5f6368] dark:hover:bg-[#5f6368]'
              )}
            >
              <ExternalLink className={cn(isBubbleView ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
            </button>
          )}
        </div>
      )}

      {isFallbackRelinkRequired && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-[#f0d5a2] bg-[#fff7e8] px-3 py-1.5 text-xs text-[#9a6511] dark:border-[#5f4a2a] dark:bg-[#352a18] dark:text-[#f2c981]">
          <AlertTriangle size={12} />
          <span>
            Legacy Jira link {linkedRefLabel ? `(${linkedRefLabel}) ` : ''}did not resolve in the default Jira instance. Re-select task.
          </span>
        </div>
      )}

      {linkedIssueReason === 'ambiguous-key' && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-[#f0d5a2] bg-[#fff7e8] px-3 py-1.5 text-xs text-[#9a6511] dark:border-[#5f4a2a] dark:bg-[#352a18] dark:text-[#f2c981]">
          <AlertTriangle size={12} />
          <span>
            Jira link {linkedRefLabel ? `(${linkedRefLabel}) ` : ''}is ambiguous across configured domains. Re-select task.
          </span>
        </div>
      )}

      {linkedIssueReason === 'domain-not-configured' && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-[#e4bbb2] bg-[#fff0ee] px-3 py-1.5 text-xs text-[#9e2f24] dark:border-[#5d3134] dark:bg-[#3a2328] dark:text-[#f0a8a1]">
          <span className="inline-flex items-center gap-2">
            <AlertTriangle size={12} />
            Linked domain {linkedIssueRequestedDomain ? `"${linkedIssueRequestedDomain}"` : ''} is no longer configured.
          </span>
          <button
            type="button"
            onClick={() => window.open(chrome.runtime.getURL('setup.html'), '_blank', 'noopener,noreferrer')}
            className="inline-flex items-center gap-1 rounded-md border border-current px-2 py-0.5 text-[10px] font-semibold"
          >
            <Settings size={11} />
            Setup
          </button>
        </div>
      )}

      {descriptionFocusVisible && (
        <div className="mb-2 text-xs text-emerald-600 font-medium">
          Description focused
        </div>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div aria-hidden="true" style={suggestionAnchorStyle} />
        </PopoverAnchor>
        <PopoverContent
          className="z-[2147483647] p-0 border-border data-[state=open]:animate-none data-[state=closed]:animate-none"
          align="start"
          side={suggestionAnchorRect?.side || 'right'}
          sideOffset={SUGGESTION_PANEL_SIDE_OFFSET}
          style={{
            width: suggestionAnchorRect?.panelWidth || SUGGESTION_PANEL_WIDTH,
          }}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="jira-sync-thin-scrollbar max-h-60 overflow-y-auto">
            {isSuggestionMode && visibleIssues.length > 0 && (
              <div className="px-3 py-2 text-[11px] font-medium text-muted-foreground border-b border-border">
                Suggested Jira tasks
              </div>
            )}

            {loading && <div className="p-2 text-xs text-muted-foreground text-center">Searching...</div>}

            {!loading && !isSuggestionMode && results.length === 0 && source === 'local' && (
              <div className="p-2 text-xs text-muted-foreground text-center">No local issues found</div>
            )}

            {!loading && !isSuggestionMode && results.length === 0 && source === 'api' && (
              <div className="p-2 text-xs text-muted-foreground text-center">No issues found in Jira</div>
            )}

            {!loading && suggestionCacheMessage && (
              <div
                className={cn(
                  'p-2 text-xs text-center',
                  suggestionCacheMessage.tone === 'error' ? 'text-[#9e2f24] dark:text-[#f0a8a1]' : 'text-muted-foreground',
                )}
              >
                {suggestionCacheMessage.tone === 'loading' && (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 size={12} className="animate-spin" />
                    <span>{suggestionCacheMessage.message}</span>
                  </span>
                )}
                {suggestionCacheMessage.tone !== 'loading' && suggestionCacheMessage.message}
              </div>
            )}

            {visibleIssues.map(issue => (
              <button
                type="button"
                key={`${issue.domain}-${issue.issue.id || issue.issue.key}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  void handleSelect(issue)
                }}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                }}
                className="w-full text-left px-4 py-2 hover:bg-accent hover:text-accent-foreground text-sm border-b border-border last:border-0 transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="font-medium text-foreground">{issue.issue.key}</div>
                    {hasMultipleDomains && (
                      <span className="rounded border border-[#d5dbe7] bg-[#f8f9fc] px-1.5 py-0.5 text-[10px] text-[#5a667a] dark:border-[#4b5568] dark:bg-[#2d3440] dark:text-[#c8d3e6]">
                        {issue.domain}
                      </span>
                    )}
                  </div>
                  {issue.issue.fields.status && (
                    <span className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded border",
                      issue.issue.fields.status.name === 'In Progress' ? "bg-blue-50 text-blue-600 border-blue-100" :
                        issue.issue.fields.status.name === 'Done' ? "bg-green-50 text-green-600 border-green-100" :
                          "bg-gray-50 text-gray-500 border-gray-100"
                    )}>
                      {issue.issue.fields.status.name}
                    </span>
                  )}
                </div>
                <div className="text-muted-foreground truncate">{issue.issue.fields.summary}</div>
              </button>
            ))}

            {/* Show "Search in Jira" ONLY if we haven't searched API yet (source is local) */}
            {!isSuggestionMode && debouncedQuery.length >= 2 && !loading && source === 'local' && results.length > 0 && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                }}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setForceApi(true)
                }}
                className="w-full text-left px-4 py-2 hover:bg-accent hover:text-accent-foreground text-sm text-primary flex items-center gap-2 transition-colors border-t border-border"
              >
                <RefreshCw size={14} />
                Search in Jira...
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
