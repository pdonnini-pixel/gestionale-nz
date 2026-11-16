import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { Capacitor } from '@capacitor/core'
import { getCurrentTenant } from './lib/tenants'
import { applicaMarchioTenant } from './lib/tenantBranding'

// App New Zago degli store: si apre sull'app del dipendente, non sul
// gestionale (capacitor.config.ts, APP_NATIVA_NOTES.md).
if (Capacitor.isNativePlatform() && !window.location.pathname.startsWith('/app')) {
  window.history.replaceState(null, '', '/app')
}

// Nome e icona della scheda del tenant attivo (New Zago, Zago...).
applicaMarchioTenant(getCurrentTenant())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
