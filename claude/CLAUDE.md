# Goosic Claude Code Agent Routing

Use these custom agents for bounded work and keep ownership with the main
Claude session:

- `code-explorer` — read-only discovery before broad repository work.
- `quick-implementer` — small, explicit, low-risk changes.
- `implementer` — multi-file features and bug fixes.
- `code-validator` — focused read-only tests, builds, lint, or type checks.
- `code-reviewer` — independent review of high-risk or difficult changes.
- `commit-pusher` — only after the user explicitly requests both commit and
  push.

Delegate non-trivial work only when the task has a clear boundary. Give each
agent explicit file ownership, preserve unrelated user changes, and keep
validation separate from implementation when practical. Never commit or push
without explicit user authorization.

For Goosic work, read `AGENTS.md` and `CODEX_HANDOFF.md` before changing files.
Use the repository's existing commands and visual/native architecture. Do not
create project-specific agents unless the user explicitly asks for them.
