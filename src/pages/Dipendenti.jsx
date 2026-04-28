import React, { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react';
import PageHelp from '../components/PageHelp';
import {
  ChevronDown,
  ChevronUp,
  BarChart3,
  Download,
  Plus,
  Trash2,
  Edit2,
  Save,
  X,
  Upload,
  Clock,
  FileText,
  Eye,
  AlertCircle,
  Percent,
  RefreshCw,
  FileUp,
  Sliders,
} from 'lucide-react';

const PdfViewer = lazy(() => import('../components/PdfViewer'));
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import ExportMenu from '../components/ExportMenu';
import { supabase } from '../lib/supabase';
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme';
import { useAuth } from '../hooks/useAuth';

// ============================================================================
// CONSTANTS
// ============================================================================

const OUTLET_COLORS = {
  'Valdichiana': 'bg-blue-600',
  'Barberino': 'bg-emerald-600',
  'Palmanova': 'bg-sky-600',
  'Franciacorta': 'bg-rose-600',
  'Ufficio/Magazzino': 'bg-amber-600',
  'Brugnato': 'bg-orange-600',
  'Valmontone': 'bg-purple-600',
  'Torino': 'bg-indigo-600',
};

const OUTLETS_ORDER = [
  'Valdichiana',
  'Barberino',
  'Palmanova',
  'Franciacorta',
  'Ufficio/Magazzino',
  'Brugnato',
  'Valmontone',
  'Torino',
];

const MONTHS = [
  { num: 1, label: 'Gennaio' },
  { num: 2, label: 'Febbraio' },
  { num: 3, label: 'Marzo' },
  { num: 4, label: 'Aprile' },
  { num: 5, label: 'Maggio' },
  { num: 6, label: 'Giugno' },
  { num: 7, label: 'Luglio' },
  { num: 8, label: 'Agosto' },
  { num: 9, label: 'Settembre' },
  { num: 10, label: 'Ottobre' },
  { num: 11, label: 'Novembre' },
  { num: 12, label: 'Dicembre' },
];

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function Dipendenti() {
  const { profile } = useAuth();
  const COMPANY_ID = profile?.company_id;

  const [viewMode, setViewMode] = useState('consuntivo'); // 'consuntivo' | 'organico'
  const [selectedYear, setSelectedYear] = useState(2025);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);

  // Data state
  const [employees, setEmployees] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [costs, setCosts] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [lastUpdateTime, setLastUpdateTime] = useState(null);

  // UI state
  const [expandedOutlets, setExpandedOutlets] = useState({});
  const [expandedEmployees, setExpandedEmployees] = useState({});
  const [loading, setLoading] = useState(true);
  const [showEmployeeForm, setShowEmployeeForm] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [showCostForm, setShowCostForm] = useState(false);
  const [editingCost, setEditingCost] = useState(null);
  const [showDocumentUpload, setShowDocumentUpload] = useState(false);
  const [uploadingEmployee, setUploadingEmployee] = useState(null);

  // New features state
  const [showAllocEditor, setShowAllocEditor] = useState(null); // employee id
  const [allocEdits, setAllocEdits] = useState([]);
  const [allocErrors, setAllocErrors] = useState('');
  const [employeeDocs, setEmployeeDocs] = useState([]);
  const [showDocViewer, setShowDocViewer] = useState(null); // doc object
  const [docPdfData, setDocPdfData] = useState(null);
  const [batchImporting, setBatchImporting] = useState(false);
  const batchFileRef = useRef(null);
  const [bilancioCostoPersonale, setBilancioCostoPersonale] = useState(null);

  // Toast inline (sostituisce alert() di sistema)
  const [toast, setToast] = useState(null); // { type: 'error'|'success'|'info', msg: string }
  const showToast = (msg, type = 'info') => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4500);
  };

  // Mappa i nomi dei campi del form ai nomi reali delle colonne in DB.
  // Lo schema employees ha colonne MISTE italiano + inglese. Le colonne
  // inglesi (first_name, last_name) sono NOT NULL, quelle italiane
  // (nome, cognome) sono nullable. Per garantire compatibilita' con
  // entrambe le viste, popoliamo SEMPRE entrambe le coppie.
  const mapFormToDb = (formData) => {
    const out = { ...formData };

    // Coppie italiane <-> inglesi: popola entrambe per soddisfare
    // i NOT NULL su lato inglese e mantenere la lettura lato italiano.
    if ('nome' in out)            out.first_name = out.nome;
    if ('cognome' in out)         out.last_name = out.cognome;
    if ('codice_fiscale' in out)  out.fiscal_code = out.codice_fiscale || null;
    if ('data_assunzione' in out) out.hire_date = out.data_assunzione || null;
    if ('data_cessazione' in out) out.termination_date = out.data_cessazione || null;
    if ('livello' in out)         out.level = out.livello || null;
    if ('note' in out)            out.notes = out.note || null;

    // 'contratto' nel form -> 'contratto_tipo' in DB
    if ('contratto' in out) {
      out.contratto_tipo = out.contratto;
      delete out.contratto;
    }
    // 'qualifica' nel form -> 'role_description' in DB
    if ('qualifica' in out) {
      out.role_description = out.qualifica;
      delete out.qualifica;
    }

    // Normalizza stringhe vuote a null sui campi date (Postgres
    // rifiuta '' su tipo date) e su tutti i nullable.
    ['hire_date', 'termination_date', 'data_assunzione', 'data_cessazione'].forEach(k => {
      if (out[k] === '') out[k] = null;
    });

    // Default cessazione per contratto indeterminato: data sentinella
    // a 99 anni (9999-12-31 e' supportato da Postgres date type) cosi'
    // non compare in nessuna scadenza imminente. Per contratti a termine
    // la data resta quella dell'utente (gia' validata come obbligatoria).
    if (out.contratto_tipo === 'indeterminato' && !out.data_cessazione) {
      out.data_cessazione = '9999-12-31';
      out.termination_date = '9999-12-31';
    }

    return out;
  };

  // ========== LOAD DATA FROM SUPABASE ==========

  useEffect(() => {
    if (!COMPANY_ID) return;
    loadAllData();
  }, [COMPANY_ID]);

  // Load bilancio costo personale from balance_sheet_data
  useEffect(() => {
    if (!COMPANY_ID) return;
    async function loadBilancio() {
      const currentYear = new Date().getFullYear();
      const { data } = await supabase
        .from('balance_sheet_data')
        .select('amount')
        .eq('company_id', COMPANY_ID)
        .eq('account_code', 'totale_personale')
        .eq('section', 'conto_economico')
        .eq('period_type', 'annuale')
        .eq('year', currentYear)
        .maybeSingle();
      if (data?.amount) {
        setBilancioCostoPersonale(data.amount);
      }
    }
    loadBilancio();
  }, [COMPANY_ID]);

  const loadAllData = async () => {
    try {
      setLoading(true);

      // Load employees (filtered by company)
      const { data: empData, error: empError } = await supabase
        .from('employees')
        .select('*')
        .eq('company_id', COMPANY_ID)
        .or('is_active.is.null,is_active.eq.true')
        .order('cognome');

      if (empError) throw empError;
      setEmployees(empData || []);

      // Load allocations (for company employees)
      const empIds = (empData || []).map(e => e.id);
      let allocData = [];
      if (empIds.length > 0) {
        const { data, error: allocError } = await supabase
          .from('employee_outlet_allocations')
          .select('*')
          .in('employee_id', empIds)
          .order('employee_id');
        if (allocError) throw allocError;
        allocData = data || [];
      }
      setAllocations(allocData);

      // Load costs (for company employees)
      let costData = [];
      if (empIds.length > 0) {
        const { data, error: costError } = await supabase
          .from('employee_costs')
          .select('*')
          .in('employee_id', empIds)
          .order('employee_id');
        if (costError) throw costError;
        costData = data || [];
      }
      setCosts(costData);

      // Load cost centers (company-scoped)
      const { data: ccData, error: ccError } = await supabase
        .from('cost_centers')
        .select('*')
        .eq('company_id', COMPANY_ID)
        .eq('is_active', true)
        .order('label');

      if (ccError) throw ccError;
      setCostCenters(ccData || []);

      // Load employee documents (company-scoped)
      const { data: docsData } = await supabase
        .from('employee_documents')
        .select('*')
        .eq('company_id', COMPANY_ID)
        .order('created_at', { ascending: false });
      setEmployeeDocs(docsData || []);

      setLastUpdateTime(new Date().toLocaleString('it-IT'));
    } catch (err) {
      console.error('Errore nel caricamento dati:', err);
    } finally {
      setLoading(false);
    }
  };

  // ========== HELPER FUNCTIONS ==========

  const formatCurrency = (value) =>
    new Intl.NumberFormat('it-IT', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value || 0);

  const getEmployeeAllocations = (employeeId) => {
    return allocations.filter(a => a.employee_id === employeeId);
  };

  const getEmployeeCosts = (employeeId, year, month) => {
    return costs.find(
      c => c.employee_id === employeeId && c.year === year && c.month === month
    );
  };

  const getEmployeesGroupedByOutlet = (year, month) => {
    const grouped = {};
    OUTLETS_ORDER.forEach(outlet => {
      grouped[outlet] = [];
    });

    employees.forEach(emp => {
      const empsAllocations = getEmployeeAllocations(emp.id);
      const empCost = getEmployeeCosts(emp.id, year, month);

      if (empsAllocations.length === 0) return;

      empsAllocations.forEach(alloc => {
        if (!grouped[alloc.outlet_code]) {
          grouped[alloc.outlet_code] = [];
        }
        grouped[alloc.outlet_code].push({
          ...emp,
          allocation: alloc,
          cost: empCost,
        });
      });
    });

    return grouped;
  };

  const calculateOutletTotals = (year, month) => {
    const grouped = getEmployeesGroupedByOutlet(year, month);
    const totals = {};

    OUTLETS_ORDER.forEach(outlet => {
      const emps = grouped[outlet];
      const costTotal = emps.reduce((sum, emp) => {
        if (!emp.cost) return sum;
        const allocPct = (emp.allocation?.allocation_pct || 100) / 100;
        const costValue = emp.cost.totale_costo || 0;
        return sum + costValue * allocPct;
      }, 0);

      totals[outlet] = {
        count: emps.length,
        totale: costTotal,
      };
    });

    return totals;
  };

  // ========== 2025 CONSUNTIVO MEMOIZED DATA ==========

  const consuntivo2025ByOutlet = useMemo(() => {
    return getEmployeesGroupedByOutlet(2025, selectedMonth);
  }, [employees, allocations, costs, selectedMonth]);

  const consuntivo2025Totals = useMemo(() => {
    return calculateOutletTotals(2025, selectedMonth);
  }, [employees, allocations, costs, selectedMonth]);

  const totalEmployees2025 = useMemo(() => {
    return Object.values(consuntivo2025ByOutlet).reduce(
      (sum, emps) => sum + new Set(emps.map(e => e.id)).size,
      0
    );
  }, [consuntivo2025ByOutlet]);

  const totalCosto2025 = useMemo(() => {
    return Object.values(consuntivo2025Totals).reduce((sum, t) => sum + t.totale, 0);
  }, [consuntivo2025Totals]);

  // ========== 2026 ORGANICO MEMOIZED DATA ==========

  const organico2026ByOutlet = useMemo(() => {
    return getEmployeesGroupedByOutlet(2026, selectedMonth);
  }, [employees, allocations, costs, selectedMonth]);

  const organico2026Totals = useMemo(() => {
    return calculateOutletTotals(2026, selectedMonth);
  }, [employees, allocations, costs, selectedMonth]);

  const totalEmployees2026 = useMemo(() => {
    return Object.values(organico2026ByOutlet).reduce(
      (sum, emps) => sum + new Set(emps.map(e => e.id)).size,
      0
    );
  }, [organico2026ByOutlet]);

  const totalCosto2026 = useMemo(() => {
    return Object.values(organico2026Totals).reduce((sum, t) => sum + t.totale, 0);
  }, [organico2026Totals]);

  const deltaCosto = totalCosto2026 - totalCosto2025;
  const deltaPercent = totalCosto2025 > 0 ? ((deltaCosto / totalCosto2025) * 100).toFixed(1) : 0;

  // ========== CHART DATA ==========

  const chart2025Data = OUTLETS_ORDER
    .filter(outlet => consuntivo2025Totals[outlet]?.totale > 0)
    .map(outlet => ({
      name: outlet,
      costo: consuntivo2025Totals[outlet].totale,
    }));

  const chartComparison = OUTLETS_ORDER.map(outlet => ({
    outlet,
    '2025': consuntivo2025Totals[outlet]?.totale || 0,
    '2026': organico2026Totals[outlet]?.totale || 0,
  }));

  // ========== EMPLOYEE FORM HANDLERS ==========

  const handleSaveEmployee = async (formData) => {
    // Validazioni — campi obbligatori
    if (!formData.nome?.trim() || !formData.cognome?.trim()) {
      showToast('Nome e cognome sono obbligatori', 'error'); return;
    }
    if (!formData.data_assunzione) {
      showToast('La data di assunzione è obbligatoria', 'error'); return;
    }
    if (!formData.contratto) {
      showToast('Il tipo di contratto è obbligatorio', 'error'); return;
    }
    // Per contratti diversi da indeterminato, la data di cessazione e' obbligatoria
    if (formData.contratto !== 'indeterminato' && !formData.data_cessazione) {
      showToast(`Per contratto "${formData.contratto}" la data di cessazione è obbligatoria`, 'error'); return;
    }
    if (formData.codice_fiscale && formData.codice_fiscale.length > 0 && formData.codice_fiscale.length !== 16) {
      showToast('Il codice fiscale deve avere 16 caratteri', 'error'); return;
    }
    // Duplicate check
    if (!editingEmployee) {
      const dup = employees.find(e =>
        e.cognome?.toLowerCase() === formData.cognome?.toLowerCase() &&
        e.nome?.toLowerCase() === formData.nome?.toLowerCase()
      );
      if (dup) {
        if (!confirm(`Dipendente "${formData.cognome} ${formData.nome}" esiste già. Creare comunque?`)) return;
      }
    }
    try {
      // Mappa i campi del form ai nomi colonna effettivi del DB
      const dbPayload = mapFormToDb(formData);
      if (editingEmployee) {
        const { error } = await supabase
          .from('employees')
          .update(dbPayload)
          .eq('id', editingEmployee.id);
        if (error) throw error;
        showToast('Dipendente aggiornato', 'success');
      } else {
        const { error } = await supabase
          .from('employees')
          .insert([{ ...dbPayload, company_id: COMPANY_ID, is_active: true }]);
        if (error) throw error;
        showToast(
          'Dipendente creato. Per vederlo nei consuntivi assegnagli un outlet (icona allocazione %).',
          'success'
        );
      }
      await loadAllData();
      setShowEmployeeForm(false);
      setEditingEmployee(null);
    } catch (err) {
      console.error('Errore nel salvataggio dipendente:', err);
      showToast('Errore nel salvataggio: ' + err.message, 'error');
    }
  };

  const handleDeleteEmployee = async (empId) => {
    try {
      const { error } = await supabase
        .from('employees')
        .update({ is_active: false })
        .eq('id', empId);
      if (error) throw error;
      await loadAllData();
    } catch (err) {
      console.error('Errore nella cancellazione:', err);
    }
  };

  // ========== COST FORM HANDLERS ==========

  const handleSaveCost = async (costData) => {
    try {
      if (editingCost) {
        const { error } = await supabase
          .from('employee_costs')
          .update(costData)
          .eq('id', editingCost.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('employee_costs')
          .insert([costData]);
        if (error) throw error;
      }
      await loadAllData();
      setShowCostForm(false);
      setEditingCost(null);
    } catch (err) {
      console.error('Errore nel salvataggio costo:', err);
    }
  };

  const handleDeleteCost = async (costId) => {
    try {
      const { error } = await supabase
        .from('employee_costs')
        .delete()
        .eq('id', costId);
      if (error) throw error;
      await loadAllData();
    } catch (err) {
      console.error('Errore nella cancellazione costo:', err);
    }
  };

  // ========== FILE UPLOAD HANDLER ==========

  const handleFileUpload = async (file, employeeId, docType) => {
    try {
      setUploadingEmployee(employeeId);

      const fileExt = file.name.split('.').pop();
      const fileName = `${employeeId}_${Date.now()}.${fileExt}`;
      const filePath = `employee-documents/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('employee-documents')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Create document record
      const { error: docError } = await supabase
        .from('employee_documents')
        .insert([
          {
            employee_id: employeeId,
            doc_type: docType,
            year: selectedYear,
            month: selectedMonth,
            file_name: file.name,
            file_path: filePath,
            file_size: file.size,
            status: 'uploaded',
          },
        ]);

      if (docError) throw docError;

      await loadAllData();
      setShowDocumentUpload(false);
    } catch (err) {
      console.error('Errore nel caricamento file:', err);
    } finally {
      setUploadingEmployee(null);
    }
  };

  // ========== ALLOCATION EDITOR ==========

  const openAllocEditor = (empId) => {
    const empAllocs = allocations.filter(a => a.employee_id === empId);
    setAllocEdits(empAllocs.length > 0
      ? empAllocs.map(a => ({ ...a }))
      : [{ employee_id: empId, outlet_code: '', allocation_pct: 100 }]
    );
    setAllocErrors('');
    setShowAllocEditor(empId);
  };

  const handleSaveAllocations = async () => {
    // Validate total doesn't exceed 100%
    const total = allocEdits.reduce((s, a) => s + (parseFloat(a.allocation_pct) || 0), 0);
    if (total > 100.01) {
      setAllocErrors(`Le allocazioni sommano ${total.toFixed(1)}% — il massimo è 100%`);
      return;
    }
    if (allocEdits.some(a => !a.outlet_code)) {
      setAllocErrors('Selezionare un outlet per ogni allocazione');
      return;
    }

    try {
      const empId = showAllocEditor;
      // Delete existing allocations
      await supabase.from('employee_outlet_allocations').delete().eq('employee_id', empId);
      // Insert new
      const rows = allocEdits.filter(a => a.outlet_code && a.allocation_pct > 0).map(a => ({
        employee_id: empId,
        outlet_code: a.outlet_code,
        allocation_pct: parseFloat(a.allocation_pct) || 0,
      }));
      if (rows.length > 0) {
        await supabase.from('employee_outlet_allocations').insert(rows);
      }
      setShowAllocEditor(null);
      await loadAllData();
    } catch (err) {
      console.error('Error saving allocations:', err);
      setAllocErrors('Errore nel salvataggio');
    }
  };

  // ========== BATCH IMPORT FROM EXCEL/CSV ==========

  const handleBatchImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBatchImporting(true);
    try {
      const text = await file.text();
      const lines = text.split('\n').filter(l => l.trim());
      const header = lines[0].split(';').map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));
      let imported = 0;

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(';').map(c => c.trim().replace(/^"|"$/g, ''));
        if (cols.length < 3) continue;

        const getValue = (key) => {
          const idx = header.indexOf(key);
          return idx >= 0 ? cols[idx] : '';
        };
        const getNum = (key) => {
          const v = getValue(key);
          return parseFloat(v?.replace('.', '').replace(',', '.')) || 0;
        };

        const cognome = getValue('cognome') || getValue('surname') || cols[0];
        const nome = getValue('nome') || getValue('name') || cols[1];
        if (!cognome) continue;

        // Find or create employee
        let empId;
        const { data: existing } = await supabase.from('employees')
          .select('id').eq('cognome', cognome).eq('nome', nome).maybeSingle();
        if (existing) {
          empId = existing.id;
        } else {
          const { data: newEmp } = await supabase.from('employees')
            .insert({ cognome, nome, is_active: true }).select('id').single();
          empId = newEmp?.id;
        }

        if (!empId) continue;

        // Import cost data
        const retrib = getNum('retribuzione') || getNum('lordo');
        const contributi = getNum('contributi');
        const inail = getNum('inail');
        const tfr = getNum('tfr');
        const totale = retrib + contributi + inail + tfr;

        if (totale > 0) {
          const month = parseInt(getValue('mese')) || selectedMonth;
          const year = parseInt(getValue('anno')) || selectedYear;

          await supabase.from('employee_costs').upsert({
            employee_id: empId,
            year,
            month,
            retribuzione: retrib,
            contributi,
            inail,
            tfr,
            totale_costo: totale,
          }, { onConflict: 'employee_id,year,month' });
        }

        // Import allocation if present
        const outlet = getValue('outlet') || getValue('punto_vendita');
        const allocPct = getNum('allocazione') || getNum('percentuale') || 100;
        if (outlet) {
          await supabase.from('employee_outlet_allocations').upsert({
            employee_id: empId,
            outlet_code: outlet,
            allocation_pct: allocPct,
          }, { onConflict: 'employee_id,outlet_code' });
        }

        imported++;
      }

      alert(`Importati ${imported} dipendenti`);
      await loadAllData();
    } catch (err) {
      console.error('Batch import error:', err);
      alert('Errore nell\'importazione');
    } finally {
      setBatchImporting(false);
      if (batchFileRef.current) batchFileRef.current.value = '';
    }
  };

  // ========== PDF CEDOLINO VIEWER ==========

  const handleViewDoc = async (doc) => {
    try {
      const { data, error } = await supabase.storage
        .from('employee-documents')
        .download(doc.file_path);
      if (error) throw error;
      const arrayBuffer = await data.arrayBuffer();
      setDocPdfData(arrayBuffer);
      setShowDocViewer(doc);
    } catch (err) {
      console.error('Error loading doc:', err);
    }
  };

  const getEmployeeDocs = (empId) => {
    return employeeDocs.filter(d => d.employee_id === empId);
  };

  // ========== TOGGLE HANDLERS ==========

  const toggleOutlet = (outlet) => {
    setExpandedOutlets(prev => ({
      ...prev,
      [outlet]: !prev[outlet],
    }));
  };

  const toggleEmployee = (key) => {
    setExpandedEmployees(prev => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  // ========== RENDER CONSUNTIVO 2025 VIEW ==========

  const renderConsuntivo2025 = () => (
    <div>
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="rounded-lg shadow-lg p-6 border-l-4 border-blue-600" style={{ background: "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)" }}>
          <p className="text-sm font-medium text-slate-600 mb-1">Totale Dipendenti</p>
          <p className="text-3xl font-bold text-slate-900">{totalEmployees2025}</p>
          <p className="text-xs text-slate-500 mt-2">
            Allocati su outlet · Anagrafica: <span className="font-semibold text-slate-700">{employees.length}</span>
            {employees.length > totalEmployees2025 && (
              <span className="text-amber-600 ml-1">({employees.length - totalEmployees2025} senza outlet)</span>
            )}
          </p>
        </div>

        <div className="rounded-lg shadow-lg p-6 border-l-4 border-emerald-600" style={{ background: "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)" }}>
          <p className="text-sm font-medium text-slate-600 mb-1">Costo Totale</p>
          <p className="text-2xl font-bold text-slate-900">{formatCurrency(totalCosto2025)}</p>
          <p className="text-xs text-slate-500 mt-2">Retrib. + Contrib. + INAIL</p>
        </div>

        <div className="rounded-lg shadow-lg p-6 border-l-4 border-sky-600" style={{ background: "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)" }}>
          <p className="text-sm font-medium text-slate-600 mb-1">Costo Medio</p>
          <p className="text-2xl font-bold text-slate-900">
            {formatCurrency(totalEmployees2025 > 0 ? totalCosto2025 / totalEmployees2025 : 0)}
          </p>
          <p className="text-xs text-slate-500 mt-2">Per dipendente</p>
        </div>
      </div>

      {/* Chart */}
      <div className="rounded-2xl shadow-lg p-6 mb-8" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg font-semibold text-slate-900">Costo per Outlet - Consuntivo 2025</h2>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chart2025Data}>
            <defs>
              <linearGradient id="grad-costo-2025" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2563eb" stopOpacity={1} />
                <stop offset="100%" stopColor="#2563eb" stopOpacity={0.5} />
              </linearGradient>
            </defs>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} {...AXIS_STYLE} />
            <YAxis {...AXIS_STYLE} />
            <Tooltip content={<GlassTooltip />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
            <Bar dataKey="costo" fill="url(#grad-costo-2025)" radius={[8, 8, 0, 0]} animationDuration={800} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Outlets Accordion */}
      <div className="space-y-4 mb-8">
        {OUTLETS_ORDER.map(outlet => {
          const emps = consuntivo2025ByOutlet[outlet] || [];
          if (emps.length === 0) return null;
          const totals = consuntivo2025Totals[outlet];

          return (
            <div key={outlet} className="bg-white rounded-lg shadow overflow-hidden">
              <button
                onClick={() => toggleOutlet(outlet)}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition"
              >
                <div className="flex items-center gap-4 text-left">
                  <div className={`w-4 h-4 rounded ${OUTLET_COLORS[outlet]}`} />
                  <h3 className="font-semibold text-slate-900">{outlet}</h3>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <p className="text-sm font-medium text-slate-900">{totals.count} dipendenti</p>
                    <p className="text-sm text-slate-600">{formatCurrency(totals.totale)}</p>
                  </div>
                  {expandedOutlets[outlet] ? (
                    <ChevronUp className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  )}
                </div>
              </button>

              {expandedOutlets[outlet] && (
                <div className="border-t border-slate-200 p-6 bg-slate-50 space-y-3">
                  {emps.map((emp, idx) => {
                    const empKey = `cons-${outlet}-${emp.id}`;
                    const totale = emp.cost?.totale_costo || 0;
                    const allocPct = (emp.allocation?.allocation_pct || 100) / 100;

                    return (
                      <div key={idx} className="bg-white rounded border border-slate-200 overflow-hidden">
                        <button
                          onClick={() => toggleEmployee(empKey)}
                          className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition"
                        >
                          <div className="text-left flex-1">
                            <p className="font-medium text-slate-900">
                              {emp.cognome} {emp.nome}
                            </p>
                            {allocPct < 1 && (
                              <p className="text-xs text-slate-500">{(allocPct * 100).toFixed(0)}% allocato</p>
                            )}
                          </div>
                          <div className="flex items-center gap-6">
                            <p className="text-sm font-medium text-slate-900">{formatCurrency(totale * allocPct)}</p>
                            {expandedEmployees[empKey] ? (
                              <ChevronUp className="w-4 h-4 text-slate-400" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-slate-400" />
                            )}
                          </div>
                        </button>

                        {expandedEmployees[empKey] && (
                          <div className="border-t border-slate-200 px-4 py-4 bg-slate-50 space-y-3">
                            {emp.cost ? (
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div>
                                  <p className="text-xs text-slate-600 font-medium mb-1">Retribuzione</p>
                                  <p className="text-sm font-semibold text-slate-900">{formatCurrency(emp.cost.retribuzione)}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-slate-600 font-medium mb-1">Contributi</p>
                                  <p className="text-sm font-semibold text-slate-900">{formatCurrency(emp.cost.contributi)}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-slate-600 font-medium mb-1">INAIL</p>
                                  <p className="text-sm font-semibold text-slate-900">{formatCurrency(emp.cost.inail)}</p>
                                </div>
                                <div className="bg-blue-50 rounded p-2">
                                  <p className="text-xs text-blue-700 font-medium mb-1">Totale</p>
                                  <p className="text-sm font-bold text-blue-900">{formatCurrency(totale * allocPct)}</p>
                                </div>
                              </div>
                            ) : (
                              <p className="text-xs text-slate-400">Nessun dato di costo per questo mese</p>
                            )}
                            <div className="flex items-center gap-2">
                              <button onClick={() => openAllocEditor(emp.id)}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 rounded border border-indigo-200">
                                <Sliders className="w-3 h-3" /> Allocazioni
                              </button>
                              <button onClick={() => setShowDocumentUpload(emp.id)}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded border border-blue-200">
                                <FileText className="w-3 h-3" /> Cedolini ({getEmployeeDocs(emp.id).length})
                              </button>
                              <button onClick={() => { setEditingCost(emp.cost); setShowCostForm(true) }}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded border border-slate-200">
                                <Edit2 className="w-3 h-3" /> {emp.cost ? 'Modifica costo' : 'Aggiungi costo'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  // ========== RENDER ORGANICO 2026 VIEW ==========

  const renderOrganico2026 = () => (
    <div>
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="rounded-lg shadow-lg p-6 border-l-4 border-blue-600" style={{ background: "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)" }}>
          <p className="text-sm font-medium text-slate-600 mb-1">Dipendenti 2026</p>
          <p className="text-3xl font-bold text-slate-900">{totalEmployees2026}</p>
          <p className="text-xs text-slate-500 mt-2">
            Allocati su outlet · Anagrafica: <span className="font-semibold text-slate-700">{employees.length}</span>
            {employees.length > totalEmployees2026 && (
              <span className="text-amber-600 ml-1">({employees.length - totalEmployees2026} senza outlet)</span>
            )}
          </p>
        </div>

        <div className="rounded-lg shadow-lg p-6 border-l-4 border-emerald-600" style={{ background: "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)" }}>
          <p className="text-sm font-medium text-slate-600 mb-1">Costo Stimato 2026</p>
          <p className="text-2xl font-bold text-slate-900">{formatCurrency(totalCosto2026)}</p>
          <p className="text-xs text-slate-500 mt-2">Totale organico</p>
        </div>

        <div className={`rounded-lg shadow-lg p-6 border-l-4 ${deltaCosto >= 0 ? "border-rose-600" : "border-green-600"}`} style={{ background: "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)" }}>
          <p className="text-sm font-medium text-slate-600 mb-1">Delta vs 2025</p>
          <p className={`text-2xl font-bold ${deltaCosto >= 0 ? 'text-rose-600' : 'text-green-600'}`}>
            {formatCurrency(deltaCosto)}
          </p>
          <p className="text-xs text-slate-500 mt-2">{deltaPercent}%</p>
        </div>

        <div className="rounded-lg shadow-lg p-6 border-l-4 border-sky-600" style={{ background: "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)" }}>
          <p className="text-sm font-medium text-slate-600 mb-1">Costo Medio</p>
          <p className="text-2xl font-bold text-slate-900">
            {formatCurrency(totalEmployees2026 > 0 ? totalCosto2026 / totalEmployees2026 : 0)}
          </p>
          <p className="text-xs text-slate-500 mt-2">Per dipendente</p>
        </div>
      </div>

      {/* Comparison Chart */}
      <div className="rounded-2xl shadow-lg p-6 mb-8" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg font-semibold text-slate-900">Confronto 2025 vs 2026</h2>
        </div>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={chartComparison}>
            <defs>
              <linearGradient id="grad-2025" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2563eb" stopOpacity={1} />
                <stop offset="100%" stopColor="#2563eb" stopOpacity={0.5} />
              </linearGradient>
              <linearGradient id="grad-2026" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#059669" stopOpacity={1} />
                <stop offset="100%" stopColor="#059669" stopOpacity={0.5} />
              </linearGradient>
            </defs>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="outlet" angle={-45} textAnchor="end" height={100} {...AXIS_STYLE} />
            <YAxis {...AXIS_STYLE} />
            <Tooltip content={<GlassTooltip />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
            <Legend />
            <Bar dataKey="2025" fill="url(#grad-2025)" radius={[8, 8, 0, 0]} animationDuration={800} />
            <Bar dataKey="2026" fill="url(#grad-2026)" radius={[8, 8, 0, 0]} animationDuration={800} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Outlets Accordion */}
      <div className="space-y-4 mb-8">
        {OUTLETS_ORDER.map(outlet => {
          const emps = organico2026ByOutlet[outlet] || [];
          if (emps.length === 0) return null;
          const totals = organico2026Totals[outlet];

          return (
            <div key={outlet} className="bg-white rounded-lg shadow overflow-hidden">
              <button
                onClick={() => toggleOutlet(outlet)}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition"
              >
                <div className="flex items-center gap-4 text-left">
                  <div className={`w-4 h-4 rounded ${OUTLET_COLORS[outlet]}`} />
                  <h3 className="font-semibold text-slate-900">{outlet}</h3>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <p className="text-sm font-medium text-slate-900">{totals.count} dipendenti</p>
                    <p className="text-sm text-slate-600">{formatCurrency(totals.totale)}</p>
                  </div>
                  {expandedOutlets[outlet] ? (
                    <ChevronUp className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  )}
                </div>
              </button>

              {expandedOutlets[outlet] && (
                <div className="border-t border-slate-200 p-6 bg-slate-50 space-y-3">
                  {emps.map((emp, idx) => {
                    const empKey = `org-${outlet}-${emp.id}`;
                    const totale = emp.cost?.totale_costo || 0;
                    const allocPct = (emp.allocation?.allocation_pct || 100) / 100;

                    return (
                      <div key={idx} className="bg-white rounded border border-slate-200 overflow-hidden">
                        <button
                          onClick={() => toggleEmployee(empKey)}
                          className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition"
                        >
                          <div className="text-left flex-1">
                            <p className="font-medium text-slate-900">
                              {emp.cognome} {emp.nome}
                            </p>
                            {allocPct < 1 && (
                              <p className="text-xs text-slate-500">{(allocPct * 100).toFixed(0)}% allocato</p>
                            )}
                          </div>
                          <div className="flex items-center gap-4">
                            <p className="text-sm font-medium text-slate-900 w-32 text-right">
                              {formatCurrency(totale * allocPct)}
                            </p>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingCost(emp.cost);
                                setShowCostForm(true);
                              }}
                              className="text-slate-400 hover:text-blue-600 transition"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            {expandedEmployees[empKey] ? (
                              <ChevronUp className="w-4 h-4 text-slate-400" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-slate-400" />
                            )}
                          </div>
                        </button>

                        {expandedEmployees[empKey] && emp.cost && (
                          <div className="border-t border-slate-200 px-4 py-4 bg-slate-50 space-y-4">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                              <div>
                                <p className="text-xs text-slate-600 font-medium mb-1">Retribuzione</p>
                                <p className="text-sm font-semibold text-slate-900">{formatCurrency(emp.cost.retribuzione)}</p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-600 font-medium mb-1">Contributi</p>
                                <p className="text-sm font-semibold text-slate-900">{formatCurrency(emp.cost.contributi)}</p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-600 font-medium mb-1">INAIL</p>
                                <p className="text-sm font-semibold text-slate-900">{formatCurrency(emp.cost.inail)}</p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-600 font-medium mb-1">TFR</p>
                                <p className="text-sm font-semibold text-slate-900">{formatCurrency(emp.cost.tfr)}</p>
                              </div>
                            </div>
                            <button
                              onClick={() => setShowDocumentUpload(emp.id)}
                              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded border border-blue-300"
                            >
                              <Upload className="w-4 h-4" />
                              Carica cedolino
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  // ========== SUMMARY TABLE ==========

  const renderSummaryTable = () => (
    <div className="rounded-2xl shadow-lg overflow-hidden mb-8" style={{ background: "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)", border: "1px solid rgba(99,102,241,0.08)" }}>
      <div className="px-6 py-4 border-b border-slate-200">
        <h2 className="text-lg font-semibold text-slate-900">
          Riepilogo {viewMode === 'consuntivo' ? 'Consuntivo 2025' : 'Organico 2026'}
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-6 py-3 text-left font-semibold text-slate-900">Outlet</th>
              <th className="px-6 py-3 text-right font-semibold text-slate-900">Dipendenti</th>
              <th className="px-6 py-3 text-right font-semibold text-slate-900">Totale Costo</th>
            </tr>
          </thead>
          <tbody>
            {OUTLETS_ORDER.map((outlet, idx) => {
              const totals = viewMode === 'consuntivo' ? consuntivo2025Totals[outlet] : organico2026Totals[outlet];
              if (!totals) return null;

              return (
                <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                  <td className="px-6 py-3 font-medium text-slate-900">{outlet}</td>
                  <td className="px-6 py-3 text-right text-slate-600">{totals.count}</td>
                  <td className="px-6 py-3 text-right font-semibold text-slate-900">
                    {formatCurrency(totals.totale)}
                  </td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-slate-300 bg-slate-100 font-bold">
              <td className="px-6 py-3 text-slate-900">TOTALE GENERALE</td>
              <td className="px-6 py-3 text-right text-slate-900">
                {viewMode === 'consuntivo' ? totalEmployees2025 : totalEmployees2026}
              </td>
              <td className="px-6 py-3 text-right text-slate-900">
                {formatCurrency(viewMode === 'consuntivo' ? totalCosto2025 : totalCosto2026)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );

  // ========== MAIN RENDER ==========

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-slate-600">Caricamento dati...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
      {/* Toast inline (sostituisce alert() di sistema) */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-[100] max-w-md px-4 py-3 rounded-lg shadow-lg border text-sm flex items-start gap-2 animate-in slide-in-from-top-2 ${
            toast.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-800'
              : toast.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-blue-50 border-blue-200 text-blue-800'
          }`}
          role="alert"
        >
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span className="flex-1">{toast.msg}</span>
          <button
            onClick={() => setToast(null)}
            className="text-current opacity-60 hover:opacity-100 shrink-0"
            aria-label="Chiudi"
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Gestione Dipendenti</h1>
          <p className="text-slate-600">New Zago S.R.L. ERP | Costi Personale 2025-2026</p>
          {lastUpdateTime && (
            <div className="flex items-center gap-2 text-xs text-slate-500 mt-2">
              <Clock className="w-3 h-3" />
              Dati aggiornati: {lastUpdateTime}
            </div>
          )}
        </div>

        {/* Bilancio costo personale banner */}
        {employees.length === 0 && bilancioCostoPersonale > 0 && (
          <div className="mb-8 rounded-lg border border-blue-200 bg-blue-50 p-5 flex items-start gap-4">
            <AlertCircle className="w-6 h-6 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-blue-900 mb-1">
                Dal bilancio importato risultano {formatCurrency(bilancioCostoPersonale)} di costo personale.
              </p>
              <p className="text-sm text-blue-700">
                Importa i cedolini per vedere il dettaglio per dipendente.{' '}
                <a href="/import-hub" className="font-medium underline hover:text-blue-900">
                  Vai a Import Hub &rarr;
                </a>
              </p>
            </div>
          </div>
        )}

        {/* Period Selector */}
        <div className="flex gap-4 mb-8 flex-wrap">
          <div className="flex gap-2">
            <label className="text-sm font-medium text-slate-600 pt-2">Anno:</label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              className="px-4 py-2 border border-slate-300 rounded-lg bg-white"
            >
              <option>2025</option>
              <option>2026</option>
            </select>
          </div>
          <div className="flex gap-2">
            <label className="text-sm font-medium text-slate-600 pt-2">Mese:</label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
              className="px-4 py-2 border border-slate-300 rounded-lg bg-white"
            >
              {MONTHS.map(m => (
                <option key={m.num} value={m.num}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* View Toggle */}
        <div className="flex gap-4 mb-8">
          <button
            onClick={() => setViewMode('consuntivo')}
            className={`px-6 py-3 rounded-lg font-medium transition ${
              viewMode === 'consuntivo'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-900 border border-slate-300 hover:bg-slate-50'
            }`}
          >
            Consuntivo 2025
          </button>
          <button
            onClick={() => setViewMode('organico')}
            className={`px-6 py-3 rounded-lg font-medium transition ${
              viewMode === 'organico'
                ? 'bg-emerald-600 text-white'
                : 'bg-white text-slate-900 border border-slate-300 hover:bg-slate-50'
            }`}
          >
            Organico 2026
          </button>
          <button
            onClick={() => setShowEmployeeForm(true)}
            className="flex items-center gap-2 px-6 py-3 rounded-lg font-medium bg-white text-slate-900 border border-slate-300 hover:bg-slate-50 transition ml-auto"
          >
            <Plus className="w-4 h-4" />
            Nuovo dipendente
          </button>
        </div>

        {/* Content */}
        {viewMode === 'consuntivo' ? renderConsuntivo2025() : renderOrganico2026()}

        {/* Summary Table */}
        {renderSummaryTable()}

        {/* Export & Actions */}
        <div className="flex justify-end gap-3">
          <label className="flex items-center gap-2 px-4 py-2 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 transition font-medium cursor-pointer border border-indigo-200">
            <FileUp className="w-4 h-4" />
            {batchImporting ? 'Importazione...' : 'Import batch CSV'}
            <input ref={batchFileRef} type="file" accept=".csv,.txt,.xlsx" onChange={handleBatchImport} className="hidden" disabled={batchImporting} />
          </label>
          <ExportMenu
            data={(() => {
              const year = viewMode === 'consuntivo' ? 2025 : 2026;
              const yearCosts = costs.filter(c => c.year === year);
              const rows = [];
              employees.forEach(emp => {
                const empCosts = yearCosts.filter(c => c.employee_id === emp.id);
                const empAllocs = allocations.filter(a => a.employee_id === emp.id);
                const outletName = empAllocs.length > 0
                  ? costCenters.find(cc => cc.id === empAllocs[0].cost_center_id)?.label || '-' : '-';
                const allocPct = empAllocs.length > 0 ? empAllocs[0].allocation_pct : 100;
                if (empCosts.length === 0) {
                  rows.push({ cognome: emp.cognome, nome: emp.nome, qualifica: emp.qualifica || '', contratto: emp.contratto || '', outlet: outletName, allocazione: allocPct, mese: '-', retribuzione: 0, contributi: 0, inail: 0, tfr: 0, totale: 0 });
                } else {
                  empCosts.forEach(c => {
                    const tot = (c.retribuzione || 0) + (c.contributi || 0) + (c.inail || 0) + (c.tfr || 0);
                    rows.push({ cognome: emp.cognome, nome: emp.nome, qualifica: emp.qualifica || '', contratto: emp.contratto || '', outlet: outletName, allocazione: allocPct, mese: c.month, retribuzione: c.retribuzione || 0, contributi: c.contributi || 0, inail: c.inail || 0, tfr: c.tfr || 0, totale: tot });
                  });
                }
              });
              return rows;
            })()}
            columns={[
              { key: 'cognome', label: 'Cognome' },
              { key: 'nome', label: 'Nome' },
              { key: 'qualifica', label: 'Qualifica' },
              { key: 'contratto', label: 'Contratto' },
              { key: 'outlet', label: 'Outlet' },
              { key: 'allocazione', label: 'Allocazione %' },
              { key: 'mese', label: 'Mese' },
              { key: 'retribuzione', label: 'Retribuzione', format: 'euro' },
              { key: 'contributi', label: 'Contributi', format: 'euro' },
              { key: 'inail', label: 'INAIL', format: 'euro' },
              { key: 'tfr', label: 'TFR', format: 'euro' },
              { key: 'totale', label: 'Totale', format: 'euro' },
            ]}
            filename={`dipendenti_${viewMode === 'consuntivo' ? 2025 : 2026}`}
            title="Dipendenti — Costi del Personale"
          />
        </div>

        {/* ===== MODAL: EMPLOYEE FORM ===== */}
        {showEmployeeForm && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => { setShowEmployeeForm(false); setEditingEmployee(null) }}>
            <div className="bg-white rounded-2xl shadow-xl p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900">{editingEmployee ? 'Modifica dipendente' : 'Nuovo dipendente'}</h3>
                <button onClick={() => { setShowEmployeeForm(false); setEditingEmployee(null) }} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
              </div>
              <EmployeeFormInner
                initial={editingEmployee}
                onSave={handleSaveEmployee}
                onCancel={() => { setShowEmployeeForm(false); setEditingEmployee(null) }}
              />
            </div>
          </div>
        )}

        {/* ===== MODAL: COST FORM ===== */}
        {showCostForm && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => { setShowCostForm(false); setEditingCost(null) }}>
            <div className="bg-white rounded-2xl shadow-xl p-6 max-w-lg w-full mx-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900">{editingCost ? 'Modifica costo' : 'Nuovo costo'}</h3>
                <button onClick={() => { setShowCostForm(false); setEditingCost(null) }} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
              </div>
              <CostFormInner
                initial={editingCost}
                employees={employees}
                selectedYear={selectedYear}
                selectedMonth={selectedMonth}
                onSave={handleSaveCost}
                onCancel={() => { setShowCostForm(false); setEditingCost(null) }}
              />
            </div>
          </div>
        )}

        {/* ===== MODAL: ALLOCATION EDITOR ===== */}
        {showAllocEditor && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowAllocEditor(null)}>
            <div className="bg-white rounded-2xl shadow-xl p-6 max-w-lg w-full mx-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Sliders size={18} /> Allocazione outlet
                </h3>
                <button onClick={() => setShowAllocEditor(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                {employees.find(e => e.id === showAllocEditor)?.cognome} {employees.find(e => e.id === showAllocEditor)?.nome}
              </p>

              <div className="space-y-2 mb-3">
                {allocEdits.map((alloc, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select value={alloc.outlet_code} onChange={e => {
                      const updated = [...allocEdits];
                      updated[i] = { ...updated[i], outlet_code: e.target.value };
                      setAllocEdits(updated);
                      setAllocErrors('');
                    }} className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm">
                      <option value="">Seleziona outlet...</option>
                      {OUTLETS_ORDER.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <div className="flex items-center gap-1">
                      <input type="number" min="0" max="100" step="5"
                        value={alloc.allocation_pct}
                        onChange={e => {
                          const updated = [...allocEdits];
                          updated[i] = { ...updated[i], allocation_pct: parseFloat(e.target.value) || 0 };
                          setAllocEdits(updated);
                          setAllocErrors('');
                        }}
                        className="w-20 px-2 py-2 border border-slate-300 rounded-lg text-sm text-right" />
                      <Percent size={14} className="text-slate-400" />
                    </div>
                    {allocEdits.length > 1 && (
                      <button onClick={() => setAllocEdits(allocEdits.filter((_, j) => j !== i))}
                        className="p-1 text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                    )}
                  </div>
                ))}
              </div>

              {/* Total bar */}
              {(() => {
                const total = allocEdits.reduce((s, a) => s + (parseFloat(a.allocation_pct) || 0), 0);
                return (
                  <div className={`mb-3 p-2 rounded-lg text-xs font-medium flex items-center justify-between ${
                    total > 100.01 ? 'bg-red-50 text-red-700 border border-red-200' :
                    total === 100 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                    'bg-amber-50 text-amber-700 border border-amber-200'
                  }`}>
                    <span>Totale allocazione: {total.toFixed(0)}%</span>
                    {total > 100.01 && <AlertCircle size={14} />}
                  </div>
                );
              })()}

              {allocErrors && <p className="text-xs text-red-600 mb-3 flex items-center gap-1"><AlertCircle size={12} /> {allocErrors}</p>}

              <button onClick={() => setAllocEdits([...allocEdits, { employee_id: showAllocEditor, outlet_code: '', allocation_pct: 0 }])}
                className="text-sm text-blue-600 hover:text-blue-800 mb-4 flex items-center gap-1">
                <Plus size={14} /> Aggiungi outlet
              </button>

              <div className="flex gap-2">
                <button onClick={() => setShowAllocEditor(null)}
                  className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50">Annulla</button>
                <button onClick={handleSaveAllocations}
                  className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 flex items-center justify-center gap-1">
                  <Save size={14} /> Salva allocazioni
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===== MODAL: DOCUMENT VIEWER ===== */}
        {showDocViewer && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => { setShowDocViewer(null); setDocPdfData(null) }}>
            <div className="bg-white rounded-2xl shadow-xl p-4 max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-slate-900">{showDocViewer.file_name}</h3>
                <button onClick={() => { setShowDocViewer(null); setDocPdfData(null) }} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
              </div>
              {docPdfData ? (
                <Suspense fallback={<div className="p-8 text-center text-slate-400">Caricamento...</div>}>
                  <PdfViewer pdfData={docPdfData} />
                </Suspense>
              ) : (
                <div className="p-8 text-center text-slate-400">Caricamento documento...</div>
              )}
            </div>
          </div>
        )}

        {/* ===== MODAL: DOCUMENT UPLOAD ===== */}
        {showDocumentUpload && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowDocumentUpload(false)}>
            <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900">Carica cedolino</h3>
                <button onClick={() => setShowDocumentUpload(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
              </div>
              <p className="text-sm text-slate-500 mb-3">
                {employees.find(e => e.id === showDocumentUpload)?.cognome} {employees.find(e => e.id === showDocumentUpload)?.nome} — {MONTHS.find(m => m.num === selectedMonth)?.label} {selectedYear}
              </p>

              {/* List existing docs */}
              {getEmployeeDocs(showDocumentUpload).length > 0 && (
                <div className="mb-4 space-y-1">
                  <p className="text-xs text-slate-600 font-medium">Cedolini caricati:</p>
                  {getEmployeeDocs(showDocumentUpload).map(d => (
                    <div key={d.id} className="flex items-center justify-between p-2 bg-slate-50 rounded border border-slate-200 text-xs">
                      <span className="text-slate-700">{d.file_name} — {d.year}/{d.month}</span>
                      <button onClick={() => handleViewDoc(d)} className="text-blue-600 hover:text-blue-800 flex items-center gap-1">
                        <Eye size={12} /> Vedi
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <label className="flex items-center justify-center gap-2 p-6 border-2 border-dashed border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50 cursor-pointer transition">
                <Upload size={18} />
                {uploadingEmployee === showDocumentUpload ? 'Caricamento...' : 'Seleziona file PDF o Excel'}
                <input type="file" accept=".pdf,.xlsx,.xls,.csv" className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) handleFileUpload(f, showDocumentUpload, 'cedolino');
                  }}
                  disabled={uploadingEmployee === showDocumentUpload} />
              </label>
            </div>
          </div>
        )}
      </div>
      <PageHelp page="dipendenti" />
    </div>
  );
}

// ============================================================================
// FORM COMPONENTS (rendered inline as modals)
// ============================================================================

function EmployeeFormInner({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({
    nome: '', cognome: '', codice_fiscale: '',
    data_assunzione: '', data_cessazione: '', qualifica: '', livello: '',
    contratto: 'indeterminato', note: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initial) {
      // Mapping inverso DB -> form: in DB le colonne reali sono
      // contratto_tipo / role_description, ma il form ragiona in
      // contratto / qualifica. Fallback alle vecchie chiavi se presenti.
      setForm({
        nome: initial.nome || initial.first_name || '',
        cognome: initial.cognome || initial.last_name || '',
        codice_fiscale: initial.codice_fiscale || initial.fiscal_code || '',
        data_assunzione: initial.data_assunzione || initial.hire_date || '',
        data_cessazione: initial.data_cessazione || initial.termination_date || '',
        qualifica: initial.qualifica || initial.role_description || '',
        livello: initial.livello || initial.level || '',
        contratto: initial.contratto || initial.contratto_tipo || initial.contract_type || 'indeterminato',
        note: initial.note || initial.notes || '',
      });
    }
  }, [initial]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    await onSave(form);
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Cognome *</label>
          <input type="text" required value={form.cognome} onChange={e => setForm({ ...form, cognome: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Nome *</label>
          <input type="text" required value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Codice Fiscale</label>
        <input type="text" value={form.codice_fiscale} onChange={e => setForm({ ...form, codice_fiscale: e.target.value })} maxLength={16}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono uppercase" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Data assunzione *</label>
          <input type="date" required value={form.data_assunzione} onChange={e => setForm({ ...form, data_assunzione: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Data cessazione
            {form.contratto !== 'indeterminato' && form.contratto && <span className="text-red-500"> *</span>}
          </label>
          <input
            type="date"
            value={form.data_cessazione}
            onChange={e => setForm({ ...form, data_cessazione: e.target.value })}
            required={form.contratto && form.contratto !== 'indeterminato'}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
          {form.contratto === 'indeterminato' && (
            <p className="text-[10px] text-slate-400 mt-1">Lasciare vuoto per contratto a tempo indeterminato</p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Qualifica</label>
          <input type="text" value={form.qualifica} onChange={e => setForm({ ...form, qualifica: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Commessa" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Livello</label>
          <input type="text" value={form.livello} onChange={e => setForm({ ...form, livello: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="4°" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Contratto *</label>
          <select required value={form.contratto} onChange={e => setForm({ ...form, contratto: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
            <option value="indeterminato">Indeterminato</option>
            <option value="determinato">Determinato</option>
            <option value="apprendistato">Apprendistato</option>
            <option value="stagionale">Stagionale</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Note</label>
        <textarea value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} rows={2}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm resize-none" />
      </div>
      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onCancel} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50">Annulla</button>
        <button type="submit" disabled={saving}
          className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Salvataggio...' : initial ? 'Aggiorna' : 'Crea dipendente'}
        </button>
      </div>
    </form>
  );
}

function CostFormInner({ initial, employees, selectedYear, selectedMonth, onSave, onCancel }) {
  const [form, setForm] = useState({
    employee_id: '', year: selectedYear, month: selectedMonth,
    retribuzione: 0, contributi: 0, inail: 0, tfr: 0, totale_costo: 0,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initial) {
      setForm({
        employee_id: initial.employee_id || '',
        year: initial.year || selectedYear,
        month: initial.month || selectedMonth,
        retribuzione: initial.retribuzione || 0,
        contributi: initial.contributi || 0,
        inail: initial.inail || 0,
        tfr: initial.tfr || 0,
        totale_costo: initial.totale_costo || 0,
      });
    }
  }, [initial]);

  // Auto-calculate total
  useEffect(() => {
    const total = (parseFloat(form.retribuzione) || 0) + (parseFloat(form.contributi) || 0) +
      (parseFloat(form.inail) || 0) + (parseFloat(form.tfr) || 0);
    setForm(f => ({ ...f, totale_costo: total }));
  }, [form.retribuzione, form.contributi, form.inail, form.tfr]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    await onSave(form);
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {!initial && (
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Dipendente *</label>
          <select required value={form.employee_id} onChange={e => setForm({ ...form, employee_id: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
            <option value="">Seleziona...</option>
            {employees.map(emp => (
              <option key={emp.id} value={emp.id}>{emp.cognome} {emp.nome}</option>
            ))}
          </select>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Anno</label>
          <input type="number" value={form.year} onChange={e => setForm({ ...form, year: parseInt(e.target.value) })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Mese</label>
          <input type="number" min={1} max={12} value={form.month} onChange={e => setForm({ ...form, month: parseInt(e.target.value) })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Retribuzione</label>
          <input type="number" step="0.01" value={form.retribuzione} onChange={e => setForm({ ...form, retribuzione: parseFloat(e.target.value) || 0 })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Contributi</label>
          <input type="number" step="0.01" value={form.contributi} onChange={e => setForm({ ...form, contributi: parseFloat(e.target.value) || 0 })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">INAIL</label>
          <input type="number" step="0.01" value={form.inail} onChange={e => setForm({ ...form, inail: parseFloat(e.target.value) || 0 })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">TFR</label>
          <input type="number" step="0.01" value={form.tfr} onChange={e => setForm({ ...form, tfr: parseFloat(e.target.value) || 0 })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
        </div>
      </div>
      <div className="bg-blue-50 rounded-lg p-3">
        <p className="text-xs text-blue-700">Totale costo: <strong>{new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(form.totale_costo)}</strong></p>
      </div>
      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onCancel} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50">Annulla</button>
        <button type="submit" disabled={saving}
          className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Salvataggio...' : initial ? 'Aggiorna' : 'Salva costo'}
        </button>
      </div>
    </form>
  );
}
