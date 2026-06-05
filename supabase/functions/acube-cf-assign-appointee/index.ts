// Edge Function: acube-cf-assign-appointee
//
// Assegna la BusinessRegistryConfiguration (BRC) di un tenant a un Appointee
// sul Cassetto Fiscale A-Cube. Modello di default: PROXY / DELEGA UNIFICATA,
// in cui l'appointee e' la stessa A-Cube (appointee_fiscal_id = "A-CUBE").
//
// Flusso (verificato su OpenAPI gov-it + esecuzione production 2026-06-01):
//   1. Verifica che esista la BRC su it.api:
//        GET  /business-registry-configurations?fiscal_id={piva}
//      Se non esiste, la crea:
//        POST /business-registry-configurations
//        body: { fiscal_id, name, receipts_enabled: true }
//      (receipts_enabled=true e' PREREQUISITO documentato per l'assign).
//   2. Assegna la BRC all'appointee:
//        POST /ade-appointees/{appointee_fiscal_id}/assign
//        body schema AdeAppointee.AdeAppointeeAssignInput-write:
//          - fiscal_id          (REQUIRED) = P.IVA della BRC (il tenant)
//          - proxying_fiscal_id (OPZIONALE) = CF persona fisica SOLO se la BRC
//                                 e' di un lavoratore autonomo / ditta individuale.
//                                 Per una SOCIETA' va OMESSO.
//      L'API risponde 202 Accepted: l'assegnamento e' preso in carico ma la
//      delega va ancora ACCETTATA dal legale rappresentante via PEC. Solo dopo
//      l'accettazione lo stato diventa operativo ('active').
//
// Prerequisito lato cliente: il legale rappr. ha gia' completato la nomina/delega
// sul portale AdE (Fisconline). Senza, l'assign puo' restare in attesa o fallire.
//
// Doc: https://docs.acubeapi.com/documentation/italy/gov-it/cassettofiscale
//
// Body input edge function:
//   { tenantFiscalId, companyId, stage?, appointeeFiscalId?, proxyingFiscalId?,
//     businessName?, businessRegistryUuid? }
//   - appointeeFiscalId default = "A-CUBE"
//   - stage default = "sandbox"
// Auth: super_advisor (JWT utente) OPPURE service_role (cron/operatore).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const IT_BASE_URL: Record<string, string> = {
  sandbox: "https://it-sandbox.api.acubeapi.com",
  production: "https://it.api.acubeapi.com",
};

