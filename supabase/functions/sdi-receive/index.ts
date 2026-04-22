import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * SDI Receive Webhook — sdi-receive
 *
 * Endpoint registrato su Agenzia delle Entrate per ricevere fatture elettroniche
 * in formato XML FatturaPA dal Sistema di Interscambio (SDI).
 *
 * verify_jwt: false — è un webhook chiamato direttamente dal SDI, non dal frontend.
 *
 * Flusso:
 * 1. Riceve POST con XML FatturaPA
 * 2. Parsa XML per estrarre dati fattura
 * 3. UPSERT in electronic_invoices (chiave: company_id + sdi_id)
 * 4. Risponde HTTP 200
 */

const COMPANY_ID = "00000000-0000-0000-0000-000000000001";

// ─── XML Parser helpers ─────────────────────────────────────────────
// Parser leggero per XML FatturaPA senza dipendenze esterne.
// Estrae il testo tra tag XML, gestendo namespace e nesting.

function getTagValue(xml: string, tagName: string): string | null {
  // Match sia con che senza namespace (es. <ns2:Denominazione> o <Denominazione>)
  const patterns = [
    new RegExp(`<(?:[\\w]+:)?${tagName}[^>]*>([^<]+)<\\/(?:[\\w]+:)?${tagName}>`, "i"),
    new RegExp(`<${tagName}[^>]*>([^<]+)<\\/${tagName}>`, "i"),
  ];

  for (const pattern of patterns) {
    const match = xml.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

function getTagBlock(xml: string, tagName: string): string | null {
  const pattern = new RegExp(
    `<(?:[\\w]+:)?${tagName}[^>]*>([\\s\\S]*?)<\\/(?:[\\w]+:)?${tagName}>`,
    "i"
  );
  const match = xml.match(pattern);
  return match ? match[1] : null;
}

function getAllTagBlocks(xml: string, tagName: string): string[] {
  const pattern = new RegExp(
    `<(?:[\\w]+:)?${tagName}[^>]*>[\\s\\S]*?<\\/(?:[\\w]+:)?${tagName}>`,
    "gi"
  );
  return xml.match(pattern) || [];
}

// ─── FatturaPA Parser ───────────────────────────────────────────────

interface ParsedInvoice {
  supplierName: string | null;
  supplierVat: string | null;
  supplierFiscalCode: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  tipoDocumento: string | null;
  netAmount: number | null;
  vatAmount: number | null;
  grossAmount: number | null;
  dueDate: string | null;
  paymentMethod: string | null;
  paymentAmount: number | null;
  description: string | null;
  codiceDestinatario: string | null;
}

function parseFatturaPA(xml: string): ParsedInvoice {
  // --- Header: CedentePrestatore (fornitore) ---
  const cedentePrestatore = getTagBlock(xml, "CedentePrestatore") || "";
  const datiAnagraficiFornitore = getTagBlock(cedentePrestatore, "DatiAnagrafici") || "";
  const idFiscaleIVA = getTagBlock(datiAnagraficiFornitore, "IdFiscaleIVA") || "";

  const supplierVat = getTagValue(idFiscaleIVA, "IdCodice");
  const supplierFiscalCode = getTagValue(datiAnagraficiFornitore, "CodiceFiscale");

  const anagrafica = getTagBlock(datiAnagraficiFornitore, "Anagrafica") || "";
  let supplierName = getTagValue(anagrafica, "Denominazione");
  if (!supplierName) {
    // Persona fisica: Nome + Cognome
    const nome = getTagValue(anagrafica, "Nome");
    const cognome = getTagValue(anagrafica, "Cognome");
    if (nome && cognome) supplierName = `${nome} ${cognome}`;
  }

  // --- Header: CodiceDestinatario ---
  const codiceDestinatario = getTagValue(xml, "CodiceDestinatario");

  // --- Body: DatiGeneraliDocumento ---
  const datiGenerali = getTagBlock(xml, "DatiGenerali") || "";
  const datiGeneraliDoc = getTagBlock(datiGenerali, "DatiGeneraliDocumento") || "";

  const tipoDocumento = getTagValue(datiGeneraliDoc, "TipoDocumento");
  const invoiceNumber = getTagValue(datiGeneraliDoc, "Numero");
  const invoiceDate = getTagValue(datiGeneraliDoc, "Data");
  const importoTotale = getTagValue(datiGeneraliDoc, "ImportoTotaleDocumento");

  // --- Body: DatiRiepilogo (possono essere multipli per aliquote diverse) ---
  const datiBeniServizi = getTagBlock(xml, "DatiBeniServizi") || "";
  const riepilogoBlocks = getAllTagBlocks(datiBeniServizi, "DatiRiepilogo");

  let totalImponibile = 0;
  let totalImposta = 0;

  for (const block of riepilogoBlocks) {
    const imponibile = getTagValue(block, "ImponibileImporto");
    const imposta = getTagValue(block, "Imposta");
    if (imponibile) totalImponibile += parseFloat(imponibile);
    if (imposta) totalImposta += parseFloat(imposta);
  }

  const grossAmount = importoTotale
    ? parseFloat(importoTotale)
    : totalImponibile + totalImposta;

  // --- Body: DatiPagamento ---
  const datiPagamento = getTagBlock(xml, "DatiPagamento") || "";
  const dettaglioPagamento = getTagBlock(datiPagamento, "DettaglioPagamento") || "";

  const dueDate = getTagValue(dettaglioPagamento, "DataScadenzaPagamento");
  const paymentMethod = getTagValue(dettaglioPagamento, "ModalitaPagamento");
  const paymentAmountStr = getTagValue(dettaglioPagamento, "ImportoPagamento");
  const paymentAmount = paymentAmountStr ? parseFloat(paymentAmountStr) : null;

  // --- Descrizione: prima linea di dettaglio ---
  const dettaglioLinee = getTagBlock(datiBeniServizi, "DettaglioLinee") || "";
  const description = getTagValue(dettaglioLinee, "Descrizione");

  return {
    supplierName,
    supplierVat,
    supplierFiscalCode,
    invoiceNumber,
    invoiceDate,
    tipoDocumento,
    netAmount: totalImponibile || null,
    vatAmount: totalImposta || null,
    grossAmount: grossAmount || null,
    dueDate,
    paymentMethod,
    paymentAmount,
    description,
    codiceDestinatario,
  };
}

// ─── Genera SDI ID dal contenuto XML ────────────────────────────────
// Se il SDI manda un identificativo nel filename o header, lo usiamo.
// Altrimenti generiamo un ID basato su fornitore+numero+data per deduplicazione.

function extractOrGenerateSdiId(xml: string, headers: Headers): string {
  // Prova a estrarre da header SDI (Content-Disposition filename)
  const contentDisposition = headers.get("Content-Disposition") || "";
  const filenameMatch = contentDisposition.match(/filename[^;=\n]*=["']?([^"';\n]+)/i);
  if (filenameMatch) {
    // Il filename SDI contiene tipicamente l'identificativo: IT01234567890_12345.xml
    return filenameMatch[1].replace(/\.xml$/i, "");
  }

  // Prova dall'XML: IdentificativoSdI (presente nelle notifiche, a volte nelle fatture)
  const sdiIdFromXml = getTagValue(xml, "IdentificativoSdI");
  if (sdiIdFromXml) return sdiIdFromXml;

  // Fallback: genera da P.IVA + numero + data
  const parsed = parseFatturaPA(xml);
  const parts = [
    parsed.supplierVat || "UNKNOWN",
    parsed.invoiceNumber || "0",
    parsed.invoiceDate || new Date().toISOString().slice(0, 10),
  ];
  return `SDI_${parts.join("_")}`;
}

// ─── Main Handler ───────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Solo POST — è un webhook
  if (req.method !== "POST") {
    console.log(`[sdi-receive] Rejected ${req.method} request`);
    return new Response("Method not allowed", { status: 405 });
  }

  const startTime = Date.now();

  try {
    const xmlBody = await req.text();
    console.log(`[sdi-receive] Received invoice XML, length: ${xmlBody.length}`);

    if (!xmlBody || xmlBody.length < 100) {
      console.error("[sdi-receive] Empty or too short XML body");
      return new Response("Bad request: empty body", { status: 400 });
    }

    // Parsa la FatturaPA
    const parsed = parseFatturaPA(xmlBody);
    console.log("[sdi-receive] Parsed invoice:", JSON.stringify({
      supplier: parsed.supplierName,
      vat: parsed.supplierVat,
      number: parsed.invoiceNumber,
      date: parsed.invoiceDate,
      tipo: parsed.tipoDocumento,
      gross: parsed.grossAmount,
    }));

    // Genera/estrai SDI ID
    const sdiId = extractOrGenerateSdiId(xmlBody, req.headers);
    console.log(`[sdi-receive] SDI ID: ${sdiId}`);

    // Connessione Supabase con service role (bypass RLS)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // UPSERT in electronic_invoices
    // Usa sdi_id come chiave per evitare duplicati (se il SDI reinvia la stessa fattura)
    const invoiceData = {
      company_id: COMPANY_ID,
      sdi_id: sdiId,
      sdi_status: "RECEIVED",
      source: "xml_sdi",
      tipo_documento: parsed.tipoDocumento || "TD01",
      invoice_number: parsed.invoiceNumber,
      invoice_date: parsed.invoiceDate || null,
      supplier_name: parsed.supplierName,
      supplier_vat: parsed.supplierVat,
      supplier_fiscal_code: parsed.supplierFiscalCode,
      net_amount: parsed.netAmount,
      vat_amount: parsed.vatAmount,
      gross_amount: parsed.grossAmount,
      due_date: parsed.dueDate || null,
      payment_method: parsed.paymentMethod,
      description: parsed.description,
      codice_destinatario: parsed.codiceDestinatario,
      xml_content: xmlBody,
      updated_at: new Date().toISOString(),
    };

    // Prima prova: cerca se esiste già con questo sdi_id
    const { data: existing } = await supabase
      .from("electronic_invoices")
      .select("id")
      .eq("company_id", COMPANY_ID)
      .eq("sdi_id", sdiId)
      .maybeSingle();

    let result;
    if (existing) {
      // UPDATE — la fattura esiste già, aggiorna i dati
      console.log(`[sdi-receive] Updating existing invoice ${existing.id}`);
      result = await supabase
        .from("electronic_invoices")
        .update(invoiceData)
        .eq("id", existing.id)
        .select("id")
        .single();
    } else {
      // INSERT — nuova fattura
      console.log("[sdi-receive] Inserting new invoice");
      result = await supabase
        .from("electronic_invoices")
        .insert(invoiceData)
        .select("id")
        .single();
    }

    if (result.error) {
      console.error("[sdi-receive] DB error:", result.error);
      // Rispondi comunque 200 al SDI per evitare retry infiniti
      // ma logga l'errore per debug
      return new Response("OK (with DB warning)", { status: 200 });
    }

    const elapsed = Date.now() - startTime;
    console.log(`[sdi-receive] Success: invoice ${result.data.id} (${parsed.invoiceNumber}) from ${parsed.supplierName} — ${elapsed}ms`);

    return new Response("OK", { status: 200 });

  } catch (error) {
    console.error("[sdi-receive] Error:", error);
    // Rispondi 200 anche in caso di errore per evitare che il SDI continui a reinviare
    // L'errore viene loggato per investigazione manuale
    return new Response("OK (internal error logged)", { status: 200 });
  }
});
