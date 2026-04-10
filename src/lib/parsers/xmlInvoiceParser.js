/**
 * Parser XML FatturaPA (SDI) — usa DOMParser nativo del browser
 * Supporta formato FatturaPA 1.2 (tracciato XML fatturazione elettronica italiana)
 * Estrae: cedente/prestatore, dati fattura, righe dettaglio, totali IVA
 */

/**
 * Parsa un file XML FatturaPA e ritorna i dati strutturati
 * @param {string} xmlText - contenuto XML raw
 * @returns {{ invoices: Object[], supplier: Object, errors: string[] }}
 */
export function parseFatturaPA(xmlText) {
  const errors = [];

  // Parse XML
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');

  // Check for parse errors
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    return { invoices: [], supplier: null, errors: ['XML non valido: ' + parseError.textContent.substring(0, 200)] };
  }

  // FatturaPA can have namespace prefixes — handle both prefixed and unprefixed
  const root = doc.documentElement;

  try {
    // ─── CEDENTE / PRESTATORE (Supplier) ─────────────────────
    const supplier = extractSupplier(root);

    // ─── BODY (can be multiple for lotto fatture) ────────────
    const bodies = findElements(root, 'FatturaElettronicaBody');
    if (bodies.length === 0) {
      errors.push('Nessun body fattura trovato nel file XML');
      return { invoices: [], supplier, errors };
    }

    const invoices = [];
    for (const body of bodies) {
      try {
        const invoice = extractInvoice(body, supplier);
        invoices.push(invoice);
      } catch (err) {
        errors.push(`Errore parsing body fattura: ${err.message}`);
      }
    }

    return { invoices, supplier, errors };
  } catch (err) {
    errors.push(`Errore generico: ${err.message}`);
    return { invoices: [], supplier: null, errors };
  }
}

// ─── HELPER: trova elementi ignorando namespace ─────────────────

function findElements(parent, localName) {
  // Try without namespace first
  let elements = parent.getElementsByTagName(localName);
  if (elements.length === 0) {
    // Try with common prefixes
    for (const prefix of ['p', 'ns2', 'ns3']) {
      elements = parent.getElementsByTagName(`${prefix}:${localName}`);
      if (elements.length > 0) break;
    }
  }
  // Fallback: search all elements by local name
  if (elements.length === 0) {
    elements = Array.from(parent.querySelectorAll('*')).filter(
      el => el.localName === localName || el.tagName.endsWith(':' + localName)
    );
    return elements;
  }
  return Array.from(elements);
}

function getText(parent, localName) {
  const elements = findElements(parent, localName);
  if (elements.length === 0) return null;
  // Return the text of the first element that's a direct or near descendant
  return elements[0]?.textContent?.trim() || null;
}

function getNestedText(parent, path) {
  let current = parent;
  const parts = path.split('/');
  for (const part of parts.slice(0, -1)) {
    const found = findElements(current, part);
    if (found.length === 0) return null;
    current = found[0];
  }
  return getText(current, parts[parts.length - 1]);
}

// ─── EXTRACT SUPPLIER ───────────────────────────────────────────

function extractSupplier(root) {
  const header = findElements(root, 'FatturaElettronicaHeader')[0];
  if (!header) return null;

  const cp = findElements(header, 'CedentePrestatore')[0];
  if (!cp) return null;

  const denominazione = getText(cp, 'Denominazione');
  const nome = getText(cp, 'Nome');
  const cognome = getText(cp, 'Cognome');
  const ragioneSociale = denominazione || [nome, cognome].filter(Boolean).join(' ');

  return {
    ragione_sociale: ragioneSociale,
    partita_iva: getNestedText(cp, 'DatiAnagrafici/IdFiscaleIVA/IdCodice')
      || getText(cp, 'IdCodice'),
    codice_fiscale: getText(cp, 'CodiceFiscale'),
    paese: getNestedText(cp, 'DatiAnagrafici/IdFiscaleIVA/IdPaese') || 'IT',
    sede: {
      indirizzo: getText(cp, 'Indirizzo'),
      cap: getText(cp, 'CAP'),
      comune: getText(cp, 'Comune'),
      provincia: getText(cp, 'Provincia'),
      nazione: getText(cp, 'Nazione') || 'IT',
    },
    regime_fiscale: getText(cp, 'RegimeFiscale'),
  };
}

// ─── EXTRACT SINGLE INVOICE ─────────────────────────────────────

