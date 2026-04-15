/**
 * CE Tree helpers — shared between BudgetControl and Outlet simulation
 */

export function getCodeLevel(code) {
  if (!code) return 0
  const len = code.replace(/\s/g, '').length
  if (len <= 2) return 0; if (len <= 4) return 1; if (len <= 6) return 2; return 3
}

export function buildTree(rows) {
  if (!rows || !rows.length) return []
  const tree = [], stack = []
  for (const row of rows) {
    const node = { ...row, children: [] }
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) stack.pop()
    if (stack.length === 0) tree.push(node); else stack[stack.length - 1].node.children.push(node)
    stack.push({ node, level: node.level })
  }
  return tree
}

export function sumMacros(tree) { return tree.reduce((s, n) => s + (n.amount || 0), 0) }

export function applyEdits(tree, edits) {
  if (!tree || !tree.length) return []
  return tree.map(node => {
    const children = node.children?.length ? applyEdits(node.children, edits) : []
    let amount
    if (children.length > 0) {
      amount = children.reduce((s, c) => s + (c.amount || 0), 0)
    } else {
      amount = edits[node.code] != null ? edits[node.code] : (node.amount || 0)
    }
    return { ...node, amount, children }
  })
}

export function applyEditsZero(tree, edits) {
  if (!tree || !tree.length) return []
  return tree.map(node => {
    const children = node.children?.length ? applyEditsZero(node.children, edits) : []
    let amount
    if (children.length > 0) {
      amount = children.reduce((s, c) => s + (c.amount || 0), 0)
    } else {
      const v = edits[node.code]
      amount = (v != null && typeof v === 'number') ? v : 0
    }
    return { ...node, amount, children }
  })
}

export function flattenLeaves(tree) {
  const result = {}
  const walk = nodes => nodes.forEach(n => {
    if (n.children?.length) walk(n.children)
    else result[n.code] = n.amount || 0
  })
  walk(tree)
  return result
}

export function fmt(n) {
  if (n == null || isNaN(n)) return '—'
  return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(n)
}

export function fmtC(n) {
  return `${fmt(n)} €`
}
