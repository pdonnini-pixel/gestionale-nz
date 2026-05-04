/**
 * Import Engine — orchestra il flusso completo:
 * 1. Legge il file da Supabase Storage (o dall'upload diretto)
 * 2. Parsa con il parser appropriato (CSV / XML)
 * 3. Trasforma i dati nel formato delle tabelle target
 * 4. Inserisce in batch su Supabase
 * 5. Aggiorna lo stato dell'import batch
 *
 * Tutto gira client-side nel browser — nessun backend necessario.
 */

import { supabase } from '../supabase';
import { parseCSV, autoDetectBankMapping, transformBankRows, transformPOSRows, parseItalianNumber } from './csvParser';
import { parseFatturaPA, transformInvoiceToRecords } from './xmlInvoiceParser';
import { parseBilancio, toSupabaseRecords as bilancioToRecords } from './bilancioParser';
import * as XLSX from 'xlsx';

const BATCH_SIZE = 100; // max rows per insert

// ─── MAIN ENTRY POINT ───────────────────────────────────────────

/**
 * Processa un file caricato: parsa e inserisce nel DB
 * @param {Object} params
 * @param {File|null} params.file - file oggetto dal browser (se upload diretto)
 * @param {string|null} params.storagePath - path in Supabase Storage (se già caricato)
 * @param {string} params.bucket - nome bucket Storage
 * @param {string} params.sourceType - 'bank' | 'invoices' | 'pos_data' | 'receipts'
 * @param {Object} params.context - { company_id, bank_account_id?, outlet_id?, ... }
 * @param {Object|null} params.mappingOverride - mapping colonne manuale (se utente l'ha configurato)
 * @param {function} params.onProgress - callback(percent, message)
 * @returns {{ success: boolean, imported: number, errors: Object[], batchId: string }}
 */
// TODO: tighten type — define dedicated interfaces for import params/result
interface CsvOptions {
  delimiter?: string;
  skipRows?: number;
  dateFormat?: string;
  decimalSep?: string;
  thousandSep?: string;
}

interface ImportContext {
  company_id: string;
  bank_account_id?: string | null;
  outlet_id?: string | null;
  year?: number;
  period_type?: string;
  csvOptions?: CsvOptions;
  decimalSep?: string;
  thousandSep?: string;
  dateFormat?: string;
}

interface ImportParams {
  file?: File | null;
  storagePath?: string | null;
  bucket?: string;
  sourceType: string;
  context: ImportContext;
  mappingOverride?: Record<string, string> | null;
  onProgress?: (percent: number, message: string) => void;
}

interface ImportResult {
  success: boolean;
  imported: number;
  errors: Record<string, unknown>[];
  batchId: string | null;
  details?: Record<string, unknown> | null;
}

type ProcessorResult = {
  imported: number;
  errors: Record<string, unknown>[];
  details?: Record<string, unknown> | null;
  warnings?: Record<string, unknown>[];
};

export async function processImport({
  file,
  storagePath,
  bucket,
  sourceType,
  context,
  mappingOverride = null,
  onProgress = () => {},
}: ImportParams): Promise<ImportResult> {
  const startTime = Date.now();

  try {
    onProgress(5, 'Lettura file...');

    // 1. Read file content — binary for PDF/XLS/XLSX, text for CSV/XML
    const fileName = file?.name || storagePath || '';
    const ext = fileName.toLowerCase().split('.').pop();
    const isPDF = ext === 'pdf';
    const isExcel = ext === 'xls' || ext === 'xlsx' || ext === 'xlsm';
    const needsBinary = isPDF || isExcel;
    const content = await readFileContent(file, storagePath, bucket, { asBinary: needsBinary });
    if (!needsBinary && (!content || (typeof content === 'string' && content.trim().length === 0))) {
      return { success: false, imported: 0, errors: [{ message: 'File vuoto o non leggibile' }], batchId: null };
    }
    if (needsBinary && (!content || (content as ArrayBuffer).byteLength === 0)) {
      return { success: false, imported: 0, errors: [{ message: 'File vuoto o non leggibile' }], batchId: null };
    }

    onProgress(15, 'Creazione batch di import...');

    // 2. Create import_batch record
    const batchId = await createImportBatch(context.company_id, sourceType, file?.name || storagePath || undefined);

    onProgress(20, 'Parsing in corso...');

    // 3. Route to appropriate processor
    let result: ProcessorResult;
    switch (sourceType) {
      case 'bank':
        result = await processBankStatement(content, context, batchId, mappingOverride, onProgress, { isExcel, fileName });
        break;
      case 'invoices':
        result = await processInvoiceXML(content, context, batchId, onProgress);
        break;
      case 'pos_data':
        result = await processPOSCSV(content, context, batchId, mappingOverride, onProgress);
        break;
      case 'balance_sheet':
        result = await processBalanceSheetPDF(content, context, batchId, onProgress);
        break;
      case 'receipts':
        result = await processReceiptsCSV(content, context, batchId, mappingOverride, onProgress);
        break;
      case 'payroll':
        result = await processPayrollCSV(content, context, batchId, mappingOverride, onProgress);
        break;
      default:
        return { success: false, imported: 0, errors: [{ message: `Tipo sorgente non supportato: ${sourceType}` }], batchId };
    }

    // 4. Update batch status
    const elapsed = Date.now() - startTime;
    await updateImportBatch(batchId, {
      status: result.errors.length > 0 && result.imported === 0 ? 'error' : 'completed',
      rows_imported: result.imported,
      rows_error: result.errors.length,
      rows_total: result.imported + result.errors.length,
      completed_at: new Date().toISOString(),
      error_log: result.errors.length > 0 ? result.errors.slice(0, 50) : null, // max 50 errors
      notes: `Processato in ${Math.round(elapsed / 1000)}s`,
    });

    onProgress(100, `Completato: ${result.imported} record importati`);

    return {
      success: result.imported > 0,
      imported: result.imported,
      errors: result.errors,
      batchId,
      details: result.details || null,
    };
  } catch (err: unknown) {
    console.error('Import engine error:', err);
    return {
      success: false,
      imported: 0,
      errors: [{ message: `Errore imprevisto: ${(err as Error).message}` }],
      batchId: null,
    };
  }
}

