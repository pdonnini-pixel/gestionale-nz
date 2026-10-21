#!/usr/bin/env node
/**
 * Rigenera le schermate e il PDF di una guida passo passo
 * (src/data/guideTutorials.ts → public/guide/<id>/).
 *
 * Apre il gestionale VERO (dev server locale) con un backend Supabase FINTO:
 * ogni chiamata a https://mock.supabase.co è intercettata e riceve dati
 * inventati. Niente login vero, nessun dato dei tenant: il repo è pubblico e
 * le guide le vedono tutti e 3 i tenant.
 *
 * Uso (da root del repo):
 *   1. VITE_SUPABASE_URL=https://mock.supabase.co VITE_SUPABASE_ANON_KEY=x npx vite --port 5173
 *   2. node tools/guide-tutorials/capture.mjs fatture-moda-xml
 *
 * Playwright non è una dipendenza del progetto: se non è risolvibile da qui,
 * indica il modulo con PLAYWRIGHT_MODULE=/percorso/playwright/index.mjs e, se
 * serve, il browser con CHROMIUM_PATH.
 */

import { mkdirSync, writeFileSync, readFileSync, mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as XLSX from 'xlsx'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASE = process.env.APP_URL || 'http://localhost:5173'
const id = process.argv[2]
if (!id) { console.error('Uso: node tools/guide-tutorials/capture.mjs <id-guida>'); process.exit(1) }

// Le definizioni (titoli e passi) sono le stesse mostrate nel pannello «?».
const { GUIDE_TUTORIALS } = await import(pathToFileURL(join(ROOT, 'src/data/guideTutorials.ts')).href)
const tutorial = GUIDE_TUTORIALS.find((t) => t.id === id)
if (!tutorial) { console.error(`Guida «${id}» non trovata in src/data/guideTutorials.ts`); process.exit(1) }
const OUT = join(ROOT, 'public', 'guide', id)
mkdirSync(OUT, { recursive: true })

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

// ─── Dati inventati ──────────────────────────────────────────────────────
const UID = '11111111-1111-1111-1111-111111111111'
const CID = '22222222-2222-2222-2222-222222222222'
const AZIENDA = { nome: 'Azienda Esempio', ragione: 'AZIENDA ESEMPIO S.R.L.', piva: '12345678901' }
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const exp = Math.floor(Date.now() / 1000) + 86400
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, exp, role: 'authenticated', aud: 'authenticated' })}.firma-finta`
const user = { id: UID, aud: 'authenticated', role: 'authenticated', email: 'utente@esempio.it', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
const session = { access_token: jwt, refresh_token: 'finto', token_type: 'bearer', expires_in: 86400, expires_at: exp, user }

function baseTables() {
  return {
    user_profiles: [{ id: UID, company_id: CID, role: 'contabile', first_name: 'Utente', last_name: 'Esempio', email: user.email, is_active: true }],
    companies: [{ id: CID, name: AZIENDA.nome, vat_number: AZIENDA.piva, pec: null, sdi_code: null, point_of_sale_label: 'Negozio' }],
    company_settings: [{ ragione_sociale: AZIENDA.ragione, partita_iva: AZIENDA.piva, sede_indirizzo: 'Via Roma 1', sede_cap: '50100', sede_comune: 'FIRENZE', sede_provincia: 'FI', regime_fiscale: 'RF01' }],
  }
}

// Backend PostgREST/Auth finto: tabelle in memoria, insert accodati.
function mockBackend(tables, onInsert = {}) {
  return async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const p = url.pathname
    const json = (body, status = 200, headers = {}) => route.fulfill({
      status, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0', ...headers },
      body: JSON.stringify(body),
    })
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
    if (p.startsWith('/auth/v1/user')) return json(user)
    if (p.startsWith('/auth/v1/')) return json(session)
    if (p.startsWith('/rest/v1/rpc/get_or_associate_tenant_company')) return json(CID)
    if (p.startsWith('/rest/v1/rpc/')) return json(null)
    if (p.startsWith('/rest/v1/')) {
      const t = p.slice('/rest/v1/'.length)
      if (req.method() === 'POST') {
        const rows = JSON.parse(req.postData() || '[]')
        onInsert[t]?.(Array.isArray(rows) ? rows : [rows], tables)
        return json([], 201)
      }
      let rows = tables[t] ?? []
      const order = url.searchParams.get('order')
      if (order) {
        const [col, dir] = order.split(',')[0].split('.')
        rows = [...rows].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1))
      }
      const lim = parseInt(url.searchParams.get('limit') || '', 10)
      if (lim > 0) rows = rows.slice(0, lim)
      if ((req.headers()['accept'] || '').includes('vnd.pgrst.object')) {
        return rows.length ? json(rows[0]) : json({ code: 'PGRST116', message: 'no rows' }, 406)
      }
      return json(rows, 200, { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` })
    }
    if (p.startsWith('/functions/v1/')) return json({})
    if (p.startsWith('/storage/v1/')) return json({ Key: 'finto', path: 'finto' })
    return json({})
  }
}

