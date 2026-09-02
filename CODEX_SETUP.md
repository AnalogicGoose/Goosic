# Goosic Codex Setup

This document is the portable setup guide for using Codex with the Goosic
repository on a new computer. `CODEX_HANDOFF.md` remains the source of truth
for Goosic's product architecture and development rules; this file covers the
Codex environment around the repository.

## What is portable

The following can be recreated on macOS or Windows:

- The global Codex agent definitions from
  [`nsEytgXm/subagents_configs`](https://github.com/nsEytgXm/subagents_configs).
- The six custom agents: `code-explorer`, `quick-implementer`, `implementer`,
  `code-validator`, `code-reviewer`, and `commit-pusher`.
- The shared `SUBAGENT_ROUTING.md` rules.
- The multi-agent feature configuration.
- The list of enabled Codex plugin IDs documented below.
- This repository's `AGENTS.md` and `CODEX_HANDOFF.md` instructions.
- The Claude Code setup under [`claude/`](claude/), using `haiku`, `sonnet`,
  and `opus` only.

Plugin login sessions, OAuth tokens, local executable paths, caches, and
machine-specific MCP settings are not portable and must be configured again on
each computer.

## Fresh-computer checklist

1. Install and sign in to the latest Codex app.
2. Clone Goosic and read [`AGENTS.md`](AGENTS.md) and
   [`CODEX_HANDOFF.md`](CODEX_HANDOFF.md) before making changes.
3. Install the global subagents configuration using the instructions below.
4. Enable or install the plugin IDs in the table below through Codex's plugin
   manager, then sign in to any service that requires authentication.
5. Restart Codex so agents, global instructions, and plugin changes reload.
6. Open Goosic and verify that the repository is trusted by Codex.

## Install the global subagents

The installer is guarded: it validates the source TOML files, preserves
unrelated settings, backs up files it changes, and installs into the current
user's Codex directory.

### macOS

Run in Terminal:

```sh
git clone https://github.com/nsEytgXm/subagents_configs
cd subagents_configs
./install.sh
```

The default destination is `~/.codex/`.

### Windows

Run the same commands from Git Bash. Git Bash's home directory should resolve
to the Windows user profile used by Codex. Do not run it only inside a WSL home
directory unless Codex itself is running in that same WSL environment.

The normal Windows destination is:

```text
C:\Users\<your-user>\.codex\
```

Do not copy the complete macOS `config.toml` to Windows. It may contain
machine-specific paths, MCP commands, notification commands, and plugin
marketplace locations. Re-run the guarded installer and merge other settings
manually only when needed.

## Installed agent files

The installer places these files in `~/.codex/agents/`:

| Agent | Use |
| --- | --- |
| `code-explorer` | Read-only repository discovery and contract tracing |
| `quick-implementer` | Small, localized changes |
| `implementer` | Features, bug fixes, and unit tests |
| `code-validator` | Focused test, build, lint, or type-check verification |
| `code-reviewer` | Independent review of high-risk or difficult changes |
| `commit-pusher` | Commit and push only after explicit user authorization |

It also installs `~/.codex/SUBAGENT_ROUTING.md`, adds a managed import block to
`~/.codex/AGENTS.md`, and enables:

```toml
[features.multi_agent_v2]
hide_spawn_agent_metadata = false
tool_namespace = "agents"
```

The installer creates `.subagents_configs-state.json` to track managed files.
Run the installer a second time to check that the setup is unchanged and
idempotent.

## Enabled plugin set

This is the enabled plugin set on the reference Goosic Codex environment. On a
new computer, use these IDs as the target list. Some are bundled with Codex;
others may require enabling a marketplace or signing in again.

| Plugin ID | Category |
| --- | --- |
| `gmail@openai-curated` | Gmail |
| `canva@openai-curated` | Canva |
| `github@openai-curated` | GitHub |
| `figma@openai-curated` | Figma |
| `documents@openai-primary-runtime` | Documents |
| `spreadsheets@openai-primary-runtime` | Spreadsheets |
| `presentations@openai-primary-runtime` | Presentations |
| `expo@claude-plugins-official` | Expo |
| `pdf@openai-primary-runtime` | PDFs |
| `template-creator@openai-primary-runtime` | Templates |
| `sites@openai-bundled` | Sites |
| `chrome@openai-bundled` | Chrome control |
| `computer-use@openai-bundled` | Computer use |
| `visualize@openai-bundled` | Visualizations |
| `browser@openai-bundled` | In-app browser |
| `codex-app-tools@openai-bundled` | Codex app tools |

The following marketplaces are referenced by the reference configuration:

- `openai-bundled` — local marketplace supplied by the Codex installation.
- `openai-primary-runtime` — local runtime marketplace supplied by Codex.
- `claude-plugins-official` — Git marketplace from Anthropic's official
  repository.

Marketplace paths are installation-specific. Recreate them through Codex's
plugin manager rather than copying the paths from another computer.

## Claude Code version

The [`claude/`](claude/) directory contains a separate Claude Code version of
the same agent workflow. Claude agents are Markdown files with YAML frontmatter
and are installed globally in `~/.claude/agents/`; they are not the Codex TOML
files.

From the Goosic repository, run:

```sh
./claude/install.sh
```

The Claude mapping is intentionally:

- `haiku`: `code-explorer`, `quick-implementer`, `code-validator`, and
  `commit-pusher`.
- `sonnet`: `implementer`.
- `opus`: `code-reviewer`.

The installer backs up changed Claude files, adds a managed import to
`~/.claude/CLAUDE.md`, and records its state in
`~/.claude/.goosic-claude-state.json`. Claude Code plugin integrations and
service logins remain separate from Codex and must be configured in Claude.

## Backup and safety rules

Before changing an existing Codex installation, back up at least:

- `~/.codex/config.toml`
- `~/.codex/AGENTS.md`
- `~/.codex/agents/`, if it exists

The subagents installer creates timestamped `.subagents_configs.bak-*` files
when it replaces existing files. Keep the backups until the new Codex setup has
been tested. Never overwrite the complete configuration just to add agents or
plugins; preserve unrelated projects, MCP servers, notifications, model
preferences, and desktop settings.

## Verification

After installation, verify that:

```sh
python3 - <<'PY'
from pathlib import Path
import tomllib

home = Path.home() / ".codex"
with (home / "config.toml").open("rb") as f:
    config = tomllib.load(f)
assert "multi_agent_v2" in config.get("features", {})

for path in sorted((home / "agents").glob("*.toml")):
    with path.open("rb") as f:
        agent = tomllib.load(f)
    assert agent.get("name")
    assert agent.get("model")
    assert agent.get("developer_instructions")
    print("OK", path.name, "=>", agent["name"])
PY
```

Then restart Codex and confirm the six exact agent names are available. The
Goosic repository should remain clean:

```sh
git status -sb
```

## Project-specific agents

Goosic currently does not include `.codex/agents/`. Do not create project
agents during a general setup. If the team later adds them, they should be
focused on Goosic-specific work such as Tauri/Rust, React, macOS AppKit,
WKWebView, Liquid Glass, and native UI integration, while the global agents
remain reusable across repositories.

## Important restrictions

- Do not commit personal Codex configuration, authentication files, OAuth
  tokens, or machine-specific paths to Goosic.
- Do not copy `~/.codex/auth.json` between computers.
- Do not copy the entire `config.toml` between operating systems.
- Do not modify Goosic source code merely to install Codex agents or plugins.
- Do not commit or push setup changes unless explicitly requested.
