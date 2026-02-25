import { useEffect, useState } from 'react'
import { useConfigStore } from '../store/useConfigStore'
import { syncData, getProjects, addWorklog, resetExtensionWorklogsByDate, type JiraProject } from '../lib/jira'
import { Settings, RefreshCw, Layout, AlertCircle, CheckSquare, Square, Search, Calendar } from 'lucide-react'
import { useQuery, useMutation } from '@tanstack/react-query'
import Fuse from 'fuse.js'
import { Input } from '@/components/ui/input'
import type { CalendarEvent } from '@/types/messages'
import { buildWorklogComment, createExtensionWorklogMetadata, getLocalDateString } from '@/lib/worklogMetadata'

function App() {
  const { isConfigured, selectedProjectKeys, toggleProject, projects: storedProjects, setProjects, lastLoggedTimes, setLastLoggedTime, clearLastLoggedTime } = useConfigStore()
  const configured = isConfigured()
  const [searchQuery, setSearchQuery] = useState('')
  const [filteredProjects, setFilteredProjects] = useState<JiraProject[]>([])
  const [loggingTime, setLoggingTime] = useState(false)
  const [resettingWorklogs, setResettingWorklogs] = useState(false)
  const [logResult, setLogResult] = useState<string>('')
  const [resetResult, setResetResult] = useState<string>('')
  const [selectedDate, setSelectedDate] = useState<string>(() => getLocalDateString(new Date()))
  const logPrefix = '[Jira Sync][Popup]'

  const getDayBounds = (date: string) => {
    const dayStart = new Date(`${date}T00:00:00`)
    const dayEnd = new Date(`${date}T23:59:59.999`)
    return { dayStart, dayEnd }
  }

  const getOverlapWindow = (startTime: Date, endTime: Date, date: string) => {
    const { dayStart, dayEnd } = getDayBounds(date)
    const overlapStart = new Date(Math.max(startTime.getTime(), dayStart.getTime()))
    const overlapEnd = new Date(Math.min(endTime.getTime(), dayEnd.getTime()))
    if (overlapEnd.getTime() <= overlapStart.getTime()) return null
    return { overlapStart, overlapEnd }
  }

  const handleLogTime = async () => {
    setLoggingTime(true)
    setLogResult('')
    setResetResult('')
    console.log(`${logPrefix} Step 1: log flow started`, { selectedDate })
    
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) throw new Error('No active tab')
      
      // Check if we are on Google Calendar
      if (!tab.url?.includes('calendar.google.com')) {
        setLogResult('Please go to Google Calendar')
        return
      }

      // Send message to content script
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'FETCH_CALENDAR_EVENTS' })
      
      if (!response || !response.events) {
        throw new Error('No events found')
      }
      
      const events = response.events as CalendarEvent[]
      console.log(`${logPrefix} Step 2: fetched events from content`, { count: events.length })

      let loggedCount = 0
      let errors = 0
      
      const currentTime = new Date()

      // Get last logged time for this date
      const lastLoggedTimeStr = lastLoggedTimes[selectedDate]
      const lastLoggedTime = lastLoggedTimeStr ? new Date(lastLoggedTimeStr) : null

      // Deduplicate events by ID to avoid multiple API calls for the same event
      const uniqueEvents = new Map<string, CalendarEvent>()
      for (const event of events) {
        if (event.id && !uniqueEvents.has(event.id)) {
          uniqueEvents.set(event.id, event)
        }
      }
      const processedEvents = Array.from(uniqueEvents.values())
      console.log(`${logPrefix} Step 3: deduplicated events`, { count: processedEvents.length })

      const filteredEvents: CalendarEvent[] = []

      for (const event of processedEvents) {
        // Check for Jira Key: [KEY-123]
        const match = event.title.match(/\[([A-Z]+-\d+)\]/)
        
        // Calculate duration
        const startTime = new Date(event.startTime)
        const endTime = new Date(event.endTime)
        const overlap = getOverlapWindow(startTime, endTime, selectedDate)
        if (!overlap) {
          continue
        }
        const durationSeconds = (overlap.overlapEnd.getTime() - overlap.overlapStart.getTime()) / 1000

        // Rule 1: Completed Events Only (Current Time > Event End Time)
        // We allow a small buffer (e.g. 1 minute) to account for clock skew
        if (endTime.getTime() > currentTime.getTime()) {
          continue
        }

        // Rule 2: Strict Cutoff (Event End Time > Last Logged Time)
        if (lastLoggedTime && overlap.overlapEnd.getTime() <= lastLoggedTime.getTime()) {
          continue
        }

        if (match && match[1] && durationSeconds > 0 && event.startTime) {
            filteredEvents.push(event)
        }
      }
      console.log(`${logPrefix} Step 4: filtered events`, { eligible: filteredEvents.length })

      for (const event of filteredEvents) {
        const match = event.title.match(/\[([A-Z]+-\d+)\]/)
        if (!match) continue

        const issueKey = match[1]
        
        const startTime = new Date(event.startTime)
        const endTime = new Date(event.endTime)
        const overlap = getOverlapWindow(startTime, endTime, selectedDate)
        if (!overlap) continue
        const durationSeconds = (overlap.overlapEnd.getTime() - overlap.overlapStart.getTime()) / 1000
          
          try {
            // Fetch description if event ID is available
            let description = event.description
            if (!description && event.id) {
               console.log(`${logPrefix} Step 5: fetching description`, { issueKey, eventId: event.id })
               const descResponse = await chrome.tabs.sendMessage(tab.id, { 
                 type: 'FETCH_EVENT_DESCRIPTION', 
                 payload: { eventId: event.id } 
               })
               if (descResponse && descResponse.description) {
                 description = descResponse.description
                 event.description = description
               }
            }

            const comment = buildWorklogComment({
              startTime: overlap.overlapStart,
              endTime: overlap.overlapEnd,
              description,
              metadata: createExtensionWorklogMetadata(selectedDate, event.id),
            })
            
            // Format date for Jira (replace Z with +0000 to ensure compatibility)
            const jiraStarted = overlap.overlapStart.toISOString().replace('Z', '+0000')
            
            await addWorklog(issueKey, durationSeconds, jiraStarted, comment)
            console.log(`${logPrefix} Step 6: worklog added`, { issueKey, durationSeconds })
            loggedCount++
          } catch (e) {
            console.error(`[Jira Sync] Failed to log worklog for ${issueKey}`, e)
            errors++
          }
      }

      if (loggedCount === 0 && errors === 0) {
        setLogResult('No new completed tasks found to log')
      } else {
        setLogResult(`Logged ${loggedCount} Event${loggedCount !== 1 ? 's' : ''}${errors > 0 ? `, ${errors} failed` : ''}!`)
        if (loggedCount > 0) {
          // Update last logged time for this date to NOW
          setLastLoggedTime(selectedDate, new Date().toISOString())
        }
        console.log(`${logPrefix} Step 7: log flow completed`, { loggedCount, errors })
      }
    } catch (e: unknown) {
      console.error(e)
      const err = e as Error
      if (err.message && err.message.includes('Receiving end does not exist')) {
        setLogResult('Please refresh the Calendar page')
      } else {
        setLogResult('Failed. Refresh Calendar page.')
      }
    } finally {
      setLoggingTime(false)
    }
  }

  const handleResetWorklogs = async () => {
    setResettingWorklogs(true)
    setResetResult('')
    setLogResult('')
    console.log(`${logPrefix} Reset Step 1: reset flow started`, { selectedDate })

    try {
      const result = await resetExtensionWorklogsByDate(selectedDate)
      console.log(`${logPrefix} Reset Step 2: reset response`, result)

      if (result.deletedCount > 0) {
        clearLastLoggedTime(selectedDate)
      }

      if (result.matchedCount === 0) {
        setResetResult('No extension worklogs found for selected date')
      } else {
        setResetResult(`Deleted ${result.deletedCount}/${result.matchedCount} extension worklog${result.matchedCount !== 1 ? 's' : ''}`)
      }
    } catch (e) {
      console.error('[Jira Sync] Failed to reset worklogs', e)
      setResetResult('Failed to reset worklogs')
    } finally {
      setResettingWorklogs(false)
      console.log(`${logPrefix} Reset Step 3: reset flow finished`)
    }
  }

  const { data: projects = [], isFetching: fetchingProjects, refetch: refetchProjects } = useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
    enabled: configured,
    staleTime: 1000 * 60 * 60, // 1 hour
    initialData: storedProjects.length > 0 ? storedProjects : undefined,
  })

  // Sync React Query data to Zustand store
  useEffect(() => {
    if (projects.length > 0) {
      setProjects(projects)
    }
  }, [projects, setProjects])

  // Filter projects using Fuse.js
  useEffect(() => {
    if (!searchQuery) {
      // Sort: Selected first, then alphabetical
      const sorted = [...projects].sort((a, b) => {
        const aSelected = (selectedProjectKeys || []).includes(a.key)
        const bSelected = (selectedProjectKeys || []).includes(b.key)
        if (aSelected && !bSelected) return -1
        if (!aSelected && bSelected) return 1
        return a.name.localeCompare(b.name)
      })
      setFilteredProjects(sorted)
      return
    }
    const fuse = new Fuse(projects, {
      keys: ['name', 'key'],
      threshold: 0.3
    })
    setFilteredProjects(fuse.search(searchQuery).map(r => r.item))
  }, [searchQuery, projects, selectedProjectKeys])

  const syncMutation = useMutation({
    mutationFn: syncData,
    onSuccess: () => {
      // Invalidate queries if needed, though sync updates local storage mostly
    }
  })

  const openSetup = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage()
    } else {
      window.open('/setup.html', '_blank')
    }
  }

  return (
    <div className="w-80 bg-gray-900 text-white p-4 max-h-[500px] overflow-y-auto">
      <header className="flex justify-between items-center mb-4">
        <h1 className="text-lg font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
          Calendar Jira Sync
        </h1>
        <button 
          onClick={openSetup}
          className="p-2 hover:bg-gray-800 rounded-full transition-colors text-gray-400 hover:text-white"
        >
          <Settings size={18} />
        </button>
      </header>

      <div className="flex flex-col items-center justify-center space-y-4">
        {configured ? (
          <>
            <div className="w-full bg-gray-800 rounded-lg p-4 border border-gray-700">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                  <Layout size={16} /> Select Projects to Sync
                </h2>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{filteredProjects.length} found</span>
                  <button 
                    onClick={() => refetchProjects()} 
                    className="text-gray-400 hover:text-white p-1 rounded hover:bg-gray-700"
                    title="Refresh Projects"
                  >
                    <RefreshCw size={12} className={fetchingProjects ? "animate-spin" : ""} />
                  </button>
                </div>
              </div>

              <div className="mb-2 relative">
                <Search size={14} className="absolute left-2 top-2.5 text-gray-500" />
                <Input 
                  type="text" 
                  placeholder="Search projects..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 pl-8 bg-gray-900/50 border-gray-700 text-xs"
                />
              </div>
              
              {fetchingProjects && projects.length === 0 ? (
                <div className="text-center py-4 text-gray-500 text-xs">Loading projects...</div>
              ) : filteredProjects.length > 0 ? (
                <div className="space-y-2 max-h-24 overflow-y-auto pr-1 custom-scrollbar">
                  {filteredProjects.map((project: JiraProject) => {
                    const isSelected = (selectedProjectKeys || []).includes(project.key)
                    return (
                      <button 
                        key={project.id} 
                        onClick={() => toggleProject(project.key)}
                        className={`w-full text-xs p-2 rounded border flex justify-between items-center transition-colors ${
                          isSelected 
                            ? 'bg-blue-900/30 border-blue-500/50 text-blue-100' 
                            : 'bg-gray-700/50 border-gray-700 text-gray-300 hover:bg-gray-700'
                        }`}
                      >
                        <span className="truncate flex-1 text-left">{project.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-400 bg-gray-800 px-1.5 py-0.5 rounded">{project.key}</span>
                          {isSelected ? <CheckSquare size={14} className="text-blue-400" /> : <Square size={14} className="text-gray-500" />}
                        </div>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="text-center py-4 text-gray-500 text-xs">No projects found</div>
              )}
            </div>

            <div className="w-full">
              <button
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <RefreshCw size={16} className={syncMutation.isPending ? "animate-spin" : ""} />
                {syncMutation.isPending ? 'Syncing Tasks...' : 'Sync Tasks Now'}
              </button>
              {syncMutation.isSuccess && <p className="text-xs text-center mt-2 text-green-400">Synced {syncMutation.data?.count} tasks!</p>}
              {syncMutation.isError && <p className="text-xs text-center mt-2 text-red-400">Sync failed</p>}
            </div>

            <div className="w-full pt-2 border-t border-gray-700 space-y-2">
               <div className="flex items-center gap-2">
                 <span className="text-xs text-gray-400">Log Date:</span>
                 <Input 
                   type="date" 
                   value={selectedDate}
                   onChange={(e) => setSelectedDate(e.target.value)}
                   className="h-8 bg-gray-900/50 border-gray-700 text-xs flex-1 [color-scheme:dark]"
                 />
               </div>
               <button
                onClick={handleLogTime}
                disabled={loggingTime || resettingWorklogs}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Calendar size={16} className={loggingTime ? "animate-pulse" : ""} />
                {loggingTime ? 'Logging Time...' : 'Log Time'}
              </button>
              <button
                onClick={handleResetWorklogs}
                disabled={resettingWorklogs || loggingTime}
                className="w-full bg-rose-600 hover:bg-rose-700 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <RefreshCw size={16} className={resettingWorklogs ? "animate-spin" : ""} />
                {resettingWorklogs ? 'Resetting...' : 'Reset Worklogs'}
              </button>
              {lastLoggedTimes[selectedDate] && (
                <p className="text-[10px] text-center text-gray-500">
                  Last logged: {new Date(lastLoggedTimes[selectedDate]).toLocaleTimeString()}
                </p>
              )}
              {logResult && (
                <p className={`text-xs text-center mt-2 ${logResult.includes('Failed') || logResult.includes('Please') ? 'text-red-400' : 'text-green-400'}`}>
                  {logResult}
                </p>
              )}
              {resetResult && (
                <p className={`text-xs text-center ${resetResult.includes('Failed') ? 'text-red-400' : 'text-yellow-300'}`}>
                  {resetResult}
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="w-16 h-16 bg-yellow-500/10 rounded-full flex items-center justify-center text-yellow-500">
              <AlertCircle size={32} />
            </div>
            <p className="text-center text-gray-300">
              Please configure the extension to start syncing.
            </p>
            <button
              onClick={openSetup}
              className="mt-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
            >
              Open Settings
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default App
