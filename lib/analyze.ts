// Rule-based on-page SEO analysis. Pure functions: no DB, no fetch, so the
// whole engine is unit-testable and safe to run in any context.

import type { ExtractedContent } from './content'
import type { AnalysisResult, SeoCheck, SeoTargets } from './types'

export type AnalysisInput = {
  title: string
  slug: string
  metaDescription: string | null
  hasOgImage: boolean
  focusKeyword: string | null
  content: ExtractedContent
  targets: SeoTargets
  /** Titles of every other page, for duplicate detection. */
  otherTitles: string[]
  /** Meta descriptions of every other page, for duplicate detection. */
  otherDescriptions: string[]
  isPublished: boolean
}

const STOP_WORDS = new Set(['a', 'an', 'and', 'the', 'of', 'to', 'in', 'for', 'on', 'with', 'at', 'by', 'or'])

function pass(key: string, message: string): SeoCheck {
  return { key, status: 'pass', message }
}
function warn(key: string, message: string, suggestion?: string): SeoCheck {
  return { key, status: 'warn', message, suggestion }
}
function fail(key: string, message: string, suggestion?: string): SeoCheck {
  return { key, status: 'fail', message, suggestion }
}

function containsKeyword(text: string, keyword: string): boolean {
  return text.toLowerCase().includes(keyword.toLowerCase().trim())
}

function keywordDensity(content: ExtractedContent, keyword: string): number {
  if (!content.wordCount) return 0
  const keywordWords = keyword.toLowerCase().trim().split(/\s+/)
  const words = content.text.toLowerCase().split(/\s+/)
  let occurrences = 0
  for (let i = 0; i <= words.length - keywordWords.length; i++) {
    if (keywordWords.every((kw, j) => words[i + j]?.replace(/[^\p{L}\p{N}]/gu, '') === kw.replace(/[^\p{L}\p{N}]/gu, ''))) {
      occurrences++
    }
  }
  return (occurrences * keywordWords.length / content.wordCount) * 100
}