// ─── FILE READING ───────────────────────────────────────────────

async function readFileContent(file: File | null | undefined, storagePath: string | null | undefined, bucket: string | null | undefined, { asBinary = false } = {}): Promise<string | ArrayBuffer> {
  if (file) {
    return new Promise<string | ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target!.result as string | ArrayBuffer);
      reader.onerror = () => reject(new Error('Errore lettura file'));
      if (asBinary) {
        reader.readAsArrayBuffer(file);
      } else {
        reader.readAsText(file, 'UTF-8');
      }
    });
  }

  if (storagePath && bucket) {
    const { data, error } = await supabase.storage.from(bucket).download(storagePath);
    if (error) throw new Error(`Errore download: ${error.message}`);
    if (asBinary) {
      return await data.arrayBuffer();
    }
    return await data.text();
  }

  throw new Error('Nessun file o path fornito');
}

// ─── BATCH MANAGEMENT ───────────────────────────────────────────

type ImportSourceEnum = 'csv_banca' | 'csv_ade' | 'csv_pos' | 'api_pos' | 'api_ade' | 'manuale' | 'csv_fatture' | 'xml_sdi' | 'pdf_bilancio' | 'csv_cedolini' | 'api_yapily';

async function createImportBatch(companyId: string, sourceType: string, fileName: string | undefined): Promise<string> {
  // Values MUST match the import_source enum in PostgreSQL
  const sourceMap: Record<string, ImportSourceEnum> = {
    bank: 'csv_banca',
    invoices: 'xml_sdi',
    pos_data: 'csv_pos',
    receipts: 'csv_ade',
    balance_sheet: 'pdf_bilancio',
    payroll: 'csv_cedolini',
  };

  const { data, error } = await supabase
    .from('import_batches')
    .insert({
      company_id: companyId,
      source: sourceMap[sourceType] || 'manuale',
      status: 'processing',
      file_name: fileName,
      imported_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) throw new Error(`Errore creazione batch: ${error.message}`);
  return data.id;
}

async function updateImportBatch(batchId: string, updates: Record<string, unknown>): Promise<void> {
  const { error } = await (supabase
    .from('import_batches') as unknown as { update: (u: Record<string, unknown>) => { eq: (k: string, v: string) => Promise<{ error: { message: string } | null }> } })
    .update(updates)
    .eq('id', batchId);

  if (error) console.error('Error updating batch:', error);
}

// ─── BANK CSV PROCESSOR ─────────────────────────────────────────

/**
 * Converte un file Excel (XLS/XLSX) in { headers, rows } come se fosse CSV.
 * Skippa righe di riepilogo finali (RIEPILOGO, Totali, vuote).
 */
/**
 * Estrae dal contenuto del file il totale movimenti dichiarato dalla banca
 * (es. MPS scrive "Movimenti: 1000" in fondo). Serve a rilevare import
 * incompleti confrontandolo con il numero di record effettivamente parsati.
 * Ritorna null se non lo trova.
 */
function findDeclaredMovementCount(allRows: unknown[]): number | null {
  if (!Array.isArray(allRows)) return null;
  for (const row of allRows) {
    if (!row) continue;
    const text = Array.isArray(row)
      ? row.filter(v => v != null && v !== '').map(v => v.toString()).join(' ')
      : String(row);
    const m = text.match(/(?:n\.?\s*)?movimenti\s*[:\-]?\s*(\d{1,6})/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > 0 && n < 100000) return n;
    }
  }
  return null;
}

function excelToHeadersRows(arrayBuffer: ArrayBuffer | string): { headers: string[]; rows: Record<string, string>[]; declaredCount: number | null } {
  // Read with cellDates so date cells become JS Date objects
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Get raw data (with raw:true so dates stay as Date objects, numbers as numbers)
  const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
  if (allRows.length < 2) return { headers: [], rows: [], declaredCount: null };

  // Rileva il conteggio dichiarato dalla banca (prima di filtrare le righe!)
  const declaredCount = findDeclaredMovementCount(allRows);

  const headers = (allRows[0] as unknown[]).map((h: unknown) => (h || '').toString().trim());

  /**
   * Format a cell value to string.
   * Date objects → 'DD/MM/YYYY' (Italian format, unambiguous for our parser)
   * Numbers → Italian format with comma decimal (e.g. 153.45 → "153,45")
   *           so that parseItalianNumber (which expects comma-decimal) works correctly
   */
  function cellToString(val: unknown): string {
    if (val === null || val === undefined || val === '') return '';
    if (val instanceof Date && !isNaN(val.getTime())) {
      const dd = String(val.getDate()).padStart(2, '0');
      const mm = String(val.getMonth() + 1).padStart(2, '0');
      const yyyy = val.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    }
    if (typeof val === 'number' && !isNaN(val)) {
      // Convert JS number to Italian format: dot→comma for decimal
      // e.g. 153.45 → "153,45" so parseItalianNumber handles it correctly
      // Use fixed 2 decimals for amounts, but preserve integers
      const str = Number.isInteger(val) ? val.toString() : val.toFixed(2);
      return str.replace('.', ',');
    }
    return val.toString();
  }

  // Build row objects (like CSV parser does) and skip summary/empty rows.
  // IMPORTANTE: NON usare mai `break` su righe vuote intermedie — MPS e altre
  // banche possono avere righe blank tra blocchi mensili. L'unico break e' su
  // un marker terminale certo ("Saldo finale" con sole colonne vuote di seguito).
  // Le righe non-transazione (totali pagina, saldo iniziale, riepilogo) vengono
  // saltate con `continue` cosi il loop continua.
  const BLACKLIST_FIRST_CELL = /^(riepilogo|totali(\s|$)|totali\s+(pagina|parziali|complessivi)|saldo\s+(contabile|disponibile|iniziale|finale|precedente)|saldo\s+progressivo|avviso|operazioni\s+(non\s+)?contabilizzate|elenco\s+movimenti|elenco\s+non\s+completo|per\s+visualizzare\s+gli\s+altri\s+dati|pag\.?\s*\d+|n\.?\s*movimenti|movimenti\s*:)/i;
  // Blacklist full-text: anche se la prima cella e' la data, intercettiamo
  // righe di riepilogo che contengono testo sentinella in qualsiasi colonna
  // (es. MPS scrive "Elenco non completo..." come messaggio multi-colonna).
  const BLACKLIST_FULL_ROW = /(elenco\s+non\s+completo|per\s+visualizzare\s+gli\s+altri\s+dati|saldo\s+contabile\s+(iniziale|finale|progressivo)|totali?\s+(pagina|parziali|periodo)|operazioni\s+(non\s+)?contabilizzate)/i;
  const dataRows: Record<string, string>[] = [];
  for (let i = 1; i < allRows.length; i++) {
    const raw = allRows[i] as unknown[];
    const firstCell = cellToString(raw[0]).trim();

    // Riga completamente vuota: continue (NON break — potrebbe esserci un
    // separatore prima del blocco successivo nel file MPS multi-periodo)
    if (firstCell === '' && raw.every((c: unknown) => !c || cellToString(c).trim() === '')) continue;

    // Riga di riepilogo/saldo/totali: continue (skip singola riga, non interrompe l'import)
    if (BLACKLIST_FIRST_CELL.test(firstCell)) continue;

    // Full-row blacklist: intercetta messaggi di avviso che occupano piu' celle
    const fullRowText = raw.map(cellToString).join(' ');
    if (BLACKLIST_FULL_ROW.test(fullRowText)) continue;

    const rowObj: Record<string, string> = {};
    headers.forEach((h: string, idx: number) => {
      rowObj[h] = raw[idx] !== undefined ? cellToString(raw[idx]) : '';
    });
    dataRows.push(rowObj);
  }

  return { headers, rows: dataRows, declaredCount };
}

