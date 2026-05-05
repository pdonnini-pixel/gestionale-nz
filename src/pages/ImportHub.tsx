import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

// Tab ImportHub — persistito in URL come ?tab=
type ImportHubTab = 'sources' | 'overview' | 'history';
const VALID_IMPORT_HUB_TABS: ImportHubTab[] = ['sources', 'overview', 'history'];
import PageHelp from '../components/PageHelp';
import {
  Upload,
  Database,
  CheckCircle,
  AlertCircle,
  Play,
  Loader2,
  FileSearch,
  Zap,
  Clock,
  Settings,
  BarChart3,
  PieChart,
  FileText,
  Calendar,
  TrendingUp,
  Filter,
  RefreshCw,
  Eye,
  Trash2,
  FileUp,
  Paperclip,
  XCircle,
  X,
  ChevronDown,
  CheckSquare,
  Square,
  Store,
  ShieldCheck,
  FileWarning,
} from 'lucide-react';
import { BarChart, Bar, PieChart as RechartsPieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { processImport, previewImport } from '../lib/parsers/importEngine';
import { runAutoReconciliation, applyReconciliation } from '../lib/reconciliationEngine';

// Storage bucket mapping for each import source
type ImportSourceConfig = { name: string; description: string; formats: string; bucket: string; table: string; acceptedExt: string[]; requiresSelect?: string; category?: string; icon: string }
type ImportSourceId = 'bank' | 'invoices' | 'payroll' | 'balance_sheet' | 'general_docs' | 'pos_data' | 'receipts'
const IMPORT_SOURCE_CONFIG: Record<ImportSourceId, ImportSourceConfig> = {
  bank: {
    name: 'Estratti Conto Bancari',
    description: 'Movimenti bancari per riconciliazione',
    formats: 'CSV, XLSX, PDF',
    bucket: 'bank-statements',
    table: 'bank_imports',
    acceptedExt: ['.csv', '.xlsx', '.xls', '.pdf'],
    requiresSelect: 'bank_account',
    icon: 'building-2',
  },
  invoices: {
    name: 'Fatture Elettroniche',
    description: 'Fatture ricevute da AdE/SDI',
    formats: 'XML, PDF',
    bucket: 'invoices',
    table: 'documents',
    acceptedExt: ['.xml', '.pdf'],
    category: 'fattura',
    icon: 'file-text',
  },
  payroll: {
    name: 'Cedolini / Personale',
    description: 'Cedolini e riepilogo dipendenti',
    formats: 'PDF, XLSX',
    bucket: 'employee-documents',
    table: 'employee_documents',
    acceptedExt: ['.pdf', '.xlsx', '.xls'],
    requiresSelect: 'month_year',
    icon: 'users',
  },
  balance_sheet: {
    name: 'Bilanci',
    description: 'Bilanci annuali e gestioni',
    formats: 'PDF, XLSX',
    bucket: 'balance-sheets',
    table: 'balance_sheet_imports',
    acceptedExt: ['.pdf', '.xlsx', '.xls'],
    requiresSelect: 'year',
    icon: 'bar-chart-3',
  },
  general_docs: {
    name: 'Documenti Generali',
    description: 'Contratti, comunicazioni, altro',
    formats: 'Tutti i formati',
    bucket: 'general-documents',
    table: 'documents',
    acceptedExt: ['.pdf', '.docx', '.xlsx', '.txt', '.jpg', '.png'],
    requiresSelect: 'doc_category',
    icon: 'file-text',
  },
  pos_data: {
    name: 'POS Data',
    description: 'Dati vendite punti di vendita',
    formats: 'CSV, Excel',
    bucket: 'pos-data',
    table: 'pos_imports',
    acceptedExt: ['.csv', '.xlsx', '.xls'],
    requiresSelect: 'outlet',
    icon: 'store',
  },
  receipts: {
    name: 'Corrispettivi',
    description: 'Corrispettivi giornalieri AdE',
    formats: 'CSV, XML',
    bucket: 'receipts',
    table: 'receipt_imports',
    acceptedExt: ['.csv', '.xml'],
    requiresSelect: 'outlet',
    icon: 'receipt',
  },
};

export default function ImportHub() {
  const { profile } = useAuth();
  const COMPANY_ID = profile?.company_id;
  const navigate = useNavigate();

  // ─── POST-IMPORT EC MATCH MODAL STATE ─────────────────────────
  // Dopo un import EC mostra il riepilogo dei match automatici
  // calcolati tra cash_movements (uscite) e payables (da_pagare)
  type ReconciledMatch = { movement?: { id?: string; date?: string; amount?: number; description?: string }; payable?: { id?: string; supplier_name?: string; gross_amount?: number; due_date?: string; invoice_number?: string }; score?: number }
  type MatchModal = {
    reconciled?: ReconciledMatch[]
    suggested?: ReconciledMatch[]
    unmatched?: Array<{ id?: string; description?: string; amount?: number; date?: string }>
    stats?: { reconciled?: number; suggested?: number; unmatched?: number; reconciledAmount?: number; suggestedAmount?: number; unmatchedAmount?: number; total?: number; totalMovements?: number; skippedPOS?: number }
    bankAccountId?: string | null
  } | null
  type ImportDoc = Record<string, unknown> & { id?: string; file_name?: string | null; file_path?: string | null; file_size?: number | null; source_type?: string | null; created_at?: string | null }
  type BankAccount = { id: string; account_name?: string | null; bank_name?: string | null }
  type OutletLite = { id: string; name?: string | null }
  type Toast = { msg: string; type: string } | null
  const [matchModal, setMatchModal] = useState<MatchModal>(null);
  const [computingMatches, setComputingMatches] = useState(false);
  const [applyingMatches, setApplyingMatches] = useState(false);

  // activeTab persistito in URL come ?tab=… (default 'sources')
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: ImportHubTab = VALID_IMPORT_HUB_TABS.includes(tabParam as ImportHubTab)
    ? (tabParam as ImportHubTab)
    : 'sources';
  const setActiveTab = (next: ImportHubTab) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params);
  };
  const [selectedSource, setSelectedSource] = useState<ImportSourceId | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<ImportDoc[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [previewFile, setPreviewFile] = useState<ImportDoc | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [importHistory, setImportHistory] = useState<ImportDoc[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [selectedBankAccount, setSelectedBankAccount] = useState<string | null>(null);
  const [selectedDocCategory, setSelectedDocCategory] = useState('contratto');
  const [selectedMonthYear, setSelectedMonthYear] = useState('');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedOutlet, setSelectedOutlet] = useState('');
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [validationErrors, setValidationErrors] = useState<Record<string, string[]>>({});
  const [outlets, setOutlets] = useState<OutletLite[]>([]);
  const [toast, setToast] = useState<Toast>(null);

  // ─── PROCESSING STATE ───────────────────────────────────────
  const [processing, setProcessing] = useState(false);
  const [processProgress, setProcessProgress] = useState(0);
  const [processMessage, setProcessMessage] = useState('');
  type ProcessResult = {
    success?: boolean
    processed?: number
    errors?: string[]
    message?: string
    rowsImported?: number
    bankAccountId?: string | null
    details?: {
      fatture?: number; scadenze?: number; fornitore?: string;
      totalParsed?: number;
      anno?: number; attivita?: number; passivita?: number; costi?: number; ricavi?: number; risultato?: number;
      dipendentiTrovati?: number; dipendentiNonTrovati?: number; mese?: string;
    }
  } | null
  const [processResult, setProcessResult] = useState<ProcessResult>(null);
  type PreviewInvoice = { tipo_label?: string; invoice_number?: string; gross_amount?: number; supplier_name?: string; invoice_date?: string; net_amount?: number; vat_amount?: number }
  type PreviewData = {
    rows?: Array<Record<string, unknown>>
    headers?: string[]
    total?: number
    sample?: unknown[]
    fileRecord?: ImportDoc
    confidence?: number
    mapping?: Record<string, string>
    preview?: Record<string, unknown>[]
    sampleRows?: Array<Record<string, string | number | null | undefined>>
    totalRows?: number
    invoices?: PreviewInvoice[]
  } | null
  const [previewData, setPreviewData] = useState<PreviewData>(null);
  const pendingFileRef = useRef<File | null>(null); // holds the raw File for re-processing

  const months = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
  const years = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i);

  // Show toast notification
  const showToast = (msg: string, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Load bank accounts and outlets on mount
  useEffect(() => {
    if (!COMPANY_ID) return;
    loadBankAccounts();
    loadOutlets();
  }, [COMPANY_ID]);

  async function loadBankAccounts() {
    if (!COMPANY_ID) return;
    const { data } = await supabase
      .from('bank_accounts')
      .select('id, account_name, bank_name')
      .eq('company_id', COMPANY_ID)
      .eq('is_active', true)
      .order('bank_name', { ascending: true });
    setBankAccounts((data || []) as BankAccount[]);
  }

  async function loadOutlets() {
    if (!COMPANY_ID) return;
    const { data } = await supabase
      .from('outlets')
      .select('id, name')
      .eq('company_id', COMPANY_ID)
      .eq('is_active', true)
      .order('name', { ascending: true });
    setOutlets((data || []) as OutletLite[]);
  }

  // Load import documents based on active tab
  useEffect(() => {
    if (!COMPANY_ID) return;
    loadImportDocs();
  }, [activeTab, selectedSource, COMPANY_ID]);

  async function loadImportDocs() {
    if (!COMPANY_ID) return;
    const companyId = COMPANY_ID;
    setFilesLoading(true);
    try {
      if (activeTab === 'sources' && selectedSource) {
        const config = IMPORT_SOURCE_CONFIG[selectedSource];
        if (!config) {
          setUploadedFiles([]);
          setImportHistory([]);
          return;
        }

        // table name is dynamic — supabase typed client cannot validate it
        const { data } = await (supabase as unknown as { from: (t: string) => { select: (s: string) => { eq: (k: string, v: string) => { order: (c: string, opts: { ascending: boolean }) => Promise<{ data: ImportDoc[] | null }> } } } }).from(config.table).select('*').eq('company_id', companyId).order('created_at', { ascending: false });
        setUploadedFiles(((data as ImportDoc[] | null) || []));
        setBatchSelected(new Set());

        const { data: history } = await supabase
          .from('import_documents')
          .select('*')
          .eq('company_id', companyId)
          .eq('source', selectedSource)
          .order('uploaded_at', { ascending: false })
          .limit(20);
        setImportHistory(((history as ImportDoc[] | null) || []));
      } else {
        // Load all recent imports for both overview and history tabs
        const { data } = await supabase
          .from('import_documents')
          .select('*')
          .eq('company_id', companyId)
          .order('uploaded_at', { ascending: false })
          .limit(200);
        setImportHistory(((data as ImportDoc[] | null) || []));
      }
    } catch (err: unknown) {
      console.error('Load error:', err);
      showToast('Errore caricamento dati', 'error');
    } finally {
      setFilesLoading(false);
    }
  }

  async function openPreview(doc: ImportDoc) {
    setPreviewFile(doc);
    if (doc.file_path) {
      const sourceKey = (doc.source_type || selectedSource) as ImportSourceId | null;
      const config = sourceKey ? IMPORT_SOURCE_CONFIG[sourceKey] : null;
      const bucket = config?.bucket || 'general-documents';

      try {
        const { data } = await supabase.storage
          .from(bucket)
          .createSignedUrl(doc.file_path, 3600);
        if (data?.signedUrl) setPreviewUrl(data.signedUrl);
      } catch (err: unknown) {
        console.error('Preview error:', err);
      }
    }
  }

  function closePreview() {
    setPreviewFile(null);
    setPreviewUrl(null);
  }

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (selectedSource) {
      handleFileUpload(e.dataTransfer.files, selectedSource);
    }
  };

  // File validation: checks size, extension, required selectors
  function validateFile(file: File, config: ImportSourceConfig, sourceId: ImportSourceId): string[] {
    const errors: string[] = [];
    const MAX_SIZE = 50 * 1024 * 1024; // 50 MB
    if (file.size > MAX_SIZE) errors.push(`${file.name}: supera il limite di 50 MB`);
    if (file.size === 0) errors.push(`${file.name}: file vuoto`);
    const ext = file.name.toLowerCase().split('.').pop();
    if (!config.acceptedExt.some(e => e.replace('.', '') === ext)) {
      errors.push(`${file.name}: formato .${ext} non supportato`);
    }
    // Check required selectors
    if (sourceId === 'bank' && !selectedBankAccount) errors.push('Selezionare un conto bancario');
    if (sourceId === 'payroll' && !selectedMonthYear) errors.push('Selezionare mese e anno');
    if ((sourceId === 'pos_data' || sourceId === 'receipts') && !selectedOutlet) errors.push('Selezionare un punto vendita');
    return errors;
  }

  async function handleFileUpload(fileList: FileList | File[], sourceId: ImportSourceId) {
    if (!sourceId) return;

    const config = IMPORT_SOURCE_CONFIG[sourceId];
    if (!config) {
      showToast('Fonte non configurata', 'error');
      return;
    }

    const allFiles: File[] = Array.from(fileList);
    // Validate each file
    const allErrors: string[] = [];
    const validFiles: File[] = [];
    for (const f of allFiles) {
      const errs = validateFile(f, config, sourceId);
      if (errs.length) allErrors.push(...errs);
      else validFiles.push(f);
    }
    if (allErrors.length) {
      setValidationErrors(prev => ({ ...prev, [sourceId]: allErrors }));
      setTimeout(() => setValidationErrors(prev => { const n = { ...prev }; delete n[sourceId]; return n; }), 5000);
    }
    if (!validFiles.length) {
      if (!allErrors.length) showToast(`Formato non supportato. Accettati: ${config.acceptedExt.join(', ')}`, 'error');
      return;
    }
    const files = validFiles;

    setUploading(true);
    setUploadProgress(0);

    try {
      for (let idx = 0; idx < files.length; idx++) {
        const file = files[idx];
        const ts = Date.now();
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = `${COMPANY_ID}/imports/${sourceId}/${ts}_${safeName}`;

        // Upload to Supabase Storage
        const { error: storageErr } = await supabase.storage
          .from(config.bucket)
          .upload(filePath, file, { upsert: false });

        if (storageErr) {
          console.error('Storage error:', storageErr);
          setUploadProgress(((idx + 1) / files.length) * 100);
          continue;
        }

        // Create record in source-specific table
        // Column names MUST match the actual DB schema
        const fileExt = (file.name.split('.').pop() || '').toLowerCase();
        const record: Record<string, unknown> = { company_id: COMPANY_ID, file_name: file.name, file_path: filePath, file_size: file.size };

        if (sourceId === 'bank') {
          // bank_imports schema: file_format, status, bank_account_id
          record.file_format = fileExt;
          record.status = 'uploaded';
          if (selectedBankAccount) record.bank_account_id = selectedBankAccount;
        } else if (sourceId === 'invoices') {
          record.file_type = fileExt;
          record.upload_status = 'uploaded';
          record.category = 'fattura';
          record.document_status = 'pending_parsing';
        } else if (sourceId === 'payroll' && selectedMonthYear) {
          record.file_type = fileExt;
          record.upload_status = 'uploaded';
          const [month, year] = selectedMonthYear.split('-');
          record.month = parseInt(month);
          record.year = parseInt(year);
        } else if (sourceId === 'balance_sheet') {
          // balance_sheet_imports NON ha file_type — solo file_name, file_path, file_size
          record.status = 'uploaded';
          record.year = Number(selectedYear) || new Date().getFullYear();
          record.period_type = 'annuale';
          record.period_label = `Bilancio ${selectedYear || new Date().getFullYear()}`;
        } else if (sourceId === 'general_docs') {
          record.file_type = fileExt;
          record.upload_status = 'uploaded';
          record.category = selectedDocCategory;
        } else if (sourceId === 'pos_data' && selectedOutlet) {
          record.file_type = fileExt;
          record.upload_status = 'uploaded';
          record.outlet_id = selectedOutlet;
        } else if (sourceId === 'receipts' && selectedOutlet) {
          record.file_type = fileExt;
          record.upload_status = 'uploaded';
          record.outlet_id = selectedOutlet;
        } else {
          record.file_type = fileExt;
          record.upload_status = 'uploaded';
        }

        // Insert into source-specific table — table name dinamico
        const { error: insertErr } = await (supabase as unknown as { from: (t: string) => { insert: (rows: Record<string, unknown>[]) => { select: () => Promise<{ error: { message: string } | null }> } } }).from(config.table)
          .insert([record])
          .select();

        if (insertErr) {
          console.error(`Insert error for ${config.table}:`, insertErr);
          showToast(`Errore salvataggio ${file.name}: ${insertErr.message}`, 'error');
          setUploadProgress(((idx + 1) / files.length) * 100);
          continue; // Skip to next file — don't log incomplete upload
        }

        // Also log to import_documents for history
        // import_documents schema: file_type, source (not source_type, not status)
        await supabase.from('import_documents').insert([
          {
            company_id: COMPANY_ID,
            file_name: file.name,
            file_path: filePath,
            file_size: file.size,
            file_type: fileExt,
            source: sourceId,
          } as never,
        ]);

        setUploadProgress(((idx + 1) / files.length) * 100);
      }

      showToast(`${files.length} file caricati con successo${canProcess(sourceId) ? ' — premi "Processa" per importare i dati' : ''}`);
      // Keep last file reference for immediate processing
      if (files.length === 1 && canProcess(sourceId)) {
        pendingFileRef.current = files[0];
      }
      await loadImportDocs();
      setBatchSelected(new Set());
    } catch (err: unknown) {
      console.error('Upload error:', err);
      showToast('Errore durante il caricamento', 'error');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }

  async function handleRemoveFile(fileId: string, sourceId: ImportSourceId) {
    if (!window.confirm('Eliminare questo file? L\'azione non può essere annullata.')) return;

    try {
      const config = IMPORT_SOURCE_CONFIG[sourceId];
      const file = uploadedFiles.find(f => f.id === fileId);
      if (!file) return;

      if (file.file_path) {
        await supabase.storage.from(config.bucket).remove([file.file_path]);
      }
      await (supabase as unknown as { from: (t: string) => { delete: () => { eq: (k: string, v: string) => Promise<unknown> } } }).from(config.table).delete().eq('id', fileId);
      if (file.file_path) await supabase.from('import_documents').delete().eq('file_path', file.file_path);

      showToast('File eliminato');
      await loadImportDocs();
      setBatchSelected(prev => { const n = new Set(prev); n.delete(fileId); return n; });
    } catch (err: unknown) {
      console.error('Delete error:', err);
      showToast('Errore durante l\'eliminazione', 'error');
    }
  }

  // Batch delete selected files
  async function handleBatchDelete() {
    if (batchSelected.size === 0) return;
    if (!selectedSource) return;
    if (!window.confirm(`Eliminare ${batchSelected.size} file selezionati?`)) return;

    try {
      const config = IMPORT_SOURCE_CONFIG[selectedSource];
      const filesToDelete = uploadedFiles.filter(f => f.id && batchSelected.has(f.id));
      const paths = filesToDelete.map(f => f.file_path).filter((p): p is string => Boolean(p));
      if (paths.length) await supabase.storage.from(config.bucket).remove(paths);
      for (const f of filesToDelete) {
        if (f.id) await (supabase as unknown as { from: (t: string) => { delete: () => { eq: (k: string, v: string) => Promise<unknown> } } }).from(config.table).delete().eq('id', f.id);
        if (f.file_path) await supabase.from('import_documents').delete().eq('file_path', f.file_path);
      }
      showToast(`${filesToDelete.length} file eliminati`);
      setBatchSelected(new Set());
      await loadImportDocs();
    } catch (err: unknown) {
      console.error('Batch delete error:', err);
      showToast('Errore eliminazione batch', 'error');
    }
  }

  // Toggle batch selection
  const toggleBatchSelect = (fileId: string) => {
    setBatchSelected(prev => {
      const n = new Set(prev);
      if (n.has(fileId)) n.delete(fileId); else n.add(fileId);
      return n;
    });
  };
  const toggleSelectAll = () => {
    if (batchSelected.size === uploadedFiles.length) setBatchSelected(new Set());
    else setBatchSelected(new Set(uploadedFiles.map(f => f.id).filter((id): id is string => Boolean(id))));
  };

  // ─── PROCESSING FUNCTIONS ─────────────────────────────────────

  // Check if source type supports processing
  const canProcess = (sourceId: string | null) => ['bank', 'invoices', 'pos_data', 'receipts', 'balance_sheet', 'payroll'].includes(sourceId || '');

  // Preview a file before processing
  async function handlePreview(_file: ImportDoc, fileRecord: ImportDoc) {
    if (!canProcess(selectedSource) || !selectedSource) return;
    setPreviewData(null);

    try {
      // Download file from storage for preview
      const config = IMPORT_SOURCE_CONFIG[selectedSource];
      if (!fileRecord.file_path || !fileRecord.file_name) return;
      const { data: blob, error } = await supabase.storage.from(config.bucket).download(fileRecord.file_path);
      if (error || !blob) { showToast('Errore download file per anteprima', 'error'); return; }

      const fileObj = new File([blob], fileRecord.file_name);
      pendingFileRef.current = fileObj;

      const result = await (previewImport as unknown as (args: { file: File; sourceType: string; context: Record<string, unknown> }) => Promise<PreviewData & { fileRecord?: ImportDoc }>)({
        file: fileObj,
        sourceType: selectedSource,
        context: {
          company_id: COMPANY_ID,
          csvOptions: { skipRows: 0 },
        },
      });

      setPreviewData({ ...(result || {}), fileRecord } as PreviewData);
    } catch (err: unknown) {
      console.error('Preview error:', err);
      showToast('Errore anteprima: ' + (err as Error).message, 'error');
    }
  }

  // Process a file (parse + insert into DB)
  async function handleProcessFile(fileRecord: ImportDoc, mappingOverride: Record<string, unknown> | null = null) {
    if (!canProcess(selectedSource) || processing || !selectedSource) return;
    setProcessing(true);
    setProcessProgress(0);
    setProcessMessage('Avvio elaborazione...');
    setProcessResult(null);

    try {
      const config = IMPORT_SOURCE_CONFIG[selectedSource];

      // Use pending file ref or download from storage
      let fileObj = pendingFileRef.current;
      if ((!fileObj || fileObj.name !== fileRecord.file_name) && fileRecord.file_path) {
        const { data: blob, error } = await supabase.storage.from(config.bucket).download(fileRecord.file_path);
        if (error || !blob) throw new Error('Download fallito: ' + (error?.message || 'no blob'));
        fileObj = new File([blob], String(fileRecord.file_name || 'file'));
      }
      if (!fileObj) throw new Error('File non disponibile');

      type ProcessResultRaw = { success?: boolean; imported?: number; errors?: Array<{ message?: string } | string> }
      const result = await (processImport as unknown as (args: Record<string, unknown>) => Promise<ProcessResultRaw>)({
        file: fileObj,
        sourceType: selectedSource,
        context: {
          company_id: COMPANY_ID,
          bank_account_id: selectedBankAccount || fileRecord.bank_account_id,
          outlet_id: selectedOutlet || fileRecord.outlet_id,
          fiscal_year: selectedYear || new Date().getFullYear(),
          month: selectedMonthYear ? parseInt(selectedMonthYear.split('-')[0], 10) : new Date().getMonth() + 1,
          year: selectedMonthYear ? parseInt(selectedMonthYear.split('-')[1], 10) : new Date().getFullYear(),
          csvOptions: { skipRows: 0 },
        },
        mappingOverride,
        onProgress: (pct: number, msg: string) => {
          setProcessProgress(pct);
          setProcessMessage(msg);
        },
      });

      setProcessResult({ success: result.success, processed: result.imported, errors: result.errors?.map(e => typeof e === 'string' ? e : (e.message || '')) || [] });

      if (result.success) {
        showToast(`Importati ${result.imported} record con successo!`);
        // Update file status in source table (use correct column per table)
        let statusUpdate: Record<string, string>;
        if (selectedSource === 'bank') {
          statusUpdate = { status: 'completed' };
        } else if (selectedSource === 'balance_sheet') {
          statusUpdate = { status: 'parsed' };
        } else {
          statusUpdate = { upload_status: 'parsed', import_status: 'completed' };
        }
        if (fileRecord.id) await (supabase as unknown as { from: (t: string) => { update: (v: Record<string, string>) => { eq: (k: string, v: string) => Promise<unknown> } } }).from(config.table).update(statusUpdate).eq('id', String(fileRecord.id));
        await loadImportDocs();

        // ─── POST-IMPORT EC: calcolo match automatici ──
        // Dopo un import EC bancario riuscito, calcola automaticamente
        // i match tra movimenti in uscita e scadenze payables.
        // Il modal mostra il riepilogo e permette di confermare i match sicuri.
        if (selectedSource === 'bank' && (result.imported || 0) > 0) {
          const bankAccountId = (selectedBankAccount || fileRecord.bank_account_id) as string | null;
          await computeMatchesAfterBankImport(bankAccountId);
        }
      } else {
        showToast(`Errori durante l'elaborazione`, 'error');
      }
    } catch (err: unknown) {
      console.error('Process error:', err);
      setProcessResult({ success: false, processed: 0, errors: [(err as Error).message] });
      showToast('Errore elaborazione: ' + (err as Error).message, 'error');
    } finally {
      setProcessing(false);
      pendingFileRef.current = null;
    }
  }

  // Process all pending files for current source
  async function handleProcessAll() {
    const pendingFiles = uploadedFiles.filter(f => {
      const status = f.status || f.upload_status || f.import_status || f.document_status || 'uploaded';
      return status === 'uploaded' || status === 'pending' || status === 'pending_parsing';
    });
    if (pendingFiles.length === 0) {
      showToast('Nessun file da elaborare', 'error');
      return;
    }

    for (const f of pendingFiles) {
      await handleProcessFile(f);
    }
  }

  // ─── POST-IMPORT EC: calcolo + applicazione match ─────────────

  /**
   * Lancia la riconciliazione in DRY-RUN subito dopo l'import EC.
   * Serve a mostrare in un modal quanti movimenti hanno trovato una
   * controparte sicura (score >= 80, match automatico), quanti probabili
   * (score 50-79, richiedono revisione manuale) e quanti senza match.
   */
  async function computeMatchesAfterBankImport(bankAccountId: string | null) {
    if (!COMPANY_ID) return;
    setComputingMatches(true);
    try {
      type ReconciliationResult = { reconciled?: unknown[]; suggested?: unknown[]; unmatched?: unknown[]; stats?: NonNullable<MatchModal>['stats']; errors?: unknown[] }
      const res = await (runAutoReconciliation as unknown as (companyId: string, bankAccountId: string | null, opts: Record<string, unknown>) => Promise<ReconciliationResult>)(COMPANY_ID, bankAccountId || null, {
        dryRun: true,
        performedBy: profile?.id || null,
      });
      setMatchModal({
        bankAccountId: bankAccountId || null,
        reconciled: (res.reconciled || []) as ReconciledMatch[],
        suggested: (res.suggested || []) as ReconciledMatch[],
        unmatched: (res.unmatched || []) as Array<{ id?: string; description?: string; amount?: number; date?: string }>,
        stats: res.stats || {},
      });
    } catch (err: unknown) {
      console.error('Errore calcolo match post-import:', err);
      showToast('Errore nel calcolo match: ' + (err as Error).message, 'error');
    } finally {
      setComputingMatches(false);
    }
  }

  /**
   * Conferma TUTTI i match sicuri calcolati nel dry-run.
   * Per ogni coppia movimento<->payable con score >= 80 esegue:
   *  - payables.status = 'pagato' + payment_date
   *  - cash_movements.is_reconciled = true
   *  - log in reconciliation_log
   */
  async function handleConfirmSafeMatches() {
    type ReconciledItem = { movement?: { id?: string }; payable?: { id?: string }; score?: number }
    const reconciledList = (matchModal?.reconciled as ReconciledItem[] | undefined) || [];
    if (!matchModal || reconciledList.length === 0) return;
    setApplyingMatches(true);
    let ok = 0;
    const errs: unknown[] = [];
    try {
      for (const m of reconciledList) {
        const movementId = m.movement?.id;
        const payableId = m.payable?.id;
        if (!movementId || !payableId) continue;
        type ApplyResult = { success?: boolean; error?: unknown }
        const res = await (applyReconciliation as unknown as (mId: string, pId: string, kind: string, msg: string, opts: Record<string, unknown>) => Promise<ApplyResult>)(movementId, payableId, 'auto_exact', `Conferma post-import EC (score ${m.score})`, {
          performedBy: profile?.id || null,
          companyId: COMPANY_ID,
        });
        if (res.success) ok++;
        else errs.push(res.error);
      }
      if (errs.length === 0) {
        showToast(`Confermati ${ok} match. Fatture marcate come pagate.`);
      } else {
        showToast(`Confermati ${ok} su ${reconciledList.length}. ${errs.length} errori.`, 'error');
      }
    } catch (err: unknown) {
      console.error('Errore applicazione match:', err);
      showToast('Errore applicazione match: ' + (err as Error).message, 'error');
    } finally {
      setApplyingMatches(false);
      setMatchModal(null);
    }
  }

  function goToReconciliation() {
    const accountId = matchModal?.bankAccountId;
    const qs = accountId ? `?tab=riconciliazione&account=${accountId}` : `?tab=riconciliazione`;
    setMatchModal(null);
    navigate(`/banche${qs}`);
  }

  const importSources = Object.entries(IMPORT_SOURCE_CONFIG).map(([id, config]) => ({
    id,
    nome: config.name,
    descrizione: config.description,
    formato: config.formats,
    stato: 'attivo',
    icon: config.icon,
  }));

  const getStatusColor = (stato: string) => {
    switch (stato) {
      case 'successo':
      case 'parsed':
        return 'bg-green-50 text-green-700 border-green-200';
      case 'errore':
      case 'error':
        return 'bg-red-50 text-red-700 border-red-200';
      case 'parziale':
      case 'pending':
        return 'bg-yellow-50 text-yellow-700 border-yellow-200';
      case 'attivo':
      case 'uploaded':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'configurare':
      case 'coming_soon':
        return 'bg-gray-50 text-gray-700 border-gray-200';
      default:
        return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  const getStatusIcon = (stato: string) => {
    switch (stato) {
      case 'successo':
      case 'parsed':
        return <CheckCircle className="w-4 h-4" />;
      case 'errore':
      case 'error':
        return <AlertCircle className="w-4 h-4" />;
      case 'parziale':
      case 'pending':
        return <Clock className="w-4 h-4" />;
      case 'attivo':
      case 'uploaded':
        return <CheckCircle className="w-4 h-4" />;
      case 'configurare':
      case 'coming_soon':
        return <Settings className="w-4 h-4" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  // Compute KPI data from importHistory
  const { monthlyData, sourceDistribution, qualityMetrics } = useMemo(() => {
    const hist = importHistory || [];
    // Monthly aggregation (last 6 months)
    const now = new Date();
    type MonthBucket = { mese: string; records: number }
    const monthBuckets: Record<string, MonthBucket> = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthBuckets[key] = { mese: months[d.getMonth()], records: 0 };
    }
    hist.forEach(h => {
      const d = new Date(String(h.uploaded_at || h.created_at || ''));
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (monthBuckets[key]) monthBuckets[key].records++;
    });
    const monthly = Object.values(monthBuckets);

    // Source distribution
    const srcCount: Record<string, number> = {};
    hist.forEach(h => {
      const src = String(h.source_type || 'altro');
      const cfg = (IMPORT_SOURCE_CONFIG as Record<string, ImportSourceConfig>)[src];
      const label = cfg?.name || src;
      srcCount[label] = (srcCount[label] || 0) + 1;
    });
    const total = hist.length || 1;
    const srcDist = Object.entries(srcCount).map(([name, count]) => ({ name, value: Math.round((count / total) * 100) }));
    if (!srcDist.length) srcDist.push({ name: 'Nessun dato', value: 100 });

    // Quality metrics from real data
    const uploaded = hist.filter(h => (h.status || h.upload_status) === 'uploaded' || (h.status || h.upload_status) === 'parsed').length;
    const validPct = total > 0 ? Math.round(((uploaded) / total) * 1000) / 10 : 0;

    // Duplicate detection: same file_name + source_type
    const seen = new Set<string>();
    let dupes = 0;
    hist.forEach(h => {
      const k = `${String(h.source_type)}|${String(h.file_name)}`;
      if (seen.has(k)) dupes++;
      seen.add(k);
    });

    const errorCount = hist.filter(h => (h.status || h.upload_status) === 'error').length;
    return {
      monthlyData: monthly,
      sourceDistribution: srcDist,
      qualityMetrics: {
        recordValidi: validPct || 0,
        duplicatiTrovati: dupes,
        erroriMapping: errorCount,
        ultimaVerifica: hist.length ? new Date(String(hist[0].uploaded_at || hist[0].created_at || '')).toLocaleString('it-IT') : '-',
      },
    };
  }, [importHistory, months]);

  const COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Hub Importazioni Dati</h1>
              <p className="text-gray-500 mt-2">Gestione centralizzata delle integrazioni e dei flussi di importazione</p>
            </div>
            <Database className="w-12 h-12 text-blue-600" />
          </div>
        </div>
      </div>

      {/* Navigation tabs */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8">
            {([
              { id: 'sources', label: 'Fonti di importazioni', icon: Database },
              { id: 'overview', label: 'Panoramica', icon: BarChart3 },
              { id: 'history', label: 'Cronologia', icon: Clock },
            ] as const).map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    if (tab.id !== 'sources') setSelectedSource(null);
                  }}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  } flex items-center gap-2`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <div className="space-y-8">
            {/* KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {/* KPIs — Fix 10.3: rimosso border-l-4 colorato laterale,
                  il colore semantico resta sull'icona a destra */}
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-500 text-sm font-medium">Record Validi</p>
                    <p className="text-3xl font-bold text-gray-900 mt-2">{qualityMetrics.recordValidi}%</p>
                  </div>
                  <TrendingUp className="w-12 h-12 text-green-500 opacity-20" />
                </div>
                <p className="text-xs text-gray-500 mt-4">Ultima verifica: {qualityMetrics.ultimaVerifica}</p>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-500 text-sm font-medium">Duplicati Trovati</p>
                    <p className="text-3xl font-bold text-gray-900 mt-2">{qualityMetrics.duplicatiTrovati}</p>
                  </div>
                  <AlertCircle className="w-12 h-12 text-red-500 opacity-20" />
                </div>
                <p className="text-xs text-gray-500 mt-4">Ultimi 30 giorni</p>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-500 text-sm font-medium">Errori Mapping</p>
                    <p className="text-3xl font-bold text-gray-900 mt-2">{qualityMetrics.erroriMapping}</p>
                  </div>
                  <AlertCircle className="w-12 h-12 text-yellow-500 opacity-20" />
                </div>
                <p className="text-xs text-gray-500 mt-4">Da risolvere</p>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-500 text-sm font-medium">Fonti Attive</p>
                    <p className="text-3xl font-bold text-gray-900 mt-2">{importSources.filter(s => s.stato === 'attivo').length}/{importSources.length}</p>
                  </div>
                  <Database className="w-12 h-12 text-blue-500 opacity-20" />
                </div>
                <p className="text-xs text-gray-500 mt-4">Configurate e operative</p>
              </div>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-2xl shadow-lg p-6" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
                <h3 className="text-lg font-semibold text-gray-900 mb-6">Record Importati per Mese</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={monthlyData}>
                    <defs>
                      <linearGradient id="grad-records" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={1} />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.5} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...GRID_STYLE} />
                    <XAxis dataKey="mese" {...AXIS_STYLE} />
                    <YAxis {...AXIS_STYLE} />
                    <Tooltip content={<GlassTooltip />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
                    <Bar dataKey="records" fill="url(#grad-records)" radius={[8, 8, 0, 0]} animationDuration={800} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="rounded-2xl shadow-lg p-6" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
                <h3 className="text-lg font-semibold text-gray-900 mb-6">Distribuzione per Fonte</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <RechartsPieChart>
                    <Pie
                      data={sourceDistribution}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, value }) => `${name} ${value}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                      paddingAngle={3}
                      strokeWidth={0}
                    >
                      {sourceDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="white" strokeWidth={2} />
                      ))}
                    </Pie>
                    <Tooltip content={<GlassTooltip formatter={(value) => `${value}%`} suffix="%" />} />
                  </RechartsPieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* SOURCES TAB */}
        {activeTab === 'sources' && !selectedSource && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {importSources.map((source) => (
                <div key={source.id} className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow">
                  <div className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-gray-900">{source.nome}</h3>
                        <p className="text-sm text-gray-500 mt-1">{source.descrizione}</p>
                      </div>
                      <span className={`ml-2 px-3 py-1 rounded-full text-xs font-semibold border flex items-center gap-1 ${getStatusColor(source.stato)}`}>
                        {getStatusIcon(source.stato)}
                        {source.stato === 'configurare' ? 'Configurazione in corso' : 'Attivo'}
                      </span>
                    </div>

                    <div className="space-y-3 my-6 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Formato:</span>
                        <span className="font-medium text-gray-900">{source.formato}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => source.stato === 'attivo' && setSelectedSource(source.id as ImportSourceId)}
                      disabled={source.stato !== 'attivo'}
                      className={`w-full px-3 py-2 rounded font-medium text-sm flex items-center justify-center gap-2 transition-colors ${
                        source.stato === 'attivo'
                          ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                          : 'bg-gray-50 text-gray-500 cursor-not-allowed'
                      }`}
                    >
                      <Settings className="w-4 h-4" />
                      {source.stato === 'attivo' ? 'Importa' : 'Non disponibile'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SOURCES TAB - IMPORT DETAIL VIEW */}
        {activeTab === 'sources' && selectedSource && (
          <div className="space-y-6">
            <div className="flex items-center gap-3 mb-6">
              <button
                onClick={() => setSelectedSource(null)}
                className="px-3 py-2 text-gray-700 hover:bg-gray-100 rounded transition-colors"
              >
                ← Indietro
              </button>
              <h2 className="text-2xl font-bold text-gray-900">{IMPORT_SOURCE_CONFIG[selectedSource].name}</h2>
            </div>

            {/* Upload Area */}
            <div className="rounded-2xl shadow-lg p-8" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
              {/* Conditional selectors based on source */}
              {selectedSource === 'bank' && (
                <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <label className="block text-sm font-semibold text-gray-900 mb-2">Seleziona Conto Bancario</label>
                  <select
                    value={selectedBankAccount || ''}
                    onChange={(e) => setSelectedBankAccount(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">-- Seleziona un conto --</option>
                    {bankAccounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.bank_name} - {acc.account_name}
                      </option>
                    ))}
                  </select>
                  {!selectedBankAccount && <p className="text-xs text-blue-700 mt-2">È obbligatorio selezionare un conto per procedere</p>}
                </div>
              )}

              {selectedSource === 'payroll' && (
                <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200 space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-2">Seleziona Mese e Anno</label>
                    <div className="flex gap-3">
                      <select
                        value={selectedMonthYear}
                        onChange={(e) => setSelectedMonthYear(e.target.value)}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="">-- Seleziona mese/anno --</option>
                        {months.map((m, idx) =>
                          Array.from({ length: 3 }, (_, y) => {
                            const year = new Date().getFullYear() - y;
                            const val = `${String(idx + 1).padStart(2, '0')}-${year}`;
                            return (
                              <option key={val} value={val}>
                                {m} {year}
                              </option>
                            );
                          })
                        )}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-2">
                      <Store className="inline w-4 h-4 mr-1" />
                      Punto Vendita (opzionale)
                    </label>
                    <select
                      value={selectedOutlet}
                      onChange={(e) => setSelectedOutlet(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="">-- Auto da allocazioni dipendente --</option>
                      {outlets.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                    <p className="text-xs text-blue-700 mt-1">Se non selezionato, i costi vengono ripartiti automaticamente in base alle allocazioni outlet di ogni dipendente</p>
                  </div>
                </div>
              )}

              {selectedSource === 'balance_sheet' && (
                <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <label className="block text-sm font-semibold text-gray-900 mb-2">Seleziona Anno Fiscale</label>
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    {years.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {selectedSource === 'general_docs' && (
                <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <label className="block text-sm font-semibold text-gray-900 mb-2">Categoria Documento</label>
                  <select
                    value={selectedDocCategory}
                    onChange={(e) => setSelectedDocCategory(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="contratto">Contratto</option>
                    <option value="comunicazione">Comunicazione</option>
                    <option value="altro">Altro</option>
                  </select>
                </div>
              )}

              {(selectedSource === 'pos_data' || selectedSource === 'receipts') && (
                <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    <Store className="inline w-4 h-4 mr-1" />
                    Seleziona Punto Vendita
                  </label>
                  <select
                    value={selectedOutlet}
                    onChange={(e) => setSelectedOutlet(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">-- Seleziona outlet --</option>
                    {outlets.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                  {!selectedOutlet && <p className="text-xs text-blue-700 mt-2">È obbligatorio selezionare un punto vendita per procedere</p>}
                </div>
              )}

              {/* Validation errors */}
              {validationErrors[selectedSource] && (
                <div className="mb-4 p-3 bg-red-50 rounded-lg border border-red-200">
                  <div className="flex items-center gap-2 mb-1">
                    <FileWarning className="w-4 h-4 text-red-600" />
                    <span className="text-sm font-semibold text-red-800">Errori di validazione</span>
                  </div>
                  {validationErrors[selectedSource].map((e, i) => (
                    <p key={i} className="text-xs text-red-700 ml-6">• {e}</p>
                  ))}
                </div>
              )}

              {/* Drag & drop upload area */}
              <div
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl transition-all ${
                  dragActive ? 'border-indigo-400 bg-indigo-50/50' : 'border-slate-200 hover:border-indigo-300'
                } p-10 text-center`}
              >
                <FileUp className="w-12 h-12 text-indigo-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Carica file per importare</h3>
                <p className="text-sm text-slate-500 mb-4">
                  {IMPORT_SOURCE_CONFIG[selectedSource].formats} — Trascina qui o seleziona
                </p>
                <button
                  onClick={() => document.getElementById(`upload-${selectedSource}`)?.click()}
                  className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition font-medium text-sm"
                >
                  Seleziona File
                </button>
                <input
                  id={`upload-${selectedSource}`}
                  type="file"
                  accept={IMPORT_SOURCE_CONFIG[selectedSource].acceptedExt.join(',')}
                  multiple
                  className="hidden"
                  onChange={(e) => { if (e.target.files && selectedSource) handleFileUpload(e.target.files, selectedSource) }}
                />
              </div>

              {/* Progress indicator */}
              {uploading && (
                <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-blue-900">Caricamento in corso...</span>
                    <span className="text-sm text-blue-700">{Math.round(uploadProgress)}%</span>
                  </div>
                  <div className="w-full h-2 bg-blue-200 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-600 transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                  </div>
                </div>
              )}

              {/* Uploaded files list with batch operations */}
              {uploadedFiles.length > 0 && (
                <div className="mt-6">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Paperclip size={14} className="text-slate-400" />
                      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">File Importati ({uploadedFiles.length})</span>
                      {filesLoading && <RefreshCw size={13} className="animate-spin text-indigo-500" />}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={toggleSelectAll} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1">
                        {batchSelected.size === uploadedFiles.length ? <CheckSquare size={14} /> : <Square size={14} />}
                        {batchSelected.size === uploadedFiles.length ? 'Deseleziona tutti' : 'Seleziona tutti'}
                      </button>
                      {canProcess(selectedSource) && uploadedFiles.some(f => ['uploaded','pending','pending_parsing'].includes(String(f.status || f.upload_status || f.import_status || f.document_status || 'uploaded'))) && (
                        <button onClick={handleProcessAll} disabled={processing} className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold hover:bg-emerald-100 flex items-center gap-1 border border-emerald-200 disabled:opacity-50">
                          {processing ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                          {processing ? 'Elaborazione...' : 'Processa tutti'}
                        </button>
                      )}
                      {batchSelected.size > 0 && (
                        <button onClick={handleBatchDelete} className="px-3 py-1 bg-red-50 text-red-700 rounded-lg text-xs font-semibold hover:bg-red-100 flex items-center gap-1 border border-red-200">
                          <Trash2 size={13} /> Elimina {batchSelected.size}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {uploadedFiles.map((f) => {
                      const isPdf = f.file_type === 'pdf';
                      const statusLabel = String(f.status || f.upload_status || f.import_status || f.document_status || 'uploaded');
                      const isSelected = f.id ? batchSelected.has(f.id) : false;
                      return (
                        <div key={String(f.id)} className={`flex items-center justify-between p-3 bg-white rounded-xl border group hover:border-indigo-200 transition ${isSelected ? 'border-indigo-300 bg-indigo-50/30' : 'border-slate-200'}`}>
                          <div className="flex items-center gap-3 min-w-0">
                            <button onClick={() => f.id && toggleBatchSelect(f.id)} className="shrink-0 text-slate-400 hover:text-indigo-600">
                              {isSelected ? <CheckSquare size={18} className="text-indigo-600" /> : <Square size={18} />}
                            </button>
                            <div className={`p-2 rounded-lg ${isPdf ? 'bg-red-50' : 'bg-blue-50'}`}>
                              <FileText size={16} className={isPdf ? 'text-red-500' : 'text-blue-500'} />
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-slate-700 truncate">{f.file_name}</div>
                              <div className="text-xs text-slate-400">
                                {f.file_size ? `${((Number(f.file_size)) / 1024).toFixed(0)} KB` : ''} — {new Date(String(f.created_at || f.uploaded_at || '')).toLocaleString('it-IT')}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-3">
                            <span className={`px-2 py-1 rounded text-xs font-medium border ${getStatusColor(statusLabel)}`}>
                              {statusLabel}
                            </span>
                            {canProcess(selectedSource) && (statusLabel === 'uploaded' || statusLabel === 'pending' || statusLabel === 'pending_parsing') && (
                              <>
                                <button onClick={() => handlePreview(f, f)} className="p-1.5 rounded-lg hover:bg-amber-50 text-slate-400 hover:text-amber-600 transition" title="Anteprima dati">
                                  <FileSearch size={16} />
                                </button>
                                <button
                                  onClick={() => handleProcessFile(f)}
                                  disabled={processing}
                                  className="px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-semibold hover:bg-emerald-100 flex items-center gap-1 border border-emerald-200 disabled:opacity-50"
                                  title="Elabora e importa dati"
                                >
                                  {processing ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                                  Processa
                                </button>
                              </>
                            )}
                            {/* Riprocessa: per file già elaborati (parsed/approved/completed) */}
                            {canProcess(selectedSource) && (statusLabel === 'parsed' || statusLabel === 'approved' || statusLabel === 'completed' || statusLabel === 'verified') && (
                              <button
                                onClick={() => {
                                  if (window.confirm(
                                    'Vuoi riprocessare questo file?\n\n' +
                                    'I dati esistenti per lo stesso anno verranno sostituiti con quelli del file.\n' +
                                    'Questa operazione non può essere annullata.'
                                  )) {
                                    handleProcessFile(f)
                                  }
                                }}
                                disabled={processing}
                                className="px-2.5 py-1 bg-amber-50 text-amber-700 rounded-lg text-xs font-semibold hover:bg-amber-100 flex items-center gap-1 border border-amber-200 disabled:opacity-50"
                                title="Riprocessa — i dati esistenti per lo stesso anno verranno sostituiti"
                              >
                                {processing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                                Riprocessa
                              </button>
                            )}
                            {isPdf && f.file_path && (
                              <button onClick={() => openPreview(f)} className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition" title="Anteprima PDF">
                                <Eye size={16} />
                              </button>
                            )}
                            <button onClick={() => f.id && selectedSource && handleRemoveFile(f.id, selectedSource)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition" title="Rimuovi">
                              <XCircle size={16} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* PROCESSING PROGRESS BAR */}
            {processing && (
              <div className="mt-4 p-4 bg-indigo-50 rounded-xl border border-indigo-200">
                <div className="flex items-center gap-3 mb-2">
                  <Loader2 size={18} className="animate-spin text-indigo-600" />
                  <span className="text-sm font-medium text-indigo-700">{processMessage}</span>
                </div>
                <div className="w-full bg-indigo-200 rounded-full h-2">
                  <div className="bg-indigo-600 h-2 rounded-full transition-all" style={{ width: `${processProgress}%` }} />
                </div>
              </div>
            )}

            {/* PROCESS RESULT PANEL */}
            {processResult && !processing && (
              <div className={`mt-4 p-4 rounded-xl border ${processResult.success ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {processResult.success ? <CheckCircle size={18} className="text-emerald-600" /> : <AlertCircle size={18} className="text-red-600" />}
                    <span className={`text-sm font-semibold ${processResult.success ? 'text-emerald-700' : 'text-red-700'}`}>
                      {processResult.success ? `${processResult.processed} record importati con successo` : 'Errori durante l\'elaborazione'}
                    </span>
                  </div>
                  <button onClick={() => setProcessResult(null)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
                </div>
                {(processResult.errors?.length ?? 0) > 0 && (
                  <div className="mt-2 max-h-32 overflow-y-auto">
                    {(processResult.errors || []).slice(0, 10).map((e: string, i: number) => (
                      <div key={i} className="text-xs text-red-600 py-0.5">
                        {e}
                      </div>
                    ))}
                    {(processResult.errors?.length ?? 0) > 10 && (
                      <div className="text-xs text-red-500 mt-1">...e altri {(processResult.errors?.length ?? 0) - 10} errori</div>
                    )}
                  </div>
                )}
                {false && (
                  <div className="mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200">
                    {/* warnings rimossi: tipo non più presente */}
                  </div>
                )}
                {processResult.details && (
                  <div className="mt-2 text-xs text-slate-600 space-y-0.5">
                    {processResult.details.fatture != null && <div>Fatture: {processResult.details.fatture} | Scadenze: {processResult.details.scadenze} | Fornitore: {processResult.details.fornitore}</div>}
                    {processResult.details.totalParsed != null && <div>Righe parsate: {processResult.details.totalParsed}</div>}
                    {processResult.details.anno != null && (
                      <div>Bilancio {processResult.details.anno}: {processResult.details.attivita} attività, {processResult.details.passivita} passività, {processResult.details.costi} costi, {processResult.details.ricavi} ricavi
                        {processResult.details.risultato != null && <span className="font-semibold"> | Risultato: {processResult.details.risultato >= 0 ? '+' : ''}{processResult.details.risultato.toLocaleString('it-IT')} €</span>}
                      </div>
                    )}
                    {processResult.details.dipendentiTrovati != null && (
                      <div>Dipendenti aggiornati: {processResult.details.dipendentiTrovati} | Non trovati: {processResult.details.dipendentiNonTrovati} | Periodo: {processResult.details.mese}</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* PREVIEW PANEL */}
            {previewData && !processing && (
              <div className="mt-4 p-4 bg-amber-50 rounded-xl border border-amber-200">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <FileSearch size={18} className="text-amber-600" />
                    <span className="text-sm font-semibold text-amber-800">
                      Anteprima: {previewData.fileRecord?.file_name}
                    </span>
                    {previewData.confidence && (
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${previewData.confidence >= 70 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        Mapping {previewData.confidence}%
                      </span>
                    )}
                  </div>
                  <button onClick={() => setPreviewData(null)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
                </div>

                {/* CSV Preview Table */}
                {previewData.headers && (
                  <div className="overflow-x-auto mb-3">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr>
                          {previewData.headers.map((h, i) => (
                            <th key={i} className="px-2 py-1.5 bg-amber-100 text-amber-800 font-semibold text-left border border-amber-200 whitespace-nowrap">
                              {h}
                              {previewData.mapping && Object.entries(previewData.mapping).find(([, v]) => v === h) && (
                                <span className="ml-1 text-emerald-600">{'\u2192'} {Object.entries(previewData.mapping).find(([, v]) => v === h)?.[0]}</span>
                              )}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewData.sampleRows?.slice(0, 5).map((row, i) => (
                          <tr key={i} className="hover:bg-amber-50">
                            {(previewData.headers || []).map((h, j) => (
                              <td key={j} className="px-2 py-1 border border-amber-100 text-slate-700 whitespace-nowrap max-w-48 truncate">
                                {row[h]}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="text-xs text-slate-500 mt-1">
                      Mostrate {Math.min(5, previewData.sampleRows?.length || 0)} di {previewData.totalRows} righe totali
                    </div>
                  </div>
                )}

                {/* Invoice Preview */}
                {previewData.invoices && (
                  <div className="space-y-2 mb-3">
                    {previewData.invoices.map((inv: PreviewInvoice, i: number) => (
                      <div key={i} className="p-2 bg-white rounded-lg border border-amber-200 text-xs">
                        <div className="flex justify-between">
                          <span className="font-semibold text-slate-700">{inv.tipo_label} n. {inv.invoice_number}</span>
                          <span className="font-bold text-slate-900">{'\u20AC'} {inv.gross_amount?.toLocaleString('it-IT', { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="text-slate-500 mt-0.5">
                          {inv.supplier_name} | {inv.invoice_date} | Netto: {'\u20AC'}{inv.net_amount?.toLocaleString('it-IT', { minimumFractionDigits: 2 })} + IVA: {'\u20AC'}{inv.vat_amount?.toLocaleString('it-IT', { minimumFractionDigits: 2 })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  onClick={() => {
                    const fr = previewData.fileRecord;
                    setPreviewData(null);
                    if (fr) handleProcessFile(fr, previewData.mapping || null);
                  }}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 flex items-center gap-2"
                >
                  <Zap size={16} /> Conferma e processa
                </button>
              </div>
            )}

          </div>
        )}

        {/* HISTORY TAB */}
        {activeTab === 'history' && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Data</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">File</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Fonte</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Dimensione</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Stato</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Azione</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {importHistory.map((item) => {
                    const sourceKey = String(item.source_type || '') as ImportSourceId;
                    const source = (IMPORT_SOURCE_CONFIG as Record<string, ImportSourceConfig>)[sourceKey];
                    const isPdf = item.file_type === 'pdf';
                    const statusRaw = String(item.status || item.upload_status || 'unknown');
                    return (
                      <tr key={String(item.id)} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 text-sm text-gray-900">
                          {new Date(String(item.uploaded_at || item.created_at || '')).toLocaleString('it-IT')}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900 font-medium">{String(item.file_name || '')}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{source?.name || String(item.source_type || '')}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {item.file_size ? `${(Number(item.file_size) / 1024).toFixed(0)} KB` : '-'}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold border flex items-center gap-1 w-fit ${getStatusColor(statusRaw)}`}>
                            {getStatusIcon(statusRaw)}
                            {statusRaw.charAt(0).toUpperCase() + statusRaw.slice(1)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm">
                          {isPdf && item.file_path && (
                            <button
                              onClick={() => openPreview(item)}
                              className="text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                            >
                              <Eye size={14} /> Anteprima
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {importHistory.length === 0 && (
              <div className="text-center py-12">
                <Clock className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">Nessun import trovato</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Toast notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 transition-all ${
          toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'
        }`}>
          {toast.type === 'error' ? <AlertCircle size={16} /> : <ShieldCheck size={16} />}
          {toast.msg}
        </div>
      )}

      {/* ═══════════ POST-IMPORT EC MATCH MODAL ═══════════
          Mostrato subito dopo l'import di un estratto conto bancario.
          Riepiloga quanti movimenti sono stati automaticamente abbinati
          a scadenze payables. */}
      {(computingMatches || matchModal) && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-xl">
                  <Zap size={20} className="text-blue-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Match automatici post-import</h2>
                  <p className="text-xs text-slate-500">Abbinamento movimenti bancari ↔ scadenze fornitori</p>
                </div>
              </div>
              {!computingMatches && (
                <button onClick={() => setMatchModal(null)} className="p-1.5 hover:bg-slate-100 rounded-lg">
                  <X size={18} className="text-slate-500" />
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {computingMatches ? (
                <div className="text-center py-10">
                  <Loader2 size={40} className="animate-spin text-blue-600 mx-auto mb-4" />
                  <p className="text-sm text-slate-600 font-medium">Calcolo match in corso...</p>
                  <p className="text-xs text-slate-400 mt-1">Confronto i movimenti importati con le scadenze aperte</p>
                </div>
              ) : matchModal && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle size={16} className="text-emerald-600" />
                        <span className="text-xs font-semibold text-emerald-700 uppercase">Match sicuri</span>
                      </div>
                      <div className="text-3xl font-bold text-emerald-800">{(matchModal.reconciled?.length ?? 0)}</div>
                      <p className="text-[11px] text-emerald-600 mt-1">importo esatto + nome fornitore</p>
                    </div>
                    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertCircle size={16} className="text-amber-600" />
                        <span className="text-xs font-semibold text-amber-700 uppercase">Probabili</span>
                      </div>
                      <div className="text-3xl font-bold text-amber-800">{(matchModal.suggested?.length ?? 0)}</div>
                      <p className="text-[11px] text-amber-600 mt-1">da verificare manualmente</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <XCircle size={16} className="text-slate-500" />
                        <span className="text-xs font-semibold text-slate-600 uppercase">Senza match</span>
                      </div>
                      <div className="text-3xl font-bold text-slate-700">{(matchModal.unmatched?.length ?? 0)}</div>
                      <p className="text-[11px] text-slate-500 mt-1">nessuna scadenza corrispondente</p>
                    </div>
                  </div>

                  {matchModal.stats?.totalMovements != null && (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-xs text-slate-600 mb-5">
                      Movimenti in uscita analizzati: <b className="text-slate-900">{matchModal.stats.totalMovements}</b>
                      {(matchModal.stats.skippedPOS ?? 0) > 0 && <> · saltati (POS/commissioni): <b>{matchModal.stats.skippedPOS}</b></>}
                    </div>
                  )}

                  {(matchModal.reconciled?.length ?? 0) > 0 && (
                    <div className="mb-4">
                      <div className="text-xs font-semibold text-slate-600 uppercase mb-2">Anteprima match sicuri</div>
                      <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-48 overflow-y-auto">
                        {(matchModal.reconciled || []).slice(0, 8).map((m: ReconciledMatch & { details?: { movementAmount?: number }; payable?: { suppliers?: { ragione_sociale?: string; name?: string } } & ReconciledMatch['payable'] }, i: number) => (
                          <div key={i} className="px-3 py-2 text-xs flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-slate-800 truncate">
                                {m.movement?.description || '—'}
                              </div>
                              <div className="text-slate-500 mt-0.5">
                                {m.movement?.date} · {m.payable?.suppliers?.ragione_sociale || m.payable?.suppliers?.name || 'Fornitore'} · Fatt. {m.payable?.invoice_number || '—'}
                              </div>
                            </div>
                            <div className="ml-3 text-right shrink-0">
                              <div className="font-semibold text-slate-900">
                                {(m.details?.movementAmount || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                              </div>
                              <div className="text-[10px] text-emerald-600">score {m.score}</div>
                            </div>
                          </div>
                        ))}
                        {(matchModal.reconciled?.length ?? 0) > 8 && (
                          <div className="px-3 py-2 text-xs text-slate-500 italic">
                            ...e altri {(matchModal.reconciled?.length ?? 0) - 8} match
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {(matchModal.reconciled?.length ?? 0) === 0 && (matchModal.suggested?.length ?? 0) === 0 && (matchModal.unmatched?.length ?? 0) === 0 && (
                    <div className="text-center py-8">
                      <FileWarning size={32} className="text-slate-300 mx-auto mb-3" />
                      <p className="text-sm text-slate-500">Nessun movimento in uscita da analizzare.</p>
                    </div>
                  )}
                </>
              )}
            </div>

            {!computingMatches && matchModal && (
              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex flex-wrap items-center justify-end gap-2">
                <button
                  onClick={() => setMatchModal(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100"
                >
                  Chiudi
                </button>
                <button
                  onClick={goToReconciliation}
                  className="px-4 py-2 text-sm font-medium text-blue-700 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 flex items-center gap-2"
                >
                  Vai alla Riconciliazione
                </button>
                {(matchModal.reconciled?.length ?? 0) > 0 && (
                  <button
                    onClick={handleConfirmSafeMatches}
                    disabled={applyingMatches}
                    className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {applyingMatches ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                    Conferma {(matchModal.reconciled?.length ?? 0)} match sicuri
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* PDF Preview Modal */}
      {previewFile && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={closePreview}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-2">
                <FileText size={18} className="text-red-500" />
                <span className="font-semibold text-slate-900 text-sm">{previewFile.file_name}</span>
                {previewFile.file_size && <span className="text-xs text-slate-400">{(previewFile.file_size / 1024).toFixed(0)} KB</span>}
              </div>
              <button onClick={closePreview} className="p-1.5 hover:bg-slate-100 rounded-lg">
                <X size={18} className="text-slate-500" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              {previewUrl ? (
                <iframe src={previewUrl} className="w-full h-full min-h-[70vh]" title="Anteprima PDF" />
              ) : (
                <div className="flex items-center justify-center h-[70vh]">
                  <RefreshCw size={24} className="animate-spin text-blue-600" />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <PageHelp page="import-hub" />
    </div>
  );
}