// ─── Riquadri rossi numerati ─────────────────────────────────────────────
// mark: { n, text, sel, side: 'left'|'right'|'top', fullColumn }
async function annotate(page, marks) {
  await page.evaluate((marks) => {
    document.querySelectorAll('.__ann').forEach((e) => e.remove())
    for (const m of marks) {
      const el = [...document.querySelectorAll(m.sel)]
        .filter((e) => e.textContent.trim().startsWith(m.text) && e.offsetParent !== null)
        .sort((a, b) => a.textContent.length - b.textContent.length)[0]
      if (!el) throw new Error(`Elemento non trovato per il riquadro ${m.n}: «${m.text}»`)
      const r = el.getBoundingClientRect()
      // Colonna intera di una tabella (es. «Quadra»): dall'intestazione all'ultima riga.
      const bottom = m.fullColumn ? el.closest('table').getBoundingClientRect().bottom : r.bottom
      const pad = 6
      const box = document.createElement('div')
      box.className = '__ann'
      Object.assign(box.style, {
        position: 'absolute', left: r.left + scrollX - pad + 'px', top: r.top + scrollY - pad + 'px',
        width: r.width + pad * 2 + 'px', height: bottom - r.top + pad * 2 + 'px',
        border: '4px solid #e11d48', borderRadius: '10px', zIndex: 99999, pointerEvents: 'none',
        boxShadow: '0 0 0 4px rgba(225,29,72,.18)',
      })
      const n = document.createElement('div')
      n.className = '__ann'
      n.textContent = String(m.n)
      const left = m.side === 'right' ? r.right + pad + 8 : m.side === 'top' ? r.left + r.width / 2 - 18 : r.left - pad - 44
      const top = m.side === 'top' ? r.top - pad - 46 : r.top - pad
      Object.assign(n.style, {
        position: 'absolute', left: Math.max(4, left + scrollX) + 'px', top: top + scrollY + 'px',
        width: '36px', height: '36px', lineHeight: '36px', borderRadius: '50%', background: '#e11d48',
        color: '#fff', font: '700 20px system-ui,sans-serif', textAlign: 'center', zIndex: 99999,
        pointerEvents: 'none', boxShadow: '0 2px 6px rgba(0,0,0,.3)',
      })
      document.body.append(box, n)
    }
  }, marks)
}

// Toglie la banda «Tenant attivo»: in locale direbbe sempre il tenant di default.
async function hideTenantBand(page) {
  await page.evaluate(() => {
    document.querySelector('div[title^="Stai operando sul tenant"]')?.remove()
  })
}

async function scrollTo(page, sel, text, block = 'center') {
  await page.evaluate(({ sel, text, block }) => {
    const el = [...document.querySelectorAll(sel)].filter((e) => e.textContent.trim().startsWith(text)).pop()
    el.scrollIntoView({ block })
  }, { sel, text, block })
  await page.waitForTimeout(400)
}

