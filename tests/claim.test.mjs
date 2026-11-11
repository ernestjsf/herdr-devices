// hooks/claim.sh with HOME pointed at a scratch folder, fed fake hook JSON.
// The script walks up past its own shell to the agent, which here is this node process.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dropClaimArgv } from "../mods/devices/devices.js";

const script = new URL("../hooks/claim.sh", import.meta.url).pathname;
let home, claims;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "claim-"));
  claims = join(home, ".cache/herdr-devices/claims");
  withBooted([]); // never this machine's simulators
});

const run = (event, label = "claude", env = {}) => spawnSync(script, [label], { input: JSON.stringify(event), env: { HOME: home, PATH: `${join(home, "bin")}:${process.env.PATH}`, ...env }, encoding: "utf8" });
const pre = (tool_input = { device_id: "ABC-123" }, tool_name = "mcp__maestro__run", env = {}) => run({ hook_event_name: "PreToolUse", session_id: "s", tool_name, tool_input }, "claude", env);
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

test("read-only Maestro tools pass without claiming, even a held device", () => {
  hold("ABC-123", process.ppid, "codex");
  for (const tool of ["mcp__maestro__take_screenshot", "mcp__maestro__inspect_screen"]) assert.equal(pre({ device_id: "ABC-123" }, tool).status, 0);
  assert.equal(pre({ device_id: "NEW-1" }, "mcp__maestro__inspect_screen").status, 0);
  assert.equal(existsSync(join(claims, "NEW-1")), false);
  assert.equal(pidOf("ABC-123"), String(process.ppid));
});

