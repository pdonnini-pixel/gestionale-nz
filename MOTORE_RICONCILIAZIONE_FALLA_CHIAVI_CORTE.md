# Il gate di identità del motore v3 è aggirabile dalle chiavi corte

Constatato sul campo il 04/09/2026, al primo giro completo del cron dopo 28
giorni di fermo. Da chiudere **prima** di riattivare il job notturno.

## Cosa è successo

Il giro ha agganciato 8 movimenti in automatico, tutti come `auto_exact`.
Controllati uno per uno leggendo la causale bancaria per intero: **4 giusti,
4 sbagliati**. Questi i quattro annullati con `undo_reconcile_movement`, per
681,90 € di debito ripristinato:

| log id | fornitore agganciato | fattura | perché è sbagliato |
|---|---|---|---|
| `10cad741` | ANTICO CODICE ONLUS | SF_01, 244,00 | la causale dice «A FAVORE **LIGNANO BANDA LARGA**» |
| `f0e4cf80` | RICA GEST | 2540019647, 12,90 | la causale dice «A FAVORE **AMERICAN EXPRESS**», e il movimento è 12,99 |
| `c60d5185` | GRUPPO SERVIZI ASSOCIATI | V070012603479, 315,00 | beneficiario «N.D.», pagamento 5 mesi prima della scadenza |
| `e330afdc` | SPM INVESTIGAZIONI | 31, 110,00 | beneficiario «N.D.», numero fattura di due cifre |

I quattro corretti, per contro, avevano tutti il nome del fornitore scritto
nella causale: Annalisa Boschetti, Caterina Valia, CNH Industrial Capital
Europe, Studio Associato Scandella.

## La causa

`invoice_number_keys` produce chiavi troppo corte per essere identificanti:

```
SF_01          -> {"01", "1"}
31             -> {"31"}
2540019647     -> {"2540019647"}
V070012603479  -> {"70012603479", "070012603479"}
```

La chiave `"1"` si trova in qualunque causale bancaria: codici mandato, ID
flusso CBI, date, numeri di SDD. Il gate di identità della v3 accetta
`v_inv_hit` come prova che il movimento parli di quella fattura, ma un hit su
una chiave di una o due cifre non prova nulla. È così che una fattura di
ANTICO CODICE ONLUS si è agganciata a un addebito per Lignano Banda Larga.

## Quanto è esposto lo scadenzario

Sulle 283 scadenze candidate di NZ al 04/09:

| chiave più corta | scadenze | giudizio |
|---|---|---|
| 1-2 cifre | **140** | non identifica nulla |
| 3 cifre | 71 | debole |
| 4 e più | 72 | affidabile |

Metà dello scadenzario può finire agganciato al movimento sbagliato.

## Il rimedio da fare

Non basta buttare via le chiavi corte dentro `invoice_number_keys`: servono
ancora, perché quando il nome del fornitore è nella causale una fattura «443»
va riconosciuta. Il punto è che una chiave corta **non deve valere come prova
di identità**.

La correzione va nel gate di `try_match_bank_transaction`: distinguere l'hit su
chiave lunga (>= 4 cifre) dall'hit su chiave corta, e far contare come identità
solo il primo. Una chiave corta resta utile come rinforzo quando l'identità è
già stabilita dal nome del fornitore o dalla disposizione.

Da fare con i test di non regressione del motore, come per la v3: rigiro dei
casi noti in transazione annullata, verificando che le fatture già agganciate
correttamente si riaggancino alla stessa fattura.

## Nel frattempo

Il job notturno `reconcile-recurring-daily` (jobid 6) ha ancora il comando
senza `SET statement_timeout`, quindi continua a fallire per timeout dopo 120
secondi e **non tocca nulla**. È la situazione voluta finché la falla non è
chiusa: il comando va corretto solo dopo il fix del gate, non prima.
