import { describe, it, expect } from 'vitest'
import {
  simulaFabbisogno,
  proiezioneGiornaliera,
  primoGiornoNegativo,
  saldoMinimo,
  fasciaDaMacroGroup,
  isPagamentoAutomatico,
  addDaysYMD,
  diffGiorni,
  FASCE_ORDINE_DEFAULT,
  ripartisciSuRighe,
  calcolaPiano,
  previsioneIncassiMese,
} from './fabbisogno'

describe('simulaFabbisogno — cascata a priorità', () => {
  it('copre tutto quando la disponibilità basta', () => {
    const r = simulaFabbisogno({
      liquiditaIniziale: 100_000,
      incassiAttesi: 50_000,
      fasce: [
        { key: 'stipendi', importo: 40_000 },
        { key: 'merci', importo: 60_000 },
        { key: 'affitti', importo: 20_000 },
      ],
    })
    expect(r.disponibilita).toBe(150_000)
    expect(r.totaleUscite).toBe(120_000)
    expect(r.fabbisogno).toBe(0)
    expect(r.cassaResidua).toBe(30_000)
    expect(r.fasce.every(f => f.scoperto === 0)).toBe(true)
  })

  it('paga nell ordine stipendi > merci > affitti e lascia scoperto il resto', () => {
    const r = simulaFabbisogno({
      liquiditaIniziale: 100_000,
      incassiAttesi: 0,
      fasce: [
        { key: 'altro', importo: 30_000 },
        { key: 'affitti', importo: 20_000 },
        { key: 'merci', importo: 200_000 },
        { key: 'stipendi', importo: 70_000 },
      ],
      ordine: FASCE_ORDINE_DEFAULT,
    })
    // Ordine applicato, non quello di inserimento
    expect(r.fasce.map(f => f.key)).toEqual(['stipendi', 'merci', 'affitti', 'altro'])
    // 100k: 70k agli stipendi, 30k alle merci, niente ad affitti e altro
    expect(r.fasce[0].pagato).toBe(70_000)
    expect(r.fasce[0].scoperto).toBe(0)
    expect(r.fasce[1].pagato).toBe(30_000)
    expect(r.fasce[1].scoperto).toBe(170_000)
    expect(r.fasce[2].pagato).toBe(0)
    expect(r.fasce[3].pagato).toBe(0)
    expect(r.fabbisogno).toBe(220_000)
    expect(r.cassaResidua).toBe(0)
  })

  it('cambiando l ordine cambia chi resta scoperto', () => {
    const fasce = [
      { key: 'merci' as const, importo: 80_000 },
      { key: 'affitti' as const, importo: 20_000 },
    ]
    const merciPrima = simulaFabbisogno({ liquiditaIniziale: 50_000, incassiAttesi: 0, fasce })
    expect(merciPrima.fasce[0].pagato).toBe(50_000)
    const affittiPrima = simulaFabbisogno({
      liquiditaIniziale: 50_000,
      incassiAttesi: 0,
      fasce,
      ordine: ['affitti', 'merci'],
    })
    expect(affittiPrima.fasce[0].key).toBe('affitti')
    expect(affittiPrima.fasce[0].pagato).toBe(20_000)
    expect(affittiPrima.fasce[1].pagato).toBe(30_000)
    // il fabbisogno totale non dipende dall'ordine
    expect(merciPrima.fabbisogno).toBe(affittiPrima.fabbisogno)
  })

  it('il fido entra nella disponibilità solo se valorizzato', () => {
    const senza = simulaFabbisogno({ liquiditaIniziale: 10_000, incassiAttesi: 0, fasce: [{ key: 'merci', importo: 30_000 }] })
    const con = simulaFabbisogno({ liquiditaIniziale: 10_000, incassiAttesi: 0, fidoDisponibile: 15_000, fasce: [{ key: 'merci', importo: 30_000 }] })
    expect(senza.fabbisogno).toBe(20_000)
    expect(con.fabbisogno).toBe(5_000)
  })

  it('la quota non rinviabile scoperta emerge anche in fondo alla cascata', () => {
    const r = simulaFabbisogno({
      liquiditaIniziale: 50_000,
      incassiAttesi: 0,
      fasce: [
        { key: 'stipendi', importo: 50_000 },
        // 40k di RiBa che escono comunque, ma la cassa è finita
        { key: 'merci', importo: 100_000, automatico: 40_000 },
      ],
    })
    expect(r.fasce[1].pagato).toBe(0)
    expect(r.scopertoNonRinviabile).toBe(40_000)
  })

  it('la quota automatica è coperta per prima dentro la fascia', () => {
    const r = simulaFabbisogno({
      liquiditaIniziale: 30_000,
      incassiAttesi: 0,
      fasce: [{ key: 'merci', importo: 100_000, automatico: 25_000 }],
    })
    expect(r.fasce[0].pagato).toBe(30_000)
    expect(r.scopertoNonRinviabile).toBe(0)
  })

  it('normalizza importi negativi e fasce vuote', () => {
    const r = simulaFabbisogno({
      liquiditaIniziale: -5_000,
      incassiAttesi: 10_000,
      fasce: [{ key: 'merci', importo: -100 }, { key: 'affitti', importo: 0 }],
    })
    expect(r.disponibilita).toBe(10_000)
    expect(r.totaleUscite).toBe(0)
    expect(r.fasce[0].coperturaPct).toBe(100)
  })

  it('la copertura percentuale riflette il parziale', () => {
    const r = simulaFabbisogno({ liquiditaIniziale: 25_000, incassiAttesi: 0, fasce: [{ key: 'merci', importo: 100_000 }] })
    expect(r.fasce[0].coperturaPct).toBe(25)
  })
})

