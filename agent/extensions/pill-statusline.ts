import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type ThemeBg = Parameters<Theme["getBgAnsi"]>[0];
type FileAction = "read" | "edit" | "write";
type Activity = "idle" | "working" | "retrying" | "compacting";

type GitInfo = {
	branch: string;
	staged: number;
	modified: number;
	untracked: number;
	conflicts: number;
	ahead: number;
	behind: number;
} | null;

type UsageTotals = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
};

type Pill = {
	body: string;
	background: ThemeBg;
};

const RESET = "\x1b[0m";
const FILE_TOOLS = new Set(["read", "edit", "write"]);

function backgroundAsForeground(theme: Theme, background: ThemeBg): string {
	return theme
		.getBgAnsi(background)
		.replace(/\[(4[08])(?=;)/, (_match, code: string) => `[${code === "48" ? "38" : "30"}`);
}

function text(theme: Theme, color: ThemeColor, value: string, bold = false): string {
	// Use a selective bold reset. Chalk's full reset can clear the pill background,
	// making content after a bold segment (such as “+16 files”) appear unfilled.
	const styled = bold ? `\x1b[1m${value}\x1b[22m` : value;
	return theme.fg(color, styled);
}

function divider(theme: Theme): string {
	return theme.fg("borderMuted", " │ ");
}

function renderPill(theme: Theme, pill: Pill): string {
	const cap = backgroundAsForeground(theme, pill.background);
	return `${cap}${RESET}${theme.getBgAnsi(pill.background)} ${pill.body} ${RESET}${cap}${RESET}`;
}

function joinPills(theme: Theme, pills: Pill[]): string {
	return pills.map((pill) => renderPill(theme, pill)).join(" ");
}

function truncatePlain(value: string, maxWidth: number, ellipsis = "..."): string {
	if (visibleWidth(value) <= maxWidth) return value;
	const available = Math.max(0, maxWidth - visibleWidth(ellipsis));
	let result = "";
	for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)) {
		if (visibleWidth(result + segment) > available) break;
		result += segment;
	}
	return result + ellipsis;
}

function compactNumber(value: number): string {
	if (value < 1_000) return `${Math.round(value)}`;
	if (value < 10_000) return `${(value / 1_000).toFixed(1)}k`;
	if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
	if (value < 10_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	return `${Math.round(value / 1_000_000)}M`;
}

function shortModelId(modelId: string): string {
	return modelId
		.replace(/^claude-/, "")
		.replace(/-\d{8}$/, "")
		.replace(/^gpt-/, "gpt-");
}

function fileIcon(path: string, action: FileAction): string {
	if (action === "edit" || action === "write") return "";
	switch (extname(path).toLowerCase()) {
		case ".ts":
		case ".tsx":
		case ".js":
		case ".jsx": return "";
		case ".json": return "";
		case ".md": return "";
		case ".py": return "";
		case ".rs": return "";
		case ".go": return "";
		case ".lua": return "";
		default: return "󰈔";
	}
}

function displayPath(cwd: string, inputPath: string): string {
	const cleaned = inputPath.replace(/^@/, "");
	const absolute = isAbsolute(cleaned) ? cleaned : resolve(cwd, cleaned);
	const rel = relative(cwd, absolute);
	return rel && !rel.startsWith("..") ? rel : cleaned;
}

function addUsage(totals: UsageTotals, usage: Usage): void {
	totals.input += usage.input ?? 0;
	totals.output += usage.output ?? 0;
	totals.cacheRead += usage.cacheRead ?? 0;
	totals.cacheWrite += usage.cacheWrite ?? 0;
	totals.cost += usage.cost?.total ?? 0;
}

function sessionUsage(ctx: ExtensionContext): UsageTotals {
	const totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			addUsage(totals, (entry.message as AssistantMessage).usage);
		} else if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.usage) {
			addUsage(totals, entry.message.usage);
		} else if ((entry.type === "compaction" || entry.type === "branch_summary") && entry.usage) {
			addUsage(totals, entry.usage);
		}
	}
	return totals;
}

