// FAQ Puck block: a visible accordion (plain <details>/<summary>, no JS)
// plus FAQPage JSON-LD so the questions are eligible for rich results.
// Editor and RSC paths render the identical component (parity invariant).

import { buildFaqJsonLd, jsonLdEscape, type FaqItem } from './faq-jsonld'

export type { FaqItem }

export type FaqBlockProps = {
  title?: string
  items?: FaqItem[]
  padding?: string
}

const PADDING: Record<string, string> = {
  none: '0',
  sm: '0.5rem',
  md: '1rem',
  lg: '2rem',
  xl: '4rem',
}

export function FaqBlock(props: FaqBlockProps) {
  const items = (props.items ?? []).filter((i) => i.question?.trim() && i.answer?.trim())
  const jsonLd = buildFaqJsonLd(items)
  const pad = PADDING[props.padding ?? 'none'] ?? '0'

  return (
    <section className="seo-faq" style={{ paddingLeft: pad, paddingRight: pad }}>
      {props.title?.trim() && <h2 style={{ marginBottom: '1rem' }}>{props.title.trim()}</h2>}
      {items.length === 0 && (
        <p style={{ color: 'var(--color-text-muted)' }}>Add questions and answers in the panel on the right.</p>
      )}
      {items.map((item, index) => (
        <details key={index} style={{ borderBottom: '1px solid var(--color-border)', padding: '0.75rem 0' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{item.question}</summary>
          <p style={{ margin: '0.5rem 0 0', color: 'var(--color-text)' }}>{item.answer}</p>
        </details>
      ))}
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdEscape(jsonLd) }} />}
    </section>
  )
}

export const seoFaqPuckComponent = {
  label: 'FAQ (SEO)',
  fields: {
    title: { type: 'text' as const, label: 'Section title' },
    items: {
      type: 'array' as const,
      label: 'Questions',
      getItemSummary: (item: FaqItem) => item.question?.trim() || 'New question',
      arrayFields: {
        question: { type: 'text' as const, label: 'Question' },
        answer: { type: 'textarea' as const, label: 'Answer' },
      },
    },
    padding: {
      type: 'select' as const,
      label: 'Padding (left/right)',
      options: [
        { value: 'none', label: 'None' },
        { value: 'sm', label: 'Small (0.5rem)' },
        { value: 'md', label: 'Medium (1rem)' },
        { value: 'lg', label: 'Large (2rem)' },
        { value: 'xl', label: 'Extra large (4rem)' },
      ],
    },
  },
  defaultProps: {
    title: 'Frequently asked questions',
    items: [],
    padding: 'none',
  },
  render: FaqBlock,
}

export const seoFaqPuckRscComponent = {
  ...seoFaqPuckComponent,
  render: FaqBlock,
}
