// Which AQL project a folder belongs to, by AQL's own capture rule: the nearest `.aql-scope` at or
// above it (its first non-blank line), else the folder's name. No Herdr imports: main.js passes
// readText in, so it reads on the focused space's machine.
const NONE = { project: null, via: null, path: null };

export async function resolveScope(cwd, readText) {
  const parts = String(cwd ?? "").split("/").filter(Boolean);
  if (!cwd || !parts.length) return NONE;
  for (let n = parts.length; n >= 0; n--) {
    const path = `/${parts.slice(0, n).join("/")}${n ? "/" : ""}.aql-scope`;
    const text = await readText(path).catch(() => null);
    const project = String(text ?? "").split("\n").map((l) => l.trim()).find(Boolean);
    if (project) return { project, via: "file", path };
  }
  return { project: parts[parts.length - 1], via: "folder", path: null };
}
