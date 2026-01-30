import { useEffect, useState } from 'react'
import { useConfigStore } from '../store/useConfigStore'
import { syncData, getProjects, addWorklog, type JiraProject } from '../lib/jira'
import { Settings, RefreshCw, Layout, AlertCircle, CheckSquare, Square, Search, Calendar } from 'lucide-react'
import { useQuery, useMutation } from '@tanstack/react-query'
import Fuse from 'fuse.js'
import { Input } from '@/components/ui/input'
import type { CalendarEvent } from '@/types/messages'

function App() {
  const { isConfigured, selectedProjectKeys, toggleProject, projects: storedProjects, setProjects, lastLoggedTimes, setLastLoggedTime } = useConfigStore()
  const configured = isConfigured()
  const [searchQuery, setSearchQuery] = useState('')
  const [filteredProjects, setFilteredProjects] = useState<JiraProject[]>([])
  const [loggingTime, setLoggingTime] = useState(false)
  const [logResult, setLogResult] = useState<string>('')
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0])

  const handleLogTime = async () => {
    setLoggingTime(true)
    setLogResult('')
    
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
      // console.log('[Jira Sync] Fetched events from content script:', events)

      let loggedCount = 0
      let errors = 0
      
      // Filter events by selected date
      const targetDate = new Date(selectedDate)
      const targetDateStr = targetDate.toDateString() // "Sun Jan 25 2026"
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
      // console.log('[Jira Sync] 1. Fetched all events:', processedEvents)

      const filteredEvents: CalendarEvent[] = []

      for (const event of processedEvents) {
        // Check if event is on the selected date
        const eventDate = new Date(event.startTime)
        if (eventDate.toDateString() !== targetDateStr) {
           continue
        }

        // Check for Jira Key: [KEY-123]
        const match = event.title.match(/\[([A-Z]+-\d+)\]/)
        
        // Calculate duration
        const startTime = new Date(event.startTime)
        const endTime = new Date(event.endTime)
        const durationSeconds = (endTime.getTime() - startTime.getTime()) / 1000

        // Rule 1: Completed Events Only (Current Time > Event End Time)
        // We allow a small buffer (e.g. 1 minute) to account for clock skew
        if (endTime.getTime() > currentTime.getTime()) {
          // console.log(`[Jira Sync] Skipping in-progress/future event: ${event.title}`)
          continue
        }

        // Rule 2: Strict Cutoff (Event End Time > Last Logged Time)
        if (lastLoggedTime && endTime.getTime() <= lastLoggedTime.getTime()) {
          // console.log(`[Jira Sync] Skipping already logged event: ${event.title}`)
          continue
        }

        if (match && match[1] && durationSeconds > 0 && event.startTime) {
            filteredEvents.push(event)
        }
      }

      // console.log('[Jira Sync] 2. Filtered events (Date + Jira Key + Rules):', filteredEvents)

      for (const event of filteredEvents) {
        // console.log('[Jira Sync] 3. Processing event:', event.title)
        
        const match = event.title.match(/\[([A-Z]+-\d+)\]/)
        if (!match) continue

        const issueKey = match[1]
        
        const startTime = new Date(event.startTime)
        const endTime = new Date(event.endTime)
        const durationSeconds = (endTime.getTime() - startTime.getTime()) / 1000
          
          try {
            // Fetch description if event ID is available
            let description = event.description
            if (!description && event.id) {
               // console.log(`[Jira Sync] Fetching description for event ${event.id}`)
               const descResponse = await chrome.tabs.sendMessage(tab.id, { 
                 type: 'FETCH_EVENT_DESCRIPTION', 
                 payload: { eventId: event.id } 
               })
               if (descResponse && descResponse.description) {
                 description = descResponse.description
                 event.description = description
                 // console.log(`[Jira Sync] Fetched description for ${issueKey}:`, description)
               }
            }

            // New Comment Format: [Title] \n [Start] - [End] \n [Description]
            const timeRange = `${startTime.toLocaleTimeString()} - ${endTime.toLocaleTimeString()}`
            const cleanTitle = event.title.replace(/\[?[A-Z]+-\d+\]?\s*/, '').trim()
            
            let comment = `[${cleanTitle}]\n${timeRange}`
            if (description) {
              comment += `\n\n${description}`
            }
            
            // Format date for Jira (replace Z with +0000 to ensure compatibility)
            const jiraStarted = new Date(event.startTime).toISOString().replace('Z', '+0000')
            
            await addWorklog(issueKey, durationSeconds, jiraStarted, comment)
            // console.log(`[Jira Sync] 3b. Successfully logged time for: ${issueKey}, Duration: ${durationSeconds}s`)
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
                disabled={loggingTime}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Calendar size={16} className={loggingTime ? "animate-pulse" : ""} />
                {loggingTime ? 'Logging Time...' : 'Log Time'}
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
