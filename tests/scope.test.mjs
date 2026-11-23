import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveScope } from "../mods/aql/scope.js";

const reader = (files) => async (p) => (p in files ? files[p] : null);

test("nearest .aql-scope above cwd names the project", async () => {
  const r = await resolveScope("/a/b/c", reader({ "/a/.aql-scope": "macmini\n" }));
  assert.deepEqual(r, { project: "macmini", via: "file", path: "/a/.aql-scope" });
});

test("the nearest file wins over one further up", async () => {
  const r = await resolveScope("/a/b/c", reader({ "/a/b/.aql-scope": "proj", "/a/.aql-scope": "other" }));
  assert.equal(r.project, "proj");
});

test("a blank .aql-scope is skipped", async () => {
  const r = await resolveScope("/a/b", reader({ "/a/b/.aql-scope": "  \n", "/a/.aql-scope": "x" }));
  assert.equal(r.project, "x");
});

test("no file anywhere falls back to the folder name", async () => {
  const r = await resolveScope("/x/nodedb", reader({}));
  assert.deepEqual(r, { project: "nodedb", via: "folder", path: null });
});

test("a trailing slash still gives the folder name", async () => {
  assert.equal((await resolveScope("/x/nodedb/", reader({}))).project, "nodedb");
});

test("an unknown or root cwd has no scope", async () => {
  const none = { project: null, via: null, path: null };
  assert.deepEqual(await resolveScope(null, reader({})), none);
  assert.deepEqual(await resolveScope("/", reader({})), none);
});

test("a file at / still counts", async () => {
  assert.equal((await resolveScope("/a", reader({ "/.aql-scope": "root" }))).project, "root");
});