async function processBankStatement(content: string | ArrayBuffer, context: ImportContext, batchId: string, mappingOverride: Record<string, string> | null, onProgress: (percent: number, message: string) => void, { isExcel = false }: { isExcel?: boolean; fileName?: string } = {}): Promise<ProcessorResult> {
  let headers: string[], rows: Record<string, string>[];
  let parseErrors: string[] = [];
  let declaredCount: number | null = null; // conteggio movimenti dichiarato dalla banca nel file

  if (isExcel) {
    // Parse Excel file
    onProgress(25, 'Conversione file Excel...');
    try {
      const result = excelToHeadersRows(content);
      headers = result.headers;
      rows = result.rows;
      declaredCount = result.declaredCount;
    } catch (err: unknown) {
      return { imported: 0, errors: [{ message: `Errore lettura Excel: ${(err as Error).message}` }] };
    }
  } else {
    // Parse CSV
    const csvResult = parseCSV(typeof content === 'string' ? content : '', {
      delimiter: context.csvOptions?.delimiter,
      skipRows: context.csvOptions?.skipRows || 0,
      dateFormat: context.csvOptions?.dateFormat || 'DD/MM/YYYY',
    });
    headers = csvResult.headers;
    rows = csvResult.rows;
    parseErrors = csvResult.errors || [];
  }

  if (!rows || rows.length === 0) {
    return { imported: 0, errors: [...parseErrors.map(e => ({ message: e })), { message: 'Nessuna riga dati trovata' }] };
  }

  onProgress(30, `Parsate ${rows.length} righe, mapping colonne...`);

  // Determine column mapping
  let mapping: Record<string, string>;
  if (mappingOverride) {
    mapping = mappingOverride;
  } else {
    const detected = autoDetectBankMapping(headers);
    mapping = detected.mapping;
    if (detected.confidence < 50) {
      return {
        imported: 0,
        errors: [{ message: `Mapping colonne incerto (${detected.confidence}%). Headers trovati: [${headers.join(', ')}]. Configurare manualmente.` }],
        details: { headers, detectedMapping: detected },
      };
    }
  }

  onProgress(40, 'Trasformazione dati...');

  // Transform rows
  const { records, errors: transformErrors } = transformBankRows(rows, mapping, {
    company_id: context.company_id,
    bank_account_id: context.bank_account_id,
    dateFormat: context.dateFormat,
    decimalSep: context.decimalSep,
    thousandSep: context.thousandSep,
    import_batch_id: batchId,
  });

  if (records.length === 0) {
    return { imported: 0, errors: [...parseErrors.map(e => ({ message: e })), ...transformErrors] };
  }

  onProgress(60, `Inserimento ${records.length} movimenti bancari...`);

  // Insert in batches
  const { inserted, insertErrors } = await batchInsert('cash_movements', records, onProgress, 60, 95);

  // Update bank account balance with last known balance_after
  if (inserted > 0 && context.bank_account_id) {
    const bankAccountId = context.bank_account_id;
    const lastRecord = records.filter(r => r.balance_after != null).pop();
    if (lastRecord) {
      const balanceAfter = (lastRecord.balance_after as number) ?? null;
      await supabase.from('bank_accounts').update({
        current_balance: balanceAfter,
        last_update: new Date().toISOString(),
      }).eq('id', bankAccountId);
    } else {
      // Calculate balance from movements sum if no balance_after column
      const { data: bankData } = await supabase.from('bank_accounts').select('current_balance').eq('id', bankAccountId).single();
      const movementSum = records.reduce((sum, r) => sum + ((r.amount as number) ?? 0), 0);
      const newBalance = (bankData?.current_balance || 0) + movementSum;
      await supabase.from('bank_accounts').update({
        current_balance: newBalance,
        last_update: new Date().toISOString(),
      }).eq('id', bankAccountId);
    }
  }

  // Warning se il file dichiarava N movimenti ma ne abbiamo importati meno.
  // Succede quando la banca esporta un elenco troncato ("elenco non completo")
  // o quando ci sono formattazioni anomale che il parser non riconosce.
  const warnings: Record<string, unknown>[] = [];
  if (declaredCount && inserted > 0 && inserted < declaredCount * 0.98) {
    warnings.push({
      level: 'warning',
      message: `Attenzione: il file dichiara ${declaredCount} movimenti ma ne sono stati importati solo ${inserted} (${Math.round(inserted / declaredCount * 100)}%). Verifica il file.`,
      declaredCount,
      importedCount: inserted,
    });
  }

  return {
    imported: inserted,
    errors: [...parseErrors.map(e => ({ message: e })), ...transformErrors, ...insertErrors],
    warnings,
    details: { headers, mapping, totalParsed: rows.length, declaredCount },
  };
}

