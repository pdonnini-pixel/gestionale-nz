// ─────────────────────────────────────────────────────────────────────────────
// GUIDE PASSO PASSO — schermate con i riquadri rossi numerati + PDF scaricabile.
//
// Le mostra il pannello «?» (tab Guida, sezione «Guide passo passo») sulle
// pagine che le richiamano da `pageGuides.ts` (campo `tutorials`), e i passi
// finiscono anche nel contesto dell'assistente AI (help-chat).
//
// I file stanno in `public/guide/<id>/` e si rigenerano con lo script
// `tools/guide-tutorials/capture.mjs <id>` (gestionale vero, dati INVENTATI:
// il repo è pubblico e le guide le vedono tutti e 3 i tenant, quindi mai
// clienti, fornitori o importi reali nelle schermate).
// ─────────────────────────────────────────────────────────────────────────────

export interface TutorialStep {
  /** Numero del riquadro rosso nella schermata. */
  n: number
  text: string
}

export interface TutorialShot {
  /** File in public/guide/<id>/ */
  image: string
  title: string
  steps: TutorialStep[]
}

export interface GuideTutorial {
  id: string
  title: string
  /** A cosa serve, in una o due frasi. */
  intro: string
  shots: TutorialShot[]
  /** PDF con tutte le schermate, in public/guide/<id>/ */
  pdf: string
}

export const GUIDE_TUTORIALS: GuideTutorial[] = [
  {
    id: 'fatture-moda-xml',
    title: 'Fatture di Moda in XML, da sola',
    intro: "Quando Moda produce delle fatture (il file ModaFatture.xls), il gestionale le trasforma nei file XML da mandare allo studio. Bastano pochi minuti e nove clic, segnati nelle schermate con i numeri nei cerchi rossi.",
    pdf: 'guida.pdf',
    shots: [
      {
        image: '1_fatturazione.png',
        title: 'Apri Fatturazione',
        steps: [
          { n: 1, text: 'Nel menu a sinistra, sotto «Ciclo Passivo», clicca «Fatturazione».' },
          { n: 2, text: 'In alto clicca la scheda «Fatture Attive»: la pagina si apre su Fatture Passive.' },
        ],
      },
      {
        image: '2_fatture_attive.png',
        title: 'Apri il convertitore',
        steps: [{ n: 3, text: 'Clicca il pulsante verde «Converti Excel → XML».' }],
      },
      {
        image: '3_converti.png',
        title: 'Controlla il numero e carica il file',
        steps: [
          { n: 4, text: 'Il riquadro azzurro dice da che numero si parte: è già giusto, non va toccato.' },
          { n: 5, text: 'Trascina qui il file Excel esportato da Moda, oppure cliccaci sopra e sceglilo dal computer.' },
        ],
      },
      {
        image: '4_genera.png',
        title: 'Genera i file',
        steps: [{ n: 6, text: 'Clicca il pulsante blu «Genera XML».' }],
      },
      {
        image: '5_risultato.png',
        title: 'Controlla e scarica',
        steps: [
          { n: 7, text: 'Nella colonna «Quadra» deve esserci OK su ogni riga. Se c’è un NO rosso, fermati e chiedi prima di mandare i file.' },
          { n: 8, text: 'Clicca «Scarica tutti (.zip)» e manda il file .zip allo studio.' },
        ],
      },
      {
        image: '6_archivio.png',
        title: 'Se ti servono di nuovo',
        steps: [{ n: 9, text: 'In fondo alla pagina, in «Archivio generazioni», ritrovi ogni conversione: con «Scarica .zip» la riscarichi quando vuoi. Non usare «Elimina».' }],
      },
    ],
  },
]

export const TUTORIAL_BY_ID = new Map(GUIDE_TUTORIALS.map((t) => [t.id, t]))

/** Percorso pubblico di un file della guida (servito da Netlify su tutti e 3 i site). */
export const tutorialFile = (t: GuideTutorial, file: string): string => `/guide/${t.id}/${file}`

/** Testo dei passi, per il contesto dell'assistente AI. */
export function tutorialAsText(t: GuideTutorial): string {
  const passi = t.shots.flatMap((s) => s.steps.map((st) => `${st.n}. ${st.text}`))
  return `Guida passo passo «${t.title}» (con schermate e PDF nella tab Guida): ${t.intro}\n${passi.join('\n')}`
}
