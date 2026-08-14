# Claude + Codex review loop

## Preserve the current workspace

This repository may already contain user changes when a session begins. Before
making changes, inspect `git status --short` and treat every existing modified
or untracked file as a protected baseline. Do not revert, reformat, stage, or
otherwise alter baseline work unless the user explicitly asks.

Read `AGENTS.md` and then `CODEX_HANDOFF.md` before beginning a coding task.
Follow their development and verification guidance.

## `!important` is not allowed in this repository

Never write `!important` in CSS, in inline styles, or via Tailwind's `!`
utility prefix (`!hidden`, `!size-3`, …). There are no exceptions: if a rule
is not winning, fix the cascade instead of overriding it.

The cascade already gives you everything `!important` was being used for:

- **To beat a Tailwind utility**, put the rule *outside* any cascade layer.
  Tailwind v4 emits all utilities inside `@layer utilities`, and an unlayered
  rule outranks every layered one by layer precedence — which is resolved
  before specificity, so it wins no matter how specific the utility is.
- **To beat another unlayered rule of ours**, add a class to the selector or
  declare it later in the file; ordinary specificity and source order settle it.

`!important` is banned because it does not compose. Once one rule uses it, the
only way to override that rule is another `!important`, and the cascade stops
describing what actually renders. `src/index.css` had exactly this: a global
glass radius forced with `!important`, which then forced the sidebar radius to
use `!important` to beat it. Both were removed with no visual change, because
being unlayered was already sufficient.

## Required implementation and review cycle

For every coding task, complete this cycle before declaring the task finished:

1. Implement the requested change and run the relevant checks.
2. Ask Codex to review the uncommitted work from the repository root. Use this
   exact command:

   ```powershell
   codex exec -s read-only "Review the uncommitted changes made for this task. Focus on correctness, regressions, security, tests, and maintainability. Do not suggest changes to pre-existing baseline work unless the task directly modified it. If no actionable issues remain, reply with exactly [APPROVED]."
   ```

3. If the response is not exactly `[APPROVED]`, address each actionable issue,
   run the relevant checks again, and repeat the review.
4. Stop after three review rounds if approval is not reached. Summarize the
   remaining feedback clearly instead of looping forever.
5. Do not report the task complete until Codex returns `[APPROVED]` or the
   three-round limit has been reached and the unresolved issues are reported.

Codex must run in `read-only` mode for this review. It must not edit files,
stage changes, create commits, push, or publish anything.