// ─── INVOICE XML PROCESSOR ──────────────────────────────────────

async function processInvoiceXML(text: string | ArrayBuffer, context: ImportContext, batchId: string, onProgress: (percent: number, message: string) => void): Promise<ProcessorResult> {
  const xmlText = typeof text === 'string' ? text : new TextDecoder().decode(text);
  const { invoices, supplier, errors: parseErrors } = parseFatturaPA(xmlText);

  if (invoices.length === 0) {
    return { imported: 0, errors: parseErrors.map(e => ({ message: e })) };
  }

  onProgress(40, `Parsate ${invoices.length} fatture, trasformazione...`);

  const { invoiceRecords, supplierRecord, payableRecords } = transformInvoiceToRecords(
    invoices, supplier, { company_id: context.company_id, import_batch_id: batchId, raw_xml: xmlText }
  );

  onProgress(55, 'Verifica/creazione fornitore...');

  // Auto-create or link supplier
  if (supplierRecord && supplierRecord.partita_iva) {
    await upsertSupplier(supplierRecord);
  }

  onProgress(65, `Inserimento ${invoiceRecords.length} fatture...`);

  // Insert invoices
  const { inserted: invInserted, insertErrors: invErrors } = await batchInsert(
    'electronic_invoices', invoiceRecords, onProgress, 65, 80
  );

  onProgress(80, `Creazione ${payableRecords.length} scadenze...`);

  // Insert payables
  const { inserted: payInserted, insertErrors: payErrors } = await batchInsert(
    'payables', payableRecords, onProgress, 80, 95
  );

  return {
    imported: invInserted,
    errors: [...parseErrors.map(e => ({ message: e })), ...invErrors, ...payErrors],
    details: {
      fatture: invInserted,
      scadenze: payInserted,
      fornitore: supplierRecord?.ragione_sociale,
    },
  };
}

// ─── POS CSV PROCESSOR ──────────────────────────────────────────

async function processPOSCSV(text: string | ArrayBuffer, context: ImportContext, batchId: string, mappingOverride: Record<string, string> | null, onProgress: (percent: number, message: string) => void): Promise<ProcessorResult> {
  const csvText = typeof text === 'string' ? text : '';
  const { headers, rows, errors: parseErrors } = parseCSV(csvText, {
    delimiter: context.csvOptions?.delimiter,
    skipRows: context.csvOptions?.skipRows || 0,
    dateFormat: context.csvOptions?.dateFormat || 'DD/MM/YYYY',
  });

  if (rows.length === 0) {
    return { imported: 0, errors: [...parseErrors.map(e => ({ message: e })), { message: 'Nessuna riga dati' }] };
  }

  onProgress(30, `Parsate ${rows.length} righe POS...`);

  // Default POS mapping (can be overridden)
  const mapping = mappingOverride || autoPOSMapping(headers);

  const { records, errors: transformErrors } = transformPOSRows(rows, mapping, {
    company_id: context.company_id,
    outlet_id: context.outlet_id,
    dateFormat: context.dateFormat,
    decimalSep: context.decimalSep,
    thousandSep: context.thousandSep,
    import_batch_id: batchId,
  });

  if (records.length === 0) {
    return { imported: 0, errors: transformErrors };
  }

  onProgress(60, `Inserimento ${records.length} record vendite...`);

  const { inserted, insertErrors } = await batchInsert('daily_revenue', records, onProgress, 60, 95);

  return {
    imported: inserted,
    errors: [...transformErrors, ...insertErrors],
    details: { headers, mapping, totalParsed: rows.length },
  };
}

// ─── BALANCE SHEET PDF PROCESSOR ────────────────────────────────

async function processBalanceSheetPDF(pdfData: string | ArrayBuffer, context: ImportContext & { fiscal_year?: number }, batchId: string, onProgress: (percent: number, message: string) => void): Promise<ProcessorResult> {
  // batchId currently unused but kept for future audit tracking
  void batchId;
  try {
    onProgress(25, 'Parsing PDF bilancio...');

    if (typeof pdfData === 'string') {
      return { imported: 0, errors: [{ message: 'PDF richiede dati binari (ArrayBuffer)' }] };
    }
    const parsed = await parseBilancio(pdfData);

    if (!parsed || (!parsed.patrimoniale.attivita.length && !parsed.contoEconomico.costi.length)) {
      return { imported: 0, errors: [{ message: 'Nessun dato trovato nel PDF bilancio' }] };
    }

    onProgress(50, 'Conversione dati per Supabase...');

    const year = context.fiscal_year || new Date().getFullYear();
    const records = bilancioToRecords(parsed, context.company_id, year);

    if (records.length === 0) {
      return { imported: 0, errors: [{ message: 'Nessun record generato dal parser' }] };
    }

    onProgress(60, `Pulizia dati precedenti anno ${year}...`);

    // Delete existing records for this company/year to allow re-import
    await supabase
      .from('balance_sheet_data')
      .delete()
      .eq('company_id', context.company_id)
      .eq('year', year);

    onProgress(70, `Inserimento ${records.length} voci di bilancio...`);

    const { inserted, insertErrors } = await batchInsert('balance_sheet_data', records, onProgress, 70, 95);

    return {
      imported: inserted,
      errors: insertErrors,
      details: {
        anno: year,
        attivita: parsed.patrimoniale.attivita.length,
        passivita: parsed.patrimoniale.passivita.length,
        costi: parsed.contoEconomico.costi.length,
        ricavi: parsed.contoEconomico.ricavi.length,
        totaleRicavi: parsed.contoEconomico.totals?.ricavi,
        totaleCosti: parsed.contoEconomico.totals?.costi,
        risultato: parsed.contoEconomico.totals?.risultato,
      },
    };
  } catch (err: unknown) {
    return { imported: 0, errors: [{ message: `Errore parsing bilancio: ${(err as Error).message}` }] };
  }
}