// ─── Scenari: uno per guida ──────────────────────────────────────────────
const SCENARIOS = {
  'fatture-moda-xml': {
    tables() {
      const archivio = [
        [41, '7/2026/A/NEG1', '2026-10-09', 'VERDI CALZATURE S.R.L.', 141.36, '2026-10-14T07:13:41Z'],
        [40, '5/2026/A/NEG2', '2026-10-02', 'NERI SPORT S.R.L.', 237, '2026-10-05T08:26:01Z'],
        [39, '1/2026/NEG3', '2026-09-21', 'GIALLI MARCO', 89.54, '2026-09-22T13:55:37Z'],
      ].map(([p, n, d, c, t, ca]) => ({
        id: 'a' + p, batch_id: 'b' + p, progressivo: p, file_name: `IT${AZIENDA.piva}_000${p}.xml`,
        invoice_number: n, invoice_date: d, client_name: c, imponibile: null, imposta: null, totale: t,
        quadra: true, xml_content: '<x/>', created_at: ca,
      }))
      return { ...baseTables(), fattura_xml_export: archivio }
    },
    onInsert: {
      fattura_xml_export(rows, tables) {
        const now = new Date().toISOString()
        tables.fattura_xml_export = [...rows.map((r, i) => ({ id: 'n' + i, created_at: now, ...r })), ...tables.fattura_xml_export]
      },
    },
    // Export di Moda inventato: riga 1 titolo, riga 2 intestazioni, dati dalla 3.
    fixture(dir) {
      const head = ['', 'Colore', 'StatoFE', 'Cod.interno', 'A', 'Data Ins.', 'Tipo', 'Cau.', 'Accr.', 'Data Fat.', 'N.Fat.', 'Boll.', 'Suff.', 'Num.Fat.Stamp.', 'Tot.', 'N.Rig.', 'Qta.', 'Neg.', 'Negozio', 'Cod.Cliente Fat.', 'Cliente Fat. Descrizione', 'P.IVA', 'Cod.Fisc.', 'Località', 'Cap', 'Indirizzo', 'Provincia', 'Nazione', 'Cod.Cliente', 'Cliente Descrizione', 'Tipo', 'Data Ins.', 'Data Mod.', 'Note', 'Cod.Univ.Fatt.', 'Imponibile', 'Imposta', 'Totale Fatt.', 'Omaggi', 'Tot. A Pagare', 'Decorrenza', 'Pag.', 'Pagamento']
      const riga = (num, serial, tot, imp, iva, cliente, piva, loc, cap, ind, prov) => {
        const r = Array(head.length).fill('')
        const set = (k, v) => { r[head.indexOf(k)] = v }
        set('Data Fat.', serial); set('N.Fat.', num); set('Num.Fat.Stamp.', `${num}/2026/A/NEG1`); set('Tot.', tot)
        set('Negozio', 'Negozio 1'); set('Cliente Fat. Descrizione', cliente); set('P.IVA', piva); set('Località', loc)
        set('Cap', cap); set('Indirizzo', ind); set('Provincia', prov); set('Nazione', 'Italia')
        set('Imponibile', imp); set('Imposta', iva); set('Totale Fatt.', tot); set('Pagamento', 'Contanti')
        return r
      }
      const rows = [
        ['Moda - Fatture | esempio'],
        head,
        riga(8, 46312, 212.4, 174.1, 38.3, 'ROSSI ABBIGLIAMENTO S.R.L.', '11111111111', 'Bologna', '40100', 'Via Esempio 10', 'Bologna'),
        riga(9, 46313, 88.2, 72.3, 15.9, 'BIANCHI MODA S.R.L.', '22222222222', 'Milano', '20100', 'Corso Esempio 5', 'Milano'),
      ]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Moda - Fatture')
      const file = join(dir, 'ModaFatture.xls')
      XLSX.writeFile(wb, file, { bookType: 'biff8' })
      return file
    },
    async run(page, shot, fixture) {
      await page.goto(BASE + '/fatturazione')
      await shot('1_fatturazione.png', [
        { n: 1, text: 'Fatturazione', sel: 'nav a, aside a', side: 'right' },
        { n: 2, text: 'Fatture Attive', sel: 'button', side: 'right' },
      ])
      await page.goto(BASE + '/fatturazione?tab=active')
      await shot('2_fatture_attive.png', [{ n: 3, text: 'Converti Excel', sel: 'a', side: 'top' }])
      await page.goto(BASE + '/fatturazione/converti-xml')
      await shot('3_converti.png', [
        { n: 4, text: "L'ultima fattura", sel: 'div' },
        { n: 5, text: 'Trascina qui il file', sel: 'div' },
      ])
      await page.setInputFiles('input[type=file]', fixture)
      await page.waitForTimeout(1200)
      await scrollTo(page, 'button', 'Genera XML')
      await shot('4_genera.png', [
        { n: 5, text: 'Trascina qui il file', sel: 'div' },
        { n: 6, text: 'Genera XML', sel: 'button' },
      ], { navigated: false })
      await page.locator('button', { hasText: 'Genera XML' }).click()
      await page.waitForTimeout(2000)
      await scrollTo(page, 'button', 'Scarica tutti')
      await shot('5_risultato.png', [
        { n: 7, text: 'Quadra', sel: 'th', side: 'top', fullColumn: true },
        { n: 8, text: 'Scarica tutti', sel: 'button', side: 'right' },
      ], { navigated: false })
      await scrollTo(page, 'div', 'Archivio generazioni', 'start')
      await shot('6_archivio.png', [{ n: 9, text: 'Scarica .zip', sel: 'button', side: 'top' }], { navigated: false })
    },
  },
}