function parseGitStatus(output: string): GitInfo {
	const lines = output.trimEnd().split("\n");
	const header = lines.shift();
	if (!header?.startsWith("## ")) return null;
	const headerBody = header.slice(3);
	const branch = headerBody
		.replace(/^No commits yet on /, "")
		.replace(/^Initial commit on /, "")
		.split("...")[0]
		.split(" [")[0]
		.trim() || "HEAD";
	const ahead = Number(headerBody.match(/ahead (\d+)/)?.[1] ?? 0);
	const behind = Number(headerBody.match(/behind (\d+)/)?.[1] ?? 0);
	let staged = 0;
	let modified = 0;
	let untracked = 0;
	let conflicts = 0;
	const conflictStates = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

	for (const line of lines) {
		if (!line) continue;
		const state = line.slice(0, 2);
		if (state === "??") {
			untracked++;
		} else if (conflictStates.has(state)) {
			conflicts++;
		} else {
			if (state[0] !== " ") staged++;
			if (state[1] !== " ") modified++;
		}
	}
	return { branch, staged, modified, untracked, conflicts, ahead, behind };
}

function gitBackground(git: GitInfo): ThemeBg {
	if (git?.conflicts) return "toolErrorBg";
	if (git && git.staged + git.modified + git.untracked > 0) return "toolPendingBg";
	return "toolSuccessBg";
}

function contextBackground(percent: number | null): ThemeBg {
	if (percent !== null && percent > 90) return "toolErrorBg";
	if (percent !== null && percent > 70) return "toolPendingBg";
	return "toolSuccessBg";
}

function activityLabel(activity: Activity, activeTool?: string): { icon: string; label: string; color: ThemeColor; bg: ThemeBg } {
	if (activity === "compacting") return { icon: "󰆼", label: "COMPACT", color: "warning", bg: "toolPendingBg" };
	if (activity === "retrying") return { icon: "󰑓", label: "RETRY", color: "warning", bg: "toolPendingBg" };
	if (activity === "working") {
		return activeTool
			? { icon: "󰔟", label: activeTool.toUpperCase(), color: "accent", bg: "toolPendingBg" }
			: { icon: "󰔟", label: "WORKING", color: "accent", bg: "toolPendingBg" };
	}
	return { icon: "●", label: "IDLE", color: "success", bg: "selectedBg" };
}

