import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { CompanyProvider } from './hooks/useCompany'
import { PeriodProvider } from './hooks/usePeriod'
import { useOnboardingStatus } from './hooks/useOnboardingStatus'
import { lazy, Suspense, type ReactNode } from 'react'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'

// Lazy-loaded pages — code splitting per ridurre il bundle iniziale
const Scadenzario = lazy(() => import('./pages/ScadenzarioSmart'))
const Banche = lazy(() => import('./pages/TesoreriaManuale'))
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
const MarginiOutlet = lazy(() => import('./pages/MarginiOutlet'))
const StoreManager = lazy(() => import('./pages/StoreManager'))
const ImportHub = lazy(() => import('./pages/ImportHub'))
const Fornitori = lazy(() => import('./pages/Fornitori'))
const ArchivioDocumenti = lazy(() => import('./pages/ArchivioDocumenti'))
const Onboarding = lazy(() => import('./pages/Onboarding'))
const Fatturazione = lazy(() => import('./pages/Fatturazione'))
const AcubeFatturaForm = lazy(() => import('./pages/AcubeFatturaForm'))
const ScadenzeFiscali = lazy(() => import('./pages/ScadenzeFiscali'))
const AICategoriePage = lazy(() => import('./pages/AICategoriePage'))
const BankingCallback = lazy(() => import('./pages/BankingCallback'))
const AllocazioneFornitori = lazy(() => import('./pages/AllocazioneFornitori'))
const SchedaContabileFornitore = lazy(() => import('./pages/SchedaContabileFornitore'))
const Profilo = lazy(() => import('./pages/Profilo'))

// Spinner per lazy loading
function PageLoader() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="w-8 h-8 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
    </div>
  )
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    )
  }

  return session ? <>{children}</> : <Navigate to="/login" replace />
}

/**
 * Forza il redirect a /onboarding se il tenant è vergine (nessuna company).
 * Pensato per i tenant ADR-001 appena creati: la prima persona che entra è
 * Lilian (o Patrizio super_advisor) e DEVE compilare il wizard prima di
 * poter usare il resto dell'app. Sabrina/Veronica vedono il placeholder
 * dentro Onboarding.tsx (vedi role check lì).
 */
function OnboardingGate({ children }: { children: ReactNode }) {
  const { needsOnboarding, loading } = useOnboardingStatus()
  const location = useLocation()
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    )
  }
  if (needsOnboarding && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }
  return <>{children}</>
}

function PublicRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return null
  return session ? <Navigate to="/" replace /> : <>{children}</>
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
        <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
        <Route path="/banking/callback" element={<ProtectedRoute><BankingCallback /></ProtectedRoute>} />
        <Route element={<ProtectedRoute><OnboardingGate><Layout /></OnboardingGate></ProtectedRoute>}>
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
          <Route path="margini" element={<MarginiOutlet />} />
          <Route path="margini-categoria" element={<MarginiCategoria />} />
          <Route path="store-manager" element={<StoreManager />} />
          <Route path="import-hub" element={<ImportHub />} />
          <Route path="fornitori" element={<Fornitori />} />
          <Route path="fornitori/:supplierId/scheda-contabile" element={<SchedaContabileFornitore />} />
          <Route path="allocazione-fornitori" element={<AllocazioneFornitori />} />
          <Route path="fatturazione" element={<Fatturazione />} />
          <Route path="fatturazione/nuova-acube" element={<AcubeFatturaForm />} />
          <Route path="scadenze-fiscali" element={<ScadenzeFiscali />} />
          <Route path="archivio" element={<ArchivioDocumenti />} />
          <Route path="ai-categorie" element={<AICategoriePage />} />
          <Route path="impostazioni" element={<Impostazioni />} />
          <Route path="profilo" element={<Profilo />} />
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
        <PeriodProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </PeriodProvider>
      </CompanyProvider>
    </AuthProvider>
  )
}
