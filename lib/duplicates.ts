// Site-wide duplicate detection for titles and meta descriptions.
//
// The analyser only ever asks whether ANY OTHER page shares the exact string,
// so a sweep does not need the full site list handed to it page by page - it
// needs a yes or a no. Counting each string once across the site, then
// discounting the page's own contribution, keeps a whole-site sweep linear
// instead of quadratic.

export type DuplicateEntry = {
  /** Stable `${entityType}:${entityId}` key. */
  key: string
  title: string
  metaDescription: string | null
}

function normalise(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

export class DuplicateIndex {
  private titleCounts = new Map<string, number>()
  private descCounts = new Map<string, number>()
  private ownTitle = new Map<string, string>()
  private ownDesc = new Map<string, string>()

  constructor(entries: DuplicateEntry[]) {
    for (const entry of entries) {
      const title = normalise(entry.title)
      if (title) {
        this.titleCounts.set(title, (this.titleCounts.get(title) ?? 0) + 1)
        this.ownTitle.set(entry.key, title)
      }
      const desc = normalise(entry.metaDescription)
      if (desc) {
        this.descCounts.set(desc, (this.descCounts.get(desc) ?? 0) + 1)
        this.ownDesc.set(entry.key, desc)
      }
    }
  }

  /** True when a page other than `key` uses this exact title. */
  isDuplicateTitle(key: string, title: string): boolean {
    const value = normalise(title)
    if (!value) return false
    const own = this.ownTitle.get(key) === value ? 1 : 0
    return (this.titleCounts.get(value) ?? 0) > own
  }

  /** True when a page other than `key` uses this exact meta description. */
  isDuplicateDescription(key: string, description: string | null): boolean {
    const value = normalise(description)
    if (!value) return false
    const own = this.ownDesc.get(key) === value ? 1 : 0
    return (this.descCounts.get(value) ?? 0) > own
  }
}
