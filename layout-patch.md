# Layout and key patch (re-apply after a layout update)

In `~/.config/herdr-app/layouts/<layout>.json` (backup: `<layout>.json.bak-aql`):

1. Inside `work`, the `tabs` block becomes a row:
   ```json
   { "id": "tabs-row", "type": "row", "size": {"px": 42}, "resizable": false, "children": [
     <the tabs block, with "size": {"weight": 1}>,
     { "id": "aql-toggle", "type": "block", "content": {"mod": "aql", "props": {"role": "toggle"}}, "size": {"px": 88}, "window_drag": true } ] }
   ```
2. Appended to `work-body.children`:
   ```json
   { "id": "aql-panel", "type": "column", "hidden": true, "size": {"px": 380}, "min": 320, "max": 640,
     "children": [ { "id": "aql", "type": "block", "content": {"mod": "aql", "props": {"role": "panel"}} } ] }
   ```

In `~/.config/herdr-app/keys.json` (backup: `keys.json.bak-aql`):

- `global."cmd-shift-a"`: `{"command": "pane.split", "args": {"direction": "right", "mod": "aql"}}`
- `"layout:<layout>"."cmd-shift-a"`: `{"command": "layout.toggle", "args": {"id": "aql-panel"}}`

To remove: restore both backups and delete `~/.config/herdr-app/mods/aql`.
