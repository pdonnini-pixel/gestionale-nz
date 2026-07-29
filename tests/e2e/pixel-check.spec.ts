import { test, expect } from '@playwright/test'

/**
 * Pixel check — smoke UI sul sito DEPLOYATO.
 *
 * Cosa verifica, per il tenant puntato da BASE_URL:
 *  1) il login email+password funziona;
 *  2) le pagine chiave si aprono senza eccezioni JS non gestite;
 *  3) nessuna risposta di rete 5xx;
 *  4) dopo il login non si resta sulla schermata di login.
 *
 * Gli errori console vengono raccolti e stampati nel report, ma NON fanno
 * fallire il test da soli (troppi falsi positivi da rumore di terze parti):
 * il fallimento scatta su eccezioni JS non gestite (pageerror) e su 5xx,
 * che sono i segnali affidabili di "UI rotta".
 *
 * Pagine chiave: aggiungere qui le rotte stabili da controllare.
 */
const PAGES = ['/', '/scadenzario', '/fatturazione', '/banche', '/fornitori', '/report-sincronizzazioni'] // '/' = dashboard; rotte chiave del ciclo passivo + banche + report sync

const EMAIL = process.env.TEST_USER_EMAIL
const PASSWORD = process.env.TEST_USER_PASSWORD

test.describe('Pixel check', () => {
  test.skip(!EMAIL || !PASSWORD, 'TEST_USER_EMAIL / TEST_USER_PASSWORD non impostati')

  test('login + pagine chiave senza errori', async ({ page }) => {
    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    const serverErrors: string[] = []

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', (err) => pageErrors.push(err.message))
    page.on('response', (res) => {
      if (res.status() >= 500) serverErrors.push(`${res.status()} ${res.url()}`)
    })

    // 1) Login
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.locator('input[type="email"]').fill(EMAIL!)
    await page.locator('input[type="password"]').fill(PASSWORD!)
    await page.locator('button[type="submit"]').click()

    // Uscita dalla schermata di login: il campo password sparisce dal DOM
    await page
      .locator('input[type="password"]')
      .waitFor({ state: 'detached', timeout: 20_000 })

    // 2) Pagine chiave
    for (const path of PAGES) {
      await page.goto(path, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('body')).toBeVisible()
      // non deve essere ricomparsa la schermata di login (sessione persa/crash)
      await expect(page.locator('input[type="password"]')).toHaveCount(0)
    }

    // 3) Report Sincronizzazioni: la card del feed "Fatture attive" deve
    //    comparire su tutti e 3 i tenant (feed di prima classe, sempre reso
    //    anche senza dati: card grigia "Nessuna sincronizzazione").
    await page.goto('/report-sincronizzazioni', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
    await expect(page.getByText('Fatture attive', { exact: true }).first())
      .toBeVisible({ timeout: 15_000 })

    // 4) Report + asserzioni affidabili
    if (consoleErrors.length) {
      console.log(`⚠️ Console errors (${consoleErrors.length}):\n` + consoleErrors.join('\n'))
    }
    expect(pageErrors, `Eccezioni JS non gestite:\n${pageErrors.join('\n')}`).toEqual([])
    expect(serverErrors, `Risposte 5xx:\n${serverErrors.join('\n')}`).toEqual([])
  })
})
