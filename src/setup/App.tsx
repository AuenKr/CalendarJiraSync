import { useState, useEffect, useMemo } from 'react'
import { useConfigStore } from '../store/useConfigStore'
import { syncData, getProjects, type JiraProject } from '../lib/jira'
import {
  Save,
  CheckCircle,
  ExternalLink,
  RefreshCw,
  ArrowRight,
  Layers,
  Search,
  Sparkles,
  ShieldCheck,
} from 'lucide-react'

function App() {
  const { jiraDomain, email, apiToken, setConfig, projects, setProjects, selectedProjectKeys, toggleProject } = useConfigStore()
  const [formData, setFormData] = useState({ jiraDomain, email, apiToken })
  const [step, setStep] = useState(1)
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState('')
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [suggestion, setSuggestion] = useState('')

  useEffect(() => {
    setFormData({ jiraDomain, email, apiToken })
  }, [jiraDomain, email, apiToken])

  const handleDomainChange = (val: string) => {
    setFormData({ ...formData, jiraDomain: val })

    const clean = val.trim().toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]

    if (clean && !clean.includes('.') && clean.length > 1) {
      setSuggestion(`${clean}.atlassian.net`)
    } else {
      setSuggestion('')
    }
  }

  const applySuggestion = () => {
    setFormData({ ...formData, jiraDomain: suggestion })
    setSuggestion('')
  }

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!formData.jiraDomain.trim()) {
      setError('Jira Domain Url is required')
      return
    }

    let domain = formData.jiraDomain.trim().toLowerCase()
    domain = domain.replace(/^https?:\/\//, '')
    domain = domain.replace(/^www\./, '')
    domain = domain.split('/')[0]

    if (!domain.includes('.')) {
      domain = `${domain}.atlassian.net`
    }

    const cleanedConfig = { ...formData, jiraDomain: domain }
    setFormData(cleanedConfig)
    setConfig(cleanedConfig)

    setLoadingProjects(true)
    try {
      const fetchedProjects = await getProjects()
      setProjects(fetchedProjects)
      setStep(2)
    } catch (err) {
      console.error(err)
      setError('Failed to connect to Jira. Please check your credentials.')
    } finally {
      setLoadingProjects(false)
    }
  }

  const handleFinalSync = async () => {
    setSyncing(true)
    setSyncStatus('Syncing tasks from selected spaces...')
    try {
      const result = await syncData()
      setSyncStatus(`Synced ${result.count} tasks successfully!`)
      setTimeout(() => {
        window.close()
      }, 2000)
    } catch (error) {
      console.error(error)
      setSyncStatus('Failed to sync tasks.')
    } finally {
      setSyncing(false)
    }
  }

  const filteredProjects = useMemo(() => {
    return projects
      .filter((p: JiraProject) =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.key.toLowerCase().includes(searchQuery.toLowerCase()),
      )
      .sort((a: JiraProject, b: JiraProject) => {
        const aSelected = selectedProjectKeys.includes(a.key)
        const bSelected = selectedProjectKeys.includes(b.key)
        if (aSelected && !bSelected) return -1
        if (!aSelected && bSelected) return 1
        return a.name.localeCompare(b.name)
      })
  }, [projects, searchQuery, selectedProjectKeys])

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f3efe8] px-4 py-10 text-[#141b27] transition-colors dark:bg-[#111722] dark:text-[#e9edf6] sm:px-8">
      <div className="pointer-events-none absolute -right-24 -top-16 h-64 w-64 rounded-full bg-[#d9e7ff] blur-3xl dark:bg-[#1e3046]" />
      <div className="pointer-events-none absolute -left-20 bottom-10 h-56 w-56 rounded-full bg-[#f9d9c4] blur-3xl dark:bg-[#3a2a24]" />

      <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-6 lg:grid lg:grid-cols-[1.1fr,1fr]">
        <section className="rounded-[2rem] border border-[#d8d0c4] bg-[#fbf8f2]/95 p-7 shadow-[0_20px_60px_-35px_rgba(20,27,39,0.45)] transition-colors dark:border-[#2a3447] dark:bg-[#171e2b]/95 dark:shadow-[0_20px_60px_-35px_rgba(0,0,0,0.9)] sm:p-10">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#d5ccbf] bg-[#f2ece3] px-3 py-1 text-xs font-semibold tracking-[0.15em] text-[#475066] uppercase transition-colors dark:border-[#2d384d] dark:bg-[#1c2433] dark:text-[#9fb2cd]">
            <Sparkles size={12} />
            Setup
          </p>
          <h1 className="mb-4 text-4xl leading-tight [font-family:'Iowan_Old_Style','Palatino_Linotype','Book_Antiqua',serif]">
            Set your Jira sync
            <br />
            once. Worklogs stay current.
          </h1>
          <p className="max-w-xl text-sm leading-6 text-[#455066] [font-family:'Avenir_Next','Segoe_UI','Helvetica_Neue',sans-serif] dark:text-[#acb9cc]">
            Connect your Jira workspace, choose the projects your team actually tracks, and let this extension keep your
            calendar workflow in sync without manual cleanup.
          </p>

          <div className="mt-8 grid gap-3 text-sm text-[#2a3448] dark:text-[#d4deeb] sm:grid-cols-2">
            <div className="rounded-2xl border border-[#ddd4c8] bg-[#f7f2ea] p-4 transition-colors dark:border-[#2f3b51] dark:bg-[#1c2434]">
              <p className="mb-1 font-semibold">Step 1</p>
              <p className="text-[#5f6778] dark:text-[#9eacc1]">Connect your Jira credentials securely.</p>
            </div>
            <div className="rounded-2xl border border-[#ddd4c8] bg-[#f7f2ea] p-4 transition-colors dark:border-[#2f3b51] dark:bg-[#1c2434]">
              <p className="mb-1 font-semibold">Step 2</p>
              <p className="text-[#5f6778] dark:text-[#9eacc1]">Pick the projects that should sync.</p>
            </div>
          </div>

          <div className="mt-8 flex items-start gap-3 rounded-2xl border border-[#d6cec1] bg-white/80 p-4 text-sm text-[#475066] transition-colors dark:border-[#2c394f] dark:bg-[#1a2333]/80 dark:text-[#acb9cc]">
            <ShieldCheck className="mt-0.5 text-[#1d5d8c] dark:text-[#7eb6e3]" size={18} />
            <p>Credentials are saved in extension storage and used only for authenticated Jira requests.</p>
          </div>
        </section>

        <section className="rounded-[2rem] border border-[#d8d0c4] bg-white/95 p-6 shadow-[0_20px_60px_-35px_rgba(20,27,39,0.45)] transition-colors dark:border-[#2a3447] dark:bg-[#171e2b]/95 dark:shadow-[0_20px_60px_-35px_rgba(0,0,0,0.9)] sm:p-8">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-[0.15em] text-[#5f6778] uppercase dark:text-[#9fb0c7]">
                {step === 1 ? 'Credentials' : 'Projects'}
              </p>
              <h2 className="text-xl leading-tight [font-family:'Iowan_Old_Style','Palatino_Linotype','Book_Antiqua',serif]">
                {step === 1 ? 'Connect to Jira' : 'Select sync scope'}
              </h2>
            </div>
            <span className="rounded-full border border-[#d6cec1] bg-[#f7f2ea] px-3 py-1 text-xs font-semibold text-[#435066] transition-colors dark:border-[#2f3b51] dark:bg-[#1d2636] dark:text-[#a8b8ce]">
              Step {step} / 2
            </span>
          </div>

          {step === 1 && (
            <form onSubmit={handleCredentialsSubmit} className="space-y-5">
              <div>
                <label className="mb-2 block text-sm font-semibold text-[#2b3445] dark:text-[#dbe4f2]">Jira domain</label>
                <div className="relative">
                  <input
                    type="text"
                    value={formData.jiraDomain}
                    onChange={(e) => handleDomainChange(e.target.value)}
                    placeholder="your-company.atlassian.net"
                    className={`w-full border border-[#d7cebf] bg-[#faf7f1] px-4 py-2.5 text-sm text-[#182234] outline-none transition placeholder:text-[#8a90a0] focus:border-[#1d5d8c] focus:bg-white dark:border-[#34425b] dark:bg-[#121927] dark:text-[#e7edf8] dark:placeholder:text-[#76849b] dark:focus:border-[#7eb6e3] dark:focus:bg-[#182235] ${suggestion ? 'rounded-t-xl border-b-0' : 'rounded-xl'}`}
                    required
                  />
                  {suggestion && (
                    <button
                      type="button"
                      onClick={applySuggestion}
                      className="absolute top-full left-0 z-10 w-full rounded-b-xl border border-[#d7cebf] bg-[#f5f0e8] px-4 py-2 text-left text-sm text-[#455066] transition hover:bg-[#eee7dc] dark:border-[#34425b] dark:bg-[#1a2333] dark:text-[#b5c2d5] dark:hover:bg-[#202b3f]"
                    >
                      Did you mean <span className="font-semibold text-[#1d5d8c] dark:text-[#7eb6e3]">{suggestion}</span>?
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-[#2b3445] dark:text-[#dbe4f2]">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="you@company.com"
                  className="w-full rounded-xl border border-[#d7cebf] bg-[#faf7f1] px-4 py-2.5 text-sm text-[#182234] outline-none transition placeholder:text-[#8a90a0] focus:border-[#1d5d8c] focus:bg-white dark:border-[#34425b] dark:bg-[#121927] dark:text-[#e7edf8] dark:placeholder:text-[#76849b] dark:focus:border-[#7eb6e3] dark:focus:bg-[#182235]"
                  required
                />
              </div>

              <div>
                <label className="mb-2 flex items-center justify-between text-sm font-semibold text-[#2b3445] dark:text-[#dbe4f2]">
                  API token
                  <a
                    href="https://id.atlassian.com/manage-profile/security/api-tokens"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-[#1d5d8c] hover:text-[#144a70] dark:text-[#7eb6e3] dark:hover:text-[#9ec9ea]"
                  >
                    Create token <ExternalLink size={12} />
                  </a>
                </label>
                <input
                  type="password"
                  value={formData.apiToken}
                  onChange={(e) => setFormData({ ...formData, apiToken: e.target.value })}
                  placeholder="Paste token"
                  className="w-full rounded-xl border border-[#d7cebf] bg-[#faf7f1] px-4 py-2.5 text-sm text-[#182234] outline-none transition placeholder:text-[#8a90a0] focus:border-[#1d5d8c] focus:bg-white dark:border-[#34425b] dark:bg-[#121927] dark:text-[#e7edf8] dark:placeholder:text-[#76849b] dark:focus:border-[#7eb6e3] dark:focus:bg-[#182235]"
                  required
                />
              </div>

              {error && (
                <p className="rounded-xl border border-[#e4bbb2] bg-[#fff0ee] px-3 py-2 text-sm text-[#9e2f24] dark:border-[#5d3134] dark:bg-[#3a2328] dark:text-[#f0a8a1]">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loadingProjects}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1d5d8c] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#174e74] dark:bg-[#2a6f9f] dark:hover:bg-[#357fb4] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loadingProjects ? <RefreshCw size={18} className="animate-spin" /> : <ArrowRight size={18} />}
                {loadingProjects ? 'Verifying Jira access...' : 'Continue to project selection'}
              </button>
            </form>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-[#2b3445] dark:text-[#dbe4f2]">
                  <Layers size={16} className="text-[#1d5d8c] dark:text-[#7eb6e3]" />
                  Project list
                </h3>
                <span className="rounded-full bg-[#f1ebe2] px-2.5 py-1 text-xs font-medium text-[#546074] transition-colors dark:bg-[#1e293d] dark:text-[#a4b4cb]">
                  {selectedProjectKeys.length} selected
                </span>
              </div>

              <div className="relative">
                <Search className="absolute top-1/2 left-3 -translate-y-1/2 text-[#758099] dark:text-[#7f8da4]" size={15} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by project name or key"
                  className="w-full rounded-xl border border-[#d7cebf] bg-[#faf7f1] py-2.5 pr-3 pl-9 text-sm text-[#182234] outline-none transition placeholder:text-[#8a90a0] focus:border-[#1d5d8c] focus:bg-white dark:border-[#34425b] dark:bg-[#121927] dark:text-[#e7edf8] dark:placeholder:text-[#76849b] dark:focus:border-[#7eb6e3] dark:focus:bg-[#182235]"
                />
              </div>

              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {filteredProjects.length === 0 && (
                  <p className="rounded-xl border border-dashed border-[#d7cebf] bg-[#f8f4ee] py-6 text-center text-sm text-[#677086] transition-colors dark:border-[#34425b] dark:bg-[#121927] dark:text-[#90a0b7]">
                    No matching projects
                  </p>
                )}
                {filteredProjects.map((project: JiraProject) => {
                  const isSelected = selectedProjectKeys.includes(project.key)

                  return (
                    <button
                      key={project.key}
                      type="button"
                      onClick={() => toggleProject(project.key)}
                      className={`flex w-full items-center justify-between rounded-xl border p-3 text-left transition ${
                        isSelected
                          ? 'border-[#8db2cd] bg-[#edf5fb] dark:border-[#3f6c8c] dark:bg-[#1d2f44]'
                          : 'border-[#ddd4c8] bg-[#faf7f2] hover:border-[#b9b09f] hover:bg-[#f4eee5] dark:border-[#34425b] dark:bg-[#121927] dark:hover:border-[#465778] dark:hover:bg-[#1a2333]'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {project.avatarUrls?.['24x24'] && (
                          <img src={project.avatarUrls['24x24']} alt="" className="h-6 w-6 rounded" />
                        )}
                        <div>
                          <p className="text-sm font-semibold text-[#1c2536] dark:text-[#dce5f2]">{project.name}</p>
                          <p className="text-xs text-[#6a7386] dark:text-[#90a0b7]">{project.key}</p>
                        </div>
                      </div>
                      {isSelected && <CheckCircle size={18} className="text-[#1d5d8c] dark:text-[#7eb6e3]" />}
                    </button>
                  )
                })}
              </div>

              <button
                onClick={handleFinalSync}
                disabled={syncing || selectedProjectKeys.length === 0}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1d5d8c] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#174e74] dark:bg-[#2a6f9f] dark:hover:bg-[#357fb4] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {syncing ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
                {syncing ? 'Syncing now...' : 'Save setup and sync tasks'}
              </button>

              {syncStatus && (
                <p
                  className={`rounded-xl border px-3 py-2 text-sm ${
                    syncStatus.includes('Failed')
                      ? 'border-[#e4bbb2] bg-[#fff0ee] text-[#9e2f24] dark:border-[#5d3134] dark:bg-[#3a2328] dark:text-[#f0a8a1]'
                      : 'border-[#b9d9c3] bg-[#effaf2] text-[#25623d] dark:border-[#2e5740] dark:bg-[#1d3127] dark:text-[#9dd2ad]'
                  }`}
                >
                  {syncStatus}
                </p>
              )}

              <button
                onClick={() => setStep(1)}
                className="w-full text-sm font-medium text-[#5e6779] transition hover:text-[#1d5d8c] dark:text-[#90a0b7] dark:hover:text-[#9ec9ea]"
              >
                Back to credentials
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

export default App
