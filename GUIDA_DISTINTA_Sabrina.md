# Guida operativa — Scadenzario e Distinta pagamenti (per Sabrina)

> Guida funzione per funzione del ciclo pagamenti fornitori: dalla scelta delle fatture
> alla distinta, fino alla chiusura tramite riconciliazione bancaria.
> La stessa guida è disponibile **dentro il gestionale**: pulsante **?** in basso a destra
> nella pagina **Scadenzario**.

---

## Il principio in una frase

**Niente si chiude prima del pagamento vero.** La distinta è una *disposizione* (l'ordine di
pagare). Fattura e note di credito restano **in attesa** finché il bonifico non arriva davvero
in banca e viene **riconciliato**. Solo allora si chiudono, insieme.

Il ciclo ha **3 momenti**:

| Momento | Cosa fai | Cosa scrive il gestionale |
|---|---|---|
| **1. Predisposizione** | "Crea distinta" → anteprima, la mandi a chi paga | **niente** |
| **2. Conferma** | al ritorno, "Conferma distinta" | mette le fatture **in sospeso** + banca prevista (non "pagate") |
| **3. Pagamento** | il bonifico arriva e viene riconciliato | la fattura **si chiude** (e le NC collegate con lei) |

---

## Passo per passo

### ① Seleziona le fatture da pagare
Spunta la casella a sinistra di ogni riga. In basso compare la **barra azioni** con:
- il numero di fatture e il **totale**;
- per **ogni banca in uso**: **saldo attuale → saldo residuo stimato** (aggiornato mentre spunti),
  così tieni sempre d'occhio quanto resta su ogni conto.

### ② Assegna Banca e Tipo
Sotto la riga selezionata si apre un pannello:
- **Banca**: da quale conto esce il bonifico (mostra il saldo residuo di ciascuno).
- **Tipo**:
  - **Saldo** = paghi tutto il residuo della fattura;
  - **Parziale** = **acconto**: scrivi tu l'importo (campo "Acconto (lordo)").
- Sotto vedi **in tempo reale** l'etichetta **ACCONTO / SALDO** (con la rata, es. *SALDO (rata 3/3)*)
  e il **netto del bonifico**.

> **ACCONTO o SALDO?**
> • "Parziale" → **ACCONTO**. • Rata intermedia di un piano (es. 1/3, 2/3) → **ACCONTO**.
> • Pagamento pieno o ultima rata → **SALDO**.

### ③ Note di credito (compensazione)
Se il fornitore ha **note di credito aperte**, nel pannello compaiono i pulsanti
**"Scala note di credito"**. Selezionandone una o più:
- l'importo del bonifico **scende** del loro valore (netto = fattura − NC);
- la **causale** si compone da sola: *"…al netto NC n.123 (1.000,00) e NC n.124 (1.000,00)"* —
  pronta da riportare nel bonifico.

**Esempio.** Fattura GGZ 8.000 € con 2 NC da 1.000 €: spunti le due NC → bonifichi **6.000 €**,
causale *"SALDO fatt. 1375/01 al netto NC n.X e NC n.Y"*.

> ⚠️ Le NC **non si chiudono** in questo momento. È solo un'**intenzione**: si chiuderanno con la
> fattura al pagamento (vedi ⑧).

### ④ Crea distinta (anteprima)
"Crea distinta" produce l'**anteprima**: email + riepilogo per banca (saldo prima/dopo, totali).
**Non scrive nulla** sul gestionale: puoi rileggerla, correggere e rigenerare quante volte vuoi.
Copiala o mandala via **Gmail** a chi esegue i bonifici.

### ⑤ Conferma distinta
Quando torni, premi **"Conferma distinta"**. Le fatture passano **IN SOSPESO**: escono dalla lista
attiva dello scadenzario e restano **in attesa** del riscontro bancario. **Non** vengono segnate come
pagate.

