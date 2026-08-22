---
description: Fetch or crawl known web pages with bounded Firecrawl usage
argument-hint: "<URL> [instructions]"
---
Perform a **web scrape or crawl** for: $@

For one straightforward page, try `fetch_content` first. For blocked, JavaScript-heavy, structured, or site-wide targets, use `firecrawl_load` to load only the required scrape, map, crawl, or crawl-status capability. Keep page counts bounded, preserve source URLs, and report when output is truncated or stored in a temporary artifact.
