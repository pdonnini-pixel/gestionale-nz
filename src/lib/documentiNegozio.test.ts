import { describe, expect, it } from 'vitest'
import {
  categoriaDalNome, chiaveFile, destinoDelFile, eFirmato, etichettaRiga, lettereAllegato, nomeBase, numeroDOrdine,
  ordinaRighe, paroleChiave, riconosciDocumento, rigaDelFile, statoContratto, type RigaContratto,
} from './documentiNegozio'

// Le dieci righe di un contratto d'affitto di ramo d'azienda, con nomi inventati sullo stesso schema
// di quelli veri (numero d'ordine in testa, «SIGNED» in coda).
const riga = (id: string, label: string, file: string | null, extra: Partial<RigaContratto> = {}): RigaContratto => ({
  id, label, file_name: file, is_required: true, is_uploaded: file != null, created_at: '2026-10-02T10:00:00Z', ...extra,
})
const RIGHE: RigaContratto[] = [
  riga('cond', 'Condizioni Generali (All. B del contratto)', '6. allegato B al contratto_Condizioni generali XYZ_SIGNED.pdf'),
  riga('a', 'Allegato A — Scheda commerciale e planimetria K12', '2. Allegato A al contratto_20250415-XYZ_K12-SchedaCommerciale_SIGNED.pdf'),
  riga('b', 'Allegato B — Elenco impianti e cespiti', '3. Allegato B_XYZ Elenco Cespiti_RETAIL_marzo 2026_SIGNED.pdf'),
  riga('b1o', 'Allegato B1 — Elenco beni: preventivo opere Rossi', '4. Allegato B1_ACME_Quotazione Opere_SIGNED.pdf'),
  riga('b1i', 'Allegato B1 — Elenco beni: preventivo impianti Rossi', '4. Allegato B1_ACME-Quotazioni impianti_SIGNED.pdf'),
  riga('d', 'Allegato D — Informativa privacy tenants v1.3', '8. Allegato D_XYZ- Informativa Tenans_v1.3_SIGNED.pdf'),
  riga('reg', 'Regolamento immobiliare e commerciale', null),
  riga('gar', 'Bozza garanzia bancaria 44.100 € (All. D del contratto)', '7. ALLEGATO D al Contratto_bozza garanzia bancaria_SIGNED.pdf'),
  riga('pre', 'Preliminare — scrittura privata v7 (firmata da entrambe le parti il 10/09/2026)', '1. Preliminare Locatore XYZ_SIGNED.pdf'),
  riga('aff', "Contratto di affitto di ramo d'azienda — Allegato C (bozza v5 siglata da Acme)", '5. Allegato C_bozza affitto Locatore XYZ_SIGNED.pdf'),
]

describe('nomi dei file', () => {
  it('riconosce la copia firmata dal nome', () => {
    expect(eFirmato('5. Allegato C_bozza affitto_SIGNED.pdf')).toBe(true)
    expect(eFirmato('Regolamento firmato.pdf')).toBe(true)
    expect(eFirmato('Allegato B Condizioni generali.doc')).toBe(false)
    expect(eFirmato('designed.pdf')).toBe(false)
  })
  it('riduce il nome all\'osso: via numero, estensione e «signed»', () => {
    expect(nomeBase('2. Allegato A al contratto_K12-Scheda_SIGNED.pdf')).toBe(nomeBase('Allegato A al contratto_K12-Scheda.pdf'))
  })
  it('legge il numero d\'ordine in testa al nome', () => {
    expect(numeroDOrdine('7. ALLEGATO D.pdf')).toBe(7)
    expect(numeroDOrdine('10_Regolamento.pdf')).toBe(10)
    expect(numeroDOrdine('Allegato 3.pdf')).toBeNull()
    expect(numeroDOrdine('20250415 scheda.pdf')).toBeNull()
  })
  it('tiene solo le parole che dicono qualcosa', () => {
    expect(paroleChiave('ALLEGATO D al Contratto_ bozza garanzia bancaria.docx')).toEqual(['garanzia', 'bancaria'])
  })
  it('legge la lettera dell\'allegato, anche con la cifra', () => {
    expect(lettereAllegato('Allegato B1_ACME')).toEqual(['b1'])
    expect(lettereAllegato('Condizioni Generali (All. B del contratto)')).toEqual(['b'])
    expect(lettereAllegato('Allegato C_XYZ_K12 CESPITI.pdf')).toEqual(['c'])
    expect(lettereAllegato('allegati vari')).toEqual([])
  })
})

