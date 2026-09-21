# commissioni di incasso: cosa è fatto, cosa resta da caricare, come

Promemoria operativo del 16/09/2026. Le regole e i numeri stanno in
`COMMISSIONI_INCASSO_NOTES.md`; qui c'è solo il processo: chi fa cosa, dove.

---

## 1. quello che è già a posto (nessuna azione)

| cosa | dove | stato |
|---|---|---|
| Tabelle `acquirer_contracts` e `acquirer_fees`, vista `v_commissioni_incasso` | NZ, Made, Zago | applicate su tutti e 3 (migration 221) |
| Regime di accredito sul canale e riscontro cassa/banca riscritto | NZ, Made, Zago | applicata su tutti e 3 (migration 224) |
| Contratti, commissioni, canali, categorie, ricalcolo di settembre | solo NZ | migration NZ_ONLY 222, 223, 225, 226, 227, 228 |
| Scheda Banche → Commissioni, con import di PDF e zip | i 3 site Netlify | in produzione |

Dati vivi su NZ: **142 righe** di commissioni da dicembre 2025 ad agosto 2026,
tutte lette da un documento, nessuna stimata. 156 movimenti bancari di acquiring
sotto la categoria `commissioni_incasso`.

---

## 2. quello che manca: i PDF in archivio

I numeri ci sono, i documenti no: le 142 righe hanno `document_id` vuoto, e in
`import_documents` non c'è nessun estratto acquirer. I PDF sono stati letti in
sessione e la sessione non è un archivio.

Documenti attesi a copertura del periodo: **69**.

| periodo | Nexi (uno per punto vendita) | Amex | totale |
|---|---|---|---|
| dicembre 2025 | 6 (BRB BRG FRC PLM VDC VLM) | 1 | 7 |
| gennaio 2026 | 6 | 1 | 7 |
| febbraio 2026 | 6 | 1 | 7 |
| marzo → agosto 2026 | 7 al mese (entra TRN) | 1 al mese | 48 |

### 2a. i 29 che hai già in mano
Sono i due zip di Sabrina del 16/09, nel thread «Estratti conto Nexi e Amex
mancanti per la contabilità 2026»:

- primo zip: Nexi gennaio (5), febbraio (3), marzo (7), agosto (7) più l'Amex di
  dicembre 2025;
- secondo zip: Nexi dicembre 2025 (6).

### 2b. i 40 da ritrovare
Documenti già letti in sessione ma mai archiviati:

- **Amex gennaio-agosto 2026**, 8 documenti: l'archivio `ecamexgennaioluglio2026.zip`
  ricevuto in chat, più `AMEX_AGOSTO_2026.pdf`.
- **Nexi aprile, maggio, giugno, luglio 2026**, 28 documenti: su Drive, cercando
  «nexi».
- **Nexi gennaio 2026 di Palmanova** e **Nexi febbraio 2026 di Brugnato,
  Franciacorta e Valmontone**, 4 documenti: stessa cartella Drive.

---

## 3. come si caricano

1. **Banche → Commissioni**, pulsante **Carica estratti** in alto a destra.
2. Trascina lo zip così com'è, oppure i PDF sciolti: la scheda apre gli archivi
   da sé. Gli zip vanno bene, i PDF dentro cartelle pure.
3. Ogni documento viene riconosciuto dal contenuto: acquirer, punto vendita e
   mese si leggono dentro il PDF, non dal nome del file.
4. Il file finisce su Storage rinominato (`nexi_VDC_2026-03.pdf`,
   `amex_2025-12.pdf`), nella cartella dell'anno e del mese.
5. **Controlla l'esito** riga per riga, sotto il pulsante:
   - «N punti vendita aggiornati, archiviato come …» → tutto a posto;
   - «codici non censiti» → quel punto vendita ha un codice nuovo, va aggiunto in
     anagrafica prima di ricaricare quel documento;
   - «sembra una scansione» → il PDF è una fotografia, serve il file scaricato
     dal portale.

I numeri sono già quelli giusti: ricaricare non li cambia, aggiunge il documento
dietro la riga. Ricaricare due volte lo stesso estratto non crea doppioni: il
precedente resta marcato come sostituito.

### dove li ritrovi
**Archivio documenti → sezione «Estratti conto»**, cercabili per nome file o per
funzione («Commissioni di incasso · Nexi VDC»), con anno e mese a fianco.

---

## 4. da qui in avanti

Accordo con Sabrina del 16/09: a ogni fine mese manda lei, senza che glieli si
chieda, i sette estratti Nexi più l'unico Amex, **scaricati dal portale** e non
stampati e scansionati. Arrivati, si trascina lo zip nella scheda Commissioni:
numeri e documento entrano insieme.

---

## 5. cosa resta aperto

- **Amex settembre 2026**, che esce a fine mese: chiude le tre giornate di
  riscontro rimaste (BRG 10/09, FRC 12/09, FRC 13/09, in tutto 3.403,36).
- **Bollo Amex da 2,00**: il parser non lo registra (`stamp_amount` a zero sulle
  righe amex), ed è il +2,00 che torna quasi ogni mese nel confronto con la banca.
- **Canali «Pay by link»**: modificati il 15/09 da un utente con i codici
  terminale dei POS MPS. Oggi dichiarano zero e non spostano numeri, ma
  competono con il POS sullo stesso terminale.
- **Archivio come porta d'ingresso**: oggi l'Archivio documenti elenca e riapre,
  non accetta caricamenti generici. Un ingresso unico che riconosce il tipo di
  documento e lo instrada alla funzione giusta è fattibile riusando
  `src/lib/zipFiles.ts`, ma non è stato fatto.