describe('proiezioneGiornaliera', () => {
  it('accumula incassi e uscite giorno per giorno', () => {
    const p = proiezioneGiornaliera({
      dataInizio: '2026-09-08',
      dataFine: '2026-09-10',
      saldoIniziale: 1_000,
      incassoGiornaliero: 500,
      uscite: [{ data: '2026-09-09', importo: 2_000, key: 'merci' }],
    })
    expect(p).toHaveLength(3)
    expect(p[0]).toMatchObject({ data: '2026-09-08', saldo: 1_500 })
    expect(p[1]).toMatchObject({ data: '2026-09-09', uscite: 2_000, saldo: 0 })
    expect(p[2].saldo).toBe(500)
  })

  it('carica l arretrato scaduto sul primo giorno', () => {
    const p = proiezioneGiornaliera({
      dataInizio: '2026-09-08',
      dataFine: '2026-09-09',
      saldoIniziale: 10_000,
      incassoGiornaliero: 0,
      uscite: [
        { data: '2026-06-14', importo: 3_000, key: 'merci' },
        { data: '2026-07-01', importo: 2_000, key: 'altro' },
      ],
    })
    expect(p[0].uscite).toBe(5_000)
    expect(p[0].saldo).toBe(5_000)
    expect(p[1].uscite).toBe(0)
  })

  it('ignora le uscite oltre l orizzonte', () => {
    const p = proiezioneGiornaliera({
      dataInizio: '2026-09-08',
      dataFine: '2026-09-09',
      saldoIniziale: 0,
      incassoGiornaliero: 0,
      uscite: [{ data: '2026-10-01', importo: 9_999, key: 'merci' }],
    })
    expect(p.every(g => g.uscite === 0)).toBe(true)
  })

  it('trova il giorno di rottura e il minimo', () => {
    const p = proiezioneGiornaliera({
      dataInizio: '2026-09-08',
      dataFine: '2026-09-12',
      saldoIniziale: 5_000,
      incassoGiornaliero: 1_000,
      uscite: [{ data: '2026-09-10', importo: 20_000, key: 'stipendi' }],
    })
    expect(primoGiornoNegativo(p)).toBe('2026-09-10')
    expect(saldoMinimo(p)?.data).toBe('2026-09-10')
    expect(saldoMinimo(p)?.saldo).toBe(-12_000)
  })

  it('restituisce vuoto se le date sono invertite', () => {
    const p = proiezioneGiornaliera({
      dataInizio: '2026-09-30', dataFine: '2026-09-08',
      saldoIniziale: 0, incassoGiornaliero: 0, uscite: [],
    })
    expect(p).toEqual([])
    expect(primoGiornoNegativo(p)).toBeNull()
    expect(saldoMinimo(p)).toBeNull()
  })

  it('nessun giorno negativo se la cassa regge', () => {
    const p = proiezioneGiornaliera({
      dataInizio: '2026-09-08', dataFine: '2026-09-10',
      saldoIniziale: 100_000, incassoGiornaliero: 0, uscite: [{ data: '2026-09-09', importo: 1_000, key: 'affitti' }],
    })
    expect(primoGiornoNegativo(p)).toBeNull()
  })
})

