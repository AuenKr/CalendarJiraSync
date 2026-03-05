import { useEffect, useMemo, useState } from 'react'
import { useConfigStore } from '../store/useConfigStore'
import { syncData, getProjects, type JiraProject } from '../lib/jira'
import { Settings, RefreshCw, Layout, AlertCircle, CheckSquare, Square, Search, Sparkles } from 'lucide-react'
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
    staleTime: 1000 * 60 * 60,
    initialData: storedProjects.length > 0 ? storedProjects : undefined,
  })

  useEffect(() => {
    if (projects.length > 0) {
      setProjects(projects)
    }
  }, [projects, setProjects])

  const filteredProjects = useMemo(() => {
    if (!searchQuery) {
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
  })

  const openSetup = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage()
    } else {
      window.open('/setup.html', '_blank')
    }
  }

  return (
    <div className="relative w-[22rem] overflow-hidden bg-[#f3efe8] p-4 text-[#1a2436]">
      <div className="pointer-events-none absolute -top-10 -right-10 h-28 w-28 rounded-full bg-[#d7e4f8] blur-2xl" />
      <div className="pointer-events-none absolute -bottom-10 -left-10 h-24 w-24 rounded-full bg-[#f7d7c1] blur-2xl" />

      <div className="relative space-y-4">
        <header className="flex items-start justify-between rounded-2xl border border-[#d6cec1] bg-[#faf7f1] p-3 shadow-[0_14px_30px_-26px_rgba(20,27,39,0.8)]">
          <div>
            <p className="mb-1 inline-flex items-center gap-1 rounded-full border border-[#d8cfc2] bg-[#f1ebe2] px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-[#536078] uppercase">
              <Sparkles size={11} />
              Live sync
            </p>
            <h1 className="text-base leading-tight [font-family:'Iowan_Old_Style','Palatino_Linotype','Book_Antiqua',serif]">
              Calendar Jira Sync
            </h1>
          </div>
          <button
            onClick={openSetup}
            className="rounded-full border border-[#d2c9bc] bg-white p-2 text-[#5f6778] transition hover:border-[#b0a590] hover:text-[#1d5d8c]"
            title="Open setup"
          >
            <Settings size={16} />
          </button>
        </header>

        {configured ? (
          <div className="space-y-3">
            <section className="rounded-2xl border border-[#d6cec1] bg-white/90 p-3">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-xs font-semibold tracking-[0.08em] text-[#4f5b73] uppercase">
                  <Layout size={14} />
                  Projects to sync
                </h2>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-[#f1ebe2] px-2 py-0.5 text-[10px] font-semibold text-[#5a6578]">
                    {filteredProjects.length} shown
                  </span>
                  <button
                    onClick={() => refetchProjects()}
                    className="rounded-full border border-[#d6cec1] bg-[#faf7f1] p-1 text-[#5d6677] transition hover:border-[#b8ad98] hover:text-[#1d5d8c]"
                    title="Refresh projects"
                  >
                    <RefreshCw size={12} className={fetchingProjects ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>

              <div className="relative mb-2">
                <Search size={14} className="absolute top-2.5 left-2 text-[#78839b]" />
                <Input
                  type="text"
                  placeholder="Search projects"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 border-[#d7cebf] bg-[#faf7f1] pl-8 text-xs placeholder:text-[#8b91a0]"
                />
              </div>

              {fetchingProjects && projects.length === 0 ? (
                <div className="py-5 text-center text-xs text-[#677086]">Loading projects...</div>
              ) : filteredProjects.length > 0 ? (
                <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                  {filteredProjects.map((project: JiraProject) => {
                    const isSelected = (selectedProjectKeys || []).includes(project.key)

                    return (
                      <button
                        key={project.id}
                        onClick={() => toggleProject(project.key)}
                        className={`flex w-full items-center justify-between rounded-xl border px-2.5 py-2 text-xs transition ${
                          isSelected
                            ? 'border-[#8db2cd] bg-[#edf5fb] text-[#1f2f47]'
                            : 'border-[#ddd4c8] bg-[#faf7f1] text-[#2f3c53] hover:border-[#bab09f] hover:bg-[#f3ecdf]'
                        }`}
                      >
                        <span className="truncate text-left font-medium">{project.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-[#ece5db] px-1.5 py-0.5 text-[10px] font-semibold text-[#596378]">{project.key}</span>
                          {isSelected ? <CheckSquare size={14} className="text-[#1d5d8c]" /> : <Square size={14} className="text-[#7b859a]" />}
                        </div>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-[#d6cec1] bg-[#f7f2ea] py-5 text-center text-xs text-[#677086]">
                  No projects found
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-[#d6cec1] bg-white/90 p-3">
              <button
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1d5d8c] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#174e74] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw size={15} className={syncMutation.isPending ? 'animate-spin' : ''} />
                {syncMutation.isPending ? 'Syncing tasks...' : 'Run sync now'}
              </button>
              {syncMutation.isSuccess && (
                <p className="mt-2 rounded-lg border border-[#b9d9c3] bg-[#effaf2] px-2 py-1.5 text-center text-xs text-[#25623d]">
                  Synced {syncMutation.data?.count} tasks
                </p>
              )}
              {syncMutation.isError && (
                <p className="mt-2 rounded-lg border border-[#e4bbb2] bg-[#fff0ee] px-2 py-1.5 text-center text-xs text-[#9e2f24]">
                  Sync failed. Try again.
                </p>
              )}
            </section>
          </div>
        ) : (
          <section className="rounded-2xl border border-[#d6cec1] bg-white/95 p-4 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#fff4df] text-[#ab6c12]">
              <AlertCircle size={32} />
            </div>
            <h2 className="mb-1 text-sm font-semibold text-[#253147]">Setup required</h2>
            <p className="text-xs leading-5 text-[#657188]">
              Connect your Jira workspace once, then run quick syncs here whenever you need fresh tasks.
            </p>
            <button
              onClick={openSetup}
              className="mt-3 rounded-xl bg-[#1d5d8c] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#174e74]"
            >
              Open setup
            </button>
          </section>
        )}
      </div>
    </div>
  )
}

export default App
