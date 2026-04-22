import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * SDI Notifications Webhook — sdi-notifications
 *
 * Endpoint registrato su Agenzia delle Entrate per ricevere notifiche di stato
 * sulle fatture inviate tramite SDI.
 *
 * verify_jwt: false — è un webhook chiamato direttamente dal SDI, non dal frontend.
 *
 * Tipi di notifica gestiti:
 * - RC (Ricevuta di Consegna)    → DELIVERED
 * - NS (Notifica di Scarto)      → REJECTED
 * - MC (Mancata Consegna)        → DEPOSITED
 * - NE (Notifica Esito)          → ACCEPTED / REJECTED
 * - DT (Decorrenza Termini)      → ACCEPTED
 * - AT (Attestazione trasmissione con impossibilità di recapito) → DEPOSITED
 */

const COMPANY_ID = "00000000-0000-0000-0000-000000000001";

// ─── XML helpers ────────────────────────────────────────────────────

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

// ─── Notification type mapping ──────────────────────────────────────

interface NotificationMapping {
  sdiStatus: string;
  description: string;
}

function mapNotificationType(xml: string): NotificationMapping | null {
  // Il tipo di notifica è determinato dal root element dell'XML
  // oppure dal campo NomeFile che contiene il prefisso del tipo

  // Ricevuta di Consegna
  if (xml.includes("RicevutaConsegna") || xml.includes("<TipoRicevuta>RC</TipoRicevuta>") || /RC_\d/.test(xml)) {
    return { sdiStatus: "DELIVERED", description: "Ricevuta di Consegna — fattura consegnata al destinatario" };
  }

  // Notifica di Scarto
  if (xml.includes("NotificaScarto") || xml.includes("<TipoRicevuta>NS</TipoRicevuta>") || /NS_\d/.test(xml)) {
    return { sdiStatus: "REJECTED", description: "Notifica di Scarto — fattura rifiutata dal SDI" };
  }

  // Mancata Consegna
  if (xml.includes("MancataConsegna") || xml.includes("<TipoRicevuta>MC</TipoRicevuta>") || /MC_\d/.test(xml)) {
    return { sdiStatus: "DEPOSITED", description: "Mancata Consegna — fattura depositata nell'area riservata del destinatario" };
  }

  // Notifica Esito (committente accetta o rifiuta)
  if (xml.includes("NotificaEsito") || xml.includes("<TipoRicevuta>NE</TipoRicevuta>") || /NE_\d/.test(xml)) {
    // Controlla se è accettazione o rifiuto
    const esito = getTagValue(xml, "Esito");
    if (esito === "EC01") {
      return { sdiStatus: "ACCEPTED", description: "Notifica Esito — fattura accettata dal committente" };
    } else if (esito === "EC02") {
      return { sdiStatus: "REJECTED", description: "Notifica Esito — fattura rifiutata dal committente" };
    }
    // Default NE senza esito chiaro → ACCEPTED (conservativo)
    return { sdiStatus: "ACCEPTED", description: "Notifica Esito — esito ricevuto" };
  }

  // Decorrenza Termini (15 giorni senza risposta → accettata implicitamente)
  if (xml.includes("DecorrenzaTermini") || xml.includes("<TipoRicevuta>DT</TipoRicevuta>") || /DT_\d/.test(xml)) {
    return { sdiStatus: "ACCEPTED", description: "Decorrenza Termini — fattura accettata per decorrenza" };
  }

  // Attestazione trasmissione con impossibilità di recapito
  if (xml.includes("AttestazioneTrasmissione") || xml.includes("<TipoRicevuta>AT</TipoRicevuta>") || /AT_\d/.test(xml)) {
    return { sdiStatus: "DEPOSITED", description: "Attestazione Trasmissione — impossibilità di recapito, depositata" };
  }

  return null;
}

// ─── Main Handler ───────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    console.log(`[sdi-notifications] Rejected ${req.method} request`);
    return new Response("Method not allowed", { status: 405 });
  }

  const startTime = Date.now();

  try {
    const xmlBody = await req.text();
    console.log(`[sdi-notifications] Received notification XML, length: ${xmlBody.length}`);

    if (!xmlBody || xmlBody.length < 50) {
      console.error("[sdi-notifications] Empty or too short XML body");
      return new Response("Bad request", { status: 400 });
    }

    // Estrai l'IdentificativoSdI dalla notifica — è la chiave per trovare la fattura
    const sdiId = getTagValue(xmlBody, "IdentificativoSdI");

    // Prova anche dal NomeFile (formato: IT<PIVA>_<progressivo>)
    const nomeFile = getTagValue(xmlBody, "NomeFile");

    console.log(`[sdi-notifications] SDI ID: ${sdiId}, NomeFile: ${nomeFile}`);

    if (!sdiId && !nomeFile) {
      console.error("[sdi-notifications] Cannot extract IdentificativoSdI or NomeFile from notification");
      // Rispondi 200 per non causare retry
      return new Response("OK (no identifier found)", { status: 200 });
    }

    // Determina il tipo di notifica e lo status da assegnare
    const mapping = mapNotificationType(xmlBody);
    if (!mapping) {
      console.warn("[sdi-notifications] Unknown notification type, logging raw XML");
      console.log("[sdi-notifications] XML preview:", xmlBody.substring(0, 500));
      return new Response("OK (unknown type logged)", { status: 200 });
    }

    console.log(`[sdi-notifications] Type: ${mapping.sdiStatus} — ${mapping.description}`);

    // Connessione Supabase con service role (bypass RLS)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Cerca la fattura per sdi_id
    let query = supabase
      .from("electronic_invoices")
      .select("id, sdi_id, sdi_status, invoice_number, supplier_name")
      .eq("company_id", COMPANY_ID);

    if (sdiId) {
      query = query.eq("sdi_id", sdiId);
    } else if (nomeFile) {
      // Il NomeFile della notifica potrebbe corrispondere a parte del sdi_id
      const cleanName = nomeFile.replace(/\.xml$/i, "");
      query = query.ilike("sdi_id", `%${cleanName}%`);
    }

    const { data: invoices, error: queryError } = await query;

    if (queryError) {
      console.error("[sdi-notifications] DB query error:", queryError);
      return new Response("OK (DB error logged)", { status: 200 });
    }

    if (!invoices || invoices.length === 0) {
      console.warn(`[sdi-notifications] No invoice found for SDI ID: ${sdiId || nomeFile}`);
      // La fattura potrebbe non essere ancora arrivata — logghiamo ma non è un errore
      return new Response("OK (invoice not found)", { status: 200 });
    }

    // Aggiorna lo status di tutte le fatture trovate (di solito 1)
    let updatedCount = 0;
    for (const invoice of invoices) {
      console.log(`[sdi-notifications] Updating invoice ${invoice.id} (${invoice.invoice_number}): ${invoice.sdi_status} → ${mapping.sdiStatus}`);

      const { error: updateError } = await supabase
        .from("electronic_invoices")
        .update({
          sdi_status: mapping.sdiStatus,
          notes: `${mapping.description} — ${new Date().toISOString()}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", invoice.id);

      if (updateError) {
        console.error(`[sdi-notifications] Failed to update invoice ${invoice.id}:`, updateError);
      } else {
        updatedCount++;
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[sdi-notifications] Done: updated ${updatedCount}/${invoices.length} invoices — ${elapsed}ms`);

    return new Response("OK", { status: 200 });

  } catch (error) {
    console.error("[sdi-notifications] Error:", error);
    return new Response("OK (internal error logged)", { status: 200 });
  }
});
