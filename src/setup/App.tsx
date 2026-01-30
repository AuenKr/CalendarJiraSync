import { useState, useEffect } from 'react'
import { useConfigStore } from '../store/useConfigStore'
import { syncData, getProjects, type JiraProject } from '../lib/jira'
import { Save, CheckCircle, ExternalLink, RefreshCw, ArrowRight, Layers, Search } from 'lucide-react'

function App() {
  const { jiraDomain, email, apiToken, setConfig, projects, setProjects, selectedProjectKeys, toggleProject } = useConfigStore()
  const [formData, setFormData] = useState({ jiraDomain, email, apiToken })
  const [step, setStep] = useState(1) // 1: Credentials, 2: Spaces
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
    
    // Simple heuristic for suggestion
    // Remove protocol and path first to check the core domain part
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
      setError('Jira Domain is required')
      return
    }

    // Smart URL Handling
    let domain = formData.jiraDomain.trim().toLowerCase()
    
    // Remove protocol
    domain = domain.replace(/^https?:\/\//, '')
    
    // Remove www.
    domain = domain.replace(/^www\./, '')
    
    // Remove trailing slash and paths
    domain = domain.split('/')[0]
    
    // If it doesn't have dots, assume it's the subdomain part of atlassian.net
    if (!domain.includes('.')) {
      domain = `${domain}.atlassian.net`
    }

    // Update state with cleaned domain
    const cleanedConfig = { ...formData, jiraDomain: domain }
    setFormData(cleanedConfig)
    setConfig(cleanedConfig)
    
    setLoadingProjects(true)
    try {
      // Test credentials by fetching projects
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
        window.close() // Optional: close the tab after success
      }, 2000)
    } catch (error) {
      console.error(error)
      setSyncStatus('Failed to sync tasks.')
    } finally {
      setSyncing(false)
    }
  }

  const filteredProjects = projects
    .filter((p: JiraProject) => 
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      p.key.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a: JiraProject, b: JiraProject) => {
      const aSelected = selectedProjectKeys.includes(a.key)
      const bSelected = selectedProjectKeys.includes(b.key)
      if (aSelected && !bSelected) return -1
      if (!aSelected && bSelected) return 1
      return a.name.localeCompare(b.name)
    })

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8 flex flex-col items-center justify-center">
      <div className="w-full max-w-md bg-gray-800 p-8 rounded-xl shadow-lg border border-gray-700">
        <h1 className="text-3xl font-bold mb-6 text-center bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
          Calendar Jira Sync Setup
        </h1>
        
        {step === 1 && (
          <form onSubmit={handleCredentialsSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                Jira Domain
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={formData.jiraDomain}
                  onChange={(e) => handleDomainChange(e.target.value)}
                  placeholder="your-company.atlassian.net"
                  className={`w-full bg-gray-700 border border-gray-600 px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all ${suggestion ? 'rounded-t-lg border-b-0' : 'rounded-lg'}`}
                  required
                />
                {suggestion && (
                  <div 
                    className="absolute top-full left-0 w-full bg-gray-700 border border-gray-600 rounded-b-lg shadow-lg z-10 cursor-pointer hover:bg-gray-600 transition-colors"
                    onClick={applySuggestion}
                  >
                    <div className="px-4 py-2 text-sm text-gray-300 flex items-center gap-2">
                      <span>Did you mean</span>
                      <span className="text-blue-400 font-medium">{suggestion}</span>
                      <span>?</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                Email
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="you@company.com"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2 flex justify-between items-center">
                API Token
                <a 
                  href="https://id.atlassian.com/manage-profile/security/api-tokens" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                >
                  Get Token <ExternalLink size={12} />
                </a>
              </label>
              <input
                type="password"
                value={formData.apiToken}
                onChange={(e) => setFormData({ ...formData, apiToken: e.target.value })}
                placeholder="••••••••••••••••"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                required
              />
            </div>

            {error && (
              <p className="text-red-400 text-sm text-center">{error}</p>
            )}

            <button
              type="submit"
              disabled={loadingProjects}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loadingProjects ? <RefreshCw size={20} className="animate-spin" /> : <ArrowRight size={20} />}
              {loadingProjects ? 'Connecting...' : 'Next: Select Spaces'}
            </button>
          </form>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Layers size={20} className="text-blue-400" />
                Select Spaces
              </h2>
              <span className="text-sm text-gray-400">
                {selectedProjectKeys.length} selected
              </span>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search spaces..."
                className="w-full bg-gray-700 border border-gray-600 rounded-lg pl-10 pr-4 py-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm"
              />
            </div>

            <div className="max-h-60 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
              {filteredProjects.length === 0 && (
                <p className="text-center text-gray-500 text-sm py-4">No spaces found</p>
              )}
              {filteredProjects.map((project: JiraProject) => (
                <div 
                  key={project.key}
                  onClick={() => toggleProject(project.key)}
                  className={`p-3 rounded-lg border cursor-pointer transition-all flex items-center justify-between ${
                    selectedProjectKeys.includes(project.key)
                      ? 'bg-blue-900/30 border-blue-500/50'
                      : 'bg-gray-700/30 border-gray-700 hover:bg-gray-700/50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {project.avatarUrls?.['24x24'] && (
                      <img src={project.avatarUrls['24x24']} alt="" className="w-6 h-6 rounded" />
                    )}
                    <div>
                      <p className="font-medium text-sm">{project.name}</p>
                      <p className="text-xs text-gray-400">{project.key}</p>
                    </div>
                  </div>
                  {selectedProjectKeys.includes(project.key) && (
                    <CheckCircle size={18} className="text-blue-400" />
                  )}
                </div>
              ))}
            </div>

            <button
              onClick={handleFinalSync}
              disabled={syncing || selectedProjectKeys.length === 0}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {syncing ? <RefreshCw size={20} className="animate-spin" /> : <Save size={20} />}
              {syncing ? 'Syncing...' : 'Finish & Sync'}
            </button>

            {syncStatus && (
              <p className={`text-center text-sm ${syncStatus.includes('Failed') ? 'text-red-400' : 'text-green-400'}`}>
                {syncStatus}
              </p>
            )}
            
            <button 
              onClick={() => setStep(1)}
              className="w-full text-gray-400 hover:text-white text-sm mt-2"
            >
              Back to Credentials
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
