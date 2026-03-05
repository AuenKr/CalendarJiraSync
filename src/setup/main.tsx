import ReactDOM from 'react-dom/client'
import { StrictMode } from 'react'
import App from './App'
import '../index.css'

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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
