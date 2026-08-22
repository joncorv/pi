import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type ResearchRoute = "quick" | "deep" | "scrape";
type RouteResolution = ResearchRoute | "cancelled" | undefined;

type SearchInput = {
	query?: unknown;
	queries?: unknown;
	numResults?: unknown;
	includeContent?: unknown;
	fetchContent?: unknown;
	provider?: unknown;
	workflow?: unknown;
};

type UserRequest = { id: string; text: string; index: number };

const NETWORK_TOOLS = new Set(["web_search", "source_check", "fetch_content"]);
const QUICK_PATTERNS = [
	/\bquick(?:\s+(?:web\s+)?(?:search|lookup))?\b/i,
	/\blightweight\s+(?:search|lookup)\b/i,
	/\bjust\s+(?:find|look\s+up)\b/i,
];
const DEEP_PATTERNS = [
	/\bdeep(?:\s+(?:search|research|dive))?\b/i,
	/\bin[- ]depth\b/i,
	/\bcomprehensive\s+(?:research|report|comparison|review)\b/i,
	/\bexhaustive\b/i,
	/\bmulti[- ]source\b/i,
	/\bcited\s+(?:research|report|analysis)\b/i,
];
const SCRAPE_PATTERNS = [
	/\bweb\s*scrap(?:e|ing)\b/i,
	/\bscrap(?:e|ing)\s+(?:this|the|a|these)?\s*(?:url|page|site|website)?\b/i,
	/\bcrawl(?:ing)?\s+(?:this|the|a|these)?\s*(?:site|website|docs?|domain)?\b/i,
	/\bmap\s+(?:this|the|a)?\s*(?:site|website|domain)\b/i,
];
const URL_PATTERN = /https?:\/\/[^\s)>\]}]+/i;
const URL_EXTRACTION_PATTERN = /\b(?:read|fetch|extract|summari[sz]e|inspect|analy[sz]e)\b/i;

function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } =>
			Boolean(part) &&
			typeof part === "object" &&
			(part as { type?: unknown }).type === "text" &&
			typeof (part as { text?: unknown }).text === "string",
		)
		.map((part) => part.text)
		.join("\n");
}

export function explicitRoute(text: string): ResearchRoute | undefined {
	const quick = QUICK_PATTERNS.some((pattern) => pattern.test(text));
	const deep = DEEP_PATTERNS.some((pattern) => pattern.test(text));
	const scrape = SCRAPE_PATTERNS.some((pattern) => pattern.test(text));

	if (quick && (deep || scrape)) return undefined;
	if (deep) return "deep";
	if (scrape) return "scrape";
	if (quick) return "quick";
	if (URL_PATTERN.test(text) && URL_EXTRACTION_PATTERN.test(text)) return "scrape";
	return undefined;
}

function latestUserRequest(ctx: ExtensionContext): UserRequest | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index] as {
			type?: string;
			id?: string;
			message?: { role?: string; content?: unknown };
		};
		if (entry.type !== "message" || entry.message?.role !== "user" || !entry.id) continue;
		return { id: entry.id, text: messageText(entry.message.content), index };
	}
	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function questionnaireRoute(ctx: ExtensionContext, request: UserRequest): RouteResolution {
	const branch = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index > request.index; index--) {
		const entry = branch[index] as { type?: string; message?: unknown };
		if (entry.type !== "message" || !isRecord(entry.message)) continue;
		const message = entry.message;
		if (message.role !== "toolResult" || message.toolName !== "questionnaire") continue;
		if (!isRecord(message.details)) continue;
		if (message.details.cancelled === true) return "cancelled";
		if (!Array.isArray(message.details.answers)) continue;
		for (const answer of message.details.answers) {
			if (!isRecord(answer) || answer.id !== "research_mode") continue;
			if (answer.value === "quick" || answer.value === "deep" || answer.value === "scrape") {
				return answer.value;
			}
			if (answer.value === "cancel") return "cancelled";
		}
	}
	return undefined;
}

function resolveRoute(ctx: ExtensionContext): { request?: UserRequest; route: RouteResolution } {
	const request = latestUserRequest(ctx);
	if (!request) return { route: undefined };
	return { request, route: explicitRoute(request.text) ?? questionnaireRoute(ctx, request) };
}

