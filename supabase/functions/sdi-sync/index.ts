import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * SDI Sync — sdi-sync
 *
 * Scarica fatture passive e corrispettivi di New Zago (P.IVA 07362100484)
 * dal cassetto fiscale AdE, usando i certificati mTLS in Vault.
 *
 * EPPI S.R.L. (P.IVA 07355140489) opera come intermediario delegato.
 *
 * Input: { type: 'fatture' | 'corrispettivi' | 'all', dateFrom?, dateTo? }
 * Output: { fattureSincronizzate, corrispettiviSincronizzati, errors, environment, mtlsSupported }
 */

const COMPANY_ID = "00000000-0000-0000-0000-000000000001";
const NEW_ZAGO_PIVA = "07362100484";

// Endpoint AdE Consultazione (produzione)
const ADE_BASE_URL = "https://api.fatturapa.gov.it/servizi/fatturazione/v1";
const ADE_CORR_BASE_URL = "https://api.corrispettivi.agenziaentrate.gov.it/v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── XML Parser helpers (same as sdi-receive) ──────────────────────

function getTagValue(xml: string, tagName: string): string | null {
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
  description: string | null;
  codiceDestinatario: string | null;
}

function parseFatturaPA(xml: string): ParsedInvoice {
  const cedentePrestatore = getTagBlock(xml, "CedentePrestatore") || "";
  const datiAnagraficiFornitore = getTagBlock(cedentePrestatore, "DatiAnagrafici") || "";
  const idFiscaleIVA = getTagBlock(datiAnagraficiFornitore, "IdFiscaleIVA") || "";
  const supplierVat = getTagValue(idFiscaleIVA, "IdCodice");
  const supplierFiscalCode = getTagValue(datiAnagraficiFornitore, "CodiceFiscale");
  const anagrafica = getTagBlock(datiAnagraficiFornitore, "Anagrafica") || "";
  let supplierName = getTagValue(anagrafica, "Denominazione");
  if (!supplierName) {
    const nome = getTagValue(anagrafica, "Nome");
    const cognome = getTagValue(anagrafica, "Cognome");
    if (nome && cognome) supplierName = `${nome} ${cognome}`;
  }
  const codiceDestinatario = getTagValue(xml, "CodiceDestinatario");
  const datiGenerali = getTagBlock(xml, "DatiGenerali") || "";
  const datiGeneraliDoc = getTagBlock(datiGenerali, "DatiGeneraliDocumento") || "";
  const tipoDocumento = getTagValue(datiGeneraliDoc, "TipoDocumento");
  const invoiceNumber = getTagValue(datiGeneraliDoc, "Numero");
  const invoiceDate = getTagValue(datiGeneraliDoc, "Data");
  const importoTotale = getTagValue(datiGeneraliDoc, "ImportoTotaleDocumento");
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
  const grossAmount = importoTotale ? parseFloat(importoTotale) : totalImponibile + totalImposta;
  const datiPagamento = getTagBlock(xml, "DatiPagamento") || "";
  const dettaglioPagamento = getTagBlock(datiPagamento, "DettaglioPagamento") || "";
  const dueDate = getTagValue(dettaglioPagamento, "DataScadenzaPagamento");
  const paymentMethod = getTagValue(dettaglioPagamento, "ModalitaPagamento");
  const dettaglioLinee = getTagBlock(datiBeniServizi, "DettaglioLinee") || "";
  const description = getTagValue(dettaglioLinee, "Descrizione");

  return {
    supplierName, supplierVat, supplierFiscalCode, invoiceNumber, invoiceDate,
    tipoDocumento, netAmount: totalImponibile || null, vatAmount: totalImposta || null,
    grossAmount: grossAmount || null, dueDate, paymentMethod, description, codiceDestinatario,
  };
}

// ─── mTLS HTTP Client ───────────────────────────────────────────────

interface MtlsCredentials {
  client_cert: string;
  client_key: string;
  server_cert: string;
  server_key: string;
}

async function createMtlsClient(creds: MtlsCredentials): Promise<Deno.HttpClient | null> {
  try {
    // Deno.createHttpClient è disponibile in Deno CLI ma potrebbe non esserlo in Deno Deploy
    // @ts-ignore — API unstable
    const client = Deno.createHttpClient({
      certChain: creds.client_cert,
      privateKey: creds.client_key,
    });
    console.log("[sdi-sync] mTLS client created successfully");
    return client;
  } catch (err) {
    console.error("[sdi-sync] Failed to create mTLS client:", err.message);
    console.error("[sdi-sync] Deno.createHttpClient may not be available in Deno Deploy");
    return null;
  }
}

