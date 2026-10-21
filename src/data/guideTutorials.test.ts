import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { GUIDE_TUTORIALS, TUTORIAL_BY_ID, tutorialAsText } from './guideTutorials'
import { PAGE_GUIDES } from './pageGuides'

const publicFile = (id: string, file: string) => join(process.cwd(), 'public', 'guide', id, file)

describe('guide passo passo', () => {
  it('ogni guida richiamata da una pagina esiste', () => {
    for (const g of PAGE_GUIDES) {
      for (const id of g.tutorials ?? []) expect(TUTORIAL_BY_ID.has(id), `${g.path} → ${id}`).toBe(true)
    }
  })

  it('schermate e PDF sono pubblicati in public/guide/<id>/', () => {
    for (const t of GUIDE_TUTORIALS) {
      expect(existsSync(publicFile(t.id, t.pdf)), `${t.id}/${t.pdf}`).toBe(true)
      for (const s of t.shots) expect(existsSync(publicFile(t.id, s.image)), `${t.id}/${s.image}`).toBe(true)
    }
  })

  it('i riquadri sono numerati 1..N senza buchi, nell\'ordine delle schermate', () => {
    for (const t of GUIDE_TUTORIALS) {
      const nums = t.shots.flatMap((s) => s.steps.map((st) => st.n))
      expect(nums).toEqual(nums.map((_, i) => i + 1))
    }
  })

  it('il testo per l\'assistente contiene tutti i passi', () => {
    const t = GUIDE_TUTORIALS[0]
    const txt = tutorialAsText(t)
    for (const s of t.shots) for (const st of s.steps) expect(txt).toContain(st.text)
  })
})
