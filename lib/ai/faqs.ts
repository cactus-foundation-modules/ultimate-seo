// The questions a page answers, for the readers that never see the page.
//
// A shop publishes its FAQs three times over: as an accordion a shopper opens,
// as FAQPage structured data a search engine reads, and - until this file - not
// at all in the Markdown twin, which is the one surface written specifically for
// an assistant. The questions are the most quotable thing on a product page:
// "will it take 125kg", "does it come built", "how long is delivery". An
// assistant that cannot see them answers from the specification table or does
// not answer at all.
//
// Read by raw SQL against shop's own columns rather than by importing shop's
// resolver, for the reason every loader in documents.ts gives: this module has
// to build identically on an install with no shop in it. The merge below is
// therefore a deliberate copy of the rule shop applies (modules/shop/lib/faq.ts)
// - nearest wins, and a level may refuse to inherit - and the two are expected
// to be read together if either changes.

/** One question and its answer, both plain text. */
export type AiFaqItem = { question: string; answer: string }

/** What one level holds: its own questions, and whether the levels above it
 *  still get a say. */
export type AiFaqSet = { items: AiFaqItem[]; inherit: boolean }

export const EMPTY_FAQ_SET: AiFaqSet = { items: [], inherit: true }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Trim, and drop any half-written row. An unanswered question is not a FAQ, and
 * publishing a blank one would put an empty heading in the twin.
 */
function cleanItems(value: unknown): AiFaqItem[] {
  if (!Array.isArray(value)) return []
  const out: AiFaqItem[] = []
  for (const row of value) {
    if (!isRecord(row)) continue
    const question = typeof row.question === 'string' ? row.question.trim() : ''
    const answer = typeof row.answer === 'string' ? row.answer.trim() : ''
    if (!question || !answer) continue
    out.push({ question, answer })
  }
  return out
}

/**
 * Read a stored jsonb blob into a set, forgivingly on purpose. A set written by
 * a newer editor, or hand-edited in the database, must not fail a rebuild of the
 * whole catalogue: it reads as "no questions", which is what every page had
 * before this existed.
 */
export function normaliseFaqSet(value: unknown): AiFaqSet {
  if (!isRecord(value)) return EMPTY_FAQ_SET
  return {
    items: cleanItems(value.items),
    // Absent means yes. The flag was added to let a level opt OUT, and a row
    // saved before it existed never opted out of anything.
    inherit: value.inherit === false ? false : true,
  }
}

/** A bare list with no inherit flag of its own - the shop-wide set, which has
 *  nothing above it to inherit from. */
export function normaliseFaqItems(value: unknown): AiFaqItem[] {
  return cleanItems(value)
}

/**
 * What two questions have to match on to count as the same one, so a product can
 * overrule a shop-wide answer by asking the question again. Loose about case,
 * spacing and the question mark: nobody retypes a heading character for
 * character, and a near miss would publish both answers.
 */
function questionKey(question: string): string {
  return question
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[?？]+$/, '')
    .trim()
}

export type FaqLevels = {
  /** The page's own set. Empty for a category or collection page, which is its
   *  own first level and passes itself in `ancestors`. */
  own: AiFaqSet
  /** Nearest first, outwards. A product's category then that category's parents. */
  ancestors: AiFaqSet[]
  /** The shop-wide list, last. */
  shopWide: AiFaqItem[]
}

/**
 * The finished list for one page, in print order.
 *
 * Two things stop the walk: a level that says it does not inherit (nothing above
 * it is read at all), and a question already asked nearer the page - the nearer
 * answer stands and the further one is dropped.
 */
export function resolveFaqs({ own, ancestors, shopWide }: FaqLevels): AiFaqItem[] {
  const out: AiFaqItem[] = []
  const seen = new Set<string>()

  const add = (items: AiFaqItem[]) => {
    for (const item of items) {
      const key = questionKey(item.question)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(item)
    }
  }

  add(own.items)
  if (!own.inherit) return out

  for (const level of ancestors) {
    add(level.items)
    if (!level.inherit) return out
  }

  add(shopWide)
  return out
}

// A backstop, not a budget. A twin is read into a context window and a set that
// has run away - a shop-wide list nobody has pruned in five years, inherited by
// every product - would spend more of that window on the same answers than on
// the product. The figure is deliberately well clear of a genuine set rather
// than tight against it: the largest on the site this was first run against is
// forty-three, all of them worth publishing, and a cap that trimmed those would
// be withholding the most quotable thing on the page to save a few hundred
// words.
export const MAX_FAQS_PUBLISHED = 60

/**
 * The questions as a Markdown section, or null when there are none.
 *
 * Each question is a heading rather than a bold line so that a reader chunking
 * the document on headings keeps the question with its own answer instead of
 * splitting a run of them down the middle. `####` because sections already own
 * `##` and body copy inside one may use `###`.
 */
export function faqSection(items: AiFaqItem[]): { heading: string; body: string } | null {
  if (items.length === 0) return null
  const shown = items.slice(0, MAX_FAQS_PUBLISHED)
  const body = shown.map((item) => `#### ${item.question}\n\n${item.answer}`).join('\n\n')
  const more = items.length > shown.length
    ? `\n\n${items.length - shown.length} further questions are answered on the page itself.`
    : ''
  return { heading: 'Questions and answers', body: `${body}${more}` }
}