// ─── RECEIPTS (CORRISPETTIVI) CSV PROCESSOR ────────────────────

async function processReceiptsCSV(text: string | ArrayBuffer, context: ImportContext, batchId: string, mappingOverride: Record<string, string> | null, onProgress: (percent: number, message: string) => void): Promise<ProcessorResult> {
  const csvText = typeof text === 'string' ? text : '';
  const { headers, rows, errors: parseErrors } = parseCSV(csvText, {
    delimiter: context.csvOptions?.delimiter,
    skipRows: context.csvOptions?.skipRows || 0,
    dateFormat: context.csvOptions?.dateFormat || 'DD/MM/YYYY',
  });

  if (rows.length === 0) {
    return { imported: 0, errors: [...parseErrors.map(e => ({ message: e })), { message: 'Nessuna riga dati' }] };
  }

  onProgress(30, `Parsate ${rows.length} righe corrispettivi...`);

  const mapping = mappingOverride || autoReceiptsMapping(headers);

  onProgress(40, 'Trasformazione dati...');

  const records: Record<string, unknown>[] = [];
  const errors: Record<string, unknown>[] = [];

  rows.forEach((row, idx) => {
    try {
      const date = row[mapping.date];
      const gross = parseItalianNumber(row[mapping.gross] || '0') ?? 0;
      const net = mapping.net ? (parseItalianNumber(row[mapping.net] || '0') ?? 0) : gross;
      const vat = mapping.vat ? (parseItalianNumber(row[mapping.vat] || '0') ?? 0) : (gross - net);
      const txCount = mapping.transactions ? parseInt(row[mapping.transactions] || '0', 10) : 1;

      if (!date || gross === 0) return; // skip empty rows

      records.push({
        company_id: context.company_id,
        outlet_id: context.outlet_id || null,
        import_batch_id: batchId,
        date,
        gross_revenue: gross,
        net_revenue: net,
        vat_amount: Math.round(vat * 100) / 100,
        transactions_count: txCount,
        source: 'corrispettivi_import',
        cash_amount: mapping.cash ? parseItalianNumber(row[mapping.cash] || '0') : null,
        card_amount: mapping.card ? parseItalianNumber(row[mapping.card] || '0') : null,
        avg_ticket: txCount > 0 ? Math.round((gross / txCount) * 100) / 100 : 0,
      });
    } catch (err: unknown) {
      errors.push({ message: `Riga ${idx + 1}: ${(err as Error).message}` });
    }
  });

  if (records.length === 0) {
    return { imported: 0, errors: [...errors, { message: 'Nessun record valido trovato' }] };
  }

  onProgress(60, `Inserimento ${records.length} corrispettivi...`);

  const { inserted, insertErrors } = await batchInsert('daily_revenue', records, onProgress, 60, 95);

  return {
    imported: inserted,
    errors: [...errors, ...insertErrors],
    details: { headers, mapping, totalParsed: rows.length },
  };
}

// ─── PAYROLL CSV/XLSX PROCESSOR ────────────────────────────────

