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
      // GET — list payments
      const url = new URL(req.url);
      const status = url.searchParams.get("status");
      const limit = parseInt(url.searchParams.get("limit") || "50");

      let query = supabase
        .from("yapily_payments")
        .select("*, yapily_consents(institution_name)")
        .eq("company_id", companyId)
        .order("initiated_at", { ascending: false })
        .limit(limit);

      if (status) query = query.eq("status", status);

      const { data, error } = await query;
      if (error) throw { message: error.message, status: 500 };

      return new Response(JSON.stringify({ data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "POST") {
      // POST — initiate a payment
      const body = await req.json();
      const { consentId, payableId, amount, currency, creditorName, creditorIban, reference, paymentType } = body;

      // Validate required fields
      if (!amount || !creditorName || !creditorIban) {
        throw { message: "amount, creditorName, creditorIban are required", status: 400 };
      }

      // Create payment record locally
      const { data: payment, error: insertErr } = await supabase
        .from("yapily_payments")
        .insert({
          company_id: companyId,
          consent_id: consentId || null,
          payable_id: payableId || null,
          amount,
          currency: currency || "EUR",
          creditor_name: creditorName,
          creditor_iban: creditorIban,
          reference: reference || null,
          payment_type: paymentType || "DOMESTIC_SINGLE",
          status: "PENDING",
        })
        .select()
        .single();

      if (insertErr) throw { message: insertErr.message, status: 500 };

      // If we have a PIS consent, initiate the payment via Yapily
      if (consentId) {
        const { data: consent, error: consentErr } = await supabase
          .from("yapily_consents")
          .select("consent_token, status, institution_id")
          .eq("id", consentId)
          .eq("company_id", companyId)
          .eq("consent_type", "PIS")
          .single();

        if (consentErr || !consent) {
          // Payment created but not submitted to bank
          return new Response(JSON.stringify({
            data: payment,
            warning: "Payment saved but PIS consent not found. Create a PIS consent first.",
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (consent.status !== "AUTHORIZED") {
          return new Response(JSON.stringify({
            data: payment,
            warning: "Payment saved but consent not yet authorized.",
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Get Yapily credentials
        const { data: creds, error: credsErr } = await supabase.rpc("get_yapily_credentials");
        if (credsErr || !creds) throw { message: "Failed to get credentials", status: 500 };

        const basicAuth = btoa(`${creds.uuid}:${creds.secret}`);

        // Submit payment to Yapily
        const yapilyRes = await fetch("https://api.yapily.com/payments", {
          method: "POST",
          headers: {
            "Authorization": `Basic ${basicAuth}`,
            "Content-Type": "application/json",
            "consent": consent.consent_token,
            "psu-id": user.id,
            "psu-ip-address": req.headers.get("x-forwarded-for") || "127.0.0.1",
          },
          body: JSON.stringify({
            paymentIdempotencyId: payment.idempotency_key,
            amount: {
              amount,
              currency: currency || "EUR",
            },
            payee: {
              name: creditorName,
              accountIdentifications: [{
                type: "IBAN",
                identification: creditorIban,
              }],
            },
            reference: reference || `PAY-${payment.id.slice(0, 8)}`,
            type: paymentType || "DOMESTIC_SINGLE",
          }),
        });

        if (yapilyRes.ok) {
          const yapilyData = await yapilyRes.json();
          const yapilyPayment = yapilyData.data;

          // Update payment with Yapily response
          const newStatus = yapilyPayment.status === "COMPLETED" ? "COMPLETED"
            : yapilyPayment.status === "FAILED" ? "FAILED"
            : "AUTHORIZED";

          await supabase
            .from("yapily_payments")
            .update({
              yapily_payment_id: yapilyPayment.id,
              status: newStatus,
              completed_at: newStatus === "COMPLETED" ? new Date().toISOString() : null,
            })
            .eq("id", payment.id);

          payment.yapily_payment_id = yapilyPayment.id;
          payment.status = newStatus;
        } else {
          const errBody = await yapilyRes.text();
          console.error(`[yapily-payments] Yapily API error:`, errBody);

          await supabase
            .from("yapily_payments")
            .update({
              status: "FAILED",
              error_details: { api_status: yapilyRes.status, body: errBody },
            })
            .eq("id", payment.id);

          payment.status = "FAILED";
        }
      }

      return new Response(JSON.stringify({ data: payment }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw { message: "Method not allowed", status: 405 };
  } catch (error: any) {
    console.error(`[yapily-payments] Error:`, error);
    return new Response(JSON.stringify({
      error: error.message || "Internal error",
      code: "YAPILY_PAYMENTS_ERROR",
      timestamp: new Date().toISOString(),
    }), {
      status: error.status || 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
