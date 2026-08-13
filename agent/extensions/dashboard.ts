/**
 * Responsive startup dashboard for pi.
 *
 * Shows for an empty startup/resumed session and clears when the first message is sent.
 * A newly cleared session stays blank until /dash is invoked.
 * Data comes from pi's public APIs rather than filesystem discovery.
 *
 *   /dash                  Toggle the dashboard
 *   /dash on|off           Show or restore the built-in header
 *   /dash auto|full        Select the preferred layout
 *   /dash compact          Force the compact layout
 *   /dash font braille|pixel|line|heavy  Select the two-line display font
 *   /dash warnings|clear   Inspect or clear dashboard health checks
 */

import { basename, dirname } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { keyText, SessionManager, VERSION } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

type Severity = "warning" | "error";
type DashboardWarning = { text: string; severity: Severity };
type GitInfo = { branch: string; dirtyCount: number } | null;
type ViewMode = "auto" | "compact" | "full";
type DisplayFont = "braille" | "pixel" | "line" | "heavy";

type RecentSession = {
	path: string;
	modified: number;
	name?: string;
	firstMessage: string;
	messageCount: number;
};

type DashboardData = {
	cwd: string;
	git: GitInfo;
	modelId?: string;
	provider?: string;
	thinkingLevel: string;
	contextTokens: number | null;
	contextWindow: number | null;
	contextPercent: number | null;
	activeTheme?: string;
	extensions: string[];
	sessions: RecentSession[];
	warnings: DashboardWarning[];
	omittedWarnings: number;
};

const FULL_WIDTH = 74;
const COLUMN_WIDTH = 36;
const COLUMN_GAP = 2;
const MAX_WARNINGS = 10;
const HEADER_TOP_MARGIN_ROWS = 3;

const LINE_GLYPHS: Record<string, [string, string]> = {
	" ": [" ", " "],
	A: ["╭╮", "├┤"], C: ["╭─", "╰─"], E: ["├─", "└─"], F: ["╭─", "├ "],
	G: ["╭─", "╰┤"], H: ["││", "├┤"], I: ["┬ ", "┴ "], L: ["│ ", "└─"],
	M: ["╲╱", "││"], N: ["╲│", "│╲"], O: ["╭╮", "╰╯"], P: ["├╮", "├╯"],
	R: ["├╮", "│╲"], S: ["╭─", "─╯"], T: ["┬┬", " │"], U: ["││", "╰╯"],
	Y: ["╲╱", " │"],
};

const HEAVY_GLYPHS: Record<string, [string, string]> = {
	" ": [" ", " "],
	A: ["┏┓", "┣┫"], C: ["┏━", "┗━"], E: ["┣━", "┗━"], F: ["┏━", "┣ "],
	G: ["┏━", "┗┫"], H: ["┃┃", "┣┫"], I: ["┳ ", "┻ "], L: ["┃ ", "┗━"],
	M: ["╲╱", "┃┃"], N: ["╲┃", "┃╲"], O: ["┏┓", "┗┛"], P: ["┣┓", "┣┛"],
	R: ["┣┓", "┃╲"], S: ["┏━", "━┛"], T: ["┳┳", " ┃"], U: ["┃┃", "┗┛"],
	Y: ["╲╱", " ┃"],
};

const PIXEL_GLYPHS: Record<string, [string, string, string, string]> = {
	" ": [" ", " ", " ", " "],
	C: ["██", "█ ", "█ ", "██"],
	E: ["███", "█  ", "██ ", "███"],
	F: ["███", "█  ", "██ ", "█  "],
	G: ["███", "█  ", "█ █", "███"],
	H: ["█ █", "███", "█ █", "█ █"],
	I: ["█", "█", "█", "█"],
	L: ["█ ", "█ ", "█ ", "██"],
	M: ["█  █", "████", "█  █", "█  █"],
	N: ["█ █", "███", "███", "█ █"],
	O: ["███", "█ █", "█ █", "███"],
	P: ["███", "█ █", "███", "█  "],
	R: ["██ ", "█ █", "██ ", "█ █"],
	S: ["███", "█  ", "  █", "███"],
	T: ["███", " █ ", " █ ", " █ "],
	U: ["█ █", "█ █", "█ █", "███"],
	Y: ["█ █", " █ ", " █ ", " █ "],
};

