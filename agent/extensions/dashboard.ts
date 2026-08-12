/**
 * Startup Dashboard
 *
 * Replaces the built-in startup header with a rich dashboard. The dashboard
 * renders as pi's header, so pi's own loaded-resources / diagnostics band
 * appears directly beneath it. Auto-dismisses on your first input.
 *
 * Pair with `"quietStartup": true` in settings.json to suppress pi's built-in
 * [Extensions] / [Themes] listings at the top (diagnostics still render).
 *
 *
 *   /dashboard        Toggle / re-show the dashboard
 *   /dashboard off    Hide it
 *   /dashboard on     Show it
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { SessionManager, VERSION } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// ── data helpers ────────────────────────────────────────────────────────────

type GitInfo = { branch: string; dirty: boolean } | null;

function getGitInfo(cwd: string): GitInfo {
	try {
		const branch = execSync("git rev-parse --abbrev-ref HEAD", {
			cwd,
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 500,
		})
			.toString()
			.trim();
		if (!branch) return null;
		const status = execSync("git status --porcelain", {
			cwd,
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 500,
		}).toString();
		return { branch, dirty: status.trim().length > 0 };
	} catch {
		return null;
	}
}

function greeting(): string {
	const h = new Date().getHours();
	if (h < 5) return "Burning the midnight oil";
	if (h < 12) return "Good morning";
	if (h < 18) return "Good afternoon";
	if (h < 22) return "Good evening";
	return "Working late";
}

function relativeTime(ts: number): string {
	const diff = Math.max(0, Date.now() - ts);
	const m = Math.floor(diff / 60_000);
	if (m < 1) return "just now";
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.floor(h / 24);
	if (d < 30) return `${d}d ago`;
	const mo = Math.floor(d / 30);
	if (mo < 12) return `${mo}mo ago`;
	return `${Math.floor(mo / 12)}y ago`;
}

const TIPS = [
	"Type @ in the editor to fuzzy-search project files.",
	"Prefix a line with ! to run bash and send output to the LLM (!! runs silently).",
	"Enter queues a steering message; Alt+Enter queues a follow-up.",
	"/fork branches from a past message; /clone duplicates the current branch.",
	"Drop images onto the terminal or paste with Ctrl+V.",
	"Write reusable prompts in ~/.pi/agent/prompts/name.md and call /name.",
	"pi is aggressively extensible — ask it to build the tool you wish existed.",
];

function tipOfTheMoment(): string {
	const bucket = Math.floor(Date.now() / (10 * 60_000));
	return TIPS[bucket % TIPS.length];
}

/** Read simple names from an extensions directory (files + subdirs). */
function listExtensions(): string[] {
	const roots = [join(homedir(), ".pi", "agent", "extensions"), join(process.cwd(), ".pi", "extensions")];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const root of roots) {
		if (!existsSync(root)) continue;
		let entries: string[] = [];
		try {
			entries = readdirSync(root);
		} catch {
			continue;
		}
		for (const e of entries) {
			if (e.startsWith(".")) continue;
			let name = e;
			if (e.endsWith(".ts") || e.endsWith(".js") || e.endsWith(".mjs")) {
				name = e.replace(/\.(ts|js|mjs)$/, "");
			} else {
				try {
					if (!statSync(join(root, e)).isDirectory()) continue;
				} catch {
					continue;
				}
			}
			if (seen.has(name)) continue;
			seen.add(name);
			out.push(name);
		}
	}
	return out.sort();
}

function listThemes(): string[] {
	const builtin = ["dark", "light"];
	const roots = [join(homedir(), ".pi", "agent", "themes"), join(process.cwd(), ".pi", "themes")];
	const seen = new Set<string>(builtin);
	const custom: string[] = [];
	for (const root of roots) {
		if (!existsSync(root)) continue;
		let entries: string[] = [];
		try {
			entries = readdirSync(root);
		} catch {
			continue;
		}
		for (const e of entries) {
			if (e.startsWith(".")) continue;
			const name = e.replace(/\.(ts|js|mjs|json)$/, "");
			if (seen.has(name)) continue;
			seen.add(name);
			custom.push(name);
		}
	}
	return [...custom.sort(), ...builtin];
}

