import { useState, useEffect, createContext, useContext, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

interface Company {
  id: string
  name: string
  vat_number: string | null
  pec: string | null
  sdi_code: string | null
  point_of_sale_label: string
}

interface CompanyContextValue {
  company: Company | null
  companies: Company[]
  loading: boolean
  switchCompany: (companyId: string) => Promise<void>
}

const CompanyContext = createContext<CompanyContextValue | null>(null)

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const [company, setCompany] = useState<Company | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
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
    // I tipi auto-generati da `supabase gen types` non includono ancora
    // `point_of_sale_label` (introdotta in migrazione 011). Cast minimo per
    // accedere alla colonna a runtime senza propagare `any`.
    const { data, error } = await (supabase.from('companies').select(
      'id, name, vat_number, pec, sdi_code, point_of_sale_label',
    ) as unknown as Promise<{
      data: Array<{
        id: string
        name: string
        vat_number: string | null
        pec: string | null
        sdi_code: string | null
        point_of_sale_label: string | null
      }> | null
      error: { message: string } | null
    }>)

    if (!error && data) {
      // Defensive default: per tenant pre-migrazione 011 la colonna potrebbe
      // tornare null in vecchie cache; normalizziamo a "Punto vendita".
      const normalized: Company[] = data.map((c) => ({
        id: c.id,
        name: c.name,
        vat_number: c.vat_number,
        pec: c.pec,
        sdi_code: c.sdi_code,
        point_of_sale_label: c.point_of_sale_label ?? 'Punto vendita',
      }))
      setCompanies(normalized)
      const current = normalized.find((c) => c.id === profile!.company_id) || normalized[0]
      setCompany(current)
    }
    setLoading(false)
  }

  // Switch azienda — aggiorna il profilo utente (solo super_advisor)
  async function switchCompany(companyId: string) {
    const target = companies.find(c => c.id === companyId)
    if (!target) return

    // Aggiorna company_id nel profilo utente
    const { error } = await supabase
      .from('user_profiles')
      .update({ company_id: companyId })
      .eq('id', profile!.id)

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
