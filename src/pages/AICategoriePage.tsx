import AICategorization from '../components/AICategorization'
import PageHelp from '../components/PageHelp'
import { useAuth } from '../hooks/useAuth'

export default function AICategoriePage() {
  const { profile } = useAuth()
  const companyId = profile?.company_id
  if (!companyId) return null
  return (
    <div className="min-h-screen bg-white">
      <div className="p-4 sm:p-6 space-y-6 max-w-[1600px] mx-auto">
        <AICategorization companyId={companyId} />
        <PageHelp page="categorizzazione-ai" />
      </div>
    </div>
  )
}