const BRAILLE_GLYPHS: Record<string, string[]> = {
	" ": ["000", "000", "000", "000", "000", "000", "000"],
	A: ["010", "101", "101", "111", "101", "101", "101"],
	E: ["111", "100", "100", "110", "100", "100", "111"],
	F: ["111", "100", "100", "110", "100", "100", "100"],
	H: ["101", "101", "101", "111", "101", "101", "101"],
	M: ["101", "111", "111", "101", "101", "101", "101"],
	I: ["111", "010", "010", "010", "010", "010", "111"],
	N: ["101", "111", "111", "111", "111", "111", "101"],
	O: ["010", "101", "101", "101", "101", "101", "010"],
	P: ["110", "101", "101", "110", "100", "100", "100"],
	R: ["110", "101", "101", "110", "101", "101", "101"],
	S: ["111", "100", "100", "111", "001", "001", "111"],
	T: ["111", "010", "010", "010", "010", "010", "010"],
	U: ["101", "101", "101", "101", "101", "101", "111"],
};

const HEADER_SLOGAN = "CTHULU IS COMING FOR YOUR REPO";
const BRAILLE_SLOGAN = "NO REPO IS SAFE FROM HIM";

function brailleText(text: string): [string, string] {
	const dotBits = [
		[0x01, 0x08],
		[0x02, 0x10],
		[0x04, 0x20],
		[0x40, 0x80],
	];
	const pixelRows = Array.from({ length: 8 }, () => "");
	for (const char of text.toUpperCase()) {
		const glyph = BRAILLE_GLYPHS[char] ?? BRAILLE_GLYPHS[" "];
		for (let row = 0; row < 8; row++) pixelRows[row] += `${glyph[row] ?? "000"}0`;
	}
	const renderRow = (rowOffset: number): string => {
		let output = "";
		for (let column = 0; column < pixelRows[0].length; column += 2) {
			let bits = 0;
			for (let y = 0; y < 4; y++) {
				for (let x = 0; x < 2; x++) {
					if (pixelRows[rowOffset + y]?.[column + x] === "1") bits |= dotBits[y][x];
				}
			}
			output += String.fromCodePoint(0x2800 + bits);
		}
		return output.trimEnd();
	};
	return [renderRow(0), renderRow(4)];
}

function pixelText(text: string): [string, string] {
	const pixels = ["", "", "", ""];
	for (const char of text.toUpperCase()) {
		const glyph = PIXEL_GLYPHS[char] ?? [char, " ", char, " "];
		for (let row = 0; row < pixels.length; row++) pixels[row] += glyph[row];
	}
	const combine = (upper: string, lower: string): string => {
		let line = "";
		for (let index = 0; index < upper.length; index++) {
			const top = upper[index] === "█";
			const bottom = lower[index] === "█";
			line += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
		}
		return line;
	};
	return [combine(pixels[0], pixels[1]), combine(pixels[2], pixels[3])];
}

function bigText(text: string, font: DisplayFont): [string, string] {
	if (font === "braille") return brailleText(BRAILLE_SLOGAN);
	if (font === "pixel") return pixelText(text);
	const rows: [string[], string[]] = [[], []];
	const glyphs = font === "heavy" ? HEAVY_GLYPHS : LINE_GLYPHS;
	for (const char of text.toUpperCase()) {
		const glyph = glyphs[char] ?? [char, " ".repeat(visibleWidth(char))];
		rows[0].push(glyph[0]);
		rows[1].push(glyph[1]);
	}
	return [rows[0].join(""), rows[1].join("")];
}

