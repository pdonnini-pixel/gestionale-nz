/**
 * SDI Sync Core — Logica condivisa per sync fatture e corrispettivi
 *
 * Usato sia dalla function manuale (sdi-sync) che dalla scheduled (sdi-sync-scheduled).
 * Connessione ad Agenzia delle Entrate con mTLS via Node.js https.
 *
 * EPPI S.R.L. (P.IVA 07355140489) = intermediario accreditato
 * New Zago (P.IVA 07362100484) = cliente
 */

import https from "https";
import { XMLParser } from "fast-xml-parser";
import { SupabaseClient } from "@supabase/supabase-js";

const COMPANY_ID = "00000000-0000-0000-0000-000000000001";
const NEW_ZAGO_PIVA = "07362100484";

// API AdE — Consultazione e Download
// NOTA: gli endpoint esatti vanno verificati con la documentazione tecnica AdE
const ADE_FATTURE_API = "https://api.fatturapa.gov.it/servizi/fatturazione/v1";
const ADE_CORRISPETTIVI_API = "https://api.corrispettivi.agenziaentrate.gov.it/v1";

// ═══════════════════════════════════════════════════════════
// mTLS Agent
// ═══════════════════════════════════════════════════════════

export function createMtlsAgent(): https.Agent {
  const clientCert = process.env.SDI_CLIENT_CERT;
  const clientKey = process.env.SDI_CLIENT_KEY;
  const caCert = process.env.SDI_CA_CERT;

  if (!clientCert || !clientKey) {
    throw new Error("Certificati mTLS non configurati nelle env vars Netlify (SDI_CLIENT_CERT, SDI_CLIENT_KEY)");
  }

  return new https.Agent({
    cert: clientCert,
    key: clientKey,
    ca: caCert || undefined,
    rejectUnauthorized: true,
  });
}

// ═══════════════════════════════════════════════════════════
// HTTP con mTLS
// ═══════════════════════════════════════════════════════════

export function fetchWithMtls(
  url: string,
  agent: https.Agent,
  method: string = "GET"
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      agent,
      headers: {
        Accept: "application/xml, application/json",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => (data += chunk.toString()));
      res.on("end", () => resolve({ status: res.statusCode || 0, body: data }));
    });

    req.on("error", (err: Error & { code?: string }) => {
      // Logging dettagliato per debug certificati
      if (err.code === "ERR_TLS_CERT_ALTNAME_INVALID") {
        console.error("[sdi-sync] Certificato non valido per questo hostname");
      }
      if (err.code === "ECONNREFUSED" || err.code === "ECONNRESET") {
        console.error("[sdi-sync] Connessione rifiutata — verificare certificato client");
      }
      reject(err);
    });

    req.setTimeout(30000, () => {
      req.destroy(new Error("Request timeout (30s)"));
    });
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════
// XML Parser
// ═══════════════════════════════════════════════════════════

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true, // rimuove namespace prefix per parsing piu' semplice
});

// ═══════════════════════════════════════════════════════════
// Parse FatturaPA XML
// ═══════════════════════════════════════════════════════════

export interface ParsedFattura {
  sdiId: string | null;
  partitaIvaFornitore: string;
  codiceFiscaleFornitore: string;
  denominazioneFornitore: string;
  numero: string;
  data: string;
  tipoDocumento: string;
  importoTotale: number;
  imponibile: number;
  imposta: number;
  dataScadenza: string | null;
  descrizione: string | null;
  codiceDestinatario: string | null;
  paymentMethod: string | null;
}

