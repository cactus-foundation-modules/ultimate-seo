# Ultimate SEO

The one-stop SEO command centre for [Cactus](https://github.com/usersaynoso/cactus-foundation). Controls, analyses and suggests SEO improvements across the whole site - core pages and installed modules alike.

## What it does

- **SEO dashboard** - site-wide score, coverage stats (missing descriptions, missing social images, duplicate titles) and quick wins, with a very loud warning if the site is hidden from search engines.
- **Pages** - one unified list of everything with a URL: core pages, Gazette posts, Shop products and Directory entries (whichever modules are installed). Each gets a 0-100 score from a 20-odd-rule analyser (title/description length and uniqueness, slug hygiene, headings, content depth, image alt text, internal links, focus keyword placement and density, readability). Core pages get one-click fixes and a Google-style result preview; module content deep-links to its own editor. **Analyse all** scores the whole list - or whatever the filters have narrowed it to - in one go, with a progress bar and a stop button.
- **Site audit** - a crawler that fetches your published pages the way a search engine does and reports rendered-page problems: missing titles or descriptions, noindex flags, heading issues, missing alt text, thin content, slow responses, broken pages. Runs on demand and weekly by itself.
- **Sitemap & robots** - add extra sitemap entries and robots.txt disallow rules from the admin, no file editing.
- **Structured data** - two page-builder blocks: *Structured data (SEO)* for Organisation / Local business / Website / custom JSON-LD, and *FAQ (SEO)* which renders a real FAQ accordion plus FAQPage rich-result markup.
- **Settings → SEO tab** - takes over the search-engine visibility switch, plus organisation details, social handles and analyser targets.

## Install

Add to your site's `modules.json` (or install through the Cactus admin modules screen):

```json
{
  "name": "ultimate-seo",
  "repoUrl": "https://github.com/cactus-foundation-modules/ultimate-seo",
  "version": "v0.1.0"
}
```

Requires Cactus core `0.5.436` or newer. No environment variables needed; the weekly audit uses the standard `CRON_SECRET`.

## Permissions

- `seo.view` - see the dashboard, pages and audit screens
- `seo.manage` - apply fixes, run audits, edit sitemap/robots rules and settings

## Tables

All tables are prefixed `seo_` and removed cleanly on uninstall.