export function analyzePage(input: AnalysisInput): AnalysisResult {
  const { targets: t, content } = input
  const checks: SeoCheck[] = []
  const title = input.title.trim()
  const desc = (input.metaDescription ?? '').trim()
  const keyword = input.focusKeyword?.trim() || null

  // --- Title ---
  if (!title) {
    checks.push(fail('title-present', 'The page has no title.', 'Give the page a descriptive title.'))
  } else if (title.length < t.titleMin) {
    checks.push(warn('title-length', `Title is ${title.length} characters - shorter than the ${t.titleMin} recommended.`, 'Lengthen the title with descriptive words people actually search for.'))
  } else if (title.length > t.titleMax) {
    checks.push(warn('title-length', `Title is ${title.length} characters - search results truncate around ${t.titleMax}.`, 'Trim the title so the important words survive truncation.'))
  } else {
    checks.push(pass('title-length', `Title length (${title.length} characters) is in the sweet spot.`))
  }

  if (title && input.otherTitles.some((o) => o.trim().toLowerCase() === title.toLowerCase())) {
    checks.push(fail('title-unique', 'Another page uses this exact title.', 'Make each page title unique so search engines can tell them apart.'))
  } else if (title) {
    checks.push(pass('title-unique', 'Title is unique across the site.'))
  }

  // --- Meta description ---
  if (!desc) {
    checks.push(fail('desc-present', 'No meta description set.', 'Write a 50-160 character summary; search engines otherwise invent their own.'))
  } else {
    if (desc.length < t.descMin) {
      checks.push(warn('desc-length', `Meta description is ${desc.length} characters - a little thin.`, `Aim for ${t.descMin}-${t.descMax} characters.`))
    } else if (desc.length > t.descMax) {
      checks.push(warn('desc-length', `Meta description is ${desc.length} characters - it will be cut off around ${t.descMax}.`, 'Front-load the message and trim the rest.'))
    } else {
      checks.push(pass('desc-length', `Meta description length (${desc.length} characters) looks good.`))
    }
    if (input.otherDescriptions.some((o) => o.trim().toLowerCase() === desc.toLowerCase())) {
      checks.push(warn('desc-unique', 'Another page uses this exact meta description.', 'Vary descriptions so each page earns its own click.'))
    } else {
      checks.push(pass('desc-unique', 'Meta description is unique across the site.'))
    }
  }

  // --- Slug ---
  const slug = input.slug.trim()
  if (slug) {
    const slugWords = slug.split('-').filter(Boolean)
    if (!/^[a-z0-9-]+$/.test(slug)) {
      checks.push(warn('slug-format', 'Slug contains characters outside lowercase letters, numbers and hyphens.', 'Keep slugs to lowercase words separated by hyphens.'))
    } else if (slug.length > 60) {
      checks.push(warn('slug-format', `Slug is ${slug.length} characters - long URLs get truncated and shared badly.`, 'Shorten the slug to the essential words.'))
    } else if (slugWords.length > 1 && slugWords.every((w) => STOP_WORDS.has(w))) {
      checks.push(warn('slug-format', 'Slug is made entirely of filler words.', 'Use meaningful words in the slug.'))
    } else {
      checks.push(pass('slug-format', 'Slug is tidy and readable.'))
    }
  }

  // --- Social image ---
  if (input.hasOgImage) {
    checks.push(pass('og-image', 'A social sharing image is set.'))
  } else {
    checks.push(warn('og-image', 'No social sharing image set.', 'Links shared on social platforms will render as bare text; add an image in the page editor.'))
  }

  // --- Content structure ---
  const h1s = content.headings.filter((h) => h.level === 1)
  if (h1s.length === 0) {
    checks.push(warn('h1-count', 'No top-level (H1) heading found in the page content.', 'Add exactly one main heading that says what the page is about.'))
  } else if (h1s.length > 1) {
    checks.push(warn('h1-count', `${h1s.length} top-level (H1) headings found - there should be exactly one.`, 'Demote the extra headings to H2.'))
  } else {
    checks.push(pass('h1-count', 'Exactly one top-level heading - textbook.'))
  }

  if (content.wordCount < 50) {
    checks.push(fail('content-length', `Only ${content.wordCount} words of content found.`, 'Pages this thin rarely rank; write real copy about the topic.'))
  } else if (content.wordCount < 300) {
    checks.push(warn('content-length', `${content.wordCount} words of content - on the thin side.`, 'Around 300+ words gives search engines something to work with.'))
  } else {
    checks.push(pass('content-length', `${content.wordCount} words of content.`))
  }

  const missingAlts = content.images.filter((img) => !img.alt).length
  if (content.images.length > 0) {
    if (missingAlts > 0) {
      checks.push(warn('image-alts', `${missingAlts} of ${content.images.length} images have no alt text.`, 'Describe each image in a few words; screen readers and image search both rely on it.'))
    } else {
      checks.push(pass('image-alts', `All ${content.images.length} images have alt text.`))
    }
  }

  if (content.internalLinks === 0 && content.wordCount >= 100) {
    checks.push(warn('internal-links', 'No internal links found in the content.', 'Link to related pages so visitors (and crawlers) have somewhere to go next.'))
  } else if (content.internalLinks > 0) {
    checks.push(pass('internal-links', `${content.internalLinks} internal link${content.internalLinks === 1 ? '' : 's'} in the content.`))
  }

  // --- Focus keyword ---
  if (keyword) {
    checks.push(containsKeyword(title, keyword)
      ? pass('keyword-title', 'Focus keyword appears in the title.')
      : warn('keyword-title', 'Focus keyword missing from the title.', 'Work the keyword into the title, ideally near the front.'))
    if (desc) {
      checks.push(containsKeyword(desc, keyword)
        ? pass('keyword-desc', 'Focus keyword appears in the meta description.')
        : warn('keyword-desc', 'Focus keyword missing from the meta description.', 'Mention the keyword once in the description.'))
    }
    checks.push(containsKeyword(slug.replace(/-/g, ' '), keyword)
      ? pass('keyword-slug', 'Focus keyword appears in the slug.')
      : warn('keyword-slug', 'Focus keyword missing from the slug.', 'Consider a slug containing the keyword (mind existing inbound links).'))
    if (content.wordCount >= 50) {
      const density = keywordDensity(content, keyword)
      if (density === 0) {
        checks.push(fail('keyword-density', 'Focus keyword never appears in the page content.', 'Use the keyword naturally in the copy a few times.'))
      } else if (density < t.densityMin) {
        checks.push(warn('keyword-density', `Keyword density is ${density.toFixed(1)}% - a touch sparse.`, `Aim for ${t.densityMin}-${t.densityMax}%.`))
      } else if (density > t.densityMax) {
        checks.push(warn('keyword-density', `Keyword density is ${density.toFixed(1)}% - starting to read like keyword stuffing.`, 'Dial it back; write for people first.'))
      } else {
        checks.push(pass('keyword-density', `Keyword density is ${density.toFixed(1)}% - natural.`))
      }
    }
  } else {
    checks.push(warn('keyword-set', 'No focus keyword set for this page.', 'Pick the search phrase this page should win, then the analyser can score against it.'))
  }

  // --- Readability (very rough) ---
  if (content.wordCount >= 100) {
    const sentences = content.text.split(/[.!?]+\s/).filter((s) => s.trim().length > 0)
    const avgLen = sentences.length ? content.wordCount / sentences.length : content.wordCount
    if (avgLen > 28) {
      checks.push(warn('readability', `Sentences average ${Math.round(avgLen)} words - hard going.`, 'Break long sentences up; short ones keep readers (and rankings).'))
    } else {
      checks.push(pass('readability', `Sentences average ${Math.round(avgLen)} words - readable.`))
    }
  }

  // --- Publication status ---
  if (!input.isPublished) {
    checks.push(warn('published', 'Page is not published, so search engines cannot see it.', 'Publish the page when it is ready.'))
  }

  return { score: scoreFromChecks(checks), checks }
}

export function scoreFromChecks(checks: SeoCheck[]): number {
  if (checks.length === 0) return 0
  const points = checks.reduce((sum, c) => sum + (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0), 0)
  return Math.round((points / checks.length) * 100)
}
