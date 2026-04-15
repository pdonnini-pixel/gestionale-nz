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
export async function processImport({
  file,
  storagePath,
  bucket,
  sourceType,
  context,
  mappingOverride = null,
  onProgress = () => {},
}) {
  const startTime = Date.now();

  try {
    onProgress(5, 'Lettura file...');

    // 1. Read file content
    const text = await readFileContent(file, storagePath, bucket);
    if (!text || text.trim().length === 0) {
      return { success: false, imported: 0, errors: [{ message: 'File vuoto o non leggibile' }], batchId: null };
    }

    onProgress(15, 'Creazione batch di import...');

    // 2. Create import_batch record
    const batchId = await createImportBatch(context.company_id, sourceType, file?.name || storagePath);

    onProgress(20, 'Parsing in corso...');

    // 3. Route to appropriate processor
    let result;
    switch (sourceType) {
      case 'bank':
        result = await processBankCSV(text, context, batchId, mappingOverride, onProgress);
        break;
      case 'invoices':
        result = await processInvoiceXML(text, context, batchId, onProgress);
        break;
      case 'pos_data':
        result = await processPOSCSV(text, context, batchId, mappingOverride, onProgress);
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
  } catch (err) {
    console.error('Import engine error:', err);
    return {
      success: false,
      imported: 0,
      errors: [{ message: `Errore imprevisto: ${err.message}` }],
      batchId: null,
    };
  }
}

// ─── FILE READING ───────────────────────────────────────────────

async function readFileContent(file, storagePath, bucket) {
  if (file) {
    // Direct File object from upload
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Errore lettura file'));
      reader.readAsText(file, 'UTF-8');
    });
  }

  if (storagePath && bucket) {
    // Download from Supabase Storage
    const { data, error } = await supabase.storage.from(bucket).download(storagePath);
    if (error) throw new Error(`Errore download: ${error.message}`);
    return await data.text();
  }

  throw new Error('Nessun file o path fornito');
}

// ─── BATCH MANAGEMENT ───────────────────────────────────────────

