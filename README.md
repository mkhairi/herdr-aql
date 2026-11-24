# herdr-aql

A side panel for [Herdr](https://herdr.dev) that shows what AQL knows
about the project you're working in. Open it at the start of a session to see the handoff the last
session left, and hand it to your agent in one click.

It follows focus. Switch to another agent or space and the panel shows that folder's AQL scope.

## What's in the panel

- **Scope**
  - The folder's open handoffs. The ones agents wrote on purpose come first; the ones the
    session-end hook wrote are folded into "N from session hooks".
  - Pinned rules, counts, and items due for review.
  - **Hand to agent** pastes a handoff into the agent's input without sending it, so you can read
    it first. It does not accept the handoff; the agent does that once it picks it up.
- **Search:** `aql retrieve` in the current scope.
- **Decay:** retention summary and the knowledge closest to being archived, with Pin and Archive.
- **Health:** `aql doctor` and items waiting for approval.

The toggle in the tab bar shows a dot when an agent-written handoff less than a week old is waiting.

The panel never writes memories. Writing stays with agents, through MCP.

## Requirements

- Herdr (tested on 0.1.17, macOS) with a layout, or any layout you're willing to patch.
- `aql` at `~/.local/bin/aql` on each machine you use it on, set up so that `aql briefing` works
  from a shell (it reads `~/.config/aql/client.env` itself). Tested with 0.9.28.

## Install

```sh
./install.sh
```

This copies `mods/aql/` to `~/.config/herdr-app/mods/aql/` (or `$HERDR_APP_HOME/mods/aql/`).
Herdr reloads it within a second.

Then add the toggle, the panel column and the keys to your layout. See
[layout-patch.md](layout-patch.md). Once that's done:

- `⌘⇧A` in the layout shows or hides the panel.
- `⌘⇧A` in any other layout opens the panel as a pane.

## How the scope is chosen

The panel uses the same rule as AQL's capture: the nearest `.aql-scope` file at or above the
focused terminal's folder, whose first non-blank line names the project, otherwise the folder's
name. Every `aql` call passes `--project` explicitly, because the bare CLI ignores `.aql-scope`.

If the folder can't be read (for example, its machine is unreachable), the panel shows an error
instead of guessing a scope.

On a remote space, `aql` runs on that machine, from that machine's `~/.local/bin`.

## Development

```sh
npm test
```

The tests cover the parts that don't depend on Herdr: `scope.js`, `model.js` and `aql.js`.
`main.js` is the Herdr UI and is checked by hand.

- Design: [docs/design.md](docs/design.md)
- Implementation plan: [docs/plans/2026-11-23-aql-panel.md](docs/plans/2026-11-23-aql-panel.md)

## Remove

Restore `layouts/<layout>.json.bak-aql` and `keys.json.bak-aql` in `~/.config/herdr-app/`, then
delete `~/.config/herdr-app/mods/aql`.
