// Edge Function: acube-ob-br-enable
// Attiva un Business Registry creato in stato disabled.
// Endpoint A-Cube: POST /business-registry/{fiscalId}/enable
//
// Body: { stage, fiscalId }
// Risposta: { fiscal_id, enabled: true }

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
  const resp = await fetch(loginUrl, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ email, password }) });
  if (!resp.ok) return { error: `A-Cube login HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}` };
  const data = await resp.json() as { token?: string; jwt?: string; access_token?: string; expires_at?: string; expires_in?: number };
  const newJwt = data.token ?? data.jwt ?? data.access_token;
  if (!newJwt) return { error: "A-Cube login response missing token" };
  let expiresAt: string;
  if (data.expires_at) expiresAt = new Date(data.expires_at).toISOString();
  else if (data.expires_in) expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
  else expiresAt = new Date(Date.now() + DEFAULT_TTL_MS).toISOString();
  await supabase.from("acube_tokens").upsert({ stage, jwt: newJwt, expires_at: expiresAt, updated_at: new Date().toISOString() }, { onConflict: "stage" });
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
    if (!fiscalId) return jsonError(400, "Missing fiscalId");
    const baseUrl = OB_BASE_URL[stage];
    if (!baseUrl) return jsonError(400, `Invalid stage: ${stage}`);

    let jwt = await getCachedJwt(supabase, stage);
    const doPost = async (j: string) => fetch(`${baseUrl}/business-registry/${encodeURIComponent(fiscalId)}/enable`, {
      method: "POST",
      headers: { Authorization: `Bearer ${j}`, "Content-Type": "application/json", Accept: "application/json" },
      body: "{}",
    });
    let resp = await doPost(jwt);
    if (resp.status === 401) {
      const r = await refreshAcubeJwt(supabase, stage);
      if (!r.jwt) return jsonError(500, `Refresh fallito: ${r.error}`);
      jwt = r.jwt;
      resp = await doPost(jwt);
    }
    if (!resp.ok) return jsonError(resp.status, `A-Cube enable HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);

    await supabase.from("acube_business_registries").update({ enabled: true, updated_at: new Date().toISOString() }).eq("fiscal_id", fiscalId).eq("stage", stage);
    return jsonOk({ fiscal_id: fiscalId, enabled: true });
  } catch (e) {
    return jsonError(500, `Internal error: ${e instanceof Error ? e.message : String(e)}`);
  }
});

function jsonOk(p: unknown): Response { return new Response(JSON.stringify(p), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function jsonError(status: number, message: string): Response { return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
