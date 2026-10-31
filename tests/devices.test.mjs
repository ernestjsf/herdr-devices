// The mod's parsing and command building, on output captured from macOS.
// Fixtures: simctl-devices.json, emulator-list-avds.txt and adb-devices-empty.txt
// are real (home folder renamed); the *-mixed, *-noisy and adb-emu-avd-name
// files are written by hand in the tools' exact formats, since this machine
// had no running emulator or phone. Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as D from "../mods/devices/devices.js";

const fixture = (name) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

test("runtime ids read as OS and version", () => {
  assert.equal(D.runtimeLabel("com.apple.CoreSimulator.SimRuntime.iOS-26-0"), "iOS 26.0");
  assert.equal(D.runtimeLabel("com.apple.CoreSimulator.SimRuntime.watchOS-11-2"), "watchOS 11.2");
  assert.equal(D.runtimeLabel("com.apple.CoreSimulator.SimRuntime.xrOS-2-1"), "visionOS 2.1");
  assert.equal(D.runtimeLabel("something-else"), "something-else");
});

test("simctl: this machine's list", () => {
  const sections = D.parseSimctl(fixture("simctl-devices.json"));
  assert.deepEqual(sections.map((s) => s.title), ["iOS 26.5"]);
  const devices = sections[0].devices;
  assert.equal(devices.length, 5);
  assert.deepEqual(devices.find((d) => d.name === "iPhone 17 Pro"), { kind: "sim", id: "B6717390-90FF-479E-8F22-5297D5212A0F", name: "iPhone 17 Pro", state: "on" });
  assert.equal(devices.find((d) => d.name === "iPad Pro 13-inch (M5)").state, "off");
});

test("simctl: unavailable hidden, empty runtimes dropped, iOS newest first", () => {
  const sections = D.parseSimctl(fixture("simctl-devices-mixed.json"));
  assert.deepEqual(sections.map((s) => s.title), ["iOS 26.0", "iOS 18.2", "watchOS 11.2"]);
  assert.deepEqual(sections[1].devices.map((d) => d.name), ["iPhone 16"]);
  assert.equal(sections[0].devices.find((d) => d.name === "iPad Air").state, "booting");
});

test("avds: names only, emulator chatter dropped", () => {
  assert.deepEqual(D.parseAvds(fixture("emulator-list-avds.txt")), ["parity-api36"]);
  assert.deepEqual(D.parseAvds(fixture("emulator-list-avds-noisy.txt")), ["parity-api36", "Pixel_9_API_35"]);
  assert.deepEqual(D.parseAvds(""), []);
});

test("adb devices -l", () => {
  assert.deepEqual(D.parseAdbDevices(fixture("adb-devices-empty.txt")), []);
  assert.deepEqual(D.parseAdbDevices(fixture("adb-devices-mixed.txt")), [
    { serial: "emulator-5554", state: "device", model: "sdk gphone64 arm64" },
    { serial: "emulator-5556", state: "offline", model: null },
    { serial: "R58M12ABCDE", state: "device", model: "SM A546B" },
    { serial: "0A281FDD4003XZ", state: "unauthorized", model: null },
  ]);
  assert.deepEqual(D.parseAdbDevices("* daemon not running; starting now at tcp:5037\n* daemon started successfully\nList of devices attached\n\n"), []);
});

test("emu avd name: first line, CRLF stripped", () => {
  assert.equal(D.parseEmuAvdName(fixture("adb-emu-avd-name.txt")), "parity-api36");
  assert.equal(D.parseEmuAvdName(""), null);
});

test("android rows: running AVDs mapped by serial, others off, phones by model", () => {
  const avds = D.parseAvds(fixture("emulator-list-avds-noisy.txt"));
  const adb = D.parseAdbDevices(fixture("adb-devices-mixed.txt"));
  const rows = D.androidDevices(avds, adb, { "emulator-5554": "parity-api36" });
  assert.deepEqual(rows, [
    { kind: "avd", id: "emulator-5554", serial: "emulator-5554", avd: "parity-api36", name: "parity-api36", state: "on" },
    { kind: "avd", id: "Pixel_9_API_35", avd: "Pixel_9_API_35", name: "Pixel_9_API_35", state: "off" },
    { kind: "avd", id: "emulator-5556", serial: "emulator-5556", avd: null, name: "emulator-5556", state: "offline" },
    { kind: "phone", id: "R58M12ABCDE", serial: "R58M12ABCDE", name: "SM A546B", state: "on" },
    { kind: "phone", id: "0A281FDD4003XZ", serial: "0A281FDD4003XZ", name: "0A281FDD4003XZ", state: "unauthorized" },
  ]);
  assert.deepEqual(D.androidDevices(D.parseAvds(fixture("emulator-list-avds.txt")), [], {}), [{ kind: "avd", id: "parity-api36", avd: "parity-api36", name: "parity-api36", state: "off" }]);
});

test("tool candidates: PATH, then the SDK's homes", () => {
  assert.deepEqual(D.toolCandidates("adb", { androidHome: "/sdk/", sdkRoot: "", home: "/Users/me" }), ["adb", "/sdk/platform-tools/adb", "/Users/me/Library/Android/sdk/platform-tools/adb"]);
  assert.deepEqual(D.toolCandidates("emulator", { androidHome: "", sdkRoot: "", home: "/Users/me" }), ["emulator", "/Users/me/Library/Android/sdk/emulator/emulator"]);
  assert.deepEqual(D.toolCandidates("xcrun", { home: "/Users/me" }), ["xcrun"]);
});

