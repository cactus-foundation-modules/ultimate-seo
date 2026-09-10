import { describe, expect, it } from 'vitest'
import { summariseAiHits } from './analytics'
import { identifyAiCrawler, identifyAiReferrer, agentLabel } from './crawlers'

describe('identifyAiCrawler', () => {
  it('is null for a person', () => {
    expect(identifyAiCrawler('Mozilla/5.0 (Macintosh) Safari/605.1.15')).toBeNull()
    expect(identifyAiCrawler(null)).toBeNull()
  })

  it('tells the search crawler from the training one', () => {
    expect(identifyAiCrawler('Mozilla/5.0 (compatible; ClaudeBot/1.0)')).toBe('claudebot')
    expect(identifyAiCrawler('Mozilla/5.0 (compatible; Claude-SearchBot/1.0)')).toBe('claude-searchbot')
    expect(identifyAiCrawler('Mozilla/5.0 (compatible; GPTBot/1.2)')).toBe('gptbot')
    expect(identifyAiCrawler('Mozilla/5.0 (compatible; OAI-SearchBot/1.0)')).toBe('oai-searchbot')
  })
})

describe('identifyAiReferrer', () => {
  it('takes the host, not a substring of the URL', () => {
    expect(identifyAiReferrer('https://chatgpt.com/c/abc')).toBe('chatgpt')
    expect(identifyAiReferrer('https://www.perplexity.ai/search?q=desks')).toBe('perplexity')
    expect(identifyAiReferrer('https://example.com/blog/about-chatgpt.com')).toBeNull()
    expect(identifyAiReferrer('https://notchatgpt.com/')).toBeNull()
  })

  it('accepts a subdomain of a known host', () => {
    expect(identifyAiReferrer('https://uk.claude.ai/thing')).toBe('claude')
  })

  it('is null for nonsense rather than throwing', () => {
    expect(identifyAiReferrer('not a url')).toBeNull()
    expect(identifyAiReferrer(null)).toBeNull()
  })
})

describe('agentLabel', () => {
  it('names crawlers and assistants, and falls back to the key', () => {
    expect(agentLabel('gptbot')).toBe('GPTBot')
    expect(agentLabel('chatgpt')).toBe('ChatGPT')
    expect(agentLabel('something-new')).toBe('something-new')
  })
})

describe('summariseAiHits', () => {
  const day = (s: string) => new Date(`${s}T00:00:00Z`)
  const rows = [
    { day: day('2026-09-01'), kind: 'crawler' as const, agent: 'gptbot', path: '/a', hits: 5, last_seen: day('2026-09-01') },
    { day: day('2026-09-01'), kind: 'referral' as const, agent: 'chatgpt', path: '/a', hits: 2, last_seen: day('2026-09-01') },
    { day: day('2026-09-02'), kind: 'crawler' as const, agent: 'gptbot', path: '/b', hits: 3, last_seen: day('2026-09-02') },
  ]

  it('totals the two kinds separately', () => {
    const s = summariseAiHits(rows)
    expect(s.totalCrawls).toBe(8)
    expect(s.totalReferrals).toBe(2)
  })

  it('groups by agent, keeping the latest sighting', () => {
    const s = summariseAiHits(rows)
    expect(s.byAgent[0]).toEqual({ agent: 'gptbot', kind: 'crawler', hits: 8, lastSeen: day('2026-09-02') })
  })

  it('adds a path up across days and sorts by how busy it is', () => {
    const s = summariseAiHits(rows)
    expect(s.byPath).toEqual([{ path: '/a', hits: 7 }, { path: '/b', hits: 3 }])
  })

  it('gives a day series in date order', () => {
    expect(summariseAiHits(rows).byDay).toEqual([
      { day: '2026-09-01', crawls: 5, referrals: 2 },
      { day: '2026-09-02', crawls: 3, referrals: 0 },
    ])
  })

  it('is empty, not broken, with nothing to summarise', () => {
    expect(summariseAiHits([])).toEqual({ totalCrawls: 0, totalReferrals: 0, byAgent: [], byPath: [], byDay: [] })
  })
})
