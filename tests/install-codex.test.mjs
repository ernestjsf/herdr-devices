// hooks/install-codex.sh with HOME pointed at a scratch folder.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const script = new URL("../hooks/install-codex.sh", import.meta.url).pathname;
let home, file;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "install-codex-"));
  file = join(home, ".codex/hooks.json");
});

const run = () => spawnSync(script, { env: { HOME: home, PATH: process.env.PATH }, encoding: "utf8" });
const seed = (text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };

test("no hooks.json: writes it with the absolute claim.sh path and a 10 s SessionEnd", () => {
  const r = run();
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Wrote .*hooks\.json\./);
  assert.match(r.stdout, /Run \/hooks in Codex to trust the hook\./);
  const { hooks } = JSON.parse(readFileSync(file, "utf8"));
  const claim = `${dirname(script)}/claim.sh codex`;
  assert.equal(hooks.PreToolUse[0].matcher, "mcp__.*maestro.*");
  assert.equal(hooks.PreToolUse[0].hooks[0].command, claim);
  assert.equal(hooks.PreToolUse[0].hooks[0].timeout, 10);
  assert.equal(hooks.SessionEnd[0].hooks[0].command, claim);
  assert.equal(hooks.SessionEnd[0].hooks[0].timeout, 10);
});

test("hooks.json already has claim.sh: left alone", () => {
  const text = '{"hooks":{"PreToolUse":[{"hooks":[{"command":"/x/claim.sh codex"}]}]}}';
  seed(text);
  const r = run();
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Already installed in/);
  assert.equal(readFileSync(file, "utf8"), text);
});

test("hooks.json without claim.sh: left alone, entries printed", () => {
  seed('{"hooks":{}}');
  const r = run();
  assert.equal(r.status, 0);
  assert.match(r.stdout, /"PreToolUse".*claim\.sh codex/);
  assert.match(r.stdout, /"SessionEnd".*"timeout": 10/);
  assert.match(r.stdout, /Merge these into .*hooks\.json\./);
  assert.equal(readFileSync(file, "utf8"), '{"hooks":{}}');
});
