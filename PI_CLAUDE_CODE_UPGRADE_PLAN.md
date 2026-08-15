# Pi → Claude Code–Style Upgrade Plan

> Saved for later. No configuration changes have been made yet.

## Verdict

The best route is **not stacking more one-off extensions**. Use one cohesive Claude Code compatibility layer, then add polished rendering and project-level diagnostics.

Your Pi is already visually customized, but its workflow layer has reliability gaps.

## Current Setup

You currently have:

- Pi `0.84.2`, fullscreen TUI, high thinking
- `pi-web-access`
- Custom dashboard, rounded editor, and pill statusline
- Custom plan mode and permission prompts

Potential issues:

- The current plan mode instructs the model to use `questionnaire` and `brave-search`, but neither is installed.
- Its `/todos` and `[DONE:n]` tracking depends on the model formatting responses correctly.
- `confirm-destructive.ts` treats the existence of *any* user message as “unsaved work,” so session switching may prompt unnecessarily.
- The bash permission regex is useful as a warning, but is not a security boundary.
- There is no global `AGENTS.md`, reusable prompt collection, or skill collection to make behavior consistent across projects.

## Recommended Stack

### 1. Use `pi-code` as the cohesive foundation

[`pi-code`](https://pi.dev/packages/pi-code) is currently the closest thing to “Claude Code inside Pi.” It provides:

- Claude rules, commands, skills, hooks, and output styles
- MCP compatibility
- Plan mode
- Persistent todos
- Checkpoints and rewind
- Project memory
- Subagents
- `AskUserQuestion`
- Web tools and statusline
- Existing `.claude/` configuration support

Unlike [`@fractary/pi-claude-code`](https://github.com/fractary/pi-claude-code), which describes itself as a tool-name compatibility shim, `pi-code` aims to provide the broader experience.

Test it without changing the installation:

```bash
pi --no-extensions \
  -e npm:pi-code \
  -e npm:pi-claude-code-ui
```

Exercise `/plan`, todos, questions, `/reload`, `/fork`, and `/new` before committing.

### 2. Add Claude-style tool rendering

[`pi-claude-code-ui`](https://pi.dev/packages/pi-claude-code-ui) adds:

- Grouped tool calls
- Better read, bash, and search previews
- Shiki-highlighted diffs
- Running-output previews
- Claude-style status rows
- Expand/detail controls

This complements the existing dashboard, rounded editor, and pill footer.

Do **not** also install `pi-claude-code-tui` unless replacing the current header and editor, because it overlaps with the existing UI extensions.

### 3. Keep the better existing components and filter overlaps

A sensible eventual package configuration is:

```json
{
  "packages": [
    "npm:pi-web-access",
    {
      "source": "npm:pi-code",
      "extensions": [
        "!extensions/web.ts",
        "!extensions/status-line.ts"
      ]
    },
    "npm:pi-claude-code-ui"
  ]
}
```

This keeps the existing richer web tools and pill statusline.

Before enabling `pi-code`, move the existing `extensions/plan-mode/` outside the auto-discovered extensions directory. Otherwise there will be duplicate `/plan` and `/todos` implementations.

### 4. Add real code intelligence per project

For important repositories, consider [`pi-lens`](https://pi.dev/packages/pi-lens):

```bash
cd /path/to/project
pi install -l npm:pi-lens
```

It adds LSP diagnostics, type checking, formatters, structural analysis, and post-edit feedback.

Install it project-locally rather than globally: it is a large package, and a current issue reports roughly one second of module import overhead.

### 5. Add concise operating instructions

Create `~/.pi/agent/AGENTS.md` with durable rules such as:

- Inspect relevant files before editing.
- Keep changes scoped to the request.
- Ask before making an ambiguous architectural decision.
- Run the narrowest relevant checks after editing.
- Do not claim completion until checks pass.
- Summarize modified files and remaining risks.

Put repository-specific commands and architecture in each project's `AGENTS.md`.

Avoid one enormous global prompt; Pi skills provide progressive loading.

### 6. Treat isolation—not permission prompts—as security

Pi's [official security documentation](https://pi.dev/docs/latest/security) says project trust and permission gates are not sandboxes.

For untrusted or unattended work, use [Docker, Gondolin, or another contained environment](https://pi.dev/docs/latest/containerization).

## Suggested Rollout

1. Back up `~/.pi/agent/settings.json` and `~/.pi/agent/extensions/`.
2. Test `pi-code` plus `pi-claude-code-ui` using `--no-extensions`.
3. Test `/plan`, todos, questions, `/reload`, `/fork`, and `/new`.
4. Disable or move the existing custom plan mode.
5. Install the two packages.
6. Filter the duplicate web and statusline features.
7. Add a concise global `AGENTS.md`.
8. Add `pi-lens` only to repositories that benefit from it.
9. Consider dedicated [`pi-subagents`](https://pi.dev/packages/pi-subagents) later if `pi-code`'s built-in delegation is insufficient. Do not run both subagent systems initially.

## Installation Commands (After Testing)

```bash
pi install npm:pi-code
pi install npm:pi-claude-code-ui
```

Then update `~/.pi/agent/settings.json` with the filtered package configuration above and restart Pi.

## Sources

- [`pi-code`](https://pi.dev/packages/pi-code)
- [`pi-claude-code-ui`](https://pi.dev/packages/pi-claude-code-ui)
- [`pi-lens`](https://pi.dev/packages/pi-lens)
- [`pi-subagents`](https://pi.dev/packages/pi-subagents)
- [Pi security documentation](https://pi.dev/docs/latest/security)
- [Pi containerization documentation](https://pi.dev/docs/latest/containerization)
