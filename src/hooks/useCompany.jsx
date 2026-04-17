import { useState, useEffect, createContext, useContext } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

const CompanyContext = createContext(null)

export function CompanyProvider({ children }) {
  const { profile } = useAuth()
  const [company, setCompany] = useState(null)
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.company_id) {
      setLoading(false)
      return
    }
    loadCompanies()
  }, [profile?.company_id])

  async function loadCompanies() {
    setLoading(true)

    // Carica tutte le aziende accessibili all'utente (filtrate da RLS)
    const { data, error } = await supabase
      .from('companies')
      .select('id, name, vat_number, pec, sdi_code')
      .order('name')

    if (!error && data) {
      setCompanies(data)
      // Seleziona l'azienda del profilo utente come default
      const current = data.find(c => c.id === profile.company_id) || data[0]
      setCompany(current)
    }
    setLoading(false)
  }

  // Switch azienda — aggiorna il profilo utente (solo super_advisor)
  async function switchCompany(companyId) {
    const target = companies.find(c => c.id === companyId)
    if (!target) return

    // Aggiorna company_id nel profilo utente
    const { error } = await supabase
      .from('user_profiles')
      .update({ company_id: companyId })
      .eq('id', profile.id)

    if (!error) {
      setCompany(target)
      // Ricarica la pagina per aggiornare tutti i dati filtrati per company_id
      window.location.reload()
    }
  }

  return (
    <CompanyContext.Provider value={{ company, companies, loading, switchCompany }}>
      {children}
    </CompanyContext.Provider>
  )
}

export function useCompany() {
  const context = useContext(CompanyContext)
  if (!context) throw new Error('useCompany must be used within CompanyProvider')
  return context
}
