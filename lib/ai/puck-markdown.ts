// A page-builder document to Markdown, without knowing what blocks exist.
//
// The block palette differs per install - core blocks, a shop's blocks, a
// module's blocks, and whatever ships next - so this cannot be a lookup table
// of block types. It walks the stored props the same way lib/content.ts does
// for the analyser, and applies the same rule: a prop whose name says it is
// plumbing is plumbing, everything else is copy.
//
// The difference from lib/content.ts is what comes out. That one flattens a
// page to a bag of words to count them. This one has to produce something a
// person would recognise as the page - headings still headings, lists still
// lists, links still links - because it is what a language model will quote.

import { htmlToMarkdown, looksLikeHtml } from './html-to-markdown'

type PuckItem = { type?: string; props?: Record<string, unknown> }

// ---------------------------------------------------------------------------
// Rich text stored as a ProseMirror document
// ---------------------------------------------------------------------------
//
// A rich-text field does not always store HTML. Several blocks store the editor's
// own document instead - { type: 'doc', content: [{ type: 'paragraph', … }] } -
// and walked as ordinary props that comes out as the words "doc", "paragraph"
// and "text" between the sentences, with every heading, link and list flattened
// into prose. Recognised and rendered properly instead.

type ProseNode = {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>
  content?: ProseNode[]
}

function isProseDoc(value: unknown): value is ProseNode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as ProseNode
  return v.type === 'doc' && Array.isArray(v.content)
}

