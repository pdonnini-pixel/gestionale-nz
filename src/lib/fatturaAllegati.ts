// Estrazione degli allegati dalla fattura salvata in `xml_content`.
// Su NZ ~187/769 fatture hanno un <Allegati> con il PDF del fornitore in base64
// dentro <Attachment>. Nessun file esterno (storage_path/xml_file_path sono NULL):
// l'unica fonte del PDF è il contenuto salvato.
//
// Due formati convivono nella stessa colonna, per come sono entrate le fatture:
//   • XML FatturaPA (canale SDI A-Cube) → <Allegati><Attachment>…
//   • JSON strutturato A-Cube (Cassetto Fiscale, dal 23/07/2026) → allegati[].attachment
// Il secondo formato porta gli stessi PDF (106 fatture su 350 al 21/09/2026), ma il
// parser XML non li vedeva: il pulsante "PDF" rispondeva "nessun PDF allegato".

export interface FatturaAllegato {
  nome: string
  formato: string
  isPdf: boolean
  data: Uint8Array
}

// Decodifica base64 tollerante a whitespace/newline (l'XML spesso wrappa il blob).
function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[\s\r\n]/g, '')
  const bin = atob(clean)
  const len = bin.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

// I primi 4 byte di un PDF sono "%PDF".
function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
}

// Riconosce il JSON strutturato A-Cube dal primo carattere utile, come fa
// InvoiceViewer per scegliere il parser dell'anteprima.
function isJsonContent(content: string): boolean {
  return content.trimStart().startsWith('{')
}

// Costruisce un allegato dai campi già decodificati, scartando il base64 vuoto
// o corrotto (regola comune ai due formati).
function buildAllegato(rawB64: string, nome: string, formato: string): FatturaAllegato | null {
  if (!rawB64) return null
  let data: Uint8Array
  try { data = base64ToBytes(rawB64) } catch { return null }
  if (data.length === 0) return null
  const isPdf = /pdf/i.test(formato) || /\.pdf$/i.test(nome) || looksLikePdf(data)
  return { nome, formato, isPdf, data }
}

// Allegati dal JSON strutturato A-Cube: fattura_elettronica_body[].allegati[],
// con chiavi snake_case (attachment, nome_attachment, formato_attachment).
function parseAllegatiJson(jsonString: string): FatturaAllegato[] {
  let root: unknown
  try { root = JSON.parse(jsonString) } catch { return [] }
  const bodiesRaw = (root as Record<string, unknown> | null)?.fattura_elettronica_body
  const bodies = Array.isArray(bodiesRaw) ? bodiesRaw : [bodiesRaw]
  const out: FatturaAllegato[] = []
  for (const bodyRaw of bodies) {
    const body = bodyRaw && typeof bodyRaw === 'object' ? (bodyRaw as Record<string, unknown>) : {}
    const allegati = Array.isArray(body.allegati) ? body.allegati : []
    allegati.forEach((itemRaw) => {
      // Alcune fatture hanno allegati: ["<base64>"] invece dell'oggetto completo.
      const item = itemRaw && typeof itemRaw === 'object' ? (itemRaw as Record<string, unknown>) : null
      const rawB64 = typeof itemRaw === 'string' ? itemRaw : typeof item?.attachment === 'string' ? item.attachment : ''
      const nome = typeof item?.nome_attachment === 'string' && item.nome_attachment.trim()
        ? item.nome_attachment.trim()
        : `allegato_${out.length + 1}`
      const formato = typeof item?.formato_attachment === 'string' ? item.formato_attachment.trim() : ''
      const allegato = buildAllegato(rawB64.trim(), nome, formato)
      if (allegato) out.push(allegato)
    })
  }
  return out
}

// Estrae tutti gli <Allegati> con un <Attachment> base64 valido.
// Namespace-agnostic: i figli di FatturaElettronicaBody non hanno prefisso
// (come già fa InvoiceViewer con getElementsByTagName).
export function parseFatturaAllegati(xml: string | null | undefined): FatturaAllegato[] {
  if (!xml) return []
  if (isJsonContent(xml)) return parseAllegatiJson(xml)
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml')
    if (doc.querySelector('parsererror')) return []
    const nodes = Array.from(doc.getElementsByTagName('Allegati'))
    const out: FatturaAllegato[] = []
    nodes.forEach((node, i) => {
      const get = (tag: string) => node.getElementsByTagName(tag)[0]?.textContent?.trim() || ''
      const allegato = buildAllegato(
        get('Attachment'),
        get('NomeAttachment') || `allegato_${i + 1}`,
        get('FormatoAttachment'),
      )
      if (allegato) out.push(allegato)
    })
    return out
  } catch {
    return []
  }
}

// Scarica un buffer binario col nome dato (no dipendenze esterne).
export function downloadBytes(bytes: Uint8Array, filename: string, mime = 'application/octet-stream'): void {
  // cast: i tipi TS recenti rendono Uint8Array<ArrayBufferLike> non assegnabile
  // a BlobPart, ma a runtime un Uint8Array è un BlobPart valido.
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