// ─── AdE API calls ──────────────────────────────────────────────────

async function fetchFattureFromAde(
  httpClient: Deno.HttpClient,
  dateFrom: string,
  dateTo: string,
): Promise<{ invoices: string[]; errors: string[] }> {
  const errors: string[] = [];
  const invoices: string[] = [];

  try {
    // API AdE: lista fatture ricevute per P.IVA delegante
    // GET /consultazione/fatture/ricevute?idFiscale={piva}&dataInizio={from}&dataFine={to}
    const listUrl = `${ADE_BASE_URL}/consultazione/fatture/ricevute?idFiscale=${NEW_ZAGO_PIVA}&dataInizio=${dateFrom}&dataFine=${dateTo}`;
    console.log(`[sdi-sync] Fetching invoice list from: ${listUrl}`);

    const listRes = await fetch(listUrl, {
      // @ts-ignore — Deno unstable API
      client: httpClient,
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    });

    if (!listRes.ok) {
      const errText = await listRes.text();
      errors.push(`Lista fatture: HTTP ${listRes.status} — ${errText.substring(0, 200)}`);
      console.error(`[sdi-sync] Invoice list error: ${listRes.status}`, errText.substring(0, 500));
      return { invoices, errors };
    }

    const listData = await listRes.json();
    console.log(`[sdi-sync] Invoice list response:`, JSON.stringify(listData).substring(0, 500));

    // La risposta può essere un array di identificativi fattura
    const invoiceIds: string[] = listData?.risultati || listData?.data || listData || [];

    for (const invRef of invoiceIds) {
      try {
        const invId = typeof invRef === "string" ? invRef : invRef?.identificativoSdI || invRef?.id;
        if (!invId) continue;

        // Scarica XML singola fattura
        const xmlUrl = `${ADE_BASE_URL}/consultazione/fatture/ricevute/${invId}`;
        const xmlRes = await fetch(xmlUrl, {
          // @ts-ignore
          client: httpClient,
          method: "GET",
          headers: { "Accept": "application/xml" },
        });

        if (xmlRes.ok) {
          const xmlContent = await xmlRes.text();
          if (xmlContent && xmlContent.length > 100) {
            invoices.push(xmlContent);
          }
        } else {
          errors.push(`Fattura ${invId}: HTTP ${xmlRes.status}`);
        }
      } catch (invErr) {
        errors.push(`Fattura download error: ${(invErr as Error).message}`);
      }
    }
  } catch (err) {
    errors.push(`Errore chiamata AdE fatture: ${(err as Error).message}`);
    console.error("[sdi-sync] AdE fatture error:", err);
  }

  return { invoices, errors };
}

async function fetchCorrispettiviFromAde(
  httpClient: Deno.HttpClient,
  dateFrom: string,
  dateTo: string,
): Promise<{ corrispettivi: any[]; errors: string[] }> {
  const errors: string[] = [];
  const corrispettivi: any[] = [];

  try {
    // API AdE corrispettivi: lista trasmessi
    const listUrl = `${ADE_CORR_BASE_URL}/consultazione/corrispettivi?idFiscale=${NEW_ZAGO_PIVA}&dataInizio=${dateFrom}&dataFine=${dateTo}`;
    console.log(`[sdi-sync] Fetching corrispettivi from: ${listUrl}`);

    const listRes = await fetch(listUrl, {
      // @ts-ignore
      client: httpClient,
      method: "GET",
      headers: { "Accept": "application/json" },
    });

    if (!listRes.ok) {
      const errText = await listRes.text();
      errors.push(`Lista corrispettivi: HTTP ${listRes.status} — ${errText.substring(0, 200)}`);
      console.error(`[sdi-sync] Corrispettivi list error: ${listRes.status}`, errText.substring(0, 500));
      return { corrispettivi, errors };
    }

    const listData = await listRes.json();
    console.log(`[sdi-sync] Corrispettivi list response:`, JSON.stringify(listData).substring(0, 500));

    // Parse la lista di corrispettivi trasmessi
    const items = listData?.risultati || listData?.data || listData || [];

    for (const item of items) {
      try {
        const corrRecord = {
          date: item.dataTrasmissione || item.data || item.date,
          device_serial: item.matricolaDispositivo || item.matricola || item.device_serial,
          total_amount: parseFloat(item.importoTotale || item.totale || item.total_amount || "0"),
          vat_breakdown: item.dettaglioIva || item.vatBreakdown || null,
          xml_content: item.xmlContent || item.xml || null,
          ade_receipt_id: item.identificativo || item.id || null,
        };
        corrispettivi.push(corrRecord);
      } catch (parseErr) {
        errors.push(`Corrispettivo parse error: ${(parseErr as Error).message}`);
      }
    }
  } catch (err) {
    errors.push(`Errore chiamata AdE corrispettivi: ${(err as Error).message}`);
    console.error("[sdi-sync] AdE corrispettivi error:", err);
  }

  return { corrispettivi, errors };
}

