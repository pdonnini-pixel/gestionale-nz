import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Scadenzario from './pages/Scadenzario'

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
        <Route path="outlet" element={<Placeholder title="Outlet" />} />
        <Route path="scadenzario" element={<Scadenzario />} />
        <Route path="banche" element={<Placeholder title="Banche" />} />
        <Route path="dipendenti" element={<Placeholder title="Dipendenti" />} />
        <Route path="contratti" element={<Placeholder title="Contratti" />} />
        <Route path="importazioni" element={<Placeholder title="Importazioni" />} />
        <Route path="impostazioni" element={<Placeholder title="Impostazioni" />} />
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