### ⑥ Bozza automatica (non perdi il lavoro)
Il lavoro in corso (fatture spuntate + piano) **si salva da solo nel browser**. Se cambi pagina,
finestra o ricarichi, al ritorno lo **ritrovi** ("Bozza distinta ripristinata: N fatture"). Si azzera
quando confermi o premi "Annulla".

> La bozza è **del tuo browser/PC**: se cambi computer non la ritrovi, e non è condivisa con le altre
> operatrici.

### ⑦ Rivedere e correggere le fatture "In sospeso"
Le fatture disposte le rivedi col **pill "In sospeso: N (€)"** nella barra filtri (oppure filtro stato
**"In sospeso"**). Da qui puoi:
- **Rimuovi dalla distinta** → la fattura torna attiva nello scadenzario (usalo se hai sbagliato banca
  o non ci sono fondi: rimuovi, riseleziona con la banca giusta, riconferma);
- **Chiudi a mano** (vedi ⑨).

> **Cambiare banca**: *prima* di confermare basta cambiarla nel pannello e rigenerare. *Dopo* la
> conferma: "Rimuovi dalla distinta" → riseleziona → nuova banca → riconferma.

### ⑧ Riconciliazione (qui si chiudono le fatture)
Quando l'**estratto conto** arriva, il gestionale prova ad **agganciare** ogni movimento alla sua
fattura e a chiuderla.
- Se il bonifico corrisponde → si chiude in automatico.
- Se **non trova riscontro** (causale non riconosciuta, o importo **netto** per via delle NC) → lo
  abbini **a mano** in **Banche → Riconciliazione**: scegli la fattura e il movimento la chiude.
  Se c'erano note di credito collegate, si **compensano da sole** e la fattura risulta pagata.

> Così **cassa** (prima nota) e **partitario** tornano da soli, senza doppi conteggi.

### ⑨ Chiudi a mano (valvola di normalizzazione)
Se un pagamento **non risulterà mai** in banca, puoi chiudere la fattura **a mano** indicando **data**
e **banca**. Importante: la chiusura a mano **non crea un movimento** — la prima nota resta i soli
movimenti bancari reali. Se poi il bonifico arriva lo stesso, **abbinalo** comunque alla fattura in
**Banche → Riconciliazione** così non resta "spaiato".

---

## Prima nota, doppioni: come stanno le cose

- La **prima nota** è lo **specchio dei movimenti bancari reali** (sola lettura, per il commercialista).
  Non la scrivi tu e non la scrive la distinta.
- **Chiudere a mano non duplica la cassa**: non crea movimenti e non tocca il saldo. Il bonifico in
  prima nota compare **una volta sola** (è quello vero).
- Il rischio da evitare non è il doppione ma il **movimento orfano**: un bonifico che resta non
  abbinato. Si risolve **abbinandolo** in Banche → Riconciliazione (anche a una fattura già chiusa a mano).

---

## Domande frequenti

**La distinta ha pagato le fatture?** No. Le mette in sospeso con la banca prevista. Diventano pagate
solo al riscontro del movimento.

**Quando si chiudono le note di credito?** Insieme alla fattura, al pagamento/riconciliazione. Mai alla
conferma della distinta.

**Ho perso la distinta cambiando finestra?** No: la bozza si salva da sola e si ripristina al ritorno.

**Ho sbagliato banca dopo la conferma?** Filtro "In sospeso" → "Rimuovi dalla distinta" → ridisponi con
la banca giusta.

---

## Nota tecnica (per chi gestisce il gestionale)

La **compensazione automatica delle NC in riconciliazione** (punto ⑧, "si compensano da sole") richiede
la **migration `20260713_090_credit_note_links_reconcile.sql`** applicata su **NZ, Made e Zago**.
Finché non è applicata, il ciclo funziona lo stesso ma la nota di credito, dopo l'abbinamento del
bonifico netto, va **chiusa a mano** (la fattura resta "parziale" per l'importo NC). Tutto il resto
(distinta, in sospeso, abbinamento manuale, chiusura a mano) funziona da subito.
