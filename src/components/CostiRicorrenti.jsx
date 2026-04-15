import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, Edit2, Trash2, Save, X, RefreshCw, CheckCircle2, Search, Filter,
  CalendarClock, Repeat, AlertCircle, Loader
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

const formatCurrency = (num) => {
  if (num === null || num === undefined) return '€ 0,00';
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num) + ' €';
};

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('it-IT');
};

const parseDate = (dateStr) => {
  if (!dateStr) return null;
  return dateStr.split('T')[0];
};

const calculateMonthlyEquivalent = (amount, frequency) => {
  const divisor = frequencyToMonthlyDivisor[frequency] || 1;
  return amount / divisor;
};

const getMonthlyExpenditureByMonth = (costs, year = 2026) => {
  const months = Array(12).fill(0).map((_, i) => 0);

  costs.forEach((cost) => {
    if (!cost.is_active) return;

    const startDate = cost.start_date ? new Date(cost.start_date) : null;
    const endDate = cost.end_date ? new Date(cost.end_date) : null;

    for (let month = 0; month < 12; month++) {
      const monthDate = new Date(year, month, 15);

      if (startDate && monthDate < startDate) continue;
      if (endDate && monthDate > endDate) continue;

      const monthlyAmount = calculateMonthlyEquivalent(cost.amount, cost.frequency);

      if (cost.frequency === 'monthly') {
        months[month] += monthlyAmount;
      } else if (cost.frequency === 'bimonthly') {
        if (month % 2 === (startDate?.getMonth() % 2)) {
          months[month] += monthlyAmount;
        }
      } else if (cost.frequency === 'quarterly') {
        if (Math.floor(month / 3) === Math.floor((startDate?.getMonth() || 0) / 3)) {
          months[month] += monthlyAmount;
        }
      } else if (cost.frequency === 'semiannual') {
        if (Math.floor(month / 6) === Math.floor((startDate?.getMonth() || 0) / 6)) {
          months[month] += monthlyAmount;
        }
      } else if (cost.frequency === 'annual') {
        if (month === (startDate?.getMonth() || 0)) {
          months[month] += monthlyAmount;
        }
      }
    }
  });

  return months;
};

