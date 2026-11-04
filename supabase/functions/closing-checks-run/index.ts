// Edge Function: closing-checks-run
//
// L'istruttoria serale dei controlli. Il report delle chiusure elenca le cose
// «da controllare»; qui ognuna viene presa in carico: il gestionale cerca la
// prova nei dati che ha già, sistema quello che può dimostrare, e dice il
// resto in chiaro a chi guida e all'amministrazione. Dove c'è qualcosa da
// imparare, scrive al negozio.
//
// Nata dal report del 3 novembre 2026 (quattro righe): due erano un difetto
// del controllo, che confrontava una per una le due ricevute di versamento di
// Brugnato invece di sommarle (1.270 + 2.485 = 3.755, il campo era giusto);
// una era vera e la cassiera l'aveva già spiegata in nota (Palmanova, 75,84 €
// di una fattura pagata in contanti il 28 ottobre e non scritta); la quarta
// era quella stessa nota, segnalata come se fosse un problema a sé.
//
// Il confine, non negoziabile: il gestionale NON riscrive mai i numeri
// contati a mano (fondo cassa, contanti da versare). Quelli li sa solo chi è
// in negozio. Può aggiungere una riga che un documento dimostra, correggere
// un campo che è la copia di un documento, e spegnere una segnalazione falsa.
// Ogni cosa che scrive lascia la prova e si può annullare.
//
// Chi la chiama:
// - pg_cron → closing_checks_tick() → closing_checks_dispatch() con il
//   segreto condiviso x-autofix-cron: body { run_id, company_id, closing_date }
// - a mano, con il service role o da super_advisor/contabile, per una prova:
//   body { company_id?, closing_date, dry_run: true } non scrive e non manda
//   niente, restituisce solo cosa farebbe.
//
// Sicurezza: service role solo qui dentro, RESEND_API_KEY nei secret delle
// function, nessun valore di tenant nel codice (destinatari, tolleranza e
// instradamento stanno in daily_report_settings; gli indirizzi dei negozi in
// anagrafica outlet).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-autofix-cron",
};

const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const NON_SELLING = ["sede", "magazzino", "warehouse", "hq", "ufficio"];
/** Quanti giorni indietro si cerca una fattura pagata in contanti e non scritta. */
const GIORNI_FATTURA = 25;