function proseInline(nodes: ProseNode[] | undefined): string {
  if (!nodes) return ''
  return nodes.map((node) => {
    if (node.type === 'text') {
      let text = (node.text ?? '').replace(/([\\`*_[\]])/g, '\\$1')
      for (const mark of node.marks ?? []) {
        if (mark.type === 'bold' || mark.type === 'strong') text = `**${text}**`
        else if (mark.type === 'italic' || mark.type === 'em') text = `*${text}*`
        else if (mark.type === 'code') text = `\`${node.text ?? ''}\``
        else if (mark.type === 'strike') text = `~~${text}~~`
        else if (mark.type === 'link') {
          const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : ''
          if (href) text = `[${text}](${href})`
        }
      }
      return text
    }
    if (node.type === 'hardBreak') return '  \n'
    if (node.type === 'image') {
      const src = typeof node.attrs?.src === 'string' ? node.attrs.src : ''
      const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''
      return src ? `![${alt}](${src})` : ''
    }
    return proseInline(node.content)
  }).join('')
}

function proseList(node: ProseNode, ordered: boolean, depth: number): string {
  const pad = '  '.repeat(depth)
  return (node.content ?? [])
    .filter((item) => item.type === 'listItem')
    .map((item, i) => {
      const marker = ordered ? `${i + 1}. ` : '- '
      const own = (item.content ?? []).filter((c) => c.type !== 'bulletList' && c.type !== 'orderedList')
      const nested = (item.content ?? []).filter((c) => c.type === 'bulletList' || c.type === 'orderedList')
      const body = own.map((c) => proseInline(c.content)).join(' ').trim()
      const sub = nested.map((n) => proseList(n, n.type === 'orderedList', depth + 1)).filter(Boolean).join('\n')
      return `${pad}${marker}${body}${sub ? `\n${sub}` : ''}`
    })
    .filter((line) => line.trim() && !/^\s*[-\d.]+\s*$/.test(line))
    .join('\n')
}

function proseBlocks(nodes: ProseNode[] | undefined, depth = 0): string[] {
  if (!nodes || depth > 12) return []
  const out: string[] = []
  for (const node of nodes) {
    switch (node.type) {
      case 'heading': {
        const raw = node.attrs?.level
        const level = typeof raw === 'number' && raw >= 1 && raw <= 6 ? raw : 2
        const text = proseInline(node.content).trim()
        if (text) out.push(`${'#'.repeat(level)} ${text}`)
        break
      }
      case 'paragraph': {
        const text = proseInline(node.content).trim()
        if (text) out.push(text)
        break
      }
      case 'bulletList':
      case 'orderedList': {
        const list = proseList(node, node.type === 'orderedList', 0)
        if (list) out.push(list)
        break
      }
      case 'blockquote': {
        const inner = proseBlocks(node.content, depth + 1).join('\n\n')
        if (inner) out.push(inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n'))
        break
      }
      case 'codeBlock': {
        const code = proseInline(node.content)
        if (code.trim()) out.push(`\`\`\`\n${code}\n\`\`\``)
        break
      }
      case 'horizontalRule':
        out.push('---')
        break
      case 'image': {
        const inline = proseInline([node])
        if (inline) out.push(inline)
        break
      }
      default:
        out.push(...proseBlocks(node.content, depth + 1))
    }
  }
  return out
}

export function proseMirrorToMarkdown(doc: unknown): string {
  if (!isProseDoc(doc)) return ''
  return proseBlocks(doc.content).map((b) => b.trim()).filter(Boolean).join('\n\n').trim()
}

// Props that are plumbing rather than copy. Deliberately the same shape of rule
// as lib/content.ts's, kept separate because the two lists have drifted apart
// once already and a shared one would have to serve two different jobs.
const SKIP_KEY_RE = /(^|[a-z])(id|url|href|src|image|colour|color|class|className|icon|slug|padding|margin|gap|width|height|size|align|justify|variant|mode|target|style|theme|animation|delay|duration|ratio|columns|rows|position|order|zone|preset|token|key|type|component|block|element|node|kind|format|layout|template)$/i

// Props read for something OTHER than their words: the heading level, and the
// alt text already spent on the image line above. Left in the loop below they
// come out as prose - a page whose every heading is followed by a paragraph
// reading "huge", and every picture by its own alt text a second time.
const CONSUMED_KEYS = new Set(['level', 'tag', 'as', 'headinglevel', 'alt', 'alttext'])

// Lone words that are a block's setting rather than its copy: a stored prop
// called something innocuous ("shadow", "decoration", "reveal") whose value is
// one of these is describing how the block looks, not what it says.
//
// This exists because the first real page run through this produced a document
// reading "off / no / false / none / underline" between its paragraphs. Matched
// only against a value that is one word on its own, so a heading of "Delivery"
// or a paragraph about "none of the above" is untouched.
const SETTING_VALUES = new Set([
  'off', 'on', 'yes', 'no', 'true', 'false', 'none', 'auto', 'default', 'inherit', 'initial',
  'normal', 'bold', 'italic', 'underline', 'overline', 'uppercase', 'lowercase', 'capitalize',
  'left', 'right', 'center', 'centre', 'middle', 'top', 'bottom', 'start', 'end', 'justify',
  'solid', 'dashed', 'dotted', 'double', 'hidden', 'visible', 'scroll', 'clip', 'cover', 'contain',
  'row', 'column', 'wrap', 'nowrap', 'grid', 'flex', 'block', 'inline', 'static', 'relative',
  'absolute', 'fixed', 'sticky', 'small', 'medium', 'large', 'xsmall', 'xlarge', 'tiny', 'huge',
  'light', 'dark', 'primary', 'secondary', 'tertiary', 'accent', 'muted', 'transparent',
  'horizontal', 'vertical', 'always', 'never', 'once', 'slow', 'fast', 'linear', 'ease',
  'square', 'circle', 'rounded', 'pill', 'outline', 'ghost', 'filled', 'card', 'plain',
  'xs', 'sm', 'md', 'lg', 'xl', 'xxl', 'full', 'half', 'auto-fit', 'auto-fill',
  'equal', 'stretch', 'baseline', 'reverse', 'forward', 'both', 'either', 'neither',
])

// Values that are plainly not prose.
function looksLikeCopy(value: string): boolean {
  const v = value.trim()
  if (v.length < 2) return false
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return false
  if (/^var\(--/.test(v)) return false
  if (/^https?:\/\//i.test(v) || v.startsWith('/')) return false
  if (/^[a-z0-9_-]{16,}$/i.test(v) && !v.includes(' ')) return false
  if (/^-?\d+(\.\d+)?(px|rem|em|%|vh|vw)?$/i.test(v)) return false
  // Lower-case as stored, as a setting always is. A heading of "Top" or a
  // product called "Cover" is capitalised and survives; 'top' out of an
  // alignment picker does not.
  if (!v.includes(' ') && v === v.toLowerCase() && SETTING_VALUES.has(v)) return false
  return true
}

function headingLevel(props: Record<string, unknown>): number {
  const raw = props.level ?? props.tag ?? props.headingLevel ?? props.as
  if (typeof raw === 'number' && raw >= 1 && raw <= 6) return raw
  const digits = parseInt(String(raw ?? '').replace(/[^0-9]/g, ''), 10)
  return Number.isFinite(digits) && digits >= 1 && digits <= 6 ? digits : 2
}

const MAIN_TEXT_KEY_RE = /^(text|title|heading|label|children|content|body|copy|description|caption|question|answer|name|quote|excerpt|subtitle|subheading)$/i

function renderProps(type: string, props: Record<string, unknown>, out: string[]): void {
  const lowerType = type.toLowerCase()
  const isHeading = /heading|title/.test(lowerType) && !/subtitle/.test(lowerType)

  // An image block: its alt text is the only thing worth carrying, and it is
  // worth carrying as an image so a reader knows a picture was there.
  const src = typeof props.src === 'string' ? props.src : typeof props.image === 'string' ? props.image : ''
  const alt = typeof props.alt === 'string' ? props.alt : typeof props.altText === 'string' ? props.altText : ''
  if (src && /image|photo|picture|logo|gallery|media/.test(lowerType)) {
    out.push(`![${alt}](${src})`)
  }

  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'string') {
      if (CONSUMED_KEYS.has(key.toLowerCase())) continue
      if (SKIP_KEY_RE.test(key)) continue
      if (looksLikeHtml(value)) {
        const md = htmlToMarkdown(value)
        if (md) out.push(md)
        continue
      }
      if (!looksLikeCopy(value)) continue
      const text = value.trim()
      if (isHeading && MAIN_TEXT_KEY_RE.test(key)) {
        out.push(`${'#'.repeat(headingLevel(props))} ${text}`)
      } else {
        out.push(text)
      }
      continue
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
          renderProps(type, entry as Record<string, unknown>, out)
        } else if (typeof entry === 'string' && looksLikeCopy(entry) && !SKIP_KEY_RE.test(key)) {
          out.push(`- ${entry.trim()}`)
        }
      }
      continue
    }

    if (value && typeof value === 'object') {
      const prose = proseMirrorToMarkdown(value)
      if (prose) {
        out.push(prose)
        continue
      }
      renderProps(type, value as Record<string, unknown>, out)
    }
  }
}

type PuckData = {
  content?: unknown
  zones?: Record<string, unknown>
  root?: { props?: Record<string, unknown> }
}

function itemsOf(value: unknown): PuckItem[] {
  return Array.isArray(value) ? (value as PuckItem[]) : []
}

function renderItems(items: PuckItem[], zones: Record<string, unknown>, out: string[], depth: number): void {
  // Depth is bounded because a stored document can, in principle, name itself as
  // its own drop zone. Twelve is deeper than any real page and cheap to allow.
  if (depth > 12) return
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const props = (item.props && typeof item.props === 'object' ? item.props : {}) as Record<string, unknown>
    renderProps(item.type ?? '', props, out)

    // A block's own drop zones are stored beside the content, keyed
    // "<itemId>:<zoneName>". Rendered straight after their parent so the
    // document reads in the order the page does.
    const id = typeof props.id === 'string' ? props.id : null
    if (!id) continue
    for (const [zoneKey, zoneItems] of Object.entries(zones)) {
      if (!zoneKey.startsWith(`${id}:`)) continue
      renderItems(itemsOf(zoneItems), zones, out, depth + 1)
    }
  }
}

