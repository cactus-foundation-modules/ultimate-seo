// This module's answer to core's three agent-content addresses: /llms.txt,
// /llms-full.txt and the Markdown twin at /<any-page>.md.
//
// Registered on the 'core.agent-content' extension point as serverOnly, so it
// stays out of the public extension-point map: everything below reads the whole
// catalogue out of the database, and none of it has any business being reachable
// from a page's bundle. See lib/agent-content/providers.ts in core.

import type { AgentContentProvider } from '@/lib/agent-content/providers'
import { absolutiseMarkdown } from './ai/absolutise'
import { observeAiRequest } from './ai/analytics'
import { getDocumentByPath } from './ai/db'
import { buildLlmsFull, buildLlmsIndex } from './ai/llms-txt'
import { getAiSettings } from './settings'

export const ultimateSeoAgentContent: AgentContentProvider = {
  async llmsIndex(siteUrl: string) {
    const settings = await getAiSettings()
    void observeAiRequest('/llms.txt')
    return buildLlmsIndex(siteUrl, settings)
  },

  async llmsFull(siteUrl: string) {
    const settings = await getAiSettings()
    void observeAiRequest('/llms-full.txt')
    return buildLlmsFull(siteUrl, settings)
  },

  async markdown(path: string, siteUrl: string) {
    const settings = await getAiSettings()
    if (!settings.markdown) return null

    // The homepage's twin is stored under 'index' rather than the empty string:
    // /.md is not an address anybody would type. See pathOf in ai/documents.ts.
    const key = path === '' ? 'index' : path
    const doc = await getDocumentByPath(key)
    if (!doc) return null

    void observeAiRequest(`/${key}.md`)
    // Absolute on the way out: this document is handed to a reader with no page
    // around it and no base address to resolve a bare path against.
    return { markdown: absolutiseMarkdown(doc.markdown, siteUrl), lastModified: doc.source_updated_at }
  },
}