function jsonError(status: number, message: string, code = "CLOSING_CHECKS_ERROR") {
  return new Response(JSON.stringify({ error: message, code, timestamp: new Date().toISOString() }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function jsonOk(payload: unknown) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function eur(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.round(Math.abs(n) * 100);
  const int = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${int},${String(abs % 100).padStart(2, "0")} €`;
}
function dataIt(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MESI[m - 1]} ${y}`;
}
function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
const r2 = (n: number) => Math.round(n * 100) / 100;
function romeToday(): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function giorniPrima(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
/**
 * Nome di battesimo di chi ha chiuso, per il saluto. Nelle chiusure si trova
 * sia «Marina Astuti» sia «Astuti Marina», quindi non si indovina: si cerca
 * quale parola è un nome vero nell'anagrafica dipendenti. Se nessuna lo è, si
 * saluta senza nome: meglio «Ciao,» che chiamare qualcuno col cognome.
 */
function nomeDiSaluto(closedBy: string | null, nomiVeri: Set<string>): string | null {
  const parti = (closedBy ?? "").trim().split(/[\s,]+/).filter(Boolean);
  for (const p of parti) {
    const chiave = p.toLowerCase();
    if (nomiVeri.has(chiave)) return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
  }
  return null;
}

/**
 * La nota come l'ha scritta la cassiera, senza le righe che il gestionale
 * aggiunge dopo (cominciano con «[gg/mm/aaaa»): citarle nel messaggio al
 * negozio lo renderebbe illeggibile.
 */
function notaDellaCassiera(notes: string | null): string {
  const pulita = (notes ?? "").split(/\[\d{2}\/\d{2}\/\d{4}/)[0].trim();
  return pulita.length > 220 ? `${pulita.slice(0, 217)}…` : pulita;
}

// ─── Tipi ────────────────────────────────────────────────────────────────
interface Settings {
  company_id: string; timezone: string | null; app_url: string | null;
  checks_recipients: string[]; checks_store_messages: boolean; checks_tolerance: number;
  checks_store_reply_to: string | null; checks_store_bcc: string[];
}
interface Outlet { id: string; name: string; email: string | null }
interface Closing {
  id: string; outlet_id: string; closing_date: string; status: string; is_closed_day: boolean;
  total_receipts: number; channels_total: number; invoices_total: number; receipts_difference: number;
  cash_expenses: number; customer_refunds: number; cash_deposit: number;
  cash_float_declared: number | null; cash_pending_declared: number | null;
  cash_float_expected: number | null; cash_difference: number | null;
  closed_by_name: string | null; notes: string | null;
}
interface Line { id: string; closing_id: string; channel_id: string; amount: number }
interface Channel { id: string; kind: string; label: string }
interface Att {
  id: string; closing_id: string; target: string; line_id: string | null; expense_id: string | null;
  extraction_status: string | null; extracted: Record<string, unknown> | null;
}
interface Expense { id: string; closing_id: string; kind: string; amount: number; description: string | null }

type Outcome = "falso_allarme" | "sistemato" | "da_fare" | "informazione";
type Kind = "differenza_cassa" | "differenza_corrispettivi" | "foto_diversa" | "foto_mancante" | "bozza" | "nota";
/** Che lezione mandare al negozio: una per tipo di errore, testo fisso. */
type Lezione = "spesa_in_ritardo" | "annullo_nel_totale" | "campo_diverso_dalla_foto" | "chiusura_in_bozza" | "foto_mancante" | null;

interface Check {
  outlet: Outlet; closing: Closing | null;
  kind: Kind; amount: number | null; detail: string; fingerprint: string;
  outcome: Outcome; reason: string | null; action: string | null;
  /** Versione corta e senza tecnicismi, per il messaggio al negozio. */
  reasonBreve?: string | null;
  undo_kind: "expense_row" | "fields" | null; undo_data: Record<string, unknown> | null;
  lezione: Lezione;
}

function numEstratto(e: Record<string, unknown> | null, key: string): number | null {
  if (!e) return null;
  const v = e[key];
  return typeof v === "number" && Number.isFinite(v) ? r2(v) : null;
}

// ─── Testi per il negozio ───────────────────────────────────────────────
// Quattro pezzi sempre: cosa si è visto, cos'era davvero, chi ha sistemato,
// come evitarlo. Niente parole da gestionale, niente colpe.
function testoLezione(l: Lezione, c: Check, nome: string | null): string | null {
  if (!l || !c.closing) return null;
  const saluto = nome ? `Ciao ${nome},` : "Ciao,";
  const giorno = dataIt(c.closing.closing_date);
  const perche = c.reasonBreve ?? c.reason ?? "";
  const firma = "\n\nSe qualcosa non ti torna rispondi a questa mail: la risposta arriva all'amministrazione.\n\nGrazie,\nGestionale New Zago";
  switch (l) {
    case "spesa_in_ritardo":
      return `${saluto}\n\nnella chiusura del ${giorno} in cassa mancavano ${eur(Math.abs(num(c.amount)))}. ${perche}\n\n${c.action ?? ""} La cassa adesso torna e tu non devi fare niente.\n\nPer le prossime volte: quando paghi qualcosa con i contanti della cassa, scrivila nella chiusura dello stesso giorno, al punto 2 «Spese pagate con i contanti», e fai la foto della fattura o dello scontrino. Non serve ricordare la cifra, basta la foto. Se la spesa si scrive giorni dopo, la cassa risulta in ammanco anche quando i conti sono giusti.${firma}`;
    case "annullo_nel_totale":
      return `${saluto}\n\nnella chiusura del ${giorno} c'era una differenza di ${eur(Math.abs(num(c.amount)))}, uguale agli annulli segnati sullo scontrino di chiusura. ${perche}\n\n${c.action ?? ""} Adesso torna tutto.\n\nPer le prossime volte: quando annulli uno scontrino pagato in contanti, nel punto 1 scrivi il totale e i contanti al netto dell'annullo, cioè solo i soldi che sono entrati davvero, e spiega in nota com'è andata. Lo scontrino del registratore quegli annulli li tiene ancora dentro.${firma}`;
    case "campo_diverso_dalla_foto":
      return `${saluto}\n\nnella chiusura del ${giorno} un numero scritto non combacia con la foto: ${c.detail}\n\nControlla con il documento in mano e, se serve, chiedi all'amministrazione di riaprire la giornata.\n\nPer le prossime volte: dopo aver fatto la foto, controlla che il numero scritto sia quello del documento. Il gestionale legge le foto e propone i numeri nei campi vuoti, ma l'ultima parola è la tua.${firma}`;
    case "chiusura_in_bozza":
      return `${saluto}\n\nla chiusura del ${giorno} è rimasta in bozza: i dati ci sono ma non è stata confermata, quindi per il gestionale la giornata non esiste e domani sera non sa da quanto contante ripartire.\n\nApri la chiusura e premi «Conferma chiusura». Se non riesci, scrivi all'amministrazione.${firma}`;
    case "foto_mancante":
      return `${saluto}\n\nnella chiusura del ${giorno} manca la foto dello scontrino di chiusura del registratore. È l'unica foto obbligatoria: senza quella nessuno può controllare i numeri della giornata.\n\nSe lo scontrino ce l'hai ancora, apri la giornata e caricalo.${firma}`;
    default:
      return null;
  }
}
function oggettoLezione(c: Check): string {
  const giorno = c.closing ? dataIt(c.closing.closing_date) : "";
  switch (c.lezione) {
    case "spesa_in_ritardo":
    case "annullo_nel_totale":
      return `${c.outlet.name}, chiusura del ${giorno}: abbiamo sistemato noi`;
    case "campo_diverso_dalla_foto":
      return `${c.outlet.name}, chiusura del ${giorno}: un numero da controllare`;
    case "chiusura_in_bozza":
      return `${c.outlet.name}, chiusura del ${giorno}: manca la conferma`;
    case "foto_mancante":
      return `${c.outlet.name}, chiusura del ${giorno}: manca la foto dello scontrino`;
    default:
      return `${c.outlet.name}, chiusura del ${giorno}`;
  }
}

// ─── L'istruttoria ──────────────────────────────────────────────────────
async function istruisci(
  admin: SupabaseClient, s: Settings, date: string, dryRun: boolean,
): Promise<{ checks: Check[]; outlets: number; chiusure: number; nomiVeri: Set<string> }> {
  const [{ data: outletRows }, { data: closingRows }, { data: channelRows }] = await Promise.all([
    admin.from("outlets").select("id, name, email").eq("company_id", s.company_id),
    admin.from("outlet_daily_closings")
      .select("id, outlet_id, closing_date, status, is_closed_day, total_receipts, channels_total, invoices_total, receipts_difference, cash_expenses, customer_refunds, cash_deposit, cash_float_declared, cash_pending_declared, cash_float_expected, cash_difference, closed_by_name, notes")
      .eq("company_id", s.company_id).eq("closing_date", date),
    admin.from("outlet_payment_channels").select("id, kind, label").eq("company_id", s.company_id),
  ]);

  const outlets = ((outletRows ?? []) as Outlet[]).filter((o) => !NON_SELLING.some((w) => o.name.toLowerCase().includes(w)));
  const closings = (closingRows ?? []) as Closing[];
  const channels = new Map(((channelRows ?? []) as Channel[]).map((c) => [c.id, c]));
  const ids = closings.map((c) => c.id);

  const [{ data: lineRows }, { data: attRows }, { data: expRows }] = ids.length > 0
    ? await Promise.all([
      admin.from("outlet_daily_closing_lines").select("id, closing_id, channel_id, amount").in("closing_id", ids),
      admin.from("outlet_daily_closing_attachments").select("id, closing_id, target, line_id, expense_id, extraction_status, extracted").in("closing_id", ids),
      admin.from("outlet_daily_closing_expenses").select("id, closing_id, kind, amount, description").in("closing_id", ids),
    ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const lines = (lineRows ?? []) as Line[];
  const atts = (attRows ?? []) as Att[];
  const expenses = (expRows ?? []) as Expense[];

  // I nomi di battesimo veri, per salutare chi ha chiuso col suo nome e non
  // col cognome: «Astuti Marina» → Marina.
  const { data: nomiRows } = await admin.from("employees").select("nome, first_name").eq("company_id", s.company_id);
  const nomiVeri = new Set(((nomiRows ?? []) as Array<{ nome: string | null; first_name: string | null }>)
    .flatMap((r) => [r.nome, r.first_name])
    .filter((n): n is string => !!n && n.trim().length > 1)
    .map((n) => n.trim().toLowerCase()));

  const checks: Check[] = [];

  for (const outlet of outlets) {
    const c = closings.find((x) => x.outlet_id === outlet.id);
    if (!c || c.is_closed_day) continue;

    const mieLinee = lines.filter((l) => l.closing_id === c.id);
    const mieFoto = atts.filter((a) => a.closing_id === c.id);
    const mieSpese = expenses.filter((e) => e.closing_id === c.id);
    const letteDi = (target: string) => mieFoto.filter((a) => a.target === target && ["letta", "da_rivedere"].includes(a.extraction_status ?? ""));
    const rigaContanti = mieLinee.find((l) => channels.get(l.channel_id)?.kind === "contanti");
    const nota = notaDellaCassiera(c.notes);
    const quadra = Math.abs(num(c.receipts_difference)) < 0.005 && (c.cash_difference == null || Math.abs(num(c.cash_difference)) < 0.005);
    void mieSpese;
    // Se la cassiera ha scritto una nota, quella spiegazione basta: non le si
    // riscrive per chiederle una cosa che ha già detto (regola: niente liste
    // da compilare a mano). La nota finisce nella mail di esito.
    const notaReason = nota ? `La cassiera ha scritto: «${nota}»` : null;

    const base = { outlet, closing: c } as const;

    // 1. Chiusura ancora in bozza
    if (c.status === "bozza") {
      checks.push({
        ...base, kind: "bozza", amount: null, fingerprint: "bozza",
        detail: "chiusura ancora in bozza, non confermata",
        outcome: "da_fare", reason: null, action: null, undo_kind: null, undo_data: null,
        lezione: "chiusura_in_bozza",
      });
    }

    // 2. Manca la foto dello scontrino di chiusura
    if (!mieFoto.some((a) => a.target === "totale")) {
      checks.push({
        ...base, kind: "foto_mancante", amount: null, fingerprint: "totale",
        detail: "manca la foto dello scontrino di chiusura",
        outcome: "da_fare", reason: null, action: null, undo_kind: null, undo_data: null,
        lezione: "foto_mancante",
      });
    }

    // 3. Foto diverse da quanto scritto.
    //    Il versamento può avere più ricevute: lì conta la SOMMA (Brugnato,
    //    3 novembre). Il totale può avere più foto che sono documenti diversi
    //    (chiusura del registratore e scontrini POS): basta che una combaci.
    const versFoto = letteDi("versamento").map((a) => numEstratto(a.extracted, "amount")).filter((v): v is number => v != null);
    if (versFoto.length > 0) {
      const somma = r2(versFoto.reduce((a, b) => a + b, 0));
      const scritto = num(c.cash_deposit);
      const unaCombacia = versFoto.some((v) => Math.abs(v - scritto) < 0.005);
      if (Math.abs(somma - scritto) < 0.005 && versFoto.length > 1) {
        checks.push({
          ...base, kind: "foto_diversa", amount: scritto, fingerprint: "versamento",
          detail: `versamento scritto ${eur(scritto)}`,
          outcome: "falso_allarme",
          reason: `Le ricevute sono ${versFoto.length} e sommano a ${eur(somma)}: ${versFoto.map((v) => eur(v)).join(" + ")}. Il campo è giusto.`,
          action: null, undo_kind: null, undo_data: null, lezione: null,
        });
      } else if (!unaCombacia && Math.abs(somma - scritto) >= 0.005) {
        checks.push({
          ...base, kind: "foto_diversa", amount: scritto, fingerprint: "versamento",
          detail: `versamento scritto ${eur(scritto)} ma dalle ricevute risulta ${eur(somma)}${versFoto.length > 1 ? ` (${versFoto.map((v) => eur(v)).join(" + ")})` : ""}`,
          outcome: "da_fare", reason: notaReason, action: null, undo_kind: null, undo_data: null,
          lezione: nota ? null : "campo_diverso_dalla_foto",
        });
      }
    }

    const totFoto = letteDi("totale").map((a) => numEstratto(a.extracted, "amount")).filter((v): v is number => v != null);
    if (totFoto.length > 0) {
      const scritto = num(c.total_receipts);
      if (!totFoto.some((v) => Math.abs(v - scritto) < 0.005)) {
        checks.push({
          ...base, kind: "foto_diversa", amount: scritto, fingerprint: "totale",
          detail: `totale corrispettivi scritto ${eur(scritto)} ma dalla foto risulta ${totFoto.map((v) => eur(v)).join(" oppure ")}`,
          outcome: "da_fare", reason: notaReason, action: null, undo_kind: null, undo_data: null,
          lezione: nota ? null : "campo_diverso_dalla_foto",
        });
      }
    }

    for (const a of letteDi("canale")) {
      const letto = numEstratto(a.extracted, "amount");
      const l = mieLinee.find((x) => x.id === a.line_id);
      if (letto == null || !l) continue;
      const etichetta = channels.get(l.channel_id)?.label ?? "canale";
      if (Math.abs(num(l.amount) - letto) >= 0.005) {
        checks.push({
          ...base, kind: "foto_diversa", amount: num(l.amount), fingerprint: `canale:${l.id}`,
          detail: `${etichetta} scritto ${eur(num(l.amount))} ma dalla foto risulta ${eur(letto)}`,
          outcome: "da_fare", reason: notaReason, action: null, undo_kind: null, undo_data: null,
          lezione: nota ? null : "campo_diverso_dalla_foto",
        });
      }
    }

    // 4. Corrispettivi e mezzi di pagamento che non tornano
    const diffCorr = num(c.receipts_difference);
    if (Math.abs(diffCorr) >= 0.005) {
      const annulli = letteDi("totale").map((a) => numEstratto(a.extracted, "cancellations_total")).find((v) => v != null && v > 0) ?? null;
      if (annulli != null && Math.abs(diffCorr - annulli) < 0.005) {
        const prima = num(c.total_receipts);
        const dopo = r2(prima - annulli);
        const action = `Totale corrispettivi riportato al netto dell'annullo: da ${eur(prima)} a ${eur(dopo)}.`;
        if (!dryRun) {
          await admin.from("outlet_daily_closings").update({ total_receipts: dopo }).eq("id", c.id);
        }
        checks.push({
          ...base, kind: "differenza_corrispettivi", amount: diffCorr, fingerprint: "annullo",
          detail: `totale incassato e somma dei mezzi di pagamento non quadrano (differenza ${eur(diffCorr)})`,
          outcome: "sistemato",
          reason: `Lo scontrino di chiusura segna ${eur(annulli)} di annulli, esattamente la differenza: il totale era scritto lordo.`,
          reasonBreve: "Il totale era scritto compresi gli annulli, che invece non sono soldi incassati.",
          action, undo_kind: "fields", undo_data: { total_receipts: prima },
          lezione: "annullo_nel_totale",
        });
      } else {
        checks.push({
          ...base, kind: "differenza_corrispettivi", amount: diffCorr, fingerprint: "diff",
          detail: `totale incassato e somma dei mezzi di pagamento non quadrano (differenza ${eur(diffCorr)})`,
          outcome: "da_fare", reason: notaReason,
          action: null, undo_kind: null, undo_data: null, lezione: nota ? null : "campo_diverso_dalla_foto",
        });
      }
    }

    // 5. Il contante in cassa
    const diffCassa = c.cash_difference == null ? null : num(c.cash_difference);
    if (diffCassa != null && Math.abs(diffCassa) >= 0.005) {
      const tol = num(s.checks_tolerance);
      const annulli = letteDi("totale").map((a) => numEstratto(a.extracted, "cancellations_total")).find((v) => v != null && v > 0) ?? null;

      if (Math.abs(diffCassa) <= tol) {
        // Arrotondamento. Spesso il giorno vicino ha l'opposto: Franciacorta
        // +0,16 il 15 e -0,16 il 16, -0,20 il 24 e +0,20 il 25 di ottobre.
        const { data: vicini } = await admin.from("outlet_daily_closings")
          .select("closing_date, cash_difference")
          .eq("outlet_id", outlet.id)
          .gte("closing_date", giorniPrima(date, 3)).lte("closing_date", date)
          .neq("id", c.id);
        const compensa = ((vicini ?? []) as Array<{ closing_date: string; cash_difference: number | null }>)
          .find((v) => v.cash_difference != null && Math.abs(num(v.cash_difference) + diffCassa) < 0.005);
        checks.push({
          ...base, kind: "differenza_cassa", amount: diffCassa, fingerprint: "arrotondamento",
          detail: `contante in cassa ${diffCassa > 0 ? "in eccedenza" : "in ammanco"} di ${eur(Math.abs(diffCassa))}`,
          outcome: "falso_allarme",
          reason: compensa
            ? `Arrotondamento sotto la tolleranza di ${eur(tol)}, e il ${dataIt(compensa.closing_date)} c'era la differenza opposta: si compensano.`
            : `Arrotondamento sotto la tolleranza di ${eur(tol)}.`,
          action: null, undo_kind: null, undo_data: null, lezione: null,
        });
      } else if (annulli != null && diffCassa < 0 && Math.abs(diffCassa + annulli) < 0.005 && rigaContanti && num(rigaContanti.amount) >= annulli) {
        // L'annullo era in contanti: quei soldi non sono entrati, ma nei
        // totali del registratore ci sono ancora (Franciacorta, 12 ottobre).
        const totPrima = num(c.total_receipts);
        const cashPrima = num(rigaContanti.amount);
        const totDopo = r2(totPrima - annulli);
        const cashDopo = r2(cashPrima - annulli);
        const action = `Totale e contanti riportati al netto dell'annullo: ${eur(totPrima)} → ${eur(totDopo)} e ${eur(cashPrima)} → ${eur(cashDopo)}.`;
        if (!dryRun) {
          await admin.from("outlet_daily_closing_lines").update({ amount: cashDopo }).eq("id", rigaContanti.id);
          await admin.from("outlet_daily_closings").update({ total_receipts: totDopo }).eq("id", c.id);
        }
        checks.push({
          ...base, kind: "differenza_cassa", amount: diffCassa, fingerprint: "annullo_contanti",
          detail: `contante in cassa in ammanco di ${eur(Math.abs(diffCassa))}`,
          outcome: "sistemato",
          reason: `Lo scontrino di chiusura segna ${eur(annulli)} di annulli, esattamente la cifra che manca: lo scontrino annullato era in contanti, quindi quei soldi non sono mai entrati.`,
          reasonBreve: "Lo scontrino annullato era in contanti, quindi quei soldi non sono mai entrati in cassa.",
          action, undo_kind: "fields", undo_data: { total_receipts: totPrima, line_id: rigaContanti.id, line_amount: cashPrima },
          lezione: "annullo_nel_totale",
        });
      } else {
        // Una fattura pagata con i contanti della cassa e non scritta?
        // (Palmanova, 3 novembre: RICA GEST del 28 ottobre, 75,84 €.)
        let sistemata = false;
        if (diffCassa < 0) {
          const importo = r2(Math.abs(diffCassa));
          const { data: cand } = await admin.from("payables")
            .select("id, supplier_name, invoice_number, invoice_date, gross_amount, payment_method")
            .eq("company_id", s.company_id).eq("gross_amount", importo)
            .gte("invoice_date", giorniPrima(date, GIORNI_FATTURA)).lte("invoice_date", date);
          const fatture = ((cand ?? []) as Array<{ id: string; supplier_name: string | null; invoice_number: string | null; invoice_date: string; gross_amount: number; payment_method: string | null }>)
            .filter((f) => (f.payment_method ?? "") === "contanti");
          // Già scritta in una chiusura? Si cerca il numero nelle righe.
          const giaScritte = new Set(expenses.filter((e) => e.kind === "pagamento_fattura").map((e) => (e.description ?? "").toLowerCase()));
          const libere = fatture.filter((f) => !Array.from(giaScritte).some((d) => f.invoice_number && d.includes(f.invoice_number.toLowerCase())));
          if (libere.length === 1) {
            const f = libere[0];
            const descr = `Fattura ${f.supplier_name ?? "fornitore"} ${f.invoice_number ?? ""} del ${dataIt(f.invoice_date)}, pagata con i contanti della cassa`.replace(/\s+/g, " ").trim();
            if (!dryRun) {
              await admin.from("outlet_daily_closing_expenses").insert({
                closing_id: c.id, company_id: s.company_id, outlet_id: outlet.id,
                kind: "pagamento_fattura", amount: importo, description: descr, sort_order: 0,
              });
            }
            checks.push({
              ...base, kind: "differenza_cassa", amount: diffCassa, fingerprint: "fattura_in_contanti",
              detail: `contante in cassa in ammanco di ${eur(Math.abs(diffCassa))}`,
              outcome: "sistemato",
              reason: `È la fattura ${f.supplier_name ?? ""} ${f.invoice_number ?? ""} del ${dataIt(f.invoice_date)}, ${eur(num(f.gross_amount))}, pagata in contanti e già segnata come pagata ai fornitori${nota ? `; la cassiera l'aveva scritto in nota: «${nota}»` : ""}.`.replace(/\s+/g, " "),
              reasonBreve: `Avevi ragione: era la fattura ${f.supplier_name ?? "del fornitore"} ${f.invoice_number ?? ""} del ${dataIt(f.invoice_date)}, pagata con i contanti della cassa.`.replace(/\s+/g, " "),
              action: "L'abbiamo registrata noi come fattura pagata in contanti.",
              undo_kind: "expense_row", undo_data: { payable_id: f.id, amount: importo, description: descr },
              lezione: "spesa_in_ritardo",
            });
            sistemata = true;
          } else if (libere.length > 1) {
            checks.push({
              ...base, kind: "differenza_cassa", amount: diffCassa, fingerprint: "fatture_possibili",
              detail: `contante in cassa in ammanco di ${eur(Math.abs(diffCassa))}`,
              outcome: "da_fare",
              reason: `Ci sono ${libere.length} fatture pagate in contanti da ${eur(importo)} che potrebbero essere questa: ${libere.map((f) => `${f.supplier_name ?? ""} ${f.invoice_number ?? ""} del ${dataIt(f.invoice_date)}`).join("; ")}. Serve una persona per scegliere.`,
              action: null, undo_kind: null, undo_data: null, lezione: null,
            });
            sistemata = true;
          }
        }
        if (!sistemata) {
          checks.push({
            ...base, kind: "differenza_cassa", amount: diffCassa, fingerprint: "da_capire",
            detail: `contante in cassa ${diffCassa > 0 ? "in eccedenza" : "in ammanco"} di ${eur(Math.abs(diffCassa))}`,
            outcome: "da_fare",
            reason: nota
              ? `La cassiera ha scritto: «${nota}». Nei documenti non si trova niente che spieghi la cifra.`
              : "Nessuna nota della cassiera e nessun documento che spieghi la cifra.",
            action: null, undo_kind: null, undo_data: null, lezione: null,
          });
        }
      }
    }

    // 6. La nota della cassiera su una giornata che quadra: è informazione,
    //    non un problema. Prima finiva fra le cose «da controllare».
    if (nota && quadra) {
      checks.push({
        ...base, kind: "nota", amount: null, fingerprint: "nota",
        detail: `nota della cassiera «${nota}»`,
        outcome: "informazione", reason: "La giornata quadra: la nota è una spiegazione, non un problema.",
        action: null, undo_kind: null, undo_data: null, lezione: null,
      });
    }
  }

  return { checks, outlets: outlets.length, chiusure: closings.filter((c) => !c.is_closed_day).length, nomiVeri };
}

// ─── La mail di esito ───────────────────────────────────────────────────
function renderEsito(date: string, checks: Check[], messaggi: Array<{ outlet: string; to: string; subject: string; text: string; error?: string | null }>, appUrl: string | null) {
  const perEsito = (o: Outcome) => checks.filter((c) => c.outcome === o);
  const daFare = perEsito("da_fare");
  const sistemati = perEsito("sistemato");
  const falsi = perEsito("falso_allarme");
  const note = perEsito("informazione");

  const titolo = `Chiusure ${dataIt(date)}: ${daFare.length === 0 ? "niente da fare" : daFare.length === 1 ? "1 cosa da fare" : `${daFare.length} cose da fare`}${sistemati.length > 0 ? `, ${sistemati.length} sistemat${sistemati.length === 1 ? "a" : "e"}` : ""}`;

  const blocco = (nome: string, colore: string, righe: string[]) => righe.length === 0 ? "" :
    `<h3 style="margin:18px 0 6px;font-size:14px;color:${colore}">${esc(nome)}</h3><ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.55;color:#0f172a">${righe.map((r) => `<li style="margin-bottom:6px">${r}</li>`).join("")}</ul>`;

  const rigaDaFare = (c: Check) => `<strong>${esc(c.outlet.name)}</strong>: ${esc(c.detail)}${c.reason ? `<br><span style="color:#475569">${esc(c.reason)}</span>` : ""}`;
  const rigaSistemato = (c: Check) => `<strong>${esc(c.outlet.name)}</strong>: ${esc(c.detail)}<br><span style="color:#475569">${esc(c.reason ?? "")}</span><br><span style="color:#047857">${esc(c.action ?? "")}</span>`;
  const rigaFalso = (c: Check) => `<strong>${esc(c.outlet.name)}</strong>: ${esc(c.reason ?? c.detail)}`;
  const rigaNota = (c: Check) => `<strong>${esc(c.outlet.name)}</strong>: ${esc(c.detail)}`;

  const messaggiHtml = messaggi.length === 0 ? "" :
    `<h3 style="margin:18px 0 6px;font-size:14px;color:#334155">Detto al negozio</h3>${messaggi.map((m) => `<div style="margin:0 0 10px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:13px"><div style="color:#64748b;margin-bottom:4px">${esc(m.outlet)} · ${esc(m.to)}${m.error ? ` · <span style="color:#b91c1c">non inviata: ${esc(m.error)}</span>` : ""}</div><div style="white-space:pre-wrap;color:#0f172a">${esc(m.text)}</div></div>`).join("")}`;

  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<div style="max-width:720px;margin:0 auto;padding:20px">
<div style="background:#fff;border-radius:12px;padding:20px">
<h2 style="margin:0 0 4px;font-size:17px;color:#0f172a">${esc(titolo)}</h2>
<p style="margin:0 0 14px;font-size:12px;color:#64748b">Controlli delle chiusure di cassa, ${esc(dataIt(date))}. Il gestionale ha guardato ogni segnalazione e qui sotto c'è come è finita.</p>
${blocco("Da fare", "#b91c1c", daFare.map(rigaDaFare))}
${daFare.length === 0 ? `<p style="margin:14px 0 0;font-size:13px;color:#047857"><strong>Da fare: niente.</strong></p>` : ""}
${blocco("Sistemato dal gestionale", "#047857", sistemati.map(rigaSistemato))}
${sistemati.length > 0 ? `<p style="margin:6px 0 0;font-size:12px;color:#64748b">Se una correzione non è giusta, apri la giornata nel gestionale e annullala.</p>` : ""}
${blocco("Niente da fare", "#475569", falsi.map(rigaFalso))}
${blocco("Note dai negozi", "#475569", note.map(rigaNota))}
${messaggiHtml}
${appUrl ? `<p style="margin:16px 0 0"><a href="${esc(appUrl)}/incassi-giornalieri" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:9px 14px;border-radius:8px;font-size:13px">Apri gli incassi giornalieri</a></p>` : ""}
<p style="margin:16px 0 0;font-size:11px;color:#94a3b8">Mail automatica del gestionale. Ogni esito è scritto accanto alla giornata, con la prova e chi l'ha deciso.</p>
</div></div></body></html>`;

  const text = [
    titolo, "",
    daFare.length ? `DA FARE:\n${daFare.map((c) => `- ${c.outlet.name}: ${c.detail}${c.reason ? ` (${c.reason})` : ""}`).join("\n")}` : "DA FARE: niente.",
    sistemati.length ? `\nSISTEMATO:\n${sistemati.map((c) => `- ${c.outlet.name}: ${c.detail}. ${c.reason ?? ""} ${c.action ?? ""}`).join("\n")}` : "",
    falsi.length ? `\nNIENTE DA FARE:\n${falsi.map((c) => `- ${c.outlet.name}: ${c.reason ?? c.detail}`).join("\n")}` : "",
    note.length ? `\nNOTE DAI NEGOZI:\n${note.map((c) => `- ${c.outlet.name}: ${c.detail}`).join("\n")}` : "",
    messaggi.length ? `\nDETTO AL NEGOZIO:\n${messaggi.map((m) => `- ${m.outlet} (${m.to})${m.error ? ` NON INVIATA: ${m.error}` : ""}\n${m.text}`).join("\n\n")}` : "",
  ].filter(Boolean).join("\n");

  return { subject: titolo, html, text };
}

async function inviaMail(to: string[], subject: string, html: string, text: string, replyTo?: string | null, bcc?: string[]): Promise<string | null> {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("DISTINTA_EMAIL_FROM");
  if (!key || !from) return "RESEND_API_KEY o DISTINTA_EMAIL_FROM assenti";
  const body: Record<string, unknown> = { from, to, subject, html, text };
  if (replyTo) body.reply_to = replyTo;
  if (bcc && bcc.length > 0) body.bcc = bcc;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = (await r.text()).slice(0, 400);
    console.error(`[closing-checks-run] Resend ${r.status}:`, err);
    return `Resend ${r.status}: ${err}`;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Metodo non consentito", "METHOD_NOT_ALLOWED");

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return jsonError(500, "Ambiente incompleto", "ENV_MISSING");
  const admin = createClient(supabaseUrl, serviceKey);

  let runId: string | null = null;
  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const body = await req.json().catch(() => ({}));

    let trusted = token === serviceKey;
    const cronHeader = req.headers.get("x-autofix-cron") ?? "";
    if (!trusted && cronHeader) {
      const { data: cronSecret } = await admin.rpc("get_autofix_cron_secret");
      const expected = Array.isArray(cronSecret) ? String((cronSecret[0] as { secret?: string } | undefined)?.secret ?? "") : "";
      trusted = expected.length > 0 && cronHeader === expected;
      if (!trusted) return jsonError(403, "Segreto x-autofix-cron non valido", "FORBIDDEN");
    }

    let companyId = String(body.company_id ?? "");
    const date = String(body.closing_date ?? romeToday());
    const dryRun = body.dry_run === true;
    runId = body.run_id ? String(body.run_id) : null;

    if (!trusted) {
      // Utente loggato: solo chi amministra, e solo per vedere cosa farebbe.
      const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
      const { data: me } = await asUser.auth.getUser();
      if (!me?.user) return jsonError(401, "Non autenticato", "UNAUTHORIZED");
      const { data: prof } = await admin.from("user_profiles").select("company_id, role").eq("id", me.user.id).single();
      const ruolo = String((prof as { role?: string } | null)?.role ?? "");
      if (!["super_advisor", "contabile"].includes(ruolo)) return jsonError(403, "Serve il ruolo super advisor o contabile", "FORBIDDEN");
      companyId = String((prof as { company_id?: string } | null)?.company_id ?? "");
      if (!dryRun) return jsonError(403, "Da qui si può solo chiedere una prova (dry_run)", "DRY_RUN_ONLY");
    }
    if (!companyId) return jsonError(400, "company_id mancante", "BAD_REQUEST");

    const { data: setRow } = await admin.from("daily_report_settings")
      .select("company_id, timezone, app_url, checks_recipients, checks_store_messages, checks_tolerance, checks_store_reply_to, checks_store_bcc")
      .eq("company_id", companyId).single();
    if (!setRow) return jsonError(404, "Impostazioni del report non trovate", "NO_SETTINGS");
    const s = setRow as Settings;

    const { checks, outlets, chiusure, nomiVeri } = await istruisci(admin, s, date, dryRun);

    // Le segnalazioni restano scritte accanto alla giornata, con la prova.
    if (!dryRun && checks.length > 0) {
      const rows = checks.map((c) => ({
        company_id: s.company_id, outlet_id: c.outlet.id, closing_id: c.closing?.id ?? null,
        closing_date: date, kind: c.kind, amount: c.amount, detail: c.detail,
        outcome: c.outcome, reason: c.reason, action: c.action,
        undo_kind: c.undo_kind, undo_data: c.undo_data, fingerprint: c.fingerprint,
        resolved_at: c.outcome === "da_fare" ? null : new Date().toISOString(),
      }));
      const { error } = await admin.from("closing_checks").upsert(rows, { onConflict: "closing_id,kind,fingerprint" });
      if (error) console.error("[closing-checks-run] closing_checks:", error.message);
    }

    // Messaggi ai negozi: uno per negozio, con tutte le righe che lo riguardano.
    const messaggi: Array<{ outlet: string; to: string; subject: string; text: string; error?: string | null }> = [];
    if (s.checks_store_messages) {
      const conLezione = checks.filter((c) => c.lezione != null);
      const perOutlet = new Map<string, Check[]>();
      for (const c of conLezione) {
        const l = perOutlet.get(c.outlet.id) ?? [];
        l.push(c);
        perOutlet.set(c.outlet.id, l);
      }
      for (const [outletId, lista] of perOutlet) {
        const outlet = lista[0].outlet;
        if (!outlet.email) {
          messaggi.push({ outlet: outlet.name, to: "(indirizzo mancante in anagrafica)", subject: "", text: "", error: "il negozio non ha un indirizzo mail in anagrafica" });
          continue;
        }
        const nome = nomeDiSaluto(lista[0].closing?.closed_by_name ?? null, nomiVeri);
        const testi = lista.map((c) => testoLezione(c.lezione, c, nome)).filter((t): t is string => !!t);
        if (testi.length === 0) continue;
        const subject = oggettoLezione(lista[0]);
        const text = testi.join("\n\n———\n\n");
        const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"><div style="max-width:620px;margin:0 auto;padding:20px"><div style="background:#fff;border-radius:12px;padding:20px;font-size:14px;line-height:1.6;color:#0f172a;white-space:pre-wrap">${esc(text)}</div><p style="margin:12px 0 0;font-size:11px;color:#94a3b8;text-align:center">Messaggio automatico, dal controllo delle chiusure della sera.</p></div></body></html>`;
        let err: string | null = null;
        if (!dryRun) {
          err = await inviaMail([outlet.email], subject, html, text, s.checks_store_reply_to, s.checks_store_bcc);
          for (const c of lista) {
            await admin.from("closing_checks").update({
              message_to: outlet.email, message_text: text,
              message_sent_at: err ? null : new Date().toISOString(), message_error: err,
            }).eq("closing_id", c.closing?.id ?? "").eq("kind", c.kind).eq("fingerprint", c.fingerprint);
          }
        }
        messaggi.push({ outlet: outlet.name, to: outlet.email, subject, text, error: err });
        void outletId;
      }
    }

    // La mail di esito parte solo se c'è qualcosa da dire.
    const daDire = checks.some((c) => c.outcome !== "informazione") || messaggi.length > 0;
    const { subject, html, text } = renderEsito(date, checks, messaggi, s.app_url);
    let mailError: string | null = null;
    if (!dryRun && daDire && s.checks_recipients.length > 0) {
      mailError = await inviaMail(s.checks_recipients, subject, html, text);
    }

    const summary = {
      outlets, chiusure, checks: checks.length,
      da_fare: checks.filter((c) => c.outcome === "da_fare").length,
      sistemati: checks.filter((c) => c.outcome === "sistemato").length,
      falsi_allarmi: checks.filter((c) => c.outcome === "falso_allarme").length,
      note: checks.filter((c) => c.outcome === "informazione").length,
      messaggi: messaggi.length,
      mail_error: mailError,
    };

    if (!dryRun && runId) {
      await admin.from("closing_check_runs").update({
        status: mailError ? "error" : "done", finished_at: new Date().toISOString(),
        summary, error: mailError, mail_sent_at: mailError || !daDire ? null : new Date().toISOString(),
      }).eq("id", runId);
    }

    console.log(`[closing-checks-run] company=${companyId} date=${date} dry=${dryRun} checks=${checks.length} da_fare=${summary.da_fare} sistemati=${summary.sistemati} messaggi=${messaggi.length}`);
    return jsonOk({ data: { date, dry_run: dryRun, summary, subject, checks: checks.map((c) => ({ outlet: c.outlet.name, kind: c.kind, outcome: c.outcome, detail: c.detail, reason: c.reason, action: c.action })), messaggi } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[closing-checks-run] Error:", message);
    if (runId) {
      await admin.from("closing_check_runs").update({ status: "error", finished_at: new Date().toISOString(), error: message.slice(0, 500) }).eq("id", runId);
    }
    return jsonError(500, message);
  }
});
