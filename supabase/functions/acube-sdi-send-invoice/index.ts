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
      const roleData = userData.user.app_metadata?.role ?? userData.user.user_metadata?.role;
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

    // Recupera company corrente (cedente)
    const { data: company } = await supabase.from("companies").select("name, vat_number, fiscal_code").limit(1).maybeSingle();
    if (!company?.vat_number) return jsonError(500, "Company vat_number not configured");

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
            id_fiscale_iva: { id_paese: "IT", id_codice: company.vat_number },
            anagrafica: { denominazione: company.name },
            regime_fiscale: "RF01",
          },
          sede: { indirizzo: "—", cap: "00000", comune: "—", provincia: "—", nazione: "IT" },
        },
        cessionario_committente: {
          dati_anagrafici: {
            id_fiscale_iva: { id_paese: "IT", id_codice: body.cessionario.fiscal_id },
            anagrafica: { denominazione: body.cessionario.name },
          },
          sede: {
            indirizzo: body.cessionario.address?.street ?? "—",
            cap: body.cessionario.address?.zip ?? "00000",
            comune: body.cessionario.address?.city ?? "—",
            provincia: body.cessionario.address?.province ?? "—",
            nazione: body.cessionario.address?.country ?? "IT",
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
      business_fiscal_id: company.vat_number,
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
      sender_vat: company.vat_number,
      sender_name: company.name,
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
