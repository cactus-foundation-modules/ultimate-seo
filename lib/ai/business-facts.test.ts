import { describe, expect, it } from 'vitest'
import { businessFacts, businessFactsSection, businessFactsText, returnsLine } from './business-facts'
import { DEFAULT_STRUCTURED_DATA, type SeoStructuredData } from '../types'

const profile = (over: Partial<SeoStructuredData> = {}): SeoStructuredData => ({
  ...DEFAULT_STRUCTURED_DATA,
  ...over,
})

const filled = profile({
  name: 'Deskwell Office Furniture',
  legalName: 'Deskwell Limited',
  alternateName: 'Deskwell',
  identifierName: 'Companies House company number',
  identifierValue: '17332661',
  vatId: 'GB525366781',
  streetAddress: '1 Myers Walk',
  addressLocality: 'London',
  postalCode: 'E14 5GT',
  addressCountry: 'GB',
  areaServed: ['GB'],
  email: 'hi@example.com',
  telephone: '+44 20 8138 0512',
  sameAs: ['https://example.com/a', 'https://example.com/a', 'https://example.com/b'],
})

describe('businessFacts', () => {
  it('is empty when there is no name anywhere', () => {
    expect(businessFacts(profile(), '')).toEqual([])
  })

  it('falls back to the site name', () => {
    const facts = businessFacts(profile({ vatId: 'GB1' }), 'Some Shop')
    expect(facts[0]).toEqual({ label: 'Name', value: 'Some Shop' })
  })

  it('does not repeat the name as its own registered or alternate name', () => {
    const facts = businessFacts(profile({ name: 'Deskwell', legalName: 'Deskwell', alternateName: 'Deskwell', vatId: 'GB1' }), '')
    expect(facts.filter((f) => f.value === 'Deskwell')).toHaveLength(1)
  })

  it('labels the registration number with the name the owner gave it', () => {
    const facts = businessFacts(filled, '')
    expect(facts).toContainEqual({ label: 'Companies House company number', value: '17332661' })
  })

  it('drops a registration number with no label, and a label with no number', () => {
    expect(businessFacts(profile({ name: 'X', identifierValue: '123', vatId: 'GB1' }), ''))
      .not.toContainEqual(expect.objectContaining({ value: '123' }))
    expect(businessFacts(profile({ name: 'X', identifierName: 'Some register', vatId: 'GB1' }), '')
      .map((f) => f.label)).not.toContain('Some register')
  })

  it('writes the address on one line, skipping the blanks', () => {
    expect(businessFacts(filled, '')).toContainEqual({
      label: 'Address',
      value: '1 Myers Walk, London, E14 5GT, GB',
    })
  })

  it('de-duplicates the profile links', () => {
    const listed = businessFacts(filled, '').find((f) => f.label === 'Also listed at')
    expect(listed?.value).toBe('https://example.com/a, https://example.com/b')
  })

  it('falls back to the contact point when the top-level email and phone are blank', () => {
    const facts = businessFacts(profile({ name: 'X', contactEmail: 'c@example.com', contactTelephone: '+441' }), '')
    expect(facts).toContainEqual({ label: 'Email', value: 'c@example.com' })
    expect(facts).toContainEqual({ label: 'Telephone', value: '+441' })
  })
})

describe('businessFactsSection', () => {
  it('is null when all there is to say is the name', () => {
    expect(businessFactsSection(profile({ name: 'Deskwell' }), '')).toBeNull()
  })

  it('renders a Markdown heading and one bullet per fact', () => {
    const section = businessFactsSection(filled, '')
    expect(section).toContain('## About this business')
    expect(section).toContain('- **Registered name**: Deskwell Limited')
    expect(section).toContain('- **VAT number**: GB525366781')
    expect(section).toContain('- **Sells to**: GB')
  })
})

describe('businessFactsText', () => {
  it('is the same facts without the Markdown', () => {
    const text = businessFactsText(filled, '')
    expect(text).toContain('VAT number: GB525366781')
    expect(text).not.toContain('**')
  })

  it('is null when the profile is empty', () => {
    expect(businessFactsText(profile(), '')).toBeNull()
  })
})

describe('returnsLine', () => {
  it('says nothing at all when the owner has not stated a policy', () => {
    expect(returnsLine(profile())).toBe('')
    expect(businessFacts(filled, '').some((f) => f.label === 'Returns')).toBe(false)
  })

  it('reads as a sentence, not as schema.org', () => {
    const line = returnsLine(profile({
      returnPolicyCategory: 'MerchantReturnFiniteReturnWindow',
      returnDays: 30,
      returnMethod: 'ReturnByMail',
      returnFees: 'FreeReturn',
    }))
    expect(line).toBe('Within 30 days, by post, free of charge')
  })

  it('names the fee when the buyer is paying it', () => {
    const line = returnsLine(profile({
      returnPolicyCategory: 'MerchantReturnFiniteReturnWindow',
      returnDays: 14,
      returnFees: 'ReturnShippingFees',
      returnFeeAmount: 4.99,
      returnFeeCurrency: 'GBP',
    }))
    expect(line).toContain('return postage GBP 4.99, paid by the buyer')
  })

  it('says so plainly when returns are not accepted', () => {
    expect(returnsLine(profile({ returnPolicyCategory: 'MerchantReturnNotPermitted' }))).toBe('Not accepted')
  })

  it('reaches llms.txt and the agent endpoint through the same fact', () => {
    const sd = profile({
      ...filled,
      returnPolicyCategory: 'MerchantReturnUnlimitedWindow',
      returnFees: 'FreeReturn',
    })
    expect(businessFactsSection(sd, '')).toContain('**Returns**: Any time, free of charge')
    expect(businessFactsText(sd, '')).toContain('Returns: Any time, free of charge')
  })
})