const BANNER = [
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⡤⠶⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⠶⣦⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣿⡟⠀⠈⣀⣾⣝⣯⣿⣛⣷⣦⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⢿⣿⣦⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣴⣿⣿⣿⡇⠀⢼⣿⣽⣿⢻⣿⣻⣿⣟⣷⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣾⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣞⣿⣿⣿⣿⣿⣷⣤⣸⣟⣿⣿⣻⣯⣿⣿⣿⣿⣀⣴⣿⣿⣿⣿⣷⣤⣸⣟⣿⣿⣻⣯⣿⣿⣿⣿⣯⣆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡼⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣜⡆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⣟⣯⣿⣿⣿⣷⢿⣫⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣬⣟⠿⣿⣿⣿⣷⢿⣫⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣬⣟⠿⣿⣿⣿⣿⡷⣾⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣯⣿⣿⡏⠙⡇⣾⣟⣿⡿⢿⣿⣿⣿⣿⣿⢿⣟⡿⣿⠀⡟⠉⢹⣿⣿⡏⠙⡇⣾⣟⣿⡿⢿⣿⣿⣿⣿⣿⢿⣟⡿⣿⠀⡟⠉⢹⣿⣿⢿⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣯⡿⢿⠀⠀⠱⢈⣿⢿⣿⡿⣏⣿⣿⣿⣿⣿⣿⣿⣿⣀⠃⠀⢸⡿⢿⠀⠀⠱⢈⣿⢿⣿⡿⣏⣿⣿⣿⣿⣿⣿⣿⣿⣀⠃⠀⢸⡿⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣇⠈⢃⣴⠟⠛⢉⣸⣇⣹⣿⣿⠚⡿⣿⣉⣿⠃⠈⠙⢻⡄⠎⠀⠈⢃⣴⠟⠛⢉⣸⣇⣹⣿⣿⠚⡿⣿⣉⣿⠃⠈⠙⢻⡄⠎⠀⣿⡷⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⡇⣿⠀⠀⠻⣤⠠⣿⠉⢻⡟⢷⣝⣷⠉⣿⢿⡻⣃⢀⢤⢀⡏⠀⢠⣿⠀⠀⠻⣤⠠⣿⠉⢻⡟⢷⣝⣷⠉⣿⢿⡻⣃⢀⢤⢀⡏⠀⢠⡏⡼⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⠘⡅⠀⣔⠚⢀⣉⣻⡾⢡⡾⣻⣧⡾⢃⣈⣳⢧⡘⠤⠞⠁⠀⡼⠁⡅⠀⣔⠚⢀⣉⣻⡾⢡⡾⣻⣧⡾⢃⣈⣳⢧⡘⠤⠞⠁⠀⡼⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⡀⠀⢠⡎⣝⠉⢰⠾⠿⢯⡘⢧⡧⠄⠀⡄⢻⠀⠀⠀⢰⠁⠀⠸⡀⠀⢠⡎⣝⠉⢰⠾⠿⢯⡘⢧⡧⠄⠀⡄⢻⠀⠀⠀⢰⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠁⠀⠈⢧⣈⠀⠘⢦⠀⣀⠇⣼⠃⠰⣄⣡⠞⠀⠀⠀⠀⠀⠀⠀⠁⠀⠈⢧⣈⠀⠘⢦⠀⣀⠇⣼⠃⠰⣄⣡⠞⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⢤⠼⠁⠀⠀⠳⣤⡼⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⢤⠼⠁⠀⠀⠳⣤⡼⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
];

const TIPS = [
	"Type @ in the editor to fuzzy-search project files.",
	"Prefix a line with ! to run bash (!! keeps output out of model context).",
	"Enter steers a running agent; the configured follow-up key queues work.",
	"/fork branches from a past message; /clone duplicates the current branch.",
	"Drop images onto the terminal or paste them from the clipboard.",
	"Put reusable prompts in ~/.pi/agent/prompts/name.md and call /name.",
	"Pi can explain and extend itself — ask it to build the tool you need.",
];

