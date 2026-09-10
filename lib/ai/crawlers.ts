// The AI crawlers and assistants a site can have an opinion about.
//
// One table, three readers: the robots.txt groups (what each one is allowed to
// do), the analytics (which one just fetched a page), and the admin screen
// (what to call it in front of an owner who has never heard of any of them).
//
// `purpose` is the distinction that actually matters to a business, and the one
// no single robots.txt line can express:
//
//   train   collects pages to train a model on. Nothing comes back.
//   search  indexes pages so the assistant can cite them in an answer. This is
//           the one a shop wants: it is how a product ends up recommended.
//   agent   fetches this page now because a person asked about it now. Blocking
//           it means the person is told the site would not answer.
//
// An owner who blocks everything blocks the two that send customers as well as
// the one that does not, which is why the screen groups them this way rather
// than offering a single "block AI" switch.

export type AiCrawlerPurpose = 'train' | 'search' | 'agent'

export type AiCrawler = {
  /** Stable key: what the settings column stores, never shown to anybody. */
  key: string
  /** The exact User-agent token robots.txt addresses. */
  token: string
  label: string
  vendor: string
  purpose: AiCrawlerPurpose
  /** One line an owner can act on. No jargon. */
  note: string
}

export const AI_CRAWLERS: readonly AiCrawler[] = [
  // OpenAI
  { key: 'gptbot', token: 'GPTBot', label: 'GPTBot', vendor: 'OpenAI', purpose: 'train', note: 'Collects pages to train ChatGPT. Sends you nothing back.' },
  { key: 'oai-searchbot', token: 'OAI-SearchBot', label: 'OpenAI Search', vendor: 'OpenAI', purpose: 'search', note: 'Indexes your pages so ChatGPT can cite and link them.' },
  { key: 'chatgpt-user', token: 'ChatGPT-User', label: 'ChatGPT (live visit)', vendor: 'OpenAI', purpose: 'agent', note: 'Fetches a page because somebody in ChatGPT asked about it just now.' },
  // Anthropic
  { key: 'claudebot', token: 'ClaudeBot', label: 'ClaudeBot', vendor: 'Anthropic', purpose: 'train', note: 'Collects pages to train Claude. Sends you nothing back.' },
  { key: 'claude-searchbot', token: 'Claude-SearchBot', label: 'Claude Search', vendor: 'Anthropic', purpose: 'search', note: 'Indexes your pages so Claude can cite and link them.' },
  { key: 'claude-user', token: 'Claude-User', label: 'Claude (live visit)', vendor: 'Anthropic', purpose: 'agent', note: 'Fetches a page because somebody using Claude asked about it just now.' },
  // Perplexity
  { key: 'perplexitybot', token: 'PerplexityBot', label: 'PerplexityBot', vendor: 'Perplexity', purpose: 'search', note: 'Indexes your pages so Perplexity can cite and link them.' },
  { key: 'perplexity-user', token: 'Perplexity-User', label: 'Perplexity (live visit)', vendor: 'Perplexity', purpose: 'agent', note: 'Fetches a page because somebody in Perplexity asked about it just now.' },
  // Google and Apple - opt-out tokens rather than crawlers of their own. Neither
  // fetches anything; both are read off the ordinary crawler's visit, which is
  // why blocking one here does NOT remove you from that company's search results.
  { key: 'google-extended', token: 'Google-Extended', label: 'Google AI training', vendor: 'Google', purpose: 'train', note: 'Whether Google may use your pages to train Gemini. Blocking it does not affect Google Search.' },
  { key: 'applebot-extended', token: 'Applebot-Extended', label: 'Apple AI training', vendor: 'Apple', purpose: 'train', note: 'Whether Apple may use your pages to train Apple Intelligence. Blocking it does not affect Siri or Spotlight.' },
  // Everybody else
  { key: 'amazonbot', token: 'Amazonbot', label: 'Amazonbot', vendor: 'Amazon', purpose: 'search', note: 'Indexes pages for Alexa and Amazon search results.' },
  { key: 'meta-externalagent', token: 'meta-externalagent', label: 'Meta AI', vendor: 'Meta', purpose: 'train', note: 'Collects pages for Meta AI. Sends you nothing back.' },
  { key: 'bytespider', token: 'Bytespider', label: 'Bytespider', vendor: 'ByteDance', purpose: 'train', note: 'Collects pages for ByteDance. Known for crawling hard and often.' },
  { key: 'ccbot', token: 'CCBot', label: 'Common Crawl', vendor: 'Common Crawl', purpose: 'train', note: 'A public archive that most model builders train from. Blocking it blocks many at once.' },
  { key: 'mistralai-user', token: 'MistralAI-User', label: 'Mistral (live visit)', vendor: 'Mistral', purpose: 'agent', note: 'Fetches a page because somebody using Mistral asked about it just now.' },
  { key: 'cohere-ai', token: 'cohere-ai', label: 'Cohere', vendor: 'Cohere', purpose: 'train', note: 'Collects pages for Cohere. Sends you nothing back.' },
  { key: 'diffbot', token: 'Diffbot', label: 'Diffbot', vendor: 'Diffbot', purpose: 'train', note: 'Scrapes pages into a commercial database sold on to others.' },
  { key: 'timpibot', token: 'Timpibot', label: 'Timpibot', vendor: 'Timpi', purpose: 'train', note: 'Collects pages for a distributed index. Sends you nothing back.' },
  { key: 'imagesiftbot', token: 'ImagesiftBot', label: 'ImageSift', vendor: 'ImageSift', purpose: 'train', note: 'Collects images from your pages for a searchable image dataset.' },
  { key: 'youbot', token: 'YouBot', label: 'YouBot', vendor: 'You.com', purpose: 'search', note: 'Indexes your pages so You.com can cite and link them.' },
  { key: 'duckassistbot', token: 'DuckAssistBot', label: 'DuckAssist', vendor: 'DuckDuckGo', purpose: 'search', note: 'Indexes your pages for DuckDuckGo’s assistant answers.' },
] as const

