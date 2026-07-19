import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';

// Tab anno SchedaContabileFornitore — persistito in URL come ?year=
// Valori ammessi: 'latest' (default), 'all', o un anno numerico (es. '2025')
type SchedaYear = number | 'latest' | 'all';
const isValidYearParam = (raw: string | null): raw is string => {
  if (raw === 'latest' || raw === 'all') return true;
  if (raw && /^\d{4}$/.test(raw)) return true;
  return false;
};
const parseYearParam = (raw: string | null): SchedaYear => {
  if (raw === 'all') return 'all';
  if (raw && /^\d{4}$/.test(raw)) return Number(raw);
  return 'latest';
};
import {
  ArrowLeft, BookOpen, Eye, CreditCard, ChevronDown, ChevronRight,
  Download, FileText, Printer, TrendingUp, TrendingDown, AlertTriangle,
  CheckCircle, Clock, Building2, Mail, Phone, MapPin
} from 'lucide-react';
import InvoiceViewer from '../components/InvoiceViewer';
import StatusBadge from '../components/ui/StatusBadge';
import { useToast } from '../components/Toast';
import PageHeader from '../components/PageHeader';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { PAYMENT_METHOD_LABELS as paymentMethodLabels } from '../lib/paymentMethods';
import type { Row } from '../types/business';

type Supplier = Row<'suppliers'>;
type Payable = Row<'payables'>;
type CostCategoryLite = Pick<Row<'cost_categories'>, 'id' | 'name'>;

