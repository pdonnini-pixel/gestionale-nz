// Estrazione degli allegati (<Allegati>) dalla FatturaPA (xml_content).
// Su NZ ~187/769 fatture hanno un <Allegati> con il PDF del fornitore in base64
// dentro <Attachment>. Nessun file esterno (storage_path/xml_file_path sono NULL):
// l'unica fonte del PDF è l'XML stesso.

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

// Estrae tutti gli <Allegati> con un <Attachment> base64 valido.
// Namespace-agnostic: i figli di FatturaElettronicaBody non hanno prefisso
// (come già fa InvoiceViewer con getElementsByTagName).
export function parseFatturaAllegati(xml: string | null | undefined): FatturaAllegato[] {
  if (!xml) return []
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml')
    if (doc.querySelector('parsererror')) return []
    const nodes = Array.from(doc.getElementsByTagName('Allegati'))
    const out: FatturaAllegato[] = []
    nodes.forEach((node, i) => {
      const get = (tag: string) => node.getElementsByTagName(tag)[0]?.textContent?.trim() || ''
      const raw = get('Attachment')
      if (!raw) return
      let data: Uint8Array
      try { data = base64ToBytes(raw) } catch { return }
      if (data.length === 0) return
      const nome = get('NomeAttachment') || `allegato_${i + 1}`
      const formato = get('FormatoAttachment')
      const isPdf = /pdf/i.test(formato) || /\.pdf$/i.test(nome) || looksLikePdf(data)
      out.push({ nome, formato, isPdf, data })
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