export default function CostiRicorrenti() {
  const { profile } = useAuth();
  const COMPANY_ID = profile?.company_id;

  const [costs, setCosts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [filterOutlet, setFilterOutlet] = useState('');
  const [filterMacroGroup, setFilterMacroGroup] = useState('');
  const [filterActive, setFilterActive] = useState('all');
  const [searchDescription, setSearchDescription] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
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

  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Fetch data
  const fetchData = useCallback(async () => {
    if (!COMPANY_ID) return;
    setLoading(true);
    setError(null);
    try {
      const [costsRes, categoriesRes, centersRes] = await Promise.all([
        supabase
          .from('recurring_costs')
          .select('*')
          .eq('company_id', COMPANY_ID),
        supabase
          .from('cost_categories')
          .select('*')
          .eq('company_id', COMPANY_ID)
          .order('sort_order'),
        supabase
          .from('cost_centers')
          .select('*')
          .eq('company_id', COMPANY_ID)
          .order('sort_order'),
      ]);

      if (costsRes.error) throw costsRes.error;
      if (categoriesRes.error) throw categoriesRes.error;
      if (centersRes.error) throw centersRes.error;

      setCosts(costsRes.data || []);
      setCategories(categoriesRes.data || []);
      setCostCenters(centersRes.data || []);
    } catch (err) {
      console.error('Error fetching data:', err);
      setError(err.message || 'Errore nel caricamento dei dati');
    } finally {
      setLoading(false);
    }
  }, [COMPANY_ID]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Filtered costs
  const filteredCosts = useMemo(() => {
    return costs.filter((cost) => {
      if (filterOutlet && cost.cost_center !== filterOutlet) return false;
      if (filterActive === 'active' && !cost.is_active) return false;
      if (filterActive === 'inactive' && cost.is_active) return false;

      const category = categories.find((c) => c.id === cost.cost_category_id);
      if (filterMacroGroup && category?.macro_group !== filterMacroGroup)
        return false;

      if (
        searchDescription &&
        !cost.description
          .toLowerCase()
          .includes(searchDescription.toLowerCase())
      )
        return false;

      return true;
    });
  }, [costs, filterOutlet, filterActive, searchDescription, filterMacroGroup, categories]);

  // Summary calculations
  const summary = useMemo(() => {
    const activeCosts = costs.filter((c) => c.is_active);
    const monthlyTotal = activeCosts.reduce((sum, cost) => {
      return sum + calculateMonthlyEquivalent(cost.amount, cost.frequency);
    }, 0);
    const annualTotal = monthlyTotal * 12;
    const activeCount = activeCosts.length;

    const byMacroGroup = {};
    activeCosts.forEach((cost) => {
      const category = categories.find((c) => c.id === cost.cost_category_id);
      const macroGroup = category?.macro_group || 'unknown';
      if (!byMacroGroup[macroGroup]) {
        byMacroGroup[macroGroup] = { monthly: 0, count: 0 };
      }
      byMacroGroup[macroGroup].monthly += calculateMonthlyEquivalent(
        cost.amount,
        cost.frequency
      );
      byMacroGroup[macroGroup].count += 1;
    });

    return {
      monthlyTotal,
      annualTotal,
      activeCount,
      byMacroGroup,
    };
  }, [costs, categories]);

  // Monthly projection
  const monthlyProjection = useMemo(() => {
    return getMonthlyExpenditureByMonth(filteredCosts);
  }, [filteredCosts]);

  const monthNames = [
    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
  ];

  // Handlers
  const openModal = (cost = null) => {
    if (cost) {
      setEditingId(cost.id);
      setFormData({
        cost_center: cost.cost_center,
        cost_category_id: cost.cost_category_id,
        description: cost.description,
        amount: cost.amount.toString(),
        frequency: cost.frequency,
        day_of_month: cost.day_of_month,
        payment_method: cost.payment_method,
        supplier_name: cost.supplier_name || '',
        notes: cost.notes || '',
        start_date: parseDate(cost.start_date),
        end_date: parseDate(cost.end_date) || '',
        is_active: cost.is_active,
      });
    } else {
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
    }
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const payload = {
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
        company_id: COMPANY_ID,
      };

      if (editingId) {
        const { error } = await supabase
          .from('recurring_costs')
          .update(payload)
          .eq('id', editingId);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('recurring_costs')
          .insert([payload]);

        if (error) throw error;
      }

      await fetchData();
      closeModal();
    } catch (err) {
      console.error('Error saving cost:', err);
      setError(err.message || 'Errore nel salvataggio');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      const { error } = await supabase
        .from('recurring_costs')
        .delete()
        .eq('id', id);

      if (error) throw error;
      await fetchData();
      setDeleteConfirm(null);
    } catch (err) {
      console.error('Error deleting cost:', err);
      setError(err.message || 'Errore nella cancellazione');
    }
  };

  const toggleActive = async (id, currentState) => {
    try {
      const { error } = await supabase
        .from('recurring_costs')
        .update({ is_active: !currentState })
        .eq('id', id);

      if (error) throw error;
      await fetchData();
    } catch (err) {
      console.error('Error toggling active state:', err);
      setError(err.message || 'Errore nell\'aggiornamento');
    }
  };

  const getCategoryName = (categoryId) => {
    return categories.find((c) => c.id === categoryId)?.name || '';
  };

  const getCenterLabel = (centerCode) => {
    return costCenters.find((c) => c.code === centerCode) || {};
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-3">
          <Loader className="w-8 h-8 text-indigo-600 animate-spin" />
          <p className="text-slate-600">Caricamento costi ricorrenti...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Costi Ricorrenti</h1>
          <p className="text-sm text-slate-600 mt-1">
            Gestione costi non-SDI con frequenza ricorrente
          </p>
        </div>
        <button
          onClick={() => openModal()}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nuovo costo
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-900">{error}</p>
            <button
              onClick={() => setError(null)}
              className="text-xs text-red-700 hover:text-red-900 mt-1"
            >
              Chiudi
            </button>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Totale mensile stimato
          </p>
          <p className="text-2xl font-bold text-indigo-600 mt-1">
            {formatCurrency(summary.monthlyTotal)}
          </p>
        </div>

        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Totale annuale stimato
          </p>
          <p className="text-2xl font-bold text-indigo-600 mt-1">
            {formatCurrency(summary.annualTotal)}
          </p>
        </div>

        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Costi attivi
          </p>
          <p className="text-2xl font-bold text-indigo-600 mt-1">
            {summary.activeCount}
          </p>
        </div>

        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Azioni
          </p>
          <button
            onClick={fetchData}
            className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 mt-2 font-medium"
          >
            <RefreshCw className="w-4 h-4" />
            Aggiorna
          </button>
        </div>
      </div>

      {/* Macro group summary */}
      {Object.keys(summary.byMacroGroup).length > 0 && (
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">
            Suddivisione per categoria
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(summary.byMacroGroup).map(([group, data]) => (
              <div
                key={group}
                className="p-3 bg-slate-50 rounded-lg border border-slate-100"
              >
                <p className="text-xs font-semibold text-slate-600">
                  {macroGroupLabels[group] || group}
                </p>
                <div className="flex items-baseline justify-between mt-2">
                  <p className="text-lg font-bold text-slate-900">
                    {formatCurrency(data.monthly)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {data.count} {data.count === 1 ? 'costo' : 'costi'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3 items-start md:items-end">
        <div className="flex-1">
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Ricerca
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Cerca per descrizione..."
              value={searchDescription}
              onChange={(e) => setSearchDescription(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Outlet
          </label>
          <select
            value={filterOutlet}
            onChange={(e) => setFilterOutlet(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Tutti</option>
            {costCenters.map((center) => (
              <option key={center.id} value={center.code}>
                {center.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Categoria
          </label>
          <select
            value={filterMacroGroup}
            onChange={(e) => setFilterMacroGroup(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Tutte</option>
            {Object.entries(macroGroupLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Stato
          </label>
          <select
            value={filterActive}
            onChange={(e) => setFilterActive(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">Tutti</option>
            <option value="active">Attivi</option>
            <option value="inactive">Disattivi</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        {filteredCosts.length === 0 ? (
          <div className="p-8 text-center">
            <Repeat className="w-12 h-12 text-slate-300 mx-auto mb-2" />
            <p className="text-slate-600">Nessun costo ricorrente trovato</p>
            <button
              onClick={() => openModal()}
              className="text-indigo-600 hover:text-indigo-700 text-sm font-medium mt-2"
            >
              Crea il primo costo
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">
                    Outlet
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">
                    Categoria
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">
                    Descrizione
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">
                    Importo
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">
                    Frequenza
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-slate-700">
                    Giorno
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">
                    Metodo pagamento
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-slate-700">
                    Stato
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-slate-700">
                    Azioni
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredCosts.map((cost) => {
                  const center = getCenterLabel(cost.cost_center);
                  const categoryName = getCategoryName(cost.cost_category_id);
                  return (
                    <tr
                      key={cost.id}
                      className="border-b border-slate-200 hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-3 h-3 rounded-full ${
                              center.color || 'bg-slate-400'
                            }`}
                          />
                          <span className="text-sm font-medium text-slate-900">
                            {center.label || '—'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{categoryName}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {cost.description}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-900">
                        {formatCurrency(cost.amount)}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {frequencyLabels[cost.frequency] || cost.frequency}
                      </td>
                      <td className="px-4 py-3 text-center text-slate-700">
                        {cost.day_of_month || '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <span className="text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded">
                          {paymentMethodLabels[cost.payment_method] ||
                            cost.payment_method}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => toggleActive(cost.id, cost.is_active)}
                          className={`transition-colors ${
                            cost.is_active
                              ? 'text-green-600 hover:text-green-700'
                              : 'text-slate-400 hover:text-slate-500'
                          }`}
                          title={
                            cost.is_active
                              ? 'Disattiva'
                              : 'Attiva'
                          }
                        >
                          <CheckCircle2 className="w-5 h-5" />
                        </button>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => openModal(cost)}
                            className="text-indigo-600 hover:text-indigo-700 transition-colors"
                            title="Modifica"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(cost.id)}
                            className="text-red-600 hover:text-red-700 transition-colors"
                            title="Elimina"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 12-month projection */}
      {filteredCosts.length > 0 && (
        <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <CalendarClock className="w-4 h-4" />
            Proiezione 12 mesi
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {monthNames.map((month, idx) => (
              <div
                key={idx}
                className="p-3 bg-slate-50 border border-slate-100 rounded-lg"
              >
                <p className="text-xs font-semibold text-slate-600 mb-2">
                  {month}
                </p>
                <p className="text-lg font-bold text-indigo-600">
                  {formatCurrency(monthlyProjection[idx])}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4">
            <h3 className="font-bold text-lg text-slate-900 mb-2">
              Eliminare costo ricorrente?
            </h3>
            <p className="text-sm text-slate-600 mb-6">
              Questa azione non può essere annullata. Il costo sarà rimosso
              definitivamente dal sistema.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Annulla
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Elimina
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 flex items-center justify-between p-6 border-b border-slate-200 bg-white">
              <h2 className="text-lg font-bold text-slate-900">
                {editingId ? 'Modifica costo ricorrente' : 'Nuovo costo ricorrente'}
              </h2>
              <button
                onClick={closeModal}
                className="text-slate-500 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Outlet */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Outlet *
                  </label>
                  <select
                    required
                    value={formData.cost_center}
                    onChange={(e) =>
                      setFormData({ ...formData, cost_center: e.target.value })
                    }
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
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Categoria *
                  </label>
                  <select
                    required
                    value={formData.cost_category_id}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        cost_category_id: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Seleziona categoria</option>
                    {Object.entries(macroGroupLabels).map(([group, groupLabel]) => (
                      <optgroup key={group} label={groupLabel}>
                        {categories
                          .filter((c) => c.macro_group === group)
                          .map((cat) => (
                            <option key={cat.id} value={cat.id}>
                              {cat.name}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                {/* Description */}
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Descrizione *
                  </label>
                  <input
                    required
                    type="text"
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Es. Affitto negozio"
                  />
                </div>

                {/* Amount */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Importo (€) *
                  </label>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.amount}
                    onChange={(e) =>
                      setFormData({ ...formData, amount: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="0,00"
                  />
                </div>

                {/* Frequency */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Frequenza *
                  </label>
                  <select
                    required
                    value={formData.frequency}
                    onChange={(e) =>
                      setFormData({ ...formData, frequency: e.target.value })
                    }
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
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Giorno del mese (1-28)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="28"
                    value={formData.day_of_month}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        day_of_month: parseInt(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                {/* Payment method */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Metodo pagamento *
                  </label>
                  <select
                    required
                    value={formData.payment_method}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        payment_method: e.target.value,
                      })
                    }
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
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Fornitore (opzionale)
                  </label>
                  <input
                    type="text"
                    value={formData.supplier_name}
                    onChange={(e) =>
                      setFormData({ ...formData, supplier_name: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Nome fornitore"
                  />
                </div>

                {/* Start date */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Data inizio *
                  </label>
                  <input
                    required
                    type="date"
                    value={formData.start_date}
                    onChange={(e) =>
                      setFormData({ ...formData, start_date: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                {/* End date */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Data fine (opzionale)
                  </label>
                  <input
                    type="date"
                    value={formData.end_date}
                    onChange={(e) =>
                      setFormData({ ...formData, end_date: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                {/* Notes */}
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Note (opzionale)
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) =>
                      setFormData({ ...formData, notes: e.target.value })
                    }
                    rows="3"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Note aggiuntive..."
                  />
                </div>

                {/* Active toggle */}
                <div className="md:col-span-2">
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={formData.is_active}
                      onChange={(e) =>
                        setFormData({ ...formData, is_active: e.target.checked })
                      }
                      className="w-4 h-4 text-indigo-600 border-slate-200 rounded focus:ring-2 focus:ring-indigo-500"
                    />
                    <span className="text-sm font-medium text-slate-700">
                      Costo attivo
                    </span>
                  </label>
                </div>
              </div>

              {/* Buttons */}
              <div className="flex gap-3 justify-end pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <>
                      <Loader className="w-4 h-4 animate-spin" />
                      Salvataggio...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Salva
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