describe('riconosciDocumento', () => {
  const dove = (nome: string) => riconosciDocumento(nome, RIGHE).rigaId

  it('stesso nome della copia che vale, senza «signed»', () => {
    expect(dove('Allegato A al contratto_20250415-XYZ_K12-SchedaCommerciale.pdf')).toBe('a')
  })
  it('due righe con la stessa lettera: decidono le parole', () => {
    expect(dove('Allegato B Condizioni generali XYZ.doc')).toBe('cond')
    expect(dove('ALLEGATO D al Contratto_ bozza garanzia bancaria.docx')).toBe('gar')
  })
  it('lettera diversa ma di nessun\'altra riga: valgono le parole, anche con un refuso', () => {
    expect(dove('Allegato E_XYZ - Informativa Tenants - v1.3.docx')).toBe('d')
  })
  it('non forza: le parole dicono una riga, la lettera un\'altra', () => {
    const esito = riconosciDocumento('Allegato C_XYZ_K12 CESPITI.pdf', RIGHE)
    expect(esito.rigaId).toBeNull()
    expect(esito.motivo).toContain('altra riga')
  })
  it('la lettera da sola non basta', () => {
    expect(dove('Allegato C.pdf')).toBeNull()
  })
  it('un file che non c\'entra resta fuori', () => {
    expect(dove('PRIMAutentica.docx')).toBeNull()
    expect(dove('foto vetrina.jpg')).toBeNull()
  })
  it('riempie la riga che manca', () => {
    expect(dove('Regolamento immobiliare XYZ.pdf')).toBe('reg')
    // una parola sola non basta più (revisione del 16/11/2026)
    expect(dove('regolamento.pdf')).toBeNull()
  })
  it('alla pari fra due righe: non sceglie', () => {
    expect(dove('Allegato B1 preventivo Rossi.pdf')).toBeNull()
    expect(dove('Allegato B1 quotazione opere.pdf')).toBe('b1o')
  })
  it('senza righe non riconosce niente', () => {
    expect(riconosciDocumento('Regolamento.pdf', []).rigaId).toBeNull()
  })
})

describe('rigaDelFile', () => {
  const f = { id: 'x1', source: 'documents' as const, file_name: 'Allegato B Condizioni generali XYZ.doc' }
  it('senza scelte a mano vale il riconoscimento', () => {
    expect(rigaDelFile(f, RIGHE, {})).toBe('cond')
  })
  it('la scelta a mano vince, anche «lascialo fra gli altri»', () => {
    expect(rigaDelFile(f, RIGHE, { [chiaveFile(f)]: 'b' })).toBe('b')
    expect(rigaDelFile(f, RIGHE, { [chiaveFile(f)]: null })).toBeNull()
  })
  it('una scelta su una riga che non c\'è più lo lascia fra gli altri', () => {
    expect(rigaDelFile(f, RIGHE, { [chiaveFile(f)]: 'sparita' })).toBeNull()
  })
})

