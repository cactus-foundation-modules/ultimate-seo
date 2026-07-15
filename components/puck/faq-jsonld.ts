export type FaqItem = { question?: string; answer?: string }

export function buildFaqJsonLd(items: FaqItem[]): object | null {
  if (items.length === 0) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question?.trim() ?? '',
      acceptedAnswer: { '@type': 'Answer', text: item.answer?.trim() ?? '' },
    })),
  }
}

/** Serialise for a <script> tag: escape `<` so content cannot close the tag early. */
export function jsonLdEscape(data: object): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}
