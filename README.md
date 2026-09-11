<p align="center">
  <img src="module-art.webp" alt="Ultimate SEO" width="640" />
</p>

# Ultimate SEO

The one-stop SEO command centre for [Cactus](https://github.com/usersaynoso/cactus-foundation). Controls, analyses and suggests SEO improvements across the whole site - core pages and installed modules alike.

## What it does

- **SEO dashboard** - site-wide score, coverage stats (missing descriptions, missing social images, duplicate titles) and quick wins, with a very loud warning if the site is hidden from search engines.
- **Pages** - one unified list of everything with a URL: core pages, Gazette posts, Shop products and Directory entries (whichever modules are installed). Each gets a 0-100 score from a 20-odd-rule analyser (title/description length and uniqueness, slug hygiene, headings, content depth, image alt text, internal links, focus keyword placement and density, readability). Core pages get one-click fixes and a Google-style result preview; module content deep-links to its own editor. **Analyse all** scores the whole list - or whatever the filters have narrowed it to - in one go, with a progress bar and a stop button.
- **Site audit** - a crawler that fetches your published pages the way a search engine does and reports rendered-page problems: missing titles or descriptions, noindex flags, heading issues, missing alt text, thin content, missing or unreadable structured data, cross-site canonical tags, missing viewport or language declaration, slow responses, broken pages. Runs on demand and weekly by itself.
- **Sitemap & robots** - add extra sitemap entries and robots.txt disallow rules from the admin, no file editing.
- **Structured data** - a whole screen for the site-wide record, every property a field rather than hand-written JSON: one or more schema.org types (Organization / LocalBusiness / Store / OnlineStore / Corporation / ProfessionalService, tick as many as are true), name, alternate name, legal name, description, url, logo as a full ImageObject (width, height, caption), photograph, email, phone, postal address, areas served, a ContactPoint (type, email, phone, areas, languages), VAT / tax ID / D-U-N-S / ISO 6523 / a named PropertyValue identifier, founding date, opening hours and price range, official profile URLs and a returns policy (window, method, who pays, where it applies) published as a `MerchantReturnPolicy` - plus a WebSite block with an optional sitelinks search box. Set once, emitted on every public page, with a live preview of the exact JSON-LD. Everything is off until you switch it on.
- **Structured data blocks** - two page-builder blocks for the pages that need to say something different: *Structured data (SEO)* for Organisation / Local business / Website / custom JSON-LD, and *FAQ (SEO)* which renders a real FAQ accordion plus FAQPage rich-result markup.
- **Settings → SEO tab** - takes over the search-engine visibility switch, plus organisation details, social handles and analyser targets. The X/Twitter handle is published as `twitter:site` on every page.
- **The AI half** - everything an assistant needs to read the site properly and quote it back accurately. `/llms.txt` indexes every page with a one-line summary and opens with who the business actually is (legal name, company number, VAT, address, where it trades); `/llms-full.txt` is the same index with the shorter documents inlined; every page has a Markdown twin at its own address with `.md` on the end, linked from the page head. Crawler controls and Cloudflare content signals go into `robots.txt` from a screen rather than a file. AI crawler visits and AI-assistant referrals are counted separately from ordinary traffic. Addresses inside a twin are made absolute on the way out, so a reader holding the text on its own still has links that work. Prices in a twin are the ones the storefront prints, tax adjustment and all, with the shop's own wording ("ex VAT") on the end - an assistant quoting a page should quote the figure the shopper will see.
- **Agent endpoint (MCP)** - an optional read-only MCP server at `/api/m/ultimate-seo/mcp`, JSON-RPC over POST, announced in both `llms.txt` and `robots.txt`. Five tools: `get_site_info` (what the business is and who runs it, returns policy included), `list_sections` (what is published and how much), `search_site` (whole-phrase first, then word by word, so a question phrased as a sentence still finds something), `find_products` (the catalogue narrowed by price, availability and category, sorted by price - the question a shopper actually asks) and `get_page` (one page in full, as Markdown). Every product result carries its price, the shop's tax wording and its stock on the line, so a comparison needs no follow-up fetches. It reads the same published copies as everything else, so there is no second version of the site to drift out of step.

## Install

Add to your site's `modules.json` (or install through the Cactus admin modules screen):

```json
{
  "name": "ultimate-seo",
  "repoUrl": "https://github.com/cactus-foundation-modules/ultimate-seo",
  "version": "v0.1.0"
}
```

Requires Cactus core `0.5.1418` or newer (the site-wide `lib/head.ts` hook the structured data is emitted through). No environment variables needed; the weekly audit uses the standard `CRON_SECRET`.

## Permissions

- `seo.view` - see the dashboard, pages and audit screens
- `seo.manage` - apply fixes, run audits, edit sitemap/robots rules and settings

## Tables

All tables are prefixed `seo_` and removed cleanly on uninstall.