function relativeTime(timestamp: number): string {
	const minutes = Math.floor(Math.max(0, Date.now() - timestamp) / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo ago`;
	return `${Math.floor(months / 12)}y ago`;
}

function compactNumber(value: number): string {
	return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function tipOfTheMoment(): string {
	return TIPS[Math.floor(Date.now() / (10 * 60_000)) % TIPS.length];
}

function extensionLabel(source: { path: string; source: string }): string {
	const file = basename(source.path);
	if (/^index\.(?:ts|js|mjs)$/.test(file)) return basename(dirname(source.path));
	const label = file.replace(/\.(?:ts|js|mjs)$/, "");
	return label && !label.startsWith("<") ? label : source.source;
}

function shortcut(id: Parameters<typeof keyText>[0], fallback: string): string {
	return keyText(id) || fallback;
}

function padRight(text: string, width: number): string {
	const padding = width - visibleWidth(text);
	return padding > 0 ? text + " ".repeat(padding) : text;
}

function centered(text: string, width: number): string {
	const padding = Math.max(0, Math.floor((width - visibleWidth(text)) / 2));
	return " ".repeat(padding) + text;
}

function horizontalRule(theme: Theme, width: number, char = "─"): string {
	return theme.fg("border", char.repeat(Math.max(0, width)));
}

function sectionHeader(theme: Theme, title: string, width: number): string {
	if (width < 5) return truncateToWidth(theme.fg("warning", title), width, "");
	const used = visibleWidth(title) + 1;
	return (
		theme.fg("warning", theme.bold(title)) +
		" " +
		theme.fg("border", "─".repeat(Math.max(0, width - used)))
	);
}

function itemLabel(theme: Theme, icon: string, label: string, width = 12): string {
	const labelWidth = Math.max(0, width - visibleWidth(icon) - 1);
	return theme.fg("accent", icon) + " " + theme.fg("muted", padRight(label, labelWidth)) + " ";
}

function warningLines(theme: Theme, data: DashboardData, width: number): string[] {
	if (data.warnings.length === 0 && data.omittedWarnings === 0) return [];
	const lines = [sectionHeader(theme, "󰒓 Health", width)];
	for (const warning of data.warnings) {
		const icon = warning.severity === "error" ? "✖" : "⚠";
		const prefix = `${icon} `;
		const bodyWidth = Math.max(1, width - visibleWidth(prefix));
		const wrapped = wrapTextWithAnsi(warning.text, bodyWidth);
		for (let index = 0; index < wrapped.length; index++) {
			const line = (index === 0 ? prefix : " ".repeat(visibleWidth(prefix))) + wrapped[index];
			lines.push(theme.fg(warning.severity, truncateToWidth(line, width, "")));
		}
	}
	if (data.omittedWarnings > 0) {
		lines.push(theme.fg("dim", `… ${data.omittedWarnings} additional checks omitted`));
	}
	return lines;
}

function gitText(theme: Theme, git: GitInfo): string {
	if (!git) return theme.fg("dim", "no git");
	const state = git.dirtyCount > 0 ? `${git.dirtyCount} changed` : "clean";
	const color = git.dirtyCount > 0 ? "error" : "success";
	return theme.fg("text", git.branch) + theme.fg("dim", " · ") + theme.fg(color, state);
}

function contextText(data: DashboardData): string {
	if (data.contextWindow === null) return "context unavailable";
	const used = data.contextTokens === null ? "?" : compactNumber(data.contextTokens);
	const percent = data.contextPercent === null ? "" : ` · ${Math.round(data.contextPercent)}%`;
	return `${used}/${compactNumber(data.contextWindow)}${percent}`;
}

function recentSessionLine(theme: Theme, session: RecentSession, width: number): string {
	const fallback = session.firstMessage.trim() || basename(session.path).replace(/\.jsonl$/, "");
	const label = (session.name?.trim() || fallback).replace(/\s+/g, " ");
	const meta = `${session.messageCount} msg · ${relativeTime(session.modified)}`;
	const prefix = "󰋚 ";
	const maxLabel = Math.max(4, width - visibleWidth(prefix) - visibleWidth(meta) - 3);
	return (
		theme.fg("accent", prefix.trimEnd()) +
		" " +
		theme.fg("muted", truncateToWidth(label, maxLabel)) +
		theme.fg("text", ` · ${meta}`)
	);
}

function composeColumns(left: string[], right: string[]): string[] {
	const count = Math.max(left.length, right.length);
	const lines: string[] = [];
	for (let index = 0; index < count; index++) {
		const leftLine = truncateToWidth(left[index] ?? "", COLUMN_WIDTH, "");
		const rightLine = truncateToWidth(right[index] ?? "", COLUMN_WIDTH, "");
		lines.push(padRight(leftLine, COLUMN_WIDTH) + " ".repeat(COLUMN_GAP) + rightLine);
	}
	return lines;
}

function fullDashboard(theme: Theme, data: DashboardData): string[] {
	const project = basename(data.cwd) || data.cwd;
	const left: string[] = [
		sectionHeader(theme, "󰉋 Workspace", COLUMN_WIDTH),
		itemLabel(theme, "󰉋", "project") + theme.fg("text", theme.bold(project)),
		itemLabel(theme, "", "git") + gitText(theme, data.git),
		itemLabel(theme, "󰚩", "model") + theme.fg("text", data.modelId ?? "no model"),
		itemLabel(theme, "󰒋", "provider") + theme.fg("text", data.provider ?? "none"),
		itemLabel(theme, "󰔟", "thinking") + theme.fg("text", data.thinkingLevel),
		itemLabel(theme, "󰘦", "context") + theme.fg("text", contextText(data)),
		"",
		sectionHeader(theme, "󰪺 Runtime", COLUMN_WIDTH),
		itemLabel(theme, "󰏖", "pi") + theme.fg("text", `v${VERSION}`),
		itemLabel(theme, "󰏘", "theme") + theme.fg("text", data.activeTheme ?? "default"),
		"",
		sectionHeader(theme, "󰏗 Enabled extensions", COLUMN_WIDTH),
	];
	if (data.extensions.length === 0) {
		left.push(theme.fg("dim", "(none detected)"));
	} else {
		for (const extension of data.extensions.slice(0, 5)) {
			left.push(theme.fg("accent", "󰏗") + " " + theme.fg("text", extension));
		}
		if (data.extensions.length > 5) left.push(theme.fg("dim", `… +${data.extensions.length - 5} more`));
	}

	const right: string[] = [sectionHeader(theme, "󰋚 Recent sessions", COLUMN_WIDTH)];
	if (data.sessions.length === 0) {
		right.push(theme.fg("dim", "(none — fresh project)"));
	} else {
		for (const session of data.sessions.slice(0, 5)) {
			right.push(recentSessionLine(theme, session, COLUMN_WIDTH));
		}
		right.push(theme.fg("dim", "↳ /resume to continue a session"));
	}

	right.push("", sectionHeader(theme, "󰌌 Shortcuts", COLUMN_WIDTH));
	const shortcuts: Array<[string, string]> = [
		["@", "reference files"],
		["/ · !cmd", "commands · bash"],
		[shortcut("app.thinking.cycle", "shift+tab"), "cycle thinking"],
		[shortcut("app.model.select", "ctrl+l"), "select model"],
		[shortcut("app.interrupt", "escape"), "interrupt"],
		[shortcut("app.message.followUp", "alt+enter"), "queue follow-up"],
		[shortcut("app.clear", "ctrl+c"), "clear editor"],
		[shortcut("app.exit", "ctrl+d"), "exit"],
	];
	for (const [keys, description] of shortcuts) {
		right.push(theme.fg("muted", padRight(keys, 16)) + theme.fg("text", description));
	}

	return composeColumns(left, right);
}

function compactDashboard(theme: Theme, data: DashboardData, width: number): string[] {
	const project = basename(data.cwd) || data.cwd;
	const lines = [
		sectionHeader(theme, "󰉋 Session", width),
		itemLabel(theme, "󰉋", "project") + theme.fg("text", project),
		itemLabel(theme, "", "git") + gitText(theme, data.git),
		itemLabel(theme, "󰚩", "model") + theme.fg("text", `${data.provider ?? "none"}/${data.modelId ?? "no model"}`),
		itemLabel(theme, "󰔟", "runtime") + theme.fg("text", `thinking ${data.thinkingLevel} · ${contextText(data)}`),
		itemLabel(theme, "󰏗", "extensions") + theme.fg("text", data.extensions.join(", ") || "none detected"),
		"",
		sectionHeader(theme, "󰋚 Recent", width),
	];
	if (data.sessions.length === 0) lines.push(theme.fg("dim", "(none — fresh project)"));
	else for (const session of data.sessions.slice(0, 3)) lines.push(recentSessionLine(theme, session, width));
	lines.push(
		"",
		sectionHeader(theme, "󰌌 Keys", width),
		theme.fg("muted", shortcut("app.model.select", "ctrl+l")) + theme.fg("text", " model · ") +
			theme.fg("muted", shortcut("app.thinking.cycle", "shift+tab")) + theme.fg("text", " thinking · ") +
			theme.fg("muted", "@") + theme.fg("text", " files"),
	);
	return lines;
}

function minimalDashboard(theme: Theme, data: DashboardData, width: number): string[] {
	const project = basename(data.cwd) || data.cwd;
	return [
		theme.fg("accent", theme.bold("pi")) + theme.fg("muted", ` · ${project}`),
		theme.fg("text", data.modelId ?? "no model") + theme.fg("dim", ` · ${data.thinkingLevel}`),
		gitText(theme, data.git),
	];
}

function renderDashboard(
	theme: Theme,
	data: DashboardData,
	terminalWidth: number,
	terminalRows: number,
	mode: ViewMode,
	displayFont: DisplayFont,
): string[] {
	const width = Math.max(1, terminalWidth);
	const heightAllowsFull = terminalRows >= 42;
	const heightAllowsCompact = terminalRows >= 16;
	const useFull = width >= FULL_WIDTH && mode !== "compact" && (mode === "full" || heightAllowsFull);
	const useCompact = !useFull && width >= 44 && heightAllowsCompact;
	const contentWidth = useFull ? FULL_WIDTH : width;
	const block: string[] = [];

	block.push(...warningLines(theme, data, contentWidth));
	if (data.warnings.length > 0 || data.omittedWarnings > 0) block.push(horizontalRule(theme, contentWidth));

	if (useFull) {
		const slogan = bigText(HEADER_SLOGAN, displayFont);
		block.push(
			...Array.from({ length: HEADER_TOP_MARGIN_ROWS }, () => ""),
			...BANNER.map((line) => centered(theme.fg("error", line), contentWidth)),
			"",
			...slogan.map((line) => centered(theme.fg("error", line), contentWidth)),
			"",
		);
		block.push(...fullDashboard(theme, data));
	} else if (useCompact) {
		block.push(...compactDashboard(theme, data, contentWidth));
	} else {
		block.push(...minimalDashboard(theme, data, contentWidth));
	}

	block.push(horizontalRule(theme, contentWidth));
	if (width >= 32) {
		block.push(
			centered(theme.fg("accent", `💡 ${tipOfTheMoment()}`), contentWidth),
		);
	}
	block.push(centered(theme.fg("dim", "Start typing to begin · /dash to return"), contentWidth));
	block.push(horizontalRule(theme, contentWidth, "━"));

	const outerPadding = useFull ? Math.max(0, Math.floor((width - contentWidth) / 2)) : 0;
	const prefix = " ".repeat(outerPadding);
	return block.map((line) => truncateToWidth(prefix + line, width, ""));
}

async function collectAuthWarnings(ctx: ExtensionContext): Promise<DashboardWarning[]> {
	if (!ctx.model) {
		return [{ severity: "warning", text: "No model selected — run /model or use the configured model-selection key." }];
	}
	try {
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
		return auth.ok
			? []
			: [{ severity: "error", text: `${auth.error} — run /login or configure credentials.` }];
	} catch (error) {
		return [{
			severity: "error",
			text: `Authentication check failed for ${ctx.model.provider}: ${error instanceof Error ? error.message : String(error)}`,
		}];
	}
}

export default function (pi: ExtensionAPI) {
	let dashboardActive = false;
	let viewMode: ViewMode = "auto";
	let displayFont: DisplayFont = "braille";
	let liveData: DashboardData | null = null;
	let capturedTui: { requestRender?: () => void } | null = null;
	let loadGeneration = 0;
	let healthWarnings: DashboardWarning[] = [];
	let omittedWarnings = 0;

	function requestRender(): void {
		try {
			capturedTui?.requestRender?.();
		} catch {
			// The component may have been disposed between the event and this render.
		}
	}

	function storeWarnings(warnings: DashboardWarning[]): void {
		for (const warning of warnings) {
			const text = warning.text.replace(/\s+/g, " ").trim();
			if (!text || healthWarnings.some((item) => item.severity === warning.severity && item.text === text)) continue;
			if (healthWarnings.length < MAX_WARNINGS) healthWarnings.push({ ...warning, text });
			else omittedWarnings++;
		}
	}

	async function getGitInfo(cwd: string): Promise<GitInfo> {
		try {
			const result = await pi.exec("git", ["status", "--porcelain=v1", "--branch"], { cwd, timeout: 1000 });
			if (result.code !== 0) return null;
			const lines = result.stdout.trimEnd().split("\n");
			const header = lines[0]?.startsWith("## ") ? lines.shift()!.slice(3) : "HEAD";
			const branch = header.replace(/^No commits yet on /, "").split("...")[0].trim() || "HEAD";
			return { branch, dirtyCount: lines.filter(Boolean).length };
		} catch {
			return null;
		}
	}

	async function getRecentSessions(ctx: ExtensionContext): Promise<RecentSession[]> {
		const activePath = ctx.sessionManager.getSessionFile();
		const sessions = await SessionManager.list(ctx.cwd);
		return sessions
			.filter((session) => session.path !== activePath)
			.map((session) => ({
				path: session.path,
				modified: session.modified.getTime(),
				name: session.name,
				firstMessage: session.firstMessage,
				messageCount: session.messageCount,
			}))
			.sort((left, right) => right.modified - left.modified);
	}

	async function collectData(ctx: ExtensionContext): Promise<DashboardData> {
		const [gitResult, sessionsResult, authResult] = await Promise.allSettled([
			getGitInfo(ctx.cwd),
			getRecentSessions(ctx),
			collectAuthWarnings(ctx),
		]);

		if (sessionsResult.status === "rejected") {
			storeWarnings([{ severity: "warning", text: `Could not list recent sessions: ${String(sessionsResult.reason)}` }]);
		}
		if (authResult.status === "fulfilled") storeWarnings(authResult.value);
		else storeWarnings([{ severity: "warning", text: `Could not check model credentials: ${String(authResult.reason)}` }]);

		const context = ctx.getContextUsage();
		const extensionSources = [
			...pi.getCommands()
				.filter(
					(command) => command.source === "extension" && !command.sourceInfo.path.startsWith("<"),
				)
				.map((command) => command.sourceInfo),
			...pi.getAllTools()
				.filter(
					(tool) =>
						tool.sourceInfo.source !== "builtin" &&
						tool.sourceInfo.source !== "sdk" &&
						!tool.sourceInfo.path.startsWith("<"),
				)
				.map((tool) => tool.sourceInfo),
		];
		const extensions = [...new Set(extensionSources.map(extensionLabel))].sort();

		return {
			cwd: ctx.cwd,
			git: gitResult.status === "fulfilled" ? gitResult.value : null,
			modelId: ctx.model?.id,
			provider: ctx.model?.provider,
			thinkingLevel: ctx.thinkingLevel,
			contextTokens: context?.tokens ?? null,
			contextWindow: context?.contextWindow ?? ctx.model?.contextWindow ?? null,
			contextPercent: context?.percent ?? null,
			activeTheme: ctx.ui.theme.name,
			extensions,
			sessions: sessionsResult.status === "fulfilled" ? sessionsResult.value : [],
			warnings: [...healthWarnings],
			omittedWarnings,
		};
	}

	function setEmptyHeader(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui") return;
		ctx.ui.setHeader(() => ({ render: () => [], invalidate() {} }));
	}

	function showDashboard(ctx: ExtensionContext, data: DashboardData): void {
		if (ctx.mode !== "tui") return;
		dashboardActive = true;
		liveData = data;
		ctx.ui.setHeader((tui, theme) => {
			capturedTui = tui;
			return {
				render: (width: number) => {
					if (liveData) liveData.activeTheme = theme.name;
					return renderDashboard(
						theme,
						liveData ?? data,
						width,
						tui.terminal.rows,
						viewMode,
						displayFont,
					);
				},
				invalidate() {},
				dispose() {
					if (capturedTui === tui) capturedTui = null;
				},
			};
		});
	}

	function hideDashboard(ctx: ExtensionContext, restoreBuiltin: boolean): void {
		loadGeneration++;
		dashboardActive = false;
		liveData = null;
		capturedTui = null;
		if (ctx.mode !== "tui") return;
		if (restoreBuiltin) ctx.ui.setHeader(undefined);
		else setEmptyHeader(ctx);
	}

	async function refreshAndShow(ctx: ExtensionContext): Promise<void> {
		if (ctx.mode !== "tui") return;
		const generation = ++loadGeneration;
		const data = await collectData(ctx);
		if (generation !== loadGeneration) return;
		showDashboard(ctx, data);
	}

	pi.on("session_start", async (event, ctx) => {
		if (ctx.mode !== "tui") return;
		if (event.reason === "new") {
			setEmptyHeader(ctx);
			return;
		}
		const branch = ctx.sessionManager.getBranch();
		const hasConversation = branch.some(
			(entry) => entry.type === "message" && (entry.message.role === "user" || entry.message.role === "assistant"),
		);
		if (hasConversation) return;
		await refreshAndShow(ctx);
	});

	pi.on("input", (_event, ctx) => {
		hideDashboard(ctx, false);
		return { action: "continue" };
	});

	pi.on("model_select", (event) => {
		if (!liveData) return;
		liveData.modelId = event.model.id;
		liveData.provider = event.model.provider;
		requestRender();
	});

	pi.on("thinking_level_select", (event) => {
		if (!liveData) return;
		liveData.thinkingLevel = event.level;
		requestRender();
	});

	pi.on("session_shutdown", () => {
		loadGeneration++;
		dashboardActive = false;
		liveData = null;
		capturedTui = null;
	});

	pi.registerCommand("dash", {
		description: "Toggle the startup dashboard or configure its layout",
		getArgumentCompletions: (prefix) => {
			const values = [
				"on", "off", "auto", "full", "compact", "font braille", "font pixel", "font line", "font heavy", "warnings", "clear",
			];
			const matches = values.filter((value) => value.startsWith(prefix.toLowerCase()));
			return matches.length ? matches.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const argument = args.trim().toLowerCase();
			if (!argument) {
				if (dashboardActive) {
					hideDashboard(ctx, true);
					ctx.ui.notify("Dashboard hidden; built-in header restored", "info");
				} else {
					await refreshAndShow(ctx);
				}
				return;
			}
			if (argument === "off" || argument === "hide") {
				hideDashboard(ctx, true);
				ctx.ui.notify("Dashboard hidden; built-in header restored", "info");
				return;
			}
			if (argument === "warnings" || argument === "errors") {
				if (healthWarnings.length === 0) ctx.ui.notify("No dashboard health warnings.", "info");
				else for (const warning of healthWarnings) ctx.ui.notify(warning.text, warning.severity);
				if (omittedWarnings > 0) ctx.ui.notify(`${omittedWarnings} additional warnings were omitted.`, "warning");
				return;
			}
			if (argument === "clear") {
				healthWarnings = [];
				omittedWarnings = 0;
				if (liveData) {
					liveData.warnings = [];
					liveData.omittedWarnings = 0;
				}
				requestRender();
				ctx.ui.notify("Dashboard health warnings cleared", "info");
				return;
			}
			if (argument === "auto" || argument === "full" || argument === "compact") {
				viewMode = argument;
				if (dashboardActive) requestRender();
				else await refreshAndShow(ctx);
				return;
			}
			if (
				argument === "font braille" ||
				argument === "font pixel" ||
				argument === "font line" ||
				argument === "font heavy"
			) {
				displayFont = argument.slice("font ".length) as DisplayFont;
				if (dashboardActive) requestRender();
				else await refreshAndShow(ctx);
				return;
			}
			if (argument === "on" || argument === "show") {
				await refreshAndShow(ctx);
				return;
			}
			ctx.ui.notify(`Unknown dashboard option: ${argument}`, "warning");
		},
	});
}
