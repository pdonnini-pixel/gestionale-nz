import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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

    if (req.method === "GET") {
      // GET — return local accounts
      const { data, error } = await supabase
        .from("yapily_accounts")
        .select("*, yapily_consents(institution_name, status)")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("account_name");

      if (error) throw { message: error.message, status: 500 };

      return new Response(JSON.stringify({ data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "POST") {
      // POST — sync accounts from Yapily after consent is authorized
      const { consentId } = await req.json();
      if (!consentId) throw { message: "consentId required", status: 400 };

      // Get consent
      const { data: consent, error: consentErr } = await supabase
        .from("yapily_consents")
        .select("*")
        .eq("id", consentId)
        .eq("company_id", companyId)
        .single();

      if (consentErr || !consent) throw { message: "Consent not found", status: 404 };

      // Get Yapily credentials
      const { data: creds, error: credsErr } = await supabase.rpc("get_yapily_credentials");
      if (credsErr || !creds) throw { message: "Failed to get credentials", status: 500 };

      const basicAuth = btoa(`${creds.uuid}:${creds.secret}`);

      // Call Yapily API
      const yapilyRes = await fetch("https://api.yapily.com/accounts", {
        headers: {
          "Authorization": `Basic ${basicAuth}`,
          "Content-Type": "application/json",
          "consent": consent.consent_token,
        },
      });

      if (!yapilyRes.ok) {
        const errBody = await yapilyRes.text();
        console.error(`[yapily-accounts] Yapily API error:`, errBody);
        throw { message: `Yapily API error: ${yapilyRes.status}`, status: 502 };
      }

      const yapilyData = await yapilyRes.json();
      const accounts = yapilyData.data || [];

      // Upsert accounts
      const results = [];
      for (const acc of accounts) {
        const { data: upserted, error: upsertErr } = await supabase
          .from("yapily_accounts")
          .upsert({
            company_id: companyId,
            consent_id: consent.id,
            yapily_account_id: acc.id,
            account_type: acc.type || acc.accountType,
            account_name: acc.accountNames?.[0]?.name || acc.nickname || acc.type,
            iban: acc.accountIdentifications?.find((i: any) => i.type === "IBAN")?.identification,
            currency: acc.currency || "EUR",
            institution_id: consent.institution_id,
            balance: acc.accountBalances?.[0]?.balanceAmount?.amount,
            balance_updated_at: new Date().toISOString(),
            last_synced_at: new Date().toISOString(),
            is_active: true,
          }, {
            onConflict: "company_id,yapily_account_id",
            ignoreDuplicates: false,
          })
          .select()
          .single();

        if (!upsertErr && upserted) results.push(upserted);
      }

      // Update consent status
      await supabase
        .from("yapily_consents")
        .update({ status: "AUTHORIZED", updated_at: new Date().toISOString() })
        .eq("id", consentId);

      return new Response(JSON.stringify({ data: results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw { message: "Method not allowed", status: 405 };
  } catch (error: any) {
    console.error(`[yapily-accounts] Error:`, error);
    return new Response(JSON.stringify({
      error: error.message || "Internal error",
      code: "YAPILY_ACCOUNTS_ERROR",
      timestamp: new Date().toISOString(),
    }), {
      status: error.status || 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
