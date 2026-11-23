// Runs the `aql` CLI on a machine and reads its JSON. Every call names its project, because the
// bare CLI ignores `.aql-scope`. Nothing here throws: each call resolves to
//   { ok: true, data } or { ok: false, kind: "unreachable" | "missing" | "failed", error }.
// No Herdr imports: main.js passes Herdr's exec in.

const lastLine = (s) => String(s ?? "").trim().split("\n").pop() ?? "";

export function createAql({ exec, on }) {
  let home = null;
  const where = on ?? "this Mac";
  const missing = { ok: false, kind: "missing", error: `aql isn't installed on ${where}` };

  // The machine's own home: a remote machine's isn't this Mac's.
  async function aqlPath() {
    if (!home) {
      const r = await exec("sh", ["-c", 'printf %s "$HOME"'], { on });
      home = r.stdout.trim();
    }
    return `${home}/.local/bin/aql`;
  }

  // action: a write, which may print plain text on success; reads must return JSON.
  async function call(args, timeout = 30000, action = false) {
    let path, r;
    try {
      path = await aqlPath();
    } catch (e) {
      return { ok: false, kind: "machine", error: `Couldn't reach ${where}: ${e?.message ?? e}` };
    }
    try {
      r = await exec(path, args, { on, timeout });
    } catch (e) {
      if (/time/i.test(String(e?.message ?? e))) return { ok: false, kind: "timeout", error: `aql timed out on ${where}` };
      return missing;
    }
    if (r.code === 127) return missing;
    if (r.code !== 0) {
      const error = lastLine(r.stderr) || lastLine(r.stdout) || `aql exited ${r.code}`;
      return { ok: false, kind: /unreachable/i.test(r.stderr) ? "unreachable" : "failed", error };
    }
    try {
      return { ok: true, data: JSON.parse(r.stdout) };
    } catch {
      return action ? { ok: true, data: null } : { ok: false, kind: "failed", error: "aql returned something unexpected" };
    }
  }

  const scoped = (P, ...args) => call([...args, "--project", P, "--json"]);
  const act = (P, ...args) => call([...args, "--project", P, "--json"], 30000, true);
  return {
    briefing: (P) => call(["briefing", "--brief", "--project", P, "--json"]),
    handoffs: (P) => scoped(P, "handoff", "list"),
    dying: (P) => scoped(P, "dying"),
    retention: (P) => scoped(P, "retention"),
    pending: (P) => scoped(P, "pending"),
    retrieve: (P, q) => call(["retrieve", q, "--project", P, "--json", "--top-k", "10"]),
    doctor: () => call(["doctor", "--json"], 60000),
    pin: (P, id) => act(P, "pin", id),
    unpin: (P, id) => act(P, "unpin", id),
    archive: (P, id) => act(P, "archive", id),
    approve: (P, id) => act(P, "approve", id),
    reject: (P, id) => act(P, "reject", id),
    accept: (P, id) => act(P, "handoff", "accept", id),
    cancel: (P, id) => act(P, "handoff", "cancel", id),
  };
}
