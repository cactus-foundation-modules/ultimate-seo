// Turning a stored Markdown twin into one that can be read anywhere.
//
// The twins are stored with site-relative addresses on purpose: a hostname
// baked into twenty thousand rows is a hostname that has to be rebuilt out of
// them, and the same table is read on a preview deployment answering to an
// entirely different name. See the ctx.siteUrl comment in ai/materialise.ts.
//
// That is right for storage and wrong for delivery. A twin is not fetched the
// way a page is: there is no document it was linked from, so there is no base
// address for `/office-desks` to resolve against, and the reader is frequently
// something that has been handed the text with no URL attached to it at all -
// an inlined body in llms-full.txt, a tool result over MCP. An assistant that
// then quotes the site back to somebody produces a link that goes nowhere,
// which is the one outcome all of this exists to avoid.
//
// So the addresses are made absolute here, on the way out, where the host
// actually answering the request is known.

// A Markdown inline link or image target that is a site path. The negative
// lookahead keeps `//host/x` out of it: that is protocol-relative and already
// absolute, and gluing a hostname to the front of one would silently rewrite
// where it points.
const LINK_TARGET = /(!?\]\()(\/(?!\/)[^)\s]*)(\s*(?:"[^"]*")?\))/g

// The `- URL:` line renderDocument puts at the top of every twin.
const HEADER_URL = /^(- URL: )(\/\S*)$/gm

/**
 * Every site path in a stored document, rewritten to an absolute address.
 *
 * A blank site URL leaves the document exactly as it was: paths are wrong for a
 * standalone reader, but a document full of `undefined/office-desks` is worse.
 */
export function absolutiseMarkdown(markdown: string, siteUrl: string): string {
  const base = siteUrl.trim().replace(/\/+$/, '')
  if (!base) return markdown
  return markdown
    .replace(LINK_TARGET, (_match, open: string, path: string, close: string) => `${open}${base}${path}${close}`)
    .replace(HEADER_URL, (_match, label: string, path: string) => `${label}${base}${path}`)
}
