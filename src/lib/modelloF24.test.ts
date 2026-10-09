import { describe, it, expect } from 'vitest'
import { leggiModelloF24, isModelloF24, codiciF24InBreve, sezioniF24InBreve } from './modelloF24'
import { riconosciFilePaghe, rigaVersamento } from './payrollParse'

// Righe come le restituisce pdf.js dal modello F24 dello studio (struttura
// copiata dal PDF vero di ottobre 2026, importi, codice fiscale e IBAN inventati).
const pagina = (n: number, corpo: string[], saldo: string): string[] => [
  `Azienda 099999 Scadenza 16/10/2026 Cod.conto 000 Prog. 1 Pag. ${n} Mod.invio Entratel intermediario`,
  'genzia Mod. F24',
  'DELEGA IRREVOCABILE A: BANCA DI PROVA S.P.A.',
  'MODELLO DI PAGAMENTO',
  'UNIFICATO',
  'CONTRIBUENTE',
  'CODICE FISCALE 0 1 2 3 4 5 6 7 8 9 0',
  'DATI ANAGRAFICI AZIENDA DI PROVA SRL',
  ...corpo,
  'FIRMA SALDO FINALE',
  `MARIO ROSSI EURO + ${saldo}`,
  ',',
  'Autorizzo addebito su',
  'I T',
  'MOD. F24 – 2013 conto corrente codice IBAN 6 0 X 0 5 4 2 8 1 1 1 0 1 0 0 0 0 0 0 1 2 3 4 5 6 firma',
  'a',
  '1 COPIA PER LA BANCA/POSTE/AGENTE DELLA RISCOSSIONE',
]

const p1 = pagina(1, [
  'SEZIONE ERARIO',
  '1631 2025 , 1.000 00 ,',
  'IMPOSTE DIRETTE – IVA 1001 0009 2026 5.000 50',
  ', ,',
  'codice ufficio codice atto 1075 0009 2026 100 00 +/– SALDO (A-B)',
  'TOTALE A 5.100 50 , , B 1.000 00 + , 4.100 50 ,',
  'SEZIONE INPS',
  '0500 DM10 0505543781 09 2026 10.000 00',
  '0500 EST1 0505543781 09 2026 150 , 00 ,',
  'TOTALE C 10.150 , 00 D , + 10.150 00 ,',
  'SEZIONE REGIONI',
  '0 8 3802 0009 2026 200 25 , ,',
  'TOTALE E 200 25 , F , + 200 25 ,',
  'SEZIONE IMU E ALTRI TRIBUTI LOCALI IDENTIFICATIVO OPERAZIONE',
  'E 4 6 3 3797 2025 50 00',
  'A 3 1 0 3845 0009 2026 20 00',
  'detrazione , TOTALE G 20 00 , H 50 00 - , 30 00 ,',
  'SEZIONE ALTRI ENTI PREVIDENZIALI E ASSICURATIVI',
  'TOTALE I , L , + ,',
], '14.420 75')

const p2 = pagina(2, [
  'SEZIONE IMU E ALTRI TRIBUTI LOCALI IDENTIFICATIVO OPERAZIONE',
  'A 4 4 9 3848 0009 2026 79 25',
  'detrazione , TOTALE G 79 25 , H , + 79 25 ,',
], '79 25')

describe('modello F24 dello studio', () => {
  it('legge scadenza, conto, moduli e totale', () => {
    const m = leggiModelloF24([...p1, ...p2])
    expect(m).not.toBeNull()
    if (!m) return
    expect(m.scadenza).toBe('2026-10-16')
    expect(m.periodo).toBe('2026-09')
    expect(m.prog).toBe(1)
    expect(m.modoInvio).toBe('Entratel intermediario')
    expect(m.banca).toBe('BANCA DI PROVA S.P.A.')
    expect(m.iban).toBe('IT60X0542811101000000123456')
    expect(m.codiceFiscale).toBe('01234567890')
    expect(m.moduli.map((x) => x.saldo)).toEqual([14420.75, 79.25])
    expect(m.totale).toBe(14500)
    expect(m.quadra).toBe(true)
    expect(m.sezioni).toEqual({ erario: 4100.5, inps: 10150, regioni: 200.25, locali: 49.25 })
  })

  it('raccoglie i codici per sezione', () => {
    const m = leggiModelloF24([...p1, ...p2])
    expect(m && codiciF24InBreve(m)).toBe('1631/1001/1075 · DM10/EST1 · 3802 · 3797/3845/3848')
    expect(m && sezioniF24InBreve(m)).toBe('Erario 4100,50 · INPS 10.150,00 · Regioni 200,25 · Tributi locali 49,25')
  })

  it('un modulo che non torna si vede', () => {
    const rotto = p2.map((r) => (r.startsWith('MARIO ROSSI') ? 'MARIO ROSSI EURO + 80 25' : r))
    const m = leggiModelloF24([...p1, ...rotto])
    expect(m?.quadra).toBe(false)
    expect(m?.moduli[1].quadra).toBe(false)
  })

  it('a gennaio il periodo e\' dicembre dell\'anno prima', () => {
    const m = leggiModelloF24(p1.map((r) => r.replace('16/10/2026', '16/01/2027')))
    expect(m?.periodo).toBe('2026-12')
  })

  it('un Prospetto paghe non e\' un modello F24', () => {
    expect(isModelloF24(['Prospetto riepilogativo elaborazione paghe', 'I.N.P.S. Id. 1 Periodo versamento 09/2026 100,00'])).toBe(false)
  })

  it('la zona paghe lo riconosce, col mese dei contributi', () => {
    const r = riconosciFilePaghe('2026-10 in scadenza il 16-10-2026 (prog.1) tipo Ordinario.pdf', p1.join(' '))
    expect(r.tipo).toBe('modello_f24')
    expect(r.year).toBe(2026)
    expect(r.month).toBe(9)
  })
})

describe('riepilogo versamenti del Prospetto: cosa va in F24', () => {
  it('le voci con codice 5xxx (TAXBENEFIT, AZIMUT) si pagano fuori dall\'F24', () => {
    expect(rigaVersamento('5096 TAXBENEFIT NEW (trimestrale) Id. 1 Periodo versamento 09/2026 75,06', null).versamento?.canale).toBe('fondo')
    expect(rigaVersamento('5108 AZIMUT PREVIDENZA (trimestrale) Id. 1 Periodo versamento 09/2026 344,63', null).versamento?.canale).toBe('fondo')
  })
  it('INPS, EBINTER ed EST restano in F24', () => {
    expect(rigaVersamento('9001 I.N.P.S. Id. 1 Periodo versamento 09/2026 2.899,71', null).versamento?.canale).toBe('f24')
    expect(rigaVersamento('9540 EBINTER Ente Bilaterale Naz. Terziario Id. 1 Periodo versamento 09/2026 10,03', null).versamento?.canale).toBe('f24')
    expect(rigaVersamento('9660 Fondo EST Id. 1 Periodo versamento 09/2026 15,00', null).versamento?.canale).toBe('f24')
  })
})
