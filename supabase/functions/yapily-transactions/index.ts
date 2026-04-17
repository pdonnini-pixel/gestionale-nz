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
    // Verify JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw { message: "Missing authorization", status: 401 };

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw { message: "Unauthorized", status: 401 };

    const companyId = user.app_metadata?.company_id;
    if (!companyId) throw { message: "No company assigned", status: 403 };

    if (req.method === "GET") {
      // GET — return local transactions, optionally filtered by account
      const url = new URL(req.url);
      const accountId = url.searchParams.get("accountId");
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const limit = parseInt(url.searchParams.get("limit") || "100");
      const offset = parseInt(url.searchParams.get("offset") || "0");

      let query = supabase
        .from("yapily_transactions")
        .select("*, yapily_accounts!inner(account_name, iban, institution_id)")
        .eq("company_id", companyId)
        .order("date", { ascending: false })
        .range(offset, offset + limit - 1);

      if (accountId) query = query.eq("yapily_account_id", accountId);
      if (from) query = query.gte("date", from);
      if (to) query = query.lte("date", to);

      const { data, error } = await query;
      if (error) throw { message: error.message, status: 500 };

      return new Response(JSON.stringify({ data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "POST") {
      // POST — sync transactions from Yapily API for a specific account
      const { accountId, from } = await req.json();
      if (!accountId) throw { message: "accountId required", status: 400 };

      // Get account + consent
      const { data: account, error: accErr } = await supabase
        .from("yapily_accounts")
        .select("*, yapily_consents!inner(consent_token, status)")
        .eq("id", accountId)
        .eq("company_id", companyId)
        .single();

      if (accErr || !account) throw { message: "Account not found", status: 404 };
      if (account.yapily_consents.status !== "AUTHORIZED") {
        throw { message: "Consent not authorized", status: 403 };
      }

      // Get Yapily credentials from Vault
      const { data: creds, error: credsErr } = await supabase.rpc("get_yapily_credentials");
      if (credsErr || !creds) throw { message: "Failed to get credentials", status: 500 };

      const basicAuth = btoa(`${creds.uuid}:${creds.secret}`);

      // Build Yapily API URL
      let yapilyUrl = `https://api.yapily.com/accounts/${account.yapily_account_id}/transactions`;
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      // Default: last 90 days if no from date
      if (!from) {
        const d = new Date();
        d.setDate(d.getDate() - 90);
        params.set("from", d.toISOString().split("T")[0]);
      }
      if (params.toString()) yapilyUrl += `?${params.toString()}`;

      // Call Yapily API
      const yapilyRes = await fetch(yapilyUrl, {
        headers: {
          "Authorization": `Basic ${basicAuth}`,
          "Content-Type": "application/json",
          "consent": account.yapily_consents.consent_token,
        },
      });

      if (!yapilyRes.ok) {
        const errBody = await yapilyRes.text();
        console.error(`[yapily-transactions] Yapily API error:`, errBody);
        throw { message: `Yapily API error: ${yapilyRes.status}`, status: 502 };
      }

      const yapilyData = await yapilyRes.json();
      const transactions = yapilyData.data || [];

      // Upsert transactions
      let synced = 0;
      for (const tx of transactions) {
        const record = {
          company_id: companyId,
          yapily_account_id: accountId,
          transaction_id: tx.id || tx.transactionId,
          date: tx.bookingDateTime?.split("T")[0] || tx.valueDateTime?.split("T")[0],
          booking_date: tx.bookingDateTime?.split("T")[0],
          amount: tx.amount,
          currency: tx.currency || "EUR",
          description: tx.description || tx.reference,
          reference: tx.reference,
          merchant_name: tx.merchantName || tx.merchant?.merchantName,
          status: tx.status === "PENDING" ? "PENDING" : "BOOKED",
          balance_after: tx.runningBalance?.amount,
          raw_data: tx,
        };

        const { error: upsertErr } = await supabase
          .from("yapily_transactions")
          .upsert(record, {
            onConflict: "company_id,yapily_account_id,transaction_id",
            ignoreDuplicates: false,
          });

        if (!upsertErr) synced++;
      }

      // Update last_synced_at on account
      await supabase
        .from("yapily_accounts")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", accountId);

      return new Response(JSON.stringify({
        data: { synced, total: transactions.length },
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw { message: "Method not allowed", status: 405 };
  } catch (error: any) {
    console.error(`[yapily-transactions] Error:`, error);
    return new Response(JSON.stringify({
      error: error.message || "Internal error",
      code: "YAPILY_TRANSACTIONS_ERROR",
      timestamp: new Date().toISOString(),
    }), {
      status: error.status || 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