test("avd ini and error lines", () => {
  assert.equal(D.parseAvdIni("avd.ini.encoding=UTF-8\npath=/Users/me/.android/avd/parity-api36.avd\npath.rel=avd/parity-api36.avd\n"), "/Users/me/.android/avd/parity-api36.avd");
  assert.equal(D.parseAvdIni(null), null);
  assert.equal(D.errorLine({ code: 148, stderr: "An error was encountered processing the command (domain=com.apple.CoreSimulator.SimError, code=405):\nUnable to shutdown device in current state: Shutdown\n", stdout: "" }), "Unable to shutdown device in current state: Shutdown");
  assert.equal(D.errorLine({ code: 1, stderr: "", stdout: "" }), "exit code 1");
});

test("screenshot path and url check", () => {
  assert.equal(D.screenshotPath("/Users/me", "iPhone 17 Pro (B)", new Date(2026, 9, 31, 14, 5, 9)), "/Users/me/Desktop/iPhone-17-Pro-B-20261031-140509.png");
  assert.ok(D.validUrl("https://example.com/a?b=1&c=2"));
  assert.ok(D.validUrl("myapp://open/item/3"));
  assert.ok(!D.validUrl("example.com"));
  assert.ok(!D.validUrl(""));
});

test("actions per row", () => {
  const names = (d) => D.actionsFor(d).map((a) => a.action);
  assert.deepEqual(names({ kind: "sim", id: "U", state: "on" }), ["shutdown", "screenshot", "openurl", "copy", "erase"]);
  assert.deepEqual(names({ kind: "sim", id: "U", state: "off" }), ["boot", "copy", "erase"]);
  assert.deepEqual(names({ kind: "avd", id: "emulator-5554", serial: "emulator-5554", avd: "a", state: "on" }), ["shutdown", "screenshot", "openurl", "copy"]);
  assert.deepEqual(names({ kind: "avd", id: "a", avd: "a", state: "off" }), ["boot", "copy", "erase"]);
  assert.deepEqual(names({ kind: "phone", id: "R5", serial: "R5", state: "on" }), ["screenshot", "openurl", "copy"]);
  assert.deepEqual(names({ kind: "phone", id: "R5", serial: "R5", state: "unauthorized" }), ["copy"]);
  assert.equal(D.actionsFor({ kind: "sim", id: "U", state: "off" }).find((a) => a.action === "erase").danger, true);
});

test("commands are argument lists", () => {
  const sim = { kind: "sim", id: "UDID-1", name: "iPhone", state: "on" };
  const avd = { kind: "avd", id: "emulator-5554", serial: "emulator-5554", avd: "parity-api36", state: "on" };
  const x = { adb: "/sdk/adb", emulator: "/sdk/emulator", path: "/Users/me/Desktop/a.png", url: "https://x.test/?a=1&b='2'", avdPath: "/Users/me/.android/avd/parity-api36.avd" };
  assert.deepEqual(D.stepsFor("boot", sim, x), [{ argv: ["xcrun", "simctl", "boot", "UDID-1"], ok: [0, 149] }, { argv: ["open", "-a", "Simulator"] }]);
  assert.deepEqual(D.stepsFor("boot", avd, x), [{ argv: ["sh", "-c", 'nohup "$1" -avd "$2" >/dev/null 2>&1 &', "sh", "/sdk/emulator", "parity-api36"] }]);
  assert.deepEqual(D.stepsFor("shutdown", avd, x), [{ argv: ["/sdk/adb", "-s", "emulator-5554", "emu", "kill"] }]);
  assert.deepEqual(D.stepsFor("screenshot", sim, x), [{ argv: ["xcrun", "simctl", "io", "UDID-1", "screenshot", "/Users/me/Desktop/a.png"] }]);
  assert.deepEqual(D.stepsFor("screenshot", avd, x).map((s) => s.argv.slice(3)), [["shell", "screencap", "-p", "/sdcard/herdr-devices-shot.png"], ["pull", "/sdcard/herdr-devices-shot.png", "/Users/me/Desktop/a.png"], ["shell", "rm", "-f", "/sdcard/herdr-devices-shot.png"]]);
  assert.deepEqual(D.stepsFor("openurl", sim, x), [{ argv: ["xcrun", "simctl", "openurl", "UDID-1", "https://x.test/?a=1&b='2'"] }]);
  // adb shell hands its words to the device's shell: the URL arrives single-quoted.
  assert.equal(D.stepsFor("openurl", avd, x)[0].argv.at(-1), `'https://x.test/?a=1&b='\\''2'\\'''`);
  assert.deepEqual(D.stepsFor("erase", sim, x), [{ argv: ["xcrun", "simctl", "shutdown", "UDID-1"], ok: "any" }, { argv: ["xcrun", "simctl", "erase", "UDID-1"] }]);
  assert.deepEqual(D.stepsFor("erase", { ...avd, state: "off" }, x), [{ argv: ["sh", "-c", 'rm -rf "$1"/userdata-qemu.img* "$1"/snapshots', "sh", "/Users/me/.android/avd/parity-api36.avd"] }]);
  for (const bad of [null, "", "/", "relative.avd", "/Users/me"]) assert.throws(() => D.stepsFor("erase", avd, { ...x, avdPath: bad }));
});