export function parseFatturaPA(xml: string): ParsedFattura {
  const doc = xmlParser.parse(xml);

  // Naviga la struttura FatturaPA (con o senza namespace)
  const root = doc?.FatturaElettronica || doc?.["p:FatturaElettronica"] || {};
  const header = root?.FatturaElettronicaHeader || {};
  const body = root?.FatturaElettronicaBody || {};

  // Se body e' un array (fattura multipla), prendi il primo
  const bodyFirst = Array.isArray(body) ? body[0] : body;

  const cedente = header?.CedentePrestatore?.DatiAnagrafici || {};
  const idFiscaleIVA = cedente?.IdFiscaleIVA || {};
  const anagrafica = cedente?.Anagrafica || {};
  const datiTrasmissione = header?.DatiTrasmissione || {};

  const datiGenerali = bodyFirst?.DatiGenerali?.DatiGeneraliDocumento || {};
  const datiBeniServizi = bodyFirst?.DatiBeniServizi || {};
  const datiPagamento = bodyFirst?.DatiPagamento || {};

  // Riepilogo IVA (puo' essere array o singolo)
  const riepilogo = Array.isArray(datiBeniServizi?.DatiRiepilogo)
    ? datiBeniServizi.DatiRiepilogo
    : datiBeniServizi?.DatiRiepilogo
    ? [datiBeniServizi.DatiRiepilogo]
    : [];

  const imponibile = riepilogo.reduce(
    (sum: number, r: any) => sum + (parseFloat(r?.ImponibileImporto) || 0),
    0
  );
  const imposta = riepilogo.reduce(
    (sum: number, r: any) => sum + (parseFloat(r?.Imposta) || 0),
    0
  );

  // Pagamento (puo' essere array o singolo)
  const dettaglioPagamento = datiPagamento?.DettaglioPagamento;
  const pagamento = Array.isArray(dettaglioPagamento)
    ? dettaglioPagamento[0]
    : dettaglioPagamento || {};

  // Denominazione: Denominazione o Nome+Cognome
  let denominazione = anagrafica?.Denominazione || "";
  if (!denominazione) {
    const nome = anagrafica?.Nome || "";
    const cognome = anagrafica?.Cognome || "";
    if (nome && cognome) denominazione = `${nome} ${cognome}`;
  }

  // Prima descrizione linea
  const dettaglioLinee = datiBeniServizi?.DettaglioLinee;
  const primaLinea = Array.isArray(dettaglioLinee) ? dettaglioLinee[0] : dettaglioLinee;
  const descrizione = primaLinea?.Descrizione || null;

  return {
    sdiId: datiTrasmissione?.ProgressivoInvio || null,
    partitaIvaFornitore: idFiscaleIVA?.IdCodice || "",
    codiceFiscaleFornitore: cedente?.CodiceFiscale || "",
    denominazioneFornitore: denominazione,
    numero: datiGenerali?.Numero || "",
    data: datiGenerali?.Data || "",
    tipoDocumento: datiGenerali?.TipoDocumento || "TD01",
    importoTotale:
      parseFloat(datiGenerali?.ImportoTotaleDocumento) || imponibile + imposta,
    imponibile,
    imposta,
    dataScadenza: pagamento?.DataScadenzaPagamento || null,
    descrizione,
    codiceDestinatario: datiTrasmissione?.CodiceDestinatario || null,
    paymentMethod: pagamento?.ModalitaPagamento || null,
  };
}

// ═══════════════════════════════════════════════════════════
// Sync Fatture Passive
// ═══════════════════════════════════════════════════════════