async function processPayrollCSV(content: string | ArrayBuffer, context: ImportContext & { month?: number }, batchId: string, mappingOverride: Record<string, string> | null, onProgress: (percent: number, message: string) => void): Promise<ProcessorResult> {
  // If PDF, we can't parse payroll PDFs yet — need structured CSV
  if (content instanceof ArrayBuffer) {
    return {
      imported: 0,
      errors: [{ message: 'Per i cedolini usa il formato CSV/Excel. Il parsing PDF cedolini sarà disponibile prossimamente.' }],
    };
  }

  const { headers, rows, errors: parseErrors } = parseCSV(content, {
    delimiter: context.csvOptions?.delimiter || ';',
    skipRows: context.csvOptions?.skipRows || 0,
  });

  if (rows.length === 0) {
    return { imported: 0, errors: [...parseErrors.map(e => ({ message: e })), { message: 'Nessuna riga dati' }] };
  }

  onProgress(30, `Parsate ${rows.length} righe cedolini...`);

  const mapping = mappingOverride || autoPayrollMapping(headers);

  onProgress(40, 'Trasformazione dati...');

  type PayrollRow = { company_id: string; import_batch_id: string; cognome: string; nome: string; month: number; year: number; retribuzione: number; contributi: number; inail: number; tfr: number; altri_costi: number; netto_in_busta: number; totale_costo: number; source: string };
  const records: PayrollRow[] = [];
  const errors: Record<string, unknown>[] = [];
  const month = context.month || new Date().getMonth() + 1;
  const year = context.year || new Date().getFullYear();

  rows.forEach((row, idx) => {
    try {
      const cognome = (row[mapping.cognome] || '').trim();
      const nome = (row[mapping.nome] || '').trim();
      if (!cognome && !nome) return;

      const retribuzione = parseItalianNumber(row[mapping.retribuzione] || '0') ?? 0;
      const contributi = parseItalianNumber(row[mapping.contributi] || '0') ?? 0;
      const inail = parseItalianNumber(row[mapping.inail] || '0') ?? 0;
      const tfr = parseItalianNumber(row[mapping.tfr] || '0') ?? 0;
      const altriCosti = parseItalianNumber(row[mapping.altri_costi] || '0') ?? 0;
      const nettoInBusta = mapping.netto ? (parseItalianNumber(row[mapping.netto] || '0') ?? 0) : 0;

      records.push({
        company_id: context.company_id,
        import_batch_id: batchId,
        cognome,
        nome,
        month,
        year,
        retribuzione,
        contributi,
        inail,
        tfr,
        altri_costi: altriCosti,
        netto_in_busta: nettoInBusta,
        totale_costo: retribuzione + contributi + inail + tfr + altriCosti,
        source: 'import',
      });
    } catch (err: unknown) {
      errors.push({ message: `Riga ${idx + 1}: ${(err as Error).message}` });
    }
  });

  if (records.length === 0) {
    return { imported: 0, errors: [...errors, { message: 'Nessun record valido' }] };
  }

  onProgress(55, 'Collegamento dipendenti...');

  // Match records to existing employees by cognome+nome
  const { data: employees } = await supabase
    .from('employees')
    .select('id, nome, cognome')
    .eq('company_id', context.company_id)
    .or('is_active.is.null,is_active.eq.true');

  // Load outlet allocations for all active employees (for cost splitting)
  const empIds = (employees || []).map(e => e.id);
  type AllocRow = { employee_id: string | null; outlet_id: string | null; allocation_pct: number | null };
  let allocations: AllocRow[] = [];
  if (empIds.length > 0) {
    const { data: allocData } = await supabase
      .from('employee_outlet_allocations')
      .select('employee_id, outlet_id, allocation_pct')
      .in('employee_id', empIds);
    allocations = (allocData || []) as unknown as AllocRow[];
  }

  // Build allocation map: employee_id -> [{ outlet_id, pct }]
  type AllocEntry = { outlet_id: string | null; pct: number };
  const allocMap: Record<string, AllocEntry[]> = {};
  for (const a of allocations) {
    if (!a.employee_id) continue;
    if (!allocMap[a.employee_id]) allocMap[a.employee_id] = [];
    allocMap[a.employee_id].push({ outlet_id: a.outlet_id, pct: a.allocation_pct ?? 100 });
  }

  type CostRecord = { employee_id: string; company_id: string; outlet_id: string | null; year: number; month: number; retribuzione: number; contributi: number; inail: number; tfr: number; altri_costi: number; allocation_pct: number; source: string };
  const costRecords: CostRecord[] = [];
  const unmatchedEmployees: string[] = [];
  const multiOutletDetails: string[] = [];

  for (const rec of records) {
    const emp = (employees || []).find(e =>
      (e.cognome || '').toLowerCase() === rec.cognome.toLowerCase() &&
      (e.nome || '').toLowerCase() === rec.nome.toLowerCase()
    );

    if (emp) {
      const empAllocations = allocMap[emp.id] || [];

      // If context has a forced outlet_id, use it for all records
      if (context.outlet_id) {
        costRecords.push({
          employee_id: emp.id,
          company_id: rec.company_id,
          outlet_id: context.outlet_id,
          year: rec.year,
          month: rec.month,
          retribuzione: rec.retribuzione,
          contributi: rec.contributi,
          inail: rec.inail,
          tfr: rec.tfr,
          altri_costi: rec.altri_costi,
          allocation_pct: 100,
          source: 'import',
        });
      } else if (empAllocations.length <= 1) {
        // Single outlet or no allocation — assign full cost
        costRecords.push({
          employee_id: emp.id,
          company_id: rec.company_id,
          outlet_id: empAllocations.length === 1 ? empAllocations[0].outlet_id : null,
          year: rec.year,
          month: rec.month,
          retribuzione: rec.retribuzione,
          contributi: rec.contributi,
          inail: rec.inail,
          tfr: rec.tfr,
          altri_costi: rec.altri_costi,
          allocation_pct: 100,
          source: 'import',
        });
      } else {
        // Multi-outlet employee — split costs proportionally
        const totalPct = empAllocations.reduce((sum, a) => sum + a.pct, 0) || 100;
        for (const alloc of empAllocations) {
          const ratio = alloc.pct / totalPct;
          costRecords.push({
            employee_id: emp.id,
            company_id: rec.company_id,
            outlet_id: alloc.outlet_id,
            year: rec.year,
            month: rec.month,
            retribuzione: Math.round(rec.retribuzione * ratio * 100) / 100,
            contributi: Math.round(rec.contributi * ratio * 100) / 100,
            inail: Math.round(rec.inail * ratio * 100) / 100,
            tfr: Math.round(rec.tfr * ratio * 100) / 100,
            altri_costi: Math.round(rec.altri_costi * ratio * 100) / 100,
            allocation_pct: alloc.pct,
            source: 'import',
          });
        }
        multiOutletDetails.push(`${rec.cognome} ${rec.nome} → ${empAllocations.length} outlet`);
      }
    } else {
      unmatchedEmployees.push(`${rec.cognome} ${rec.nome}`);
    }
  }

  if (unmatchedEmployees.length > 0) {
    errors.push({
      message: `${unmatchedEmployees.length} dipendenti non trovati: ${unmatchedEmployees.slice(0, 5).join(', ')}${unmatchedEmployees.length > 5 ? '...' : ''}`,
    });
  }

  if (costRecords.length === 0) {
    return { imported: 0, errors: [...errors, { message: 'Nessun dipendente corrisponde ai dati del file' }] };
  }

  onProgress(70, `Inserimento costi per ${costRecords.length} record (${new Set(costRecords.map(r => r.employee_id)).size} dipendenti)...`);

  // Upsert: delete existing for same employee/month/year, then insert
  const uniqueEmployeeIds = [...new Set(costRecords.map(r => r.employee_id))];
  for (const empId of uniqueEmployeeIds) {
    await supabase
      .from('employee_costs')
      .delete()
      .eq('employee_id', empId)
      .eq('year', year)
      .eq('month', month);
  }

  const { inserted, insertErrors } = await batchInsert('employee_costs', costRecords, onProgress, 75, 95);

  return {
    imported: inserted,
    errors: [...errors, ...insertErrors],
    details: {
      headers,
      mapping,
      dipendentiTrovati: uniqueEmployeeIds.length,
      dipendentiNonTrovati: unmatchedEmployees.length,
      dipendentiMultiOutlet: multiOutletDetails.length,
      multiOutletInfo: multiOutletDetails.length > 0 ? multiOutletDetails.slice(0, 5).join(', ') : null,
      mese: `${month}/${year}`,
    },
  };
}

// ─── HELPERS ────────────────────────────────────────────────────

