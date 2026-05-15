// Edge Function: acube-login
// Ottiene un JWT A-Cube e lo cacha nella tabella acube_tokens.
// Se in cache c'è un JWT non scaduto (con margine di 1h), lo restituisce
// senza chiamare A-Cube → riduce drasticamente i costi e la latenza.
//
// Chi può chiamarla:
//   - Service role (da altre Edge Functions, es. acube-transactions-sync, cron)
//   - Authenticated user con role super_advisor (per refresh manuale dalla UI)
//
// Body atteso:
//   { "stage": "sandbox" | "production" }   (default: "sandbox")
//
// Risposta:
//   { "jwt": "<token>", "expires_at": "<ISO>", "from_cache": true|false }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ACUBE_LOGIN_URLS: Record<string, string> = {
  sandbox: "https://common-sandbox.api.acubeapi.com/login",
  production: "https://common.api.acubeapi.com/login",
};

// Margine di sicurezza: rinnova il JWT se scade entro questo intervallo (1h).
const REFRESH_MARGIN_MS = 60 * 60 * 1000;

// Durata stimata del JWT A-Cube (24h come da doc).
// Usata se A-Cube non torna un campo expires_at esplicito.
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

interface AcubeLoginResponse {
  token?: string;
  jwt?: string;
  access_token?: string;
  expires_at?: string;
  expires_in?: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonError(405, "Method not allowed");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth: accetta service_role oppure authenticated con role super_advisor
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return jsonError(401, "Missing authorization");

    const isServiceRole = token === supabaseServiceKey;
    if (!isServiceRole) {
      const { data: userData, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !userData?.user) return jsonError(401, "Invalid JWT");

      const role = userData.user.app_metadata?.role
        ?? userData.user.user_metadata?.role;
      if (role !== "super_advisor") {
        return jsonError(403, "Only super_advisor can refresh A-Cube token manually");
      }
    }

    // Body
    let stage: string = "sandbox";
    try {
      const body = await req.json();
      if (body?.stage) stage = String(body.stage);
    } catch {
      // body opzionale, default a sandbox
    }

    if (!ACUBE_LOGIN_URLS[stage]) {
      return jsonError(400, `Invalid stage: ${stage}. Use sandbox or production.`);
    }

    // 1. Cache lookup
    const { data: cached } = await supabase
      .from("acube_tokens")
      .select("jwt, expires_at")
      .eq("stage", stage)
      .maybeSingle();

    if (cached?.jwt && cached.expires_at) {
      const expiresAt = new Date(cached.expires_at).getTime();
      if (expiresAt - Date.now() > REFRESH_MARGIN_MS) {
        return jsonOk({
          jwt: cached.jwt,
          expires_at: cached.expires_at,
          from_cache: true,
        });
      }
    }

    // 2. Cache miss → leggi credentials da Vault
    const { data: creds, error: credsErr } = await supabase.rpc(
      "get_acube_credentials",
      { p_stage: stage },
    );
    if (credsErr || !creds || !creds[0]) {
      return jsonError(500, `Failed to get A-Cube credentials: ${credsErr?.message ?? "no row"}`);
    }
    const { email, password } = creds[0] as { email: string; password: string };

    // 3. POST /login a A-Cube
    const acubeResp = await fetch(ACUBE_LOGIN_URLS[stage], {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    if (!acubeResp.ok) {
      const errBody = await acubeResp.text();
      return jsonError(
        acubeResp.status,
        `A-Cube login failed (${acubeResp.status}): ${errBody.slice(0, 500)}`,
      );
    }

    const data = (await acubeResp.json()) as AcubeLoginResponse;
    const newJwt = data.token ?? data.jwt ?? data.access_token;
    if (!newJwt) {
      return jsonError(502, `A-Cube login response missing token field. Got: ${JSON.stringify(data).slice(0, 300)}`);
    }

    let expiresAt: string;
    if (data.expires_at) {
      expiresAt = new Date(data.expires_at).toISOString();
    } else if (data.expires_in) {
      expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
    } else {
      expiresAt = new Date(Date.now() + DEFAULT_TTL_MS).toISOString();
    }

    // 4. Upsert in cache
    const { error: upsertErr } = await supabase
      .from("acube_tokens")
      .upsert(
        { stage, jwt: newJwt, expires_at: expiresAt, updated_at: new Date().toISOString() },
        { onConflict: "stage" },
      );
    if (upsertErr) {
      // Non-fatal: ritorna comunque il JWT, il caller può continuare
      console.warn("acube_tokens upsert failed:", upsertErr.message);
    }

    return jsonOk({ jwt: newJwt, expires_at: expiresAt, from_cache: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonError(500, `Internal error: ${msg}`);
  }
});

function jsonOk(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
