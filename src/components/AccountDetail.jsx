import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid
} from 'recharts'
import {
  X, RefreshCw, ArrowUpRight, ArrowDownLeft, Search,
  Filter, Calendar, CheckCircle2, Link2, Loader2, ChevronDown
} from 'lucide-react'

const PAGE_SIZE = 50

function fmt(n, dec = 2) {
  if (n == null) return '—'
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec
  }).format(n)
}

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('it-IT')
}

function timeAgo(dateStr) {
  if (!dateStr) return 'Mai sincronizzato'
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now - date
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'Adesso'
  if (diffMin < 60) return `${diffMin}min fa`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h fa`
  const diffD = Math.floor(diffH / 24)
  return `${diffD}g fa`
}

/* ═══════ Reconciliation Modal ═══════ */
function ReconciliationModal({ isOpen, onClose, transaction, onReconcile }) {
  const [invoices, setInvoices] = useState([])
  const [loadingInvoices, setLoadingInvoices] = useState(false)
  const [searchInvoice, setSearchInvoice] = useState('')
  const [reconciling, setReconciling] = useState(false)

  useEffect(() => {
    if (isOpen && transaction) {
      loadMatchingInvoices()
    }
  }, [isOpen, transaction])

  const loadMatchingInvoices = async () => {
    if (!transaction) return
    setLoadingInvoices(true)
    try {
      const txAmount = Math.abs(transaction.amount || 0)
      const tolerance = txAmount * 0.05 // ±5%
      const minAmt = txAmount - tolerance
      const maxAmt = txAmount + tolerance

      // Find invoices within ±5% amount and ±30 days
      const txDate = new Date(transaction.transaction_date)
      const dateMin = new Date(txDate)
      dateMin.setDate(dateMin.getDate() - 30)
      const dateMax = new Date(txDate)
      dateMax.setDate(dateMax.getDate() + 30)

      const { data } = await supabase
        .from('electronic_invoices')
        .select('id, invoice_number, supplier_name, supplier_vat, gross_amount, invoice_date, sdi_status')
        .eq('company_id', transaction.company_id)
        .gte('gross_amount', minAmt)
        .lte('gross_amount', maxAmt)
        .gte('invoice_date', dateMin.toISOString().slice(0, 10))
        .lte('invoice_date', dateMax.toISOString().slice(0, 10))
        .order('invoice_date', { ascending: false })
        .limit(20)

      setInvoices(data || [])
    } catch (err) {
      console.error('[ReconciliationModal] Error:', err)
    } finally {
      setLoadingInvoices(false)
    }
  }

  const handleReconcile = async (invoice) => {
    setReconciling(true)
    try {
      const { error } = await supabase
        .from('bank_transactions')
        .update({
          is_reconciled: true,
          reconciled_invoice_id: invoice.id,
        })
        .eq('id', transaction.id)

      if (!error) {
        onReconcile(transaction.id, invoice)
        onClose()
      }
    } catch (err) {
      console.error('[ReconciliationModal] Reconcile error:', err)
    } finally {
      setReconciling(false)
    }
  }

  if (!isOpen || !transaction) return null

  const filtered = invoices.filter(inv =>
    !searchInvoice ||
    (inv.supplier_name || '').toLowerCase().includes(searchInvoice.toLowerCase()) ||
    (inv.invoice_number || '').toLowerCase().includes(searchInvoice.toLowerCase())
  )

  // Best match: exact amount closest date
  const txAmount = Math.abs(transaction.amount || 0)
  const bestMatch = filtered.length > 0
    ? filtered.reduce((best, inv) => {
        const diff = Math.abs(inv.gross_amount - txAmount)
        const bestDiff = Math.abs(best.gross_amount - txAmount)
        return diff < bestDiff ? inv : best
      })
    : null

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full mx-4 max-h-[70vh] flex flex-col">
        <div className="p-5 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-gray-900">Riconcilia movimento</h3>
              <p className="text-xs text-gray-500 mt-1">
                {formatDate(transaction.transaction_date)} · {transaction.description?.slice(0, 40)}... · {fmt(Math.abs(transaction.amount))} €
              </p>
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>
          <div className="mt-3 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Cerca fornitore o numero fattura..."
              value={searchInvoice}
              onChange={e => setSearchInvoice(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loadingInvoices ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
              <span className="ml-2 text-sm text-gray-500">Cercando fatture corrispondenti...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-400">
              Nessuna fattura con importo simile (±5%) e data vicina (±30gg)
            </div>
          ) : (
            <div className="space-y-1.5">
              {filtered.map(inv => {
                const isBest = bestMatch && bestMatch.id === inv.id
                return (
                  <button
                    key={inv.id}
                    onClick={() => handleReconcile(inv)}
                    disabled={reconciling}
                    className={`w-full text-left p-3 rounded-xl border transition hover:shadow-sm disabled:opacity-50 ${
                      isBest
                        ? 'border-blue-300 bg-blue-50/50 hover:bg-blue-50'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-800 truncate">
                            {inv.supplier_name || 'Fornitore sconosciuto'}
                          </span>
                          {isBest && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">
                              Suggerito
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          N. {inv.invoice_number || '—'} · {formatDate(inv.invoice_date)}
                        </div>
                      </div>
                      <div className="text-right ml-3">
                        <div className="text-sm font-semibold text-gray-900">{fmt(inv.gross_amount)} €</div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function AccountDetail({ isOpen, onClose, account, onSync }) {
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(0)
  const [reconcileTransaction, setReconcileTransaction] = useState(null)

  // Filters
  const [searchText, setSearchText] = useState('')
  const [typeFilter, setTypeFilter] = useState('all') // all, credit, debit
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Reset state when account changes
  useEffect(() => {
    if (account && isOpen) {
      setTransactions([])
      setPage(0)
      setHasMore(true)
      setSearchText('')
      setTypeFilter('all')
      setDateFrom('')
      setDateTo('')
      loadTransactions(0, true)
    }
  }, [account?.id, isOpen])

  const loadTransactions = useCallback(async (pageNum = 0, reset = false) => {
    if (!account) return
    setLoading(true)

    try {
      let query = supabase
        .from('bank_transactions')
        .select('*')
        .eq('account_id', account.id)
        .order('transaction_date', { ascending: false })
        .range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1)

      if (searchText.trim()) {
        query = query.ilike('description', `%${searchText.trim()}%`)
      }
      if (typeFilter === 'credit') {
        query = query.eq('transaction_type', 'CREDIT')
      } else if (typeFilter === 'debit') {
        query = query.eq('transaction_type', 'DEBIT')
      }
      if (dateFrom) {
        query = query.gte('transaction_date', dateFrom)
      }
      if (dateTo) {
        query = query.lte('transaction_date', dateTo)
      }

      const { data, error } = await query

      if (error) {
        console.error('[AccountDetail] Errore caricamento transazioni:', error)
        return
      }

      if (reset) {
        setTransactions(data || [])
      } else {
        setTransactions(prev => [...prev, ...(data || [])])
      }
      setHasMore((data || []).length === PAGE_SIZE)
      setPage(pageNum)
    } finally {
      setLoading(false)
    }
  }, [account, searchText, typeFilter, dateFrom, dateTo])

  // Reload when filters change
  useEffect(() => {
    if (account && isOpen) {
      const timeout = setTimeout(() => {
        loadTransactions(0, true)
      }, 300)
      return () => clearTimeout(timeout)
    }
  }, [searchText, typeFilter, dateFrom, dateTo])

  const handleLoadMore = () => {
    loadTransactions(page + 1, false)
  }

  const handleSync = async () => {
    if (!onSync || !account) return
    setSyncing(true)
    try {
      await onSync(account.id)
    } finally {
      setSyncing(false)
    }
  }

  // Compute chart data: last 30 days aggregated
  const chartData = useMemo(() => {
    if (!transactions.length) return []

    const now = new Date()
    const thirtyDaysAgo = new Date(now)
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    // Initialize all 30 days
    const dayMap = {}
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo)
      d.setDate(d.getDate() + i)
      const key = d.toISOString().slice(0, 10)
      dayMap[key] = { date: key, entrate: 0, uscite: 0, saldo: 0 }
    }

    // Aggregate transactions into days
    const relevantTxns = transactions.filter(t => {
      const txDate = new Date(t.transaction_date)
      return txDate >= thirtyDaysAgo && txDate <= now
    })

    relevantTxns.forEach(t => {
      const key = t.transaction_date?.slice(0, 10)
      if (dayMap[key]) {
        const amount = Math.abs(t.amount || 0)
        if (t.transaction_type === 'CREDIT') {
          dayMap[key].entrate += amount
        } else {
          dayMap[key].uscite += amount
        }
      }
    })

    // Compute running balance (start from current balance and work backwards)
    const days = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date))
    let runningBalance = account?.balance || 0

    // Calculate total net from today back to the chart start to find starting balance
    const totalNet = relevantTxns.reduce((sum, t) => {
      if (t.transaction_type === 'CREDIT') return sum + Math.abs(t.amount || 0)
      return sum - Math.abs(t.amount || 0)
    }, 0)

    let bal = runningBalance - totalNet
    days.forEach(day => {
      bal += day.entrate - day.uscite
      day.saldo = Math.round(bal * 100) / 100
      day.entrate = Math.round(day.entrate * 100) / 100
      day.uscite = Math.round(day.uscite * 100) / 100
    })

    return days
  }, [transactions, account?.balance])

  // Prevent scroll on body when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  if (!account) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 z-50 h-full bg-white shadow-2xl
          w-full md:w-4/5 lg:w-3/4 xl:w-2/3
          transform transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
          flex flex-col overflow-hidden`}
      >
        {/* Header */}
        <div className="flex-shrink-0 border-b border-gray-200 bg-white px-6 py-5">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold text-gray-900 truncate">
                  {account.account_name || 'Conto bancario'}
                </h2>
                {account.institution_id && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                    <Link2 className="w-3 h-3" />
                    {account.institution_id}
                  </span>
                )}
              </div>
              {account.iban && (
                <p className="mt-1 text-sm text-gray-500 font-mono tracking-wide">
                  {account.iban}
                </p>
              )}
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-gray-900">
                  {fmt(account.balance)}
                </span>
                <span className="text-lg text-gray-500">
                  {account.currency || 'EUR'}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                Ultima sync: {timeAgo(account.last_synced_at || account.balance_updated_at)}
              </p>
            </div>

            <div className="flex items-center gap-2 ml-4">
              <button
                onClick={handleSync}
                disabled={syncing}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg
                  bg-blue-600 text-white text-sm font-medium
                  hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed
                  transition-colors"
              >
                {syncing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                Sync Ora
              </button>
              <button
                onClick={onClose}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Chart Section */}
          <div className="px-6 py-5 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              Cashflow ultimi 30 giorni
            </h3>
            <div className="h-56 w-full">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: '#9ca3af' }}
                      tickFormatter={(val) => {
                        const d = new Date(val)
                        return `${d.getDate()}/${d.getMonth() + 1}`
                      }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      yAxisId="bars"
                      tick={{ fontSize: 11, fill: '#9ca3af' }}
                      tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
                      width={50}
                    />
                    <YAxis
                      yAxisId="line"
                      orientation="right"
                      tick={{ fontSize: 11, fill: '#9ca3af' }}
                      tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
                      width={55}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '8px',
                        border: '1px solid #e5e7eb',
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                      }}
                      formatter={(value, name) => {
                        const labels = { entrate: 'Entrate', uscite: 'Uscite', saldo: 'Saldo' }
                        return [`${fmt(value)} €`, labels[name] || name]
                      }}
                      labelFormatter={(label) => formatDate(label)}
                    />
                    <Bar
                      yAxisId="bars"
                      dataKey="entrate"
                      fill="#10b981"
                      opacity={0.8}
                      radius={[2, 2, 0, 0]}
                      barSize={8}
                    />
                    <Bar
                      yAxisId="bars"
                      dataKey="uscite"
                      fill="#ef4444"
                      opacity={0.8}
                      radius={[2, 2, 0, 0]}
                      barSize={8}
                    />
                    <Line
                      yAxisId="line"
                      type="monotone"
                      dataKey="saldo"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: '#3b82f6' }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                  {loading ? 'Caricamento...' : 'Nessun dato disponibile per il grafico'}
                </div>
              )}
            </div>
          </div>

          {/* Filters */}
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
            <div className="flex flex-wrap items-center gap-3">
              {/* Search */}
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Cerca descrizione..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg
                    focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400
                    bg-white placeholder-gray-400"
                />
              </div>

              {/* Type filter */}
              <div className="relative">
                <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="pl-9 pr-8 py-2 text-sm border border-gray-200 rounded-lg
                    focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400
                    bg-white appearance-none cursor-pointer"
                >
                  <option value="all">Tutti</option>
                  <option value="credit">Entrate</option>
                  <option value="debit">Uscite</option>
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>

              {/* Date From */}
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  placeholder="Da"
                  className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg
                    focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400
                    bg-white"
                />
              </div>

              {/* Date To */}
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  placeholder="A"
                  className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg
                    focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400
                    bg-white"
                />
              </div>
            </div>
          </div>

          {/* Transactions Table */}
          <div className="px-6 py-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Data
                    </th>
                    <th className="text-left py-3 px-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Descrizione
                    </th>
                    <th className="text-right py-3 px-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Importo
                    </th>
                    <th className="text-right py-3 px-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Saldo
                    </th>
                    <th className="text-center py-3 px-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Stato
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {transactions.map((tx) => {
                    const isCredit = tx.transaction_type === 'CREDIT'
                    const amount = tx.amount != null ? Math.abs(tx.amount) : null
                    const displayAmount = isCredit ? amount : (amount != null ? -amount : null)

                    return (
                      <tr
                        key={tx.id}
                        className="hover:bg-gray-50/50 transition-colors"
                      >
                        <td className="py-3 px-2 whitespace-nowrap text-gray-600">
                          {formatDate(tx.transaction_date)}
                        </td>
                        <td className="py-3 px-2 max-w-xs">
                          <div className="flex items-center gap-2">
                            <span className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
                              isCredit ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'
                            }`}>
                              {isCredit ? (
                                <ArrowDownLeft className="w-3.5 h-3.5" />
                              ) : (
                                <ArrowUpRight className="w-3.5 h-3.5" />
                              )}
                            </span>
                            <span className="truncate text-gray-800">
                              {tx.description || '—'}
                            </span>
                          </div>
                        </td>
                        <td className={`py-3 px-2 text-right whitespace-nowrap font-medium ${
                          isCredit ? 'text-emerald-600' : 'text-red-500'
                        }`}>
                          {isCredit ? '+' : ''}{fmt(displayAmount)} €
                        </td>
                        <td className="py-3 px-2 text-right whitespace-nowrap text-gray-600">
                          {tx.running_balance != null ? `${fmt(tx.running_balance)} €` : '—'}
                        </td>
                        <td className="py-3 px-2 text-center">
                          {tx.is_reconciled ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                              <CheckCircle2 className="w-3 h-3" />
                              Riconciliato
                            </span>
                          ) : (
                            <button
                              onClick={() => setReconcileTransaction(tx)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
                                text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
                            >
                              <Link2 className="w-3 h-3" />
                              Riconcilia
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}

                  {/* Empty state */}
                  {!loading && transactions.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-gray-400">
                        Nessuna transazione trovata
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Loading indicator */}
            {loading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                <span className="ml-2 text-sm text-gray-500">Caricamento...</span>
              </div>
            )}

            {/* Load More */}
            {!loading && hasMore && transactions.length > 0 && (
              <div className="flex justify-center py-6">
                <button
                  onClick={handleLoadMore}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg
                    border border-gray-200 text-sm font-medium text-gray-700
                    hover:bg-gray-50 hover:border-gray-300 transition-colors"
                >
                  <ChevronDown className="w-4 h-4" />
                  Carica altri
                </button>
              </div>
            )}

            {/* End of list */}
            {!loading && !hasMore && transactions.length > 0 && (
              <p className="text-center py-4 text-xs text-gray-400">
                Tutte le transazioni caricate ({transactions.length})
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Reconciliation Modal */}
      <ReconciliationModal
        isOpen={!!reconcileTransaction}
        onClose={() => setReconcileTransaction(null)}
        transaction={reconcileTransaction}
        onReconcile={(txId, invoice) => {
          setTransactions(prev =>
            prev.map(tx =>
              tx.id === txId
                ? { ...tx, is_reconciled: true, reconciled_invoice_id: invoice.id }
                : tx
            )
          )
        }}
      />
    </>
  )
}
