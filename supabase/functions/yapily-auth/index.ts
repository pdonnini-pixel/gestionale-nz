import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") throw { message: "Method not allowed", status: 405 };

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw { message: "Missing authorization", status: 401 };

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw { message: "Unauthorized", status: 401 };

    const companyId = user.app_metadata?.company_id;
    if (!companyId) throw { message: "No company assigned", status: 403 };

    const { institutionId, institutionName, consentType, callbackUrl } = await req.json();
    if (!institutionId || !consentType) {
      throw { message: "institutionId and consentType required", status: 400 };
    }

    // Get Yapily credentials from Vault
    const { data: creds, error: credsErr } = await supabase.rpc("get_yapily_credentials");
    if (credsErr || !creds) throw { message: "Failed to get credentials", status: 500 };

    const basicAuth = btoa(`${creds.uuid}:${creds.secret}`);

    // Determine callback URL
    const effectiveCallback = callbackUrl
      || `${supabaseUrl}/functions/v1/yapily-callback`;

    // Build Yapily auth request
    const isAIS = consentType === "AIS";
    const yapilyEndpoint = isAIS
      ? "https://api.yapily.com/account-auth-requests"
      : "https://api.yapily.com/payment-auth-requests";

    const yapilyBody: any = {
      applicationUserId: user.id,
      institutionId,
      callback: effectiveCallback,
    };

    if (isAIS) {
      yapilyBody.accountRequest = {
        transactionFrom: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
        transactionTo: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      };
    }

    const yapilyRes = await fetch(yapilyEndpoint, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(yapilyBody),
    });

    if (!yapilyRes.ok) {
      const errBody = await yapilyRes.text();
      console.error(`[yapily-auth] Yapily API error:`, errBody);
      throw { message: `Yapily API error: ${yapilyRes.status}`, status: 502 };
    }

    const yapilyData = await yapilyRes.json();
    const consentToken = yapilyData.data?.consentToken;
    const authorisationUrl = yapilyData.data?.authorisationUrl;

    if (!consentToken || !authorisationUrl) {
      throw { message: "Invalid Yapily response", status: 502 };
    }

    // Save consent to DB
    const { data: consent, error: insertErr } = await supabase
      .from("yapily_consents")
      .insert({
        company_id: companyId,
        institution_id: institutionId,
        institution_name: institutionName || institutionId,
        consent_token: consentToken,
        consent_type: consentType,
        status: "PENDING",
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        max_historical_days: 90,
        user_id: user.id,
      })
      .select()
      .single();

    if (insertErr) {
      console.error(`[yapily-auth] DB insert error:`, insertErr);
      throw { message: "Failed to save consent", status: 500 };
    }

    return new Response(JSON.stringify({
      data: {
        consentId: consent.id,
        authorisationUrl,
        consentToken,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error(`[yapily-auth] Error:`, error);
    return new Response(JSON.stringify({
      error: error.message || "Internal error",
      code: "YAPILY_AUTH_ERROR",
      timestamp: new Date().toISOString(),
    }), {
      status: error.status || 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
