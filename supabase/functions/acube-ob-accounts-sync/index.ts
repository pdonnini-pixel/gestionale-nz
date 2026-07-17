// Edge Function: acube-ob-accounts-sync
// Sincronizza i conti correnti collegati ad un Business Registry: GET /business-registry/{fiscalId}/accounts
// Upsert su `acube_accounts` (chiave: uuid) e su `bank_accounts` (chiave: iban+company_id).
//
// Body:
//   {
//     "stage": "sandbox" | "production",
//     "fiscalId": "07362100484",
//     "companyId": "00000000-0000-0000-0000-000000000001"
//   }
//
// Risposta:
//   { fetched, acube_upserted, bank_upserted, accounts: [{uuid, iban, name, balance}] }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OB_BASE_URL: Record<string, string> = {
  sandbox: "https://ob-sandbox.api.acubeapi.com",
  production: "https://ob.api.acubeapi.com",
};

const ACUBE_LOGIN_URLS: Record<string, string> = {
  sandbox: "https://common-sandbox.api.acubeapi.com/login",
  production: "https://common.api.acubeapi.com/login",
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

async function refreshAcubeJwt(supabase: SupabaseClient, stage: string): Promise<{ jwt?: string; error?: string }> {
  const { data: creds, error: credsErr } = await supabase.rpc("get_acube_credentials", { p_stage: stage });
  if (credsErr || !creds || !creds[0]) return { error: `get_acube_credentials failed: ${credsErr?.message ?? "no row"}` };
  const { email, password } = creds[0] as { email: string; password: string };
  const loginUrl = ACUBE_LOGIN_URLS[stage];
  if (!loginUrl) return { error: `Invalid stage: ${stage}` };
  const resp = await fetch(loginUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!resp.ok) return { error: `A-Cube login HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}` };
  const data = await resp.json() as { token?: string; jwt?: string; access_token?: string; expires_at?: string; expires_in?: number };
  const newJwt = data.token ?? data.jwt ?? data.access_token;
  if (!newJwt) return { error: "A-Cube login response missing token" };
  let expiresAt: string;
  if (data.expires_at) expiresAt = new Date(data.expires_at).toISOString();
  else if (data.expires_in) expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
  else expiresAt = new Date(Date.now() + DEFAULT_TTL_MS).toISOString();
  await supabase.from("acube_tokens").upsert(
    { stage, jwt: newJwt, expires_at: expiresAt, updated_at: new Date().toISOString() },
    { onConflict: "stage" },
  );
  return { jwt: newJwt };
}

async function getCachedJwt(supabase: SupabaseClient, stage: string): Promise<string> {
  const { data } = await supabase.from("acube_tokens").select("jwt, expires_at").eq("stage", stage).maybeSingle();
  if (data?.jwt && data?.expires_at && new Date(data.expires_at as string).getTime() > Date.now() + 60_000) return data.jwt as string;
  const refresh = await refreshAcubeJwt(supabase, stage);
  if (refresh.error || !refresh.jwt) throw new Error(`JWT refresh failed: ${refresh.error}`);
  return refresh.jwt;
}

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
      const roleData = userData.user.app_metadata?.role; // SOLO app_metadata: user_metadata e modificabile dal client (privilege escalation)
      const userRoles: string[] = Array.isArray(roleData) ? roleData : (roleData ? [roleData] : []);
      const allowed = ["super_advisor", "contabile", "cfo"];
      if (!userRoles.some((r) => allowed.includes(r))) return jsonError(403, `Roles [${userRoles.join(", ")}] not allowed.`);
    }

    const body = await req.json().catch(() => ({}));
    const stage: string = body.stage ?? "sandbox";
    const fiscalId: string = (body.fiscalId ?? "").toString().trim();
    const companyId: string = (body.companyId ?? "").toString().trim();
    if (!fiscalId || !companyId) return jsonError(400, "Missing fiscalId or companyId");
    const baseUrl = OB_BASE_URL[stage];
    if (!baseUrl) return jsonError(400, `Invalid stage: ${stage}`);

    const { data: br } = await supabase.from("acube_business_registries").select("uuid").eq("fiscal_id", fiscalId).eq("stage", stage).maybeSingle();
    if (!br) return jsonError(404, `Business Registry locale non trovato per fiscalId=${fiscalId} stage=${stage}`);

    let jwt = await getCachedJwt(supabase, stage);
    const url = `${baseUrl}/business-registry/${encodeURIComponent(fiscalId)}/accounts?itemsPerPage=100&page=1`;
    const doGet = async (j: string) => fetch(url, {
      headers: { Authorization: `Bearer ${j}`, Accept: "application/ld+json" },
    });
    let resp = await doGet(jwt);
    if (resp.status === 401) {
      const r = await refreshAcubeJwt(supabase, stage);
      if (!r.jwt) return jsonError(500, `Refresh fallito: ${r.error}`);
      jwt = r.jwt;
      resp = await doGet(jwt);
    }
    if (!resp.ok) return jsonError(resp.status, `A-Cube accounts HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    const data = await resp.json();
    const items: any[] = data["hydra:member"] ?? data.data ?? data.accounts ?? (Array.isArray(data) ? data : []);

    let acubeUp = 0;
    let bankUp = 0;
    const summary: Array<{ uuid: string; iban: string | null; name: string; balance: number | null }> = [];

    for (const acc of items) {
      const uuid: string = acc.uuid ?? acc.id;
      if (!uuid) continue;
      const iban: string | null = acc.iban ?? acc.IBAN ?? null;
      const name: string = acc.name ?? acc.title ?? iban ?? "Conto";
      const balance: number | null = acc.balance != null ? Number(acc.balance) : null;
      const enabled: boolean = acc.enabled ?? true;
      const currency: string = (acc.currencyCode ?? acc.currency_code ?? "EUR").toUpperCase();

      const { error: ae } = await supabase.from("acube_accounts").upsert({
        uuid,
        business_registry_uuid: (br as { uuid: string }).uuid,
        account_id: acc.account_id ?? acc.providerAccountId ?? uuid,
        account_number: acc.accountNumber ?? acc.account_number ?? null,
        iban,
        bban: acc.bban ?? null,
        swift: acc.swift ?? null,
        name,
        nature: acc.nature ?? "ACCOUNT",
        provider_name: acc.providerName ?? acc.provider_name ?? "Unknown",
        provider_country: acc.providerCountry ?? acc.provider_country ?? "IT",
        currency_code: currency,
        balance,
        enabled,
        connection_id: acc.connectionId ?? acc.connection_id ?? null,
        consent_expires_at: acc.consentExpiresAt ?? acc.consent_expires_at ?? null,
        systems: acc.systems ?? null,
        extra: acc,
        updated_at: new Date().toISOString(),
      }, { onConflict: "uuid" });
      if (!ae) acubeUp++;

      // Upsert in bank_accounts: chiave (company_id, iban) se IBAN noto, altrimenti (company_id, acube_account_uuid)
      const existingQ = supabase.from("bank_accounts").select("id").eq("company_id", companyId);
      const { data: existing } = iban
        ? await existingQ.eq("iban", iban).maybeSingle()
        : await existingQ.eq("acube_account_uuid", uuid).maybeSingle();

      const bankPayload: Record<string, unknown> = {
        company_id: companyId,
        bank_name: acc.providerName ?? acc.provider_name ?? "Banca",
        iban,
        account_name: name,
        account_type: "conto_corrente",
        currency,
        is_active: enabled,
        is_manual: false,
        current_balance: balance,
        balance_updated_at: new Date().toISOString(),
        acube_account_uuid: uuid,
        updated_at: new Date().toISOString(),
      };
      if (existing) {
        await supabase.from("bank_accounts").update(bankPayload).eq("id", (existing as { id: string }).id);
      } else {
        await supabase.from("bank_accounts").insert(bankPayload);
      }
      bankUp++;
      summary.push({ uuid, iban, name, balance });
    }

    // Aggiorna consent: granted_at = ora se prima richiesta riuscita
    await supabase.from("acube_consents").update({ status: "granted", granted_at: new Date().toISOString() })
      .eq("business_registry_uuid", (br as { uuid: string }).uuid).eq("status", "pending");

    return jsonOk({ fetched: items.length, acube_upserted: acubeUp, bank_upserted: bankUp, accounts: summary });
  } catch (e) {
    return jsonError(500, `Internal error: ${e instanceof Error ? e.message : String(e)}`);
  }
});

function jsonOk(p: unknown): Response { return new Response(JSON.stringify(p), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function jsonError(status: number, message: string): Response { return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