const scenario = SCENARIOS[id]
if (!scenario) { console.error(`Manca lo scenario «${id}» in tools/guide-tutorials/capture.mjs`); process.exit(1) }

const work = mkdtempSync(join(tmpdir(), 'guida-'))
const fixture = scenario.fixture?.(work)
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, locale: 'it-IT', timezoneId: 'Europe/Rome' })
await ctx.route('https://mock.supabase.co/**', mockBackend(scenario.tables(), scenario.onInsert))
await ctx.addInitScript((s) => { localStorage.setItem('sb-mock-auth-token', JSON.stringify(s)) }, session)
const page = await ctx.newPage()
page.on('pageerror', (e) => console.warn('[pagina]', e.message))

const shots = []
async function shot(file, marks, { navigated = true } = {}) {
  if (navigated) await page.waitForTimeout(2500)
  await hideTenantBand(page)
  await annotate(page, marks)
  await page.screenshot({ path: join(OUT, file) })
  shots.push(file)
  console.log('✓', file)
}
await scenario.run(page, shot, fixture)

// Controllo: le schermate prodotte devono essere quelle dichiarate nella guida.
const attese = tutorial.shots.map((s) => s.image)
if (attese.join() !== shots.join()) throw new Error(`Schermate prodotte (${shots}) diverse da quelle della guida (${attese})`)

// PDF: copertina + una pagina per schermata, stessi testi del pannello.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const img = (f) => 'data:image/png;base64,' + readFileSync(join(OUT, f)).toString('base64')
const html = `<!doctype html><html lang="it"><meta charset="utf-8"><style>
@page{size:A4 landscape;margin:12mm}body{font-family:system-ui,sans-serif;color:#0f172a;margin:0}
.p{page-break-after:always;display:flex;flex-direction:column;height:180mm}.p:last-child{page-break-after:auto}
h1{font-size:22px;margin:0 0 8px}h2{font-size:19px;margin:0 0 6px}.k{color:#e11d48}
ul{margin:0 0 8px;padding:0;list-style:none;font-size:14px;line-height:1.6}
.n{display:inline-block;background:#e11d48;color:#fff;border-radius:50%;width:20px;height:20px;text-align:center;line-height:20px;font-size:12px;font-weight:700;margin-right:6px}
img{flex:1;min-height:0;object-fit:contain;object-position:left top;border:1px solid #cbd5e1;border-radius:6px}
.c{font-size:15px;line-height:1.6}</style><body>
<div class="p"><h1>${esc(tutorial.title)}</h1><p class="c">${esc(tutorial.intro)}</p></div>
${tutorial.shots.map((s, i) => `<div class="p"><h2><span class="k">Passo ${i + 1}.</span> ${esc(s.title)}</h2><ul>${s.steps.map((st) => `<li><span class="n">${st.n}</span>${esc(st.text)}</li>`).join('')}</ul><img src="${img(s.image)}"></div>`).join('')}
</body></html>`
const pdfPage = await browser.newPage()
await pdfPage.setContent(html, { waitUntil: 'load' })
writeFileSync(join(OUT, tutorial.pdf), await pdfPage.pdf({ format: 'A4', landscape: true, printBackground: true }))
console.log('✓', tutorial.pdf)
await browser.close()
