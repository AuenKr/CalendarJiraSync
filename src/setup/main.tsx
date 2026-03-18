import ReactDOM from 'react-dom/client'
import { StrictMode } from 'react'
import { initializeTheme } from '@/lib/theme'
import App from './App'
import '../index.css'

async function bootstrap() {
  await initializeTheme()

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