describe('helper date', () => {
  it('addDaysYMD attraversa il cambio mese', () => {
    expect(addDaysYMD('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDaysYMD('2026-09-01', -1)).toBe('2026-08-31')
  })

  it('diffGiorni conta i giorni di calendario', () => {
    expect(diffGiorni('2026-09-08', '2026-09-30')).toBe(22)
    expect(diffGiorni('2026-09-30', '2026-09-08')).toBe(-22)
  })
})

describe('classificazione', () => {
  it('mappa i macro_group sulle fasce', () => {
    expect(fasciaDaMacroGroup('personale')).toBe('stipendi')
    expect(fasciaDaMacroGroup('costo_venduto')).toBe('merci')
    expect(fasciaDaMacroGroup('locazione')).toBe('affitti')
    expect(fasciaDaMacroGroup('generali_amministrative')).toBe('altro')
    expect(fasciaDaMacroGroup(null)).toBe('altro')
    expect(fasciaDaMacroGroup(undefined)).toBe('altro')
  })

  it('riconosce gli addebiti automatici', () => {
    expect(isPagamentoAutomatico('riba_60')).toBe(true)
    expect(isPagamentoAutomatico('sdd_core')).toBe(true)
    expect(isPagamentoAutomatico('carta_credito')).toBe(true)
    expect(isPagamentoAutomatico('bonifico_ordinario')).toBe(false)
    expect(isPagamentoAutomatico(null)).toBe(false)
    // il flag della riga vince sul metodo
    expect(isPagamentoAutomatico('bonifico_ordinario', true)).toBe(true)
  })
})

describe('ripartisciSuRighe', () => {
  const righe = [
    { id: 'a', key: 'merci' as const, descrizione: 'A', fornitore: 'Alfa', documento: '1', scadenza: '2026-09-20', importo: 5_000, automatico: false },
    { id: 'b', key: 'merci' as const, descrizione: 'B', fornitore: 'Beta', documento: '2', scadenza: '2026-07-01', importo: 3_000, automatico: false },
    { id: 'c', key: 'merci' as const, descrizione: 'C', fornitore: 'Gamma', documento: '3', scadenza: '2026-09-30', importo: 2_000, automatico: true },
  ]

  it('paga prima gli addebiti automatici, poi le scadenze più vecchie', () => {
    const r = ripartisciSuRighe(righe, 5_000)
    expect(r.map(x => x.id)).toEqual(['c', 'b', 'a'])
    expect(r[0].pagato).toBe(2_000)
    expect(r[1].pagato).toBe(3_000)
    expect(r[2].pagato).toBe(0)
    expect(r[2].scoperto).toBe(5_000)
  })

  it('spezza la riga a cavallo della capienza', () => {
    const r = ripartisciSuRighe(righe, 3_000)
    expect(r[1].pagato).toBe(1_000)
    expect(r[1].scoperto).toBe(2_000)
  })

  it('con capienza zero resta tutto scoperto', () => {
    const r = ripartisciSuRighe(righe, 0)
    expect(r.every(x => x.pagato === 0)).toBe(true)
    expect(r.reduce((s, x) => s + x.scoperto, 0)).toBe(10_000)
  })

  it('a parità di data paga prima gli importi piccoli', () => {
    const stessaData = [
      { id: 'x', key: 'altro' as const, descrizione: 'X', fornitore: 'X', documento: null, scadenza: '2026-09-15', importo: 9_000, automatico: false },
      { id: 'y', key: 'altro' as const, descrizione: 'Y', fornitore: 'Y', documento: null, scadenza: '2026-09-15', importo: 1_000, automatico: false },
    ]
    const r = ripartisciSuRighe(stessaData, 1_000)
    expect(r[0].id).toBe('y')
    expect(r[0].pagato).toBe(1_000)
  })

  it('le righe senza scadenza vanno in fondo', () => {
    const conNull = [
      { id: 'n', key: 'altro' as const, descrizione: 'N', fornitore: 'N', documento: null, scadenza: null, importo: 100, automatico: false },
      { id: 'd', key: 'altro' as const, descrizione: 'D', fornitore: 'D', documento: null, scadenza: '2026-09-01', importo: 100, automatico: false },
    ]
    expect(ripartisciSuRighe(conNull, 100).map(x => x.id)).toEqual(['d', 'n'])
  })
})

describe('link operativo sulle righe', () => {
  it('ripartisciSuRighe trasporta il link senza toccarlo', () => {
    const righe = [
      { id: 'a', key: 'merci' as const, descrizione: 'A', fornitore: 'Alfa', documento: '1', scadenza: '2026-09-20', importo: 100, automatico: false, link: '/scadenzario?search=1' },
      { id: 'b', key: 'merci' as const, descrizione: 'B', fornitore: 'Beta', documento: '2', scadenza: '2026-09-21', importo: 100, automatico: false, link: null },
    ]
    const r = ripartisciSuRighe(righe, 100)
    expect(r[0].link).toBe('/scadenzario?search=1')
    expect(r[1].link).toBeNull()
  })
})

describe('calcolaPiano — decide chi spunta, non la regola', () => {
  const righe = [
    { id: 'a', key: 'merci' as const, descrizione: 'A', fornitore: 'Alfa', documento: '1', scadenza: '2026-09-20', importo: 100_000, automatico: false },
    { id: 'b', key: 'stipendi' as const, descrizione: 'B', fornitore: 'Dipendenti', documento: null, scadenza: '2026-09-10', importo: 70_000, automatico: true },
    { id: 'c', key: 'affitti' as const, descrizione: 'C', fornitore: 'Gamma', documento: '3', scadenza: '2026-09-30', importo: 20_000, automatico: true },
  ]

  it('separa obbligatorio e rinviabile secondo la selezione', () => {
    const p = calcolaPiano({ righe, selezionati: new Set(['b', 'c']), disponibilita: 200_000 })
    expect(p.obbligatorio).toBe(90_000)
    expect(p.rinviabile).toBe(100_000)
    expect(p.nSelezionate).toBe(2)
    expect(p.nTotali).toBe(3)
    expect(p.fabbisogno).toBe(0)
    expect(p.avanzo).toBe(110_000)
    expect(p.rinviabileCoperto).toBe(100_000)
  })

  it('calcola il fabbisogno quando la cassa non basta', () => {
    const p = calcolaPiano({ righe, selezionati: new Set(['a', 'b']), disponibilita: 120_000 })
    expect(p.obbligatorio).toBe(170_000)
    expect(p.fabbisogno).toBe(50_000)
    expect(p.avanzo).toBe(0)
    expect(p.rinviabileCoperto).toBe(0)
    expect(p.coperturaObbligatorioPct).toBeCloseTo(70.59, 1)
  })

  it('segnala gli automatici lasciati fuori dalla selezione', () => {
    const p = calcolaPiano({ righe, selezionati: new Set(['a']), disponibilita: 0 })
    // b e c non sono spuntati ma sono addebiti automatici: usciranno comunque
    expect(p.rinviabileAutomatico).toBe(90_000)
    expect(p.obbligatorioAutomatico).toBe(0)
  })

  it('senza selezione il fabbisogno è zero e tutto è rinviabile', () => {
    const p = calcolaPiano({ righe, selezionati: new Set(), disponibilita: 10_000 })
    expect(p.obbligatorio).toBe(0)
    expect(p.fabbisogno).toBe(0)
    expect(p.rinviabile).toBe(190_000)
    expect(p.coperturaObbligatorioPct).toBe(100)
  })

  it('ignora le chiavi selezionate che non esistono più', () => {
    const p = calcolaPiano({ righe, selezionati: new Set(['a', 'fantasma']), disponibilita: 0 })
    expect(p.obbligatorio).toBe(100_000)
    expect(p.nSelezionate).toBe(1)
  })
})

describe('previsioneIncassiMese — obiettivo corretto ogni sera', () => {
  it('usa il ritmo effettivo dei giorni registrati', () => {
    // settembre 2026 al giorno 8: 75.003,55 lordi su 8 giorni, 22 giorni ancora da fare
    const r = previsioneIncassiMese({
      realizzato: 75_003.55,
      giorniRegistrati: 8,
      giorniResidui: 22,
      obiettivoMensile: 339_995.70, // 278.685 netti con IVA 22
      giorniMese: 30,
    })
    expect(r.ritmoGiornaliero).toBeCloseTo(9_375.44, 2)
    expect(r.attesiResidui).toBeCloseTo(206_259.75, 0)
    expect(r.proiezioneMese).toBeCloseTo(281_263.30, 0)
    // sotto obiettivo
    expect(r.scostamento).toBeLessThan(0)
    // per centrare l'obiettivo servirebbe un passo più alto di quello attuale
    expect(r.passoRichiesto).toBeGreaterThan(r.ritmoGiornaliero)
  })

  it('un giorno saltato dall import non abbassa il ritmo', () => {
    // 5 giorni di calendario ma solo 4 caricati: la media è sui 4 caricati
    const r = previsioneIncassiMese({ realizzato: 40_000, giorniRegistrati: 4, giorniResidui: 10 })
    expect(r.ritmoGiornaliero).toBe(10_000)
    expect(r.attesiResidui).toBe(100_000)
  })

  it('senza giorni registrati non inventa un ritmo', () => {
    const r = previsioneIncassiMese({ realizzato: 0, giorniRegistrati: 0, giorniResidui: 20 })
    expect(r.ritmoGiornaliero).toBe(0)
    expect(r.attesiResidui).toBe(0)
    expect(r.proiezioneMese).toBe(0)
  })

  it('senza obiettivo restituisce solo la proiezione', () => {
    const r = previsioneIncassiMese({ realizzato: 10_000, giorniRegistrati: 2, giorniResidui: 5 })
    expect(r.scostamento).toBeNull()
    expect(r.obiettivoAData).toBeNull()
    expect(r.passoRichiesto).toBeNull()
  })

  it('a obiettivo già raggiunto il passo richiesto è zero', () => {
    const r = previsioneIncassiMese({
      realizzato: 300_000, giorniRegistrati: 20, giorniResidui: 10,
      obiettivoMensile: 250_000, giorniMese: 30,
    })
    expect(r.passoRichiesto).toBe(0)
    expect(r.scostamento).toBeGreaterThan(0)
  })

  it('ultimo giorno del periodo: nessun giorno residuo', () => {
    const r = previsioneIncassiMese({
      realizzato: 100_000, giorniRegistrati: 30, giorniResidui: 0,
      obiettivoMensile: 120_000, giorniMese: 30,
    })
    expect(r.attesiResidui).toBe(0)
    expect(r.proiezioneMese).toBe(100_000)
    expect(r.passoRichiesto).toBeNull()
  })
})
