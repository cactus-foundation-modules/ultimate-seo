import { describe, expect, it } from 'vitest'
import { contentSignalLine, robotsExtraLines, robotsGroups } from './robots-rules'
import { DEFAULT_AI_SETTINGS, type SeoAiSettings } from '../types'

const base = (over: Partial<SeoAiSettings> = {}): SeoAiSettings => ({ ...DEFAULT_AI_SETTINGS, ...over })

describe('contentSignalLine', () => {
  it('says nothing when the owner has said nothing', () => {
    expect(contentSignalLine(base())).toBeNull()
  })

  it('writes only the signals that were set', () => {
    expect(contentSignalLine(base({ contentSignals: { search: 'yes', aiInput: 'unset', aiTrain: 'no' } })))
      .toBe('Content-Signal: search=yes, ai-train=no')
  })
})

describe('robotsGroups', () => {
  it('is empty by default, so an update changes nothing a site publishes', () => {
    expect(robotsGroups(base())).toEqual([])
  })

  it('puts every blocked crawler in one group', () => {
    const groups = robotsGroups(base({ crawlerPolicy: { gptbot: 'block', ccbot: 'block' } }))
    expect(groups).toHaveLength(1)
    expect(groups[0]!.userAgents).toEqual(['GPTBot', 'CCBot'])
    expect(groups[0]!.disallow).toEqual(['/'])
  })

  it('keeps allowed and blocked in separate groups', () => {
    const groups = robotsGroups(base({ crawlerPolicy: { gptbot: 'block', 'oai-searchbot': 'allow' } }))
    expect(groups.map((g) => g.userAgents)).toEqual([['GPTBot'], ['OAI-SearchBot']])
    expect(groups[1]!.allow).toEqual(['/'])
  })
})

describe('robotsExtraLines', () => {
  it('points at llms.txt when it is published', () => {
    expect(robotsExtraLines(base(), 'https://example.com'))
      .toEqual(['# Markdown copies of this site: https://example.com/llms.txt'])
  })

  it('says nothing about llms.txt when it is switched off', () => {
    expect(robotsExtraLines(base({ llmsTxt: false }), 'https://example.com')).toEqual([])
  })

  it('announces the agent endpoint once it is switched on', () => {
    expect(robotsExtraLines(base({ mcp: true }), 'https://example.com')).toEqual([
      '# Markdown copies of this site: https://example.com/llms.txt',
      '# Agent endpoint (MCP, read-only, JSON-RPC over POST): https://example.com/api/m/ultimate-seo/mcp',
    ])
  })

  it('says nothing about the agent endpoint while it is off', () => {
    expect(robotsExtraLines(base(), 'https://example.com').join('\n')).not.toContain('mcp')
  })

  it('carries the content signal above the pointer', () => {
    const lines = robotsExtraLines(base({ contentSignals: { search: 'yes', aiInput: 'yes', aiTrain: 'no' } }), 'https://example.com')
    expect(lines[0]).toBe('Content-Signal: search=yes, ai-input=yes, ai-train=no')
    expect(lines).toHaveLength(2)
  })
})
