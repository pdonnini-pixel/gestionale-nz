import React, { useState, useEffect } from 'react';
import {
  Plus, Edit2, Trash2, Save, X, RefreshCw, Search, Filter,
  CalendarClock, Repeat, AlertCircle, CheckCircle2, Loader
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

const paymentMethodLabels = {
  bonifico_ordinario: 'Bonifico ordinario',
  bonifico_urgente: 'Bonifico urgente',
  bonifico_sepa: 'Bonifico SEPA',
  riba_30: 'RiBa 30 gg',
  riba_60: 'RiBa 60 gg',
  riba_90: 'RiBa 90 gg',
  riba_120: 'RiBa 120 gg',
  rid: 'RID',
  sdd_core: 'SDD Core',
  sdd_b2b: 'SDD B2B',
  rimessa_diretta: 'Rimessa diretta',
  carta_credito: 'Carta di credito',
  carta_debito: 'Carta di debito',
  assegno: 'Assegno',
  contanti: 'Contanti',
  compensazione: 'Compensazione',
  f24: 'F24',
  mav: 'MAV',
  rav: 'RAV',
  bollettino_postale: 'Bollettino postale',
  altro: 'Altro',
};

const frequencyLabels = {
  monthly: 'Mensile',
  bimonthly: 'Bimestrale',
  quarterly: 'Trimestrale',
  semiannual: 'Semestrale',
  annual: 'Annuale',
};

const frequencyToMonthlyDivisor = {
  monthly: 1,
  bimonthly: 2,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

const macroGroupLabels = {
  costo_venduto: 'Costo del venduto',
  locazione: 'Locazione',
  personale: 'Personale',
  generali_amministrative: 'Generali e amministrative',
  finanziarie: 'Finanziarie',
  oneri_diversi: 'Oneri diversi',
};

const formatCurrency = (value) => {
  if (!value && value !== 0) return '€ 0,00';
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value) + ' €';
};

const getCurrentMonthYear = () => {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
};

const getMonthsArray = () => {
  const months = [];
  for (let i = 1; i <= 12; i++) {
    months.push({
      month: i,
      label: new Intl.DateTimeFormat('it-IT', { month: 'long' }).format(
        new Date(2026, i - 1)
      ),
    });
  }
  return months;
};

// TODO: tighten type
interface RecurringCost {
  id: string
  company_id: string
  cost_center: string
  cost_category_id: string
  description: string
  amount: number
  frequency: string
  day_of_month: number
  payment_method: string
  supplier_name?: string
  notes?: string
  start_date: string
  end_date?: string
  is_active: boolean
  created_at: string
}

// TODO: tighten type
interface CostCategory {
  id: string
  name: string
  macro_group: string
  sort_order?: number
}

// TODO: tighten type
interface CostCenter {
  id: string
  code: string
  label: string
  color?: string
  sort_order?: number
}

function CostiRicorrenti() {
  const { profile } = useAuth();
  const COMPANY_ID = profile?.company_id;

  // State
  const [recurringCosts, setRecurringCosts] = useState<RecurringCost[]>([]);
  const [costCategories, setCostCategories] = useState<CostCategory[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Filter state
  const [filterOutlet, setFilterOutlet] = useState('');
  const [filterMacroGroup, setFilterMacroGroup] = useState('');
  const [filterActive, setFilterActive] = useState('all');
  const [searchDescription, setSearchDescription] = useState('');

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    cost_center: '',
    cost_category_id: '',
    description: '',
    amount: '',
    frequency: 'monthly',
    day_of_month: 1,
    payment_method: 'bonifico_ordinario',
    supplier_name: '',
    notes: '',
    start_date: new Date().toISOString().split('T')[0],
    end_date: '',
    is_active: true,
  });

  // Load data on mount
  useEffect(() => {
    if (COMPANY_ID) {
      loadData();
    }
  }, [COMPANY_ID]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [costsRes, categoriesRes, centersRes] = await Promise.all([
        supabase
          .from('recurring_costs')
          .select('*')
          .eq('company_id', COMPANY_ID)
          .order('created_at', { ascending: false }),
        supabase
          .from('cost_categories')
          .select('*')
          .eq('company_id', COMPANY_ID)
          .order('sort_order', { ascending: true }),
        supabase
          .from('cost_centers')
          .select('*')
          .eq('company_id', COMPANY_ID)
          .order('sort_order', { ascending: true }),
      ]);

      if (costsRes.error) throw costsRes.error;
      if (categoriesRes.error) throw categoriesRes.error;
      if (centersRes.error) throw centersRes.error;

      setRecurringCosts(costsRes.data || []);
      setCostCategories(categoriesRes.data || []);
      setCostCenters(centersRes.data || []);
    } catch (err) {
      console.error('Error loading data:', err);
      setError('Errore nel caricamento dei dati');
    } finally {
      setLoading(false);
    }
  };

  // Get filtered and searched costs
  const getFilteredCosts = () => {
    return recurringCosts.filter((cost) => {
      // Outlet filter
      if (filterOutlet && cost.cost_center !== filterOutlet) return false;

      // Active filter
      if (filterActive === 'active' && !cost.is_active) return false;
      if (filterActive === 'inactive' && cost.is_active) return false;

      // Macro group filter
      if (filterMacroGroup) {
        const category = costCategories.find((c) => c.id === cost.cost_category_id);
        if (!category || category.macro_group !== filterMacroGroup) return false;
      }

      // Search by description
      if (
        searchDescription &&
        !cost.description.toLowerCase().includes(searchDescription.toLowerCase())
      ) {
        return false;
      }

      return true;
    });
  };

  const filteredCosts = getFilteredCosts();

  // Calculate summary metrics
  const calculateSummaries = () => {
    const activeCosts = filteredCosts.filter((c) => c.is_active);
    let totalMonthly = 0;
    let byMacroGroup = {};

    activeCosts.forEach((cost) => {
      const monthlyAmount = cost.amount / frequencyToMonthlyDivisor[cost.frequency];
      totalMonthly += monthlyAmount;

      const category = costCategories.find((c) => c.id === cost.cost_category_id);
      if (category) {
        const macroGroup = category.macro_group;
        if (!byMacroGroup[macroGroup]) {
          byMacroGroup[macroGroup] = 0;
        }
        byMacroGroup[macroGroup] += monthlyAmount;
      }
    });

    return {
      totalMonthly,
      totalAnnual: totalMonthly * 12,
      activeCount: activeCosts.length,
      byMacroGroup,
    };
  };

  const summaries = calculateSummaries();

  // Modal handlers
  const openAddModal = () => {
    setEditingId(null);
    setFormData({
      cost_center: '',
      cost_category_id: '',
      description: '',
      amount: '',
      frequency: 'monthly',
      day_of_month: 1,
      payment_method: 'bonifico_ordinario',
      supplier_name: '',
      notes: '',
      start_date: new Date().toISOString().split('T')[0],
      end_date: '',
      is_active: true,
    });
    setShowModal(true);
  };

  const openEditModal = (cost) => {
    setEditingId(cost.id);
    setFormData({
      cost_center: cost.cost_center,
      cost_category_id: cost.cost_category_id,
      description: cost.description,
      amount: cost.amount,
      frequency: cost.frequency,
      day_of_month: cost.day_of_month,
      payment_method: cost.payment_method,
      supplier_name: cost.supplier_name || '',
      notes: cost.notes || '',
      start_date: cost.start_date,
      end_date: cost.end_date || '',
      is_active: cost.is_active,
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
  };

  const handleFormChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const saveRecurringCost = async () => {
    try {
      setError(null);

      if (!formData.cost_center || !formData.cost_category_id || !formData.description || !formData.amount) {
        setError('Completa tutti i campi obbligatori');
        return;
      }

      const costData = {
        company_id: COMPANY_ID,
        cost_center: formData.cost_center,
        cost_category_id: formData.cost_category_id,
        description: formData.description,
        amount: parseFloat(formData.amount),
        frequency: formData.frequency,
        day_of_month: parseInt(formData.day_of_month),
        payment_method: formData.payment_method,
        supplier_name: formData.supplier_name || null,
        notes: formData.notes || null,
        start_date: formData.start_date,
        end_date: formData.end_date || null,
        is_active: formData.is_active,
      };

      if (editingId) {
        // Update
        const { error: updateError } = await supabase
          .from('recurring_costs')
          .update(costData)
          .eq('id', editingId);

        if (updateError) throw updateError;
        setSuccess('Costo ricorrente aggiornato');
      } else {
        // Insert
        const { error: insertError } = await supabase
          .from('recurring_costs')
          .insert([costData]);

        if (insertError) throw insertError;
        setSuccess('Costo ricorrente creato');
      }

      closeModal();
      await loadData();
    } catch (err) {
      console.error('Error saving cost:', err);
      setError('Errore nel salvataggio del costo');
    }
  };

  const deleteRecurringCost = async (id) => {
    try {
      setError(null);
      const { error } = await supabase.from('recurring_costs').delete().eq('id', id);

      if (error) throw error;
      setSuccess('Costo ricorrente eliminato');
      setDeleteConfirmId(null);
      await loadData();
    } catch (err) {
      console.error('Error deleting cost:', err);
      setError('Errore nell\'eliminazione del costo');
    }
  };

  const toggleActive = async (cost) => {
    try {
      setError(null);
      const { error } = await supabase
        .from('recurring_costs')
        .update({ is_active: !cost.is_active })
        .eq('id', cost.id);

      if (error) throw error;
      await loadData();
    } catch (err) {
      console.error('Error toggling active status:', err);
      setError('Errore nell\'aggiornamento dello stato');
    }
  };

  // 12-month projection
  const getMonthProjection = () => {
    const months = getMonthsArray();
    const projection = {};

    months.forEach((m) => {
      projection[m.month] = {
        total: 0,
        costs: [],
      };
    });

    filteredCosts
      .filter((c) => c.is_active)
      .forEach((cost) => {
        const startDate = new Date(cost.start_date);
        const endDate = cost.end_date ? new Date(cost.end_date) : new Date('2099-12-31');
        const startMonth = startDate.getMonth() + 1;
        const startYear = startDate.getFullYear();

        months.forEach((m) => {
          const checkDate = new Date(2026, m.month - 1, cost.day_of_month || 1);

          if (checkDate >= startDate && checkDate <= endDate) {
            let included = false;

            if (cost.frequency === 'monthly') {
              included = true;
            } else if (cost.frequency === 'bimonthly') {
              const monthsSinceStart = (m.month - startMonth) % 12;
              included = monthsSinceStart % 2 === 0;
            } else if (cost.frequency === 'quarterly') {
              const monthsSinceStart = (m.month - startMonth) % 12;
              included = monthsSinceStart % 3 === 0;
            } else if (cost.frequency === 'semiannual') {
              const monthsSinceStart = (m.month - startMonth) % 12;
              included = monthsSinceStart % 6 === 0;
            } else if (cost.frequency === 'annual') {
              included = m.month === startMonth;
            }

            if (included) {
              projection[m.month].total += cost.amount / frequencyToMonthlyDivisor[cost.frequency];
              projection[m.month].costs.push(cost.description);
            }
          }
        });
      });

    return { months, projection };
  };

  const { months, projection } = getMonthProjection();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Alerts */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <p className="text-sm text-red-800">{error}</p>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-600 hover:text-red-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
          <CheckCircle2 className="w-5 h-5 text-green-600" />
          <p className="text-sm text-green-800">{success}</p>
          <button
            onClick={() => setSuccess(null)}
            className="ml-auto text-green-600 hover:text-green-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
          <p className="text-xs text-slate-600 font-medium mb-1">Totale mensile stimato</p>
          <p className="text-2xl font-semibold text-indigo-600">
            {formatCurrency(summaries.totalMonthly)}
          </p>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
          <p className="text-xs text-slate-600 font-medium mb-1">Totale annuale stimato</p>
          <p className="text-2xl font-semibold text-indigo-600">
            {formatCurrency(summaries.totalAnnual)}
          </p>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
          <p className="text-xs text-slate-600 font-medium mb-1">Costi attivi</p>
          <p className="text-2xl font-semibold text-indigo-600">{summaries.activeCount}</p>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
          <p className="text-xs text-slate-600 font-medium mb-1">Macro gruppi</p>
          <div className="space-y-1">
            {Object.entries(summaries.byMacroGroup)
              .slice(0, 2)
              .map(([group, amount]) => (
                <p key={group} className="text-xs text-slate-600">
                  {macroGroupLabels[group]}: {formatCurrency(amount)}
                </p>
              ))}
          </div>
        </div>
      </div>

      {/* Filters & Actions */}
      <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Filter className="w-4 h-4" />
            Filtri
          </h3>
          <button
            onClick={openAddModal}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Aggiungi costo
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Cerca per descrizione..."
              value={searchDescription}
              onChange={(e) => setSearchDescription(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Outlet filter */}
          <select
            value={filterOutlet}
            onChange={(e) => setFilterOutlet(e.target.value)}
            className="px-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Tutti gli outlet</option>
            {costCenters.map((center) => (
              <option key={center.id} value={center.code}>
                {center.label}
              </option>
            ))}
          </select>

          {/* Macro group filter */}
          <select
            value={filterMacroGroup}
            onChange={(e) => setFilterMacroGroup(e.target.value)}
            className="px-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Tutti i gruppi</option>
            {Object.entries(macroGroupLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>

          {/* Active filter */}
          <select
            value={filterActive}
            onChange={(e) => setFilterActive(e.target.value)}
            className="px-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">Tutti</option>
            <option value="active">Solo attivi</option>
            <option value="inactive">Solo inattivi</option>
          </select>
        </div>
      </div>

      {/* Costs Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-900">Outlet</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-900">Categoria</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-900">Descrizione</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-900">Importo</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-900">Frequenza</th>
                <th className="px-4 py-3 text-center font-semibold text-slate-900">Giorno</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-900">Metodo pagamento</th>
                <th className="px-4 py-3 text-center font-semibold text-slate-900">Stato</th>
                <th className="px-4 py-3 text-center font-semibold text-slate-900">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {filteredCosts.length === 0 ? (
                <tr>
                  <td colSpan="9" className="px-4 py-8 text-center text-slate-500">
                    Nessun costo ricorrente trovato
                  </td>
                </tr>
              ) : (
                filteredCosts.map((cost) => {
                  const category = costCategories.find((c) => c.id === cost.cost_category_id);
                  const center = costCenters.find((c) => c.code === cost.cost_center);

                  return (
                    <tr key={cost.id} className="border-b border-slate-200 hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-3 h-3 rounded-full ${center?.color || 'bg-slate-300'}`}
                          />
                          <span className="text-slate-700">{center?.label || cost.cost_center}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-slate-700">{category?.name || '-'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-slate-700">{cost.description}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-medium text-slate-900">{formatCurrency(cost.amount)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-slate-700">{frequencyLabels[cost.frequency]}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-slate-700">{cost.day_of_month}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-slate-600">
                          {paymentMethodLabels[cost.payment_method] || cost.payment_method}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => toggleActive(cost)}
                          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                            cost.is_active
                              ? 'bg-green-100 text-green-700 hover:bg-green-200'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {cost.is_active ? 'Attivo' : 'Inattivo'}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => openEditModal(cost)}
                            className="p-1 hover:bg-slate-200 rounded transition-colors"
                            title="Modifica"
                          >
                            <Edit2 className="w-4 h-4 text-slate-600" />
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(cost.id)}
                            className="p-1 hover:bg-red-100 rounded transition-colors"
                            title="Elimina"
                          >
                            <Trash2 className="w-4 h-4 text-red-600" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 12-Month Projection */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <CalendarClock className="w-4 h-4" />
          Proiezione 12 mesi (2026)
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {months.map((m) => (
            <div key={m.month} className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-xs font-semibold text-slate-900 mb-2 capitalize">{m.label}</p>
              <p className="text-lg font-semibold text-indigo-600 mb-2">
                {formatCurrency(projection[m.month].total)}
              </p>
              {projection[m.month].costs.length > 0 && (
                <details className="text-xs text-slate-600">
                  <summary className="cursor-pointer hover:text-slate-900">
                    {projection[m.month].costs.length} costo/i
                  </summary>
                  <ul className="mt-2 space-y-1 ml-2 border-l border-slate-300 pl-2">
                    {projection[m.month].costs.map((desc, idx) => (
                      <li key={idx} className="text-slate-600 truncate" title={desc}>
                        {desc}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-2xl w-full max-h-96 overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-slate-200 sticky top-0 bg-white">
              <h2 className="text-lg font-semibold text-slate-900">
                {editingId ? 'Modifica costo ricorrente' : 'Nuovo costo ricorrente'}
              </h2>
              <button
                onClick={closeModal}
                className="p-1 hover:bg-slate-100 rounded transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Outlet */}
                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-1">
                    Outlet *
                  </label>
                  <select
                    value={formData.cost_center}
                    onChange={(e) => handleFormChange('cost_center', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Seleziona outlet</option>
                    {costCenters.map((center) => (
                      <option key={center.id} value={center.code}>
                        {center.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Category */}
                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-1">
                    Categoria *
                  </label>
                  <select
                    value={formData.cost_category_id}
                    onChange={(e) => handleFormChange('cost_category_id', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Seleziona categoria</option>
                    {Object.entries(macroGroupLabels).map(([macroKey, macroLabel]) => (
                      <optgroup key={macroKey} label={macroLabel}>
                        {costCategories
                          .filter((c) => c.macro_group === macroKey)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                {/* Description */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-900 mb-1">
                    Descrizione *
                  </label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) => handleFormChange('description', e.target.value)}
                    placeholder="Es: Affitto negozio, Compenso consulente"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                {/* Amount */}
                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-1">
                    Importo *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.amount}
                    onChange={(e) => handleFormChange('amount', e.target.value)}
                    placeholder="0,00"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                {/* Frequency */}
                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-1">
                    Frequenza *
                  </label>
                  <select
                    value={formData.frequency}
                    onChange={(e) => handleFormChange('frequency', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {Object.entries(frequencyLabels).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Day of month */}
                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-1">
                    Giorno del mese (1-28)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="28"
                    value={formData.day_of_month}
                    onChange={(e) => handleFormChange('day_of_month', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                {/* Payment method */}
                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-1">
                    Metodo di pagamento
                  </label>
                  <select
                    value={formData.payment_method}
                    onChange={(e) => handleFormChange('payment_method', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {Object.entries(paymentMethodLabels).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Supplier name */}
                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-1">
                    Fornitore
                  </label>
                  <input
                    type="text"
                    value={formData.supplier_name}
                    onChange={(e) => handleFormChange('supplier_name', e.target.value)}
                    placeholder="Nome fornitore"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                {/* Start date */}
                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-1">
                    Data inizio
                  </label>
                  <input
                    type="date"
                    value={formData.start_date}
                    onChange={(e) => handleFormChange('start_date', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                {/* End date */}
                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-1">
                    Data fine (opzionale)
                  </label>
                  <input
                    type="date"
                    value={formData.end_date}
                    onChange={(e) => handleFormChange('end_date', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                {/* Notes */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-900 mb-1">
                    Note
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => handleFormChange('notes', e.target.value)}
                    placeholder="Note aggiuntive..."
                    rows="2"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                {/* Active */}
                <div className="md:col-span-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.is_active}
                      onChange={(e) => handleFormChange('is_active', e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm font-medium text-slate-900">Attivo</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 p-6 border-t border-slate-200 sticky bottom-0 bg-white">
              <button
                onClick={closeModal}
                className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Annulla
              </button>
              <button
                onClick={saveRecurringCost}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
              >
                <Save className="w-4 h-4" />
                Salva
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-sm w-full">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-2">
                Elimina costo ricorrente?
              </h2>
              <p className="text-sm text-slate-600 mb-6">
                Questa azione non può essere annullata. Il costo ricorrente verrà eliminato
                permanentemente.
              </p>

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setDeleteConfirmId(null)}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Annulla
                </button>
                <button
                  onClick={() => deleteRecurringCost(deleteConfirmId)}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
                >
                  Elimina
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CostiRicorrenti;
