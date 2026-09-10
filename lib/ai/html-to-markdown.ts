// HTML to Markdown, in about two hundred lines and with no new dependency.
//
// The input is never arbitrary web HTML: it is what a page-builder rich-text
// field stores, which is a small, well-formed subset - headings, paragraphs,
// emphasis, links, lists, quotes, code, tables, images. So this parses that
// subset properly and throws the rest away, rather than pulling a whole DOM
// implementation into a module function to do it.
//
// Defensive on purpose. Anything unrecognised becomes its own text content,
// which is the one failure mode that cannot lose meaning: a reader gets prose
// without the formatting rather than a hole where a section used to be.

type ElementNode = {
  kind: 'element'
  name: string
  attrs: Record<string, string>
  children: Node[]
}
type TextNode = { kind: 'text'; value: string }
type Node = ElementNode | TextNode

// Elements that never have a closing tag.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

// Elements whose contents are not markup and must never be parsed as such.
const RAW_TEXT = new Set(['script', 'style'])

const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'div', 'dl', 'dd', 'dt', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
])

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–',
  mdash: '—', hellip: '…', pound: '£', euro: '€', copy: '©',
  reg: '®', trade: '™', laquo: '«', raquo: '»', rsquo: '’',
  lsquo: '‘', ldquo: '“', rdquo: '”', deg: '°', times: '×',
  frac12: '½', frac14: '¼', middot: '·', bull: '•',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1]?.toLowerCase() === 'x'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10)
      // A code point outside the Unicode range would make String.fromCodePoint
      // throw, and one stray "&#99999999;" must not take a whole catalogue
      // rebuild down with it.
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[body.toLowerCase()] ?? whole
  })
}

const TAG_RE = /<(\/)?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'`=<>]+))?)*)\s*(\/)?>/g
const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  if (!raw.trim()) return attrs
  ATTR_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ATTR_RE.exec(raw)) !== null) {
    const name = m[1]!.toLowerCase()
    const value = m[2] ?? m[3] ?? m[4] ?? ''
    attrs[name] = decodeEntities(value)
  }
  return attrs
}

function parse(html: string): Node[] {
  const root: ElementNode = { kind: 'element', name: '#root', attrs: {}, children: [] }
  const stack: ElementNode[] = [root]
  let cursor = 0
  TAG_RE.lastIndex = 0
  let match: RegExpExecArray | null

  const pushText = (value: string) => {
    if (!value) return
    stack[stack.length - 1]!.children.push({ kind: 'text', value: decodeEntities(value) })
  }

  while ((match = TAG_RE.exec(html)) !== null) {
    pushText(html.slice(cursor, match.index))
    cursor = match.index + match[0].length

    const closing = !!match[1]
    const name = match[2]!.toLowerCase()

    if (closing) {
      // Close the nearest matching ancestor. An unmatched close tag is ignored
      // rather than allowed to unwind the whole stack - one stray </div> in a
      // pasted-in block must not end the document.
      const at = stack.findLastIndex((n) => n.name === name)
      if (at > 0) stack.length = at
      continue
    }

    const node: ElementNode = { kind: 'element', name, attrs: parseAttrs(match[3] ?? ''), children: [] }
    stack[stack.length - 1]!.children.push(node)

    if (VOID.has(name) || match[4]) continue

    if (RAW_TEXT.has(name)) {
      // Skip to the matching close without parsing anything between.
      const close = html.toLowerCase().indexOf(`</${name}`, cursor)
      cursor = close === -1 ? html.length : close
      TAG_RE.lastIndex = cursor
      continue
    }

    // <p> and <li> are routinely left unclosed. Close the open one first, or the
    // whole rest of the document nests inside it.
    if ((name === 'p' || name === 'li') && stack[stack.length - 1]!.name === name) stack.pop()
    stack.push(node)
  }
  pushText(html.slice(cursor))
  return root.children
}

