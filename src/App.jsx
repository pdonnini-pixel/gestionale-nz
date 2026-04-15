import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Scadenzario from './pages/ScadenzarioSmart'
import Banche from './pages/Banche'
import Outlet from './pages/Outlet'
import Dipendenti from './pages/Dipendenti'
import Impostazioni from './pages/Impostazioni'
import ContoEconomico from './pages/ContoEconomico'
import ConfrontoOutlet from './pages/ConfrontoOutlet'
import BudgetControl from './pages/BudgetControl'
import StockSellthrough from './pages/StockSellthrough'
import AnalyticsPOS from './pages/AnalyticsPOS'
import CashFlow from './pages/CashflowProspettico'
import OpenToBuy from './pages/OpenToBuy'
import Produttivita from './pages/Produttivita'
import ScenarioPlanning from './pages/ScenarioPlanning'
import MarginiCategoria from './pages/MarginiCategoria'
import StoreManager from './pages/StoreManager'
import ImportHub from './pages/ImportHub'
import Fornitori from './pages/Fornitori'

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

// Pagine placeholder per le sezioni future
function Placeholder({ title }) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      <p className="text-slate-500 mt-2">Questa sezione sara disponibile prossimamente.</p>
    </div>
  )
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
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
        <Route path="impostazioni" element={<Impostazioni />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