// ─── Utility ───────────────────────────────────────────────────
function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmtEUR(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function daysDiff(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function worstStatus(statuses: string[]): string {
  if (statuses.includes('scaduto')) return 'scaduto';
  if (statuses.includes('in_scadenza')) return 'in_scadenza';
  if (statuses.includes('da_pagare')) return 'da_pagare';
  if (statuses.includes('parziale')) return 'parziale';
  return 'pagato';
}

type OpeningRow = { id: string; company_id: string; supplier_id: string; fiscal_year: number; opening_balance: number; as_of_date: string | null; note: string | null; source: string | null };

// ─── Component ─────────────────────────────────────────────────
export default function SchedaContabileFornitore() {
  const { toast } = useToast();
  const { supplierId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const COMPANY_ID = profile?.company_id;

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [payables, setPayables] = useState<Payable[]>([]);
  // invoice_number → { net, vat } reali da electronic_invoices, per riempire
  // lo split imponibile/IVA quando i payables (A-Cube) hanno solo il totale.
  const [einvSplit, setEinvSplit] = useState<Record<string, { net: number; vat: number }>>({});
  const [bankAccountById, setBankAccountById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  // selectedYear persistito in URL come ?year=… (default 'latest')
  const [searchParams, setSearchParams] = useSearchParams();
  const yearParam = searchParams.get('year');
  const selectedYear: SchedaYear = isValidYearParam(yearParam) ? parseYearParam(yearParam) : 'latest';
  const setSelectedYear = (next: SchedaYear) => {
    const params = new URLSearchParams(searchParams);
    params.set('year', String(next));
    setSearchParams(params);
  };
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set());
  const [viewingXml, setViewingXml] = useState<string | null>(null);
  const [categories, setCategories] = useState<CostCategoryLite[]>([]);
  // Ordinamento partitario: per data emissione fattura o per data effettivo pagamento
  const [partitarioSortBy, setPartitarioSortBy] = useState<'fattura' | 'pagamento'>('fattura');
  // Ripresa saldo (saldo apertura) per anno
  const [openingRows, setOpeningRows] = useState<OpeningRow[]>([]);
  const [editingOpening, setEditingOpening] = useState(false);
  const [openingDraft, setOpeningDraft] = useState<{ amount: string; date: string }>({ amount: '', date: '' });

  // ─── Fetch data ────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!COMPANY_ID || !supplierId) return;
    setLoading(true);
    try {
      // Supplier info: accetta sia UUID sia slug nell'URL (backward compat)
      // 1° tentativo: by slug (URL leggibile)
      let { data: sup } = await (supabase.from('suppliers') as unknown as { select: (s: string) => { eq: (k: string, v: string) => { eq: (k2: string, v2: string) => { maybeSingle: () => Promise<{ data: Supplier | null }> } } } })
        .select('*')
        .eq('company_id', COMPANY_ID)
        .eq('slug', supplierId || '')
        .maybeSingle();
      // 2° tentativo: by UUID (vecchi link)
      if (!sup) {
        const r = await supabase.from('suppliers').select('*').eq('id', supplierId).maybeSingle();
        sup = r.data;
      }
      setSupplier(sup);

      // Payables — SOLO da payables, NESSUN join con electronic_invoices
      // Due query separate per evitare problemi con .or() e nomi con caratteri speciali
      const allPayables: Payable[] = [];
      const seen = new Set<string>();

      // Skip se non abbiamo trovato il supplier (URL malformato)
      if (!sup?.id) {
        setPayables([]);
        setLoading(false);
        return;
      }
      const realSupplierId = sup.id;

      // 1. Per supplier_id (include tutti quelli collegati al fornitore)
      // NB: usa sup.id (vero UUID), non supplierId dell'URL (che può essere uno slug)
      const { data: byId } = await supabase
        .from('payables')
        .select('*')
        .eq('company_id', COMPANY_ID)
        .eq('supplier_id', realSupplierId)
        .order('invoice_date', { ascending: false });
      (byId || []).forEach(p => { if (!seen.has(p.id)) { seen.add(p.id); allPayables.push(p); } });

      // 2. Per supplier_name dove supplier_id è null (payables non collegati)
      const supplierName = sup?.name || sup?.ragione_sociale || '';
      if (supplierName) {
        const { data: byName } = await supabase
          .from('payables')
          .select('*')
          .eq('company_id', COMPANY_ID)
          .eq('supplier_name', supplierName)
          .is('supplier_id', null)
          .order('invoice_date', { ascending: false });
        (byName || []).forEach(p => { if (!seen.has(p.id)) { seen.add(p.id); allPayables.push(p); } });
      }

      allPayables.sort((a, b) => new Date(b.invoice_date || 0).getTime() - new Date(a.invoice_date || 0).getTime());

      setPayables(allPayables);

      // Imponibile/IVA reali: i payables importati da A-Cube spesso hanno
      // net/vat non valorizzati (solo gross). I valori corretti stanno in
      // electronic_invoices. Costruiamo la mappa invoice_number → {net, vat}
      // per riempire lo split mancante in visualizzazione (non modifica il DB).
      //
      // AGGANCIO PER P.IVA: il numero fattura NON è univoco tra fornitori diversi
      // (es. due fornitori con fattura n.4). Filtriamo electronic_invoices per la
      // P.IVA del fornitore, altrimenti lo split rischia di prendere imponibile/IVA
      // dalla fattura di UN ALTRO fornitore. Senza P.IVA non riempiamo lo split.
      const supplierVat = sup.partita_iva || sup.vat_number || null;
      const splitMap: Record<string, { net: number; vat: number }> = {};
      if (supplierVat) {
        const numbers = [...new Set(allPayables.map(p => p.invoice_number).filter(Boolean))] as string[];
        for (let i = 0; i < numbers.length; i += 200) {
          const chunk = numbers.slice(i, i + 200);
          const { data: eis } = await supabase
            .from('electronic_invoices')
            .select('invoice_number, net_amount, vat_amount')
            .eq('company_id', COMPANY_ID)
            .eq('supplier_vat', supplierVat)
            .in('invoice_number', chunk);
          (eis || []).forEach((e: { invoice_number: string | null; net_amount: number | null; vat_amount: number | null }) => {
            if (e.invoice_number && (e.net_amount != null || e.vat_amount != null)) {
              splitMap[e.invoice_number] = { net: Number(e.net_amount || 0), vat: Number(e.vat_amount || 0) };
            }
          });
        }
      }
      setEinvSplit(splitMap);

      // Categories
      const { data: cats } = await supabase
        .from('cost_categories')
        .select('id, name')
        .eq('company_id', COMPANY_ID);
      setCategories(cats || []);

      // Bank accounts lookup → per descrizione "Pagamento Banca XXX" nel partitario
      const { data: banks } = await supabase
        .from('bank_accounts')
        .select('id, bank_name, account_name')
        .eq('company_id', COMPANY_ID);
      const bankMap: Record<string, string> = {};
      (banks || []).forEach((b: { id: string; bank_name: string | null; account_name: string | null }) => {
        bankMap[b.id] = b.bank_name || b.account_name || '—';
      });
      setBankAccountById(bankMap);

      // Ripresa saldo (saldo apertura) del fornitore
      const { data: ob } = await (supabase as unknown as { from: (t: string) => { select: (s: string) => { eq: (k: string, v: string) => { eq: (k2: string, v2: string) => Promise<{ data: OpeningRow[] | null }> } } } })
        .from('supplier_opening_balances')
        .select('*')
        .eq('company_id', COMPANY_ID)
        .eq('supplier_id', realSupplierId);
      setOpeningRows(ob || []);

    } catch (err: unknown) {
      console.error('Errore caricamento scheda contabile:', err);
    } finally {
      setLoading(false);
    }
  }, [COMPANY_ID, supplierId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ─── Derived data ──────────────────────────────────────────
  const anni = useMemo(() => {
    const set = new Set(payables.map(p => new Date(p.invoice_date || p.created_at || '').getFullYear()));
    return [...set].sort((a, b) => b - a);
  }, [payables]);

  // Set default year
  useEffect(() => {
    if (selectedYear === 'latest' && anni.length > 0) {
      setSelectedYear(anni[0]);
    }
  }, [anni, selectedYear]);

  const filteredPayables = useMemo(() => {
    if (selectedYear === 'all') return payables;
    return payables.filter(p => new Date(p.invoice_date || p.created_at || '').getFullYear() === selectedYear);
  }, [payables, selectedYear]);

  // Anno fiscale di riferimento per la ripresa saldo (numerico; 'all'/'latest' → ultimo anno)
  const fiscalYear = typeof selectedYear === 'number' ? selectedYear : (anni[0] || new Date().getFullYear());
  const openingRowCur = useMemo(() => openingRows.find(o => o.fiscal_year === fiscalYear) || null, [openingRows, fiscalYear]);
  const openingBalance = openingRowCur ? Number(openingRowCur.opening_balance) : 0;

  // Group by invoice_number for rate
  interface FatturaAggregate {
    invoice_number: string | null;
    invoice_date: string | null;
    net_amount: number;
    vat_amount: number;
    gross_amount: number;
    rate: Payable[];
    due_date: string | null;
    payment_method: string | null;
    status?: string;
  }

  const fattureGrouped = useMemo<FatturaAggregate[]>(() => {
    const map = new Map<string, FatturaAggregate>();
    for (const p of filteredPayables) {
      const key = p.invoice_number || p.id;
      let f = map.get(key);
      if (!f) {
        f = {
          invoice_number: p.invoice_number,
          invoice_date: p.invoice_date,
          net_amount: 0,
          vat_amount: 0,
          gross_amount: 0,
          rate: [],
          due_date: p.due_date,
          payment_method: p.payment_method,
        };
        map.set(key, f);
      }
      f.net_amount += Number(p.net_amount || 0);
      f.vat_amount += Number(p.vat_amount || 0);
      f.gross_amount += Number(p.gross_amount || 0);
      f.rate.push(p);
      f.status = worstStatus(f.rate.map(r => r.status || 'da_pagare'));
      // Use earliest due_date
      if (p.due_date && (!f.due_date || p.due_date < f.due_date)) f.due_date = p.due_date;
    }
    // Riempi imponibile/IVA mancanti (payables A-Cube con solo il totale) dai
    // valori reali di electronic_invoices, allineando il segno al totale (NC).
    for (const f of map.values()) {
      if (f.net_amount === 0 && f.vat_amount === 0 && f.invoice_number) {
        const ei = einvSplit[f.invoice_number];
        if (ei) {
          const sign = f.gross_amount < 0 ? -1 : 1;
          f.net_amount = sign * Math.abs(ei.net);
          f.vat_amount = sign * Math.abs(ei.vat);
        }
      }
    }
    return [...map.values()].sort((a, b) => new Date(b.invoice_date || 0).getTime() - new Date(a.invoice_date || 0).getTime());
  }, [filteredPayables, einvSplit]);

  // KPIs — gestione Note Credito
  // Fix 9.1: il "Pagato" ora esclude le note di credito (status='nota_credito'
  // o gross_amount<=0) che prima venivano sommate qui e producevano totali
  // negativi (caso GGZ SRL).
  const kpis = useMemo(() => {
    const isNotaCredito = (p: Payable) => p.status === 'nota_credito' || Number(p.gross_amount || 0) < 0;
    const totFatturato = payables.filter(p => Number(p.gross_amount || 0) > 0)
      .reduce((s, p) => s + Number(p.gross_amount || 0), 0);
    const totCrediti = payables.filter(isNotaCredito)
      .reduce((s, p) => s + Math.abs(Number(p.gross_amount || 0)), 0);
    const totPagato = payables.filter(p => p.status === 'pagato' && !isNotaCredito(p))
      .reduce((s, p) => s + Number(p.gross_amount || 0), 0);
    const esposto = totFatturato - totCrediti - totPagato;
    const scadute = payables.filter(p => p.status === 'scaduto').length;
    return { totFatturato, totPagato, totCrediti, esposto, scadute, totali: payables.length };
  }, [payables]);

  // Year totals — stesso filtro: una nota credito 'pagata' non va in tot.pagato
  const yearTotals = useMemo(() => {
    const tot = { net: 0, vat: 0, gross: 0, pagato: 0, count: fattureGrouped.length };
    fattureGrouped.forEach(f => {
      tot.net += f.net_amount;
      tot.vat += f.vat_amount;
      tot.gross += f.gross_amount;
      if (f.status === 'pagato' && f.gross_amount > 0) tot.pagato += f.gross_amount;
    });
    return tot;
  }, [fattureGrouped]);

  // ─── Partitario contabile stile gestionale tradizionale ───────────
  // Convenzione contabile partitario fornitore:
  //   AVERE = fatture ricevute (aumentano il debito verso il fornitore)
  //   DARE  = pagamenti + note di credito (riducono il debito)
  // Saldo positivo = debito aperto, saldo a zero = partite chiuse.
  //
  // Per ogni pagamento la riga DARE riporta:
  //   - data emissione fattura (principale)
  //   - data pagamento (sotto, in piccolo)
  //   - descrizione: "Pagamento — Banca XXX — rif. Fatt. NNN"
  // Per ogni nota credito: nessuna banca nella descrizione.
  interface MovimentoPartitario {
    data: string | null;           // data principale (fattura per pagamenti, data NC per note credito)
    dataPagamento: string | null;  // valorizzata solo per pagamenti (mostrata sotto in piccolo)
    numero: string;
    dare: number;
    avere: number;
    descrizione: string;
    aliquotaIVA: string;           // "22%", "10%", "mista", "—"
    tipo: 'fattura' | 'pagamento' | 'nota_credito' | 'ripresa';
  }

  const partitario = useMemo(() => {
    // Aggrega per invoice_number per evitare doppi conteggi quando una fattura è
    // splittata su più rate (payables multipli con stesso invoice_number)
    interface InvoiceAgg {
      invoiceNumber: string;
      invoiceDate: string | null;
      grossTotal: number;          // somma gross_amount (negativo per NC)
      netTotal: number;
      vatTotal: number;
      paymentDate: string | null;  // ultima data pagamento se status pagato
      paymentBankId: string | null;
      isPaid: boolean;
      paidAmount: number;          // somma amount_paid delle SOLE rate pagate (non il totale fattura)
      tipoDoc: string | null;
      closedManually: boolean;       // true se almeno una rata e' stata chiusa a mano
      manualCloseReason: string | null;
      manualClosedAmount: number;    // importo complessivo chiuso a mano (totale o parziale)
      manualCloseDate: string | null;
    }
    const map = new Map<string, InvoiceAgg>();
    for (const p of filteredPayables) {
      const key = p.invoice_number || p.id;
      let agg = map.get(key);
      if (!agg) {
        agg = {
          invoiceNumber: p.invoice_number || '—',
          invoiceDate: p.invoice_date,
          grossTotal: 0,
          netTotal: 0,
          vatTotal: 0,
          paymentDate: null,
          paymentBankId: null,
          isPaid: false,
          paidAmount: 0,
          tipoDoc: (p as Payable & { tipo_documento?: string | null }).tipo_documento || null,
          closedManually: false,
          manualCloseReason: null,
          manualClosedAmount: 0,
          manualCloseDate: null,
        };
        map.set(key, agg);
      }
      agg.grossTotal += Number(p.gross_amount || 0);
      agg.netTotal += Number(p.net_amount || 0);
      agg.vatTotal += Number(p.vat_amount || 0);
      const pManual = p as Payable & { closed_manually?: boolean | null; manual_close_reason?: string | null };
      if (pManual.closed_manually) {
        agg.closedManually = true;
        if (pManual.manual_close_reason) agg.manualCloseReason = pManual.manual_close_reason;
        // Importo chiuso a mano = quanto e' stato saldato manualmente (amount_paid).
        agg.manualClosedAmount += Number(p.amount_paid || 0);
        if (p.payment_date && (!agg.manualCloseDate || p.payment_date > agg.manualCloseDate)) {
          agg.manualCloseDate = p.payment_date;
        }
      }
      if (p.status === 'pagato' && p.payment_date) {
        agg.isPaid = true;
        // Somma SOLO l'importo effettivamente pagato di questa rata (non il totale
        // fattura): con fatture rateizzate, una sola rata pagata non chiude tutto.
        agg.paidAmount += Number(p.amount_paid ?? p.gross_amount ?? 0);
        if (!agg.paymentDate || p.payment_date > agg.paymentDate) {
          agg.paymentDate = p.payment_date;
          agg.paymentBankId = p.payment_bank_account_id || null;
        }
      }
    }

    // Riempi imponibile/IVA mancanti dai valori reali di electronic_invoices.
    for (const agg of map.values()) {
      if (agg.netTotal === 0 && agg.vatTotal === 0 && agg.invoiceNumber && agg.invoiceNumber !== '—') {
        const ei = einvSplit[agg.invoiceNumber];
        if (ei) {
          const sign = agg.grossTotal < 0 ? -1 : 1;
          agg.netTotal = sign * Math.abs(ei.net);
          agg.vatTotal = sign * Math.abs(ei.vat);
        }
      }
    }

    const movimenti: MovimentoPartitario[] = [];
    for (const agg of map.values()) {
      const isNC = agg.grossTotal < 0;
      // Aliquota IVA media (vat / net * 100). "mista" se diversi tassi presenti.
      const aliq = agg.netTotal > 0
        ? `${Math.round((agg.vatTotal / agg.netTotal) * 100)}%`
        : '—';

      if (isNC) {
        // Nota di credito → riga DARE singola, niente banca nella descrizione
        movimenti.push({
          data: agg.invoiceDate,
          dataPagamento: null,
          numero: agg.invoiceNumber,
          dare: Math.abs(agg.grossTotal),
          avere: 0,
          descrizione: `Nota di credito Nr ${agg.invoiceNumber}`,
          aliquotaIVA: aliq,
          tipo: 'nota_credito',
        });
        // Se la NC è stata chiusa a mano → scrittura di chiusura in AVERE che
        // annulla il DARE della nota di credito (il saldo torna a non risentirne).
        if (agg.closedManually) {
          const dataRifNC = agg.manualCloseDate || agg.paymentDate;
          const dataChiusuraNC = dataRifNC ? new Date(dataRifNC).toLocaleDateString('it-IT') : '—';
          movimenti.push({
            data: agg.invoiceDate,
            dataPagamento: dataRifNC,
            numero: agg.invoiceNumber,
            dare: 0,
            avere: Math.abs(agg.grossTotal),
            descrizione: `Chiusura nota di credito — chiusa a mano il ${dataChiusuraNC}${agg.manualCloseReason ? ` — ${agg.manualCloseReason}` : ''} — rif. NC ${agg.invoiceNumber}`,
            aliquotaIVA: '—',
            tipo: 'pagamento',
          });
        }
      } else {
        // Fattura ricevuta → riga AVERE (aumenta debito)
        movimenti.push({
          data: agg.invoiceDate,
          dataPagamento: null,
          numero: agg.invoiceNumber,
          dare: 0,
          avere: agg.grossTotal,
          descrizione: `Fattura ${agg.tipoDoc || ''} Nr ${agg.invoiceNumber}`.trim(),
          aliquotaIVA: aliq,
          tipo: 'fattura',
        });
        // Chiusura a mano (TOTALE o PARZIALE) → riga DARE per l'importo chiuso a
        // mano, senza banca, dicitura "Chiusura manuale — chiusa a mano il GG/MM/AAAA".
        // Vale anche per i parziali (status 'parziale'): il saldo mostra il residuo.
        if (agg.closedManually && agg.manualClosedAmount > 0) {
          const dataRif = agg.manualCloseDate || agg.paymentDate;
          const dataChiusura = dataRif ? new Date(dataRif).toLocaleDateString('it-IT') : '—';
          const isPartial = agg.manualClosedAmount < Math.abs(agg.grossTotal) - 0.005;
          movimenti.push({
            data: agg.invoiceDate,           // data principale = emissione fattura
            dataPagamento: dataRif,          // mostrata sotto in piccolo
            numero: agg.invoiceNumber,
            dare: agg.manualClosedAmount,
            avere: 0,
            descrizione: `Chiusura manuale${isPartial ? ' parziale' : ''} — chiusa a mano il ${dataChiusura}${agg.manualCloseReason ? ` — ${agg.manualCloseReason}` : ''} — rif. Fatt. ${agg.invoiceNumber}`,
            aliquotaIVA: '—',
            tipo: 'pagamento',
          });
        } else if (agg.paidAmount > 0 && agg.paymentDate) {
          // Pagamento normale con banca. DARE = importo EFFETTIVAMENTE pagato
          // (somma delle rate saldate), NON il totale fattura: con fatture rateizzate
          // una sola rata pagata non deve chiudere l'intero importo -> il saldo del
          // fornitore mostra correttamente il residuo delle rate ancora aperte.
          const bankName = agg.paymentBankId ? (bankAccountById[agg.paymentBankId] || 'Banca non specificata') : 'Banca non specificata';
          const isPartial = agg.paidAmount < Math.abs(agg.grossTotal) - 0.005;
          movimenti.push({
            data: agg.invoiceDate,           // data principale = emissione fattura
            dataPagamento: agg.paymentDate,  // mostrata sotto in piccolo
            numero: agg.invoiceNumber,
            dare: agg.paidAmount,
            avere: 0,
            descrizione: `Pagamento${isPartial ? ' parziale' : ''} — ${bankName} — rif. Fatt. ${agg.invoiceNumber}`,
            aliquotaIVA: '—',
            tipo: 'pagamento',
          });
        }
      }
    }

    // Ordina: 'fattura' = per data emissione (fattura prima del pagamento)
    //         'pagamento' = pagamenti per data pagamento, fatture aperte/NC per data emissione
    movimenti.sort((a, b) => {
      let keyA: number, keyB: number;
      if (partitarioSortBy === 'pagamento') {
        keyA = new Date((a.tipo === 'pagamento' ? a.dataPagamento : a.data) || 0).getTime();
        keyB = new Date((b.tipo === 'pagamento' ? b.dataPagamento : b.data) || 0).getTime();
      } else {
        keyA = new Date(a.data || 0).getTime();
        keyB = new Date(b.data || 0).getTime();
      }
      if (keyA !== keyB) return keyA - keyB;
      // Stessa data + stesso numero: fattura prima del pagamento
      if (a.numero === b.numero) {
        if (a.tipo === 'fattura' && b.tipo === 'pagamento') return -1;
        if (a.tipo === 'pagamento' && b.tipo === 'fattura') return 1;
      }
      return 0;
    });

    // Saldo progressivo in SEGNO CONTABILE (= Dare − Avere): debito NEGATIVO.
    // Parte dalla RIPRESA SALDO (saldo apertura) come la contabilità.
    const totaliDare = movimenti.reduce((s, m) => s + m.dare, 0);
    const totaliAvere = movimenti.reduce((s, m) => s + m.avere, 0);
    const startSaldo = selectedYear === 'all' ? 0 : openingBalance;
    let saldo = startSaldo;
    const righeConSaldo: (MovimentoPartitario & { saldo: number })[] = [];
    if (selectedYear !== 'all') {
      righeConSaldo.push({
        data: `${fiscalYear}-01-01`, dataPagamento: null, numero: '',
        dare: 0, avere: 0, descrizione: 'RIPRESA SALDO', aliquotaIVA: '—',
        tipo: 'ripresa', saldo: startSaldo,
      });
    }
    for (const m of movimenti) {
      saldo += m.dare - m.avere;
      righeConSaldo.push({ ...m, saldo });
    }

    return { righe: righeConSaldo, totaliDare, totaliAvere, saldoFinale: saldo };
  }, [filteredPayables, bankAccountById, partitarioSortBy, openingBalance, fiscalYear, selectedYear, einvSplit]);

  // ─── Actions ───────────────────────────────────────────────
  const toggleExpand = (invoiceNumber: string) => {
    setExpandedInvoices(prev => {
      const next = new Set(prev);
      if (next.has(invoiceNumber)) next.delete(invoiceNumber);
      else next.add(invoiceNumber);
      return next;
    });
  };

  const handleViewInvoice = async (fattura: { invoice_number: string | null; rate?: Payable[] }) => {
    if (!COMPANY_ID) return;
    // Fix ticket "CT INDUSTRIE / MICHELE FISCO": il numero fattura NON e' univoco
    // tra fornitori diversi (es. due fornitori con fattura n.4). Match in 2 step:
    // 1) electronic_invoice_id del payable (univoco); 2) fallback numero+azienda+P.IVA.
    const eInvoiceId = fattura.rate?.find(r => r.electronic_invoice_id)?.electronic_invoice_id;
    if (eInvoiceId) {
      const { data } = await supabase
        .from('electronic_invoices')
        .select('xml_content')
        .eq('id', eInvoiceId)
        .not('xml_content', 'is', null)
        .maybeSingle();
      if (data?.xml_content) { setViewingXml(data.xml_content); return; }
    }

    const invoiceNumber = fattura.invoice_number || fattura.rate?.[0]?.invoice_number;
    if (!invoiceNumber) { toast({ type: 'warning', message: 'XML non disponibile per questa fattura' }); return; }

    let query = supabase
      .from('electronic_invoices')
      .select('xml_content')
      .eq('invoice_number', invoiceNumber)
      .eq('company_id', COMPANY_ID)
      .not('xml_content', 'is', null);
    const supplierVat = supplier?.partita_iva || supplier?.vat_number || fattura.rate?.[0]?.supplier_vat;
    if (supplierVat) {
      query = query.eq('supplier_vat', supplierVat);
    } else if (supplier?.name || supplier?.ragione_sociale) {
      query = query.eq('supplier_name', (supplier.name || supplier.ragione_sociale) as string);
    }
    const { data } = await query.limit(1).maybeSingle();

    if (data?.xml_content) {
      setViewingXml(data.xml_content);
    } else {
      toast({ type: 'warning', message: 'XML non disponibile per questa fattura' });
    }
  };

  const handlePayAll = () => {
    const name = supplier?.name || supplier?.ragione_sociale || '';
    navigate(`/scadenzario?supplier=${supplier?.id || supplierId}&search=${encodeURIComponent(name)}`);
  };

  const saveOpening = async () => {
    if (!COMPANY_ID || !supplier?.id) return;
    const raw = openingDraft.amount.trim().replace(/\./g, '').replace(',', '.');
    const amount = parseFloat(raw);
    if (isNaN(amount)) { toast({ type: 'warning', message: 'Importo non valido' }); return; }
    const { error } = await (supabase as unknown as { from: (t: string) => { upsert: (v: Record<string, unknown>, o: { onConflict: string }) => Promise<{ error: unknown }> } })
      .from('supplier_opening_balances')
      .upsert({
        company_id: COMPANY_ID,
        supplier_id: supplier.id,
        fiscal_year: fiscalYear,
        opening_balance: amount,
        as_of_date: openingDraft.date || null,
        source: 'manuale',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'company_id,supplier_id,fiscal_year' });
    if (error) { toast({ type: 'error', message: 'Errore salvataggio ripresa saldo' }); return; }
    toast({ type: 'success', message: 'Ripresa saldo salvata' });
    setEditingOpening(false);
    fetchData();
  };

  const handlePrintScheda = (mode: 'full' | 'fatture' | 'partitario' = 'full') => {
    const w = window.open('', '_blank');
    if (!w) return;

    const righeHTML = fattureGrouped.map(f => {
      const isNC = f.gross_amount < 0;
      const color = isNC ? 'color:#16a34a' : '';
      return `
      <tr style="${isNC ? 'background:#f0fdf4' : ''}">
        <td style="${color}">${isNC ? 'N/C ' : ''}${f.invoice_number || '—'}</td>
        <td style="${color}">${fmtDate(f.invoice_date)}</td>
        <td style="${color}">${isNC ? '—' : fmtDate(f.due_date)}</td>
        <td style="text-align:right;${color}">${fmt(f.net_amount)}</td>
        <td style="text-align:right;${color}">${fmt(f.vat_amount)}</td>
        <td style="text-align:right;font-weight:bold;${color}">${fmt(f.gross_amount)}</td>
        <td style="${color}">${isNC ? 'CREDITO' : f.status || '—'}</td>
      </tr>`;
    }).join('');

    const partitarioHTML = partitario.righe.map(m => {
      const bg = m.tipo === 'ripresa' ? '#fffbeb'
        : m.tipo === 'nota_credito' ? '#f0fdf4'
        : m.tipo === 'pagamento' ? '#eff6ff' : 'white';
      const dataCell = m.tipo === 'pagamento' && m.dataPagamento
        ? `<span style="color:#1d4ed8;font-weight:600">${fmtDate(m.dataPagamento)}</span>`
        : fmtDate(m.data);
      const descrCell = m.aliquotaIVA !== '—'
        ? `${m.descrizione} <span style="color:#64748b;font-size:7pt">(IVA ${m.aliquotaIVA})</span>`
        : m.descrizione;
      return `
      <tr style="background:${bg}">
        <td>${dataCell}</td>
        <td>${m.numero}</td>
        <td style="text-align:right;font-family:monospace">${m.dare > 0 ? fmt(m.dare) : ''}</td>
        <td style="text-align:right;font-family:monospace">${m.avere > 0 ? fmt(m.avere) : ''}</td>
        <td>${descrCell}</td>
        <td style="text-align:right;font-weight:bold;font-family:monospace;color:${m.saldo < -0.01 ? '#dc2626' : '#0f172a'}">${fmt(m.saldo)}</td>
      </tr>`;
    }).join('');
    const partitarioFooterHTML = partitario.righe.length > 0 ? `
      <tr style="background:#f1f5f9;font-weight:bold;border-top:2px solid #94a3b8">
        <td colspan="2" style="text-align:right">Totale Movimenti Selezionati:</td>
        <td style="text-align:right;font-family:monospace">${fmt(partitario.totaliDare)}</td>
        <td style="text-align:right;font-family:monospace">${fmt(partitario.totaliAvere)}</td>
        <td>Saldo:</td>
        <td style="text-align:right;font-family:monospace;color:${partitario.saldoFinale < -0.01 ? '#dc2626' : '#0f172a'}">${fmtEUR(partitario.saldoFinale)}</td>
      </tr>
      <tr style="background:${partitario.saldoFinale < -0.01 ? '#fef2f2' : '#f8fafc'};font-weight:bold">
        <td colspan="2" style="text-align:right">Totale Corrente Scheda Contabile:</td>
        <td style="text-align:right;font-family:monospace">${fmt(partitario.totaliDare)}</td>
        <td style="text-align:right;font-family:monospace">${fmt(partitario.totaliAvere)}</td>
        <td>${partitario.saldoFinale < -0.01 ? 'Saldo a debito:' : 'Saldo:'}</td>
        <td style="text-align:right;font-family:monospace;color:${partitario.saldoFinale < -0.01 ? '#991b1b' : '#0f172a'}">${fmtEUR(partitario.saldoFinale)}</td>
      </tr>` : '';

    w.document.write(`<!DOCTYPE html><html><head>
      <title>Scheda Contabile — ${supplier?.name || supplier?.ragione_sociale || ''}</title>
      <style>
        @page { size: A4; margin: 15mm 20mm; }
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 9pt; color: #333; }
        h1 { font-size: 14pt; color: #1e40af; margin-bottom: 4px; }
        h2 { font-size: 11pt; color: #1e40af; margin-top: 20px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        th { background: #f0f4ff; padding: 6px; text-align: left; font-size: 8pt; text-transform: uppercase; color: #555; border-bottom: 2px solid #2563eb; }
        td { padding: 5px 6px; border-bottom: 1px solid #eee; font-size: 9pt; }
        .info { font-size: 9pt; color: #555; }
        .kpi { display: flex; gap: 20px; margin: 15px 0; }
        .kpi-card { flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 4px; text-align: center; }
        .kpi-label { font-size: 8pt; text-transform: uppercase; color: #888; }
        .kpi-value { font-size: 14pt; font-weight: bold; }
        .footer { margin-top: 20px; font-size: 8pt; color: #999; text-align: center; border-top: 1px solid #ddd; padding-top: 8px; }
      </style>
    </head><body>
      <h1>${supplier?.name || supplier?.ragione_sociale || ''}</h1>
      <div class="info">P.IVA: ${supplier?.vat_number || supplier?.partita_iva || '—'} | CF: ${supplier?.codice_fiscale || supplier?.fiscal_code || '—'}</div>
      <div class="info">${supplier?.indirizzo || ''} ${supplier?.cap || ''} ${supplier?.comune || ''} ${supplier?.provincia ? `(${supplier.provincia})` : ''}</div>
      <div class="kpi">
        <div class="kpi-card"><div class="kpi-label">Fatturato</div><div class="kpi-value">${fmtEUR(kpis.totFatturato)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Pagato</div><div class="kpi-value" style="color:#16a34a">${fmtEUR(kpis.totPagato)}</div></div>
        ${kpis.totCrediti > 0 ? `<div class="kpi-card"><div class="kpi-label">Note credito</div><div class="kpi-value" style="color:#7c3aed">${fmtEUR(kpis.totCrediti)}</div></div>` : ''}
        <div class="kpi-card"><div class="kpi-label">Saldo contabile</div><div class="kpi-value" style="color:${partitario.saldoFinale < -0.01 ? '#dc2626' : '#0f172a'}">${fmtEUR(partitario.saldoFinale)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Scadute</div><div class="kpi-value" style="color:#d97706">${kpis.scadute}/${kpis.totali}</div></div>
      </div>
${mode !== 'partitario' ? `      <h2>FATTURE ${selectedYear === 'all' ? '— TUTTI GLI ANNI' : selectedYear}</h2>
      <table>
        <thead><tr><th>N. Fattura</th><th>Data</th><th>Scadenza</th><th style="text-align:right">Imponibile</th><th style="text-align:right">IVA</th><th style="text-align:right">Totale</th><th>Stato</th></tr></thead>
        <tbody>${righeHTML}
          <tr style="background:#eff6ff;font-weight:bold"><td colspan="3">TOTALE ${selectedYear === 'all' ? '' : selectedYear} — ${yearTotals.count} fatture</td>
            <td style="text-align:right">${fmt(yearTotals.net)}</td><td style="text-align:right">${fmt(yearTotals.vat)}</td><td style="text-align:right">${fmt(yearTotals.gross)}</td><td></td></tr>
        </tbody>
      </table>` : ''}
${mode !== 'fatture' ? `      <h2>PARTITARIO — CONTO FORNITORE</h2>
      <table>
        <thead><tr>
          <th>Data</th>
          <th>Numero</th>
          <th style="text-align:right">Dare / Imponibile</th>
          <th style="text-align:right">Avere / Imposta</th>
          <th>Descrizione Mov.to / Aliq. IVA</th>
          <th style="text-align:right">Saldo</th>
        </tr></thead>
        <tbody>${partitarioHTML}${partitarioFooterHTML}</tbody>
      </table>` : ''}
      <div class="footer">Generato il ${new Date().toLocaleDateString('it-IT')}</div>
      <script>window.onload = function() { window.print(); };</script>
    </body></html>`);
    w.document.close();
  };

  // ─── Render ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!supplier) {
    return (
      <div className="p-8 text-center text-slate-500">
        <AlertTriangle className="mx-auto mb-4 text-amber-500" size={40} />
        <p className="text-lg font-medium">Fornitore non trovato</p>
        <button onClick={() => navigate('/fornitori')} className="mt-4 text-blue-600 hover:underline">← Torna ai fornitori</button>
      </div>
    );
  }

  const supplierCategory = categories.find(c => c.id === supplier.default_cost_category_id);

  return (
    <div className="min-h-screen bg-white">
      <div className="p-4 sm:p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* InvoiceViewer modal */}
      {viewingXml && <InvoiceViewer xmlContent={viewingXml} onClose={() => setViewingXml(null)} />}

      {/* PageHeader uniforme — back button in actions, breadcrumb compatto sotto */}
      <PageHeader
        title="Scheda Contabile Fornitore"
        subtitle={`${supplier.name || supplier.ragione_sociale || '—'} · Partitario, fatture, pagamenti`}
        actions={
          <button
            onClick={() => navigate('/fornitori')}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
          >
            <ArrowLeft size={14} />
            Torna ai fornitori
          </button>
        }
      />
      <div className="text-xs text-slate-500 -mt-3">
        <Link to="/fornitori" className="hover:text-blue-600 transition">Fornitori</Link>
        <span className="mx-1.5">›</span>
        <span className="text-slate-700 font-medium">{supplier.name || supplier.ragione_sociale}</span>
      </div>

      {/* ─── INTESTAZIONE ─────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                <Building2 size={20} className="text-blue-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">{supplier.name || supplier.ragione_sociale}</h1>
                {supplierCategory && (
                  <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full">{supplierCategory.name}</span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 text-sm text-slate-600 mt-3">
              {(supplier.vat_number || supplier.partita_iva) && (
                <div><span className="text-slate-400">P.IVA:</span> {supplier.vat_number || supplier.partita_iva}</div>
              )}
              {(supplier.codice_fiscale || supplier.fiscal_code) && (
                <div><span className="text-slate-400">CF:</span> {supplier.codice_fiscale || supplier.fiscal_code}</div>
              )}
              {supplier.indirizzo && (
                <div className="flex items-center gap-1.5">
                  <MapPin size={12} className="text-slate-400" />
                  {supplier.indirizzo}, {supplier.cap} {supplier.comune} {supplier.provincia && `(${supplier.provincia})`}
                </div>
              )}
              {supplier.iban && (
                <div><span className="text-slate-400">IBAN:</span> <span className="font-mono text-xs">{supplier.iban}</span></div>
              )}
              {supplier.email && (
                <div className="flex items-center gap-1.5"><Mail size={12} className="text-slate-400" />{supplier.email}</div>
              )}
              {supplier.pec && (
                <div className="flex items-center gap-1.5"><Mail size={12} className="text-blue-400" />{supplier.pec} <span className="text-xs text-blue-400">(PEC)</span></div>
              )}
              {supplier.telefono && (
                <div className="flex items-center gap-1.5"><Phone size={12} className="text-slate-400" />{supplier.telefono}</div>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => handlePrintScheda('full')} className="flex items-center gap-1.5 px-3 py-2 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
              <Printer size={14} /> Stampa
            </button>
            <button onClick={() => handlePrintScheda('fatture')} className="flex items-center gap-1.5 px-3 py-2 text-xs bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition">
              <Printer size={14} /> Solo fatture
            </button>
            <button onClick={() => handlePrintScheda('partitario')} className="flex items-center gap-1.5 px-3 py-2 text-xs bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition">
              <Printer size={14} /> Solo partitario
            </button>
            {kpis.scadute > 0 && (
              <button onClick={handlePayAll} className="flex items-center gap-1.5 px-3 py-2 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 transition">
                <CreditCard size={14} /> Paga scadute ({kpis.scadute})
              </button>
            )}
          </div>
        </div>

        {/* KPI Cards */}
        <div className={`grid grid-cols-2 md:grid-cols-4 ${kpis.totCrediti > 0 ? 'lg:grid-cols-5' : ''} gap-4 mt-6`}>
          <div className="rounded-xl bg-blue-50 p-4 text-center">
            <div className="text-xs text-blue-600 uppercase font-semibold">Totale fatturato</div>
            <div className="text-lg font-bold text-blue-900 mt-1">{fmtEUR(kpis.totFatturato)}</div>
          </div>
          <div className="rounded-xl bg-emerald-50 p-4 text-center">
            <div className="text-xs text-emerald-600 uppercase font-semibold">Totale pagato</div>
            <div className="text-lg font-bold text-emerald-900 mt-1">{fmtEUR(kpis.totPagato)}</div>
          </div>
          {/* Fix 9.1: Note credito mostrate come KPI separato (non sommate al pagato) */}
          {kpis.totCrediti > 0 && (
            <div className="rounded-xl bg-violet-50 p-4 text-center">
              <div className="text-xs text-violet-600 uppercase font-semibold">Note credito</div>
              <div className="text-lg font-bold text-violet-900 mt-1">{fmtEUR(kpis.totCrediti)}</div>
            </div>
          )}
          <div className={`rounded-xl p-4 text-center ${partitario.saldoFinale < -0.01 ? 'bg-red-50' : 'bg-slate-50'}`}>
            <div className={`text-xs uppercase font-semibold ${partitario.saldoFinale < -0.01 ? 'text-red-600' : 'text-slate-500'}`}>Saldo contabile</div>
            <div className={`text-lg font-bold mt-1 ${partitario.saldoFinale < -0.01 ? 'text-red-900' : 'text-slate-700'}`}>{fmtEUR(partitario.saldoFinale)}</div>
          </div>
          <div className={`rounded-xl p-4 text-center ${kpis.scadute > 0 ? 'bg-amber-50' : 'bg-slate-50'}`}>
            <div className={`text-xs uppercase font-semibold ${kpis.scadute > 0 ? 'text-amber-600' : 'text-slate-500'}`}>Scadute</div>
            <div className={`text-lg font-bold mt-1 ${kpis.scadute > 0 ? 'text-amber-900' : 'text-slate-700'}`}>{kpis.scadute} / {kpis.totali}</div>
          </div>
        </div>
      </div>

      {/* ─── RIPRESA SALDO (saldo apertura) ───────────────── */}
      {selectedYear !== 'all' && (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-700">Ripresa saldo {fiscalYear}</span>
            <span className="text-xs text-slate-400">(saldo al 31/12/{fiscalYear - 1})</span>
          </div>
          {!editingOpening ? (
            <div className="flex items-center gap-4">
              <span className={`text-base font-bold font-mono ${openingBalance < -0.01 ? 'text-red-700' : 'text-slate-900'}`}>{fmtEUR(openingBalance)}</span>
              {openingRowCur?.as_of_date && <span className="text-xs text-slate-500">al {fmtDate(openingRowCur.as_of_date)}</span>}
              {openingRowCur?.source && <span className="text-[10px] uppercase tracking-wide text-slate-400">{openingRowCur.source}</span>}
              <button onClick={() => { setOpeningDraft({ amount: String(openingBalance).replace('.', ','), date: openingRowCur?.as_of_date || `${fiscalYear - 1}-12-31` }); setEditingOpening(true); }} className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 rounded-lg transition">Modifica</button>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-[10px] uppercase text-slate-500 mb-1">Importo (− = debito)</label>
                <input value={openingDraft.amount} onChange={e => setOpeningDraft(d => ({ ...d, amount: e.target.value }))} placeholder="-1.234,56" className="w-32 px-2 py-1.5 border border-slate-300 rounded-lg text-sm font-mono text-right focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-[10px] uppercase text-slate-500 mb-1">Data</label>
                <input type="date" value={openingDraft.date} onChange={e => setOpeningDraft(d => ({ ...d, date: e.target.value }))} className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
              </div>
              <button onClick={saveOpening} className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">Salva</button>
              <button onClick={() => setEditingOpening(false)} className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 rounded-lg transition">Annulla</button>
            </div>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-2">Segno contabile: <b>negativo = debito</b> (quanto dobbiamo noi), positivo = credito a nostro favore.</p>
      </div>
      )}

      {/* ─── TAB ANNI + TABELLA FATTURE ───────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100">
        {/* Tab bar */}
        <div className="flex items-center gap-1 px-5 pt-4 pb-2 border-b border-slate-100 overflow-x-auto">
          <BookOpen size={16} className="text-blue-600 mr-2 flex-shrink-0" />
          <span className="text-sm font-semibold text-slate-700 mr-4 flex-shrink-0">Fatture</span>
          {anni.map(y => (
            <button key={y}
              onClick={() => setSelectedYear(y)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition flex-shrink-0 ${
                selectedYear === y ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >{y}</button>
          ))}
          <button
            onClick={() => setSelectedYear('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition flex-shrink-0 ${
              selectedYear === 'all' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >Tutti</button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto scroll-shadow-x">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-500 uppercase">
                <th className="px-3 py-2.5 text-left w-8"></th>
                <th className="px-3 py-2.5 text-left">N. Fattura</th>
                <th className="px-3 py-2.5 text-left">Data</th>
                <th className="px-3 py-2.5 text-left">Scadenza</th>
                <th className="px-3 py-2.5 text-right">Imponibile</th>
                <th className="px-3 py-2.5 text-right">IVA</th>
                <th className="px-3 py-2.5 text-right">Totale</th>
                <th className="px-3 py-2.5 text-center">Stato</th>
                <th className="px-3 py-2.5 text-center">Pagamento</th>
                <th className="px-3 py-2.5 text-center w-20">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {fattureGrouped.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-400">Nessuna fattura per il periodo selezionato</td></tr>
              )}
              {fattureGrouped.map((f, idx) => {
                const hasRate = f.rate.length > 1 && f.rate.some(r => r.installment_number != null);
                const isExpanded = expandedInvoices.has(f.invoice_number ?? '');
                const dd = daysDiff(f.due_date);
                const dueBadge = f.status === 'pagato'
                  ? fmtDate(f.rate[0]?.payment_date)
                  : dd != null
                    ? dd < 0 ? <span className="text-red-600 font-medium">{dd}gg</span> : <span className="text-slate-500">tra {dd}gg</span>
                    : '—';

                return (
                  <React.Fragment key={f.invoice_number || idx}>
                    <tr className={`border-b border-slate-50 hover:bg-slate-25 transition ${idx % 2 === 0 ? '' : 'bg-slate-25/50'}`}>
                      <td className="px-2 py-2">
                        {hasRate && (
                          <button onClick={() => toggleExpand(f.invoice_number ?? '')} title="Mostra/Nascondi rate" className="p-0.5 rounded hover:bg-slate-100 text-slate-400">
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        )}
                      </td>
                      <td className={`px-3 py-2 font-medium ${f.gross_amount < 0 ? 'text-emerald-700' : 'text-slate-800'}`}>
                        {f.gross_amount < 0 ? 'N/C ' : ''}{f.invoice_number || '—'}
                        {f.gross_amount < 0 && (
                          <span className="ml-1.5 text-[10px] px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded-full font-medium">Nota Credito</span>
                        )}
                        {hasRate && (
                          <span className="ml-1.5 text-[10px] px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded-full font-medium">{f.rate.length} rate</span>
                        )}
                      </td>
                      <td className={`px-3 py-2 ${f.gross_amount < 0 ? 'text-emerald-600' : 'text-slate-600'}`}>{fmtDate(f.invoice_date)}</td>
                      <td className={`px-3 py-2 ${f.gross_amount < 0 ? 'text-emerald-600' : dd != null && dd < 0 && f.status !== 'pagato' ? 'text-red-600 font-medium' : 'text-slate-600'}`}>
                        {f.gross_amount < 0 ? '—' : fmtDate(f.due_date)}
                      </td>
                      <td className={`px-3 py-2 text-right ${f.gross_amount < 0 ? 'text-emerald-600' : 'text-slate-600'}`}>{fmt(f.net_amount)}</td>
                      <td className={`px-3 py-2 text-right ${f.gross_amount < 0 ? 'text-emerald-600' : 'text-slate-600'}`}>{fmt(f.vat_amount)}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${f.gross_amount < 0 ? 'text-emerald-700' : 'text-slate-900'}`}>{fmt(f.gross_amount)}</td>
                      <td className="px-3 py-2 text-center">
                        {f.gross_amount < 0
                          ? <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full bg-emerald-100 text-emerald-700">CREDITO</span>
                          : <StatusBadge status={f.status} size="sm" />}
                      </td>
                      <td className="px-3 py-2 text-center text-xs">{dueBadge}</td>
                      <td className="px-2 py-2 text-center">
                        <div className="flex items-center justify-center gap-0.5">
                          <button onClick={() => handleViewInvoice(f)} className="p-1 rounded hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition" title="Vedi fattura">
                            <Eye size={14} />
                          </button>
                          {f.status !== 'pagato' && f.status !== 'nota_credito' && f.gross_amount > 0 && (
                            <button onClick={() => navigate(`/scadenzario?supplier=${supplierId}&search=${encodeURIComponent(supplier?.name || '')}`)} className="p-1 rounded hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition" title="Paga">
                              <CreditCard size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Expanded rate */}
                    {hasRate && isExpanded && f.rate.map((r, ri) => (
                      <tr key={r.id} className="bg-indigo-50/30 border-b border-indigo-100/50">
                        <td className="px-2 py-1.5"></td>
                        <td className="px-3 py-1.5 text-xs text-indigo-600 pl-8">
                          Rata {r.installment_number || ri + 1}/{f.rate.length}
                          {r.payment_method && <span className="ml-2 text-slate-500">{paymentMethodLabels[r.payment_method] || r.payment_method}</span>}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-slate-500">{fmtDate(r.invoice_date)}</td>
                        <td className="px-3 py-1.5 text-xs text-slate-500">{fmtDate(r.due_date)}</td>
                        <td className="px-3 py-1.5 text-right text-xs text-slate-400"></td>
                        <td className="px-3 py-1.5 text-right text-xs text-slate-400"></td>
                        <td className="px-3 py-1.5 text-right text-xs font-medium text-slate-700">{fmt(Number(r.gross_amount || 0))}</td>
                        <td className="px-3 py-1.5 text-center"><StatusBadge status={r.status ?? 'da_pagare'} size="sm" /></td>
                        <td className="px-3 py-1.5 text-center text-xs text-slate-500">
                          {r.status === 'pagato' ? fmtDate(r.payment_date) : daysDiff(r.due_date) != null ? `${daysDiff(r.due_date)}gg` : '—'}
                        </td>
                        <td className="px-2 py-1.5"></td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
              {/* Totale anno */}
              {fattureGrouped.length > 0 && (
                <tr className="bg-blue-50 font-semibold text-sm">
                  <td className="px-2 py-3"></td>
                  <td className="px-3 py-3 text-blue-800" colSpan={3}>
                    TOTALE {selectedYear === 'all' ? '' : selectedYear} — {yearTotals.count} fatture
                  </td>
                  <td className="px-3 py-3 text-right text-blue-800">{fmt(yearTotals.net)}</td>
                  <td className="px-3 py-3 text-right text-blue-800">{fmt(yearTotals.vat)}</td>
                  <td className="px-3 py-3 text-right text-blue-900">{fmt(yearTotals.gross)}</td>
                  <td className="px-3 py-3 text-center text-xs text-blue-600">
                    Pagato: {fmt(yearTotals.pagato)}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── PARTITARIO ───────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100">
        <div className="px-5 pt-4 pb-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
          <FileText size={16} className="text-blue-600" />
          <span className="text-sm font-semibold text-slate-700">Partitario — Conto Fornitore</span>
          <span className="text-xs text-slate-500 hidden md:inline">
            AVERE = fatture ricevute · DARE = pagamenti + note di credito
          </span>
          {/* Selettore ordinamento */}
          <div className="ml-auto flex items-center gap-2">
            <label htmlFor="partitario-sort" className="text-xs text-slate-600 font-medium">Ordina per:</label>
            <select
              id="partitario-sort"
              value={partitarioSortBy}
              onChange={(e) => setPartitarioSortBy(e.target.value as 'fattura' | 'pagamento')}
              className="px-2.5 py-1 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="fattura">Data fattura</option>
              <option value="pagamento">Data pagamento</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto scroll-shadow-x">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-500 uppercase">
                <th className="px-4 py-2.5 text-left w-[110px]">Data</th>
                <th className="px-4 py-2.5 text-left w-[120px]">Numero</th>
                <th className="px-4 py-2.5 text-right w-[130px]">Dare / Imponibile</th>
                <th className="px-4 py-2.5 text-right w-[130px]">Avere / Imposta</th>
                <th className="px-4 py-2.5 text-left">Descrizione Mov.to / Aliq. IVA</th>
                <th className="px-4 py-2.5 text-right w-[110px]">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {partitario.righe.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Nessun movimento</td></tr>
              )}
              {partitario.righe.map((m, i) => {
                const rowBg = m.tipo === 'ripresa'
                  ? 'bg-amber-50 font-semibold'
                  : m.tipo === 'nota_credito'
                  ? 'bg-emerald-50/40'
                  : m.tipo === 'pagamento'
                    ? 'bg-blue-50/20'
                    : i % 2 === 0 ? '' : 'bg-slate-50/40';
                return (
                  <tr key={i} className={`border-b border-slate-50 ${rowBg}`}>
                    <td className="px-4 py-2 align-top">
                      {m.tipo === 'pagamento' && m.dataPagamento ? (
                        <div className="text-blue-700 font-medium" title="Data effettiva pagamento">
                          {fmtDate(m.dataPagamento)}
                        </div>
                      ) : (
                        <div className="text-slate-600">{fmtDate(m.data)}</div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-700 font-mono text-xs align-top">{m.numero}</td>
                    <td className="px-4 py-2 text-right align-top font-mono text-slate-900">
                      {m.dare > 0 ? fmt(m.dare) : ''}
                    </td>
                    <td className="px-4 py-2 text-right align-top font-mono text-slate-900">
                      {m.avere > 0 ? fmt(m.avere) : ''}
                    </td>
                    <td className={`px-4 py-2 align-top ${
                      m.tipo === 'nota_credito' ? 'text-emerald-700 font-medium' :
                      m.tipo === 'pagamento' ? 'text-blue-700' : 'text-slate-800'
                    }`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span>{m.descrizione}</span>
                        {m.aliquotaIVA !== '—' && (
                          <span className="text-xs text-slate-500 shrink-0">IVA {m.aliquotaIVA}</span>
                        )}
                      </div>
                    </td>
                    <td className={`px-4 py-2 text-right font-bold align-top font-mono ${
                      m.saldo < -0.01 ? 'text-red-700' : 'text-slate-900'
                    }`}>{fmt(m.saldo)}</td>
                  </tr>
                );
              })}
              {/* Riga totali finali stile gestionale tradizionale */}
              {partitario.righe.length > 0 && (
                <>
                  <tr className="font-bold text-sm border-t-2 border-slate-300 bg-slate-50">
                    <td className="px-4 py-2.5 text-right text-slate-700" colSpan={2}>
                      Totale Movimenti Selezionati:
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-900">{fmt(partitario.totaliDare)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-900">{fmt(partitario.totaliAvere)}</td>
                    <td className="px-4 py-2.5 text-slate-600">Saldo:</td>
                    <td className={`px-4 py-2.5 text-right font-mono ${partitario.saldoFinale < -0.01 ? 'text-red-700' : 'text-slate-900'}`}>
                      {fmtEUR(partitario.saldoFinale)}
                    </td>
                  </tr>
                  <tr className={`font-bold text-sm ${partitario.saldoFinale < -0.01 ? 'bg-red-50' : 'bg-slate-50'}`}>
                    <td className="px-4 py-3 text-right" colSpan={2}>
                      Totale Corrente Scheda Contabile:
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(partitario.totaliDare)}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(partitario.totaliAvere)}</td>
                    <td className="px-4 py-3">
                      {partitario.saldoFinale < -0.01 ? 'Saldo a debito:' : 'Saldo:'}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono text-base ${partitario.saldoFinale < -0.01 ? 'text-red-800' : 'text-slate-900'}`}>
                      {fmtEUR(partitario.saldoFinale)}
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
      </div>
    </div>
  );
}
