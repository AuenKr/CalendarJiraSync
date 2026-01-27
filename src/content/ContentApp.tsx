import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { searchIssues, type JiraIssue } from '../lib/jira'

// Helper to update description - REMOVED
/*
function updateDescription(key: string) {
  const descEl = document.querySelector('[aria-label="Description"]') as HTMLElement
  if (descEl) {
    let currentText = descEl.innerText || descEl.textContent || ''
    
    // Remove existing Jira metadata if present to avoid duplicates/conflicts
    currentText = currentText.replace(/Jira Issue: [A-Z]+-\d+/g, '').trim()
    
    let newMetadata = `\n\nJira Issue: ${key}`

    if (descEl.isContentEditable) {
      descEl.innerText = currentText + newMetadata
    } else if (descEl.tagName === 'TEXTAREA') {
      (descEl as HTMLTextAreaElement).value = currentText + newMetadata
    }
    descEl.dispatchEvent(new Event('input', { bubbles: true }))
  }
}
*/

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

export default function ContentApp({ titleInput }: { titleInput?: HTMLInputElement }) {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, 300)
  const [open, setOpen] = useState(false)
  const [forceApi, setForceApi] = useState(false)
  const [isFocused, setIsFocused] = useState(titleInput ? titleInput === document.activeElement : false)

  // Queries
  const { data, isLoading: loading } = useQuery({
    queryKey: ['issues', debouncedQuery, forceApi],
    queryFn: () => searchIssues(debouncedQuery, forceApi),
    enabled: debouncedQuery.length >= 2,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })

  const results = data?.issues || []
  const source = data?.source

  // Listen to input changes
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
    const handleBlur = () => setIsFocused(false)

    // Initial value
    if (titleInput.value) {
      let val = titleInput.value
      val = val.replace(/^\[[A-Z]+-\d+\]\s*/, '')
      if (query !== val) {
        setTimeout(() => setQuery(val), 0)
      }
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
    // User said: "If jira task search result is empty. Then there is no need to give btn... Simplly show no search result found"
    // So we should probably keep it open to show "No results"
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
      // We use a small timeout to ensure events are processed
      setTimeout(() => {
        input.blur()
      }, 0)
    }

    // Update description - REMOVED as per user request
    // updateDescription(issue.key)
  }

  return (
    <div className="jira-sync-overlay font-sans text-left">
      <Popover open={open} onOpenChange={setOpen}>
        {/* Invisible trigger that we control programmatically via open state */}
        <PopoverTrigger asChild>
          <div className="w-full h-0" />
        </PopoverTrigger>
        <PopoverContent
          className="w-[400px] p-0 border-border"
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
                className="w-full text-left px-4 py-2 hover:bg-accent hover:text-accent-foreground text-sm border-b border-border last:border-0 transition-colors"
              >
                <div className="font-medium text-foreground">{issue.key}</div>
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