async function createImportBatch(companyId, sourceType, fileName) {
  const sourceMap = {
    bank: 'csv_banca',
    invoices: 'xml_sdi',
    pos_data: 'csv_pos',
    receipts: 'csv_ade',
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

async function updateImportBatch(batchId, updates) {
  const { error } = await supabase
    .from('import_batches')
    .update(updates)
    .eq('id', batchId);

  if (error) console.error('Error updating batch:', error);
}

// ─── BANK CSV PROCESSOR ─────────────────────────────────────────

async function processBankCSV(text, context, batchId, mappingOverride, onProgress) {
  // Parse CSV
  const { headers, rows, errors: parseErrors } = parseCSV(text, {
    delimiter: context.csvOptions?.delimiter,
    skipRows: context.csvOptions?.skipRows || 0,
    dateFormat: context.csvOptions?.dateFormat || 'DD/MM/YYYY',
  });

  if (rows.length === 0) {
    return { imported: 0, errors: [...parseErrors.map(e => ({ message: e })), { message: 'Nessuna riga dati trovata' }] };
  }

  onProgress(30, `Parsate ${rows.length} righe, mapping colonne...`);

  // Determine column mapping
  let mapping;
  if (mappingOverride) {
    mapping = mappingOverride;
  } else {
    const detected = autoDetectBankMapping(headers);
    mapping = detected.mapping;
    if (detected.confidence < 50) {
      return {
        imported: 0,
        errors: [{ message: `Mapping colonne incerto (${detected.confidence}%). Configurare manualmente.` }],
        details: { headers, detectedMapping: detected },
      };
    }
  }

  onProgress(40, 'Trasformazione dati...');

  // Transform rows
  const { records, errors: transformErrors } = transformBankRows(rows, mapping, {
    ...context,
    import_batch_id: batchId,
  });

  if (records.length === 0) {
    return { imported: 0, errors: transformErrors };
  }

  onProgress(60, `Inserimento ${records.length} movimenti bancari...`);

  // Insert in batches
  const { inserted, insertErrors } = await batchInsert('cash_movements', records, onProgress, 60, 95);

  return {
    imported: inserted,
    errors: [...transformErrors, ...insertErrors],
    details: { headers, mapping, totalParsed: rows.length },
  };
}

// ─── INVOICE XML PROCESSOR ──────────────────────────────────────

async function processInvoiceXML(text, context, batchId, onProgress) {
  const { invoices, supplier, errors: parseErrors } = parseFatturaPA(text);

  if (invoices.length === 0) {
    return { imported: 0, errors: parseErrors.map(e => ({ message: e })) };
  }

  onProgress(40, `Parsate ${invoices.length} fatture, trasformazione...`);

  const { invoiceRecords, supplierRecord, payableRecords } = transformInvoiceToRecords(
    invoices, supplier, { ...context, import_batch_id: batchId }
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

async function processPOSCSV(text, context, batchId, mappingOverride, onProgress) {
  const { headers, rows, errors: parseErrors } = parseCSV(text, {
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
    ...context,
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

// ─── HELPERS ────────────────────────────────────────────────────

function autoPOSMapping(headers) {
  const normalized = headers.map(h => h.toLowerCase().trim());
  const mapping = {};

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

async function upsertSupplier(supplierRecord) {
  try {
    const piva = supplierRecord.partita_iva;
    if (!piva) return null;

    // Check if supplier exists by P.IVA (could be in vat_number OR partita_iva column)
    const { data: existing } = await supabase
      .from('suppliers')
      .select('id, iban')
      .eq('company_id', supplierRecord.company_id)
      .or(`partita_iva.eq.${piva},vat_number.eq.${piva}`)
      .maybeSingle();

    if (existing) {
      // Update IBAN if we have one from XML and supplier doesn't have it yet
      if (supplierRecord.iban && !existing.iban) {
        await supabase.from('suppliers')
          .update({ iban: supplierRecord.iban })
          .eq('id', existing.id);
      }
      return existing.id;
    }

    // Create new supplier
    const { data: created, error } = await supabase
      .from('suppliers')
      .insert(supplierRecord)
      .select('id')
      .single();

    if (error) {
      console.warn('Supplier upsert warning:', error.message);
      return null;
    }
    return created.id;
  } catch (err) {
    console.warn('Supplier upsert error:', err.message);
    return null;
  }
}

/**
 * Inserisce record in batch di BATCH_SIZE
 */
async function batchInsert(tableName, records, onProgress, progressStart, progressEnd) {
  let inserted = 0;
  const insertErrors = [];
  const totalBatches = Math.ceil(records.length / BATCH_SIZE);

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    const progress = progressStart + ((batchNum / totalBatches) * (progressEnd - progressStart));
    onProgress(Math.round(progress), `Batch ${batchNum}/${totalBatches}...`);

    const { data, error } = await supabase
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
export async function previewImport({ file, sourceType, context, maxRows = 10 }) {
  try {
    const text = await readFileContent(file, null, null);

    if (sourceType === 'bank' || sourceType === 'pos_data') {
      const { headers, rows } = parseCSV(text, {
        skipRows: context.csvOptions?.skipRows || 0,
      });

      let mapping, confidence;
      if (sourceType === 'bank') {
        const detected = autoDetectBankMapping(headers);
        mapping = detected.mapping;
        confidence = detected.confidence;
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

    if (sourceType === 'invoices') {
      const { invoices, supplier, errors } = parseFatturaPA(text);
      return {
        success: invoices.length > 0,
        invoices: invoices.slice(0, maxRows),
        supplier,
        totalInvoices: invoices.length,
        errors,
        sourceType,
      };
    }

    return { success: false, errors: [{ message: 'Tipo non supportato per anteprima' }] };
  } catch (err) {
    return { success: false, errors: [{ message: err.message }] };
  }
}