export const AI_CRAWLER_KEYS: ReadonlySet<string> = new Set(AI_CRAWLERS.map((c) => c.key))

export function crawlerByKey(key: string): AiCrawler | undefined {
  return AI_CRAWLERS.find((c) => c.key === key)
}

// Matched against the User-agent header, longest token first so that
// "Claude-SearchBot" is never reported as "ClaudeBot" - the shorter token is a
// substring of the longer one, and getting that the wrong way round would have
// filed every search visit under training.
const MATCHERS: ReadonlyArray<{ key: string; needle: string }> = [...AI_CRAWLERS]
  .sort((a, b) => b.token.length - a.token.length)
  .map((c) => ({ key: c.key, needle: c.token.toLowerCase() }))

/** Which AI crawler this User-agent is, or null for an ordinary visitor. */
export function identifyAiCrawler(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null
  const ua = userAgent.toLowerCase()
  for (const m of MATCHERS) if (ua.includes(m.needle)) return m.key
  return null
}

// The assistants that send people. Matched on the referrer's host, so a link
// from a page ABOUT ChatGPT is not counted as a visit FROM ChatGPT.
const REFERRERS: ReadonlyArray<{ key: string; label: string; hosts: readonly string[] }> = [
  { key: 'chatgpt', label: 'ChatGPT', hosts: ['chatgpt.com', 'chat.openai.com'] },
  { key: 'claude', label: 'Claude', hosts: ['claude.ai'] },
  { key: 'perplexity', label: 'Perplexity', hosts: ['perplexity.ai', 'www.perplexity.ai'] },
  { key: 'gemini', label: 'Gemini', hosts: ['gemini.google.com', 'bard.google.com'] },
  { key: 'copilot', label: 'Microsoft Copilot', hosts: ['copilot.microsoft.com'] },
  { key: 'meta-ai', label: 'Meta AI', hosts: ['meta.ai', 'www.meta.ai'] },
  { key: 'grok', label: 'Grok', hosts: ['grok.com', 'x.ai'] },
  { key: 'mistral', label: 'Le Chat', hosts: ['chat.mistral.ai'] },
  { key: 'you', label: 'You.com', hosts: ['you.com'] },
  { key: 'poe', label: 'Poe', hosts: ['poe.com'] },
]

export const AI_REFERRER_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  REFERRERS.map((r) => [r.key, r.label]),
)

/** Which AI assistant sent this visitor, or null for an ordinary referrer. */
export function identifyAiReferrer(referer: string | null | undefined): string | null {
  if (!referer) return null
  let host: string
  try {
    host = new URL(referer).hostname.toLowerCase()
  } catch {
    return null
  }
  for (const r of REFERRERS) {
    // Exact host or a subdomain of it. Not a substring test: "notchatgpt.com"
    // would otherwise be filed as ChatGPT.
    if (r.hosts.some((h) => host === h || host.endsWith(`.${h}`))) return r.key
  }
  return null
}

/** What to call an agent in the analytics table, whichever kind it is. */
export function agentLabel(key: string): string {
  return crawlerByKey(key)?.label ?? AI_REFERRER_LABELS[key] ?? key
}
