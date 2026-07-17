// Edge Function: acube-sdi-send-invoice
// Emette una fattura attiva via A-Cube SDI (POST /invoices) e salva in acube_sdi_invoices.
// Il trigger DB poi sincronizza in electronic_invoices automaticamente.
//
// Auth: super_advisor (Lilian) o contabile authenticated.
//
// Body atteso:
//   {
//     stage: "sandbox" | "production",  // default sandbox
//     cessionario: {
//       fiscal_id: "12345678901",
//       name: "Cliente SRL",
//       address: { street, city, province, zip, country }
//     },
//     invoice: {
//       number: "ATT-2026-XXX",
//       date: "2026-05-15",
//       document_type: "TD01",
//       currency: "EUR",
//       lines: [{ description, quantity?, unit_price, vat_rate }]
//     }
//   }
//
// Risposta:
//   { acube_uuid, sdi_file_id, marking, total }
//
// Prerequisito: company_settings con sede legale strutturata (migration 105):
// sede_indirizzo, sede_cap, sede_comune, sede_provincia (+ regime_fiscale).
// Senza sede configurata → 400 (mai indirizzi di default su fatture fiscali).
// Anti-doppia-emissione: stesso invoice_number gia' presente in
// acube_sdi_invoices (direction=active, stesso sender_vat) → 409.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SDI_INVOICES_URL: Record<string, string> = {
  sandbox: "https://api-sandbox.acubeapi.com/invoices",
  production: "https://api.acubeapi.com/invoices",
};

interface InvoiceLine {
  description: string;
  quantity?: number;
  unit_price: number;
  vat_rate: number;
}

