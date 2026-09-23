// Edge Function: leave-notify
//
// Avvisa i referenti per mail quando una richiesta di ferie viene
// registrata, e quando viene decisa. Dentro il gestionale l'avviso c'e'
// gia' (notifications): questa e' la seconda via, per chi le ferie le
// approva ma nel gestionale non ci entra tutti i giorni. Se la mail non e'
// configurata la richiesta vale lo stesso: la funzione risponde
// mail = "skipped" e nessuno perde niente.
//
// Destinatari, in quest'ordine, senza nessun indirizzo nel codice:
//   1. i referenti attivi con una email (leave_approvers), filtrati per
//      punto vendita quando ne hanno uno;
//   2. piu' gli indirizzi fissi di leave_settings.recipients.
// Nessuno dei due configurato: non parte niente.
//
// QUESTO TESTO LO LEGGE ANCHE CHI NON LAVORA NEL GESTIONALE: si scrive
// cosa e' stato chiesto e da chi, non come lo teniamo dentro. Niente
// «tabulato», niente «voce», niente codici.
//
// Secret della function: RESEND_API_KEY, DISTINTA_EMAIL_FROM (gli stessi
// di send-distinta-email).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonError(status: number, message: string, code = "LEAVE_NOTIFY_ERROR") {
  return new Response(JSON.stringify({ error: message, code, timestamp: new Date().toISOString() }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function jsonOk(payload: unknown) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function dateIt(iso: string): string {
  const [y, m, d] = String(iso).split("-");
  return `${d}/${m}/${y}`;
}
function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function ore(n: number): string {
  return `${n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h`;
}

const NOME_VOCE: Record<string, string> = { F01: "Ferie", F02: "Ex festività", F03: "ROL" };
const QUANTO: Record<string, string> = {
  giornata: "tutto il giorno",
  mezza_giornata: "mezza giornata",
  ore: "alcune ore",
};

type Giorno = { data: string; voce: string; tipo: string; ore: number; stato: string };

/** «dal 3 al 9 agosto», invece di sette righe uguali. */
function periodi(giorni: Giorno[]): string[] {
  const ordinati = [...giorni].sort((a, b) => a.data.localeCompare(b.data));
  const out: { dal: string; al: string; voce: string; tipo: string; n: number }[] = [];
  for (const g of ordinati) {
    const u = out[out.length - 1];
    const giornoDopo = (() => {
      const d = new Date(`${u?.al ?? g.data}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    })();
    if (u && u.voce === g.voce && u.tipo === g.tipo && giornoDopo === g.data) {
      u.al = g.data; u.n += 1;
    } else {
      out.push({ dal: g.data, al: g.data, voce: g.voce, tipo: g.tipo, n: 1 });
    }
  }
  return out.map((p) => {
    const quando = p.dal === p.al ? dateIt(p.dal) : `dal ${dateIt(p.dal)} al ${dateIt(p.al)}`;
    return `${quando} · ${NOME_VOCE[p.voce] ?? p.voce} · ${QUANTO[p.tipo] ?? p.tipo}${p.n > 1 ? ` (${p.n} giorni)` : ""}`;
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return jsonError(401, "Missing authorization");

    const body = await req.json().catch(() => ({}));
    const requestId = String(body.request_id ?? "");
    const momento: "richiesta" | "decisione" = body.momento === "decisione" ? "decisione" : "richiesta";
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) return jsonError(400, "request_id mancante", "BAD_REQUEST");

    // Chi chiama deve appartenere all'azienda della richiesta: si legge il
    // suo profilo con il SUO token, non con il service role.
    const asUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: me } = await asUser.from("user_profiles").select("company_id").maybeSingle();
    const myCompany = (me?.company_id as string | null) ?? null;

    const { data: r } = await admin.from("leave_requests")
      .select("id, company_id, employee_id, stato, titolo, note_dipendente, motivazione, outlet_code, decisa_da_nome")
      .eq("id", requestId).maybeSingle();
    if (!r) return jsonError(404, "Richiesta non trovata", "NOT_FOUND");
    if (!myCompany || myCompany !== r.company_id) return jsonError(403, "Non autorizzato", "FORBIDDEN");

    const [{ data: giorni }, { data: dip }, { data: settings }, { data: referenti }] = await Promise.all([
      admin.from("leave_request_days").select("data, voce, tipo, ore, stato").eq("request_id", requestId),
      admin.from("employees").select("nome, cognome, first_name, last_name").eq("id", r.employee_id).maybeSingle(),
      admin.from("leave_settings").select("recipients, avvisa_alla_richiesta, avvisa_alla_decisione, app_url")
        .eq("company_id", r.company_id).maybeSingle(),
      admin.from("leave_approvers").select("email, outlet_code").eq("company_id", r.company_id).eq("attivo", true),
    ]);

    const acceso = momento === "richiesta"
      ? (settings?.avvisa_alla_richiesta ?? true)
      : (settings?.avvisa_alla_decisione ?? true);
    if (!acceso) return jsonOk({ data: { ok: true, mail: "skipped", reason: "avviso spento per questo momento" } });

    const daReferenti = ((referenti as { email: string | null; outlet_code: string | null }[] | null) ?? [])
      .filter((a) => a.email && (!a.outlet_code || a.outlet_code === r.outlet_code))
      .map((a) => String(a.email));
    const fissi = ((settings?.recipients as string[] | null) ?? []).filter(Boolean);
    const recipients = [...new Set([...daReferenti, ...fissi])];

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("DISTINTA_EMAIL_FROM");
    if (recipients.length === 0 || !resendKey || !from) {
      console.log(`[leave-notify] request=${requestId} mail=skipped recipients=${recipients.length}`);
      return jsonOk({ data: { ok: true, mail: "skipped", recipients } });
    }

    const gg = ((giorni as Giorno[] | null) ?? []).map((g) => ({ ...g, ore: Number(g.ore) }));
    const persona = [
      (dip?.cognome as string | null) ?? (dip?.last_name as string | null) ?? "",
      (dip?.nome as string | null) ?? (dip?.first_name as string | null) ?? "",
    ].filter(Boolean).join(" ").trim() || "un dipendente";

    const totOre = gg.reduce((s, g) => s + g.ore, 0);
    const concessi = gg.filter((g) => g.stato === "approvato");
    const appUrl = (settings?.app_url as string | null) ?? null;
    const link = appUrl ? `${appUrl.replace(/\/$/, "")}/dipendenti?view=ferie&ferie=approvazioni` : null;

    let subject: string;
    let apertura: string;
    let elenco: string[];

    if (momento === "richiesta") {
      subject = `Ferie da approvare: ${persona}`;
      apertura = `${persona}${r.outlet_code ? ` (${r.outlet_code})` : ""} ha chiesto ${gg.length} ${gg.length === 1 ? "giorno" : "giorni"}, ${ore(totOre)} in tutto.`;
      elenco = periodi(gg);
    } else {
      const esito = r.stato === "approvata" ? "approvata"
        : r.stato === "approvata_parziale" ? "approvata in parte"
          : r.stato === "respinta" ? "respinta" : String(r.stato);
      subject = `Ferie ${esito}: ${persona}`;
      apertura = r.stato === "approvata"
        ? `Concessi tutti i ${gg.length} ${gg.length === 1 ? "giorno" : "giorni"} chiesti da ${persona}.`
        : r.stato === "respinta"
          ? `Nessun giorno concesso a ${persona}.`
          : `A ${persona} sono stati concessi ${concessi.length} giorni su ${gg.length}.`;
      elenco = concessi.length ? periodi(concessi) : [];
    }

    const text = [
      apertura,
      r.titolo ? `Richiesta: ${r.titolo}` : "",
      "",
      ...elenco,
      "",
      momento === "richiesta" && r.note_dipendente ? `Nota: ${r.note_dipendente}` : "",
      momento === "decisione" && r.motivazione ? `Motivo: ${r.motivazione}` : "",
      momento === "decisione" && r.decisa_da_nome ? `Deciso da: ${r.decisa_da_nome}` : "",
      "",
      momento === "richiesta"
        ? (link ? `Rispondi qui: ${link}` : "Rispondi dalla scheda Ferie e permessi.")
        : "",
    ].filter((x) => x !== "").join("\n");

    const html = `<!doctype html><html lang="it"><body style="margin:0;padding:16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#0f172a">
<p style="margin:0 0 8px">${esc(apertura)}</p>
${r.titolo ? `<p style="margin:0 0 8px">Richiesta: <strong>${esc(r.titolo)}</strong></p>` : ""}
${elenco.length ? `<p style="margin:0 0 12px">${elenco.map((x) => esc(x)).join("<br>")}</p>` : ""}
${momento === "richiesta" && r.note_dipendente ? `<p style="margin:0 0 8px">Nota: ${esc(r.note_dipendente)}</p>` : ""}
${momento === "decisione" && r.motivazione ? `<p style="margin:0 0 8px">Motivo: ${esc(r.motivazione)}</p>` : ""}
${momento === "decisione" && r.decisa_da_nome ? `<p style="margin:0 0 8px">Deciso da: ${esc(r.decisa_da_nome)}</p>` : ""}
${momento === "richiesta" && link ? `<p style="margin:0"><a href="${esc(link)}">Rispondi alla richiesta</a></p>` : ""}
</body></html>`;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: recipients, subject, html, text }),
    });
    if (!resp.ok) {
      const errText = (await resp.text()).slice(0, 500);
      console.error(`[leave-notify] Resend ${resp.status}:`, errText);
      return jsonOk({ data: { ok: true, mail: "failed", error: `Resend ${resp.status}`, recipients } });
    }

    console.log(`[leave-notify] request=${requestId} momento=${momento} mail=sent to=${recipients.length}`);
    return jsonOk({ data: { ok: true, mail: "sent", recipients } });
  } catch (error) {
    console.error(`[leave-notify] Error:`, error);
    return jsonError(500, (error as Error).message);
  }
});
