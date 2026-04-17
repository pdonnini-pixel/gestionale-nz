import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * yapily-sync — Bridge Yapily → cash_movements
 *
 * POST: Sync transactions from Yapily API for an account, then import
 *       new transactions into cash_movements for reconciliation.
 *
 * Body: { accountId, from? }
 *
 * Flow:
 * 1. Call yapily API to get latest transactions
 * 2. Upsert into yapily_transactions
 * 3. For each new yapily_transaction not yet in cash_movements, create a cash_movement
 * 4. Update yapily_accounts.last_synced_at and balance
 * 5. Return stats { synced, imported, skipped }
 */

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

    const { accountId, from } = await req.json();
    if (!accountId) throw { message: "accountId required", status: 400 };

    // ── 1. Get account + consent ──
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

    // ── 2. Get Yapily credentials ──
    const { data: creds, error: credsErr } = await supabase.rpc("get_yapily_credentials");
    if (credsErr || !creds) throw { message: "Failed to get credentials", status: 500 };
    const basicAuth = btoa(`${creds.uuid}:${creds.secret}`);

    // ── 3. Fetch transactions from Yapily API ──
    const params = new URLSearchParams();
    if (from) {
      params.set("from", from);
    } else {
      const d = new Date();
      d.setDate(d.getDate() - 90);
      params.set("from", d.toISOString().split("T")[0]);
    }

    const yapilyUrl = `https://api.yapily.com/accounts/${account.yapily_account_id}/transactions?${params.toString()}`;
    const yapilyRes = await fetch(yapilyUrl, {
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/json",
        "consent": account.yapily_consents.consent_token,
      },
    });

    if (!yapilyRes.ok) {
      const errBody = await yapilyRes.text();
      console.error(`[yapily-sync] Yapily API error:`, errBody);
      throw { message: `Yapily API error: ${yapilyRes.status}`, status: 502 };
    }

    const yapilyData = await yapilyRes.json();
    const transactions = yapilyData.data || [];

    // ── 4. Upsert into yapily_transactions ──
    let synced = 0;
    let imported = 0;
    let skipped = 0;

    for (const tx of transactions) {
      const txId = tx.id || tx.transactionId;
      const txDate = tx.bookingDateTime?.split("T")[0] || tx.valueDateTime?.split("T")[0];
      const txAmount = typeof tx.amount === "number" ? tx.amount : parseFloat(tx.amount);

      if (!txId || !txDate || isNaN(txAmount)) {
        skipped++;
        continue;
      }

      const yapilyRecord = {
        company_id: companyId,
        yapily_account_id: accountId,
        transaction_id: txId,
        date: txDate,
        booking_date: tx.bookingDateTime?.split("T")[0],
        amount: txAmount,
        currency: tx.currency || "EUR",
        description: tx.description || tx.reference || "",
        reference: tx.reference,
        merchant_name: tx.merchantName || tx.merchant?.merchantName,
        status: tx.status === "PENDING" ? "PENDING" : "BOOKED",
        balance_after: tx.runningBalance?.amount,
        raw_data: tx,
      };

      const { data: upserted, error: upsertErr } = await supabase
        .from("yapily_transactions")
        .upsert(yapilyRecord, {
          onConflict: "company_id,yapily_account_id,transaction_id",
          ignoreDuplicates: false,
        })
        .select("id")
        .single();

      if (upsertErr) {
        console.error(`[yapily-sync] Upsert error for tx ${txId}:`, upsertErr);
        skipped++;
        continue;
      }

      synced++;
      const yapilyTxUuid = upserted.id;

      // ── 5. Check if already imported into cash_movements ──
      const { data: existing } = await supabase
        .from("cash_movements")
        .select("id")
        .eq("yapily_transaction_id", yapilyTxUuid)
        .maybeSingle();

      if (existing) {
        // Already imported — skip
        continue;
      }

      // Only import BOOKED transactions (skip PENDING)
      if (tx.status === "PENDING") continue;

      // ── 6. Create cash_movement ──
      const isIncoming = txAmount > 0;
      const absAmount = Math.abs(txAmount);

      const cashMovement = {
        company_id: companyId,
        bank_account_id: account.bank_account_id, // link to NZ bank_account if mapped
        date: txDate,
        value_date: tx.valueDateTime?.split("T")[0] || txDate,
        type: isIncoming ? "entrata" : "uscita",
        amount: absAmount,
        balance_after: tx.runningBalance?.amount != null ? tx.runningBalance.amount : null,
        description: [
          tx.description,
          tx.reference,
          tx.merchantName || tx.merchant?.merchantName,
        ].filter(Boolean).join(" — ") || "Movimento Open Banking",
        counterpart: tx.merchantName || tx.merchant?.merchantName || null,
        source: "api_yapily",
        yapily_transaction_id: yapilyTxUuid,
        is_reconciled: false,
        verified: false,
        notes: `Sync automatica da ${account.institution_id}`,
      };

      const { error: insertErr } = await supabase
        .from("cash_movements")
        .insert(cashMovement);

      if (insertErr) {
        console.error(`[yapily-sync] Insert cash_movement error:`, insertErr);
        // Not fatal — continue with next
      } else {
        imported++;

        // Also update the yapily_transaction with the cash_movement link
        await supabase
          .from("yapily_transactions")
          .update({ cash_movement_id: null }) // placeholder, the real link is cash_movements.yapily_transaction_id
          .eq("id", yapilyTxUuid);
      }
    }

    // ── 7. Update account balance + last_synced ──
    // Fetch balance from Yapily
    try {
      const balRes = await fetch(
        `https://api.yapily.com/accounts/${account.yapily_account_id}/balances`,
        {
          headers: {
            "Authorization": `Basic ${basicAuth}`,
            "Content-Type": "application/json",
            "consent": account.yapily_consents.consent_token,
          },
        }
      );

      if (balRes.ok) {
        const balData = await balRes.json();
        const balances = balData.data || [];
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
              last_synced_at: new Date().toISOString(),
            })
            .eq("id", accountId);

          // Also update linked bank_account balance if mapped
          if (account.bank_account_id) {
            await supabase
              .from("bank_accounts")
              .update({
                current_balance: balance.balanceAmount?.amount || balance.amount,
              })
              .eq("id", account.bank_account_id);
          }
        }
      }
    } catch (balErr) {
      console.error(`[yapily-sync] Balance refresh error (non-blocking):`, balErr);
      // Still update last_synced even if balance fails
      await supabase
        .from("yapily_accounts")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", accountId);
    }

    return new Response(JSON.stringify({
      data: {
        synced,
        imported,
        skipped,
        total: transactions.length,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error(`[yapily-sync] Error:`, error);
    return new Response(JSON.stringify({
      error: error.message || "Internal error",
      code: "YAPILY_SYNC_ERROR",
      timestamp: new Date().toISOString(),
    }), {
      status: error.status || 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
