---
name: deep-research
description: Conducts thorough multi-source web research with Firecrawl retrieval, claim verification, and cited synthesis. Use for comparisons, evaluations, literature reviews, current-state reports, or requests requiring broad evidence and citations.
compatibility: Requires pi-web-access; Firecrawl retrieval requires FIRECRAWL_API_KEY.
---

# Deep Research

Research the user's topic thoroughly while controlling cost and context growth.

## Workflow

1. Restate the research question and identify material ambiguities. Use the `questionnaire` tool for unresolved scope, timeframe, geography, target sites, or output requirements.
2. Create 2-4 genuinely different search angles. Do not issue paraphrases that are likely to return the same results.
3. Run `web_search` with the Firecrawl provider, full content enabled, 8-12 results per query, and `workflow: "none"`. Let Pi perform the final synthesis rather than invoking a nested summary workflow.
4. Prefer primary sources, official documentation, filings, standards, research papers, and directly maintained repositories. Record publication and update dates when freshness matters.
5. Use `get_search_content` to retrieve only relevant passages from stored pages. Do not inject an entire large result set into context.
6. Use `source_check` with fetched content for consequential, disputed, surprising, quantitative, legal, medical, financial, or security-sensitive claims.
7. If a relevant site needs broader acquisition, call `firecrawl_load` and load only map/crawl/status/scrape tools. Map before crawling when scope is uncertain. Default to at most 25 pages unless the user approves more.
8. Compare sources, identify disagreements, and distinguish sourced facts from inference. Do not silently resolve conflicting evidence.
9. Produce a structured synthesis with direct source links adjacent to the supported claims. Include limitations, unresolved questions, and the date of research when recency matters.

## Cost and safety

- Do not use Firecrawl for a quick lookup when snippets are sufficient.
- Do not start a large crawl without explicit user confirmation.
- Respect tool truncation notices; inspect only necessary slices of temporary full-response artifacts.
- If `FIRECRAWL_API_KEY` is missing, report the configuration issue once and do not retry repeatedly.

User topic and instructions are appended below when invoked through `/skill:deep-research`.
