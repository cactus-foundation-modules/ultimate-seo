// Who this business actually is, written out for a reader that cannot see the
// page - the identity half of llms.txt, and the answer to the agent endpoint's
// get_site_info.
//
// Why it exists. An assistant asked to recommend a supplier is making a claim on
// its user's behalf, and the thing that decides whether it is willing to make
// that claim is not how good the copy is. It is whether the business is
// identifiable: a legal name, a company number somebody could look up, a VAT
// registration, an address, a way to get hold of a human, and a plain statement
// of where it will and will not trade. All of that is already typed into the
// structured-data profile, where it is published as JSON-LD for search engines
// and, until now, withheld from the one file written specifically for readers
// that do not parse HTML at all.
//
// Pure functions over the saved profile - no DB, no fetch - so llms.txt and the
// agent endpoint answer from the same lines rather than from two renderings that
// agree until one of them is edited.

import type { SeoStructuredData } from '../types'

/** One fact, rendered as a Markdown list item. Order is the order they are listed. */
type Fact = { label: string; value: string }

function clean(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * The postal address on one line, in reading order, skipping the blanks.
 *
 * A multi-line address is right on an envelope and wrong here: this is read by
 * something that is going to quote it back in a sentence.
 */
function addressLine(sd: SeoStructuredData): string {
  return [sd.streetAddress, sd.addressLocality, sd.addressRegion, sd.postalCode, sd.addressCountry]
    .map(clean)
    .filter(Boolean)
    .join(', ')
}

/**
 * Every fact worth publishing, in the order a reader wants them: what the
 * business is called, proof it exists, where it is, who it serves, how to reach
 * it, and where else it can be found.
 */
export function businessFacts(sd: SeoStructuredData, fallbackName: string): Fact[] {
  const facts: Fact[] = []
  const name = clean(sd.name) || clean(fallbackName)
  if (!name) return facts

  const push = (label: string, value: string) => {
    if (value) facts.push({ label, value })
  }

  push('Name', name)
  if (clean(sd.legalName) && clean(sd.legalName) !== name) push('Registered name', clean(sd.legalName))
  if (clean(sd.alternateName) && clean(sd.alternateName) !== name) push('Also known as', clean(sd.alternateName))

  // A registration number nobody can name is a number nobody can check, so the
  // label the owner gave it travels with it - the same pairing the JSON-LD uses.
  if (clean(sd.identifierName) && clean(sd.identifierValue)) {
    push(clean(sd.identifierName), clean(sd.identifierValue))
  }
  push('VAT number', clean(sd.vatId))
  push('Tax number', clean(sd.taxId))
  push('DUNS number', clean(sd.duns))
  push('Trading since', clean(sd.foundingDate))

  push('Address', addressLine(sd))
  // Named plainly rather than as "areaServed": this is the single most useful
  // line in the file for an assistant deciding whether to put this business in
  // front of the person asking, and it should not need decoding.
  push('Sells to', sd.areaServed.map(clean).filter(Boolean).join(', '))
  push('Typical prices', clean(sd.priceRange))
  push('Opening hours', sd.openingHours.map(clean).filter(Boolean).join('; '))

  push('Email', clean(sd.email) || clean(sd.contactEmail))
  push('Telephone', clean(sd.telephone) || clean(sd.contactTelephone))
  push('Languages', sd.contactAvailableLanguage.map(clean).filter(Boolean).join(', '))

  const sameAs = [...new Set(sd.sameAs.map(clean).filter(Boolean))]
  if (sameAs.length) push('Also listed at', sameAs.join(', '))

  return facts
}

/**
 * The facts as a Markdown section, or null when the profile holds nothing but a
 * name. A heading over a single line that repeats the H1 is noise, and noise in
 * a file this short is expensive.
 */
export function businessFactsSection(sd: SeoStructuredData, fallbackName: string): string | null {
  const facts = businessFacts(sd, fallbackName)
  if (facts.length < 2) return null
  const lines = facts.map((f) => `- **${f.label}**: ${f.value}`)
  return `## About this business\n\n${lines.join('\n')}`
}

/** The same facts as plain text, for the agent endpoint. */
export function businessFactsText(sd: SeoStructuredData, fallbackName: string): string | null {
  const facts = businessFacts(sd, fallbackName)
  if (facts.length < 2) return null
  return facts.map((f) => `${f.label}: ${f.value}`).join('\n')
}
