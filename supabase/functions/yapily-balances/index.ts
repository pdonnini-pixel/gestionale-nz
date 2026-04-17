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
      // GET — return cached balances from local DB
      const { data, error } = await supabase
        .from("yapily_accounts")
        .select("id, account_name, iban, currency, institution_id, balance, balance_updated_at, is_active")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("account_name");

      if (error) throw { message: error.message, status: 500 };

      return new Response(JSON.stringify({ data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "POST") {
      // POST — refresh balances from Yapily API
      const { accountId } = await req.json();

      // Get accounts to refresh (single or all)
      let query = supabase
        .from("yapily_accounts")
        .select("*, yapily_consents!inner(consent_token, status)")
        .eq("company_id", companyId)
        .eq("is_active", true);

      if (accountId) query = query.eq("id", accountId);

      const { data: accounts, error: accErr } = await query;
      if (accErr) throw { message: accErr.message, status: 500 };

      if (!accounts || accounts.length === 0) {
        return new Response(JSON.stringify({ data: { updated: 0 } }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get Yapily credentials
      const { data: creds, error: credsErr } = await supabase.rpc("get_yapily_credentials");
      if (credsErr || !creds) throw { message: "Failed to get credentials", status: 500 };

      const basicAuth = btoa(`${creds.uuid}:${creds.secret}`);
      let updated = 0;

      for (const account of accounts) {
        if (account.yapily_consents.status !== "AUTHORIZED") continue;

        try {
          const yapilyRes = await fetch(
            `https://api.yapily.com/accounts/${account.yapily_account_id}/balances`,
            {
              headers: {
                "Authorization": `Basic ${basicAuth}`,
                "Content-Type": "application/json",
                "consent": account.yapily_consents.consent_token,
              },
            }
          );

          if (!yapilyRes.ok) {
            console.error(`[yapily-balances] API error for account ${account.id}: ${yapilyRes.status}`);
            continue;
          }

          const yapilyData = await yapilyRes.json();
          const balances = yapilyData.data || [];

          // Find the most relevant balance (EXPECTED or CLOSING_AVAILABLE)
          const balance = balances.find((b: any) => b.type === "EXPECTED")
            || balances.find((b: any) => b.type === "CLOSING_AVAILABLE")
            || balances.find((b: any) => b.type === "INTERIM_AVAILABLE")
            || balances[0];

          if (balance) {
            await supabase
              .from("yapily_accounts")
              .update({
                balance: balance.balanceAmount?.amount || balance.amount,
                balance_updated_at: new Date().toISOString(),
              })
              .eq("id", account.id);
            updated++;
          }
        } catch (fetchErr: any) {
          console.error(`[yapily-balances] Error fetching balance for ${account.id}:`, fetchErr);
        }
      }

      return new Response(JSON.stringify({ data: { updated, total: accounts.length } }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw { message: "Method not allowed", status: 405 };
  } catch (error: any) {
    console.error(`[yapily-balances] Error:`, error);
    return new Response(JSON.stringify({
      error: error.message || "Internal error",
      code: "YAPILY_BALANCES_ERROR",
      timestamp: new Date().toISOString(),
    }), {
      status: error.status || 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
