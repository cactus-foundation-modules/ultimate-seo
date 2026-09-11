import { describe, expect, it } from 'vitest'
import { AI_CRAWLERS, agentLabel, identifyAiCrawler, identifyAiReferrer } from './crawlers'

describe('identifyAiCrawler', () => {
  it('is null for an ordinary browser', () => {
    expect(identifyAiCrawler('Mozilla/5.0 (Macintosh) Safari/605.1.15')).toBeNull()
    expect(identifyAiCrawler(null)).toBeNull()
  })

  // The longest token has to win. "ClaudeBot" is a substring of nothing, but
  // "Claude-SearchBot" contains neither it nor the other way round only because
  // the matcher sorts by length - get that wrong and every search visit is
  // filed as training, which is the opposite answer.
  it('tells the three Anthropic agents apart', () => {
    expect(identifyAiCrawler('Mozilla/5.0 ClaudeBot/1.0')).toBe('claudebot')
    expect(identifyAiCrawler('Mozilla/5.0 Claude-SearchBot/1.0')).toBe('claude-searchbot')
    expect(identifyAiCrawler('Mozilla/5.0 Claude-User/1.0')).toBe('claude-user')
  })

  it('knows the tokens added since the first release', () => {
    expect(identifyAiCrawler('anthropic-ai')).toBe('anthropic-ai')
    expect(identifyAiCrawler('meta-externalfetcher/1.1')).toBe('meta-externalfetcher')
    expect(identifyAiCrawler('Mozilla/5.0 (compatible; Google-CloudVertexBot/1.0)')).toBe('google-cloudvertexbot')
    expect(identifyAiCrawler('FacebookBot')).toBe('facebookbot')
    expect(identifyAiCrawler('Mozilla/5.0 (compatible) AI2Bot/1.0')).toBe('ai2bot')
  })

  it('gives every crawler a key nothing else uses', () => {
    expect(new Set(AI_CRAWLERS.map((c) => c.key)).size).toBe(AI_CRAWLERS.length)
    expect(new Set(AI_CRAWLERS.map((c) => c.token.toLowerCase())).size).toBe(AI_CRAWLERS.length)
  })
})

describe('identifyAiReferrer', () => {
  it('counts both of Anthropic’s domains as one assistant', () => {
    expect(identifyAiReferrer('https://claude.ai/chat/abc')).toBe('claude')
    expect(identifyAiReferrer('https://claude.com/chat/abc')).toBe('claude')
  })

  it('is not fooled by a host that merely ends in the name', () => {
    expect(identifyAiReferrer('https://notclaude.ai/')).toBeNull()
    expect(identifyAiReferrer('https://www.example.com/about-chatgpt')).toBeNull()
  })

  it('accepts a subdomain of one it knows', () => {
    expect(identifyAiReferrer('https://www.perplexity.ai/search')).toBe('perplexity')
  })

  it('has a label for a referrer as well as for a crawler', () => {
    expect(agentLabel('claude')).toBe('Claude')
    expect(agentLabel('claudebot')).toBe('ClaudeBot')
    expect(agentLabel('nothing-known')).toBe('nothing-known')
  })
})
