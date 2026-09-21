-- NZ_ONLY 244/245 — l'ultima riserva sui tassi INAIL cade: nessuna PAT e' piu' stimata.
--
-- La consulente ha confermato che per Pian di Rona sono stati aperti DUE rischi
-- separati, amministrativo e magazzino, con decorrenze diverse (i magazzinieri
-- hanno iniziato prima in quel fondo). Ha allegato entrambe le conferme di
-- iscrizione INAIL. Il certificato dell'amministrazione riporta voce 0722 e tasso
-- applicato 4,00 per mille, cioe' esattamente il valore dedotto dalla 241.
--
-- I PDF dei certificati non sono leggibili a macchina: hanno una codifica font
-- non standard e i due file usano perfino cifrature diverse fra loro, quindi
-- nemmeno il confronto fra i due permette di ricavarne il testo. I due numeri
-- sono stati letti da Patrizio aprendo il documento.
--
-- COSA CAMBIA. Sparisce la nota da MATASSINO-AMMINISTRAZIONE e da
-- PIAN DI RONA - AMMINISTRAZIONE: non sono piu' deduzioni, sono documenti.
-- Sparisce anche da MATASSINO-MAGAZZINO: la vecchia posizione 97211090 portava
-- SOLO le voci 0722 e 9300 (basi di calcolo 2025/26), e ora che entrambe sono
-- assegnate con certezza sulle PAT gemelle di Pian di Rona, l'abbinamento della
-- vecchia posizione e' fissato di conseguenza.
--
-- Da qui in avanti nessuna riga di inail_rates porta piu' il badge «stimato»:
-- tutti gli undici tassi poggiano su un documento. La provenienza di ciascuno
-- resta scritta qui e nelle migration 172, 176, 240 e 241.
--
-- NO DATA LOSS: si azzerano solo le note, i tassi non cambiano.

BEGIN;

UPDATE inail_rates
   SET rate_percent = 0.4000, note = NULL, updated_at = now()
 WHERE company_id = '00000000-0000-0000-0000-000000000001'
   AND pat_label IN ('MATASSINO-AMMINISTRAZIONE', 'PIAN DI RONA - AMMINISTRAZIONE');

UPDATE inail_rates
   SET note = NULL, updated_at = now()
 WHERE company_id = '00000000-0000-0000-0000-000000000001'
   AND pat_label = 'MATASSINO-MAGAZZINO';

COMMIT;
