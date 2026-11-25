// Il messaggio per una persona: tutto quello che e' cambiato nei suoi turni pubblicati
// da quando l'ultimo avviso e' partito, in una notifica sola (migration 466).
// Senza dipendenze da Deno: lo provano anche i test del frontend (src/lib/avvisiTurni.test.ts).

export interface AvvisoTurno {
  id: number;
  shift_id: string;
  data: string;
  tipo: "pubblicato" | "cambiato" | "tolto";
  prima: { inizio: string; fine: string; data: string; outlet_id?: string | null } | null;
  dopo: { inizio: string; fine: string; data: string; outlet_id?: string | null } | null;
  negozio?: string | null;
}

const GIORNI = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
const giorno = (d: string) => `${GIORNI[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
const ore = (t: { inizio: string; fine: string }) => `${t.inizio.slice(0, 5)}-${t.fine.slice(0, 5)}`;

/**
 * Per ogni turno conta solo com'era prima del primo avviso e com'e' dopo l'ultimo: un turno
 * pubblicato e poi tolto prima dell'invio non dice niente, uno cambiato due volte dice solo
 * l'orario finale. `null` = niente da dire.
 */
export function riassuntoAvvisi(avvisi: AvvisoTurno[]): { titolo: string; corpo: string } | null {
  const perTurno = new Map<string, AvvisoTurno[]>();
  for (const a of avvisi) perTurno.set(a.shift_id, [...(perTurno.get(a.shift_id) ?? []), a]);
  const nuovi: { data: string; dopo: NonNullable<AvvisoTurno["dopo"]> }[] = [];
  const righe: { data: string; testo: string }[] = [];
  for (const lista of perTurno.values()) {
    lista.sort((x, y) => x.id - y.id);
    const inizio = lista[0].tipo === "pubblicato" ? null : lista[0].prima;
    const fine = lista[lista.length - 1].tipo === "tolto" ? null : lista[lista.length - 1].dopo;
    if (!inizio && !fine) continue;
    const stessoNegozio = !inizio || !fine || (inizio.outlet_id ?? null) === (fine.outlet_id ?? null);
    if (inizio && fine && inizio.data === fine.data && ore(inizio) === ore(fine) && stessoNegozio) continue;
    if (!inizio && fine) { nuovi.push({ data: fine.data, dopo: fine }); continue; }
    if (inizio && !fine) { righe.push({ data: inizio.data, testo: `${giorno(inizio.data)} tolto (era ${ore(inizio)})` }); continue; }
    if (inizio && fine) {
      const negozio = lista[lista.length - 1].negozio;
      righe.push({ data: fine.data, testo: inizio.data === fine.data && ore(inizio) === ore(fine)
        ? `${giorno(fine.data)} ${ore(fine)} in un altro negozio${negozio ? ` (${negozio})` : ""}`
        : inizio.data === fine.data
        ? `${giorno(fine.data)} ora ${ore(fine)} (era ${ore(inizio)})`
        : `${giorno(inizio.data)} ${ore(inizio)} spostato a ${giorno(fine.data)} ${ore(fine)}` });
    }
  }
  if (!nuovi.length && !righe.length) return null;

  // Tanti turni nuovi e nessun cambio: e' la settimana appena pubblicata
  if (!righe.length && nuovi.length >= 3) {
    const date = nuovi.map((n) => n.data).sort();
    return { titolo: "Il tuo orario è pronto", corpo: `Sono pubblicati ${nuovi.length} turni, dal ${giorno(date[0])} al ${giorno(date[date.length - 1])}. Aprili nell'app.` };
  }
  const tutte = [...righe, ...nuovi.map((n) => ({ data: n.data, testo: `${giorno(n.data)} nuovo turno ${ore(n.dopo)}` }))]
    .sort((a, b) => a.data.localeCompare(b.data));
  const mostrate = tutte.slice(0, 4).map((r) => r.testo);
  if (tutte.length > 4) mostrate.push(`e altri ${tutte.length - 4} cambi`);
  return {
    titolo: righe.length ? "Il tuo orario è cambiato" : tutte.length === 1 ? "Hai un turno nuovo" : "Hai dei turni nuovi",
    corpo: `${mostrate.join("; ")}. Guarda l'app.`,
  };
}