const ACUBE_LOGIN_URLS: Record<string, string> = {
  sandbox: "https://common-sandbox.api.acubeapi.com/login",
  production: "https://common.api.acubeapi.com/login",
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

async function refreshAcubeJwt(supabase: SupabaseClient, stage: string): Promise<{ jwt?: string; error?: string }> {
  const { data: creds, error: credsErr } = await supabase.rpc("get_acube_credentials", { p_stage: stage });
  if (credsErr || !creds || !creds[0]) return { error: `get_acube_credentials: ${credsErr?.message ?? "no row"}` };
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

// Verifica che la BRC esista su it.api; se manca la crea con receipts_enabled=true
// (prerequisito documentato per l'assign all'appointee).
async function ensureBrc(
  baseUrl: string,
  jwt: string,
  fiscalId: string,
  businessName: string | null,
): Promise<{ created: boolean; status: number; raw: unknown }> {
  const listResp = await fetch(
    `${baseUrl}/business-registry-configurations?fiscal_id=${encodeURIComponent(fiscalId)}`,
    { headers: { Authorization: `Bearer ${jwt}`, Accept: "application/ld+json" } },
  );
  if (listResp.ok) {
    const listData = await listResp.json().catch(() => ({}));
    const total = listData["hydra:totalItems"] ?? (Array.isArray(listData["hydra:member"]) ? listData["hydra:member"].length : 0);
    if (total > 0) return { created: false, status: listResp.status, raw: listData["hydra:member"]?.[0] ?? null };
  }
  // Non esiste (o list non ha trovato): crea la BRC
  const createResp = await fetch(`${baseUrl}/business-registry-configurations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", Accept: "application/ld+json" },
    body: JSON.stringify({ fiscal_id: fiscalId, name: businessName ?? undefined, receipts_enabled: true }),
  });
  const txt = await createResp.text();
  let raw: unknown = null;
  try { raw = JSON.parse(txt); } catch { raw = txt.slice(0, 500); }
  if (!createResp.ok) throw new Error(`BRC create HTTP ${createResp.status}: ${txt.slice(0, 300)}`);
  return { created: true, status: createResp.status, raw };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth super_advisor o service_role
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return jsonError(401, "Missing authorization");
    const isServiceRole = token === supabaseServiceKey;
    let userId: string | null = null;
    if (!isServiceRole) {
      const { data: userData, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !userData?.user) return jsonError(401, "Invalid JWT");
      const roleData = userData.user.app_metadata?.role ?? userData.user.user_metadata?.role;
      const userRoles: string[] = Array.isArray(roleData) ? roleData : (roleData ? [roleData] : []);
      if (!userRoles.includes("super_advisor")) return jsonError(403, `Solo super_advisor (ruoli: ${userRoles.join(", ")})`);
      userId = userData.user.id;
    }

    const body = await req.json().catch(() => ({}));
    const tenantFiscalId: string = (body.tenantFiscalId ?? "").toString().trim();
    const companyId: string = (body.companyId ?? "").toString().trim();
    const stage: string = (body.stage ?? "sandbox").toString();
    // Default: modello proxy / delega unificata -> appointee = "A-CUBE"
    const appointeeFiscalId: string = (body.appointeeFiscalId ?? "A-CUBE").toString().trim();
    // Solo per ditte individuali / lavoratori autonomi (BRC self-employed):
    const proxyingFiscalId: string = (body.proxyingFiscalId ?? "").toString().trim();
    const businessNameInput: string = (body.businessName ?? "").toString().trim();

    if (!tenantFiscalId || !companyId) {
      return jsonError(400, "Missing tenantFiscalId or companyId");
    }
    const baseUrl = IT_BASE_URL[stage];
    if (!baseUrl) return jsonError(400, `Invalid stage: ${stage}`);

    // Recupero la business registry locale (OB) per nome + uuid da salvare in config.
    const { data: brData } = await supabase
      .from("acube_business_registries")
      .select("uuid, fiscal_id, business_name")
      .eq("fiscal_id", tenantFiscalId)
      .eq("stage", stage)
      .maybeSingle();
    const businessName = businessNameInput || (brData as { business_name?: string } | null)?.business_name || null;
    const businessRegistryUuid: string =
      (body.businessRegistryUuid ?? (brData as { uuid?: string } | null)?.uuid ?? tenantFiscalId).toString();

    let jwt = await getCachedJwt(supabase, stage);

    // STEP 1 — assicura la BRC su it.api (verifica, e se manca la crea)
    let brcInfo: { created: boolean; status: number; raw: unknown };
    try {
      brcInfo = await ensureBrc(baseUrl, jwt, tenantFiscalId, businessName);
    } catch (e) {
      // 401 -> refresh e ritento una volta
      if (String(e).includes("HTTP 401")) {
        const r = await refreshAcubeJwt(supabase, stage);
        if (!r.jwt) return jsonError(500, `Refresh fallito: ${r.error}`);
        jwt = r.jwt;
        brcInfo = await ensureBrc(baseUrl, jwt, tenantFiscalId, businessName);
      } else {
        return jsonError(502, `Errore ensure BRC: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // STEP 2 — assign all'appointee
    const assignUrl = `${baseUrl}/ade-appointees/${encodeURIComponent(appointeeFiscalId)}/assign`;
    // Per SOCIETA': solo fiscal_id. Per self-employed: anche proxying_fiscal_id.
    const assignBody: Record<string, string> = { fiscal_id: tenantFiscalId };
    if (proxyingFiscalId) assignBody.proxying_fiscal_id = proxyingFiscalId;

    const doPost = async (j: string) => fetch(assignUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${j}`, "Content-Type": "application/json", Accept: "application/ld+json" },
      body: JSON.stringify(assignBody),
    });

    let resp = await doPost(jwt);
    if (resp.status === 401) {
      const r = await refreshAcubeJwt(supabase, stage);
      if (!r.jwt) return jsonError(500, `Refresh fallito: ${r.error}`);
      jwt = r.jwt;
      resp = await doPost(jwt);
    }

    const respText = await resp.text();
    let respJson: unknown = null;
    try { respJson = respText ? JSON.parse(respText) : null; } catch { /* ignore */ }

    // Mappa stato:
    //  202/200/201 = assign accettato, ma delega DA ACCETTARE via PEC dal legale rappr.
    //                -> 'awaiting_client_appointment' (fail-safe: blocca il sync finche' non e' attivo)
    //  403         = manca il ruolo per l'assign (da chiedere ad A-Cube) -> 'error'
    //  altri 4xx   = legale rappr. non ha completato la nomina su AdE   -> 'awaiting_client_appointment'
    const accepted = resp.status >= 200 && resp.status < 300;
    const status = accepted
      ? "awaiting_client_appointment"
      : (resp.status === 403 ? "error" : "awaiting_client_appointment");

    const configPatch = {
      company_id: companyId,
      business_registry_uuid: businessRegistryUuid,
      fiscal_id: tenantFiscalId,
      stage,
      appointee_fiscal_id: appointeeFiscalId,
      appointee_assigned_at: accepted ? new Date().toISOString() : null,
      appointee_assigned_by_user_id: userId,
      status,
      error_message: accepted ? null : `HTTP ${resp.status}: ${respText.slice(0, 500)}`,
      last_status_check_at: new Date().toISOString(),
      notes: `assign appointee=${appointeeFiscalId} HTTP ${resp.status}; BRC ${brcInfo.created ? "creata" : "gia' esistente"} (HTTP ${brcInfo.status}).`,
    };

    const { error: upErr } = await supabase
      .from("acube_cassetto_fiscale_config" as never)
      .upsert(configPatch as never, { onConflict: "company_id,business_registry_uuid,stage" } as never);
    if (upErr) console.warn("upsert config failed", upErr.message);

    if (resp.status === 403) {
      // NON forzare: manca il ruolo per l'assign sul profilo A-Cube del tenant.
      return jsonOk({
        ok: false,
        status_code: 403,
        status,
        brc_created: brcInfo.created,
        message: `Assign 403 Forbidden: manca il ruolo per l'assign sul profilo A-Cube. Richiedere ad A-Cube l'abilitazione del ruolo di assegnamento appointee per ${tenantFiscalId}.`,
        raw: respJson ?? respText.slice(0, 300),
      });
    }

    if (!accepted) {
      return jsonOk({
        ok: false,
        status_code: resp.status,
        status,
        brc_created: brcInfo.created,
        message: `Assign HTTP ${resp.status}. Verificare che il legale rappresentante di ${tenantFiscalId} abbia completato la nomina/delega su AdE Fisconline.`,
        raw: respJson ?? respText.slice(0, 300),
      });
    }

    return jsonOk({
      ok: true,
      status_code: resp.status,
      status,
      brc_created: brcInfo.created,
      message: `Assign appointee ${appointeeFiscalId} accettato (HTTP ${resp.status}) per BRC ${tenantFiscalId} (${stage}). Ora il legale rappresentante deve ACCETTARE la delega via PEC; dopo l'accettazione il Cassetto Fiscale e' operativo.`,
      raw: respJson,
    });
  } catch (e) {
    return jsonError(500, `Internal: ${e instanceof Error ? e.message : String(e)}`);
  }
});

function jsonOk(p: unknown): Response { return new Response(JSON.stringify(p), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function jsonError(status: number, message: string): Response { return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
