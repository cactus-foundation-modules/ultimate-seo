// The shape of a Markdown twin, and the small helpers every builder needs.
//
// Kept apart from the builders so the format is one thing in one place: change
// how a document opens and every content type changes with it, rather than six
// near-identical headers drifting into six different ones.

export type DocumentSection = {
  heading: string
  /** Markdown. Blank sections are dropped rather than left as empty headings. */
  body: string
}

export type DocumentHeader = {
  title: string
  /** The one-line answer: an owner's abstract, or the meta description. */
  summary: string | null
  url: string
  /** What this is, in words: 'Product', 'Blog post', 'Page'. */
  kind: string
  updatedAt: Date | null
  /** Short "label: value" facts, listed before the prose. */
  facts?: Array<{ label: string; value: string }>
}

/** A Markdown table, or '' when there is nothing to put in one. */
export function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return ''
  const escape = (cell: string) => cell.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim() || ' '
  return [
    `| ${headers.map(escape).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escape).join(' | ')} |`),
  ].join('\n')
}

export function bulletList(items: string[]): string {
  return items.filter(Boolean).map((i) => `- ${i}`).join('\n')
}

export function link(label: string, url: string): string {
  return `[${label.replace(/[[\]]/g, '')}](${url})`
}

/**
 * Collapses a description down to one line for the index and the summary quote.
 * Markdown, HTML and newlines all come out; what is left is a sentence.
 */
export function oneLine(text: string | null | undefined, max = 200): string | null {
  if (!text) return null
  const flat = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_`>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!flat) return null
  if (flat.length <= max) return flat
  // Cut at a word rather than mid-word, and only take the shortened form when
  // there is a word boundary worth cutting at.
  const cut = flat.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * The document.
 *
 * The header is deliberately plain "Label: value" lines rather than YAML front
 * matter: front matter is only front matter to a reader that knows to look for
 * it, and to every other one it is three lines of punctuation at the top of the
 * page. These lines read correctly whatever is doing the reading.
 */
export function renderDocument(header: DocumentHeader, sections: DocumentSection[]): string {
  const parts: string[] = [`# ${header.title.trim()}`]

  if (header.summary) parts.push(`> ${header.summary.replace(/\s+/g, ' ').trim()}`)

  const meta = [`- URL: ${header.url}`, `- Type: ${header.kind}`]
  if (header.updatedAt) meta.push(`- Last updated: ${isoDay(header.updatedAt)}`)
  for (const fact of header.facts ?? []) {
    if (fact.value.trim()) meta.push(`- ${fact.label}: ${fact.value.trim()}`)
  }
  parts.push(meta.join('\n'))

  for (const section of sections) {
    const body = section.body.trim()
    if (!body) continue
    parts.push(`## ${section.heading}\n\n${body}`)
  }

  return `${parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}
