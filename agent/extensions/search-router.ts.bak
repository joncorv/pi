import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type SearchRoute = "quick" | "deep";

type SearchInput = {
	query?: unknown;
	queries?: unknown;
	numResults?: unknown;
	includeContent?: unknown;
	fetchContent?: unknown;
	provider?: unknown;
	workflow?: unknown;
};

type UserRequest = {
	id: string;
	text: string;
};

const QUICK_OPTION = "Quick search — DuckDuckGo";
const DEEP_OPTION = "Deep dive — OpenAI Search";
const CANCEL_OPTION = "Cancel search";

const QUICK_PATTERNS = [
	/\bquick search\b/i,
	/\bquick lookup\b/i,
	/\bduckduckgo\b/i,
	/\bddg\b/i,
];

const DEEP_PATTERNS = [
	/\bdeep dive\b/i,
	/\bdeep research\b/i,
	/\bopenai(?:\s+web)?\s+search\b/i,
];

function explicitRoute(text: string): SearchRoute | undefined {
	const quick = QUICK_PATTERNS.some((pattern) => pattern.test(text));
	const deep = DEEP_PATTERNS.some((pattern) => pattern.test(text));
	return quick === deep ? undefined : quick ? "quick" : "deep";
}

function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => (
			Boolean(part) &&
			typeof part === "object" &&
			(part as { type?: unknown }).type === "text" &&
			typeof (part as { text?: unknown }).text === "string"
		))
		.map((part) => part.text)
		.join("\n");
}

function latestUserRequest(ctx: ExtensionContext): UserRequest | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry.type !== "message" || entry.message.role !== "user") continue;
		return { id: entry.id, text: messageText(entry.message.content) };
	}
	return undefined;
}

function boundedResults(value: unknown, fallback: number, minimum: number, maximum: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function firstQuery(input: SearchInput): string | undefined {
	if (typeof input.query === "string" && input.query.trim()) return input.query;
	if (!Array.isArray(input.queries)) return undefined;
	return input.queries.find((query): query is string => typeof query === "string" && Boolean(query.trim()));
}

function applyWebSearchRoute(input: SearchInput, route: SearchRoute): void {
	input.provider = route === "quick" ? "duckduckgo" : "openai";
	// Both routes skip the browser curator. OpenAI Search already returns a cited
	// synthesis, while DuckDuckGo is intended to remain a low-latency lookup.
	input.workflow = "none";

	if (route === "quick") {
		const query = firstQuery(input);
		if (query) {
			input.query = query;
			delete input.queries;
		}
		input.numResults = boundedResults(input.numResults, 5, 1, 5);
		input.includeContent = false;
		return;
	}

	input.numResults = boundedResults(input.numResults, 8, 8, 20);
	input.includeContent = true;
}

function applySourceCheckRoute(input: SearchInput, route: SearchRoute): void {
	input.provider = route === "quick" ? "duckduckgo" : "openai";
	if (route === "quick") {
		input.numResults = boundedResults(input.numResults, 5, 1, 5);
		input.fetchContent = false;
	} else {
		input.numResults = boundedResults(input.numResults, 8, 8, 20);
		input.fetchContent = true;
	}
}

function discoverSearchToolNames(pi: ExtensionAPI): {
	webSearch: Set<string>;
	sourceCheck: Set<string>;
} {
	const webSearch = new Set(["web_search"]);
	const sourceCheck = new Set(["source_check"]);

	for (const tool of pi.getAllTools()) {
		if (tool.description.startsWith("Search the web using ")) webSearch.add(tool.name);
		if (tool.description.startsWith("Check a claim against web sources")) sourceCheck.add(tool.name);
	}
	return { webSearch, sourceCheck };
}

export default function (pi: ExtensionAPI) {
	let decisions = new Map<string, SearchRoute>();
	let searchToolNames = discoverSearchToolNames(pi);

	pi.on("session_start", () => {
		decisions = new Map();
		searchToolNames = discoverSearchToolNames(pi);
	});

	pi.on("session_tree", () => {
		// Entry IDs are branch-specific. Forget interactive choices after tree
		// navigation so a newly selected branch cannot inherit an unrelated route.
		decisions = new Map();
	});

	pi.on("before_agent_start", (event) => {
		const route = explicitRoute(event.prompt);
		if (!route) return;

		const guidance = route === "quick"
			? "Search routing for this request is QUICK. If web access is needed, use one focused search query and keep the lookup lightweight. The search router will enforce DuckDuckGo."
			: "Search routing for this request is DEEP. For web research, prefer 2-4 genuinely varied queries, inspect full-page content when useful, and verify consequential claims. The search router will enforce OpenAI Search.";
		return { systemPrompt: `${event.systemPrompt}\n\n${guidance}` };
	});

	pi.on("tool_call", async (event, ctx) => {
		const isWebSearch = searchToolNames.webSearch.has(event.toolName);
		const isSourceCheck = searchToolNames.sourceCheck.has(event.toolName);
		if (!isWebSearch && !isSourceCheck) return;

		const request = latestUserRequest(ctx);
		let route = request ? explicitRoute(request.text) ?? decisions.get(request.id) : undefined;

		if (!route) {
			if (!ctx.hasUI) {
				return {
					block: true,
					reason: "Search depth is ambiguous and this mode cannot ask interactively. Retry with ‘quick search’ for DuckDuckGo or ‘deep dive’ for OpenAI Search.",
				};
			}

			const selection = await ctx.ui.select(
				"Is this a quick search or a deep dive?",
				[QUICK_OPTION, DEEP_OPTION, CANCEL_OPTION],
			);
			if (!selection || selection === CANCEL_OPTION) {
				return { block: true, reason: "Web search cancelled by the user." };
			}
			route = selection === QUICK_OPTION ? "quick" : "deep";
			if (request) decisions.set(request.id, route);
		}

		const input = event.input as SearchInput;
		if (isWebSearch) applyWebSearchRoute(input, route);
		else applySourceCheckRoute(input, route);
	});
}
