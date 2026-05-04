/**
 * CSV Parser — zero dipendenze, supporto formato italiano
 * Gestisce: separatori ; e , | decimali con virgola | encoding UTF-8/Latin-1
 * Utilizzato da Import Hub per estratti conto bancari, POS data, corrispettivi
 */

/**
 * Parsa una stringa CSV e ritorna un array di oggetti
 * @param {string} text - contenuto CSV raw
 * @param {Object} options
 * @param {string} options.delimiter - separatore colonne (auto-detect se omesso)
 * @param {string} options.decimalSeparator - ',' per italiano, '.' per inglese
 * @param {string} options.thousandSeparator - '.' per italiano, ',' per inglese
 * @param {number} options.skipRows - righe da saltare all'inizio (header bancari)
 * @param {string} options.dateFormat - 'DD/MM/YYYY' | 'YYYY-MM-DD' | 'DD-MM-YYYY'
 * @param {boolean} options.hasHeader - prima riga è header (default true)
 * @returns {{ headers: string[], rows: Object[], rawRows: string[][], errors: string[] }}
 */
export function parseCSV(text: string, options: { delimiter?: string; decimalSeparator?: string; thousandSeparator?: string; skipRows?: number; dateFormat?: string; hasHeader?: boolean } = {}): { headers: string[]; rows: Record<string, string>[]; rawRows: string[][]; errors: string[] } {
  const {
    delimiter: forcedDelimiter,
    decimalSeparator = ',',
    thousandSeparator = '.',
    skipRows = 0,
    dateFormat = 'DD/MM/YYYY',
    hasHeader = true,
  } = options;

  const errors: string[] = [];

  // Normalize line endings
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Split into lines (respecting quoted fields)
  const lines = splitCSVLines(normalized);

  // Skip header rows (bank statements often have metadata rows)
  const dataLines = lines.slice(skipRows).filter(l => l.trim().length > 0);

  if (dataLines.length === 0) {
    return { headers: [], rows: [], rawRows: [], errors: ['File CSV vuoto o senza dati'] };
  }

  // Auto-detect delimiter if not specified
  const delimiter = forcedDelimiter || detectDelimiter(dataLines[0]);

  // Parse all lines into arrays
  const rawRows = dataLines.map(line => parseCSVLine(line, delimiter));

  // Extract headers
  let headers: string[] = [];
  let dataStartIdx = 0;

  if (hasHeader) {
    headers = rawRows[0].map(h => h.trim());
    dataStartIdx = 1;
  } else {
    headers = rawRows[0].map((_, i) => `col_${i + 1}`);
  }

  // Parse data rows into objects
  const rows: Record<string, string>[] = [];
  for (let i = dataStartIdx; i < rawRows.length; i++) {
    const cells = rawRows[i];
    if (cells.length === 0 || (cells.length === 1 && cells[0].trim() === '')) continue;

    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const raw = (cells[j] || '').trim();
      obj[headers[j]] = raw;
    }
    rows.push(obj);
  }

  return { headers, rows, rawRows: rawRows.slice(dataStartIdx), errors };
}

/**
 * Auto-rileva il delimiter analizzando la prima riga
 */
function detectDelimiter(line: string): string {
  const candidates = [';', ',', '\t', '|'];
  let best = ';';
  let bestCount = 0;

  for (const d of candidates) {
    // Count occurrences outside quoted strings
    let count = 0;
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === d && !inQuotes) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/**
 * Splitta il testo in righe rispettando i campi tra virgolette
 */
function splitCSVLines(text: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === '\n' && !inQuotes) {
      lines.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) lines.push(current);
  return lines;
}

/**
 * Parsa una singola riga CSV in array di celle
 */
function parseCSVLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

// ─── CONVERSIONE VALORI ─────────────────────────────────────────

/**
 * Converte stringa in numero con formato italiano
 * "1.234,56" → 1234.56 | "-€ 1.234,56" → -1234.56
 */
export function parseItalianNumber(str: string | null | undefined, decimalSep = ',', thousandSep = '.'): number | null {
  if (!str || typeof str !== 'string') return null;
  // Rimuovi simboli valuta e spazi
  let cleaned = str.replace(/[€$£\s]/g, '').trim();
  if (cleaned === '' || cleaned === '-') return null;

  // Gestisci segno negativo in vari formati
  const isNegative = cleaned.startsWith('-') || cleaned.startsWith('(') || cleaned.endsWith('-');
  cleaned = cleaned.replace(/[()-]/g, '').trim();

  // Rimuovi separatore migliaia, sostituisci decimale
  if (thousandSep) cleaned = cleaned.split(thousandSep).join('');
  if (decimalSep && decimalSep !== '.') cleaned = cleaned.replace(decimalSep, '.');

  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return isNegative ? -num : num;
}