function autoReceiptsMapping(headers: string[]): Record<string, string> {
  const normalized = headers.map(h => h.toLowerCase().trim());
  const mapping: Record<string, string> = {};

  const dateKw = ['data', 'date', 'giorno', 'data_corrispettivo'];
  const grossKw = ['incasso', 'lordo', 'gross', 'totale', 'importo', 'corrispettivo'];
  const netKw = ['netto', 'net', 'imponibile'];
  const vatKw = ['iva', 'imposta', 'vat', 'tax'];
  const txKw = ['scontrini', 'transazioni', 'n_scontrini', 'num'];
  const cashKw = ['contanti', 'cash', 'contante'];
  const cardKw = ['carta', 'card', 'pos', 'bancomat', 'elettronico'];

  headers.forEach((h, i) => {
    const low = normalized[i];
    if (!mapping.date && dateKw.some(k => low.includes(k))) mapping.date = h;
    if (!mapping.gross && grossKw.some(k => low.includes(k)) && !low.includes('net')) mapping.gross = h;
    if (!mapping.net && netKw.some(k => low.includes(k))) mapping.net = h;
    if (!mapping.vat && vatKw.some(k => low.includes(k))) mapping.vat = h;
    if (!mapping.transactions && txKw.some(k => low.includes(k))) mapping.transactions = h;
    if (!mapping.cash && cashKw.some(k => low.includes(k))) mapping.cash = h;
    if (!mapping.card && cardKw.some(k => low.includes(k))) mapping.card = h;
  });

  if (!mapping.date && headers.length >= 2) mapping.date = headers[0];
  if (!mapping.gross && headers.length >= 2) mapping.gross = headers[1];

  return mapping;
}

function autoPayrollMapping(headers: string[]): Record<string, string> {
  const normalized = headers.map(h => h.toLowerCase().trim());
  const mapping: Record<string, string> = {};

  const cognomeKw = ['cognome', 'surname', 'last_name', 'dipendente'];
  const nomeKw = ['nome', 'name', 'first_name'];
  const retribKw = ['retribuzione', 'lordo', 'ral', 'stipendio', 'paga_base'];
  const contribKw = ['contributi', 'inps', 'contributi_datore'];
  const inailKw = ['inail'];
  const tfrKw = ['tfr', 'trattamento'];
  const altriKw = ['altri_costi', 'altri', 'benefits', 'premi'];
  const nettoKw = ['netto', 'netto_in_busta', 'net'];

  headers.forEach((h, i) => {
    const low = normalized[i];
    if (!mapping.cognome && cognomeKw.some(k => low.includes(k))) mapping.cognome = h;
    if (!mapping.nome && nomeKw.some(k => low.includes(k)) && !low.includes('cogno')) mapping.nome = h;
    if (!mapping.retribuzione && retribKw.some(k => low.includes(k))) mapping.retribuzione = h;
    if (!mapping.contributi && contribKw.some(k => low.includes(k))) mapping.contributi = h;
    if (!mapping.inail && inailKw.some(k => low.includes(k))) mapping.inail = h;
    if (!mapping.tfr && tfrKw.some(k => low.includes(k))) mapping.tfr = h;
    if (!mapping.altri_costi && altriKw.some(k => low.includes(k))) mapping.altri_costi = h;
    if (!mapping.netto && nettoKw.some(k => low.includes(k))) mapping.netto = h;
  });

  // Fallback: try first two columns
  if (!mapping.cognome && headers.length >= 2) mapping.cognome = headers[0];
  if (!mapping.nome && headers.length >= 2) mapping.nome = headers[1];

  return mapping;
}

function autoPOSMapping(headers: string[]): Record<string, string> {
  const normalized = headers.map(h => h.toLowerCase().trim());
  const mapping: Record<string, string> = {};

  const dateKeywords = ['data', 'date', 'giorno'];
  const grossKeywords = ['incasso', 'lordo', 'gross', 'totale vendite', 'fatturato'];
  const netKeywords = ['netto', 'net', 'imponibile'];
  const txKeywords = ['scontrini', 'transazioni', 'transactions', 'n. vendite', 'pezzi'];
  const cashKeywords = ['contanti', 'cash', 'contante'];
  const cardKeywords = ['carta', 'card', 'pos', 'bancomat', 'elettronico'];

  headers.forEach((h, i) => {
    const low = normalized[i];
    if (!mapping.date && dateKeywords.some(k => low.includes(k))) mapping.date = h;
    if (!mapping.gross_revenue && grossKeywords.some(k => low.includes(k))) mapping.gross_revenue = h;
    if (!mapping.net_revenue && netKeywords.some(k => low.includes(k))) mapping.net_revenue = h;
    if (!mapping.transactions_count && txKeywords.some(k => low.includes(k))) mapping.transactions_count = h;
    if (!mapping.cash_amount && cashKeywords.some(k => low.includes(k))) mapping.cash_amount = h;
    if (!mapping.card_amount && cardKeywords.some(k => low.includes(k))) mapping.card_amount = h;
  });

  // Fallback: first column = date, second = gross
  if (!mapping.date && headers.length >= 2) mapping.date = headers[0];
  if (!mapping.gross_revenue && headers.length >= 2) mapping.gross_revenue = headers[1];

  return mapping;
}

async function upsertSupplier(supplierRecord: Record<string, unknown>): Promise<string | null> {
  try {
    const piva = supplierRecord.partita_iva;
    if (!piva || typeof piva !== 'string') return null;
    const companyId = supplierRecord.company_id;
    if (!companyId || typeof companyId !== 'string') return null;

    // Check if supplier exists by P.IVA (could be in vat_number OR partita_iva column)
    const { data: existing } = await supabase
      .from('suppliers')
      .select('id, iban')
      .eq('company_id', companyId)
      .or(`partita_iva.eq.${piva},vat_number.eq.${piva}`)
      .maybeSingle();

    if (existing) {
      // Update IBAN if we have one from XML and supplier doesn't have it yet
      const iban = supplierRecord.iban;
      if (iban && typeof iban === 'string' && !existing.iban) {
        await supabase.from('suppliers')
          .update({ iban })
          .eq('id', existing.id);
      }
      return existing.id;
    }

    // Create new supplier — cast bypasses strict shape (record has extra
    // legacy fields per schema flessibile)
    const sb = supabase as unknown as { from: (t: 'suppliers') => { insert: (r: Record<string, unknown>) => { select: (s: string) => { single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }> } } } };
    const { data: created, error } = await sb
      .from('suppliers')
      .insert(supplierRecord)
      .select('id')
      .single();

    if (error || !created) {
      if (error) console.warn('Supplier upsert warning:', error.message);
      return null;
    }
    return created.id;
  } catch (err: unknown) {
    console.warn('Supplier upsert error:', (err as Error).message);
    return null;
  }
}