export default function (pi: ExtensionAPI) {
	let enabled = true;
	let activeCtx: ExtensionContext | undefined;
	let requestRender: (() => void) | undefined;
	let git: GitInfo = null;
	let activity: Activity = "idle";
	let activeTool: string | undefined;
	let latestFile: string | undefined;
	let latestFileAction: FileAction = "read";
	let sessionFiles = new Set<string>();
	let runFiles = new Set<string>();
	let gitRefreshRunning = false;
	let gitRefreshQueued = false;
	let delayedGitRefresh: ReturnType<typeof setTimeout> | undefined;

	function redraw(): void {
		try {
			requestRender?.();
		} catch {
			// The footer may have been replaced or disposed between events.
		}
	}

	function trackFile(ctx: ExtensionContext, path: string, action: FileAction): void {
		const shown = displayPath(ctx.cwd, path);
		latestFile = shown;
		latestFileAction = action;
		sessionFiles.add(shown);
		runFiles.add(shown);
		redraw();
	}

	function restoreFiles(ctx: ExtensionContext): void {
		sessionFiles = new Set();
		runFiles = new Set();
		latestFile = undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "message" && entry.message.role === "assistant") {
				for (const part of entry.message.content) {
					if (part.type !== "toolCall" || !FILE_TOOLS.has(part.name)) continue;
					const args = part.arguments as { path?: unknown };
					if (typeof args.path === "string") {
						trackFile(ctx, args.path, part.name as FileAction);
					}
				}
			} else if (entry.type === "compaction" || entry.type === "branch_summary") {
				const details = entry.details as { readFiles?: unknown; modifiedFiles?: unknown } | undefined;
				for (const path of Array.isArray(details?.readFiles) ? details.readFiles : []) {
					if (typeof path === "string") trackFile(ctx, path, "read");
				}
				for (const path of Array.isArray(details?.modifiedFiles) ? details.modifiedFiles : []) {
					if (typeof path === "string") trackFile(ctx, path, "edit");
				}
			}
		}
		runFiles = new Set();
	}

	async function refreshGit(): Promise<void> {
		const ctx = activeCtx;
		if (!ctx) return;
		if (gitRefreshRunning) {
			gitRefreshQueued = true;
			return;
		}
		gitRefreshRunning = true;
		try {
			const result = await pi.exec(
				"git",
				["status", "--porcelain=v1", "--branch", "--untracked-files=normal"],
				{ cwd: ctx.cwd, timeout: 2000 },
			);
			git = result.code === 0 ? parseGitStatus(result.stdout) : null;
		} catch {
			git = null;
		} finally {
			gitRefreshRunning = false;
			redraw();
			if (gitRefreshQueued) {
				gitRefreshQueued = false;
				void refreshGit();
			}
		}
	}

	function buildPills(
		ctx: ExtensionContext,
		theme: Theme,
		detail: "full" | "medium" | "compact" | "minimal",
		planStatus?: string,
	) {
		const state = activityLabel(activity, activeTool);
		const context = ctx.getContextUsage();
		const contextWindow = context?.contextWindow ?? ctx.model?.contextWindow ?? 0;
		const contextPercent = context?.percent ?? null;
		const usage = sessionUsage(ctx);
		const project = basename(ctx.cwd) || ctx.cwd;
		const branch = git?.branch ?? "no git";
		const model = shortModelId(ctx.model?.id ?? "no model");
		const thinking = ctx.thinkingLevel;
		const file = latestFile ?? "no files yet";
		const fileCount = runFiles.size > 0 ? runFiles.size : sessionFiles.size;

		const modePill: Pill = {
			background: state.bg,
			body: text(theme, state.color, `${state.icon} ${state.label}`, true),
		};
		const planPill: Pill | undefined = planStatus
			? { background: "toolPendingBg", body: planStatus }
			: undefined;
		const workspacePill: Pill = {
			background: "customMessageBg",
			body: text(theme, "accent", "") + " " + text(theme, "text", truncatePlain(project, 18), true),
		};
		const gitParts = [text(theme, "accent", ""), text(theme, "text", truncatePlain(branch, detail === "full" ? 28 : 16), true)];
		if (git) {
			if (git.staged) gitParts.push(text(theme, "success", `+${git.staged}`));
			if (git.modified) gitParts.push(text(theme, "warning", `~${git.modified}`));
			if (git.untracked) gitParts.push(text(theme, "accent", `?${git.untracked}`));
			if (git.conflicts) gitParts.push(text(theme, "error", `!${git.conflicts}`, true));
			if (detail === "full" && (git.ahead || git.behind)) {
				gitParts.push(text(theme, "muted", `${git.ahead ? `⇡${git.ahead}` : ""}${git.ahead && git.behind ? " " : ""}${git.behind ? `⇣${git.behind}` : ""}`));
			}
		}
		const gitPill: Pill = { background: gitBackground(git), body: gitParts.join(" ") };
		const fileLabel = detail === "full" || detail === "medium" ? truncatePlain(file, 30) : basename(file);
		const filesPill: Pill = {
			background: "userMessageBg",
			body:
				text(theme, "accent", fileIcon(file, latestFileAction)) +
				" " +
				text(theme, "text", fileLabel, true) +
				(detail !== "minimal" && fileCount > 1 ? divider(theme) + text(theme, "muted", `+${fileCount - 1} files`) : ""),
		};
		const modelPill: Pill = {
			background: "customMessageBg",
			body:
				text(theme, "accent", "󰚩") +
				" " +
				text(theme, "text", truncatePlain(model, detail === "full" ? 24 : 15), true) +
				(detail === "full" || detail === "medium" ? divider(theme) + text(theme, `thinking${thinking[0].toUpperCase()}${thinking.slice(1)}` as ThemeColor, ` ${thinking}`) : ""),
		};
		const contextValue = context?.tokens === undefined
			? "ctx ?"
			: detail === "full" || detail === "medium"
				? `${compactNumber(context.tokens)}/${compactNumber(contextWindow)} ${contextPercent === null ? "?" : `${Math.round(contextPercent)}%`}`
				: `ctx ${contextPercent === null ? "?" : `${Math.round(contextPercent)}%`}`;
		const contextColor: ThemeColor = contextPercent !== null && contextPercent > 90
			? "error"
			: contextPercent !== null && contextPercent > 70 ? "warning" : "success";
		const contextPill: Pill = {
			background: contextBackground(contextPercent),
			body: text(theme, contextColor, `󰍛 ${contextValue}`, true),
		};
		const usageParts = [
			text(theme, "success", `↑${compactNumber(usage.input)}`),
			text(theme, "accent", `↓${compactNumber(usage.output)}`),
		];
		if (detail === "full" && usage.cacheRead) usageParts.push(text(theme, "muted", `R${compactNumber(usage.cacheRead)}`));
		if (detail === "full" && usage.cacheWrite) usageParts.push(text(theme, "muted", `W${compactNumber(usage.cacheWrite)}`));
		if (detail !== "compact" && detail !== "minimal") usageParts.push(text(theme, "warning", `$${usage.cost.toFixed(3)}`));
		const usagePill: Pill = { background: "selectedBg", body: usageParts.join(" ") };

		const planPills = planPill ? [planPill] : [];
		if (detail === "full") {
			return {
				left: [modePill, ...planPills, workspacePill, gitPill, filesPill],
				right: [modelPill, contextPill, usagePill],
			};
		}
		if (detail === "medium") {
			return {
				left: [modePill, ...planPills, gitPill, filesPill],
				right: [modelPill, contextPill, usagePill],
			};
		}
		if (detail === "compact") {
			return { left: [...planPills, gitPill, filesPill], right: [modelPill, contextPill] };
		}
		return { left: [...planPills, filesPill], right: [contextPill] };
	}

	function renderStatusline(ctx: ExtensionContext, theme: Theme, width: number, planStatus?: string): string {
		for (const detail of ["full", "medium", "compact", "minimal"] as const) {
			const pills = buildPills(ctx, theme, detail, planStatus);
			const left = joinPills(theme, pills.left);
			const right = joinPills(theme, pills.right);
			const used = visibleWidth(left) + visibleWidth(right);
			if (used + 1 <= width) return left + " ".repeat(width - used) + right;
		}
		const context = ctx.getContextUsage();
		const contextText = `ctx ${context?.percent === null || context?.percent === undefined ? "?" : `${Math.round(context.percent)}%`}`;
		return truncateToWidth(planStatus ? `${planStatus} ${contextText}` : contextText, width, "");
	}

	function install(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui") return;
		activeCtx = ctx;
		ctx.ui.setFooter((tui, theme, footerData) => {
			requestRender = () => tui.requestRender();
			const unsubscribe = footerData.onBranchChange(() => void refreshGit());
			return {
				invalidate() {},
				render: (width: number) => [
					renderStatusline(ctx, theme, width, footerData.getExtensionStatuses().get("plan-mode")),
				],
				dispose() {
					unsubscribe();
					requestRender = undefined;
				},
			};
		});
	}

	pi.on("session_start", (_event, ctx) => {
		activeCtx = ctx;
		restoreFiles(ctx);
		if (enabled) install(ctx);
		void refreshGit();
	});

	pi.on("agent_start", () => {
		activity = "working";
		activeTool = undefined;
		runFiles = new Set();
		redraw();
	});

	pi.on("agent_settled", () => {
		activity = "idle";
		activeTool = undefined;
		redraw();
		void refreshGit();
	});

	pi.on("session_before_compact", () => {
		activity = "compacting";
		redraw();
	});

	pi.on("session_compact", () => {
		activity = "working";
		redraw();
	});

	pi.on("tool_execution_start", (event) => {
		activeTool = event.toolName;
		redraw();
	});

	pi.on("tool_execution_end", (event) => {
		if (activeTool === event.toolName) activeTool = undefined;
		redraw();
		if (event.toolName === "bash" || event.toolName === "edit" || event.toolName === "write") void refreshGit();
	});

	pi.on("tool_call", (event, ctx) => {
		if (!FILE_TOOLS.has(event.toolName)) return;
		const input = event.input as { path?: unknown };
		if (typeof input.path === "string") trackFile(ctx, input.path, event.toolName as FileAction);
	});

	pi.on("message_end", () => redraw());
	pi.on("model_select", () => redraw());
	pi.on("thinking_level_select", () => redraw());

	pi.on("user_bash", () => {
		if (delayedGitRefresh) clearTimeout(delayedGitRefresh);
		delayedGitRefresh = setTimeout(() => void refreshGit(), 500);
	});

	pi.on("session_shutdown", () => {
		if (delayedGitRefresh) clearTimeout(delayedGitRefresh);
		delayedGitRefresh = undefined;
		activeCtx = undefined;
		requestRender = undefined;
	});

	pi.registerCommand("statusline", {
		description: "Toggle the pill statusline",
		getArgumentCompletions: (prefix) => {
			const options = ["on", "off"];
			const matches = options.filter((option) => option.startsWith(prefix.trim().toLowerCase()));
			return matches.length ? matches.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const option = args.trim().toLowerCase();
			if (option === "off" || (!option && enabled)) {
				enabled = false;
				ctx.ui.setFooter(undefined);
				ctx.ui.notify("Pill statusline disabled", "info");
				return;
			}
			if (option === "on" || !option) {
				enabled = true;
				install(ctx);
				void refreshGit();
				ctx.ui.notify("Pill statusline enabled", "info");
				return;
			}
			ctx.ui.notify(`Unknown statusline option: ${option}`, "warning");
		},
	});
}