/**
 * Parsa una data da stringa in vari formati italiani → 'YYYY-MM-DD'
 */
export function parseDate(str: string | null | undefined, format = 'DD/MM/YYYY'): string | null {
  if (!str || typeof str !== 'string') return null;
  const cleaned = str.trim();

  let day: number | undefined, month: number | undefined, year: number | undefined;

  // Try ISO format first (YYYY-MM-DD) — SheetJS sometimes outputs this
  const isoMatch = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    [, year, month, day] = isoMatch.map(Number);
  }
  // Try explicit format
  else if (format === 'DD/MM/YYYY' || format === 'DD-MM-YYYY') {
    const sep = format.includes('/') ? '/' : '-';
    const parts = cleaned.split(sep);
    if (parts.length !== 3) return null;
    [day, month, year] = parts.map(p => parseInt(p, 10));
  } else if (format === 'YYYY-MM-DD') {
    const parts = cleaned.split('-');
    if (parts.length !== 3) return null;
    [year, month, day] = parts.map(p => parseInt(p, 10));
  } else if (format === 'DD.MM.YYYY') {
    const parts = cleaned.split('.');
    if (parts.length !== 3) return null;
    [day, month, year] = parts.map(p => parseInt(p, 10));
  } else if (format === 'M/D/YY' || format === 'M/D/YYYY') {
    const parts = cleaned.split('/');
    if (parts.length !== 3) return null;
    [month, day, year] = parts.map(p => parseInt(p, 10));
  } else {
    return null;
  }

  // Handle 2-digit years
  if (year < 100) year += 2000;

  // Validate — if day > 12 and month <= 12, it's fine.
  // But if parsing as DD/MM produced month > 12 (e.g. "3/31/26" parsed as day=3,month=31),
  // try swapping to M/D/YY interpretation
  if (month > 12 && day <= 12) {
    [day, month] = [month, day];
  }

  if (!day || !month || !year || month < 1 || month > 12 || day < 1 || day > 31) return null;

  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

// ─── MAPPING PRESETS ────────────────────────────────────────────

/**
 * Preset di mapping per le banche italiane più comuni
 * Mappa i nomi colonne del CSV → campi cash_movements
 */
interface BankPreset {
  name: string
  mapping: Record<string, string[]>
  skipRows: number
  delimiter: string | null
  dateFormat: string
  dualAmount?: boolean
}

export const BANK_CSV_PRESETS: Record<string, BankPreset> = {
  intesa_sanpaolo: {
    name: 'Intesa Sanpaolo',
    mapping: {
      date: ['Data Operazione', 'Data operazione', 'Data'],
      value_date: ['Data Valuta', 'Data valuta'],
      description: ['Descrizione', 'Causale'],
      amount: ['Importo', 'Importo EUR'],
      balance_after: ['Saldo', 'Saldo contabile'],
      counterpart: ['Ordinante/Beneficiario', 'Beneficiario'],
    },
    skipRows: 0,
    delimiter: ';',
    dateFormat: 'DD/MM/YYYY',
  },
  unicredit: {
    name: 'UniCredit',
    mapping: {
      date: ['Data registrazione', 'Data'],
      value_date: ['Data valuta'],
      description: ['Descrizione operazione', 'Descrizione'],
      amount: ['Importo'],
      balance_after: ['Saldo'],
      counterpart: ['Causale cliente'],
    },
    skipRows: 0,
    delimiter: ';',
    dateFormat: 'DD/MM/YYYY',
  },
  bnl: {
    name: 'BNL / BNP Paribas',
    mapping: {
      date: ['DATA CONTABILE', 'Data'],
      value_date: ['DATA VALUTA', 'Data Valuta'],
      description: ['DESCRIZIONE', 'Descrizione'],
      amount: ['IMPORTO', 'Importo'],
      balance_after: ['SALDO'],
      counterpart: ['BENEFICIARIO'],
    },
    skipRows: 0,
    delimiter: ';',
    dateFormat: 'DD/MM/YYYY',
  },
  mps: {
    name: 'Monte dei Paschi di Siena',
    mapping: {
      date: ['Data'],
      value_date: ['Valuta'],
      dare: ['Dare'],      // colonna uscite (valori negativi)
      avere: ['Avere'],     // colonna entrate (valori positivi)
      description: ['Descrizione operazioni', 'Descrizione'],
      counterpart: ['Causale'],
    },
    dualAmount: true, // flag: usa dare/avere separati anziché singolo importo
    skipRows: 0,
    delimiter: ';',
    dateFormat: 'DD/MM/YYYY',
  },
  generic: {
    name: 'Generico',
    mapping: {
      date: ['Data', 'Date', 'data'],
      value_date: ['Data Valuta', 'Value Date', 'data_valuta'],
      description: ['Descrizione', 'Description', 'Causale', 'descrizione'],
      amount: ['Importo', 'Amount', 'importo'],
      dare: ['Dare', 'Addebiti', 'Uscite'],
      avere: ['Avere', 'Accrediti', 'Entrate'],
      balance_after: ['Saldo', 'Balance', 'saldo'],
      counterpart: ['Controparte', 'Beneficiario', 'controparte'],
    },
    skipRows: 0,
    delimiter: null, // auto-detect
    dateFormat: 'DD/MM/YYYY',
  },
};

