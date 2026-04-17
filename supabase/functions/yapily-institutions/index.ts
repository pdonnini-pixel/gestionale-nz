import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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

    // Get Yapily credentials from Vault
    const { data: creds, error: credsErr } = await supabase.rpc("get_yapily_credentials");
    if (credsErr || !creds) throw { message: "Failed to get credentials", status: 500 };

    const basicAuth = btoa(`${creds.uuid}:${creds.secret}`);

    // Call Yapily API — list Italian institutions
    const yapilyRes = await fetch("https://api.yapily.com/institutions?country=IT", {
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
    });

    if (!yapilyRes.ok) {
      const errBody = await yapilyRes.text();
      console.error(`[yapily-institutions] Yapily API error:`, errBody);
      throw { message: `Yapily API error: ${yapilyRes.status}`, status: 502 };
    }

    const yapilyData = await yapilyRes.json();

    // Map to simplified structure
    const institutions = (yapilyData.data || []).map((inst: any) => ({
      id: inst.id,
      name: inst.name,
      fullName: inst.fullName,
      countries: inst.countries,
      media: inst.media,
      features: inst.features,
    }));

    return new Response(JSON.stringify({ data: institutions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error(`[yapily-institutions] Error:`, error);
    return new Response(JSON.stringify({
      error: error.message || "Internal error",
      code: "YAPILY_INSTITUTIONS_ERROR",
      timestamp: new Date().toISOString(),
    }), {
      status: error.status || 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
