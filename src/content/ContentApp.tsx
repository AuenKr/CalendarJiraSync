import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Check, ChevronDown, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
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

// Helper to set input value to avoid linter error about prop mutation
function setInputValue(input: HTMLInputElement, value: string) {
  input.value = value
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
  const queryClient = useQueryClient()

  // Update titleEl if prop changes
  useEffect(() => {
    setTitleEl(titleElement)
  }, [titleElement])

  // Poll for title element if we are in "Bubble view" (i.e. not editing with input)
  useEffect(() => {
    if (titleInput) return // We are in edit mode, different logic
    
    const findTitle = () => {
       if (titleEl && titleEl.isConnected) return
       
       // Try to find it again
       const root = container || document
       const newEl = (root.querySelector('[role="heading"]') as HTMLElement) ||
                     (root.querySelector('.JAPzS') as HTMLElement) ||
                     (root.querySelector('.gUD7Lf') as HTMLElement)
       
       if (newEl && newEl !== titleEl) {
         setTitleEl(newEl)
       }
    }
    
    const interval = setInterval(findTitle, 500)
    return () => clearInterval(interval)
  }, [titleEl, titleInput, container])

  // Robust Input Detection
  useEffect(() => {
    // If we have a title element (Bubble mode), we don't need to poll for input
    if (titleElement) return

    // If we have an input and it's connected, great.
    if (titleInput && titleInput.isConnected) return

    // Otherwise, try to find the active title input
    const findInput = () => {
      const root = container || document

      // Check active element first - if user is typing, this is the one we want!
      if (document.activeElement &&
        (document.activeElement.getAttribute('aria-label') === 'Add title' ||
          document.activeElement.getAttribute('aria-label') === 'Title')) {
        const active = document.activeElement as HTMLInputElement
        if (active !== titleInput) {
          // console.log('[Jira Sync] Found active title input', active)
          setTitleInput(active)
          return
        }
      }

      const input = root.querySelector('input[aria-label="Add title"]') ||
        root.querySelector('input[aria-label="Title"]') ||
        root.querySelector('input[type="text"][aria-label*="title" i]') as HTMLInputElement

      if (input && input !== titleInput) {
        // console.log('[Jira Sync] Found new title input', input)
        setTitleInput(input as HTMLInputElement)
      }
    }

    findInput()
    const interval = setInterval(findInput, 500) // Poll faster (500ms)
    // Global focus listener to catch inputs even if they are not found by selectors initially
    const handleGlobalFocus = (e: FocusEvent) => {
      const target = e.target as HTMLElement
      if (target instanceof HTMLInputElement &&
        (target.getAttribute('aria-label') === 'Add title' ||
          target.getAttribute('aria-label') === 'Title' ||
          target.getAttribute('aria-label') === 'Add title and time')) { // Added 'Add title and time' for quick add bubble
        if (target !== titleInput) {
          // console.log('[Jira Sync] Detected focus on new title input', target)
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

  // Extract linked key from input or element
  useEffect(() => {
    const checkKey = () => {
      let value = ''
      if (titleInput) {
        value = titleInput.value
      } else if (titleEl) {
        value = titleEl.textContent || ''
      }

      const match = value.match(/^\[?([A-Z]+-\d+)\]?/)
      if (match) {
        setLinkedKey(match[1])
      } else {
        setLinkedKey(null)
      }
    }

    checkKey()

    if (titleInput) {
      const handleInput = () => checkKey()
      titleInput.addEventListener('input', handleInput)
      titleInput.addEventListener('change', handleInput) // Also listen to change for programmatic updates
      titleInput.addEventListener('keyup', handleInput) // Catch keyups just in case

      return () => {
        titleInput.removeEventListener('input', handleInput)
        titleInput.removeEventListener('change', handleInput)
        titleInput.removeEventListener('keyup', handleInput)
      }
    } else if (titleEl) {
      // Observe changes to title element text
      const observer = new MutationObserver(checkKey)
      observer.observe(titleEl, { childList: true, characterData: true, subtree: true })
      return () => observer.disconnect()
    }
  }, [titleInput, titleEl])

  // Fetch linked issue details (status)
  const { data: linkedIssue, refetch: refetchLinkedIssue } = useQuery({
    queryKey: ['issue', linkedKey],
    queryFn: () => getIssue(linkedKey!),
    enabled: !!linkedKey,
    staleTime: 1000 * 60 * 5,
  })

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
    queryKey: ['issues', debouncedQuery, forceApi],
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
      val = val.replace(/^\[[A-Z]+-\d+\]\s*/, '')

      setQuery(val)
      setForceApi(false)
    }

    const handleFocus = () => setIsFocused(true)
    const handleBlur = () => {
      // Small delay to allow clicking on results
      setTimeout(() => setIsFocused(false), 200)
    }

    // Initial value
    if (titleInput.value) {
      let val = titleInput.value
      val = val.replace(/^\[[A-Z]+-\d+\]\s*/, '')
      if (query !== val) {
        setTimeout(() => setQuery(val), 0)
      }
    }

    // Check if already focused (crucial for reload/autofocus scenarios)
    if (document.activeElement === titleInput) {
      setTimeout(() => setIsFocused(true), 0)
    }

    titleInput.addEventListener('input', handleInput)
    titleInput.addEventListener('focus', handleInput)
    titleInput.addEventListener('focus', handleFocus)
    titleInput.addEventListener('blur', handleBlur)

    return () => {
      titleInput.removeEventListener('input', handleInput)
      titleInput.removeEventListener('focus', handleInput)
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

  const handleSelect = (issue: JiraIssue) => {
    setQuery('')
    setForceApi(false)
    setOpen(false)

    // Update Google Calendar Title
    const input = titleInput || document.querySelector('input[aria-label="Add title"]') as HTMLInputElement
    if (input) {
      // Focus first to simulate user interaction
      input.focus()

      // Check if there is already a key at the start
      const currentVal = input.value
      const keyMatch = currentVal.match(/^\[?([A-Z]+-\d+)\]?\s*/)

      let newValue = ''
      if (keyMatch) {
        // Replace existing key
        newValue = currentVal.replace(/^\[?[A-Z]+-\d+\]?\s*/, `[${issue.key}] `)
      } else {
        // Prepend new key
        const trimmedVal = currentVal.trim()
        if (trimmedVal) {
          newValue = `[${issue.key}] ${trimmedVal}`
        } else {
          newValue = `[${issue.key}] ${issue.fields.summary}`
        }
      }

      // Use native setter to ensure React/frameworks detect the change
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(input, newValue);
      } else {
        setInputValue(input, newValue)
      }

      // Dispatch events to trigger listeners
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      // Blur to commit the change (simulating user leaving the field)
      setTimeout(() => {
        input.blur()
      }, 0)
    }
  }

  return (
    <div className="jira-sync-overlay font-sans text-left relative">
      {/* Status Badge & Dropdown - Only show if we have a linked key AND we are in Bubble view (titleElement exists) */}
      {linkedKey && linkedIssue && titleEl && (
        <div className="absolute right-0 -top-8 z-50">
          <Popover>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  "flex items-center gap-1.5 p-1 w-25 rounded-sm mt-7 text-xs justify-between font-medium transition-colors border shadow-sm hover:cursor-pointer",
                  linkedIssue.fields.status?.name === 'In Progress' ? "bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200" :
                    linkedIssue.fields.status?.name === 'Done' ? "bg-green-100 text-green-700 border-green-200 hover:bg-green-200" :
                      "bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200"
                )}
              >
                {transitionMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                <span className="truncate">{linkedIssue.fields.status?.name || 'Unknown'}</span>
                <ChevronDown className="h-3 w-3 opacity-50" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-1" align="end">
              <div className="text-xs font-medium text-muted-foreground px-2 py-1.5 mb-1">
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
                  className="w-full text-left px-2 py-1.5 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground flex items-center justify-between"
                >
                  {t.name}
                  {linkedIssue.fields.status?.name === (t as unknown as { to?: { name: string } }).to?.name && <Check className="h-3 w-3" />}
                </button>
              ))}
              {(!transitions || transitions.length === 0) && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  No transitions available
                </div>
              )}
            </PopoverContent>
          </Popover>
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
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="max-h-60 overflow-y-auto">
            {loading && <div className="p-2 text-xs text-muted-foreground text-center">Searching...</div>}

            {!loading && results.length === 0 && (
              <div className="p-2 text-xs text-muted-foreground text-center">No issues found</div>
            )}

            {results.map(issue => (
              <button
                key={issue.id}
                onClick={() => handleSelect(issue)}
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