function boundedResults(value: unknown, fallback: number, minimum: number, maximum: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function firstQuery(input: SearchInput): string | undefined {
	if (typeof input.query === "string" && input.query.trim()) return input.query;
	if (!Array.isArray(input.queries)) return undefined;
	return input.queries.find(
		(query): query is string => typeof query === "string" && Boolean(query.trim()),
	);
}

export function applyQuickRoute(toolName: string, input: SearchInput): void {
	if (toolName === "web_search") {
		const query = firstQuery(input);
		if (query) {
			input.query = query;
			delete input.queries;
		}
		input.numResults = boundedResults(input.numResults, 5, 1, 5);
		input.includeContent = false;
		input.workflow = "none";
		delete input.provider;
	}
	if (toolName === "source_check") {
		input.numResults = boundedResults(input.numResults, 5, 1, 5);
		input.fetchContent = false;
		delete input.provider;
	}
}

export function applyDeepRoute(toolName: string, input: SearchInput): void {
	if (toolName === "web_search") {
		input.numResults = boundedResults(input.numResults, 10, 8, 20);
		input.includeContent = true;
		input.workflow = "none";
		input.provider = "firecrawl";
	}
	if (toolName === "source_check") {
		input.numResults = boundedResults(input.numResults, 10, 8, 20);
		input.fetchContent = true;
		input.provider = "firecrawl";
	}
}

export function applyScrapeRoute(toolName: string, input: SearchInput): void {
	if (toolName === "web_search") {
		input.numResults = boundedResults(input.numResults, 8, 1, 12);
		input.includeContent = true;
		input.workflow = "none";
		input.provider = "firecrawl";
	}
}

function isNetworkTool(toolName: string): boolean {
	return NETWORK_TOOLS.has(toolName) || toolName.startsWith("firecrawl_");
}

function routeGuidance(route: RouteResolution): string {
	if (route === "quick") {
		return "Research route: QUICK. Use one focused web_search query, at most five results, and avoid full-page retrieval unless the user explicitly asks for it.";
	}
	if (route === "deep") {
		return "Research route: DEEP. Use 2-4 genuinely varied searches, inspect full source content, verify consequential claims, preserve URLs, and produce a cited synthesis. Use bounded Firecrawl map/crawl operations only when site-wide acquisition is useful.";
	}
	if (route === "scrape") {
		return "Research route: SCRAPE. Prefer fetch_content for a simple known page. Use firecrawl_load and the dedicated scrape/map/crawl capabilities for blocked, dynamic, structured, or site-wide targets. Do not broaden into general search unless discovery is required.";
	}
	return `Research route is ambiguous. If web access is needed, call questionnaire before any network tool, and do not place the questionnaire and network calls in the same parallel batch. Ask exactly:
{
  "questions": [{
    "id": "research_mode",
    "label": "Research mode",
    "prompt": "How should I approach this web task?",
    "options": [
      { "value": "quick", "label": "Quick lookup", "description": "Fast; one focused query, a few results, and minimal retrieval." },
      { "value": "deep", "label": "Deep research", "description": "Slower; multiple searches, full sources, verification, and citations. May use Firecrawl credits." },
      { "value": "scrape", "label": "Web scrape or crawl", "description": "Fetch known pages or crawl a specified site. May use Firecrawl credits." },
      { "value": "cancel", "label": "Cancel", "description": "Make no network request." }
    ],
    "allowOther": false
  }]
}`;
}

export default function researchRouter(pi: ExtensionAPI) {
	pi.on("before_agent_start", (event, ctx) => {
		const request = latestUserRequest(ctx);
		const route = request ? explicitRoute(request.text) ?? questionnaireRoute(ctx, request) : undefined;
		return { systemPrompt: `${event.systemPrompt}\n\n${routeGuidance(route)}` };
	});

	pi.on("tool_call", (event, ctx) => {
		if (!isNetworkTool(event.toolName)) return;
		const { route } = resolveRoute(ctx);
		if (route === "cancelled") {
			return { block: true, reason: "The user cancelled web research for this request." };
		}
		if (!route) {
			return {
				block: true,
				reason:
					"Research mode is ambiguous. Ask the research_mode questionnaire, wait for its result, then retry this network call in the next turn.",
			};
		}

		const input = event.input as SearchInput;
		if (route === "quick") applyQuickRoute(event.toolName, input);
		if (route === "deep") applyDeepRoute(event.toolName, input);
		if (route === "scrape") applyScrapeRoute(event.toolName, input);
	});

	pi.registerCommand("research-status", {
		description: "Show research routing and Firecrawl readiness without exposing credentials",
		handler: async (_args, ctx) => {
			const keyPresent = Boolean(process.env.FIRECRAWL_API_KEY?.trim());
			const firecrawlTools = pi.getAllTools().filter((tool) => tool.name.startsWith("firecrawl_"));
			const activeFirecrawlTools = new Set(pi.getActiveTools());
			const activeCount = firecrawlTools.filter((tool) => activeFirecrawlTools.has(tool.name)).length;
			const message = [
				`Firecrawl API key: ${keyPresent ? "present" : "missing"}`,
				"Firecrawl search API: v2 via pi-web-access",
				`Dedicated Firecrawl tools: ${firecrawlTools.length} registered, ${activeCount} active`,
				keyPresent
					? "Research routing is ready."
					: "Check ~/.pi/agent/.env and restart Pi normally so the credential loader can import it.",
			].join("\n");
			ctx.ui.notify(message, keyPresent ? "info" : "warning");
		},
	});
}
