import { useEffect, useMemo, useState } from 'react'
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
  Plus,
  Trash2,
} from 'lucide-react'
import type { JiraProject } from '@/lib/jira'
import { getProjects, syncData } from '@/lib/jira'
import { useConfigStore } from '@/store/useConfigStore'
import { normalizeJiraDomains, normalizeJiraDomain } from '@/lib/jiraConfig'

function App() {
  const {
    jiraDomains,
    email,
    apiToken,
    projectsByDomain,
    setConfig,
    setProjectsForDomain,
    toggleProject,
  } = useConfigStore()

  const [formData, setFormData] = useState({
    domains: jiraDomains.map(each => each.domain),
    email,
    apiToken,
  })
  const [step, setStep] = useState(1)
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState('')
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    setFormData({
      domains: jiraDomains.length > 0 ? jiraDomains.map(each => each.domain) : [''],
      email,
      apiToken,
    })
  }, [apiToken, email, jiraDomains])

  const handleDomainChange = (index: number, value: string) => {
    setFormData((prev) => {
      const nextDomains = [...prev.domains]
      nextDomains[index] = value
      return { ...prev, domains: nextDomains }
    })
  }

  const handleAddDomain = () => {
    setFormData((prev) => ({
      ...prev,
      domains: [...prev.domains, ''],
    }))
  }

  const handleRemoveDomain = (index: number) => {
    setFormData((prev) => {
      if (prev.domains.length <= 1) {
        return {
          ...prev,
          domains: [''],
        }
      }

      return {
        ...prev,
        domains: prev.domains.filter((_, eachIdx) => eachIdx !== index),
      }
    })
  }

  const selectedProjectCount = useMemo(() => {
    return jiraDomains.reduce((count, each) => count + each.selectedProjectKeys.length, 0)
  }, [jiraDomains])

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSyncStatus('')

    const normalizedDomains = normalizeJiraDomains(formData.domains)
    if (normalizedDomains.length === 0) {
      setError('At least one Jira domain is required')
      return
    }

    if (!formData.email.trim()) {
      setError('Email is required')
      return
    }

    if (!formData.apiToken.trim()) {
      setError('API token is required')
      return
    }

    setLoadingProjects(true)

    const settled = await Promise.allSettled(
      normalizedDomains.map(async (domain) => {
        const projects = await getProjects(domain, {
          email: formData.email.trim(),
          apiToken: formData.apiToken.trim(),
        })
        return { domain, projects }
      }),
    )

    const failedDomains: string[] = []
    const successful: Array<{ domain: string; projects: JiraProject[] }> = []

    for (let i = 0; i < settled.length; i++) {
      const result = settled[i]
      const domain = normalizedDomains[i]
      if (result.status === 'fulfilled') {
        successful.push(result.value)
      } else {
        failedDomains.push(domain)
      }
    }

    if (failedDomains.length > 0) {
      setLoadingProjects(false)
      setError(`Failed to validate Jira access for: ${failedDomains.join(', ')}`)
      return
    }

    setConfig({
      jiraDomains: normalizedDomains,
      email: formData.email.trim(),
      apiToken: formData.apiToken.trim(),
    })

    for (const item of successful) {
      setProjectsForDomain(item.domain, item.projects)
    }

    setLoadingProjects(false)
    setStep(2)
  }

  const handleFinalSync = async () => {
    setSyncing(true)
    setSyncStatus('Syncing tasks from configured Jira domains...')
    try {
      const result = await syncData()
      if (result.failedDomains?.length) {
        const failedSummary = result.failedDomains.map(each => each.domain).join(', ')
        setSyncStatus(`Synced ${result.count} tasks. Failed domains: ${failedSummary}`)
      } else {
        setSyncStatus(`Synced ${result.count} tasks successfully!`)
      }

      setTimeout(() => {
        window.close()
      }, 2500)
    } catch (syncError) {
      console.error(syncError)
      setSyncStatus('Failed to sync tasks.')
    } finally {
      setSyncing(false)
    }
  }

  const filteredProjectsByDomain = useMemo(() => {
    const normalizedQuery = searchQuery.toLowerCase().trim()
    const result: Record<string, JiraProject[]> = {}

    for (const domainConfig of jiraDomains) {
      const domain = domainConfig.domain
      const selectedKeys = new Set(domainConfig.selectedProjectKeys)
      const projects = projectsByDomain[domain] || []

      const filtered = projects
        .filter((project) => {
          if (!normalizedQuery) return true
          return project.name.toLowerCase().includes(normalizedQuery) || project.key.toLowerCase().includes(normalizedQuery)
        })
        .sort((a, b) => {
          const aSelected = selectedKeys.has(a.key)
          const bSelected = selectedKeys.has(b.key)
          if (aSelected && !bSelected) return -1
          if (!aSelected && bSelected) return 1
          return a.name.localeCompare(b.name)
        })

      result[domain] = filtered
    }

    return result
  }, [jiraDomains, projectsByDomain, searchQuery])

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
            Configure Jira sync
            <br />
            across domains.
          </h1>
          <p className="max-w-xl text-sm leading-6 text-[#455066] [font-family:'Avenir_Next','Segoe_UI','Helvetica_Neue',sans-serif] dark:text-[#acb9cc]">
            Add one or more Jira domains using the same account token, choose project scope per domain, and sync tasks in one flow.
          </p>

          <div className="mt-8 grid gap-3 text-sm text-[#2a3448] dark:text-[#d4deeb] sm:grid-cols-2">
            <div className="rounded-2xl border border-[#ddd4c8] bg-[#f7f2ea] p-4 transition-colors dark:border-[#2f3b51] dark:bg-[#1c2434]">
              <p className="mb-1 font-semibold">Step 1</p>
              <p className="text-[#5f6778] dark:text-[#9eacc1]">Connect credentials and validate each domain.</p>
            </div>
            <div className="rounded-2xl border border-[#ddd4c8] bg-[#f7f2ea] p-4 transition-colors dark:border-[#2f3b51] dark:bg-[#1c2434]">
              <p className="mb-1 font-semibold">Step 2</p>
              <p className="text-[#5f6778] dark:text-[#9eacc1]">Pick projects for every domain and sync.</p>
            </div>
          </div>

          <div className="mt-8 flex items-start gap-3 rounded-2xl border border-[#d6cec1] bg-white/80 p-4 text-sm text-[#475066] transition-colors dark:border-[#2c394f] dark:bg-[#1a2333]/80 dark:text-[#acb9cc]">
            <ShieldCheck className="mt-0.5 text-[#1d5d8c] dark:text-[#7eb6e3]" size={18} />
            <p>Credentials are saved in extension storage and reused securely across configured Jira domains.</p>
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
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-[#2b3445] dark:text-[#dbe4f2]">
                  Jira domains
                </label>

                {formData.domains.map((domain, index) => (
                  <div key={`${index}-${domain}`} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={domain}
                      onChange={(e) => handleDomainChange(index, e.target.value)}
                      placeholder="your-company.atlassian.net"
                      className="w-full rounded-xl border border-[#d7cebf] bg-[#faf7f1] px-4 py-2.5 text-sm text-[#182234] outline-none transition placeholder:text-[#8a90a0] focus:border-[#1d5d8c] focus:bg-white dark:border-[#34425b] dark:bg-[#121927] dark:text-[#e7edf8] dark:placeholder:text-[#76849b] dark:focus:border-[#7eb6e3] dark:focus:bg-[#182235]"
                      required={index === 0}
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveDomain(index)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#d7cebf] bg-[#faf7f1] text-[#6d778b] transition hover:border-[#c4b9a7] hover:text-[#a53e2b] dark:border-[#34425b] dark:bg-[#121927] dark:text-[#9dafc8] dark:hover:border-[#465778]"
                      title="Remove domain"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={handleAddDomain}
                  className="inline-flex items-center gap-2 rounded-xl border border-dashed border-[#c6bba8] px-3 py-2 text-xs font-semibold text-[#4d5a72] transition hover:border-[#1d5d8c] hover:text-[#1d5d8c] dark:border-[#3b4d68] dark:text-[#a6b5cc] dark:hover:border-[#7eb6e3] dark:hover:text-[#7eb6e3]"
                >
                  <Plus size={14} />
                  Add Jira domain
                </button>
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
                {loadingProjects ? 'Validating domains...' : 'Continue to project selection'}
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
                  {selectedProjectCount} selected
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

              <div className="max-h-[24rem] space-y-4 overflow-y-auto pr-1">
                {jiraDomains.map((domainConfig) => {
                  const domain = domainConfig.domain
                  const selectedKeys = new Set(domainConfig.selectedProjectKeys)
                  const filteredProjects = filteredProjectsByDomain[domain] || []

                  return (
                    <div key={domain} className="rounded-xl border border-[#ddd4c8] bg-[#faf7f2] p-3 transition-colors dark:border-[#34425b] dark:bg-[#121927]">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs font-semibold tracking-[0.06em] text-[#4c5a71] uppercase dark:text-[#9eb0c8]">
                          {normalizeJiraDomain(domain)}
                        </p>
                        <span className="text-[11px] text-[#697388] dark:text-[#8ea0b8]">
                          {selectedKeys.size} selected
                        </span>
                      </div>

                      {filteredProjects.length === 0 && (
                        <p className="rounded-xl border border-dashed border-[#d7cebf] bg-[#f8f4ee] py-3 text-center text-sm text-[#677086] transition-colors dark:border-[#34425b] dark:bg-[#182235] dark:text-[#90a0b7]">
                          No matching projects
                        </p>
                      )}

                      <div className="space-y-2">
                        {filteredProjects.map((project: JiraProject) => {
                          const isSelected = selectedKeys.has(project.key)

                          return (
                            <button
                              key={`${domain}-${project.key}`}
                              type="button"
                              onClick={() => toggleProject(domain, project.key)}
                              className={`flex w-full items-center justify-between rounded-xl border p-3 text-left transition ${
                                isSelected
                                  ? 'border-[#8db2cd] bg-[#edf5fb] dark:border-[#3f6c8c] dark:bg-[#1d2f44]'
                                  : 'border-[#ddd4c8] bg-[#faf7f1] hover:border-[#b9b09f] hover:bg-[#f4eee5] dark:border-[#34425b] dark:bg-[#121927] dark:hover:border-[#465778] dark:hover:bg-[#1a2333]'
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
                    </div>
                  )
                })}
              </div>

              <button
                onClick={handleFinalSync}
                disabled={syncing || selectedProjectCount === 0}
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