describe('ordine e stato', () => {
  it('prima quello che manca, poi in ordine di contratto', () => {
    expect(ordinaRighe(RIGHE).map((r) => r.id)).toEqual(['reg', 'pre', 'a', 'b', 'b1o', 'b1i', 'aff', 'cond', 'gar', 'd'])
  })
  it('i facoltativi che mancano vengono dopo i richiesti che mancano', () => {
    const righe = [riga('f', 'Visura', null, { is_required: false }), ...RIGHE]
    expect(ordinaRighe(righe).slice(0, 2).map((r) => r.id)).toEqual(['reg', 'f'])
  })
  it('chi non ha il numero viene dopo, per data di creazione', () => {
    const righe = [
      riga('z', 'Planimetria', 'planimetria.pdf', { created_at: '2026-11-01T00:00:00Z' }),
      riga('y', 'Visura', 'visura.pdf', { created_at: '2026-10-01T00:00:00Z' }),
      riga('n', 'Preliminare', '1. Preliminare.pdf'),
    ]
    expect(ordinaRighe(righe).map((r) => r.id)).toEqual(['n', 'y', 'z'])
  })
  it('conta solo i richiesti', () => {
    const s = statoContratto([...RIGHE, riga('f', 'Visura', null, { is_required: false })])
    expect(s).toEqual({ richiesti: 10, caricati: 9, mancanti: ['Regolamento immobiliare e commerciale'] })
  })
})

describe('destino di un file trascinato', () => {
  it('riempie la riga vuota', () => {
    expect(destinoDelFile('Regolamento immobiliare.pdf', RIGHE)).toEqual({ tipo: 'riempie', rigaId: 'reg' })
  })
  it('stesso nome della copia che vale: la sostituirebbe, quindi si chiede', () => {
    expect(destinoDelFile('1. Preliminare Locatore XYZ_SIGNED.pdf', RIGHE)).toEqual({ tipo: 'sostituisce', rigaId: 'pre' })
  })
  it('la riga ha già la sua copia: versione in più, senza chiedere', () => {
    expect(destinoDelFile('Allegato B Condizioni generali XYZ.doc', RIGHE)).toEqual({ tipo: 'versione', rigaId: 'cond' })
  })
  it('arriva la firmata e quella che vale non lo è: si chiede', () => {
    const righe = [riga('reg', 'Regolamento immobiliare e commerciale', 'Regolamento immobiliare.pdf')]
    expect(destinoDelFile('Regolamento immobiliare_SIGNED.pdf', righe)).toEqual({ tipo: 'sostituisce', rigaId: 'reg' })
    expect(destinoDelFile('Regolamento immobiliare bozza 2.pdf', righe)).toEqual({ tipo: 'versione', rigaId: 'reg' })
  })
  it('non riconosciuto: fra gli altri documenti', () => {
    expect(destinoDelFile('PRIMAutentica.docx', RIGHE)).toEqual({ tipo: 'altri' })
  })
})

describe('categoriaDalNome', () => {
  it('legge la categoria dal nome', () => {
    expect(categoriaDalNome('Rinnovo 2027.pdf')).toBe('rinnovo')
    expect(categoriaDalNome('Comunicazione del locatore.pdf')).toBe('comunicazione')
    expect(categoriaDalNome('Allegato F.pdf')).toBe('allegato')
    expect(categoriaDalNome('PRIMAutentica.docx')).toBe('contratto')
  })
})

describe('etichettaRiga', () => {
  it('porta sotto la precisazione fra parentesi e toglie il trattino lungo', () => {
    expect(etichettaRiga('Preliminare — scrittura privata v7 (firmata da entrambe le parti il 10/09/2026)'))
      .toEqual({ titolo: 'Preliminare · scrittura privata v7', nota: 'firmata da entrambe le parti il 10/09/2026' })
    expect(etichettaRiga('Condizioni Generali (All. B del contratto)')).toEqual({ titolo: 'Condizioni Generali', nota: 'All. B del contratto' })
    expect(etichettaRiga('Regolamento immobiliare e commerciale')).toEqual({ titolo: 'Regolamento immobiliare e commerciale', nota: '' })
    expect(etichettaRiga(null)).toEqual({ titolo: '', nota: '' })
  })
})

