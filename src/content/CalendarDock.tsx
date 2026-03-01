import { useEffect, useRef, useState } from 'react'
import { CalendarDays, RefreshCw, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { getLocalDateString } from '@/lib/worklogMetadata'
import { scrapeEvents, fetchEventDescription } from './scraper'
import { useConfigStore } from '@/store/useConfigStore'
import { logTimeForDateInPage, resetWorklogsForDate } from '@/lib/timeLogging'

export default function CalendarDock() {
  const [open, setOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string>(() => getLocalDateString(new Date()))
  const [loggingTime, setLoggingTime] = useState(false)
  const [resettingWorklogs, setResettingWorklogs] = useState(false)
  const [logResult, setLogResult] = useState('')
  const [resetResult, setResetResult] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)

  const { lastLoggedTimes, setLastLoggedTime, clearLastLoggedTime } = useConfigStore()

  useEffect(() => {
    console.log('[Jira Sync][Content][Dock] CalendarDock component mounted')
    return () => {
      console.log('[Jira Sync][Content][Dock] CalendarDock component unmounted')
    }
  }, [])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current) return
      const path = typeof event.composedPath === 'function' ? event.composedPath() : []
      const clickedInside = path.includes(rootRef.current)
      if (!clickedInside) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', onPointerDown, true)
    return () => document.removeEventListener('mousedown', onPointerDown, true)
  }, [open])

  const handleLogTime = async () => {
    setLoggingTime(true)
    setLogResult('')
    setResetResult('')

    const result = await logTimeForDateInPage({
      date: selectedDate,
      lastLoggedTime: lastLoggedTimes[selectedDate],
      fetchEvents: async () => scrapeEvents(),
      fetchDescription: async (eventId: string) => fetchEventDescription(eventId),
    })

    setLogResult(result.message)
    if (result.newLastLoggedTime) {
      setLastLoggedTime(selectedDate, result.newLastLoggedTime)
    }

    setLoggingTime(false)
  }

  const handleResetWorklogs = async () => {
    setResettingWorklogs(true)
    setResetResult('')
    setLogResult('')

    const result = await resetWorklogsForDate(selectedDate)
    if (result.deletedCount > 0) {
      clearLastLoggedTime(selectedDate)
    }

    setResetResult(result.message)
    setResettingWorklogs(false)
  }

  return (
    <div ref={rootRef} className="relative font-sans text-left">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-medium shadow-[0_1px_3px_rgba(60,64,67,0.3),0_4px_8px_rgba(60,64,67,0.15)] transition-colors hover:cursor-pointer',
          'bg-[#ffffff] text-[#3c4043] border-[#dadce0] hover:bg-[#f1f3f4]',
          'dark:bg-[#3c4043] dark:text-[#e8eaed] dark:border-[#5f6368] dark:hover:bg-[#44474a]'
        )}
        aria-label="Log time"
      >
        <CalendarDays className="h-4 w-4" />
        <span>Log time</span>
      </button>

      {open && (
        <div
          className={cn(
            'absolute bottom-[calc(100%+10px)] right-0 w-[360px] max-w-[min(360px,calc(100vw-24px))] rounded-2xl border p-4 shadow-[0_12px_28px_rgba(60,64,67,0.32)]',
            'bg-[#ffffff] text-[#3c4043] border-[#dadce0]',
            'dark:bg-[#202124] dark:text-[#e8eaed] dark:border-[#5f6368]'
          )}
        >
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <p className="text-base font-medium">Log work time</p>
              <p className="text-xs text-[#5f6368] dark:text-[#bdc1c6]">
                Choose a date and sync completed Jira-linked calendar events.
              </p>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-[#5f6368] hover:bg-[#f1f3f4] dark:text-[#bdc1c6] dark:hover:bg-[#3c4043]"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#5f6368] dark:text-[#bdc1c6]">Date</span>
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className={cn(
                  'h-9 flex-1 border text-sm [color-scheme:light]',
                  'bg-[#ffffff] border-[#dadce0] text-[#3c4043]',
                  'dark:bg-[#202124] dark:border-[#5f6368] dark:text-[#e8eaed] dark:[color-scheme:dark]'
                )}
              />
            </div>

            <button
              onClick={() => void handleLogTime()}
              disabled={loggingTime || resettingWorklogs}
              className={cn(
                'inline-flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                'bg-[#1a73e8] border-[#1a73e8] text-white hover:bg-[#1765cc]'
              )}
            >
              <CalendarDays className={cn('h-4 w-4', loggingTime && 'animate-pulse')} />
              {loggingTime ? 'Logging Time...' : 'Log Time'}
            </button>

            <button
              onClick={() => void handleResetWorklogs()}
              disabled={resettingWorklogs || loggingTime}
              className={cn(
                'inline-flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                'bg-[#f8f9fa] border-[#dadce0] text-[#3c4043] hover:bg-[#f1f3f4]',
                'dark:bg-[#3c4043] dark:border-[#5f6368] dark:text-[#e8eaed] dark:hover:bg-[#44474a]'
              )}
            >
              <RefreshCw className={cn('h-4 w-4', resettingWorklogs && 'animate-spin')} />
              {resettingWorklogs ? 'Resetting...' : 'Reset Worklogs'}
            </button>

            {lastLoggedTimes[selectedDate] && (
              <p className="text-center text-[10px] text-[#5f6368] dark:text-[#bdc1c6]">
                Last logged: {new Date(lastLoggedTimes[selectedDate]).toLocaleTimeString()}
              </p>
            )}

            {logResult && (
              <p className={cn('text-center text-xs', logResult.toLowerCase().includes('failed') || logResult.toLowerCase().includes('please') ? 'text-red-600 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300')}>
                {logResult}
              </p>
            )}

            {resetResult && (
              <p className={cn('text-center text-xs', resetResult.toLowerCase().includes('failed') ? 'text-red-600 dark:text-red-300' : 'text-amber-700 dark:text-amber-300')}>
                {resetResult}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
