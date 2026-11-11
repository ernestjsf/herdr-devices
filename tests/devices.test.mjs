// The mod's parsing and command building, on output captured from macOS.
// Fixtures: simctl-devices.json and adb-devices-empty.txt are real (home folder
// renamed); the *-mixed, adb-emu-avd-name, launchctl-list and dumpsys-* files are trimmed or hand-written in the tools' exact formats (ids sanitized to com.example.*), since this machine
// had no running emulator or phone. devicectl-list.json is that tool's JSON, trimmed (capabilities and
// other unread fields dropped) with the names, ids and hostnames replaced and the connection states edited by hand: this machine's two paired
// devices were both away, so one wired and one Wi-Fi device are made up. ps-maestro.txt is hand-written in
// `ps -axo pid=,ppid=,time=,command=`'s exact format (pids, UDIDs and paths sanitized). Run: node --test tests/
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

test("devicectl: only the physical devices connected now, as rows", () => {
  const rows = D.parseDevicectl(fixture("devicectl-list.json"));
  assert.deepEqual(rows, [
    { kind: "ios", id: "00008301-0000000000000001", name: "Apple Watch", state: "on", detail: "Wi-Fi", platform: "watchOS", version: "26.2", lastUsed: Date.UTC(2026, 9, 30, 9, 30) },
    { kind: "ios", id: "00008120-0000000000000002", name: "iPhone", state: "on", detail: "USB", platform: "iOS", version: "27.0.1", lastUsed: Date.UTC(2026, 9, 30, 12, 11) },
  ]);
  // Wired counts even before the tunnel is up; virtual devices never show.
  const json = JSON.parse(fixture("devicectl-list.json")), [watch, phone, away] = json.result.devices;
  away.connectionProperties.transportType = "wired";
  phone.hardwareProperties.reality = "virtual";
  assert.deepEqual(D.parseDevicectl(JSON.stringify(json)).map((d) => d.name), ["Apple Watch", "Old iPhone"]);
  assert.deepEqual(D.parseDevicectl('{"result":{"devices":[]}}'), []);
  assert.throws(() => D.parseDevicectl("not json"));
});