export async function syncFatture(
  agent: https.Agent,
  supabase: SupabaseClient,
  dateFrom: string,
  dateTo: string
): Promise<{ count: number; errors: string[] }> {
  const errors: string[] = [];

  const listUrl =
    `${ADE_FATTURE_API}/ricevute?` +
    `idFiscale=${NEW_ZAGO_PIVA}&dataInizio=${dateFrom}&dataFine=${dateTo}`;

  console.log(`[sdi-sync] Fetching fatture: ${listUrl}`);

  let response;
  try {
    response = await fetchWithMtls(listUrl, agent);
    console.log(`[sdi-sync] Fatture response status: ${response.status}`);
  } catch (err: any) {
    const msg = `mTLS fatture failed: ${err.code || err.message}`;
    console.error(`[sdi-sync] ${msg}`);
    errors.push(msg);
    return { count: 0, errors };
  }

  if (response.status === 401 || response.status === 403) {
    errors.push(`AdE auth failed (${response.status}) — verificare certificati e delega`);
    return { count: 0, errors };
  }

  if (response.status === 404 || response.status === 204 || !response.body) {
    console.log("[sdi-sync] Nessuna fattura trovata nel periodo");
    return { count: 0, errors };
  }

  console.log(`[sdi-sync] Response preview: ${response.body.substring(0, 500)}`);

  // Estrai fatture dalla risposta
  const fatture = extractFattureFromResponse(response.body);
  let count = 0;

  for (const f of fatture) {
    try {
      const parsed = parseFatturaPA(f.xml);
      const sdiId = parsed.sdiId || f.identificativo || `SDI_${parsed.partitaIvaFornitore}_${parsed.numero}_${parsed.data}`;

      // Cerca se esiste gia'
      const { data: existing } = await supabase
        .from("electronic_invoices")
        .select("id")
        .eq("company_id", COMPANY_ID)
        .eq("sdi_id", sdiId)
        .maybeSingle();

      const invoiceData = {
        company_id: COMPANY_ID,
        sdi_id: sdiId,
        sdi_status: "RECEIVED",
        source: "api_ade",
        tipo_documento: parsed.tipoDocumento,
        invoice_number: parsed.numero,
        invoice_date: parsed.data || null,
        supplier_name: parsed.denominazioneFornitore,
        supplier_vat: parsed.partitaIvaFornitore,
        supplier_fiscal_code: parsed.codiceFiscaleFornitore,
        net_amount: parsed.imponibile || null,
        vat_amount: parsed.imposta || null,
        gross_amount: parsed.importoTotale || null,
        due_date: parsed.dataScadenza || null,
        payment_method: parsed.paymentMethod,
        description: parsed.descrizione,
        codice_destinatario: parsed.codiceDestinatario,
        xml_content: f.xml,
        updated_at: new Date().toISOString(),
      };

      let result;
      if (existing) {
        result = await supabase
          .from("electronic_invoices")
          .update(invoiceData)
          .eq("id", existing.id);
      } else {
        result = await supabase
          .from("electronic_invoices")
          .insert(invoiceData);
      }

      if (result.error) {
        console.error(`[sdi-sync] Upsert error fattura ${parsed.numero}:`, result.error);
        errors.push(`Fattura ${parsed.numero}: ${result.error.message}`);
      } else {
        count++;
      }
    } catch (parseErr: any) {
      console.error(`[sdi-sync] Parse error:`, parseErr.message);
      errors.push(`Parse error: ${parseErr.message}`);
    }
  }

  return { count, errors };
}

// ═══════════════════════════════════════════════════════════
// Sync Corrispettivi
// ═══════════════════════════════════════════════════════════

export async function syncCorrispettivi(
  agent: https.Agent,
  supabase: SupabaseClient,
  dateFrom: string,
  dateTo: string
): Promise<{ count: number; errors: string[] }> {
  const errors: string[] = [];

  const listUrl =
    `${ADE_CORRISPETTIVI_API}/consultazione?` +
    `idFiscale=${NEW_ZAGO_PIVA}&dataInizio=${dateFrom}&dataFine=${dateTo}`;

  console.log(`[sdi-sync] Fetching corrispettivi: ${listUrl}`);

  let response;
  try {
    response = await fetchWithMtls(listUrl, agent);
    console.log(`[sdi-sync] Corrispettivi response status: ${response.status}`);
  } catch (err: any) {
    const msg = `mTLS corrispettivi failed: ${err.code || err.message}`;
    console.error(`[sdi-sync] ${msg}`);
    errors.push(msg);
    return { count: 0, errors };
  }

  if (response.status === 401 || response.status === 403) {
    errors.push(`AdE corrispettivi auth failed (${response.status})`);
    return { count: 0, errors };
  }

  if (response.status === 404 || response.status === 204 || !response.body) {
    console.log("[sdi-sync] Nessun corrispettivo trovato nel periodo");
    return { count: 0, errors };
  }

  console.log(`[sdi-sync] Corrispettivi preview: ${response.body.substring(0, 500)}`);

  const corrispettivi = extractCorrispettiviFromResponse(response.body);
  let count = 0;

  for (const corr of corrispettivi) {
    try {
      // Mapping matricola RT → outlet_id
      const outletId = await mapDeviceToOutlet(supabase, corr.matricolaRT);

      const { error } = await supabase.from("corrispettivi_log").upsert(
        {
          company_id: COMPANY_ID,
          date: corr.data,
          device_serial: corr.matricolaRT || null,
          total_amount: corr.totale,
          vat_details: corr.dettaglioIva || null,
          xml_content: corr.xml || null,
          submission_status: "SUBMITTED",
          outlet_id: outletId,
        },
        { onConflict: "company_id,date,device_serial" }
      );

      if (error) {
        console.error(`[sdi-sync] Upsert corrispettivo error:`, error);
        errors.push(`Corrispettivo ${corr.data}: ${error.message}`);
      } else {
        count++;
      }
    } catch (parseErr: any) {
      console.error(`[sdi-sync] Corrispettivo error:`, parseErr.message);
      errors.push(`Corrispettivo parse: ${parseErr.message}`);
    }
  }

  return { count, errors };
}

