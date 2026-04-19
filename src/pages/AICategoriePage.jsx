import AICategorization from '../components/AICategorization'
import PageHelp from '../components/PageHelp'
import { useAuth } from '../hooks/useAuth'

export default function AICategoriePage() {
  const { profile } = useAuth()
  const companyId = profile?.company_id
  if (!companyId) return null
  return (
    <>
      <AICategorization companyId={companyId} />
      <PageHelp page="categorizzazione-ai" />
    </>
  )
}
