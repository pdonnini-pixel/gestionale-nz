import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { CompanyProvider } from './hooks/useCompany'
import { lazy, Suspense } from 'react'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'

// Lazy-loaded pages — code splitting per ridurre il bundle iniziale
const Scadenzario = lazy(() => import('./pages/ScadenzarioSmart'))
const Banche = lazy(() => import('./pages/Banche'))
const Outlet = lazy(() => import('./pages/Outlet'))
const Dipendenti = lazy(() => import('./pages/Dipendenti'))
const Impostazioni = lazy(() => import('./pages/Impostazioni'))
const ContoEconomico = lazy(() => import('./pages/ContoEconomico'))
const ConfrontoOutlet = lazy(() => import('./pages/ConfrontoOutlet'))
const BudgetControl = lazy(() => import('./pages/BudgetControl'))
const StockSellthrough = lazy(() => import('./pages/StockSellthrough'))
const AnalyticsPOS = lazy(() => import('./pages/AnalyticsPOS'))
const CashFlow = lazy(() => import('./pages/CashflowProspettico'))
const OpenToBuy = lazy(() => import('./pages/OpenToBuy'))
const Produttivita = lazy(() => import('./pages/Produttivita'))
const ScenarioPlanning = lazy(() => import('./pages/ScenarioPlanning'))
const MarginiCategoria = lazy(() => import('./pages/MarginiCategoria'))
const StoreManager = lazy(() => import('./pages/StoreManager'))
const ImportHub = lazy(() => import('./pages/ImportHub'))
const Fornitori = lazy(() => import('./pages/Fornitori'))
const ArchivioDocumenti = lazy(() => import('./pages/ArchivioDocumenti'))
const Onboarding = lazy(() => import('./pages/Onboarding'))
const Fatturazione = lazy(() => import('./pages/Fatturazione'))
const ScadenzeFiscali = lazy(() => import('./pages/ScadenzeFiscali'))

// Spinner per lazy loading
function PageLoader() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="w-8 h-8 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
    </div>
  )
}

function ProtectedRoute({ children }) {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    )
  }

  return session ? children : <Navigate to="/login" replace />
}

function PublicRoute({ children }) {
  const { session, loading } = useAuth()
  if (loading) return null
  return session ? <Navigate to="/" replace /> : children
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
        <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="outlet" element={<Outlet />} />
          <Route path="scadenzario" element={<Scadenzario />} />
          <Route path="banche" element={<Banche />} />
          <Route path="dipendenti" element={<Dipendenti />} />
          <Route path="conto-economico" element={<ContoEconomico />} />
          <Route path="confronto-outlet" element={<ConfrontoOutlet />} />
          <Route path="budget" element={<BudgetControl />} />
          <Route path="stock" element={<StockSellthrough />} />
          <Route path="analytics-pos" element={<AnalyticsPOS />} />
          <Route path="cash-flow" element={<CashFlow />} />
          <Route path="open-to-buy" element={<OpenToBuy />} />
          <Route path="produttivita" element={<Produttivita />} />
          <Route path="scenario" element={<ScenarioPlanning />} />
          <Route path="margini" element={<MarginiCategoria />} />
          <Route path="store-manager" element={<StoreManager />} />
          <Route path="import-hub" element={<ImportHub />} />
          <Route path="fornitori" element={<Fornitori />} />
          <Route path="fatturazione" element={<Fatturazione />} />
          <Route path="scadenze-fiscali" element={<ScadenzeFiscali />} />
          <Route path="archivio" element={<ArchivioDocumenti />} />
          <Route path="impostazioni" element={<Impostazioni />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <CompanyProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </CompanyProvider>
    </AuthProvider>
  )
}
