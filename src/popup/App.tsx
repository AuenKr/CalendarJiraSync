import { useEffect, useMemo, useState } from 'react'
import { useConfigStore } from '../store/useConfigStore'
import { syncData, getProjects, type JiraProject } from '../lib/jira'
import { Settings, RefreshCw, Layout, AlertCircle, CheckSquare, Square, Search } from 'lucide-react'
import { useQuery, useMutation } from '@tanstack/react-query'
import Fuse from 'fuse.js'
import { Input } from '@/components/ui/input'

function App() {
  const {
    isConfigured,
    selectedProjectKeys,
    toggleProject,
    projects: storedProjects,
    setProjects,
  } = useConfigStore()
  const configured = isConfigured()
  const [searchQuery, setSearchQuery] = useState('')

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
  const filteredProjects = useMemo(() => {
    if (!searchQuery) {
      // Sort: Selected first, then alphabetical
      return [...projects].sort((a, b) => {
        const aSelected = (selectedProjectKeys || []).includes(a.key)
        const bSelected = (selectedProjectKeys || []).includes(b.key)
        if (aSelected && !bSelected) return -1
        if (!aSelected && bSelected) return 1
        return a.name.localeCompare(b.name)
      })
    }

    const fuse = new Fuse(projects, {
      keys: ['name', 'key'],
      threshold: 0.3,
    })
    return fuse.search(searchQuery).map(r => r.item)
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