test("a Maestro server installed as a plugin is claimed too", () => {
  assert.equal(pre({ device_id: "P-1" }, "mcp__plugin_x_maestro__run").status, 0);
  assert.equal(pidOf("P-1"), String(process.pid));
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

const startOf = (pid) => spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C", TZ: "UTC" } }).stdout.trim();

test("the recorded start doesn't depend on the hook's time zone", () => {
  const r = spawnSync(script, ["claude"], { input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "mcp__maestro__run", tool_input: { device_id: "TZ-1" } }), env: { HOME: home, PATH: process.env.PATH, TZ: "Asia/Tokyo", LC_ALL: "de_DE.UTF-8" }, encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.equal(readFileSync(join(claims, "TZ-1/start"), "utf8").trim(), startOf(process.pid));
});

test("when ps can't answer, a held claim is denied, not taken over", () => {
  hold("ABC-123", spawnSync("true").pid, "codex"); // dead, but ps is broken so that can't be known
  const bin = join(home, "bin"); writeFileSync(join(bin, "ps"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const r = spawnSync(script, ["claude"], { input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "mcp__maestro__run", tool_input: { device_id: "ABC-123" } }), env: { HOME: home, PATH: `${bin}:${process.env.PATH}` }, encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.equal(readFileSync(join(claims, "ABC-123/owner"), "utf8").trim(), "codex");
});

test("the claim records the holder's start, as ps prints it", () => {
  assert.equal(pre().status, 0);
  assert.equal(readFileSync(join(claims, "ABC-123/start"), "utf8").trim(), startOf(process.pid));
});

test("a live holder whose recorded start matches denies; a reused pid is taken over", () => {
  hold("ABC-123", process.ppid, "codex");
  writeFileSync(join(claims, "ABC-123/start"), `${startOf(process.ppid)}\n`);
  const r = pre();
  assert.equal(r.status, 2);
  assert.match(r.stderr, /claimed by codex since \S/);
  writeFileSync(join(claims, "ABC-123/start"), "Thu Jan  1 00:00:00 2020\n"); // the pid now belongs to another process
  assert.equal(pre().status, 0);
  assert.equal(pidOf("ABC-123"), String(process.pid));
  assert.equal(readFileSync(join(claims, "ABC-123/owner"), "utf8").trim(), "claude");
});

test("a takeover leaves no folder behind", () => {
  hold("ABC-123", spawnSync("true").pid, "codex");
  assert.equal(pre().status, 0);
  assert.deepEqual(readdirSync(claims), ["ABC-123"]);
});

test("chromium is Maestro's web browser, not a device: never claimed", () => {
  assert.equal(pre({ device_id: "chromium" }).status, 0);
  assert.equal(existsSync(join(claims, "chromium")), false);
});

// The panel's sweep of a stale claim (devices.js), run as the panel runs it.
const drop = (id, pid) => { const [cmd, ...args] = dropClaimArgv(claims, id, pid); return spawnSync(cmd, args, { encoding: "utf8" }); };

test("the panel's sweep removes a claim still held by the pid it saw gone", () => {
  hold("ABC-123", 999999, "codex");
  assert.equal(drop("ABC-123", 999999).status, 0);
  assert.deepEqual(readdirSync(claims), []);
  hold("ABC-123", " 999999\r", "codex"); // a hand-written pid file
  drop("ABC-123", 999999);
  assert.deepEqual(readdirSync(claims), []);
});

test("the panel's sweep leaves a claim taken over since, and one under takeover", () => {
  hold("ABC-123", process.pid, "claude");
  assert.equal(drop("ABC-123", 999999).status, 0);
  assert.equal(pidOf("ABC-123"), String(process.pid));
  hold("SP-1", 999999, "codex");
  mkdirSync(join(claims, ".takeover.SP-1"));
  assert.equal(drop("SP-1", 999999).status, 0);
  assert.equal(pidOf("SP-1"), "999999");
});

test("the panel's sweep refuses an id or folder that could climb out", () => {
  for (const [dir, id, pid] of [[claims, "..", 5], [claims, "a/b", 5], ["", "A", 5], [claims, "A", null]]) assert.throws(() => dropClaimArgv(dir, id, pid));
});

// The xcrun on the hook's PATH prints these booted simulators, as `simctl list devices booted` does.
const U1 = "11111111-1111-1111-1111-111111111111", U2 = "22222222-2222-2222-2222-222222222222";
function withBooted(lines) {
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "xcrun"), `#!/bin/sh\ncat <<'EOT'\n== Devices ==\n-- iOS 26.1 --\n${lines.join("\n")}\nEOT\n`);
  chmodSync(join(bin, "xcrun"), 0o755);
}
const holdLive = (id) => { // a hook's claim, held by the test runner
  hold(id, process.ppid, "codex");
  writeFileSync(join(claims, id, "start"), `${startOf(process.ppid)}\n`);
};
const age = (id, minutes) => { const at = new Date(Date.now() - minutes * 60000); utimesSync(join(claims, id, "pid"), at, at); };

test("a denial names the booted devices nobody claims", () => {
  holdLive(U1);
  withBooted([`    iPhone 17 Pro (${U1}) (Booted) `, `    iPad (A16) (${U2}) (Booted) `]);
  const r = pre({ device_id: U1 });
  assert.equal(r.status, 2);
  assert.match(r.stderr, new RegExp(`Free booted devices: iPad \\(A16\\) \\(${U2}\\)\\. Use one of them, or ask`));
  assert.doesNotMatch(r.stderr, /iPhone 17 Pro/);
  assert.deepEqual(readdirSync(claims), [U1]); // the list's scratch file is gone
});

test("a denial that sees no free device says to list them", () => {
  holdLive(U1);
  withBooted([`    iPhone 17 Pro (${U1}) (Booted) `]);
  const r = pre({ device_id: U1 });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Call list_devices and pick another device, or ask/);
});

test("PostToolUse stamps the holder's claim, and never claims or denies", () => {
  const post = (id) => run({ hook_event_name: "PostToolUse", tool_name: "mcp__maestro__run", tool_input: { device_id: id }, tool_response: {} });
  hold("ABC-123", process.pid, "claude");
  age("ABC-123", 60);
  assert.equal(post("ABC-123").status, 0);
  assert.ok(Date.now() - statSync(join(claims, "ABC-123/pid")).mtimeMs < 5000);
  assert.equal(post("FREE-1").status, 0);
  assert.equal(existsSync(join(claims, "FREE-1")), false);
  holdLive("SP-1");
  assert.equal(post("SP-1").status, 0);
});

test("the holder's calls stamp its claim, looking too", () => {
  for (const tool of ["mcp__maestro__run", "mcp__maestro__inspect_screen"]) {
    hold("ABC-123", process.pid, "claude");
    age("ABC-123", 60);
    assert.equal(pre({ device_id: "ABC-123" }, tool).status, 0);
    assert.ok(Date.now() - statSync(join(claims, "ABC-123/pid")).mtimeMs < 5000);
  }
});

test("a live holder's claim left alone for 15 minutes is taken over; a fresher one denies", () => {
  holdLive("ABC-123");
  age("ABC-123", 14);
  assert.equal(pre().status, 2);
  age("ABC-123", 16);
  assert.equal(pre().status, 0);
  assert.equal(pidOf("ABC-123"), String(process.pid));
  assert.deepEqual(readdirSync(claims), ["ABC-123"]);
});

test("HERDR_DEVICES_IDLE_MIN sets the minutes; a claim made by hand never counts as idle", () => {
  holdLive("ABC-123");
  age("ABC-123", 16);
  assert.equal(pre(undefined, undefined, { HERDR_DEVICES_IDLE_MIN: "30" }).status, 2);
  hold("SP-1", process.ppid, "me"); // no start file
  age("SP-1", 600);
  assert.equal(pre({ device_id: "SP-1" }).status, 2);
});