// ── art ─────────────────────────────────────────────────────────────────────

const BANNER = [
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⡤⠶⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⠶⣦⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣿⡟⠀⠈⣀⣾⣝⣯⣿⣛⣷⣦⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⢿⣿⣦⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣴⣿⣿⣿⡇⠀⢼⣿⣽⣿⢻⣿⣻⣿⣟⣷⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣾⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣞⣿⣿⣿⣿⣿⣷⣤⣸⣟⣿⣿⣻⣯⣿⣿⣿⣿⣀⣴⣿⣿⣿⣿⣷⣤⣸⣟⣿⣿⣻⣯⣿⣿⣿⣿⣯⣆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡼⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣜⡆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⣟⣯⣿⣿⣿⣷⢿⣫⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣬⣟⠿⣿⣿⣿⣷⢿⣫⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣬⣟⠿⣿⣿⣿⣿⡷⣾⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣯⣿⣿⡏⠙⡇⣾⣟⣿⡿⢿⣿⣿⣿⣿⣿⢿⣟⡿⣿⠀⡟⠉⢹⣿⣿⡏⠙⡇⣾⣟⣿⡿⢿⣿⣿⣿⣿⣿⢿⣟⡿⣿⠀⡟⠉⢹⣿⣿⢿⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣯⡿⢿⠀⠀⠱⢈⣿⢿⣿⡿⣏⣿⣿⣿⣿⣿⣿⣿⣿⣀⠃⠀⢸⡿⢿⠀⠀⠱⢈⣿⢿⣿⡿⣏⣿⣿⣿⣿⣿⣿⣿⣿⣀⠃⠀⢸⡿⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣇⠈⢃⣴⠟⠛⢉⣸⣇⣹⣿⣿⠚⡿⣿⣉⣿⠃⠈⠙⢻⡄⠎⠀⠈⢃⣴⠟⠛⢉⣸⣇⣹⣿⣿⠚⡿⣿⣉⣿⠃⠈⠙⢻⡄⠎⠀⣿⡷⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⡇⣿⠀⠀⠻⣤⠠⣿⠉⢻⡟⢷⣝⣷⠉⣿⢿⡻⣃⢀⢤⢀⡏⠀⢠⣿⠀⠀⠻⣤⠠⣿⠉⢻⡟⢷⣝⣷⠉⣿⢿⡻⣃⢀⢤⢀⡏⠀⢠⡏⡼⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⠘⡅⠀⣔⠚⢀⣉⣻⡾⢡⡾⣻⣧⡾⢃⣈⣳⢧⡘⠤⠞⠁⠀⡼⠁⡅⠀⣔⠚⢀⣉⣻⡾⢡⡾⣻⣧⡾⢃⣈⣳⢧⡘⠤⠞⠁⠀⡼⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⡀⠀⢠⡎⣝⠉⢰⠾⠿⢯⡘⢧⡧⠄⠀⡄⢻⠀⠀⠀⢰⠁⠀⠸⡀⠀⢠⡎⣝⠉⢰⠾⠿⢯⡘⢧⡧⠄⠀⡄⢻⠀⠀⠀⢰⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠁⠀⠈⢧⣈⠀⠘⢦⠀⣀⠇⣼⠃⠰⣄⣡⠞⠀⠀⠀⠀⠀⠀⠀⠁⠀⠈⢧⣈⠀⠘⢦⠀⣀⠇⣼⠃⠰⣄⣡⠞⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⢤⠼⠁⠀⠀⠳⣤⡼⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⢤⠼⠁⠀⠀⠳⣤⡼⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
];
const BANNER_WIDTH = 74;

// ── layout constants ────────────────────────────────────────────────────────

