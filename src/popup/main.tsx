import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../lib/queryClient'
import '../index.css'
import App from './App.tsx'

const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

const applyTheme = (isDark: boolean) => {
  document.documentElement.classList.toggle('dark', isDark)
}

applyTheme(mediaQuery.matches)

const onSchemeChange = (event: MediaQueryListEvent) => {
  applyTheme(event.matches)
}

if (typeof mediaQuery.addEventListener === 'function') {
  mediaQuery.addEventListener('change', onSchemeChange)
} else {
  mediaQuery.addListener(onSchemeChange)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