/**
 * Tenta di auto-mappare le colonne CSV ai campi target
 * usando i preset delle banche
 * @param {string[]} csvHeaders - headers del CSV caricato
 * @returns {{ presetName: string, mapping: Object, confidence: number }}
 */
export function autoDetectBankMapping(csvHeaders: string[]): { presetName: string; presetLabel: string; mapping: Record<string, string>; confidence: number; unmapped: string[] } {
  const normalizedHeaders = csvHeaders.map(h => h.trim().toLowerCase());
  let bestPreset = 'generic';
  let bestScore = 0;
  let bestMapping: Record<string, string> = {};

  for (const [presetId, preset] of Object.entries(BANK_CSV_PRESETS)) {
    let score = 0;
    const mapping: Record<string, string> = {};

    for (const [targetField, possibleNames] of Object.entries(preset.mapping)) {
      for (const name of possibleNames) {
        const idx = normalizedHeaders.indexOf(name.toLowerCase());
        if (idx !== -1) {
          mapping[targetField] = csvHeaders[idx]; // use original case
          score++;
          break;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestPreset = presetId;
      bestMapping = mapping;
    }
  }

  const totalFields = Object.keys(BANK_CSV_PRESETS[bestPreset].mapping).length;
  const confidence = Math.round((bestScore / totalFields) * 100);

  return {
    presetName: bestPreset,
    presetLabel: BANK_CSV_PRESETS[bestPreset].name,
    mapping: bestMapping,
    confidence,
    unmapped: Object.keys(BANK_CSV_PRESETS[bestPreset].mapping)
      .filter(k => !bestMapping[k]),
  };
}

// ─── TRANSFORM TO DB RECORDS ────────────────────────────────────

/**
 * Trasforma righe CSV parsate in record per cash_movements
 * @param {Object[]} rows - righe dal parser CSV
 * @param {Object} columnMapping - { date: 'Data Operazione', amount: 'Importo', ... }
 * @param {Object} context - { company_id, bank_account_id, import_batch_id, dateFormat, decimalSep, thousandSep }
 * @returns {{ records: Object[], errors: { row: number, message: string }[] }}
 */
interface TransformBankContext {
  company_id: string
  bank_account_id?: string | null
  import_batch_id?: string | null
  dateFormat?: string
  decimalSep?: string
  thousandSep?: string
}

export function transformBankRows(rows: Record<string, string>[], columnMapping: Record<string, string>, context: TransformBankContext): { records: Record<string, unknown>[]; errors: { row: number; message: string }[] } {
  const {
    company_id,
    bank_account_id,
    import_batch_id,
    dateFormat = 'DD/MM/YYYY',
    decimalSep = ',',
    thousandSep = '.',
  } = context;

  const records: Record<string, unknown>[] = [];
  const errors: { row: number; message: string }[] = [];

  // Detect dual-column (Dare/Avere) mode
  const hasDualAmount = !!(columnMapping.dare || columnMapping.avere);
  const hasSingleAmount = !!columnMapping.amount;

  rows.forEach((row, idx) => {
    try {
      const dateStr = row[columnMapping.date];
      const date = parseDate(dateStr, dateFormat);
      if (!date) {
        // Skip summary/empty rows at end of file (e.g. "RIEPILOGO", "Totali Pagina")
        if (!dateStr || dateStr.trim() === '' || /riepilogo|totali|saldo/i.test(dateStr)) return;
        errors.push({ row: idx + 1, message: `Data non valida: "${dateStr}"` });
        return;
      }

      let amount: number | null = null;

      if (hasDualAmount) {
        // Dare/Avere mode (e.g. MPS): Dare = uscite (negative), Avere = entrate (positive)
        const dareStr = columnMapping.dare ? (row[columnMapping.dare] || '').toString().trim() : '';
        const avereStr = columnMapping.avere ? (row[columnMapping.avere] || '').toString().trim() : '';

        if (dareStr && dareStr !== '' && dareStr !== '0') {
          const dareVal = parseItalianNumber(dareStr.replace(/^-/, ''), decimalSep, thousandSep);
          if (dareVal !== null && dareVal !== 0) {
            amount = -Math.abs(dareVal); // Dare is always negative (uscita)
          }
        }
        if (amount === null && avereStr && avereStr !== '' && avereStr !== '0') {
          const avereVal = parseItalianNumber(avereStr, decimalSep, thousandSep);
          if (avereVal !== null && avereVal !== 0) {
            amount = Math.abs(avereVal); // Avere is always positive (entrata)
          }
        }

        if (amount === null || amount === 0) {
          // Skip rows with no dare and no avere (empty/separator rows)
          return;
        }
      } else if (hasSingleAmount) {
        const amountStr = row[columnMapping.amount];
        amount = parseItalianNumber(amountStr, decimalSep, thousandSep);
        if (amount === null) {
          errors.push({ row: idx + 1, message: `Importo non valido: "${amountStr}"` });
          return;
        }
      } else {
        errors.push({ row: idx + 1, message: 'Nessuna colonna importo trovata (amount o dare/avere)' });
        return;
      }

      const record: Record<string, unknown> = {
        company_id,
        bank_account_id,
        import_batch_id,
        date,
        amount,
        type: amount >= 0 ? 'entrata' : 'uscita',
        source: 'csv_banca',
        is_reconciled: false,
      };

      // Optional fields
      if (columnMapping.value_date) {
        const vd = parseDate(row[columnMapping.value_date], dateFormat);
        if (vd) record.value_date = vd;
      }
      if (columnMapping.description) {
        record.description = (row[columnMapping.description] || '').trim();
      }
      if (columnMapping.counterpart) {
        record.counterpart = (row[columnMapping.counterpart] || '').trim();
      }
      if (columnMapping.balance_after) {
        const bal = parseItalianNumber(row[columnMapping.balance_after], decimalSep, thousandSep);
        if (bal !== null) record.balance_after = bal;
      }

      records.push(record);
    } catch (err: unknown) {
      errors.push({ row: idx + 1, message: (err as Error).message });
    }
  });

  return { records, errors };
}

/**
 * Trasforma righe CSV POS in record per daily_revenue
 */
interface TransformPOSContext {
  company_id: string
  outlet_id?: string | null
  import_batch_id?: string | null
  dateFormat?: string
  decimalSep?: string
  thousandSep?: string
}

export function transformPOSRows(rows: Record<string, string>[], columnMapping: Record<string, string>, context: TransformPOSContext): { records: Record<string, unknown>[]; errors: { row: number; message: string }[] } {
  const { company_id, outlet_id, import_batch_id, dateFormat = 'DD/MM/YYYY', decimalSep = ',', thousandSep = '.' } = context;
  const records: Record<string, unknown>[] = [];
  const errors: { row: number; message: string }[] = [];

  rows.forEach((row, idx) => {
    try {
      const date = parseDate(row[columnMapping.date], dateFormat);
      if (!date) { errors.push({ row: idx + 1, message: `Data non valida` }); return; }

      const gross = parseItalianNumber(row[columnMapping.gross_revenue], decimalSep, thousandSep);
      if (gross === null) { errors.push({ row: idx + 1, message: `Incasso lordo non valido` }); return; }

      const record: Record<string, unknown> = {
        company_id, outlet_id, import_batch_id, date,
        gross_revenue: gross,
        source: 'csv_pos',
      };

      if (columnMapping.net_revenue) {
        const net = parseItalianNumber(row[columnMapping.net_revenue], decimalSep, thousandSep);
        if (net !== null) record.net_revenue = net;
      }
      if (columnMapping.transactions_count) {
        const tc = parseInt(row[columnMapping.transactions_count], 10);
        if (!isNaN(tc)) record.transactions_count = tc;
      }
      if (columnMapping.cash_amount) {
        const ca = parseItalianNumber(row[columnMapping.cash_amount], decimalSep, thousandSep);
        if (ca !== null) record.cash_amount = ca;
      }
      if (columnMapping.card_amount) {
        const cd = parseItalianNumber(row[columnMapping.card_amount], decimalSep, thousandSep);
        if (cd !== null) record.card_amount = cd;
      }

      // Auto-compute avg_ticket
      const grossRev = record.gross_revenue as number | undefined;
      const txCount = record.transactions_count as number | undefined;
      if (grossRev && txCount) {
        record.avg_ticket = Math.round((grossRev / txCount) * 100) / 100;
      }

      records.push(record);
    } catch (err: unknown) {
      errors.push({ row: idx + 1, message: (err as Error).message });
    }
  });

  return { records, errors };
}