// ─── Outlet mapping (matricola RT → outlet_id) ─────────────────────

async function getOutletMapping(supabase: any): Promise<Map<string, string>> {
  // Per ora: carica gli outlet e tenta di mappare in base al nome/codice
  // In futuro: tabella rt_devices con mappatura matricola → outlet_id
  const { data: outlets } = await supabase
    .from("outlets")
    .select("id, name, code")
    .eq("company_id", COMPANY_ID);

  const map = new Map<string, string>();
  // Placeholder — la mappatura reale verrà configurata in Impostazioni
  // quando Patrizio fornirà le matricole dei registratori telematici
  if (outlets) {
    for (const o of outlets) {
      // La matricola RT potrebbe contenere il codice outlet
      map.set(o.code, o.id);
      map.set(o.name.toUpperCase(), o.id);
    }
  }
  return map;
}

function findOutletByDeviceSerial(serial: string | null, mapping: Map<string, string>, outlets: any[]): string | null {
  if (!serial) return outlets?.[0]?.id || null; // fallback al primo outlet
  const upperSerial = serial.toUpperCase();
  // Prova match diretto
  for (const [key, outletId] of mapping.entries()) {
    if (upperSerial.includes(key)) return outletId;
  }
  return outlets?.[0]?.id || null;
}