const CONTENT_WIDTH = BANNER_WIDTH; // 74
const COL_W = 36;
const COL_GAP = 2; // 36 + 2 + 36 = 74

// ── rendering primitives ────────────────────────────────────────────────────

function padRight(s: string, width: number): string {
	const pad = width - visibleWidth(s);
	return pad > 0 ? s + " ".repeat(pad) : s;
}

function centerInWidth(s: string, width: number): string {
	const vw = visibleWidth(s);
	if (vw >= width) return s;
	const left = Math.floor((width - vw) / 2);
	return " ".repeat(left) + s;
}

function hr(theme: Theme, width: number, char = "─"): string {
	return theme.fg("borderMuted", char.repeat(Math.max(0, width)));
}

function sectionHeader(theme: Theme, title: string, width: number): string {
	const prefix = "── ";
	const raw = prefix.length + visibleWidth(title) + 1; // "── " + title + " "
	const dashes = Math.max(0, width - raw);
	return (
		theme.fg("borderMuted", prefix) +
		theme.fg("accent", theme.bold(title)) +
		" " +
		theme.fg("borderMuted", "─".repeat(dashes))
	);
}

function composeColumns(left: string[], right: string[]): string[] {
	const rows = Math.max(left.length, right.length);
	const out: string[] = [];
	for (let i = 0; i < rows; i++) {
		const l = left[i] ?? "";
		const r = right[i] ?? "";
		const lClipped = visibleWidth(l) > COL_W ? truncateToWidth(l, COL_W) : l;
		const rClipped = visibleWidth(r) > COL_W ? truncateToWidth(r, COL_W) : r;
		out.push(padRight(lClipped, COL_W) + " ".repeat(COL_GAP) + rClipped);
	}
	return out;
}

// ── dashboard data ──────────────────────────────────────────────────────────

type Severity = "warning" | "error";
type Warning = { icon?: string; text: string; severity: Severity };

type DashboardData = {
	cwd: string;
	git: GitInfo;
	modelId?: string;
	provider?: string;
	extensions: string[];
	themes: string[];
	activeTheme?: string;
	sessions: Array<{ name?: string; file: string; mtime: number; messageCount?: number }>;
	warnings: Warning[];
};

// ── render ──────────────────────────────────────────────────────────────────

