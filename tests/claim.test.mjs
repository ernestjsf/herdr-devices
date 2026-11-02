// hooks/claim.sh with HOME pointed at a scratch folder, fed fake hook JSON.
// The script walks up past its own shell to the agent, which here is this node process.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = new URL("../hooks/claim.sh", import.meta.url).pathname;
let home, claims;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "claim-"));
  claims = join(home, ".cache/herdr-devices/claims");
});

const run = (event, label = "claude") => spawnSync(script, [label], { input: JSON.stringify(event), env: { HOME: home, PATH: process.env.PATH }, encoding: "utf8" });
const pre = (tool_input = { device_id: "ABC-123" }, tool_name = "mcp__maestro__run") => run({ hook_event_name: "PreToolUse", session_id: "s", tool_name, tool_input });
const hold = (id, pid, owner) => {
  mkdirSync(join(claims, id), { recursive: true });
  if (pid) writeFileSync(join(claims, id, "pid"), `${pid}\n`);
  if (owner) writeFileSync(join(claims, id, "owner"), `${owner}\n`);
};
const pidOf = (id) => readFileSync(join(claims, id, "pid"), "utf8").trim();

test("claims the device with pid and owner", () => {
  const r = pre();
  assert.equal(r.status, 0);
  assert.equal(pidOf("ABC-123"), String(process.pid));
  assert.equal(readFileSync(join(claims, "ABC-123/owner"), "utf8").trim(), "claude");
});

test("the label goes to the owner file", () => {
  assert.equal(run({ hook_event_name: "PreToolUse", tool_name: "mcp__maestro__run", tool_input: { device_id: "X1" } }, "codex").status, 0);
  assert.equal(readFileSync(join(claims, "X1/owner"), "utf8").trim(), "codex");
});

test("my own claim passes and stays as it was", () => {
  hold("ABC-123", process.pid, "mine");
  const r = pre();
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
  assert.equal(readFileSync(join(claims, "ABC-123/owner"), "utf8").trim(), "mine");
});

test("a live foreign holder denies, naming the owner", () => {
  hold("ABC-123", process.ppid, "codex"); // the test runner: alive, not mine
  const r = pre();
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Device ABC-123 is claimed by codex since /);
  assert.equal(pidOf("ABC-123"), String(process.ppid));
});

test("a dead holder is taken over", () => {
  hold("ABC-123", spawnSync("true").pid, "codex");
  assert.equal(pre().status, 0);
  assert.equal(pidOf("ABC-123"), String(process.pid));
  assert.equal(readFileSync(join(claims, "ABC-123/owner"), "utf8").trim(), "claude");
});

test("a folder with no pid is a reservation: denied", () => {
  hold("ABC-123");
  const r = pre();
  assert.equal(r.status, 2);
  assert.match(r.stderr, /claimed by another agent/);
});

test("no device_id: nothing claimed", () => {
  assert.equal(pre({ yaml: "appId: x" }).status, 0);
  assert.equal(pre({}, "mcp__maestro__list_devices").status, 0);
  assert.equal(existsSync(claims), false);
});

test("other tools are ignored", () => {
  assert.equal(pre({ device_id: "ABC-123" }, "Bash").status, 0);
  assert.equal(pre({ device_id: "ABC-123" }, "mcp__other__run").status, 0);
  assert.equal(existsSync(claims), false);
});

test("whitespace around the colon still parses", () => {
  const r = spawnSync(script, ["claude"], { input: '{"hook_event_name" : "PreToolUse", "tool_name" : "mcp__maestro__run", "tool_input" : {"device_id" : "SP-1"}}', env: { HOME: home, PATH: process.env.PATH }, encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.equal(pidOf("SP-1"), String(process.pid));
});

test("an invalid device_id is ignored", () => {
  for (const id of ["../x", ".hidden", "a/b", ""]) assert.equal(pre({ device_id: id }).status, 0);
  assert.equal(existsSync(join(home, ".cache/herdr-devices/x")), false);
  assert.equal(existsSync(join(claims, "x")), false);
});

test("unparsable stdin exits 0", () => {
  const r = spawnSync(script, ["claude"], { input: "not json", env: { HOME: home, PATH: process.env.PATH }, encoding: "utf8" });
  assert.equal(r.status, 0);
});

test("SessionEnd releases my claims and no one else's", () => {
  hold("MINE", process.pid);
  hold("THEIRS", process.ppid);
  hold("MANUAL");
  assert.equal(run({ hook_event_name: "SessionEnd", session_id: "s" }).status, 0);
  assert.equal(existsSync(join(claims, "MINE")), false);
  assert.equal(existsSync(join(claims, "THEIRS")), true);
  assert.equal(existsSync(join(claims, "MANUAL")), true);
});

test("SessionEnd with no claims folder exits 0", () => {
  assert.equal(run({ hook_event_name: "SessionEnd" }).status, 0);
});
