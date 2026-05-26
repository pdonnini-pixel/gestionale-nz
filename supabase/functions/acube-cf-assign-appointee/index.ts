// Edge Function: acube-cf-assign-appointee
//
// Assegna un Business Registry Configuration (BRC) di un tenant all'Appointee
// EPPI (persona fisica Patrizio Donnini) sulla piattaforma A-Cube.
// Prerequisito: il legale rappresentante del tenant deve aver gia' nominato
// Patrizio come Appointee su Fisconline AdE (azione manuale, una tantum).
//
// Doc: https://docs.acubeapi.com/documentation/italy/gov-it/cassettofiscale
// Endpoint A-Cube: POST /business-registry-configurations/{fiscal_id}/appointee
//
// Body: { tenantFiscalId, appointeeFiscalId, stage?: 'sandbox'|'production' }
// Auth: solo super_advisor

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth super_advisor
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
    const appointeeFiscalId: string = (body.appointeeFiscalId ?? "").toString().trim();
    const stage: string = (body.stage ?? "sandbox").toString();
    const companyId: string = (body.companyId ?? "").toString().trim();

    if (!tenantFiscalId || !appointeeFiscalId || !companyId) {
      return jsonError(400, "Missing tenantFiscalId, appointeeFiscalId or companyId");
    }
    const baseUrl = IT_BASE_URL[stage];
    if (!baseUrl) return jsonError(400, `Invalid stage: ${stage}`);

    // Carico BRC esistente (creato in setup OB o SDI)
    const { data: brData } = await supabase
      .from("acube_business_registries")
      .select("uuid, fiscal_id, business_name")
      .eq("fiscal_id", tenantFiscalId)
      .eq("stage", stage)
      .maybeSingle();
    if (!brData) return jsonError(404, `Business Registry per ${tenantFiscalId} stage=${stage} non trovato. Crearlo prima via acube-ob-br-upsert.`);

    let jwt = await getCachedJwt(supabase, stage);

    // POST /business-registry-configurations/{fiscal_id}/appointee con body {fiscal_id: appointee_cf}
    const assignUrl = `${baseUrl}/business-registry-configurations/${encodeURIComponent(tenantFiscalId)}/appointee`;
    const doPost = async (j: string) => fetch(assignUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${j}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ fiscal_id: appointeeFiscalId }),
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
    try { respJson = JSON.parse(respText); } catch { /* ignore */ }

    // Upsert su acube_cassetto_fiscale_config
    const configPatch = {
      company_id: companyId,
      business_registry_uuid: (brData as { uuid: string }).uuid,
      fiscal_id: tenantFiscalId,
      stage,
      appointee_fiscal_id: appointeeFiscalId,
      appointee_assigned_at: new Date().toISOString(),
      appointee_assigned_by_user_id: userId,
      status: resp.ok ? "active" : (resp.status === 409 || resp.status === 422 ? "awaiting_client_appointment" : "error"),
      error_message: resp.ok ? null : `HTTP ${resp.status}: ${respText.slice(0, 500)}`,
      last_status_check_at: new Date().toISOString(),
    };

    const { error: upErr } = await supabase
      .from("acube_cassetto_fiscale_config" as never)
      .upsert(configPatch as never, { onConflict: "company_id,business_registry_uuid,stage" } as never);
    if (upErr) console.warn("upsert config failed", upErr.message);

    if (!resp.ok) {
      // 4xx = legale rappresentante non ha ancora nominato Appointee su AdE,
      // oppure CF Appointee sbagliato. Restituiamo dettagli per UI.
      return jsonOk({
        ok: false,
        status_code: resp.status,
        status: configPatch.status,
        message: configPatch.status === "awaiting_client_appointment"
          ? `Il legale rappresentante di ${tenantFiscalId} deve prima nominare ${appointeeFiscalId} come Appointee su Fisconline AdE.`
          : `Errore A-Cube: HTTP ${resp.status} ${respText.slice(0, 200)}`,
        raw: respJson,
      });
    }

    return jsonOk({
      ok: true,
      status: "active",
      message: `Appointee ${appointeeFiscalId} assegnato a BRC ${tenantFiscalId} (${stage}). Pronto per download massivo fatture.`,
      raw: respJson,
    });
  } catch (e) {
    return jsonError(500, `Internal: ${e instanceof Error ? e.message : String(e)}`);
  }
});

function jsonOk(p: unknown): Response { return new Response(JSON.stringify(p), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function jsonError(status: number, message: string): Response { return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
