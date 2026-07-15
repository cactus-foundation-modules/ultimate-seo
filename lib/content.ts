// Extracts analysable text content from a Puck builder Data JSON blob without
// coupling to any specific block palette: block types vary by install (core
// blocks, module blocks), so traversal is generic and defensive.

export type ExtractedContent = {
  text: string
  wordCount: number
  /** Heading levels found, in document order (1 = h1). */
  headings: Array<{ level: number; text: string }>
  images: Array<{ alt: string | null }>
  internalLinks: number
  externalLinks: number
}

type PuckItem = { type?: string; props?: Record<string, unknown> }

const HTML_TAG_RE = /<[^>]+>/g

function stripHtml(html: string): string {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(HTML_TAG_RE, ' ').replace(/&[a-z#0-9]+;/gi, ' ')
}

function collectItems(data: unknown): PuckItem[] {
  if (!data || typeof data !== 'object') return []
  const d = data as { content?: unknown; zones?: Record<string, unknown> }
  const items: PuckItem[] = []
  if (Array.isArray(d.content)) items.push(...(d.content as PuckItem[]))
  if (d.zones && typeof d.zones === 'object') {
    for (const zone of Object.values(d.zones)) {
      if (Array.isArray(zone)) items.push(...(zone as PuckItem[]))
    }
  }
  return items
}

// Keys whose string values are plainly visible copy. Anything else (ids,
// colours, UUID-ish or URL-ish values) is skipped by the heuristics below.
const SKIP_KEY_RE = /(id|url|href|src|color|colour|class|icon|slug|padding|margin|width|height|align|variant|mode|target|style)$/i

function looksLikeCopy(value: string): boolean {
  if (!value.trim()) return false
  if (value.length < 3) return false
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return false
  if (/^[a-z0-9-]{16,}$/i.test(value) && !value.includes(' ')) return false
  if (/^https?:\/\//i.test(value) || value.startsWith('/')) return false
  if (/^var\(--/.test(value)) return false
  return true
}

export function extractContent(data: unknown): ExtractedContent {
  const result: ExtractedContent = { text: '', wordCount: 0, headings: [], images: [], internalLinks: 0, externalLinks: 0 }
  const parts: string[] = []
  const items = collectItems(data)

  const visitProps = (item: PuckItem, props: Record<string, unknown>) => {
    const type = (item.type ?? '').toLowerCase()
    for (const [key, value] of Object.entries(props)) {
      if (typeof value === 'string') {
        const k = key.toLowerCase()
        // Image alt text - track separately even though it is not body copy.
        if (k === 'alt' || k === 'alttext') {
          result.images.push({ alt: value.trim() || null })
          continue
        }
        if (SKIP_KEY_RE.test(key)) {
          // A media/src prop on an image-ish block without an alt sibling still counts as an image.
          if ((k === 'src' || k === 'url') && type.includes('image') && !('alt' in props) && !('altText' in props)) {
            result.images.push({ alt: null })
          }
          continue
        }
        const isHtml = /<[a-z][\s\S]*>/i.test(value)
        if (isHtml) {
          for (const match of value.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
            result.headings.push({ level: parseInt(match[1] ?? '2', 10), text: stripHtml(match[2] ?? '').trim() })
          }
          result.internalLinks += (value.match(/<a\s[^>]*href="\/(?!\/)/gi) ?? []).length
          result.externalLinks += (value.match(/<a\s[^>]*href="https?:\/\//gi) ?? []).length
          const imgTags = value.match(/<img\s[^>]*>/gi) ?? []
          for (const img of imgTags) {
            const alt = /alt="([^"]*)"/i.exec(img)?.[1] ?? null
            result.images.push({ alt: alt?.trim() || null })
          }
          parts.push(stripHtml(value))
        } else {
          if (!looksLikeCopy(value)) continue
          // Heading-ish block: its main text prop becomes a heading.
          if (type.includes('heading') && /^(text|title|children|content|heading)$/i.test(key)) {
            const levelRaw = props.level ?? props.tag ?? props.size
            const level = typeof levelRaw === 'number'
              ? levelRaw
              : parseInt(String(levelRaw ?? '').replace(/[^0-9]/g, ''), 10) || 2
            result.headings.push({ level: Math.min(6, Math.max(1, level)), text: value.trim() })
          }
          parts.push(value)
        }
      } else if (Array.isArray(value)) {
        for (const entry of value) {
          if (entry && typeof entry === 'object') visitProps(item, entry as Record<string, unknown>)
        }
      } else if (value && typeof value === 'object') {
        visitProps(item, value as Record<string, unknown>)
      }
    }
  }

  for (const item of items) {
    if (item?.props && typeof item.props === 'object') visitProps(item, item.props)
  }

  result.text = parts.join(' ').replace(/\s+/g, ' ').trim()
  result.wordCount = result.text ? result.text.split(/\s+/).length : 0
  return result
}
