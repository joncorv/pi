import assert from "node:assert/strict";
import test from "node:test";
import researchRouter, {
	applyDeepRoute,
	applyOpenAIRoute,
	applyQuickRoute,
	applyScrapeRoute,
	explicitRoute,
} from "./index.ts";

test("classifies explicit OpenAI, quick, deep, and scrape requests", () => {
	assert.equal(explicitRoute("Use OpenAI Search for this topic"), "openai");
	assert.equal(explicitRoute("Search the web using OpenAI"), "openai");
	assert.equal(explicitRoute("Run a Codex-backed web search"), "openai");
	assert.equal(explicitRoute("Do a quick lookup for the latest Pi release"), "quick");
	assert.equal(explicitRoute("Create a deep multi-source report"), "deep");
	assert.equal(explicitRoute("Scrape this URL https://example.com"), "scrape");
	assert.equal(explicitRoute("Summarize https://example.com"), "scrape");
	assert.equal(explicitRoute("Look online and tell me what you find"), undefined);
	assert.equal(explicitRoute("Compare OpenAI and Anthropic"), undefined);
	assert.equal(explicitRoute("Do a quick but exhaustive search"), undefined);
	assert.equal(explicitRoute("Do a quick OpenAI search"), undefined);
});

test("applies bounded route-specific search settings", () => {
	const openai: Record<string, unknown> = { queries: ["one", "two"], numResults: 2 };
	applyOpenAIRoute("web_search", openai);
	assert.deepEqual(openai, {
		queries: ["one", "two"],
		numResults: 8,
		includeContent: true,
		workflow: "none",
		provider: "openai",
	});

	const openaiCheck: Record<string, unknown> = { claim: "topic", numResults: 99 };
	applyOpenAIRoute("source_check", openaiCheck);
	assert.equal(openaiCheck.numResults, 20);
	assert.equal(openaiCheck.fetchContent, true);
	assert.equal(openaiCheck.provider, "openai");

	const quick: Record<string, unknown> = { queries: ["one", "two"], numResults: 99, includeContent: true };
	applyQuickRoute("web_search", quick);
	assert.deepEqual(quick, {
		query: "one",
		numResults: 5,
		includeContent: false,
		workflow: "none",
		provider: "duckduckgo",
	});

	const quickCheck: Record<string, unknown> = { claim: "topic", numResults: 99, fetchContent: true };
	applyQuickRoute("source_check", quickCheck);
	assert.equal(quickCheck.numResults, 5);
	assert.equal(quickCheck.fetchContent, false);
	assert.equal(quickCheck.provider, "duckduckgo");

	const deep: Record<string, unknown> = { query: "topic", numResults: 2 };
	applyDeepRoute("web_search", deep);
	assert.equal(deep.numResults, 8);
	assert.equal(deep.includeContent, true);
	assert.equal(deep.provider, "firecrawl");
	assert.equal(deep.workflow, "none");

	const scrape: Record<string, unknown> = { query: "target", numResults: 99 };
	applyScrapeRoute("web_search", scrape);
	assert.equal(scrape.numResults, 12);
	assert.equal(scrape.includeContent, true);
	assert.equal(scrape.provider, "firecrawl");
});

type Handler = (event: any, ctx: any) => any;

function harness() {
	const handlers = new Map<string, Handler[]>();
	const pi = {
		on(name: string, handler: Handler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		registerCommand() {},
		getAllTools() { return []; },
		getActiveTools() { return []; },
	};
	researchRouter(pi as any);
	return {
		async toolCall(text: string, toolName = "web_search", answers?: unknown, cancelled = false) {
			const branch: any[] = [
				{ type: "message", id: "user-1", message: { role: "user", content: text } },
			];
			if (answers || cancelled) {
				branch.push({
					type: "message",
					id: "tool-1",
					message: {
						role: "toolResult",
						toolName: "questionnaire",
						details: { cancelled, answers: answers ?? [] },
					},
				});
			}
			const event = { toolName, input: { query: "topic" } };
			const ctx = { sessionManager: { getBranch: () => branch } };
			const results = [];
			for (const handler of handlers.get("tool_call") ?? []) results.push(await handler(event, ctx));
			return { event, results };
		},
	};
}

test("blocks ambiguous network calls until questionnaire resolution", async () => {
	const router = harness();
	const ambiguous = await router.toolCall("Look online and find the best option");
	assert.equal(ambiguous.results[0]?.block, true);

	const openai = await router.toolCall("Look online and find the best option", "web_search", [
		{ id: "research_mode", value: "openai", label: "OpenAI Search", wasCustom: false },
	]);
	assert.equal(openai.results[0], undefined);
	assert.equal(openai.event.input.provider, "openai");
	assert.equal(openai.event.input.includeContent, true);
	assert.equal(openai.event.input.numResults, 10);

	const deep = await router.toolCall("Look online and find the best option", "web_search", [
		{ id: "research_mode", value: "deep", label: "Deep research", wasCustom: false },
	]);
	assert.equal(deep.results[0], undefined);
	assert.equal(deep.event.input.provider, "firecrawl");
	assert.equal(deep.event.input.includeContent, true);

	const quick = await router.toolCall("Look online and find the best option", "web_search", [
		{ id: "research_mode", value: "quick", label: "Quick lookup — DuckDuckGo", wasCustom: false },
	]);
	assert.equal(quick.results[0], undefined);
	assert.equal(quick.event.input.provider, "duckduckgo");
	assert.equal(quick.event.input.includeContent, false);

	const cancelled = await router.toolCall("Look online and find the best option", "web_search", [], true);
	assert.equal(cancelled.results[0]?.block, true);
	assert.match(cancelled.results[0]?.reason, /cancelled/i);
});