/** Markdown for a stored page-builder document. Empty for anything unreadable. */
export function puckToMarkdown(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const d = data as PuckData
  const zones = (d.zones && typeof d.zones === 'object' ? d.zones : {}) as Record<string, unknown>
  const out: string[] = []

  renderItems(itemsOf(d.content), zones, out, 0)

  // Zones whose parent block is not in the content array - an older document,
  // or a block since removed. Rendered at the end rather than dropped: the copy
  // is still on the page as far as anybody reading it is concerned.
  const rendered = new Set<string>()
  for (const item of itemsOf(d.content)) {
    const id = (item?.props as Record<string, unknown> | undefined)?.id
    if (typeof id === 'string') rendered.add(id)
  }
  for (const [zoneKey, zoneItems] of Object.entries(zones)) {
    const owner = zoneKey.split(':')[0] ?? ''
    if (rendered.has(owner)) continue
    renderItems(itemsOf(zoneItems), zones, out, 1)
  }

  return out
    .map((block) => block.trim())
    .filter(Boolean)
    // Two kinds of repetition, two rules.
    //
    // Back to back is what a block that stores its label and its text under two
    // prop names produces, and any repeat there is noise however short.
    // Further apart, only a substantial block counts: a "Read more" panel that
    // stores the full copy alongside the truncated copy repeats a whole page of
    // prose halfway down the document, while a heading of "Delivery" appearing
    // twice on a long page is just a long page.
    .filter((block, i, all) => {
      if (block === all[i - 1]) return false
      if (block.length < 120) return true
      return all.indexOf(block) === i
    })
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