function extractInvoice(body, supplier) {
  // DatiGenerali → DatiGeneraliDocumento
  const datiGen = findElements(body, 'DatiGeneraliDocumento')[0];

  const tipoDoc = getText(datiGen, 'TipoDocumento'); // TD01=fattura, TD04=nota credito, etc.
  const numero = getText(datiGen, 'Numero');
  const data = getText(datiGen, 'Data'); // YYYY-MM-DD
  const divisa = getText(datiGen, 'Divisa') || 'EUR';
  const importoTotale = parseFloat(getText(datiGen, 'ImportoTotaleDocumento') || '0');
  const causale = getText(datiGen, 'Causale');

  // Ritenuta d'acconto
  const ritenuta = findElements(datiGen, 'DatiRitenuta')[0];
  let ritenutaAcconto = null;
  if (ritenuta) {
    ritenutaAcconto = {
      tipo: getText(ritenuta, 'TipoRitenuta'),
      importo: parseFloat(getText(ritenuta, 'ImportoRitenuta') || '0'),
      aliquota: parseFloat(getText(ritenuta, 'AliquotaRitenuta') || '0'),
      causale_pagamento: getText(ritenuta, 'CausalePagamento'),
    };
  }

  // DatiBeniServizi → DettaglioLinee
  const linee = findElements(body, 'DettaglioLinee');
  const lineItems = linee.map(linea => ({
    numero_linea: parseInt(getText(linea, 'NumeroLinea') || '0', 10),
    descrizione: getText(linea, 'Descrizione'),
    quantita: parseFloat(getText(linea, 'Quantita') || '1'),
    unita_misura: getText(linea, 'UnitaMisura'),
    prezzo_unitario: parseFloat(getText(linea, 'PrezzoUnitario') || '0'),
    prezzo_totale: parseFloat(getText(linea, 'PrezzoTotale') || '0'),
    aliquota_iva: parseFloat(getText(linea, 'AliquotaIVA') || '0'),
  }));

  // DatiRiepilogo (IVA summary)
  const riepiloghi = findElements(body, 'DatiRiepilogo');
  const vatSummary = riepiloghi.map(r => ({
    aliquota: parseFloat(getText(r, 'AliquotaIVA') || '0'),
    imponibile: parseFloat(getText(r, 'ImponibileImporto') || '0'),
    imposta: parseFloat(getText(r, 'Imposta') || '0'),
    esigibilita: getText(r, 'EsigibilitaIVA'),
  }));

  // Calcola totali
  const netAmount = vatSummary.reduce((sum, v) => sum + v.imponibile, 0);
  const vatAmount = vatSummary.reduce((sum, v) => sum + v.imposta, 0);
  const grossAmount = importoTotale || (netAmount + vatAmount);

  // DatiPagamento
  const pagamenti = findElements(body, 'DettaglioPagamento');
  const paymentDetails = pagamenti.map(p => ({
    modalita: getText(p, 'ModalitaPagamento'), // MP01=contanti, MP02=assegno, MP05=bonifico, etc.
    data_scadenza: getText(p, 'DataScadenzaPagamento'),
    importo: parseFloat(getText(p, 'ImportoPagamento') || '0'),
    iban: getText(p, 'IBAN'),
    bic: getText(p, 'BIC'),
  }));

  return {
    // Identificativi
    tipo_documento: tipoDoc,
    tipo_label: TIPO_DOCUMENTO_MAP[tipoDoc] || tipoDoc,
    invoice_number: numero,
    invoice_date: data,
    divisa,

    // Fornitore
    supplier_name: supplier?.ragione_sociale,
    supplier_vat: supplier?.partita_iva,

    // Importi
    net_amount: Math.round(netAmount * 100) / 100,
    vat_amount: Math.round(vatAmount * 100) / 100,
    gross_amount: Math.round(grossAmount * 100) / 100,

    // Dettagli
    causale,
    line_items: lineItems,
    vat_summary: vatSummary,
    payment_details: paymentDetails,
    ritenuta_acconto: ritenutaAcconto,

    // Raw per debug
    _raw: {
      tipo_documento: tipoDoc,
      numero,
      data,
      importo_totale: importoTotale,
    },
  };
}

// ─── TIPO DOCUMENTO MAP ─────────────────────────────────────────

