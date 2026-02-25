import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Check, ChevronDown, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { searchIssues, getIssue, getTransitions, transitionIssue, type JiraIssue, type JiraTransition } from '../lib/jira'
import { cn } from '@/lib/utils'

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

function getStatusToneClass(statusName?: string): string {
  if (statusName === 'Done') {
    return 'text-emerald-300'
  }
  if (statusName === 'In Progress') {
    return 'text-sky-300'
  }
  if (statusName === 'To Do') {
    return 'text-amber-300'
  }
  return 'text-muted-foreground'
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
      const hasKey = !!extractLinkedIssueKey(text)

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

function extractLinkedIssueKey(value: string): string | null {
  const match = normalizeLinkedText(value).match(LINKED_ISSUE_PATTERN)
  return match ? match[1] : null
}

function stripLinkedIssuePrefix(value: string): string {
  return normalizeLinkedText(value).replace(/^\[?[A-Z][A-Z0-9]+-\d+\]?\s*/, '')
}

type KeySource = 'title-input' | 'heading' | 'data-text' | 'none'

interface LinkedKeyResolution {
  key: string | null
  source: KeySource
  hasAnyText: boolean
}

function findTitleDataText(root: ParentNode): string {
  const nodes = root.querySelectorAll('[data-text]')
  let fallback = ''

  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue
    if (!isElementVisible(node)) continue

    const dataText = normalizeLinkedText(node.getAttribute('data-text') || '')
    if (!dataText) continue
    if (extractLinkedIssueKey(dataText)) return dataText
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
  const [linkedKey, setLinkedKey] = useState<string | null>(null)
  const [descriptionFocusVisible, setDescriptionFocusVisible] = useState(false)
  const queryClient = useQueryClient()
  const logPrefix = '[Jira Sync][ContentApp]'
  const isBubbleView = !!titleEl && !titleInput
  const emptyResolutionCountRef = useRef(0)

  const resolveLinkedKey = useCallback((): LinkedKeyResolution => {
    const root = container || document
    const hasUsableTitleInput = !!titleInput && titleInput.isConnected && isElementVisible(titleInput)
    const inputText = hasUsableTitleInput && titleInput ? normalizeLinkedText(titleInput.value) : ''
    const inputKey = extractLinkedIssueKey(inputText)
    if (inputKey) {
      return { key: inputKey, source: 'title-input', hasAnyText: true }
    }

    const resolvedTitleEl = titleEl && titleEl.isConnected && isElementVisible(titleEl)
      ? titleEl
      : findTitleElement(root, true)
    const headingText = normalizeLinkedText(resolvedTitleEl?.textContent || '')
    const headingKey = extractLinkedIssueKey(headingText)
    if (headingKey) {
      return { key: headingKey, source: 'heading', hasAnyText: true }
    }

    const dataText = findTitleDataText(root)
    const dataKey = extractLinkedIssueKey(dataText)
    if (dataKey) {
      return { key: dataKey, source: 'data-text', hasAnyText: true }
    }

    return {
      key: null,
      source: 'none',
      hasAnyText: !!(inputText || headingText || dataText),
    }
  }, [container, titleEl, titleInput])

  useEffect(() => {
    console.log(`${logPrefix} Lifecycle: mounted`, {
      hasInitialTitleInput: !!initialInput,
      hasInitialTitleElement: !!titleElement,
      hasContainer: !!container,
    })
    return () => {
      console.log(`${logPrefix} Lifecycle: unmounted`)
    }
  }, [container, initialInput, titleElement])

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
        console.log(`${logPrefix} Step: resolved visible title element from DOM`)
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
          console.log(`${logPrefix} Step: detected active title input`)
          setTitleInput(active)
          return
        }
      }

      const input = findVisibleTitleInput(root)

      if (input && input !== titleInput) {
        console.log(`${logPrefix} Step: resolved visible title input from DOM`)
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
          console.log(`${logPrefix} Step: title input focus listener detected new input`)
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

  // Extract linked key from input, heading, or title data attributes.
  useEffect(() => {
    const checkKey = () => {
      const resolution = resolveLinkedKey()
      setLinkedKey(prev => {
        const next = resolution.key
        if (next) {
          emptyResolutionCountRef.current = 0
        } else {
          emptyResolutionCountRef.current += 1
        }

        if (!next && prev) {
          if (resolution.hasAnyText) {
            // Keep prior key while Calendar is still mutating title nodes.
            return prev
          }

          // Guard against transient empty states in dynamic Calendar DOM updates.
          if (emptyResolutionCountRef.current < 8) {
            return prev
          }
        }

        if (prev !== next) {
          console.log(`${logPrefix} Step: linked key changed`, {
            previous: prev,
            next,
            source: resolution.source,
            emptyResolutions: emptyResolutionCountRef.current,
          })
        }
        return next
      })
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
  }, [container, resolveLinkedKey, titleEl, titleInput])

  // Fetch linked issue details (status)
  const { data: linkedIssue, refetch: refetchLinkedIssue } = useQuery({
    queryKey: ['issue', linkedKey],
    queryFn: () => getIssue(linkedKey!),
    enabled: !!linkedKey,
    staleTime: 1000 * 60 * 5,
  })

  const linkedIssueStatus = linkedIssue?.fields.status?.name

  useEffect(() => {
    console.log(`${logPrefix} State: status visibility snapshot`, {
      linkedKey,
      linkedIssueStatus,
      isBubbleView,
      hasTitleInput: !!titleInput,
      hasTitleElement: !!titleEl,
    })
  }, [isBubbleView, linkedIssueStatus, linkedKey, titleEl, titleInput])

  useEffect(() => {
    if (!isBubbleView || !linkedIssueStatus) return
    const host = (container || document).querySelector('#calendar-jira-sync-root')
    if (!(host instanceof HTMLElement)) {
      console.log(`${logPrefix} Debug: host not found in container`)
      return
    }

    const rect = host.getBoundingClientRect()
    const style = window.getComputedStyle(host)
    console.log(`${logPrefix} Debug: host geometry`, {
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      zIndex: style.zIndex,
    })
  }, [container, isBubbleView, linkedIssueStatus, logPrefix])

  // Fetch transitions for linked issue
  const { data: transitions } = useQuery({
    queryKey: ['transitions', linkedKey],
    queryFn: () => getTransitions(linkedKey!),
    enabled: !!linkedKey,
    staleTime: 1000 * 60 * 5,
  })

  // Transition mutation
  const transitionMutation = useMutation({
    mutationFn: async ({ issueKey, transitionId }: { issueKey: string, transitionId: string }) => {
      await transitionIssue(issueKey, transitionId)
    },
    onSuccess: () => {
      refetchLinkedIssue()
      queryClient.invalidateQueries({ queryKey: ['transitions', linkedKey] })
    }
  })

  // Search Queries
  const { data, isLoading: loading } = useQuery({
    queryKey: ['issues', debouncedQuery, linkedKey, forceApi],
    queryFn: () => searchIssues(debouncedQuery, linkedKey, forceApi),
    enabled: debouncedQuery.length >= 2,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })

  // Process results: Sort by status and ensure linked issue is present
  const results = [...(data?.issues || [])].sort((a, b) => {
    const pA = getStatusPriority(a.fields.status?.name)
    const pB = getStatusPriority(b.fields.status?.name)
    return pA - pB
  })

  const source = data?.source

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
    const updateOpen = (newState: boolean) => {
      if (open !== newState) {
        setTimeout(() => setOpen(newState), 0)
      }
    }

    if (debouncedQuery.length < 2) {
      updateOpen(false)
      return
    }

    if (!isFocused) {
      updateOpen(false)
      return
    }

    // If we have results, open
    if (results.length > 0) {
      updateOpen(true)
    }
    // If we are loading, open
    else if (loading) {
      updateOpen(true)
    }
    // If we have no results but haven't searched API yet (source is local), open to show "Search in Jira"
    else if (source === 'local') {
      updateOpen(true)
    }
    // If we searched API and found nothing, close (or show "No results"?)
    else if (source === 'api' && results.length === 0) {
      updateOpen(true)
    }
  }, [debouncedQuery, results.length, loading, source, open, isFocused])

  const handleSelect = async (issue: JiraIssue) => {
    console.log(`${logPrefix} Step: user selected issue`, { key: issue.key })
    setQuery('')
    setForceApi(false)
    setOpen(false)
    setDescriptionFocusVisible(false)

    // Update Google Calendar Title
    const input = titleInput || document.querySelector('input[aria-label="Add title"], input[aria-label="Title"], input[type="text"][aria-label*="title" i]') as HTMLInputElement
    const newTitle = `[${issue.key}] ${issue.fields.summary}`

    if (input) {
      // Focus first to simulate user interaction
      input.focus()

      setTextControlValue(input, newTitle)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      console.log(`${logPrefix} Step: title updated`, { newTitle })
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

    console.log(`${logPrefix} Step: description focused`)
    setDescriptionFocusVisible(true)
    setTimeout(() => setDescriptionFocusVisible(false), 2000)
  }

  return (
    <div className={cn('jira-sync-overlay font-sans text-left', isBubbleView ? 'mt-1 w-fit' : 'relative')}>
      {linkedKey && (
        <div className={cn(isBubbleView ? 'relative inline-flex items-center gap-2' : 'absolute right-0 top-7 z-50 inline-flex items-center gap-2')}>
          <span className={cn('leading-none text-muted-foreground whitespace-nowrap text-md')}>
            Jira status:
          </span>
          <Popover>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  'inline-flex w-fit max-w-[160px] items-center rounded-full font-medium transition-colors border hover:cursor-pointer',
                  isBubbleView ? 'gap-1 px-2.5 py-1 text-[11px]' : 'gap-1.5 px-3 py-1.5 text-[12px]',
                  'bg-[#f1f3f4] text-[#3c4043] border-[#dadce0] hover:bg-[#e8eaed]',
                  'dark:bg-[#3c4043] dark:text-[#e8eaed] dark:border-[#5f6368] dark:hover:bg-[#5f6368]'
                )}
              >
                {transitionMutation.isPending ? <Loader2 className={cn('animate-spin', isBubbleView ? 'h-2.5 w-2.5' : 'h-3 w-3')} /> : null}
                {!transitionMutation.isPending && (
                  <span className={cn(isBubbleView ? 'h-1.5 w-1.5' : 'h-2 w-2', 'rounded-full bg-current opacity-90', getStatusToneClass(linkedIssueStatus))} />
                )}
                <span className={cn('truncate', getStatusToneClass(linkedIssueStatus))}>{linkedIssueStatus || 'Loading...'}</span>
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
                    transitionMutation.mutate({ issueKey: linkedKey, transitionId: t.id })
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
        </div>
      )}

      {descriptionFocusVisible && (
        <div className="mb-2 text-xs text-emerald-600 font-medium">
          Description focused
        </div>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        {/* Invisible trigger that we control programmatically via open state */}
        <PopoverTrigger asChild>
          <div className="w-full h-0" />
        </PopoverTrigger>
        <PopoverContent
          className="w-100 p-0 border-border"
          align="start"
          side="bottom"
          sideOffset={10}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="max-h-60 overflow-y-auto">
            {loading && <div className="p-2 text-xs text-muted-foreground text-center">Searching...</div>}

            {!loading && results.length === 0 && source === 'local' && (
              <div className="p-2 text-xs text-muted-foreground text-center">No local issues found</div>
            )}

            {!loading && results.length === 0 && source === 'api' && (
              <div className="p-2 text-xs text-muted-foreground text-center">No issues found in Jira</div>
            )}

            {results.map(issue => (
              <button
                key={issue.id}
                onClick={() => void handleSelect(issue)}
                className="w-full text-left px-4 py-2 hover:bg-accent hover:text-accent-foreground text-sm border-b border-border last:border-0 transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium text-foreground">{issue.key}</div>
                  {issue.fields.status && (
                    <span className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded border",
                      issue.fields.status.name === 'In Progress' ? "bg-blue-50 text-blue-600 border-blue-100" :
                        issue.fields.status.name === 'Done' ? "bg-green-50 text-green-600 border-green-100" :
                          "bg-gray-50 text-gray-500 border-gray-100"
                    )}>
                      {issue.fields.status.name}
                    </span>
                  )}
                </div>
                <div className="text-muted-foreground truncate">{issue.fields.summary}</div>
              </button>
            ))}

            {/* Show "Search in Jira" ONLY if we haven't searched API yet (source is local) */}
            {debouncedQuery.length >= 2 && !loading && source === 'local' && (
              <button
                onClick={() => setForceApi(true)}
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
