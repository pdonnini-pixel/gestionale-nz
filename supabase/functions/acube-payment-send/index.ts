// Edge Function: acube-payment-send
// Lancia i pagamenti SEPA outbound di una distinta (payment_batch) via A-Cube.
// Pattern PSD2: 1 chiamata per item → A-Cube ritorna URL autorizzazione → utente conferma sulla banca.
// Webhook payment success aggiorna stato (handler separato).
//
// Auth: super_advisor o cfo authenticated.
//
// Body atteso:
//   {
//     batch_id: "<uuid>",
//     stage?: "sandbox" | "production"   // default sandbox
//   }
//
// Risposta:
//   {
//     batch_id, total_items, initiated, failed,
//     items: [{ item_id, payable_id, amount, beneficiary,
//               acube_payment_uuid?, acube_authorize_url?, error? }]
//   }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OB_BASE_URL: Record<string, string> = {
  sandbox: "https://ob-sandbox.api.acubeapi.com",
  production: "https://ob.api.acubeapi.com",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return jsonError(401, "Missing authorization");

    const isServiceRole = token === supabaseServiceKey;
    if (!isServiceRole) {
      const { data: userData, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !userData?.user) return jsonError(401, "Invalid JWT");
      const roleData = userData.user.app_metadata?.role ?? userData.user.user_metadata?.role;
      const userRoles: string[] = Array.isArray(roleData) ? roleData : (roleData ? [roleData] : []);
      const allowedRoles = ["super_advisor", "cfo"];
      if (!userRoles.some((r) => allowedRoles.includes(r))) {
        return jsonError(403, `Roles [${userRoles.join(", ")}] not allowed. Required one of: ${allowedRoles.join(", ")}`);
      }
    }

    const body = await req.json() as { batch_id?: string; stage?: string };
    if (!body?.batch_id) return jsonError(400, "Missing batch_id");

    const stage = body.stage ?? "sandbox";

    // 1. Recupera batch + items + bank_account sorgente
    const { data: batch, error: batchErr } = await supabase
      .from("payment_batches")
      .select(`
        id, batch_number, status, bank_account_id, total_amount,
        bank_accounts!inner(id, bank_name, iban, acube_account_uuid)
      `)
      .eq("id", body.batch_id)
      .maybeSingle();
    if (batchErr || !batch) return jsonError(404, `Batch not found: ${batchErr?.message ?? "no row"}`);

    const ba = (batch as Record<string, unknown>).bank_accounts as { acube_account_uuid?: string } | null;
    if (!ba?.acube_account_uuid) {
      return jsonError(400, "Bank account sorgente non collegato ad A-Cube. Distinta richiede conto A-Cube come sorgente.");
    }

    // 2. Recupera business_registry da bank_account → acube_accounts
    const { data: acubeAccount } = await supabase
      .from("acube_accounts")
      .select("uuid, account_id, business_registry_uuid, business_registries:acube_business_registries!inner(fiscal_id)")
      .eq("uuid", ba.acube_account_uuid)
      .maybeSingle();
    if (!acubeAccount) return jsonError(500, "A-Cube account non trovato in DB");
    const fiscalId = (acubeAccount as { business_registries?: { fiscal_id?: string } }).business_registries?.fiscal_id;
    if (!fiscalId) return jsonError(500, "fiscal_id Business Registry mancante");

    // 3. Recupera items pending
    const { data: items, error: itemsErr } = await supabase
      .from("payment_batch_items")
      .select("id, payable_id, beneficiary_name, beneficiary_iban, amount, currency, payment_reason, status")
      .eq("batch_id", body.batch_id)
      .in("status", ["pending", "draft"])
      .is("acube_payment_uuid", null);
    if (itemsErr) return jsonError(500, `Items query error: ${itemsErr.message}`);
    if (!items || items.length === 0) return jsonError(400, "Nessun item pending nella distinta");

    // 4. Recupera JWT A-Cube cachato
    const { data: tokenRow } = await supabase.from("acube_tokens").select("jwt").eq("stage", stage).maybeSingle();
    if (!tokenRow?.jwt) return jsonError(500, `No A-Cube JWT cached for stage=${stage}. Call acube-login first.`);

    // 5. Per ogni item, POST /payments/send/sepa
    const results: Array<Record<string, unknown>> = [];
    let initiated = 0;
    let failed = 0;

    for (const item of items as Array<Record<string, string | number>>) {
      const itemId = item.id as string;
      const beneficiaryIban = (item.beneficiary_iban as string)?.trim();
      const beneficiaryName = (item.beneficiary_name as string)?.trim();
      const amount = Number(item.amount);

      if (!beneficiaryIban) {
        results.push({ item_id: itemId, error: "Manca IBAN beneficiario" });
        failed++;
        continue;
      }

      // Body A-Cube /payments/send/sepa (best-effort schema, da verificare con doc)
      const payload = {
        accountId: (acubeAccount as { account_id?: string }).account_id,
        amount: amount.toFixed(2),
        currency: item.currency ?? "EUR",
        creditorName: beneficiaryName,
        creditorIban: beneficiaryIban,
        remittanceInformation: (item.payment_reason as string) ?? `Pag. distinta ${batch.batch_number}`,
        returnUrl: "https://gestionale-nz.netlify.app/scadenzario?from=acube_payment",
      };

      const resp = await fetch(
        `${OB_BASE_URL[stage]}/business-registry/${fiscalId}/payments/send/sepa`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${tokenRow.jwt}`,
          },
          body: JSON.stringify(payload),
        },
      );

      const respBody = await resp.text();
      let respJson: Record<string, unknown> = {};
      try { respJson = JSON.parse(respBody); } catch { /* */ }

      if (resp.status >= 200 && resp.status < 300 && respJson.uuid) {
        const acubePaymentUuid = respJson.uuid as string;
        const acubeAuthorizeUrl = (respJson.authorizeUrl ?? respJson.authUrl ?? respJson.url) as string | undefined;

        await supabase.from("payment_batch_items").update({
          acube_payment_uuid: acubePaymentUuid,
          acube_authorize_url: acubeAuthorizeUrl,
          acube_status: "initiated",
          acube_payment_provider: "acube_sepa",
          status: "processing",
        }).eq("id", itemId);

        results.push({
          item_id: itemId,
          payable_id: item.payable_id,
          amount,
          beneficiary: beneficiaryName,
          acube_payment_uuid: acubePaymentUuid,
          acube_authorize_url: acubeAuthorizeUrl,
        });
        initiated++;
      } else {
        const errMsg = (respJson.detail as string) ?? (respJson.message as string) ?? respBody.slice(0, 300);
        await supabase.from("payment_batch_items").update({
          acube_status: "failed",
          execution_notes: errMsg,
        }).eq("id", itemId);

        results.push({ item_id: itemId, error: `${resp.status}: ${errMsg}` });
        failed++;
      }
    }

    // Aggiorna stato distinta
    await supabase.from("payment_batches").update({
      status: failed === 0 ? "processing" : "partial_error",
      acube_initiated_at: new Date().toISOString(),
    }).eq("id", body.batch_id);

    return jsonOk({
      batch_id: body.batch_id,
      total_items: items.length,
      initiated,
      failed,
      items: results,
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
