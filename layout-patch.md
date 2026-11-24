# Layout and key patch

`<layout>` below is the name of the layout you add the panel to: its file is
`~/.config/herdr-app/layouts/<layout>.json`. Back it up first (e.g. `<layout>.json.bak-aql`), and
re-apply this patch whenever the layout file is replaced.

In `<layout>.json`:

1. Inside the work column, the tab bar block becomes a row:
   ```json
   { "id": "tabs-row", "type": "row", "size": {"px": 42}, "resizable": false, "children": [
     <the tab bar block, with "size": {"weight": 1}>,
     { "id": "aql-toggle", "type": "block", "content": {"mod": "aql", "props": {"role": "toggle"}}, "size": {"px": 88}, "window_drag": true } ] }
   ```
2. Appended to the children of the row that holds the terminal (beside any other side panel):
   ```json
   { "id": "aql-panel", "type": "column", "hidden": true, "size": {"px": 380}, "min": 320, "max": 640,
     "children": [ { "id": "aql", "type": "block", "content": {"mod": "aql", "props": {"role": "panel"}} } ] }
   ```

In `~/.config/herdr-app/keys.json` (backup: `keys.json.bak-aql`):

- `global."cmd-shift-a"`: `{"command": "pane.split", "args": {"direction": "right", "mod": "aql"}}`
- `"layout:<layout>"."cmd-shift-a"`: `{"command": "layout.toggle", "args": {"id": "aql-panel"}}`

To remove: restore both backups and delete `~/.config/herdr-app/mods/aql`.