// ─── Main Handler ───────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const startTime = Date.now();

  try {
    // Autenticazione utente via JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verifica utente
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const companyId = user.app_metadata?.company_id;
    if (!companyId) {
      return new Response(JSON.stringify({ error: "No company assigned" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[sdi-sync] User ${user.email} (company: ${companyId}) starting sync`);

    // Parse input
    const body = await req.json();
    const syncType = body.type || "all"; // 'fatture' | 'corrispettivi' | 'all'
    const dateTo = body.dateTo || new Date().toISOString().split("T")[0];
    const dateFrom = body.dateFrom || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    console.log(`[sdi-sync] Type: ${syncType}, From: ${dateFrom}, To: ${dateTo}`);

    // Recupera certificati dal Vault
    const { data: creds, error: credsError } = await supabase.rpc("get_sdi_credentials");
    if (credsError || !creds || creds.length === 0) {
      console.error("[sdi-sync] Failed to get credentials:", credsError);
      return new Response(JSON.stringify({
        error: "Certificati SDI non trovati nel Vault. Verificare configurazione.",
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const credentials: MtlsCredentials = creds[0];
    console.log("[sdi-sync] Credentials loaded from Vault (cert length:", credentials.client_cert?.length, ")");

    // Crea client mTLS
    const httpClient = await createMtlsClient(credentials);

    let fattureSincronizzate = 0;
    let corrispettiviSincronizzati = 0;
    const allErrors: string[] = [];
    let mtlsSupported = true;

    if (!httpClient) {
      // mTLS non supportato in Deno Deploy — documenta e rispondi con stato chiaro
      mtlsSupported = false;
      console.warn("[sdi-sync] mTLS NOT supported — Deno.createHttpClient unavailable in Deno Deploy");
      console.warn("[sdi-sync] Per scaricare fatture reali serve un proxy mTLS o import manuale XML");
      allErrors.push(
        "mTLS non disponibile in Supabase Edge Functions (limitazione Deno Deploy). " +
        "Le API AdE richiedono certificati client SSL. " +
        "Alternative: (1) proxy server con certificati montati, (2) import manuale XML dal portale AdE."
      );
    } else {
      // ── Sync Fatture ──────────────────────────────────────────────
      if (syncType === "fatture" || syncType === "all") {
        console.log("[sdi-sync] Starting fatture sync...");
        const { invoices, errors: fatErrors } = await fetchFattureFromAde(httpClient, dateFrom, dateTo);
        allErrors.push(...fatErrors);

        for (const xmlContent of invoices) {
          try {
            const parsed = parseFatturaPA(xmlContent);
            const sdiId = getTagValue(xmlContent, "IdentificativoSdI") ||
              `SYNC_${parsed.supplierVat || "UNK"}_${parsed.invoiceNumber || "0"}_${parsed.invoiceDate || ""}`;

            const invoiceData = {
              company_id: COMPANY_ID,
              sdi_id: sdiId,
              sdi_status: "RECEIVED",
              source: "api_ade",
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
              xml_content: xmlContent,
              updated_at: new Date().toISOString(),
            };

            // Check if exists
            const { data: existing } = await supabase
              .from("electronic_invoices")
              .select("id")
              .eq("company_id", COMPANY_ID)
              .eq("sdi_id", sdiId)
              .maybeSingle();

            if (existing) {
              await supabase.from("electronic_invoices").update(invoiceData).eq("id", existing.id);
            } else {
              await supabase.from("electronic_invoices").insert(invoiceData);
            }
            fattureSincronizzate++;
          } catch (invErr) {
            allErrors.push(`UPSERT fattura error: ${(invErr as Error).message}`);
          }
        }
        console.log(`[sdi-sync] Fatture synced: ${fattureSincronizzate}`);
      }

      // ── Sync Corrispettivi ────────────────────────────────────────
      if (syncType === "corrispettivi" || syncType === "all") {
        console.log("[sdi-sync] Starting corrispettivi sync...");
        const { corrispettivi, errors: corrErrors } = await fetchCorrispettiviFromAde(httpClient, dateFrom, dateTo);
        allErrors.push(...corrErrors);

        // Carica mapping outlet
        const outletMapping = await getOutletMapping(supabase);
        const { data: outlets } = await supabase
          .from("outlets")
          .select("id, name, code")
          .eq("company_id", COMPANY_ID);

        for (const corr of corrispettivi) {
          try {
            const outletId = findOutletByDeviceSerial(corr.device_serial, outletMapping, outlets || []);
            if (!outletId) {
              allErrors.push(`Corrispettivo ${corr.date}: outlet non trovato per device ${corr.device_serial}`);
              continue;
            }

            const corrData = {
              company_id: COMPANY_ID,
              outlet_id: outletId,
              date: corr.date,
              device_serial: corr.device_serial,
              total_amount: corr.total_amount,
              vat_breakdown: corr.vat_breakdown,
              xml_content: corr.xml_content,
              ade_receipt_id: corr.ade_receipt_id,
              submission_status: "ACCEPTED",
              submitted_at: new Date().toISOString(),
            };

            // UPSERT on (company_id, outlet_id, date)
            const { data: existingCorr } = await supabase
              .from("corrispettivi_log")
              .select("id")
              .eq("company_id", COMPANY_ID)
              .eq("outlet_id", outletId)
              .eq("date", corr.date)
              .maybeSingle();

            if (existingCorr) {
              await supabase.from("corrispettivi_log").update(corrData).eq("id", existingCorr.id);
            } else {
              await supabase.from("corrispettivi_log").insert(corrData);
            }
            corrispettiviSincronizzati++;
          } catch (corrErr) {
            allErrors.push(`UPSERT corrispettivo error: ${(corrErr as Error).message}`);
          }
        }
        console.log(`[sdi-sync] Corrispettivi synced: ${corrispettiviSincronizzati}`);
      }

      // Chiudi il client
      try {
        httpClient.close();
      } catch (_) {}
    }

    const elapsed = Date.now() - startTime;
    console.log(`[sdi-sync] Completed in ${elapsed}ms: ${fattureSincronizzate} fatture, ${corrispettiviSincronizzati} corrispettivi, ${allErrors.length} errors`);

    return new Response(JSON.stringify({
      fattureSincronizzate,
      corrispettiviSincronizzati,
      errors: allErrors.length > 0 ? allErrors : undefined,
      mtlsSupported,
      environment: mtlsSupported ? "PRODUCTION" : "DEGRADED",
      elapsed: `${elapsed}ms`,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("[sdi-sync] Fatal error:", error);
    return new Response(JSON.stringify({
      error: (error as Error).message,
      code: "SDI_SYNC_ERROR",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
