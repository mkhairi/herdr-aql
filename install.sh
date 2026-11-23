#!/bin/sh
# Copies the mod into Herdr's home; Herdr reloads it within a second.
set -e
cd "$(dirname "$0")"
dest="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/aql"
mkdir -p "$dest"
rsync -a --delete --exclude jsconfig.json --exclude gpui-kit.d.ts mods/aql/ "$dest/"
echo "installed to $dest"