function renderDashboard(theme: Theme, data: DashboardData, width: number): string[] {
	const proj = basename(data.cwd) || data.cwd;

	// Banner ------------------------------------------------------------------
	// Rose palette (rose-pine "love" tones): brighter inside, softer at the edges.
	const rgb = (r: number, g: number, b: number, s: string) =>
		`\x1b[38;2;${r};${g};${b}m${s}\x1b[39m`;
	const ROSE_CORE: [number, number, number] = [235, 111, 146]; // #eb6f92
	const ROSE_EDGE: [number, number, number] = [193, 112, 127]; // muted rose
	const ROSE_GLOW: [number, number, number] = [249, 168, 180]; // soft pink glow
	const bannerColored = BANNER.map((line, i) => {
		const last = BANNER.length - 1;
		const edge = i === 0 || i === last;
		const near = i === 1 || i === last - 1;
		const [r, g, b] = edge ? ROSE_GLOW : near ? ROSE_EDGE : ROSE_CORE;
		return rgb(r, g, b, line);
	});

	// Left column: identity, project, model, environment ---------------------
	const gitLine = data.git
		? theme.fg("muted", " on ") +
			theme.fg(data.git.dirty ? "warning" : "success", data.git.branch) +
			(data.git.dirty ? theme.fg("warning", " ✱") : theme.fg("success", " ✓"))
		: theme.fg("dim", " (no git)");

	const greetLine =
		theme.fg("accent", "❯ ") +
		theme.fg("text", theme.bold(greeting())) +
		theme.fg(
			"muted",
			`, ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
		);

	const projLine = theme.fg("muted", "📁 ") + theme.fg("text", theme.bold(proj)) + gitLine;

	const modelLine =
		theme.fg("muted", "🧠 ") +
		theme.fg("text", data.modelId ?? "no model") +
		(data.provider ? theme.fg("dim", ` · ${data.provider}`) : "");

	const versionLine =
		theme.fg("muted", "🥧 ") +
		theme.fg("text", `pi v${VERSION}`) +
		theme.fg("dim", "  ·  ") +
		theme.fg("muted", "🎨 ") +
		theme.fg("text", data.activeTheme ?? "default");

	const leftCol: string[] = [
		sectionHeader(theme, "Session", COL_W),
		greetLine,
		projLine,
		modelLine,
		versionLine,
		"",
		sectionHeader(theme, "Loaded", COL_W),
	];
	if (data.extensions.length === 0) {
		leftCol.push(theme.fg("dim", "  (no extensions)"));
	} else {
		const shown = data.extensions.slice(0, 5);
		for (const name of shown) {
			leftCol.push(theme.fg("muted", "  🧩 ") + theme.fg("text", name));
		}
		if (data.extensions.length > shown.length) {
			leftCol.push(theme.fg("dim", `  … +${data.extensions.length - shown.length} more`));
		}
	}
	const otherThemes = data.themes.filter((t) => t !== data.activeTheme);
	const themePreview = otherThemes.slice(0, 3).join(", ");
	const themeSuffix = otherThemes.length > 3 ? `, … +${otherThemes.length - 3}` : "";
	leftCol.push(theme.fg("dim", `  themes: ${themePreview}${themeSuffix}`));

	// Right column: recent sessions + shortcuts ------------------------------
	const rightCol: string[] = [];
	rightCol.push(sectionHeader(theme, "Recent sessions", COL_W));
	if (data.sessions.length === 0) {
		rightCol.push(theme.fg("dim", "  (none — fresh project)"));
	} else {
		for (const s of data.sessions.slice(0, 4)) {
			const label = s.name?.trim() || basename(s.file).replace(/\.jsonl$/, "");
			const shown = label.length > 16 ? label.slice(0, 15) + "…" : label;
			const meta = relativeTime(s.mtime);
			rightCol.push(
				theme.fg("muted", "  • ") + theme.fg("text", shown) + theme.fg("dim", `  ${meta}`),
			);
		}
		rightCol.push(theme.fg("dim", "  ↳ pi -c  ·  pi -r"));
	}
	rightCol.push("");
	rightCol.push(sectionHeader(theme, "Shortcuts", COL_W));
	const shortcuts: Array<[string, string]> = [
		["@", "reference files"],
		["/  ·  !cmd", "commands · bash"],
		["Shift+Tab", "cycle thinking"],
		["Ctrl+L", "switch model"],
		["Esc / Esc Esc", "interrupt / /tree"],
		["Ctrl+C / Ctrl+D", "clear / exit"],
		["/hotkeys", "show everything"],
	];
	for (const [k, v] of shortcuts) {
		rightCol.push(theme.fg("accent", `  ${k.padEnd(15)}`) + theme.fg("muted", v));
	}

	// Pad shorter column so composeColumns aligns nicely
	while (leftCol.length < rightCol.length) leftCol.push("");
	while (rightCol.length < leftCol.length) rightCol.push("");

	// Assemble block ---------------------------------------------------------
	const block: string[] = [];
	block.push(hr(theme, CONTENT_WIDTH, "━"));

	// Warnings band (only when there are warnings). Errors render in `error`
	// colour, warnings in `warning` colour. Long messages wrap across lines.
	if (data.warnings.length > 0) {
		const hasError = data.warnings.some((w) => w.severity === "error");
		const n = data.warnings.length;
		const headerLabel = hasError
			? `✖ ${n} warning${n === 1 ? "" : "s"} / errors on load`
			: `⚠ ${n} warning${n === 1 ? "" : "s"} on load`;
		block.push(
			centerInWidth(
				theme.fg(hasError ? "error" : "warning", theme.bold(headerLabel)),
				CONTENT_WIDTH,
			),
		);
		for (const w of data.warnings) {
			const icon = w.icon ?? (w.severity === "error" ? "✖" : "⚠");
			const prefix = `  ${icon}  `;
			const prefixWidth = visibleWidth(prefix);
			const maxTextWidth = Math.max(10, CONTENT_WIDTH - prefixWidth - 2);
			const words = w.text.split(/\s+/);
			const wrapped: string[] = [];
			let cur = "";
			for (const word of words) {
				if (!cur.length) {
					cur = word;
				} else if (cur.length + 1 + word.length <= maxTextWidth) {
					cur += " " + word;
				} else {
					wrapped.push(cur);
					cur = word;
				}
			}
			if (cur) wrapped.push(cur);
			wrapped.forEach((seg, idx) => {
				const raw = idx === 0 ? prefix + seg : " ".repeat(prefixWidth) + seg;
				block.push(theme.fg(w.severity, truncateToWidth(raw, CONTENT_WIDTH)));
			});
		}
		block.push(hr(theme, CONTENT_WIDTH));
	}

	block.push(...bannerColored);
	block.push("");
	block.push(...composeColumns(leftCol, rightCol));
	block.push(hr(theme, CONTENT_WIDTH));

	// Footer tips
	block.push(
		centerInWidth(theme.fg("muted", "💡 ") + theme.fg("text", tipOfTheMoment()), CONTENT_WIDTH),
	);
	block.push(
		centerInWidth(
			theme.fg("dim", "Pi can explain and extend itself — just ask."),
			CONTENT_WIDTH,
		),
	);
	block.push(
		centerInWidth(
			theme.fg("dim", "Start typing to begin — this dashboard clears on your first message."),
			CONTENT_WIDTH,
		),
	);
	block.push(hr(theme, CONTENT_WIDTH, "━"));

	// Center the whole block within the terminal width
	const outerPad = Math.max(0, Math.floor((width - CONTENT_WIDTH) / 2));
	const padStr = " ".repeat(outerPad);
	return block.map((line) => padStr + line);
}

// ── extension ───────────────────────────────────────────────────────────────

// Global warning capture ---------------------------------------------------
// Installed once at module load; feeds a shared buffer that the dashboard reads.

const capturedWarnings: Warning[] = [];
const warningSubscribers = new Set<() => void>();
const MAX_WARNINGS = 20;
const MAX_WARNING_LEN = 300;

function addCapturedWarning(w: Warning): void {
	const text = String(w.text ?? "").replace(/\s+/g, " ").trim();
	if (!text) return;
	const clipped =
		text.length > MAX_WARNING_LEN ? text.slice(0, MAX_WARNING_LEN - 1) + "…" : text;
	if (capturedWarnings.some((x) => x.severity === w.severity && x.text === clipped)) return;
	if (capturedWarnings.length >= MAX_WARNINGS) return;
	capturedWarnings.push({ icon: w.icon, text: clipped, severity: w.severity });
	for (const fn of warningSubscribers) {
		try {
			fn();
		} catch {
			/* ignore */
		}
	}
}

let globalCaptureInstalled = false;
function installGlobalCapture(): void {
	if (globalCaptureInstalled) return;
	globalCaptureInstalled = true;

	const fmt = (args: unknown[]): string =>
		args
			.map((a) => {
				if (a instanceof Error) return a.stack || `${a.name}: ${a.message}`;
				if (typeof a === "string") return a;
				try {
					return JSON.stringify(a);
				} catch {
					return String(a);
				}
			})
			.join(" ");

	const origWarn = console.warn.bind(console);
	const origError = console.error.bind(console);
	console.warn = (...args: unknown[]) => {
		addCapturedWarning({ severity: "warning", text: fmt(args) });
		origWarn(...args);
	};
	console.error = (...args: unknown[]) => {
		addCapturedWarning({ severity: "error", text: fmt(args) });
		origError(...args);
	};

	process.on("warning", (w: Error & { name?: string }) => {
		addCapturedWarning({
			severity: "warning",
			text: `${w.name ?? "Warning"}: ${w.message}`,
		});
	});
	process.on("uncaughtException", (e: Error) => {
		addCapturedWarning({ severity: "error", text: `Uncaught: ${e.message}` });
	});
	process.on("unhandledRejection", (reason: unknown) => {
		const msg =
			reason instanceof Error
				? reason.message
				: typeof reason === "string"
					? reason
					: JSON.stringify(reason);
		addCapturedWarning({ severity: "error", text: `Unhandled rejection: ${msg}` });
	});
}

// Wrap ctx.ui.notify per-context so warning/error notifications get mirrored
// into the band while pi still displays them inline.
function wrapNotify(ctx: ExtensionContext): void {
	const ui: any = ctx.ui;
	if (!ui || typeof ui.notify !== "function" || ui.__dashboardWrapped) return;
	const orig = ui.notify.bind(ui);
	ui.notify = (message: string, severity?: string, ...rest: unknown[]) => {
		if (severity === "warning" || severity === "error") {
			addCapturedWarning({ severity: severity as Severity, text: String(message) });
		}
		return orig(message, severity, ...rest);
	};
	ui.__dashboardWrapped = true;
}

installGlobalCapture();

async function collectEnvWarnings(ctx: ExtensionContext): Promise<Warning[]> {
	const warnings: Warning[] = [];
	if (!ctx.model) {
		warnings.push({
			severity: "warning",
			text: "No model selected — run /model or Ctrl+L to pick one.",
		});
		return warnings;
	}
	try {
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
		if (!auth.ok) {
			warnings.push({
				severity: "error",
				text: `No credentials for ${ctx.model.provider} — run /login or set an API key.`,
			});
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		warnings.push({
			severity: "error",
			text: `Auth check failed for ${ctx.model.provider}: ${msg}`,
		});
	}
	return warnings;
}

export default function (pi: ExtensionAPI) {
	let dashboardActive = false;

	function setEmptyHeader(ctx: ExtensionContext) {
		if (!ctx.hasUI) return;
		// Collapse the built-in header so nothing lingers when the dashboard is
		// hidden. Pi's [Extensions]/[Themes] listings are suppressed separately
		// via `quietStartup: true` in settings; diagnostics still render in
		// pi's own loadedResourcesContainer, which sits directly beneath the
		// header — i.e. beneath this dashboard.
		ctx.ui.setHeader((_tui, _theme) => ({
			render: (_width: number) => [],
			invalidate: () => {},
		}));
	}

	async function collectData(ctx: ExtensionContext): Promise<DashboardData> {
		let sessions: DashboardData["sessions"] = [];
		try {
			const list = await SessionManager.list(ctx.cwd);
			sessions = (list as any[])
				.filter((s) => s && typeof s.file === "string")
				.map((s) => ({
					file: s.file as string,
					mtime: (s.mtime ?? s.modifiedAt ?? s.updatedAt ?? Date.now()) as number,
					name: (s.name ?? s.displayName ?? undefined) as string | undefined,
					messageCount: (s.messageCount ?? s.entryCount ?? undefined) as number | undefined,
				}))
				.sort((a, b) => b.mtime - a.mtime);
			const active = ctx.sessionManager.getSessionFile?.();
			if (active) sessions = sessions.filter((s) => s.file !== active);
		} catch {
			// ignore
		}

		// Read active theme from settings.json (project first, then global).
		let activeTheme: string | undefined;
		for (const p of [
			join(ctx.cwd, ".pi", "settings.json"),
			join(homedir(), ".pi", "agent", "settings.json"),
		]) {
			try {
				if (!existsSync(p)) continue;
				const raw = require("node:fs").readFileSync(p, "utf8");
				const parsed = JSON.parse(raw);
				if (parsed?.theme) {
					activeTheme = parsed.theme;
					break;
				}
			} catch {
				// ignore
			}
		}

		const envWarnings = await collectEnvWarnings(ctx);
		for (const w of envWarnings) addCapturedWarning(w);

		return {
			cwd: ctx.cwd,
			git: getGitInfo(ctx.cwd),
			modelId: ctx.model?.id,
			provider: ctx.model?.provider,
			extensions: listExtensions(),
			themes: listThemes(),
			activeTheme,
			sessions,
			warnings: [...capturedWarnings],
		};
	}

	// Live-updating dashboard: later warnings patch liveData and request re-render.
	let liveData: DashboardData | null = null;
	let capturedTui: any = null;
	let unsubscribe: (() => void) | null = null;

	function showDashboard(ctx: ExtensionContext, data: DashboardData) {
		dashboardActive = true;
		liveData = data;
		// Render the dashboard AS the header so pi's own loaded-resources /
		// diagnostics band renders directly beneath it.
		ctx.ui.setHeader((tui, theme) => {
			capturedTui = tui;
			return {
				render(width: number): string[] {
					return renderDashboard(theme, liveData ?? data, Math.max(20, width));
				},
				invalidate() {},
			};
		});

		if (unsubscribe) unsubscribe();
		const onWarn = () => {
			if (!liveData) return;
			liveData.warnings = [...capturedWarnings];
			try {
				capturedTui?.requestRender?.();
			} catch {
				/* ignore */
			}
		};
		warningSubscribers.add(onWarn);
		unsubscribe = () => warningSubscribers.delete(onWarn);
	}

	function hideDashboard(ctx: ExtensionContext) {
		if (!dashboardActive) return;
		dashboardActive = false;
		liveData = null;
		capturedTui = null;
		if (unsubscribe) {
			unsubscribe();
			unsubscribe = null;
		}
		setEmptyHeader(ctx);
	}

	pi.on("session_start", async (event, ctx) => {
		if (!ctx.hasUI) return;
		if (event.reason !== "startup") return;

		// Empty out the built-in header immediately so no duplicate info appears
		// while we gather data.
		setEmptyHeader(ctx);
		// Mirror warning/error notify() calls into the band.
		wrapNotify(ctx);

		const branch = ctx.sessionManager.getBranch?.() ?? [];
		const hasMessages = branch.some(
			(e: any) =>
				e?.type === "message" && (e.message?.role === "user" || e.message?.role === "assistant"),
		);
		if (hasMessages) return;

		const data = await collectData(ctx);
		showDashboard(ctx, data);
	});

	// Clear on first user input.
	pi.on("input", async (_event, ctx) => {
		hideDashboard(ctx);
		return { action: "continue" };
	});

	pi.registerCommand("dashboard", {
		description: "Dashboard: /dashboard [on|off|warnings|clear]",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "off" || arg === "hide") {
				hideDashboard(ctx);
				ctx.ui.notify("Dashboard hidden", "info");
				return;
			}
			if (arg === "warnings" || arg === "errors") {
				if (capturedWarnings.length === 0) {
					ctx.ui.notify("No warnings or errors captured this session.", "info");
				} else {
					for (const w of capturedWarnings) ctx.ui.notify(w.text, w.severity as any);
				}
				return;
			}
			if (arg === "clear") {
				capturedWarnings.length = 0;
				if (liveData) liveData.warnings = [];
				try {
					capturedTui?.requestRender?.();
				} catch {
					/* ignore */
				}
				ctx.ui.notify("Cleared captured warnings.", "info");
				return;
			}
			wrapNotify(ctx);
			const data = await collectData(ctx);
			showDashboard(ctx, data);
			if (arg && arg !== "on" && arg !== "show") {
				ctx.ui.notify(`Unknown arg '${arg}', showing dashboard`, "info");
			}
		},
	});
}
