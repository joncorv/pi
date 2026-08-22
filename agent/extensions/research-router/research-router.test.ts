import assert from "node:assert/strict";
import test from "node:test";
import researchRouter, {
	applyDeepRoute,
	applyQuickRoute,
	applyScrapeRoute,
	explicitRoute,
} from "./index.ts";

test("classifies explicit quick, deep, and scrape requests", () => {
	assert.equal(explicitRoute("Do a quick lookup for the latest Pi release"), "quick");
	assert.equal(explicitRoute("Create a deep multi-source report"), "deep");
	assert.equal(explicitRoute("Scrape this URL https://example.com"), "scrape");
	assert.equal(explicitRoute("Summarize https://example.com"), "scrape");
	assert.equal(explicitRoute("Look online and tell me what you find"), undefined);
	assert.equal(explicitRoute("Do a quick but exhaustive search"), undefined);
});

test("applies bounded route-specific search settings", () => {
	const quick: Record<string, unknown> = { queries: ["one", "two"], numResults: 99, includeContent: true };
	applyQuickRoute("web_search", quick);
	assert.deepEqual(quick, {
		query: "one",
		numResults: 5,
		includeContent: false,
		workflow: "none",
	});

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

	const answered = await router.toolCall("Look online and find the best option", "web_search", [
		{ id: "research_mode", value: "deep", label: "Deep research", wasCustom: false },
	]);
	assert.equal(answered.results[0], undefined);
	assert.equal(answered.event.input.provider, "firecrawl");
	assert.equal(answered.event.input.includeContent, true);

	const cancelled = await router.toolCall("Look online and find the best option", "web_search", [], true);
	assert.equal(cancelled.results[0]?.block, true);
	assert.match(cancelled.results[0]?.reason, /cancelled/i);
});
