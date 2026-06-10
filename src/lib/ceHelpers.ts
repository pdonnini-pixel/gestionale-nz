/**
 * CE Tree helpers — shared between BudgetControl and Outlet simulation
 */

// TODO: tighten type — align with DB schema when generated types are available
export interface CETreeNode {
  code: string;
  level: number;
  amount: number;
  children: CETreeNode[];
  [key: string]: unknown;
}

export function getCodeLevel(code: string | null | undefined): number {
  if (!code) return 0
  const len = code.replace(/\s/g, '').length
  if (len <= 2) return 0; if (len <= 4) return 1; if (len <= 6) return 2; return 3
}

export function buildTree(rows: Array<{ code: string; level: number; amount: number; [key: string]: unknown }>): CETreeNode[] {
  if (!rows || !rows.length) return []
  const tree: CETreeNode[] = [], stack: Array<{ node: CETreeNode; level: number }> = []
  for (const row of rows) {
    const node: CETreeNode = { ...row, children: [] }
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) stack.pop()
    if (stack.length === 0) tree.push(node); else stack[stack.length - 1].node.children.push(node)
    stack.push({ node, level: node.level })
  }
  return tree
}

export function sumMacros(tree: CETreeNode[]): number { return tree.reduce((s: number, n: CETreeNode) => s + (n.amount || 0), 0) }

export function applyEdits(tree: CETreeNode[], edits: Record<string, number>): CETreeNode[] {
  if (!tree || !tree.length) return []
  return tree.map(node => {
    const children = node.children?.length ? applyEdits(node.children, edits) : []
    let amount: number
    if (children.length > 0) {
      amount = children.reduce((s: number, c: CETreeNode) => s + (c.amount || 0), 0)
    } else {
      amount = edits[node.code] != null ? edits[node.code] : (node.amount || 0)
    }
    return { ...node, amount, children }
  })
}

export function applyEditsZero(tree: CETreeNode[], edits: Record<string, number>): CETreeNode[] {
  if (!tree || !tree.length) return []
  return tree.map(node => {
    const children = node.children?.length ? applyEditsZero(node.children, edits) : []
    let amount: number
    if (children.length > 0) {
      amount = children.reduce((s: number, c: CETreeNode) => s + (c.amount || 0), 0)
    } else {
      const v = edits[node.code]
      amount = (v != null && typeof v === 'number') ? v : 0
    }
    return { ...node, amount, children }
  })
}

export function flattenLeaves(tree: CETreeNode[]): Record<string, number> {
  const result: Record<string, number> = {}
  const walk = (nodes: CETreeNode[]) => nodes.forEach(n => {
    if (n.children?.length) walk(n.children)
    else result[n.code] = n.amount || 0
  })
  walk(tree)
  return result
}

export function fmt(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—'
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(n)
}

export function fmtC(n: number | null | undefined): string {
  return `${fmt(n)} €`
}

// Variante con 2 decimali e separatore migliaia (anche sulle 4 cifre): locale
// 'de-DE' → "2.323.996,01" (it-IT non raggrupperebbe i numeri di 4 cifre).
export function fmt2(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—'
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

export function fmtC2(n: number | null | undefined): string {
  return `${fmt2(n)} €`
}

// Parsing di un importo digitato in formato italiano. Accetta:
//  - virgola decimale: "250,50" → 250.5
//  - punti come separatore migliaia (opzionali): "1.250,50" → 1250.5
//  - tolleranza al punto come decimale quando non c'è virgola: "250.50" → 250.5
// Un singolo punto con 3 cifre dopo è interpretato come migliaia ("1.250" → 1250),
// altrimenti come decimale. Più punti = tutti migliaia ("1.250.000" → 1250000).
// Stringa vuota o non numerica → 0. Non restituisce MAI NaN.
export function parseImportoIt(s: string | null | undefined): number {
  if (s == null) return 0
  // tieni solo cifre, separatori e segno meno
  const t = String(s).trim().replace(/[^0-9.,-]/g, '')
  if (!t || t === '-' || t === '.' || t === ',') return 0
  let normalized: string
  if (t.includes(',')) {
    // virgola = decimale; i punti sono migliaia → rimuovili
    normalized = t.replace(/\./g, '').replace(',', '.')
  } else {
    const parts = t.split('.')
    if (parts.length <= 1) {
      normalized = t // nessun separatore
    } else if (parts.length > 2) {
      normalized = parts.join('') // più punti → tutti migliaia
    } else {
      // un solo punto: 3 cifre dopo → migliaia, altrimenti decimale
      normalized = (parts[1].length === 3 && parts[0].length >= 1)
        ? parts[0] + parts[1]
        : parts[0] + '.' + parts[1]
    }
  }
  const n = parseFloat(normalized)
  return isNaN(n) ? 0 : n
}
