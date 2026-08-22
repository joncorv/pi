import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ALLOWED_KEYS = ["FIRECRAWL_API_KEY"] as const;
type LoadStatus = "loaded" | "inherited" | "missing" | "insecure" | "invalid";

/**
 * Load only explicitly allowlisted credentials from ~/.pi/agent/.env.
 *
 * Pi extensions already run with the user's permissions. This loader avoids
 * executing the file as shell code, refuses group/world-readable files, never
 * replaces credentials inherited from the launching environment, and never
 * prints credential values.
 */
export default function envLoader(pi: ExtensionAPI) {
	const envPath = join(getAgentDir(), ".env");
	let status: LoadStatus = ALLOWED_KEYS.some((key) => Boolean(process.env[key]?.trim()))
		? "inherited"
		: "missing";

	try {
		const mode = statSync(envPath).mode & 0o777;
		if ((mode & 0o077) !== 0) {
			status = "insecure";
		} else {
			const parsed = parseEnv(readFileSync(envPath, "utf8"));
			let loaded = false;
			for (const key of ALLOWED_KEYS) {
				if (process.env[key]?.trim()) continue;
				const value = parsed[key]?.trim();
				if (!value) continue;
				process.env[key] = value;
				loaded = true;
			}
			status = loaded
				? "loaded"
				: ALLOWED_KEYS.some((key) => Boolean(process.env[key]?.trim()))
					? "inherited"
					: "missing";
		}
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		status = code === "ENOENT" ? status : "invalid";
	}

	pi.on("session_start", (_event, ctx) => {
		if (status === "insecure") {
			ctx.ui.notify(
				"agent/.env was not loaded because its permissions are not owner-only. Run: chmod 600 ~/.pi/agent/.env",
				"warning",
			);
		}
		if (status === "invalid") {
			ctx.ui.notify("agent/.env could not be parsed; credentials were not loaded.", "warning");
		}
	});
}
