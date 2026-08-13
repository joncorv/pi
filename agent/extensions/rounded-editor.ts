import {
	CustomEditor,
	type ExtensionAPI,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";

const OUTER_MARGIN = 1;
const INTERIOR_PADDING = 1;

function stripTerminalCodes(value: string): string {
	return value
		// APC sequences (including the zero-width hardware cursor marker).
		.replace(/\x1b_[\s\S]*?\x1b\\/g, "")
		// OSC sequences.
		.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
		// CSI/SGR sequences.
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function isEditorBorder(line: string, expectedWidth: number): boolean {
	const plain = stripTerminalCodes(line);
	if (visibleWidth(plain) !== expectedWidth) return false;
	return /^─+$/.test(plain) || /^─── [↑↓] \d+ more (?:─+)?$/.test(plain);
}

class RoundedEditor extends CustomEditor {
	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
		// Padding is applied explicitly around the base editor output in render(),
		// so it remains visible between the text/cursor and both vertical borders.
		super(tui, theme, keybindings, { paddingX: 0 });
	}

	render(width: number): string[] {
		const margin = width >= 8 ? OUTER_MARGIN : 0;
		const padding = width >= 8 ? INTERIOR_PADDING : 0;
		const innerWidth = width - margin * 2 - 2 - padding * 2;
		if (innerWidth < 1) return super.render(width);

		const lines = super.render(innerWidth);
		if (lines.length < 3) return lines;

		// The base editor renders: top border, text rows, bottom border,
		// then (when active) autocomplete rows. Keep autocomplete outside the box.
		const bottomBorder = lines.findIndex((line, index) => index > 0 && isEditorBorder(line, innerWidth));
		if (bottomBorder < 0) return lines;

		const leftMargin = " ".repeat(margin);
		const rightMargin = leftMargin;
		const interiorPad = " ".repeat(padding);
		const side = (glyph: string) => this.borderColor(glyph);
		const horizontalPad = side("─".repeat(padding));

		return lines.map((line, index) => {
			if (index === 0) {
				return `${leftMargin}${side("╭")}${horizontalPad}${line}${horizontalPad}${side("╮")}${rightMargin}`;
			}
			if (index < bottomBorder) {
				return `${leftMargin}${side("│")}${interiorPad}${line}${interiorPad}${side("│")}${rightMargin}`;
			}
			if (index === bottomBorder) {
				return `${leftMargin}${side("╰")}${horizontalPad}${line}${horizontalPad}${side("╯")}${rightMargin}`;
			}

			// Match the autocomplete rows to the box's content column without
			// enclosing the suggestions in the editor border.
			return `${leftMargin} ${interiorPad}${line}${interiorPad} ${rightMargin}`;
		});
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setEditorComponent((tui, theme, keybindings) =>
			new RoundedEditor(tui, theme, keybindings),
		);
	});
}