// Characters that would otherwise be read as Markdown. Escaped only where they
// begin a line or a token, not everywhere: a product description full of
// backslashes is worse than one with a stray asterisk in it.
function escapeInline(text: string): string {
  return text.replace(/([\\`*_[\]])/g, '\\$1')
}

function textOf(nodes: Node[]): string {
  return nodes.map((n) => (n.kind === 'text' ? n.value : textOf(n.children))).join('')
}

function inline(nodes: Node[]): string {
  let out = ''
  for (const node of nodes) {
    if (node.kind === 'text') {
      out += escapeInline(node.value.replace(/\s+/g, ' '))
      continue
    }
    switch (node.name) {
      case 'br':
        out += '  \n'
        break
      case 'strong':
      case 'b':
        out += `**${inline(node.children).trim()}**`
        break
      case 'em':
      case 'i':
        out += `*${inline(node.children).trim()}*`
        break
      case 'del':
      case 's':
        out += `~~${inline(node.children).trim()}~~`
        break
      case 'code':
        out += `\`${textOf(node.children).trim()}\``
        break
      case 'a': {
        const href = node.attrs.href ?? ''
        const label = inline(node.children).trim() || href
        out += href ? `[${label}](${href})` : label
        break
      }
      case 'img': {
        const src = node.attrs.src ?? ''
        const alt = node.attrs.alt ?? ''
        if (src) out += `![${alt}](${src})`
        break
      }
      default:
        out += inline(node.children)
    }
  }
  return out
}

function tableRow(cells: ElementNode[]): string {
  // A pipe inside a cell would end the cell. Nothing else in a Markdown table
  // needs escaping.
  return `| ${cells.map((c) => inline(c.children).trim().replace(/\|/g, '\\|') || ' ').join(' | ')} |`
}

function cellsOf(row: ElementNode): ElementNode[] {
  return row.children.filter((c): c is ElementNode => c.kind === 'element' && (c.name === 'td' || c.name === 'th'))
}

function rowsOf(node: ElementNode): ElementNode[] {
  const rows: ElementNode[] = []
  const walk = (n: ElementNode) => {
    for (const child of n.children) {
      if (child.kind !== 'element') continue
      if (child.name === 'tr') rows.push(child)
      else walk(child)
    }
  }
  walk(node)
  return rows
}

function renderTable(node: ElementNode): string {
  const rows = rowsOf(node)
  if (rows.length === 0) return ''
  const first = cellsOf(rows[0]!)
  if (first.length === 0) return ''
  const lines = [tableRow(first), `| ${first.map(() => '---').join(' | ')} |`]
  for (const row of rows.slice(1)) {
    const cells = cellsOf(row)
    if (cells.length === 0) continue
    // Ragged rows: pad rather than drop, so a table with one short row still
    // renders as a table instead of collapsing into prose.
    while (cells.length < first.length) cells.push({ kind: 'element', name: 'td', attrs: {}, children: [] })
    lines.push(tableRow(cells.slice(0, first.length)))
  }
  return lines.join('\n')
}

function renderList(node: ElementNode, depth: number): string {
  const ordered = node.name === 'ol'
  const items = node.children.filter((c): c is ElementNode => c.kind === 'element' && c.name === 'li')
  const pad = '  '.repeat(depth)
  return items
    .map((item, i) => {
      const marker = ordered ? `${i + 1}. ` : '- '
      const nested = item.children.filter((c): c is ElementNode => c.kind === 'element' && (c.name === 'ul' || c.name === 'ol'))
      const own = item.children.filter((c) => !(c.kind === 'element' && (c.name === 'ul' || c.name === 'ol')))
      const body = inline(own).trim().replace(/\n+/g, ' ')
      const sub = nested.map((n) => renderList(n, depth + 1)).filter(Boolean).join('\n')
      return `${pad}${marker}${body}${sub ? `\n${sub}` : ''}`
    })
    .filter((line) => line.trim() !== '-' && line.trim() !== '')
    .join('\n')
}

function blocks(nodes: Node[]): string[] {
  const out: string[] = []
  let inlineRun: Node[] = []

  const flush = () => {
    if (inlineRun.length === 0) return
    const text = inline(inlineRun).trim()
    if (text) out.push(text)
    inlineRun = []
  }

  for (const node of nodes) {
    if (node.kind === 'text' || !BLOCK.has(node.name)) {
      inlineRun.push(node)
      continue
    }
    flush()
    switch (node.name) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        const level = Number(node.name[1])
        const text = inline(node.children).trim()
        if (text) out.push(`${'#'.repeat(level)} ${text}`)
        break
      }
      case 'hr':
        out.push('---')
        break
      case 'ul': case 'ol': {
        const list = renderList(node, 0)
        if (list) out.push(list)
        break
      }
      case 'pre': {
        const code = textOf(node.children).replace(/\n+$/, '')
        if (code.trim()) out.push(`\`\`\`\n${code}\n\`\`\``)
        break
      }
      case 'blockquote': {
        const inner = blocks(node.children).join('\n\n')
        if (inner) out.push(inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n'))
        break
      }
      case 'table': {
        const table = renderTable(node)
        if (table) out.push(table)
        break
      }
      default:
        out.push(...blocks(node.children))
    }
  }
  flush()
  return out
}

/** Markdown for a fragment of rich-text HTML. Empty in, empty out. */
export function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return ''
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, '')
  return blocks(parse(cleaned))
    .map((b) => b.trim())
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** True when a string carries markup rather than being plain copy. */
export function looksLikeHtml(value: string): boolean {
  return /<[a-z][\s\S]*>/i.test(value)
}
