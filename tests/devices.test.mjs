// The mod's parsing and command building, on output captured from macOS.
// Fixtures: simctl-devices.json and adb-devices-empty.txt are real (home folder
// renamed); the *-mixed and adb-emu-avd-name files are written by hand in the tools' exact formats, since this machine
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
  assert.deepEqual(devices.find((d) => d.name === "iPhone 17 Pro"), { kind: "sim", id: "B6717390-90FF-479E-8F22-5297D5212A0F", name: "iPhone 17 Pro", state: "on", detail: "26.5", lastUsed: Date.UTC(2026, 9, 30, 14, 9, 53) });
  assert.equal(devices.find((d) => d.name === "iPad Pro 13-inch (M5)").state, "off");
});

test("simctl: unavailable hidden, empty runtimes dropped, iOS newest first", () => {
  const sections = D.parseSimctl(fixture("simctl-devices-mixed.json"));
  assert.deepEqual(sections.map((s) => s.title), ["iOS 26.0", "iOS 18.2", "watchOS 11.2"]);
  assert.deepEqual(sections[1].devices.map((d) => d.name), ["iPhone 16"]);
  assert.equal(sections[0].devices.find((d) => d.name === "iPad Air").state, "booting");
});

test("avds: one per <name>.ini in the AVD home; only those changing re-list", () => {
  assert.deepEqual(D.avdNamesFrom(["parity-api36.avd", "parity-api36.ini", ".DS_Store", "Pixel_9_API_35.ini", "Pixel_9_API_35.avd", "notes.txt"]), ["Pixel_9_API_35", "parity-api36"]);
  assert.deepEqual(D.avdNamesFrom([]), []);
  assert.ok(D.avdListChanged(["/Users/me/.android/avd/Pixel_9_API_35.ini"]));
  // A running emulator keeps writing inside its own folder.
  assert.ok(!D.avdListChanged(["/Users/me/.android/avd/parity-api36.avd/hardware-qemu.ini", "/Users/me/.android/avd/parity-api36.avd/userdata-qemu.img.qcow2"]));
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

test("emulator names: kept while adb lists the serial, asked once per new emulator", () => {
  const adb = D.parseAdbDevices(fixture("adb-devices-mixed.txt"));
  assert.deepEqual(D.nameCache({}, adb), { keep: {}, ask: ["emulator-5554"] });
  assert.deepEqual(D.nameCache({ "emulator-5554": "parity-api36", "emulator-5558": "gone" }, adb), { keep: { "emulator-5554": "parity-api36" }, ask: [] });
  assert.deepEqual(D.nameCache({ "emulator-5554": "parity-api36" }, []), { keep: {}, ask: [] });
});

test("android rows: running AVDs mapped by serial, others off, phones by model", () => {
  const avds = ["parity-api36", "Pixel_9_API_35"];
  const adb = D.parseAdbDevices(fixture("adb-devices-mixed.txt"));
  const rows = D.androidDevices(avds, adb, { "emulator-5554": "parity-api36" }, { "parity-api36": "API 36" });
  assert.deepEqual(rows, [
    { kind: "avd", id: "emulator-5554", serial: "emulator-5554", avd: "parity-api36", name: "parity-api36", state: "on", detail: "API 36" },
    { kind: "avd", id: "Pixel_9_API_35", avd: "Pixel_9_API_35", name: "Pixel_9_API_35", state: "off", detail: "emulator" },
    { kind: "avd", id: "emulator-5556", serial: "emulator-5556", avd: null, name: "emulator-5556", state: "offline", detail: "emulator" },
    { kind: "phone", id: "R58M12ABCDE", serial: "R58M12ABCDE", name: "SM A546B", state: "on", detail: "USB" },
    { kind: "phone", id: "0A281FDD4003XZ", serial: "0A281FDD4003XZ", name: "0A281FDD4003XZ", state: "unauthorized", detail: "USB" },
  ]);
  assert.deepEqual(D.androidDevices(["parity-api36"], [], {}), [{ kind: "avd", id: "parity-api36", avd: "parity-api36", name: "parity-api36", state: "off", detail: "emulator" }]);
  assert.equal(D.phoneLink("192.168.1.20:41235"), "Wi-Fi");
  assert.equal(D.phoneLink("adb-R58M12ABCDE-x1y2._adb-tls-connect._tcp"), "Wi-Fi");
});

test("tool candidates: PATH, then the SDK's homes", () => {
  assert.deepEqual(D.toolCandidates("adb", { androidHome: "/sdk/", sdkRoot: "", home: "/Users/me" }), ["adb", "/sdk/platform-tools/adb", "/Users/me/Library/Android/sdk/platform-tools/adb"]);
  assert.deepEqual(D.toolCandidates("emulator", { androidHome: "", sdkRoot: "", home: "/Users/me" }), ["emulator", "/Users/me/Library/Android/sdk/emulator/emulator"]);
  assert.deepEqual(D.toolCandidates("xcrun", { home: "/Users/me" }), ["xcrun"]);
});

test("avd ini and error lines", () => {
  assert.equal(D.parseAvdIni("avd.ini.encoding=UTF-8\npath=/Users/me/.android/avd/parity-api36.avd\npath.rel=avd/parity-api36.avd\n"), "/Users/me/.android/avd/parity-api36.avd");
  assert.equal(D.parseAvdIni(null), null);
  assert.equal(D.avdApi("path=/x.avd\ntarget=android-36\n"), "API 36");
  assert.equal(D.avdApi("path=/x.avd\n"), null);
  assert.equal(D.errorLine({ code: 148, stderr: "An error was encountered processing the command (domain=com.apple.CoreSimulator.SimError, code=405):\nUnable to shutdown device in current state: Shutdown\n", stdout: "" }), "Unable to shutdown device in current state: Shutdown");
  assert.equal(D.errorLine({ code: 1, stderr: "", stdout: "" }), "exit code 1");
});

// exec's rejections, as the mod runtime words them.
const NOT_FOUND = new Error("`herdr.exec`: cannot run /sdk/platform-tools/adb: No such file or directory (os error 2)");
const TIMED_OUT = new Error("`herdr.exec`: adb took longer than 30 s and was stopped");
const DENIED = new Error("`herdr.exec`: cannot run adb: Permission denied (os error 13)");

test("exec rejections: missing tool, timeout, anything else", () => {
  assert.deepEqual([NOT_FOUND, TIMED_OUT, DENIED].map(D.execFailure), ["missing", "timeout", "failed"]);
  assert.equal(D.rejectionLine(NOT_FOUND, "Shut down"), "adb not found");
  assert.equal(D.rejectionLine(TIMED_OUT, "Shut down"), "Shut down timed out");
  assert.equal(D.rejectionLine(DENIED, "Shut down"), "cannot run adb: Permission denied (os error 13)");
  assert.equal(D.rejectionLine(new Error("Unexpected AVD folder: /"), "Erase"), "Unexpected AVD folder: /");
});

test("a tool none of whose paths started counts as missing for a minute", () => {
  assert.equal(D.stillMissing(undefined, 1000), false);
  assert.equal(D.stillMissing(1000, 1000 + 59999), true);
  assert.equal(D.stillMissing(1000, 1000 + 60000), false);
});

test("screenshot path and url check", () => {
  assert.equal(D.screenshotPath("/Users/me", "iPhone 17 Pro (B)", new Date(2026, 9, 31, 14, 5, 9, 42)), "/Users/me/Desktop/iPhone-17-Pro-B-20261031-140509-042.png");
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
  const x = { adb: "/sdk/adb", emulator: "/sdk/emulator", log: "/tmp/herdr-devices-parity-api36.log", path: "/Users/me/Desktop/a.png", url: "https://x.test/?a=1&b='2'", avdPath: "/Users/me/.android/avd/parity-api36.avd" };
  assert.deepEqual(D.stepsFor("boot", sim, x), [{ argv: ["xcrun", "simctl", "boot", "UDID-1"], ok: [0, 149] }, { argv: ["open", "-a", "Simulator"] }]);
  assert.deepEqual(D.stepsFor("boot", avd, x), [{ argv: ["sh", "-c", 'log=$1; shift; mkdir -p "$(dirname "$log")"; nohup "$@" >"$log" 2>&1 &', "sh", "/tmp/herdr-devices-parity-api36.log", "/sdk/emulator", "-avd", "parity-api36"] }]);
  assert.deepEqual(D.stepsFor("shutdown", avd, x), [{ argv: ["/sdk/adb", "-s", "emulator-5554", "emu", "kill"] }]);
  assert.deepEqual(D.stepsFor("screenshot", sim, x), [{ argv: ["xcrun", "simctl", "io", "UDID-1", "screenshot", "/Users/me/Desktop/a.png"] }]);
  const shot = { ...x, path: "/Users/me/Desktop/Pixel-9-20261031-140509-042.png" }, remote = "/sdcard/herdr-devices-Pixel-9-20261031-140509-042.png";
  assert.deepEqual(D.stepsFor("screenshot", avd, shot).map((s) => s.argv.slice(3)), [["shell", "screencap", "-p", remote], ["pull", remote, shot.path], ["shell", "rm", "-f", remote]]);
  assert.deepEqual(D.stepsFor("openurl", sim, x), [{ argv: ["xcrun", "simctl", "openurl", "UDID-1", "https://x.test/?a=1&b='2'"] }]);
  // adb shell hands its words to the device's shell: the URL arrives single-quoted.
  assert.equal(D.stepsFor("openurl", avd, x)[0].argv.at(-1), `'https://x.test/?a=1&b='\\''2'\\'''`);
  // The row spins "stopping", then "erasing".
  assert.deepEqual(D.stepsFor("erase", sim, x), [{ argv: ["xcrun", "simctl", "shutdown", "UDID-1"], ok: "any", phase: "stopping" }, { argv: ["xcrun", "simctl", "erase", "UDID-1"], phase: "erasing" }]);
  // An AVD: only its snapshots/ goes, then the emulator's own wipe, detached and logged.
  assert.deepEqual(D.stepsFor("erase", { ...avd, state: "off" }, x), [
    { argv: ["rm", "-rf", "/Users/me/.android/avd/parity-api36.avd/snapshots"], phase: "erasing" },
    { argv: ["sh", "-c", 'log=$1; shift; mkdir -p "$(dirname "$log")"; nohup "$@" >"$log" 2>&1 &', "sh", "/tmp/herdr-devices-parity-api36.log", "/sdk/emulator", "-avd", "parity-api36", "-wipe-data", "-no-snapshot", "-no-window"] },
  ]);
  for (const bad of [null, "", "/", "relative.avd", "/Users/me"]) assert.throws(() => D.stepsFor("erase", avd, { ...x, avdPath: bad }));
});

const sim = (name, state, lastUsed = 0) => ({ kind: "sim", id: name, name, state, lastUsed });

test("recents: lastBootedAt or this mod's own log, newest first, ties keep order", () => {
  const list = [sim("a", "off", 100), sim("b", "off", 300), sim("c", "off"), { kind: "avd", id: "p", avd: "p", name: "p", state: "off" }];
  assert.deepEqual(D.sortRecent(list).map((d) => d.name), ["b", "a", "c", "p"]);
  assert.deepEqual(D.sortRecent(list, { "avd:p": 200, "sim:c": 400 }).map((d) => d.name), ["c", "b", "p", "a"]);
  // The real list: the two booted simulators were booted last.
  const real = D.sortRecent(D.parseSimctl(fixture("simctl-devices.json"))[0].devices);
  assert.deepEqual(real.slice(0, 2).map((d) => d.name), ["iPhone 17 Pro B", "iPhone 17 Pro"]);
});

test("recents: a device that came on outside the panel counts; gone ones drop out", () => {
  const used = { "sim:a": 1, "sim:gone": 2, "avd:p": 3 };
  // b booted from a terminal (via "booting"); c was already on; a stayed off.
  const prev = [sim("a", "off"), sim("b", "booting"), sim("c", "on")], next = [sim("a", "off"), sim("b", "on"), sim("c", "on")];
  assert.deepEqual(D.updateUsed(used, "ios", prev, next, 50, true), { "sim:a": 1, "avd:p": 3, "sim:b": 50 });
  // Partial read: nothing pruned. First read: nothing marked.
  assert.deepEqual(D.updateUsed(used, "ios", prev, next, 50, false), { ...used, "sim:b": 50 });
  assert.deepEqual(D.updateUsed(used, "ios", null, next, 50, false), used);
  // An AVD keeps its key across its serial; the other platform's entries stay.
  const off = { kind: "avd", id: "p", avd: "p", name: "p", state: "off" }, on = { kind: "avd", id: "emulator-5554", serial: "emulator-5554", avd: "p", name: "p", state: "on" };
  assert.deepEqual(D.updateUsed({ "sim:a": 1, "phone:R5": 2 }, "android", [off], [on], 60, true), { "sim:a": 1, "avd:p": 60 });
});

test("fold: three most recent plus anything not off; all shows everything", () => {
  const sorted = [sim("a", "off"), sim("b", "off"), sim("c", "off"), sim("d", "off"), sim("e", "on"), sim("f", "off"), sim("g", "booting")];
  const folded = D.foldRows(sorted);
  assert.deepEqual(folded.shown.map((d) => d.name), ["a", "b", "c", "e", "g"]);
  assert.equal(folded.hidden, 2);
  assert.deepEqual(D.foldRows(sorted, { pending: { "sim:f": { phase: "booting", at: 0 } } }).shown.map((d) => d.name), ["a", "b", "c", "e", "f", "g"]);
  assert.deepEqual(D.foldRows(sorted, { all: true }), { shown: sorted, hidden: 0 });
  assert.equal(D.foldRows(sorted.slice(0, 3)).hidden, 0);
});

test("phases: booting until booted (an AVD until boot_completed), stopping until off, three minutes at most", () => {
  const now = 1000000;
  const pending = { "sim:a": { phase: "booting", at: now - 1000 }, "sim:b": { phase: "stopping", at: now - 1000 }, "avd:p": { phase: "booting", at: now - 1000 }, "sim:old": { phase: "booting", at: now - 181000 } };
  const devices = [sim("a", "off"), sim("b", "on"), sim("old", "off"), { kind: "avd", id: "emulator-5554", serial: "emulator-5554", avd: "p", name: "p", state: "on" }];
  assert.deepEqual(Object.keys(D.settlePending(pending, devices, now)), ["sim:a", "sim:b", "avd:p"]);
  const later = [sim("a", "on"), sim("b", "off"), devices[2], devices[3]];
  assert.deepEqual(Object.keys(D.settlePending(pending, later, now)), ["avd:p"]);
  assert.deepEqual(Object.keys(D.settlePending(pending, later, now, new Set(["avd:p"]))), []);
  assert.equal(D.phaseOf(sim("a", "off"), pending), "booting");
  assert.equal(D.phaseOf(sim("z", "booting")), "booting");
  assert.equal(D.phaseOf(sim("z", "shutting down")), "stopping");
  assert.equal(D.phaseOf(sim("z", "on")), null);
  assert.deepEqual([D.glyphOf(sim("z", "on"), null), D.glyphOf(sim("z", "off"), null), D.glyphOf(sim("z", "off"), "booting"), D.glyphOf({ state: "unauthorized" }, null)], ["on", "off", "spin", "warn"]);
});

test("an AVD launch: its log, its process, and when the settle pass gives up on it", () => {
  assert.equal(D.emulatorLogPath({ tmp: "/var/folders/xy/T/", home: "/Users/me", os: "Darwin" }, "parity-api36"), "/var/folders/xy/T/herdr-devices-parity-api36.log");
  // No TMPDIR: the user's cache folder, never the shared /tmp.
  assert.equal(D.emulatorLogPath({ tmp: "", home: "/Users/me", os: "Darwin" }, "parity-api36"), "/Users/me/Library/Caches/herdr-devices/herdr-devices-parity-api36.log");
  assert.equal(D.emulatorLogPath({ tmp: "", home: "/home/me", os: "Linux" }, "parity-api36"), "/home/me/.cache/herdr-devices/herdr-devices-parity-api36.log");
  // pgrep -f matches against the whole command line.
  const running = (avd, cmd) => new RegExp(D.avdProcessPattern(avd)).test(cmd);
  assert.ok(running("Pixel_7", "/sdk/emulator/qemu/darwin-aarch64/qemu-system-aarch64 -avd Pixel_7 -wipe-data"));
  assert.ok(running("Pixel_7", "/sdk/emulator/emulator -avd Pixel_7"));
  assert.ok(!running("Pixel_7", "/sdk/emulator/emulator -avd Pixel_7_API_34"));
  assert.ok(!running("Pixel.7", "/sdk/emulator/emulator -avd PixelX7"));
  assert.equal(D.lastLine("INFO    | Android emulator version 36.1.9\nPANIC: Unknown AVD name [nope], use -list-avds to see valid list.\n\n"), "PANIC: Unknown AVD name [nope], use -list-avds to see valid list.");
  assert.equal(D.lastLine(""), null);
  assert.equal(D.lastLine(null), null);
  const p = { phase: "booting", at: 1000000, avd: "Pixel_7" };
  assert.equal(D.launchStep(p, 1005000, false), "wait");
  assert.equal(D.launchStep(p, 1011000, false), "check");
  assert.equal(D.launchStep(p, 1011000, false, true), "wait");
  assert.equal(D.launchStep(p, 1011000, false, false), "gone");
  assert.equal(D.launchStep(p, 1011000, true), "done");
  assert.equal(D.launchStep(p, 1181001, false), "late");
  // An erase's wipe: stopped once booted; a crashed one ends like a failed boot.
  const wipe = { ...p, phase: "erasing" };
  assert.equal(D.launchStep(wipe, 1011000, true), "kill");
  assert.equal(D.launchStep(wipe, 1011000, false, false), "gone");
  assert.equal(D.launchStep(wipe, 1181001, false), "late");
  // An ended launch leaves the pending list at once.
  assert.deepEqual(D.settlePending({ "avd:Pixel_7": p, "sim:a": { phase: "booting", at: 1000000 } }, [], 1011000, new Set(), new Set(["avd:Pixel_7"])), { "sim:a": { phase: "booting", at: 1000000 } });
});

test("hover icons and the row click", () => {
  const names = (d, phase) => D.hoverActions(d, phase).map((a) => a.action);
  assert.deepEqual(names(sim("a", "on")), ["shutdown", "screenshot", "more"]);
  assert.deepEqual(names(sim("a", "off")), ["boot", "more"]);
  assert.deepEqual(names(sim("a", "off"), "booting"), ["more"]);
  assert.deepEqual(names({ kind: "phone", id: "R5", serial: "R5", state: "on" }), ["screenshot", "more"]);
  assert.equal(D.primaryAction(sim("a", "off")), "boot");
  assert.equal(D.primaryAction(sim("a", "on")), "focus");
  assert.equal(D.primaryAction(sim("a", "off"), "booting"), null);
  assert.equal(D.primaryAction({ kind: "avd", id: "p", avd: "p", state: "off" }), "boot");
  assert.equal(D.primaryAction({ kind: "avd", id: "e", serial: "e", avd: "p", state: "on" }), null);
  assert.equal(D.primaryAction({ kind: "phone", id: "R5", serial: "R5", state: "on" }), null);
});

test("footer", () => {
  const android = [{ kind: "avd" }, { kind: "phone" }];
  assert.equal(D.footerText([1, 2, 3, 4, 5], android, 1000, 4000), "5 simulators · 1 emulator · 1 device · refreshed 0s ago");
  assert.equal(D.footerText([1], [], 1000, 1000 + 25000), "1 simulator · 0 emulators · 0 devices · refreshed 20s ago");
  assert.equal(D.footerText([], [], 0, 5), "0 simulators · 0 emulators · 0 devices");
  assert.match(D.footerText([], [], 1, 1 + 125000), /refreshed 2m ago$/);
});
