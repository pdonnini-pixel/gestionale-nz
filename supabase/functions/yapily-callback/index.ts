import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// JWT disabled: this is a redirect callback from the bank
// The bank redirects the user's browser here after consent authorization
// We validate via consent-token matching, not JWT

Deno.serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    const consentToken = url.searchParams.get("consent") || url.searchParams.get("consent-token");
    const applicationUserId = url.searchParams.get("application-user-id");
    const userUuid = url.searchParams.get("user-uuid");
    const institution = url.searchParams.get("institution");
    const error = url.searchParams.get("error");
    const errorSource = url.searchParams.get("error-source");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Handle error from bank
    if (error) {
      console.error(`[yapily-callback] Bank error: ${error}, source: ${errorSource}`);

      // Try to update consent status if we can identify it
      if (consentToken) {
        await supabase
          .from("yapily_consents")
          .update({
            status: "REJECTED",
            updated_at: new Date().toISOString(),
          })
          .eq("consent_token", consentToken);
      }

      // Redirect to app with error
      const appUrl = Deno.env.get("APP_URL") || "https://gestionale-nz.netlify.app";
      return Response.redirect(
        `${appUrl}/banche?status=error&error=${encodeURIComponent(error)}`,
        302
      );
    }

    // Success flow: consent was authorized
    if (consentToken) {
      // Update consent status
      const { data: consent, error: updateErr } = await supabase
        .from("yapily_consents")
        .update({
          status: "AUTHORIZED",
          updated_at: new Date().toISOString(),
        })
        .eq("consent_token", consentToken)
        .select()
        .single();

      if (updateErr) {
        console.error(`[yapily-callback] Failed to update consent:`, updateErr);
      } else {
        console.log(`[yapily-callback] Consent ${consent.id} authorized for institution ${consent.institution_id}`);

        // Auto-sync accounts after successful consent
        try {
          const { data: creds, error: credsErr } = await supabase.rpc("get_yapily_credentials");
          if (!credsErr && creds) {
            const basicAuth = btoa(`${creds.uuid}:${creds.secret}`);

            const yapilyRes = await fetch("https://api.yapily.com/accounts", {
              headers: {
                "Authorization": `Basic ${basicAuth}`,
                "Content-Type": "application/json",
                "consent": consentToken,
              },
            });

            if (yapilyRes.ok) {
              const yapilyData = await yapilyRes.json();
              const accounts = yapilyData.data || [];

              for (const acc of accounts) {
                await supabase
                  .from("yapily_accounts")
                  .upsert({
                    company_id: consent.company_id,
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
                  });
              }
              console.log(`[yapily-callback] Synced ${accounts.length} accounts`);
            }
          }
        } catch (syncErr) {
          console.error(`[yapily-callback] Auto-sync error (non-blocking):`, syncErr);
        }
      }
    }

    // Redirect back to app
    const appUrl = Deno.env.get("APP_URL") || "https://gestionale-nz.netlify.app";
    return Response.redirect(
      `${appUrl}/banche?status=success&institution=${encodeURIComponent(institution || "")}`,
      302
    );
  } catch (error: any) {
    console.error(`[yapily-callback] Error:`, error);
    const appUrl = Deno.env.get("APP_URL") || "https://gestionale-nz.netlify.app";
    return Response.redirect(
      `${appUrl}/banche?status=error&error=${encodeURIComponent("Callback processing failed")}`,
      302
    );
  }
});