interface RequestBody {
  stage?: "sandbox" | "production";
  cessionario: {
    fiscal_id: string;
    name: string;
    address?: { street?: string; city?: string; province?: string; zip?: string; country?: string };
  };
  invoice: {
    number: string;
    date: string;
    document_type?: string;
    currency?: string;
    lines: InvoiceLine[];
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth: solo super_advisor o contabile authenticated
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return jsonError(401, "Missing authorization");

    const isServiceRole = token === supabaseServiceKey;
    if (!isServiceRole) {
      const { data: userData, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !userData?.user) return jsonError(401, "Invalid JWT");
      // role può essere stringa O array (es. ["super_advisor", "budget_approver"])
      const roleData = userData.user.app_metadata?.role; // SOLO app_metadata: user_metadata e modificabile dal client (privilege escalation)
      const userRoles: string[] = Array.isArray(roleData) ? roleData : (roleData ? [roleData] : []);
      const allowedRoles = ["super_advisor", "contabile", "cfo"];
      if (!userRoles.some((r) => allowedRoles.includes(r))) {
        return jsonError(403, `Roles [${userRoles.join(", ")}] not allowed. Required one of: ${allowedRoles.join(", ")}`);
      }
    }

    const body = (await req.json()) as RequestBody;
    if (!body?.cessionario?.fiscal_id || !body?.invoice?.number || !body?.invoice?.date || !body?.invoice?.lines?.length) {
      return jsonError(400, "Missing required fields: cessionario.fiscal_id, invoice.number, invoice.date, invoice.lines");
    }

    const stage = body.stage ?? "sandbox";

    // Recupera company corrente (cedente) — dati SEMPRE dal tenant attivo, mai hardcoded
    const { data: company } = await supabase.from("companies").select("name, vat_number, fiscal_code").limit(1).maybeSingle();
    if (!company?.vat_number) return jsonError(500, "Company vat_number not configured");
    const senderVat = String(company.vat_number).replace(/\s/g, "").replace(/^IT/i, "");
    // 11 cifre esatte: un segnaposto (es. '07XXXXXXXXX') non deve mai finire su una fattura fiscale
    if (!/^\d{11}$/.test(senderVat)) {
      return jsonError(400, `companies.vat_number non valida ('${company.vat_number}'): attese 11 cifre. Correggere l'anagrafica prima di emettere fatture.`);
    }

    // Anagrafica estesa: ragione sociale, sede legale strutturata e regime fiscale
    // (migration 105). La sede e' OBBLIGATORIA: su una fattura fiscale un indirizzo
    // di default inventato non e' accettabile.
    const { data: cs } = await supabase
      .from("company_settings")
      .select("ragione_sociale, sede_indirizzo, sede_cap, sede_comune, sede_provincia, regime_fiscale")
      .limit(1)
      .maybeSingle();
    const sedeIndirizzo = cs?.sede_indirizzo?.trim();
    const sedeCap = cs?.sede_cap?.trim();
    const sedeComune = cs?.sede_comune?.trim();
    const sedeProvincia = cs?.sede_provincia?.trim()?.toUpperCase();
    if (!sedeIndirizzo || !sedeCap || !sedeComune || !sedeProvincia) {
      return jsonError(400, "Sede legale del cedente non configurata (company_settings.sede_indirizzo/sede_cap/sede_comune/sede_provincia). Completare l'anagrafica azienda prima di emettere fatture.");
    }
    const cedenteDenominazione = cs?.ragione_sociale?.trim() || company.name;
    const regimeFiscale = cs?.regime_fiscale?.trim() || "RF01";

    // Guardia anti-doppia-emissione: stesso numero fattura attiva gia' inviato
    // (retry di rete, doppio click) → 409, mai una seconda emissione a SDI.
    const { data: dup } = await supabase
      .from("acube_sdi_invoices")
      .select("acube_uuid, marking")
      .eq("direction", "active")
      .eq("sender_vat", senderVat)
      .eq("invoice_number", body.invoice.number)
      .limit(1)
      .maybeSingle();
    if (dup) {
      return jsonError(409, `Fattura ${body.invoice.number} gia' emessa via SDI (uuid ${dup.acube_uuid}, stato ${dup.marking ?? "n/d"}). Doppia emissione bloccata: usare un nuovo numero fattura.`);
    }

    // Recupera JWT A-Cube cachato
    const { data: tokenRow } = await supabase.from("acube_tokens").select("jwt").eq("stage", stage).maybeSingle();
    if (!tokenRow?.jwt) return jsonError(500, `No A-Cube JWT cached for stage=${stage}. Call acube-login first.`);

    // Calcola totali
    const lineRiepilogo: Record<string, { imponibile: number; imposta: number }> = {};
    let totalDocument = 0;
    const dettaglioLinee = body.invoice.lines.map((l, idx) => {
      const qty = l.quantity ?? 1;
      const lineTotal = +(qty * l.unit_price).toFixed(2);
      const vatAmount = +(lineTotal * l.vat_rate / 100).toFixed(2);
      totalDocument += lineTotal + vatAmount;
      const key = String(l.vat_rate);
      lineRiepilogo[key] = lineRiepilogo[key] ?? { imponibile: 0, imposta: 0 };
      lineRiepilogo[key].imponibile += lineTotal;
      lineRiepilogo[key].imposta += vatAmount;
      return {
        numero_linea: idx + 1,
        descrizione: l.description,
        ...(l.quantity !== undefined ? { quantita: qty.toFixed(2) } : {}),
        prezzo_unitario: l.unit_price.toFixed(2),
        prezzo_totale: lineTotal.toFixed(2),
        aliquota_iva: l.vat_rate.toFixed(2),
      };
    });

    const datiRiepilogo = Object.entries(lineRiepilogo).map(([rate, v]) => ({
      aliquota_iva: parseFloat(rate).toFixed(2),
      imponibile_importo: v.imponibile.toFixed(2),
      imposta: v.imposta.toFixed(2),
    }));

    const payload = {
      fattura_elettronica_header: {
        dati_trasmissione: { codice_destinatario: "0000000" },
        cedente_prestatore: {
          dati_anagrafici: {
            id_fiscale_iva: { id_paese: "IT", id_codice: senderVat },
            anagrafica: { denominazione: cedenteDenominazione },
            regime_fiscale: regimeFiscale,
          },
          // Sede cedente: SEMPRE dall'anagrafica del tenant (provincia 2 char per A-Cube)
          sede: {
            indirizzo: sedeIndirizzo,
            cap: sedeCap,
            comune: sedeComune,
            provincia: sedeProvincia.slice(0, 2),
            nazione: "IT",
          },
        },
        cessionario_committente: {
          dati_anagrafici: {
            id_fiscale_iva: { id_paese: "IT", id_codice: body.cessionario.fiscal_id },
            anagrafica: { denominazione: body.cessionario.name },
          },
          // Sede cessionario: defaults validi (provincia 2 char obbligatoria, comune non vuoto)
          sede: {
            indirizzo: body.cessionario.address?.street?.trim() || "Indirizzo non specificato",
            cap: body.cessionario.address?.zip?.trim() || "20100",
            comune: body.cessionario.address?.city?.trim() || "Milano",
            provincia: (body.cessionario.address?.province?.trim().toUpperCase() || "MI").slice(0, 2),
            nazione: body.cessionario.address?.country?.trim() || "IT",
          },
        },
      },
      fattura_elettronica_body: [{
        dati_generali: {
          dati_generali_documento: {
            tipo_documento: body.invoice.document_type ?? "TD01",
            divisa: body.invoice.currency ?? "EUR",
            data: body.invoice.date,
            numero: body.invoice.number,
            importo_totale_documento: totalDocument.toFixed(2),
          },
        },
        dati_beni_servizi: { dettaglio_linee: dettaglioLinee, dati_riepilogo: datiRiepilogo },
      }],
    };

    const acubeResp = await fetch(SDI_INVOICES_URL[stage], {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${tokenRow.jwt}`,
      },
      body: JSON.stringify(payload),
    });

    const acubeBody = await acubeResp.text();
    if (acubeResp.status >= 300 && acubeResp.status !== 201 && acubeResp.status !== 202) {
      return jsonError(acubeResp.status, `A-Cube /invoices failed: ${acubeBody.slice(0, 600)}`);
    }

    let acubeData: { uuid?: string } = {};
    try { acubeData = JSON.parse(acubeBody); } catch { /* */ }

    if (!acubeData.uuid) {
      return jsonError(502, `A-Cube response missing uuid. Body: ${acubeBody.slice(0, 300)}`);
    }

    // Polling: dopo POST, recupero il dettaglio per avere sdi_file_id e marking
    const detailResp = await fetch(`${SDI_INVOICES_URL[stage]}/${acubeData.uuid}`, {
      headers: { Authorization: `Bearer ${tokenRow.jwt}`, Accept: "application/json" },
    });
    const detail = await detailResp.json();

    // INSERT in acube_sdi_invoices (trigger DB poi popola electronic_invoices)
    const { error: insErr } = await supabase.from("acube_sdi_invoices").insert({
      acube_uuid: acubeData.uuid,
      business_fiscal_id: senderVat,
      direction: "active",
      type: detail.type,
      marking: detail.marking ?? "sent",
      sdi_file_id: detail.sdi_file_id,
      sdi_file_name: detail.sdi_file_name,
      transmission_format: detail.transmission_format,
      document_type: body.invoice.document_type ?? "TD01",
      invoice_number: body.invoice.number,
      invoice_date: body.invoice.date,
      currency: body.invoice.currency ?? "EUR",
      total_amount: totalDocument,
      to_pa: false,
      sender_vat: senderVat,
      sender_name: cedenteDenominazione,
      recipient_vat: body.cessionario.fiscal_id,
      recipient_name: body.cessionario.name,
      recipient_code: "0000000",
      payload: detail.payload ? JSON.parse(detail.payload) : payload,
      acube_created_at: detail.created_at,
    });

    if (insErr) {
      console.warn("acube_sdi_invoices insert failed:", insErr.message);
    }

    return jsonOk({
      acube_uuid: acubeData.uuid,
      sdi_file_id: detail.sdi_file_id,
      marking: detail.marking ?? "sent",
      total: totalDocument,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonError(500, `Internal error: ${msg}`);
  }
});

function jsonOk(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
