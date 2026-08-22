# My Personal Pi Config

This repo contains my personal [Pi](https://github.com/badlogic/pi-mono) configuration.

So far, I've built a custom dashboard and statusline. My goal is to turn this into the ultimate customized AI harness—with all the bells and whistles I need for the perfect agentic workflow.

> Work in progress.

## Local credentials

Launch Pi normally with `pi`. The global `00-env-loader.ts` extension safely parses the gitignored `agent/.env` file and imports only allowlisted credentials such as `FIRECRAWL_API_KEY`. It does not execute the file as shell code or overwrite credentials already inherited by Pi.

Keep `agent/.env` owner-only (`chmod 600 agent/.env`) and never commit it. Run `/research-status` to verify Firecrawl readiness without displaying the key.

## Web research modes

- `/quick-search <query>` — one lightweight search with at most five results.
- `/skill:deep-research <topic>` — multi-source Firecrawl research, verification, and cited synthesis.
- `/web-scrape <url> [instructions]` — fetch, scrape, map, or crawl known targets.

For ambiguous web requests, the research router asks whether to use quick search, deep research, or web scrape/crawl before allowing a network tool to run.