/**
 * Inserisce record in batch di BATCH_SIZE
 */
async function batchInsert(tableName: string, records: Record<string, unknown>[], onProgress: (percent: number, message: string) => void, progressStart: number, progressEnd: number): Promise<{ inserted: number; insertErrors: Record<string, unknown>[] }> {
  let inserted = 0;
  const insertErrors: Record<string, unknown>[] = [];
  const totalBatches = Math.ceil(records.length / BATCH_SIZE);

  // Cast tableName/batch fuori dal sistema di tipi typed Supabase: tableName è dinamico
  const sb = supabase as unknown as { from: (t: string) => { insert: (b: Record<string, unknown>[]) => { select: (s: string) => Promise<{ data: { id: string }[] | null; error: { message: string; details?: string } | null }> } } };

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    const progress = progressStart + ((batchNum / totalBatches) * (progressEnd - progressStart));
    onProgress(Math.round(progress), `Batch ${batchNum}/${totalBatches}...`);

    const { data, error } = await sb
      .from(tableName)
      .insert(batch)
      .select('id');

    if (error) {
      insertErrors.push({
        message: `Batch ${batchNum}: ${error.message}`,
        details: error.details,
        batch: batchNum,
      });
    } else {
      inserted += (data?.length || batch.length);
    }
  }

  return { inserted, insertErrors };
}

// ─── PREVIEW MODE ───────────────────────────────────────────────

/**
 * Modalità anteprima: parsa il file e ritorna i primi N record senza inserire
 * Utile per mostrare all'utente cosa verrà importato e per configurare il mapping
 */
export async function previewImport({ file, sourceType, context, maxRows = 10 }: { file?: File | null; sourceType: string; context: { csvOptions?: CsvOptions }; maxRows?: number }): Promise<Record<string, unknown>> {
  try {
    const fileName = file?.name || '';
    const isPDF = fileName.toLowerCase().endsWith('.pdf');

    // CSV/Excel-based sources
    const ext = fileName.toLowerCase().split('.').pop();
    const isExcel = ext === 'xls' || ext === 'xlsx' || ext === 'xlsm';

    if (['bank', 'pos_data', 'receipts', 'payroll'].includes(sourceType) && !isPDF) {
      let headers: string[] = [];
      let rows: Record<string, string>[] = [];

      if (isExcel) {
        const arrayBuf = await readFileContent(file, null, null, { asBinary: true });
        const result = excelToHeadersRows(arrayBuf);
        headers = result.headers;
        rows = result.rows;
      } else {
        const text = await readFileContent(file, null, null);
        const csvText = typeof text === 'string' ? text : '';
        const csvResult = parseCSV(csvText, {
          skipRows: context.csvOptions?.skipRows || 0,
          delimiter: sourceType === 'payroll' ? ';' : undefined,
        });
        headers = csvResult.headers;
        rows = csvResult.rows;
      }

      let mapping: Record<string, string>, confidence: number;
      if (sourceType === 'bank') {
        const detected = autoDetectBankMapping(headers);
        mapping = detected.mapping;
        confidence = detected.confidence;
      } else if (sourceType === 'receipts') {
        mapping = autoReceiptsMapping(headers);
        confidence = mapping.date && mapping.gross ? 70 : 30;
      } else if (sourceType === 'payroll') {
        mapping = autoPayrollMapping(headers);
        confidence = mapping.cognome && mapping.retribuzione ? 70 : 30;
      } else {
        mapping = autoPOSMapping(headers);
        confidence = Object.keys(mapping).length > 1 ? 70 : 30;
      }

      return {
        success: true,
        headers,
        sampleRows: rows.slice(0, maxRows),
        totalRows: rows.length,
        mapping,
        confidence,
        sourceType,
      };
    }

    // XML invoices
    if (sourceType === 'invoices') {
      const text = await readFileContent(file, null, null);
      const xmlText = typeof text === 'string' ? text : new TextDecoder().decode(text);
      const { invoices, supplier, errors } = parseFatturaPA(xmlText);
      return {
        success: invoices.length > 0,
        invoices: invoices.slice(0, maxRows),
        supplier,
        totalInvoices: invoices.length,
        errors,
        sourceType,
      };
    }

    // PDF balance sheet
    if (sourceType === 'balance_sheet' && isPDF) {
      const pdfData = await readFileContent(file, null, null, { asBinary: true });
      if (typeof pdfData === 'string') {
        return { success: false, sourceType, error: 'PDF richiede dati binari' };
      }
      const parsed = await parseBilancio(pdfData);
      return {
        success: true,
        sourceType,
        summary: {
          attivita: parsed.patrimoniale.attivita.length,
          passivita: parsed.patrimoniale.passivita.length,
          costi: parsed.contoEconomico.costi.length,
          ricavi: parsed.contoEconomico.ricavi.length,
          totaleRicavi: parsed.contoEconomico.totals?.ricavi,
          totaleCosti: parsed.contoEconomico.totals?.costi,
          risultato: parsed.contoEconomico.totals?.risultato,
        },
        sampleCosti: parsed.contoEconomico.costi.filter(r => r.isMacro).slice(0, maxRows),
        sampleRicavi: parsed.contoEconomico.ricavi.filter(r => r.isMacro).slice(0, maxRows),
      };
    }

    return { success: false, errors: [{ message: 'Tipo non supportato per anteprima' }] };
  } catch (err: unknown) {
    return { success: false, errors: [{ message: (err as Error).message }] };
  }
}