test("devicectl rows join the simulators' sections, new ones sorted in", () => {
  const sims = D.parseSimctl(fixture("simctl-devices-mixed.json")), phones = D.parseDevicectl(fixture("devicectl-list.json"));
  const merged = D.mergeIos(sims, [...phones, { kind: "ios", id: "U", name: "Same OS", platform: "iOS", version: "18.2" }]);
  assert.deepEqual(merged.map((s) => s.title), ["iOS 27.0.1", "iOS 26.0", "iOS 18.2", "watchOS 26.2", "watchOS 11.2"]);
  assert.deepEqual(merged[2].devices.map((d) => d.name), ["iPhone 16", "Same OS"]);
  assert.equal(sims.length, 3);
  assert.deepEqual(D.mergeIos(sims, []), sims);
  assert.deepEqual(D.mergeIos([], phones).map((s) => s.title), ["iOS 27.0.1", "watchOS 26.2"]);
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

test("simctl launchctl list: user apps with pids, sorted, Apple's dropped", () => {
  assert.deepEqual(D.parseIosApps(fixture("launchctl-list.txt")), [{ id: "com.example.budget", pid: "90340" }, { id: "com.example.budget.widget", pid: "60500" }, { id: "com.example.notes", pid: "61002" }]);
  assert.deepEqual(D.parseIosApps("1\t0\tUIKitApplication:com.example.a[1][rb-legacy]\n2\t0\tUIKitApplication:com.example.a[2][rb-legacy]\n"), [{ id: "com.example.a", pid: "1" }]);
  assert.deepEqual(D.parseIosApps("-\t0\tcom.apple.SpringBoard.services\n1\t0\tUIKitApplication:com.apple.mobilecal[fd1e][rb-legacy]\n"), []);
  assert.deepEqual(D.parseIosApps(""), []);
});

test("ps ranks the apps: CPU first, then newest launch, then id", () => {
  const apps = [{ id: "com.example.budget", pid: "90340" }, { id: "com.example.focus", pid: "11034" }, { id: "com.example.notes", pid: "500" }];
  // A suspended app at 0.0 for 18 hours, the one on screen at 24.5%.
  assert.deepEqual(D.rankIosApps(apps.slice(0, 2), "11034  24.5     01:16\n90340   0.0 18:08:37\n"), ["com.example.focus", "com.example.budget"]);
  // All idle (under 0.5 counts as 0): the newest launch leads; days sort above hours.
  assert.deepEqual(D.rankIosApps(apps, "11034   0.3     01:16\n90340   0.0 18:08:37\n  500   0.0 2-03:00:00\n"), ["com.example.focus", "com.example.budget", "com.example.notes"]);
  // Same CPU and age: by id. Apps ps didn't print go last.
  assert.deepEqual(D.rankIosApps(apps, "500 0.0 05:00\n90340 0.0 05:00\n"), ["com.example.budget", "com.example.notes", "com.example.focus"]);
  // ps failed: the order given.
  assert.deepEqual(D.rankIosApps(apps, ""), ["com.example.budget", "com.example.focus", "com.example.notes"]);
  // SpringBoard's word beats CPU; an app it names that is gone changes nothing.
  assert.deepEqual(D.rankIosApps(apps.slice(0, 2), "11034  24.5     01:16\n90340   0.0 18:08:37\n", "com.example.budget"), ["com.example.budget", "com.example.focus"]);
  assert.deepEqual(D.rankIosApps(apps.slice(0, 2), "11034  24.5     01:16\n90340   0.0 18:08:37\n", "com.example.gone"), ["com.example.focus", "com.example.budget"]);
});

test("SpringBoard log: the app last put in front", () => {
  assert.equal(D.parseIosFront(fixture("log-show-front.txt")), "com.example.budget");
  assert.equal(D.parseIosFront("Timestamp               Ty Process[PID:TID]\n"), null);
  assert.equal(D.logStart(new Date(2026, 9, 31, 13, 5, 4).getTime()), "2026-10-31 13:05:04");
});

test("dumpsys: the app in front, launchers and system apps hidden", () => {
  assert.deepEqual(D.parseAndroidApp(fixture("dumpsys-activities-app.txt")), ["com.example.budget"]);
  assert.deepEqual(D.parseAndroidApp(fixture("dumpsys-activities-launcher.txt")), []);
  // Older APIs have no topResumedActivity.
  assert.deepEqual(D.parseAndroidApp(fixture("dumpsys-activities-legacy.txt")), ["com.example.budget"]);
  for (const pkg of ["com.android.settings", "com.google.android.gms", "com.google.android.googlequicksearchbox", "android", "com.sec.android.app.launcher", "com.miui.home.launcher"])
    assert.deepEqual(D.parseAndroidApp(`topResumedActivity=ActivityRecord{1 u0 ${pkg}/.A t2}`), [], pkg);
  assert.deepEqual(D.parseAndroidApp("nothing here"), []);
});

test("app id segment", () => {
  assert.equal(D.appSegment("com.example.budget"), "budget");
  assert.equal(D.appSegment("budget"), "budget");
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
  assert.deepEqual(names({ kind: "sim", id: "U", state: "on" }), ["shutdown", "screenshot", "openurl", "maestro", "copy", "erase"]);
  assert.deepEqual(names({ kind: "sim", id: "U", state: "off" }), ["boot", "copy", "erase"]);
  assert.deepEqual(names({ kind: "avd", id: "emulator-5554", serial: "emulator-5554", avd: "a", state: "on" }), ["shutdown", "screenshot", "openurl", "maestro", "copy"]);
  assert.deepEqual(names({ kind: "avd", id: "a", avd: "a", state: "off" }), ["boot", "copy", "erase"]);
  assert.deepEqual(names({ kind: "phone", id: "R5", serial: "R5", state: "on" }), ["screenshot", "openurl", "maestro", "copy"]);
  assert.deepEqual(names({ kind: "phone", id: "R5", serial: "R5", state: "unauthorized" }), ["copy"]);
  // A device over devicectl: no boot, screenshot or erase.
  const ios = { kind: "ios", id: "00008120-0000000000000002", name: "iPhone", state: "on" };
  assert.deepEqual(D.actionsFor(ios).map((a) => a.label), ["Open URL…", "Run Maestro flow…", "Copy UDID"]);
  assert.equal(D.actionsFor({ kind: "sim", id: "U", state: "off" }).find((a) => a.action === "erase").danger, true);
});

test("copy app id and Stop: only for a booted device with an app, between Open URL and Copy id", () => {
  const labels = (d) => D.actionsFor(d).map((a) => a.label);
  const sim = { kind: "sim", id: "U", state: "on", apps: ["com.example.budget", "com.example.notes"] };
  assert.deepEqual(labels(sim), ["Shut down", "Screenshot", "Open URL…", "Run Maestro flow…", "Copy app id", "Stop budget", "Stop notes", "Copy UDID", "Erase…"]);
  assert.deepEqual(D.actionsFor(sim).filter((a) => a.action === "stop").map((a) => a.app), ["com.example.budget", "com.example.notes"]);
  assert.deepEqual(labels({ kind: "phone", id: "R5", serial: "R5", state: "on", apps: ["com.example.budget"] }), ["Screenshot", "Open URL…", "Run Maestro flow…", "Copy app id", "Stop budget", "Copy serial"]);
  assert.ok(!labels({ ...sim, apps: [] }).includes("Copy app id"));
  assert.ok(!labels({ ...sim, apps: undefined }).includes("Copy app id"));
  assert.ok(!labels({ ...sim, state: "off" }).includes("Stop budget"));
});

test("Run Maestro flow: booted rows only, menu only", () => {
  const sim = { kind: "sim", id: "U", state: "on" };
  assert.deepEqual(D.actionsFor(sim).find((a) => a.action === "maestro"), { action: "maestro", label: "Run Maestro flow…", icon: "flask" });
  assert.ok(!D.actionsFor({ ...sim, state: "off" }).some((a) => a.action === "maestro"));
  assert.ok(!D.hoverActions(sim, null).some((a) => a.action === "maestro"));
});

test("Run <flow> again: under Run Maestro flow when the folder has a last flow", () => {
  const sim = { kind: "sim", id: "U", state: "on" }, avd = { kind: "avd", id: "emulator-5554", serial: "emulator-5554", avd: "a", state: "on" };
  const names = (d, o) => D.actionsFor(d, o).map((a) => a.action);
  assert.deepEqual(names(sim, { lastFlow: "/p/.maestro/auth/onboarding-existing-budget.yaml" }), ["shutdown", "screenshot", "openurl", "maestro", "maestroAgain", "copy", "erase"]);
  assert.deepEqual(D.actionsFor(avd, { lastFlow: "/p/.maestro/login.yml" }).find((a) => a.action === "maestroAgain"), { action: "maestroAgain", label: "Run login again", icon: "flask", path: "/p/.maestro/login.yml" });
  assert.equal(D.actionsFor(sim, { lastFlow: "/p/.maestro/onboarding-existing-budget.yaml" })[4].label, "Run onboarding-existing-budget again");
  assert.deepEqual(names(sim, {}), names(sim));
  assert.ok(!names({ ...sim, state: "off" }, { lastFlow: "/p/a.yaml" }).includes("maestroAgain"));
  assert.ok(names({ kind: "ios", id: "I", state: "on" }, { lastFlow: "/p/a.yaml" }).includes("maestroAgain"));
});

test("maestro missing: the row stays, disabled with a hint, and no Run again", () => {
  const sim = { kind: "sim", id: "U", state: "on" };
  const names = (o) => D.actionsFor(sim, o).map((a) => a.action);
  assert.deepEqual(D.actionsFor(sim, { maestro: false, lastFlow: "/p/a.yaml" }).find((a) => a.action === "maestro"), { action: "maestro", label: "Run Maestro flow…", icon: "flask", disabled: true, hint: "not installed" });
  assert.deepEqual(names({ maestro: false, lastFlow: "/p/a.yaml" }), ["shutdown", "screenshot", "openurl", "maestro", "copy", "erase"]);
  assert.deepEqual(D.actionsFor(sim, { maestro: true }), D.actionsFor(sim));
  assert.ok(!D.actionsFor(sim).some((a) => a.disabled || a.hint === "not installed"));
});

test("menu key hints: space on Boot and Shut down, S on Screenshot", () => {
  const hints = (d) => D.actionsFor(d).filter((a) => a.hint).map((a) => [a.action, a.hint]);
  assert.deepEqual(D.actionsFor({ kind: "sim", id: "U", state: "on" })[0], { action: "shutdown", label: "Shut down", icon: "power", hint: "space" });
  assert.deepEqual(hints({ kind: "sim", id: "U", state: "on" }), [["shutdown", "space"], ["screenshot", "S"]]);
  assert.deepEqual(D.actionsFor({ kind: "avd", id: "a", avd: "a", state: "off" })[0], { action: "boot", label: "Boot", icon: "play", hint: "space" });
  assert.deepEqual(D.actionsFor({ kind: "phone", id: "R5", serial: "R5", state: "on" }).find((a) => a.action === "screenshot"), { action: "screenshot", label: "Screenshot", icon: "camera", hint: "S" });
});

test("maestro argv passes the device, the path and the variables as positional arguments", () => {
  const argv = D.maestroArgv({ id: "UDID-1" }, "/p/.maestro dir/$x");
  assert.deepEqual(argv, ["sh", "-c", argv[2], "sh", "UDID-1", "/p/.maestro dir/$x"]);
  assert.deepEqual(D.maestroArgv({ id: "UDID-1" }, "/p/f.yaml", ["A=1", "THEME=$(rm)"]).slice(3), ["sh", "UDID-1", "/p/f.yaml", "-e", "A=1", "-e", "THEME=$(rm)"]);
  assert.ok(!argv[2].includes("UDID-1") && !argv[2].includes("maestro dir") && !argv[2].includes("THEME"));
  assert.ok(argv[2].startsWith('dev=$1; flow=$2; shift 2; maestro --device "$dev" test "$@" "$flow";') && argv[2].endsWith('exec "${SHELL:-sh}" -l'));
  assert.ok(argv[2].includes("[maestro exited %s]") && argv[2].includes("debug output: %s") && argv[2].includes('ls -td "$HOME"/.maestro/tests/*/'));
});

test("maestro variables: KEY=VALUE words, anything else refused", () => {
  assert.deepEqual(D.parseVars(""), []);
  assert.deepEqual(D.parseVars("   "), []);
  assert.deepEqual(D.parseVars(" REVIEW_THEME=Dark  _x=  URL=https://a/b?c=d "), ["REVIEW_THEME=Dark", "_x=", "URL=https://a/b?c=d"]);
  assert.equal(D.parseVars("REVIEW_THEME=Dark oops"), null);
  assert.equal(D.parseVars("1A=b"), null);
  assert.equal(D.parseVars("=b"), null);
  assert.equal(D.parseVars("A-B=c"), null);
});

test("maestro pane: the device's, by name or by its maestro argv", () => {
  const d = { id: "UDID-1", name: "iPhone 17" };
  const argv = (id, script = 'maestro --device "$1" test "$2"; exec sh') => ["sh", "-c", script, "sh", id, "/p/f.yaml"];
  assert.ok(D.isMaestroPane({ address: "t1", name: "maestro · iPhone 17", state: "live" }, d));
  assert.ok(D.isMaestroPane({ address: "t1", name: null, argv: argv("UDID-1"), state: "live" }, d));
  assert.ok(D.isMaestroPane({ address: "t1", argv: D.maestroArgv(d, "/p/f.yaml", ["A=1"]) }, d));
  assert.ok(!D.isMaestroPane({ address: "t1", argv: argv("UDID-2") }, d));
  assert.ok(!D.isMaestroPane({ address: "t1", name: "maestro · iPhone 16", argv: ["zsh"] }, d));
  assert.ok(!D.isMaestroPane({ address: "t1", name: "maestro · iPhone 17", state: "finished" }, d));
  assert.ok(!D.isMaestroPane({ address: "t1" }, d));
  assert.ok(!D.isMaestroPane(null, d));
});

const UDID_A = "0D1C2B3A-0000-4000-8000-00000000000A", UDID_B = "0D1C2B3A-0000-4000-8000-00000000000B";
const psRows = () => D.parsePs(fixture("ps-maestro.txt"));
// t1: zsh 610 running claude 640; t2: zsh 720 running claude 730.
const terms = [{ address: "t1", state: "live", pid: 610, foreground: { pid: 640 } }, { address: "t2", state: "live", pid: 720, foreground: { pid: 730 } }];

test("ps: pid, parent, CPU seconds and the whole command", () => {
  const rows = psRows();
  assert.equal(rows.length, 15);
  assert.deepEqual(rows[0], { pid: 1, ppid: 0, start: null, cpu: 197 * 60 + 53.15, command: "/sbin/launchd" });
  assert.equal(rows.find((r) => r.pid === 660).command, "/usr/bin/java --enable-native-access=ALL-UNNAMED -classpath /opt/homebrew/Cellar/maestro/2.12.0/libexec/lib/* maestro.cli.AppKt mcp");
  assert.equal(D.parsePs("  5 1 1-02:00:01.50 x")[0].cpu, 86400 + 7201.5);
  assert.deepEqual(D.parsePs("\nnot ps\n"), []);
  // With lstart (the panel asks for it): the start is kept as printed; without it, null.
  assert.deepEqual(D.parsePs("  570     1 Thu Nov  5 09:16:37 2026       9:20.03 /usr/libexec/logd")[0], { pid: 570, ppid: 1, start: "Thu Nov  5 09:16:37 2026", cpu: 560.03, command: "/usr/libexec/logd" });
  assert.equal(rows[0].start, null);
});

test("drivers: each simulator-server's UDID and the terminal it runs under", () => {
  const { drivers, cpu } = D.driversFrom(psRows(), terms, {});
  // 671 -> java 660 -> sh 655 -> claude 640 -> zsh 610 (t1's pid): four hops, by its pid alone too.
  assert.deepEqual(drivers, [
    { udid: UDID_A, address: "t1", pid: 671, cpu: 38.31, active: false },
    { udid: UDID_A, address: "t2", pid: 752, cpu: 2.5, active: false },
  ]);
  assert.deepEqual(D.driversFrom(psRows(), [{ address: "t1", pid: 610 }], {}).drivers.map((x) => x.address), ["t1"]);
  // 815's parents end at launchd (pid 1) without a terminal: no driver, but its CPU is kept.
  assert.ok(!drivers.some((x) => x.udid === UDID_B));
  assert.deepEqual(cpu, { 671: 38.31, 752: 2.5, 815: 1.2 });
  assert.deepEqual(D.driversFrom(psRows(), [{ address: "t9", pid: 610, state: "finished" }], {}).drivers, []);
});

test("claim holders: the terminal a claim's pid is, or runs under, by pid", () => {
  const claims = { A: { pid: 640 }, B: { pid: 730 }, C: { pid: 660 }, D: { pid: 810 }, E: { pid: null }, F: { pid: 99999 } };
  // 640 is t1's foreground and 730 t2's: found directly. 660 -> 655 -> 640: through its parents.
  // 810 ends at launchd without a terminal; no pid, or a pid ps doesn't list: none.
  assert.deepEqual(D.claimHolders(claims, psRows(), terms), { 640: "t1", 730: "t2", 660: "t1" });
  assert.deepEqual(D.claimHolders({ A: { pid: 610 } }, psRows(), [{ address: "t1", state: "live", pid: 610 }]), { 610: "t1" });
  assert.deepEqual(D.claimHolders({ A: { pid: 640 } }, psRows(), [{ ...terms[0], state: "finished" }]), {});
  assert.deepEqual(D.claimHolders(claims, [], terms), {});
});

test("idle text: none under 2 minutes, then minutes, from an hour hours", () => {
  const now = Date.UTC(2026, 10, 11, 12), min = 60000;
  assert.equal(D.idleText(now - 119000, now), null);
  assert.equal(D.idleText(now - 2 * min, now), "idle 2m");
  assert.equal(D.idleText(now - 14 * min - 59000, now), "idle 14m");
  assert.equal(D.idleText(now - 15 * min, now), "idle 15m");
  assert.equal(D.idleText(now - 59 * min, now), "idle 59m");
  assert.equal(D.idleText(now - 125 * min, now), "idle 2h");
  assert.equal(D.idleText(null, now), null);
  assert.equal(D.idleText(now + 5 * min, now), null);
});

test("pid mtimes: one stat over the claims folder, read as { id: ms }", () => {
  assert.deepEqual(D.pidMtimesArgv("/h/.cache/herdr-devices/claims").slice(3), ["sh", "/h/.cache/herdr-devices/claims"]);
  assert.deepEqual(D.parsePidMtimes("1762862400 U-1/pid\n1762862460 emulator-5554/pid\n  File: \"U-1/pid\"\n12 a/b/pid\n"), { "U-1": 1762862400000, "emulator-5554": 1762862460000 });
  assert.deepEqual(D.parsePidMtimes(undefined), {});
});

test("drivers: active when its CPU time grew since the last read", () => {
  const { drivers } = D.driversFrom(psRows(), terms, { 671: 38.31, 752: 1.9, 999: 5 });
  assert.deepEqual(drivers.map((x) => [x.pid, x.active]), [[671, false], [752, true]]);
});

test("Maestro pane: driving while its run is the foreground, not once it's the shell", () => {
  const d = { kind: "sim", id: UDID_A, name: "iPhone 17 Pro" }, argv = D.maestroArgv(d, "/p/.maestro");
  const pane = (fg) => ({ address: "t5", state: "live", argv, foreground: { argv: fg, pid: 1 } });
  assert.ok(D.maestroRunning(pane(argv), d));
  assert.ok(!D.maestroRunning(pane(["/bin/zsh", "-l"]), d));
  assert.ok(!D.maestroRunning(pane(argv), { ...d, id: UDID_B }));
  assert.deepEqual(D.deviceDrivers(d, [], [pane(argv)], []), [{ address: "t5", via: "pane", active: true }]);
  assert.deepEqual(D.deviceDrivers(d, [], [pane(["/bin/zsh", "-l"])], []), []);
  // Its own run's simulator-server is the same terminal: one driver, the pane.
  assert.deepEqual(D.deviceDrivers(d, [{ udid: UDID_A, address: "t5", active: false }], [pane(argv)], []), [{ address: "t5", via: "pane", active: true }]);
});

test("drivers of a device: active first, then the agent that changed last", () => {
  const d = { kind: "sim", id: UDID_A }, agents = [{ address: "t1", seq: 4 }, { address: "t2", seq: 9 }];
  const both = (a1, a2) => [{ udid: UDID_A, address: "t1", active: a1 }, { udid: UDID_A, address: "t2", active: a2 }, { udid: UDID_B, address: "t3", active: true }];
  assert.deepEqual(D.deviceDrivers(d, both(true, false), [], agents).map((x) => x.address), ["t1", "t2"]);
  assert.deepEqual(D.deviceDrivers(d, both(false, false), [], agents).map((x) => x.address), ["t2", "t1"]);
  assert.deepEqual(D.deviceDrivers({ kind: "sim", id: "OTHER" }, both(true, true), [], agents), []);
});

test("driver tag: the program's key, where it runs in the tip, maestro for the pane", () => {
  const mcp = { via: "mcp", address: "t1", active: false };
  const tag = D.driverTag(mcp, { address: "t1", tab_name: "3", space_name: "budget", status: "idle", program: { key: "claude", name: "Claude Code" } });
  assert.equal(tag.label, "claude");
  assert.equal(tag.tip, "Click to focus Claude Code · budget / 3 · idle · attached, idle · via Maestro MCP");
  assert.equal(D.driverTag(mcp, undefined, { address: "t1", program: { key: "codex", name: "Codex" } }).label, "codex");
  assert.equal(D.driverTag(mcp, undefined, { address: "t1" }).label, "t1");
  assert.equal(D.driverTag({ via: "pane", address: "t2", active: true }, undefined, undefined).label, "maestro");
});

test("drivers of a device: an agent's server is active only while the agent is working", () => {
  const d = { kind: "sim", id: UDID_A }, mcp = [{ udid: UDID_A, address: "t1", active: true }, { udid: UDID_A, address: "t2", active: true }];
  const active = (status) => D.deviceDrivers(d, mcp, [], [{ address: "t1", seq: 1, status }]).map((x) => [x.address, x.active]);
  // t2 isn't an agent: its CPU alone tells.
  assert.deepEqual(active("working"), [["t1", true], ["t2", true]]);
  assert.deepEqual(active("idle"), [["t2", true], ["t1", false]]);
  assert.deepEqual(active("blocked"), [["t2", true], ["t1", false]]);
});

test("flows default: the .maestro folder when there is one, else the folder", () => {
  assert.equal(D.flowsDefault("/p", true), "/p/.maestro");
  assert.equal(D.flowsDefault("/p", false), "/p");
  assert.equal(D.flowsDefault(null, true), "");
  assert.equal(D.flowsDefault(null, false), "");
});

test("maestro flows: find's paths as picker rows", () => {
  const out = ["/p/.maestro/Signup.yaml", "/p/.maestro/config.yaml", "/p/.maestro/auth/logout.yml", "/p/.maestro/auth/config.yaml", "/p/.maestro/auth/Login.yaml", "/p/.maestro/checkout.yml", "/p/.maestro-old/a.yaml", "/elsewhere/b.yaml", ""];
  assert.deepEqual(D.flowRows("/p/.maestro", out), [
    { label: "checkout", sub: "", path: "/p/.maestro/checkout.yml" },
    { label: "Signup", sub: "", path: "/p/.maestro/Signup.yaml" },
    { label: "config", sub: "auth/", path: "/p/.maestro/auth/config.yaml" },
    { label: "Login", sub: "auth/", path: "/p/.maestro/auth/Login.yaml" },
    { label: "logout", sub: "auth/", path: "/p/.maestro/auth/logout.yml" },
  ]);
  assert.deepEqual(D.flowRows("/p/.maestro/", ["/p/.maestro/a/b/deep.yaml", "/p/.maestro/config.yml"]), [{ label: "deep", sub: "a/b/", path: "/p/.maestro/a/b/deep.yaml" }]);
  assert.deepEqual(D.flowRows("/p/.maestro", [""]), []);
  assert.deepEqual(D.findFlowsArgv("/p/.maestro"), ["find", "-H", "/p/.maestro", "-maxdepth", "4", "-type", "f", "(", "-name", "*.yaml", "-o", "-name", "*.yml", ")"]);
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
  // A device over devicectl opens it in Safari; its other actions are never offered.
  const ios = { kind: "ios", id: "00008120-0000000000000002", name: "iPhone", state: "on" };
  assert.deepEqual(D.stepsFor("openurl", ios, x), [{ argv: ["xcrun", "devicectl", "device", "process", "launch", "--device", "00008120-0000000000000002", "com.apple.mobilesafari", "--payload-url", "https://x.test/?a=1&b='2'"] }]);
  for (const action of ["boot", "shutdown", "screenshot", "stop", "erase"]) assert.throws(() => D.stepsFor(action, ios, x), /Unknown action/);
  // adb shell hands its words to the device's shell: the URL arrives single-quoted.
  assert.equal(D.stepsFor("openurl", avd, x)[0].argv.at(-1), `'https://x.test/?a=1&b='\\''2'\\'''`);
  assert.deepEqual(D.stepsFor("stop", sim, { ...x, app: "com.example.budget" }), [{ argv: ["xcrun", "simctl", "terminate", "UDID-1", "com.example.budget"] }]);
  assert.deepEqual(D.stepsFor("stop", avd, { ...x, app: "com.example.budget" }), [{ argv: ["/sdk/adb", "-s", "emulator-5554", "shell", "am", "force-stop", "com.example.budget"] }]);
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

test("recents: booted (or pending) first, then by recency", () => {
  const list = [sim("old-on", "on", 100), sim("new-off", "off", 900), sim("new-boot", "off", 800), sim("older-off", "off", 50)];
  assert.deepEqual(D.sortRecent(list).map((d) => d.name), ["old-on", "new-off", "new-boot", "older-off"]);
  assert.deepEqual(D.sortRecent(list, {}, { "sim:new-boot": { phase: "booting", at: 0 } }).map((d) => d.name), ["new-boot", "old-on", "new-off", "older-off"]);
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

test("fold: anything not off plus the three most recent off ones; all shows everything", () => {
  const sorted = [sim("a", "off"), sim("b", "off"), sim("c", "off"), sim("d", "off"), sim("e", "on"), sim("f", "off"), sim("g", "booting")];
  const folded = D.foldRows(sorted);
  assert.deepEqual(folded.shown.map((d) => d.name), ["a", "b", "c", "e", "g"]);
  assert.equal(folded.hidden, 2);
  assert.deepEqual(D.foldRows(sorted, { pending: { "sim:f": { phase: "booting", at: 0 } } }).shown.map((d) => d.name), ["a", "b", "c", "e", "f", "g"]);
  assert.deepEqual(D.foldRows(sorted, { all: true }), { shown: sorted, hidden: 0 });
  assert.equal(D.foldRows(sorted.slice(0, 3)).hidden, 0);
  // Booted rows sort first: they don't use up the three.
  const booted = [sim("e", "on"), sim("g", "booting"), sim("h", "on"), sim("a", "off"), sim("b", "off"), sim("c", "off"), sim("d", "off"), sim("f", "off")];
  assert.deepEqual(D.foldRows(booted).shown.map((d) => d.name), ["e", "g", "h", "a", "b", "c"]);
  assert.equal(D.foldRows(booted).hidden, 2);
  assert.deepEqual(D.foldRows(booted, { pending: { "sim:a": { phase: "booting", at: 0 } } }).shown.map((d) => d.name), ["e", "g", "h", "a", "b", "c", "d"]);
});

test("unfolded when every section fits the list's height", () => {
  // 32 + 3 * 26 + 32 + 2 * 26 = 194
  const secs = [{ count: 3, closed: false }, { count: 2, closed: false }];
  assert.equal(D.fitsUnfolded(secs, 194), true);
  assert.equal(D.fitsUnfolded(secs, 193), false);
  // A closed section is its header: 32 + 32 + 2 * 26 = 116
  assert.equal(D.fitsUnfolded([{ count: 3, closed: true }, { count: 2, closed: false }], 116), true);
  // Before the first size: fold as usual.
  assert.equal(D.fitsUnfolded([], 0), false);
  assert.equal(D.fitsUnfolded(secs, -80), false);
  // A section states its row height (Running's two-line rows): 32 + 2 * 40 + 32 + 2 * 26 = 196
  const running = [{ count: 2, closed: false, row: 40 }, { count: 2, closed: false }];
  assert.equal(D.fitsUnfolded(running, 196), true);
  assert.equal(D.fitsUnfolded(running, 195), false);
  assert.equal(D.fitsUnfolded([{ count: 2, closed: true, row: 40 }], 32), true);
});

test("Running: every device not plainly off or with a phase, first; the sections keep their off ones", () => {
  const phone = (name, state) => ({ kind: "phone", id: name, serial: name, name, state, detail: "USB" });
  const secs = [
    { title: "iOS 26.5", devices: [sim("on", "on"), sim("off", "off"), sim("boot", "off")], empty: null },
    { title: "Android", devices: [phone("gone", "offline"), phone("auth", "unauthorized")], empty: null },
  ];
  const split = D.splitRunning(secs, { "sim:boot": { phase: "booting", at: 0 } });
  assert.deepEqual(split.map((s) => [s.title, s.devices.map((d) => d.name)]), [["Running", ["on", "boot", "gone", "auth"]], ["iOS 26.5", ["off"]]]);
  assert.equal(split[0].running, true);
  assert.equal(split[0].devices[0].section, "iOS 26.5");
  // All off: no Running, the sections as they were.
  const off = [{ title: "iOS 26.5", devices: [sim("a", "off"), sim("b", "off")], empty: null }];
  assert.deepEqual(D.splitRunning(off).map((s) => [s.title, s.devices.length]), [["iOS 26.5", 2]]);
  // A section emptied by the split goes, unless it has an empty line (Android's notes).
  const notes = { text: "adb not found" };
  assert.deepEqual(D.splitRunning([{ title: "Android", devices: [phone("p", "on")], empty: notes }]).map((s) => [s.title, s.devices.length, s.empty]), [["Running", 1, null], ["Android", 0, notes]]);
  assert.deepEqual(D.splitRunning([{ title: "iOS", devices: [], empty: notes }]).map((s) => s.title), ["iOS"]);
});

test("Running row's second line: the OS for a simulator, OS and link for an iPhone, else the detail; then the phase", () => {
  assert.equal(D.runningDetail({ kind: "sim", detail: "26.5", section: "iOS 26.5" }, null), "iOS 26.5");
  assert.equal(D.runningDetail({ kind: "ios", detail: "USB", section: "iOS 26.1" }, null), "iOS 26.1 · USB");
  assert.equal(D.runningDetail({ kind: "avd", detail: "API 36", section: "Android" }, "booting"), "API 36 · booting…");
});

test("filter: names holding the text, any case; sections without a match go", () => {
  const secs = [
    { title: "iOS 26.5", devices: [sim("iPhone 17 Pro", "on"), sim("iPad Air", "off")], empty: null },
    { title: "Android", devices: [{ kind: "avd", id: "Pixel_9", avd: "Pixel_9", name: "Pixel_9", state: "off" }], empty: null },
  ];
  assert.equal(D.filterSections(secs, ""), secs);
  assert.equal(D.filterSections(secs, "  "), secs);
  assert.deepEqual(D.filterSections(secs, " IPHONE").map((s) => [s.title, s.devices.map((d) => d.name)]), [["iOS 26.5", ["iPhone 17 Pro"]]]);
  assert.deepEqual(D.filterSections(secs, "p").map((s) => s.devices.length), [2, 1]);
  assert.deepEqual(D.filterSections(secs, "watch"), []);
});

test("phases: booting until booted (an AVD until boot_completed), stopping until off, three minutes at most", () => {
  const now = 1000000;
  const pending = { "sim:a": { phase: "booting", at: now - 1000 }, "sim:b": { phase: "stopping", at: now - 1000 }, "avd:p": { phase: "booting", at: now - 1000 }, "sim:old": { phase: "booting", at: now - 181000 } };
  const devices = [sim("a", "off"), sim("b", "on"), sim("old", "off"), { kind: "avd", id: "emulator-5554", serial: "emulator-5554", avd: "p", name: "p", state: "on" }];
  assert.deepEqual(Object.keys(D.settlePending(pending, devices, now)), ["sim:a", "sim:b", "avd:p"]);
  const later = [sim("a", "on"), sim("b", "off"), devices[2], devices[3]];
  assert.deepEqual(Object.keys(D.settlePending(pending, later, now)), ["avd:p"]);
  assert.deepEqual(Object.keys(D.settlePending(pending, later, now, new Set(["avd:p"]))), []);
  // A boot cancelled by Shut down: the entry turns stopping and ends once the device is off.
  const cancelled = { "sim:a": { phase: "stopping", at: now - 500 } };
  assert.deepEqual(Object.keys(D.settlePending(cancelled, [sim("a", "booting")], now)), ["sim:a"]);
  assert.deepEqual(Object.keys(D.settlePending(cancelled, [sim("a", "on")], now)), ["sim:a"]);
  assert.deepEqual(D.settlePending(cancelled, [sim("a", "off")], now), {});
  const avdCancelled = { "avd:p": { phase: "stopping", at: now - 500, avd: "p" } };
  assert.deepEqual(Object.keys(D.settlePending(avdCancelled, [{ kind: "avd", id: "emulator-5554", serial: "emulator-5554", avd: "p", name: "p", state: "offline" }], now)), ["avd:p"]);
  assert.deepEqual(D.settlePending(avdCancelled, [{ kind: "avd", id: "p", avd: "p", name: "p", state: "off" }], now), {});
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
  // A boot under way can be cancelled: a simulator always, an AVD once adb has its serial.
  assert.deepEqual(names(sim("a", "off"), "booting"), ["shutdown", "more"]);
  assert.deepEqual(names(sim("a", "booting"), "booting"), ["shutdown", "more"]);
  assert.deepEqual(names({ kind: "avd", id: "p", avd: "p", state: "off" }, "booting"), ["more"]);
  assert.deepEqual(names({ kind: "avd", id: "emulator-5554", serial: "emulator-5554", avd: "p", state: "offline" }, "booting"), ["shutdown", "more"]);
  assert.deepEqual(names(sim("a", "on"), "stopping"), ["screenshot", "more"]);
  assert.deepEqual(names(sim("a", "off"), "stopping"), ["more"]);
  assert.deepEqual(names(sim("a", "off"), "erasing"), ["more"]);
  assert.deepEqual(names({ kind: "phone", id: "R5", serial: "R5", state: "on" }), ["screenshot", "more"]);
  assert.equal(D.primaryAction(sim("a", "off")), null);
  assert.equal(D.primaryAction(sim("a", "on")), "focus");
  assert.equal(D.primaryAction(sim("a", "off"), "booting"), null);
  assert.equal(D.primaryAction({ kind: "avd", id: "p", avd: "p", state: "off" }), null);
  assert.equal(D.primaryAction({ kind: "avd", id: "e", serial: "e", avd: "p", state: "on" }), "focus");
  assert.equal(D.primaryAction({ kind: "phone", id: "R5", serial: "R5", state: "on" }), null);
  assert.equal(D.primaryAction({ kind: "ios", id: "U", state: "on" }), null);
  assert.deepEqual(names({ kind: "ios", id: "U", state: "on" }), ["more"]);
  // The rail has no hover icons: there a click boots what can boot.
  assert.equal(D.primaryAction(sim("a", "off"), null, { rail: true }), "boot");
  assert.equal(D.primaryAction(sim("a", "off"), null), null);
  assert.equal(D.primaryAction({ kind: "avd", id: "p", avd: "p", state: "off" }, null, { rail: true }), "boot");
  assert.equal(D.primaryAction(sim("a", "off"), "booting", { rail: true }), null);
  assert.equal(D.primaryAction(sim("a", "on"), null, { rail: true }), "focus");
  assert.equal(D.primaryAction({ kind: "phone", id: "R5", serial: "R5", state: "offline" }, null, { rail: true }), null);
});

test("keys: up / down through the visible rows, space boots or shuts down", () => {
  const keys = ["sim:a", "sim:b", "avd:p"];
  assert.equal(D.stepSelection(keys, null, 1), "sim:a");
  assert.equal(D.stepSelection(keys, null, -1), "avd:p");
  assert.equal(D.stepSelection(keys, "sim:a", 1), "sim:b");
  assert.equal(D.stepSelection(keys, "avd:p", 1), "sim:a");
  assert.equal(D.stepSelection(keys, "sim:a", -1), "avd:p");
  // A selection no longer shown starts over.
  assert.equal(D.stepSelection(keys, "sim:gone", 1), "sim:a");
  assert.equal(D.stepSelection(keys, "sim:gone", -1), "avd:p");
  assert.equal(D.stepSelection([], "sim:a", 1), null);
  assert.equal(D.stepSelection([], null, -1), null);
  assert.equal(D.toggleAction(sim("a", "off"), null), "boot");
  assert.equal(D.toggleAction(sim("a", "on"), null), "shutdown");
  assert.equal(D.toggleAction({ kind: "avd", id: "p", avd: "p", state: "off" }, null), "boot");
  assert.equal(D.toggleAction({ kind: "avd", id: "e", serial: "e", avd: null, state: "off" }, null), null);
  assert.equal(D.toggleAction({ kind: "avd", id: "e", serial: "e", avd: null, state: "on" }, null), "shutdown");
  assert.equal(D.toggleAction({ kind: "phone", id: "R5", serial: "R5", state: "on" }, null), null);
  assert.equal(D.toggleAction({ kind: "ios", id: "U", state: "on" }, null), null);
  assert.equal(D.toggleAction({ kind: "phone", id: "R5", serial: "R5", state: "offline" }, null), null);
  // Not during a phase, except a simulator's boot, which space cancels like the icon.
  assert.equal(D.toggleAction(sim("a", "off"), "booting"), "shutdown"); // cancels the boot, like the icon
  assert.equal(D.toggleAction({ kind: "avd", id: "p", avd: "p", state: "off" }, "booting"), null);
  assert.equal(D.toggleAction(sim("a", "on"), "stopping"), null);
});

test("footer", () => {
  const android = [{ kind: "avd" }, { kind: "phone" }], sims = (n) => Array.from({ length: n }, () => ({ kind: "sim" }));
  assert.equal(D.footerText(sims(5), android, 1000, 4000), "5 simulators · 1 emulator · 1 device");
  // iOS phones count as devices next to the Android ones.
  assert.equal(D.footerText([...sims(2), { kind: "ios" }], android, 1000, 1000), "2 simulators · 1 emulator · 2 devices");
  assert.equal(D.footerText([{ kind: "ios" }], [], 0, 5), "1 device");
  // Only a stalled read, a minute or more old, is worth showing.
  assert.equal(D.footerText(sims(1), [], 1000, 1000 + 59999), "1 simulator");
  assert.equal(D.footerText(sims(1), [], 1000, 1000 + 60000), "1 simulator · refreshed 1m ago");
  assert.equal(D.footerText([], [], 0, 5), "No devices");
  assert.match(D.footerText([], [], 1, 1 + 125000), /^No devices · refreshed 2m ago$/);
});

test("row icon by name", () => {
  const icons = (...names) => names.map((name) => D.deviceIcon({ name }));
  assert.deepEqual(icons("iPhone 17 Pro", "Pixel_9_Pro_API_36", "SM-S928B"), ["smartphone", "smartphone", "smartphone"]);
  assert.deepEqual(icons("iPad Pro 13-inch (M5)", "Pixel_Tablet_API_35", "Pixel Fold"), ["tablet", "tablet", "tablet"]);
  assert.deepEqual(icons("Apple Watch Series 11", "Wear_OS_Large_Round", "Apple Watch"), ["watch", "watch", "watch"]);
  assert.deepEqual(icons("Apple TV 4K (3rd generation)", "Television_1080p_API_34", "Apple Vision Pro"), ["tv", "tv", "glasses"]);
});

test("menu dividers fall where the group changes", () => {
  const items = D.actionsFor({ kind: "sim", id: "U", state: "on", apps: ["com.example.budget"] }, { lastFlow: "/p/.maestro/login.yml" });
  assert.deepEqual(items.map((a) => a.action), ["shutdown", "screenshot", "openurl", "maestro", "maestroAgain", "copyapp", "stop", "copy", "erase"]);
  assert.deepEqual(items.map((_a, i) => D.dividerBefore(items, i)), [false, true, false, true, false, true, false, true, true]);
  assert.equal(D.menuDividers(items), 5);
  assert.equal(D.menuDividers(D.actionsFor({ kind: "sim", id: "U", state: "off" })), 2);
});

test("claimId: the UDID for simulators and iPhones, the serial for running Android, none for an off AVD", () => {
  assert.equal(D.claimId({ kind: "sim", id: "U-1" }), "U-1");
  assert.equal(D.claimId({ kind: "ios", id: "I-1" }), "I-1");
  assert.equal(D.claimId({ kind: "avd", id: "emulator-5554", serial: "emulator-5554", avd: "a" }), "emulator-5554");
  assert.equal(D.claimId({ kind: "phone", id: "R5CT", serial: "R5CT" }), "R5CT");
  assert.equal(D.claimId({ kind: "avd", id: "a", avd: "a", state: "off" }), null);
});

test("claimsFrom: owner's first line (40 characters at most) or none, pid as a number or none", () => {
  const claims = D.claimsFrom([{ name: "U-1", owner: "claude\nsecond line\n", pid: "4242\n" }, { name: "U-2", owner: null }, { name: "U-3", owner: "x".repeat(60), pid: "not a pid" }, { name: "U-4", pid: "0" }]);
  assert.deepEqual(claims, { "U-1": { owner: "claude", pid: 4242, start: null, used: null }, "U-2": { owner: null, pid: null, start: null, used: null }, "U-3": { owner: "x".repeat(40), pid: null, start: null, used: null }, "U-4": { owner: null, pid: null, start: null, used: null } });
  assert.equal(D.claimsFrom([{ name: "U-5", pid: "7", start: " Sat Nov  7 01:36:10 2026 \n" }])["U-5"].start, "Sat Nov  7 01:36:10 2026");
  assert.equal(D.claimsFrom([{ name: "U-6", pid: "7", used: 1762862400000 }])["U-6"].used, 1762862400000);
});

test("staleClaims: ids whose pid is not in ps; no pid or no rows keeps them", () => {
  const rows = psRows(), claims = { A: { pid: 640 }, B: { pid: 99999 }, C: { pid: null } };
  assert.deepEqual(D.staleClaims(claims, rows), ["B"]);
  assert.deepEqual(D.staleClaims(claims, []), []);
  // A recorded start is compared when ps printed one: another start means the pid was reused.
  const started = [{ pid: 640, start: "Thu Nov  5 09:16:37 2026" }];
  assert.deepEqual(D.staleClaims({ A: { pid: 640, start: "Thu Nov  5 09:16:37 2026" }, B: { pid: 640, start: "Mon Nov  2 08:00:00 2026" }, C: { pid: 640, start: null } }, started), ["B"]);
  assert.deepEqual(D.staleClaims({ A: { pid: 640, start: "Mon Nov  2 08:00:00 2026" } }, [{ pid: 640, start: null }]), []);
});

test("CLAIM_ID: a single safe path segment", () => {
  for (const id of ["..", "a/b", ""]) assert.equal(D.CLAIM_ID.test(id), false);
  for (const id of ["00008110-001A2B3C4D5E601E", "emulator-5554"]) assert.equal(D.CLAIM_ID.test(id), true);
});

test("deviceTags: one pill for lock (claimed) or link (driven), color for liveness, two on a mismatch", () => {
  const mcp = (address, active) => ({ via: "mcp", address, active });
  const agents = [{ address: "t1", status: "working", program: { key: "claude", name: "Claude Code" } }, { address: "t2", status: "idle", program: { key: "codex", name: "Codex" } }];
  const claim = { owner: "claude", pid: 4242 };
  const same = D.deviceTags(claim, [mcp("t1", true)], agents, []);
  assert.deepEqual(same.map((g) => [g.icon, g.label, g.tone, g.focus, g.terminal]), [["lock", "claude", "working", "agent.focus", "t1"]]);
  assert.match(same[0].tip, /^Claimed by claude · pid 4242\nClick to focus Claude Code/);
  assert.equal(same[0].release, true);
  const held = D.deviceTags({ owner: "codex", pid: null }, [], agents, []);
  assert.deepEqual(held.map((g) => [g.icon, g.label, g.tone, g.focus]), [["lock", "codex", "idle", undefined]]);
  assert.ok(held[0].tip.endsWith("Claimed by codex · not attached"));
  const driving = D.deviceTags(undefined, [mcp("t2", false)], agents, []);
  assert.deepEqual(driving.map((g) => [g.icon, g.label, g.tone]), [["link", "codex", "idle"]]);
  assert.ok(driving[0].tip.endsWith("\nNot claimed"));
  assert.deepEqual(D.deviceTags(undefined, [], agents, []), []);
  const mismatch = D.deviceTags(claim, [mcp("t2", false)], agents, []);
  assert.deepEqual(mismatch.map((g) => [g.icon, g.label, g.tone, g.focus]), [["lock", "claude", "idle", undefined], ["triangle", "codex", "blocked", "agent.focus"]]);
  assert.equal(D.deviceTags({ owner: "Claude", pid: 1 }, [mcp("t1", false)], agents, []).length, 1);
  assert.deepEqual(D.deviceTags({ owner: null, pid: 1 }, [], agents, []).map((g) => [g.icon, g.label]), [["lock", ""]]);
  assert.equal(D.deviceTags({ owner: null, pid: 1 }, [mcp("t2", false)], agents, []).length, 1);
  const pane = D.deviceTags(claim, [{ via: "pane", address: "t3", active: true }], agents, []);
  assert.deepEqual(pane.map((g) => [g.icon, g.label, g.tone, g.focus]), [["lock", "claude", "idle", undefined], ["triangle", "maestro", "blocked", "pane.focus"]]);
  // Only the claim's pill releases it.
  assert.deepEqual(mismatch.map((g) => g.release), [true, undefined]);
  assert.equal(driving[0].release, undefined);
});

test("deviceTags with the holder's terminal: its session's name, a click that focuses it, mismatch by address", () => {
  const mcp = (address, active) => ({ via: "mcp", address, active });
  const icon = { key: "claude", name: "Claude Code", icon: "icons/claude.svg", tint: true };
  const agents = [
    { address: "t1", status: "working", title: "Panel vertical size limit", tab_name: "3", space_name: "budget", program: icon },
    { address: "t2", status: "idle", title: "  ", tab_name: "review", space_name: "budget", program: { key: "claude", name: "Claude Code", icon: null } },
    { address: "t4", status: "idle", title: "", tab_name: "", space_name: "budget", program: { key: "codex", name: "Codex" } },
  ];
  const claim = { owner: "claude", pid: 4242 };
  // Label: the title, else the tab, else the space, trimmed; the program rides along when it has an icon.
  const t1 = D.deviceTags(claim, [], agents, [], { holder: "t1" });
  assert.deepEqual(t1.map((g) => [g.icon, g.label, g.tone, g.focus, g.terminal, g.program, g.release]), [["lock", "Panel vertical size limit", "idle", "agent.focus", "t1", icon, true]]);
  assert.equal(t1[0].tip, "Click to focus Claude Code\nClaimed by Claude Code · budget / 3 · working · pid 4242 · not attached");
  assert.equal(D.deviceTags(claim, [], agents, [], { holder: "t2" })[0].label, "review");
  assert.equal(D.deviceTags(claim, [], agents, [], { holder: "t2" })[0].program, null);
  assert.equal(D.deviceTags(claim, [], agents, [], { holder: "t4" })[0].label, "budget");
  // A terminal that isn't an agent: pane.focus, the owner's label.
  const shell = D.deviceTags(claim, [], agents, [{ address: "t7", program: { key: "zsh", name: "zsh", icon: null } }], { holder: "t7" });
  assert.deepEqual(shell.map((g) => [g.label, g.focus, g.terminal]), [["claude", "pane.focus", "t7"]]);
  assert.match(shell[0].tip, /^Click to focus zsh\nClaimed by claude · pid 4242/);
  // Driving from the holder's terminal: one pill in the driver's tone. From another: a mismatch, even
  // when both are `claude` (the label rule alone would call it a match).
  assert.deepEqual(D.deviceTags(claim, [mcp("t1", true)], agents, [], { holder: "t1" }).map((g) => [g.icon, g.tone, g.focus, g.terminal]), [["lock", "working", "agent.focus", "t1"]]);
  const other = D.deviceTags(claim, [mcp("t2", true)], agents, [], { holder: "t1" });
  assert.deepEqual(other.map((g) => [g.icon, g.label, g.tone, g.focus, g.terminal]), [["lock", "Panel vertical size limit", "idle", "agent.focus", "t1"], ["triangle", "claude", "blocked", "agent.focus", "t2"]]);
  // Holder unknown: the label rule, and the lock clicks only when it stands for the first driver.
  assert.equal(D.deviceTags(claim, [mcp("t2", true)], agents, []).length, 1);
  assert.equal(D.deviceTags(claim, [mcp("t2", true)], agents, [])[0].terminal, "t2");
});

test("deviceTags idle text: a hook's claim only, dim from 15 minutes on", () => {
  const now = Date.UTC(2026, 10, 11, 12), min = 60000, start = "Wed Nov 11 09:00:00 2026";
  const agents = [{ address: "t1", status: "working", title: "x", tab_name: "1", space_name: "s", program: { key: "claude", name: "Claude Code" } }];
  const tag = (used, claim = { owner: "claude", pid: 7, start }) => D.deviceTags({ ...claim, used }, [{ via: "mcp", address: "t1", active: true }], agents, [], { holder: "t1", now })[0];
  assert.equal(tag(now - min).idle, null);
  assert.equal(tag(now - 14 * min).idle, "idle 14m");
  assert.equal(tag(now - 14 * min).tone, "working");
  assert.match(tag(now - 14 * min).tip, /· pid 7 · idle 14m\n/);
  assert.equal(tag(now - 15 * min).tone, "idle");
  assert.match(tag(now - 15 * min).tip, /· idle 15m · another agent can take it over\n/);
  assert.equal(tag(now - 130 * min).idle, "idle 2h");
  // No pid (a manual reservation), no start (made by hand: never idle to the hook) or no mtime: none.
  assert.equal(tag(now - 30 * min, { owner: null, pid: null, start: null }).idle, null);
  assert.equal(tag(now - 30 * min, { owner: null, pid: 7, start: null }).idle, null);
  assert.equal(tag(null).idle, null);
  assert.equal(tag(null).tone, "working");
});

test("Release claim: in the menu only when claimed, after the Maestro items", () => {
  const sim = { kind: "sim", id: "U", state: "on" };
  const names = (o) => D.actionsFor(sim, o).map((a) => a.action);
  assert.deepEqual(names({ lastFlow: "/p/a.yaml", claim: { owner: null, pid: null } }), ["shutdown", "screenshot", "openurl", "maestro", "maestroAgain", "release", "copy", "erase"]);
  assert.ok(!names({}).includes("release"));
  assert.equal(D.actionsFor(sim, { claim: {} }).find((a) => a.action === "release").label, "Release claim");
});

test("stepsFor release: rm -r of the claim folder, nothing outside it", () => {
  const x = { claimsDir: "/Users/me/.cache/herdr-devices/claims" };
  assert.deepEqual(D.stepsFor("release", { kind: "sim", id: "U-1" }, x), [{ argv: ["rm", "-r", "/Users/me/.cache/herdr-devices/claims/U-1"] }]);
  assert.deepEqual(D.stepsFor("release", { kind: "avd", id: "emulator-5554", serial: "emulator-5554" }, x)[0].argv[2], `${x.claimsDir}/emulator-5554`);
  assert.deepEqual(D.stepsFor("release", { kind: "ios", id: "I-1" }, x)[0].argv[2], `${x.claimsDir}/I-1`);
  for (const id of ["../x", "a/b", "..", ".", ""]) assert.throws(() => D.stepsFor("release", { kind: "sim", id }, x), /Unexpected claim/);
  assert.throws(() => D.stepsFor("release", { kind: "avd", id: "a", avd: "a" }, x), /Unexpected claim/); // off AVD: no id
  assert.throws(() => D.stepsFor("release", { kind: "sim", id: "U-1" }, { claimsDir: "claims" }), /Unexpected claim/);
  assert.throws(() => D.stepsFor("release", { kind: "sim", id: "U-1" }, {}), /Unexpected claim/);
});

test("hookDetected: the plugin, or claim.sh in Claude's settings or Codex's hooks", () => {
  const none = { plugins: null, claudeSettings: null, codexHooks: null };
  assert.equal(D.hookDetected({ ...none, plugins: '{"plugins":{"herdr-devices@ernestjsf-herdr-devices":[{}]}}' }), true);
  assert.equal(D.hookDetected({ ...none, codexHooks: '{"hooks":{"PreToolUse":[{"hooks":[{"command":"/p/hooks/claim.sh codex"}]}]}}' }), true);
  assert.equal(D.hookDetected({ ...none, claudeSettings: '{"hooks":{"PreToolUse":[{"hooks":[{"command":"/p/claim.sh claude"}]}]}}' }), true);
  assert.equal(D.hookDetected({ ...none, codexConfig: '[[hooks.PreToolUse]]\ncommand = "/p/hooks/claim.sh codex"' }), true);
  assert.equal(D.hookDetected({ ...none, claudeLocal: '{"hooks":{"PreToolUse":[{"hooks":[{"command":"/p/claim.sh claude"}]}]}}' }), true);
  // A local-scope install belongs to one project, which may not be this one; a user-scope one counts.
  assert.equal(D.hookDetected({ ...none, plugins: '{"plugins":{"herdr-devices@m":[{"scope":"local","projectPath":"/elsewhere"}]}}' }), false);
  assert.equal(D.hookDetected({ ...none, plugins: '{"plugins":{"herdr-devices@m":[{"scope":"local"},{"scope":"user"}]}}' }), true);
  assert.equal(D.hookDetected({ ...none, plugins: "not json" }), false);
  assert.equal(D.hookDetected(none), false);
  assert.equal(D.hookDetected({ plugins: '{"plugins":{"other@x":[]}}', claudeSettings: '{"theme":"dark"}', codexHooks: "{}" }), false);
});

test("polls back off to every third tick once the list has been the same six times", () => {
  for (let tick = 1; tick <= 6; tick++) assert.equal(D.pollDue(tick - 1, tick), true);
  assert.deepEqual([7, 8, 9, 10, 11, 12].map((tick) => D.pollDue(6, tick)), [false, false, true, false, false, true]);
  assert.equal(D.pollDue(0, 10), true); // a change resets
});

test("emulatorWindowTitle takes the port from the serial", () => {
  assert.equal(D.emulatorWindowTitle({ kind: "avd", avd: "Pixel_7", serial: "emulator-5556" }), "Android Emulator - Pixel_7:5556");
  assert.equal(D.emulatorWindowTitle({ kind: "avd", avd: "Pixel_7" }), null);
  assert.equal(D.emulatorWindowTitle({ kind: "avd", serial: "emulator-5554" }), null);
  assert.equal(D.emulatorWindowTitle({ kind: "avd", avd: "Pixel_7", serial: "R5CT" }), null);
});

test("focusCommand per platform and kind", () => {
  const avd = { kind: "avd", avd: "Pixel_7", serial: "emulator-5554" };
  const mac = D.focusCommand("macos", { kind: "sim", name: "iPhone 17 Pro" });
  assert.equal(mac.cmd, "osascript");
  assert.equal(mac.args.at(-1), "iPhone 17 Pro – "); // en dash: not a prefix of "iPhone 17 Pro B"
  assert.equal(mac.args.at(-2), "--");
  assert.match(mac.args[1], /menu "Window"/);
  assert.ok(!mac.args[1].includes("iPhone")); // the name travels as argv, never inside the script
  const byPid = D.focusCommand("macos", avd, "4242");
  assert.equal(byPid.cmd, "osascript");
  assert.match(byPid.args[1], /unix id is 4242\) to true$/);
  assert.deepEqual(D.focusCommand("linux", avd), { cmd: "xdotool", args: ["search", "--name", "Android Emulator - Pixel_7:5554", "windowactivate"] });
  const win = D.focusCommand("windows", { ...avd, avd: "O'Neil" });
  assert.equal(win.cmd, "powershell");
  assert.equal(win.args.at(-1), "(New-Object -ComObject WScript.Shell).AppActivate('Android Emulator - O''Neil:5554')");
});

test("focusCommand is null where there is nothing to raise", () => {
  const avd = { kind: "avd", avd: "Pixel_7", serial: "emulator-5554" };
  assert.equal(D.focusCommand("macos", avd), null);
  assert.equal(D.focusCommand("macos", avd, "4242; rm"), null);
  assert.equal(D.focusCommand("linux", { kind: "avd", avd: "Pixel_7" }), null);
  assert.equal(D.focusCommand("windows", { kind: "avd", serial: "emulator-5554" }), null);
  for (const platform of ["macos", "linux", "windows"]) {
    assert.equal(D.focusCommand(platform, { kind: "phone", serial: "R5", name: "Pixel" }, "1"), null);
    assert.equal(D.focusCommand(platform, { kind: "ios", id: "U", name: "iPhone" }, "1"), null);
  }
  assert.equal(D.focusCommand("linux", { kind: "sim", name: "iPhone 17 Pro" }), null);
  assert.equal(D.focusCommand("windows", { kind: "sim", name: "iPhone 17 Pro" }), null);
  assert.equal(D.focusCommand("plan9", avd, "1"), null);
});

test("sameApps: the same front app and the same apps behind it, in any order", () => {
  assert.equal(D.sameApps([], []), true);
  assert.equal(D.sameApps(["a", "b", "c"], ["a", "c", "b"]), true);
  assert.equal(D.sameApps(["a", "b"], ["b", "a"]), false);
  assert.equal(D.sameApps(["a", "b"], ["a"]), false);
  assert.equal(D.sameApps([], ["a"]), false);
});