const TIPO_DOCUMENTO_MAP = {
  'TD01': 'Fattura',
  'TD02': 'Acconto/Anticipo su fattura',
  'TD03': 'Acconto/Anticipo su parcella',
  'TD04': 'Nota di Credito',
  'TD05': 'Nota di Debito',
  'TD06': 'Parcella',
  'TD16': 'Integrazione fattura reverse charge interno',
  'TD17': 'Integrazione/autofattura acquisto servizi estero',
  'TD18': 'Integrazione acquisto beni intracomunitari',
  'TD19': 'Integrazione/autofattura acquisto beni art.17 c.2 DPR 633/72',
  'TD20': 'Autofattura per regolarizzazione',
  'TD21': 'Autofattura per splafonamento',
  'TD22': 'Estrazione beni da deposito IVA',
  'TD23': 'Estrazione beni da deposito IVA con versamento IVA',
  'TD24': 'Fattura differita art.21 c.4 lett. a',
  'TD25': 'Fattura differita art.21 c.4 terzo periodo lett. b',
  'TD26': 'Cessione di beni ammortizzabili e passaggi interni',
  'TD27': 'Fattura autoconsumo/cessioni gratuite senza rivalsa',
};

// ─── MODALITA PAGAMENTO MAP ─────────────────────────────────────

export const MODALITA_PAGAMENTO_MAP = {
  'MP01': 'Contanti',
  'MP02': 'Assegno',
  'MP03': 'Assegno circolare',
  'MP04': 'Contanti presso Tesoreria',
  'MP05': 'Bonifico',
  'MP06': 'Vaglia cambiario',
  'MP07': 'Bollettino bancario',
  'MP08': 'Carta di pagamento',
  'MP09': 'RID',
  'MP10': 'RID utenze',
  'MP11': 'RID veloce',
  'MP12': 'RIBA',
  'MP13': 'MAV',
  'MP14': 'Quietanza erario',
  'MP15': 'Giroconto su conti di contabilità speciale',
  'MP16': 'Domiciliazione bancaria',
  'MP17': 'Domiciliazione postale',
  'MP18': 'Bollettino di c/c postale',
  'MP19': 'SEPA Direct Debit',
  'MP20': 'SEPA Direct Debit CORE',
  'MP21': 'SEPA Direct Debit B2B',
  'MP22': 'Trattenuta su somme già riscosse',
  'MP23': 'PagoPA',
};

// ─── TRANSFORM TO DB RECORDS ────────────────────────────────────

/**
 * Trasforma fatture parsate in record per electronic_invoices + suppliers + payables
 * @param {Object[]} invoices - output di parseFatturaPA
 * @param {Object} context - { company_id, import_batch_id }
 * @returns {{ invoiceRecords: Object[], supplierRecord: Object|null, payableRecords: Object[] }}
 */
export function transformInvoiceToRecords(invoices, supplier, context) {
  const { company_id, import_batch_id } = context;

  // Build supplier record for auto-creation
  const supplierRecord = supplier ? {
    company_id,
    ragione_sociale: supplier.ragione_sociale,
    partita_iva: supplier.partita_iva,
    codice_fiscale: supplier.codice_fiscale,
    // Address
    indirizzo: supplier.sede?.indirizzo,
    cap: supplier.sede?.cap,
    comune: supplier.sede?.comune,
    provincia: supplier.sede?.provincia,
    source: 'xml_sdi',
  } : null;

  const invoiceRecords = invoices.map(inv => ({
    company_id,
    import_batch_id,
    invoice_number: inv.invoice_number,
    invoice_date: inv.invoice_date,
    supplier_name: inv.supplier_name,
    supplier_vat: inv.supplier_vat,
    net_amount: inv.net_amount,
    vat_amount: inv.vat_amount,
    gross_amount: inv.gross_amount,
    description: inv.causale || inv.line_items.map(l => l.descrizione).filter(Boolean).join('; '),
    source: 'xml_sdi',
    is_reconciled: false,
  }));

  // Create payable records from payment details
  const payableRecords = [];
  invoices.forEach(inv => {
    if (inv.payment_details.length > 0) {
      inv.payment_details.forEach(pd => {
        payableRecords.push({
          company_id,
          invoice_number: inv.invoice_number,
          supplier_name: inv.supplier_name,
          supplier_vat: inv.supplier_vat,
          amount: pd.importo || inv.gross_amount,
          due_date: pd.data_scadenza || inv.invoice_date,
          payment_method: MODALITA_PAGAMENTO_MAP[pd.modalita] || pd.modalita,
          iban: pd.iban,
          status: 'da_pagare',
        });
      });
    } else {
      // No payment details: create single payable
      payableRecords.push({
        company_id,
        invoice_number: inv.invoice_number,
        supplier_name: inv.supplier_name,
        supplier_vat: inv.supplier_vat,
        amount: inv.gross_amount,
        due_date: inv.invoice_date,
        status: 'da_pagare',
      });
    }
  });

  return { invoiceRecords, supplierRecord, payableRecords };
}