// ═══════════════════════════════════════════════════════════
// Response Parsers
// NOTA: Questi parser sono placeholder. La struttura esatta
// della risposta AdE va verificata con la prima chiamata reale.
// Loggare la risposta e adattare il parsing.
// ═══════════════════════════════════════════════════════════

function extractFattureFromResponse(
  responseBody: string
): Array<{ xml: string; identificativo: string }> {
  try {
    // Caso 1: La risposta e' direttamente una FatturaPA XML
    if (responseBody.includes("FatturaElettronica")) {
      return [{ xml: responseBody, identificativo: "single" }];
    }

    // Caso 2: Risposta JSON con lista di fatture
    try {
      const json = JSON.parse(responseBody);
      if (Array.isArray(json)) {
        return json.map((item: any) => ({
          xml: item.xml || item.content || item.datiXml || "",
          identificativo: item.identificativoSdi || item.id || item.identificativo || "",
        }));
      }
      // JSON singolo con lista embeddata
      if (json.fatture && Array.isArray(json.fatture)) {
        return json.fatture.map((item: any) => ({
          xml: item.xml || item.content || "",
          identificativo: item.identificativoSdi || item.id || "",
        }));
      }
    } catch {
      // Non e' JSON, provo XML
    }

    // Caso 3: Risposta XML con lista di identificativi
    const parsed = xmlParser.parse(responseBody);
    console.log(
      "[sdi-sync] Parsed fatture response structure:",
      JSON.stringify(parsed).substring(0, 1000)
    );
    return [];
  } catch {
    console.log("[sdi-sync] Cannot parse fatture response, returning empty");
    return [];
  }
}

function extractCorrispettiviFromResponse(responseBody: string): Array<{
  data: string;
  matricolaRT: string;
  totale: number;
  dettaglioIva: any;
  xml: string | null;
}> {
  try {
    // Caso 1: JSON
    try {
      const json = JSON.parse(responseBody);
      if (Array.isArray(json)) {
        return json.map((item: any) => ({
          data: item.data || item.dataRiferimento || "",
          matricolaRT: item.matricolaRT || item.matricola || item.deviceSerial || "",
          totale: parseFloat(item.totale || item.importoTotale || 0),
          dettaglioIva: item.dettaglioIva || item.reparti || null,
          xml: item.xml || null,
        }));
      }
      if (json.corrispettivi && Array.isArray(json.corrispettivi)) {
        return json.corrispettivi.map((item: any) => ({
          data: item.data || "",
          matricolaRT: item.matricolaRT || "",
          totale: parseFloat(item.totale || 0),
          dettaglioIva: item.dettaglioIva || null,
          xml: item.xml || null,
        }));
      }
    } catch {
      // Non e' JSON
    }

    // Caso 2: XML
    const parsed = xmlParser.parse(responseBody);
    console.log(
      "[sdi-sync] Parsed corrispettivi response structure:",
      JSON.stringify(parsed).substring(0, 1000)
    );
    return [];
  } catch {
    console.log("[sdi-sync] Cannot parse corrispettivi response, returning empty");
    return [];
  }
}

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

async function mapDeviceToOutlet(
  supabase: SupabaseClient,
  matricola: string | null
): Promise<string | null> {
  if (!matricola) return null;

  // Cerca nella tabella outlets per device_serial o pos_serial
  const { data } = await supabase
    .from("outlets")
    .select("id")
    .eq("company_id", COMPANY_ID)
    .or(`device_serial.eq.${matricola},pos_serial.eq.${matricola}`)
    .limit(1)
    .maybeSingle();

  return data?.id || null;
}

export function getDefaultDateFrom(daysBack: number = 30): string {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().split("T")[0];
}

export function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

export { COMPANY_ID };
