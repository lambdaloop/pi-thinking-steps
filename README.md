# Pi Thinking Steps (v2)

Three-mode thinking-step rendering for Pi's TUI, rebuilt on the **public**
`pi.registerMarkdownTransformer` API for pi >= 0.84.3.

## Why v2 exists

v1.0.x patched Pi's internal `AssistantMessageComponent` from
`@mariozechner/pi-coding-agent@0.69.0`. Pi 0.84.3 switched the CLI to a bundled
runtime, inlining its own copy of that class — so the patch silently patched a
class the TUI never used, and the summary stopped rendering with no error.

v2 registers a `MarkdownTransformer` for the `assistant-thinking` message type
instead. That hook is public, documented, and runs inside the bundled runtime:

- it transforms the thinking block's Markdown before Pi's built-in renderer draws it
- it re-runs on streaming updates, restored messages, and width changes
- it is display-only: the original message and model context are untouched

## Modes

| Mode | Behavior |
|---|---|
| `collapsed` | One compact line: the highest-signal step, updated live while streaming |
| `summary` | Chronological top-N salient step summaries with role icons |
| `expanded` | The full thinking text, lightly sanitized |

Icons are colored by role using the active theme's palette (`success` for
verify, `error` for failures, `warning` for comparisons, `accent` for
write/plan, `mdLink` for inspect/search), embedded as ANSI codes that pass
through the built-in Markdown renderer — the same per-role coloring the v1
TUI component used.

Restore precedence: session history → project `.pi/thinking-steps.json` →
global `~/.pi/agent/state/thinking-steps.json` → `summary`.

## Controls

| Action | Control |
|---|---|
| Cycle thinking view | `Alt+T` |
| Choose a mode | `/thinking-steps` |
| Set session mode | `/thinking-steps collapsed\|summary\|expanded` |
| Save a project default | `/thinking-steps project <mode>` |
| Save a global default | `/thinking-steps global <mode>` |
| Clear a default | `/thinking-steps project\|global clear` |

## Notes

- `hideThinkingBlock: true` in settings hides the thinking block before the
  transformer runs. For `summary`/`expanded` modes set it to `false`; in
  `collapsed` mode a live preview is shown even when the block is hidden.
- The parser and summarizer (`parse.ts`, `types.ts`) are ported from
  pi-thinking-steps v1.0.11 (MIT, © Marc Mironescu / FluxGear).
