import { test } from "node:test";
import assert from "node:assert/strict";
import { createAql } from "../mods/aql/aql.js";

// A fake Herdr exec: answers $HOME lookups, records aql calls, replies with `reply(args)`.
function fakeExec(reply) {
  const calls = [];
  const exec = async (command, args, opts) => {
    if (command === "sh") { calls.push({ home: true, opts }); return { code: 0, stdout: "/home/k", stderr: "" }; }
    calls.push({ command, args, opts });
    return reply(args);
  };
  return { exec, calls };
}
const ok = (data) => () => ({ code: 0, stdout: JSON.stringify(data), stderr: "" });

test("briefing runs aql on the machine with an explicit project and --json", async () => {
  const f = fakeExec(ok({ total: 22 }));
  const r = await createAql({ exec: f.exec, on: "dev" }).briefing("macmini");
  assert.deepEqual(r, { ok: true, data: { total: 22 } });
  const call = f.calls.find((c) => c.command);
  assert.equal(call.command, "/home/k/.local/bin/aql");
  assert.deepEqual(call.args, ["briefing", "--brief", "--project", "macmini", "--json"]);
  assert.equal(call.opts.on, "dev");
});

test("the machine's home is looked up once", async () => {
  const f = fakeExec(ok({}));
  const aql = createAql({ exec: f.exec, on: null });
  await aql.briefing("p"); await aql.handoffs("p");
  assert.equal(f.calls.filter((c) => c.home).length, 1);
});

test("an unreachable server is reported with the CLI's own line", async () => {
  const f = fakeExec(() => ({ code: 1, stdout: "", stderr: "error: aql-server unreachable at http://brain:7400: io: Connection refused\n" }));
  const r = await createAql({ exec: f.exec, on: null }).briefing("p");
  assert.deepEqual(r, { ok: false, kind: "unreachable", error: "error: aql-server unreachable at http://brain:7400: io: Connection refused" });
});

test("aql missing on a machine says which machine", async () => {
  const exec = async (command) => { if (command === "sh") return { code: 0, stdout: "/h", stderr: "" }; throw new Error("No such file"); };
  assert.deepEqual(await createAql({ exec, on: "dev" }).briefing("p"), { ok: false, kind: "missing", error: "aql isn't installed on dev" });
  const exec127 = async (command) => (command === "sh" ? { code: 0, stdout: "/h", stderr: "" } : { code: 127, stdout: "", stderr: "not found" });
  assert.equal((await createAql({ exec: exec127, on: null }).briefing("p")).error, "aql isn't installed on this Mac");
});

test("other failures carry the last stderr line", async () => {
  const f = fakeExec(() => ({ code: 2, stdout: "", stderr: "warn\nerror: no such object\n" }));
  assert.deepEqual(await createAql({ exec: f.exec, on: null }).pin("p", "X"), { ok: false, kind: "failed", error: "error: no such object" });
});

test("output that isn't JSON is a failure, not a crash", async () => {
  const f = fakeExec(() => ({ code: 0, stdout: "hello", stderr: "" }));
  assert.deepEqual(await createAql({ exec: f.exec, on: null }).dying("p"), { ok: false, kind: "failed", error: "aql returned something unexpected" });
});

test("retrieve passes the query as one argument", async () => {
  const f = fakeExec(ok({ hits: [] }));
  await createAql({ exec: f.exec, on: null }).retrieve("p", "a b; rm -rf");
  assert.deepEqual(f.calls.find((c) => c.command).args, ["retrieve", "a b; rm -rf", "--project", "p", "--json", "--top-k", "10"]);
});

test("each action builds the command the CLI expects", async () => {
  const f = fakeExec(ok({}));
  const aql = createAql({ exec: f.exec, on: null });
  await aql.handoffs("p"); await aql.dying("p"); await aql.retention("p"); await aql.pending("p"); await aql.doctor();
  await aql.pin("p", "I"); await aql.unpin("p", "I"); await aql.archive("p", "I");
  await aql.approve("p", "I"); await aql.reject("p", "I"); await aql.accept("p", "H"); await aql.cancel("p", "H");
  assert.deepEqual(f.calls.filter((c) => c.command).map((c) => c.args.join(" ")), [
    "handoff list --project p --json",
    "dying --project p --json",
    "retention --project p --json",
    "pending --project p --json",
    "doctor --json",
    "pin I --project p --json",
    "unpin I --project p --json",
    "archive I --project p --json",
    "approve I --project p --json",
    "reject I --project p --json",
    "handoff accept H --project p --json",
    "handoff cancel H --project p --json",
  ]);
});

test("doctor gets a longer timeout", async () => {
  const f = fakeExec(ok({ checks: [] }));
  await createAql({ exec: f.exec, on: null }).doctor();
  assert.equal(f.calls.find((c) => c.command).opts.timeout, 60000);
});

test("Final #5: an unreachable machine is not reported as aql missing", async () => {
  const exec = async () => { throw new Error("machine unavailable"); };
  const r = await createAql({ exec, on: "dev" }).briefing("p");
  assert.equal(r.kind, "machine");
  assert.equal(r.error, "Couldn't reach dev: machine unavailable");
});

test("Final #5: a timeout is reported as a timeout", async () => {
  const exec = async (c) => { if (c === "sh") return { code: 0, stdout: "/h", stderr: "" }; throw new Error("timed out after 30000 ms"); };
  const r = await createAql({ exec, on: null }).briefing("p");
  assert.deepEqual(r, { ok: false, kind: "timeout", error: "aql timed out on this Mac" });
});

test("Final #7: accept and cancel name the handoff's project", async () => {
  const f = fakeExec(ok({}));
  const aql = createAql({ exec: f.exec, on: null });
  await aql.accept("p", "H"); await aql.cancel("p", "H");
  assert.deepEqual(f.calls.filter((c) => c.command).map((c) => c.args.join(" ")), [
    "handoff accept H --project p --json",
    "handoff cancel H --project p --json",
  ]);
});

test("Final (declined-to-judge): an action that succeeds without JSON is still a success", async () => {
  const f = fakeExec(() => ({ code: 0, stdout: "pinned 01ABC\n", stderr: "" }));
  assert.deepEqual(await createAql({ exec: f.exec, on: null }).pin("p", "X"), { ok: true, data: null });
});