describe('riconoscimento prudente (revisione del 16/11/2026)', () => {
  const dove = (nome: string) => riconosciDocumento(nome, RIGHE).rigaId
  it('una parola sola in comune non basta: il file resta fra gli altri documenti', () => {
    expect(dove('Planimetria aggiornata negozio.pdf')).toBeNull()
    expect(dove('Regolamento.pdf')).toBeNull()
    expect(destinoDelFile('Planimetria aggiornata negozio.pdf', RIGHE)).toEqual({ tipo: 'altri' })
  })
  it('rinnovi, proroghe, disdette, comunicazioni, lettere, solleciti e verbali non vanno mai su una riga del contratto', () => {
    for (const nome of [
      'Comunicazione regolamento centro.pdf', 'Lettera disdetta affitto.pdf', 'Rinnovo affitto 2027.pdf',
      'Proroga ramo d azienda.pdf', 'Sollecito garanzia bancaria.pdf', 'Verbale regolamento immobiliare commerciale.pdf',
      'Comunicazione regolamento immobiliare e commerciale.pdf',
    ]) {
      expect(dove(nome), nome).toBeNull()
      expect(destinoDelFile(nome, RIGHE), nome).toEqual({ tipo: 'altri' })
    }
  })
  it('una riga mancante si riempie da sola solo con una prova forte', () => {
    expect(destinoDelFile('Comunicazione regolamento centro.pdf', RIGHE)).toEqual({ tipo: 'altri' })
    expect(destinoDelFile('Regolamento centro.pdf', RIGHE)).toEqual({ tipo: 'altri' })
    expect(destinoDelFile('Regolamento immobiliare e commerciale XYZ.pdf', RIGHE)).toEqual({ tipo: 'riempie', rigaId: 'reg' })
  })
  it('gli abbinamenti veri reggono ancora', () => {
    expect(dove('Allegato A al contratto_20250415-XYZ_K12-SchedaCommerciale.pdf')).toBe('a')
    expect(dove('ALLEGATO D al Contratto_ bozza garanzia bancaria.docx')).toBe('gar')
    expect(dove('Allegato B Condizioni generali XYZ.doc')).toBe('cond')
    expect(dove('Allegato E_XYZ - Informativa Tenants - v1.3.docx')).toBe('d')
  })
  it('i due casi dubbi restano fuori', () => {
    expect(dove('Allegato C_XYZ_K12 CESPITI.pdf')).toBeNull()
    expect(dove('PRIMAutentica.docx')).toBeNull()
  })
  it('lettera giusta più una parola basta', () => {
    expect(dove('Allegato B cespiti aggiornati.pdf')).toBe('b')
  })
  it('una riga che è lei stessa un rinnovo accetta il suo file, e solo quello', () => {
    const righe = [...RIGHE, riga('rin', 'Rinnovo del contratto di affitto 2027', null)]
    expect(riconosciDocumento('Rinnovo affitto ramo azienda 2027.pdf', righe).rigaId).toBe('rin')
    expect(riconosciDocumento('Rinnovo 2027.pdf', righe).rigaId).toBeNull() // una parola sola
    expect(riconosciDocumento('Lettera disdetta affitto.pdf', righe).rigaId).toBeNull()
  })
  it('la categoria di un file fra gli altri documenti si legge dal nome', () => {
    expect(categoriaDalNome('Sollecito pagamento.pdf')).toBe('comunicazione')
    expect(categoriaDalNome('Verbale consegna.pdf')).toBe('comunicazione')
    expect(categoriaDalNome('Proroga 2027.pdf')).toBe('rinnovo')
  })

  it('stesso nome di una versione messa a mano in una riga che manca: la riempie', () => {
    const mano = { reg: ['Norme del centro v3.pdf'] }
    expect(riconosciDocumento('Norme del centro v3_signed.pdf', RIGHE).rigaId).toBeNull()
    expect(riconosciDocumento('Norme del centro v3_signed.pdf', RIGHE, mano).rigaId).toBe('reg')
    expect(destinoDelFile('Norme del centro v3_signed.pdf', RIGHE, mano)).toEqual({ tipo: 'riempie', rigaId: 'reg' })
  })
})

