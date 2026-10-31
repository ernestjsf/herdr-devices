// What the device tools print, read into rows, and the argv of every action.
// No herdr imports: the tests run this on captured output.

const OS_ORDER = ["iOS", "watchOS", "tvOS", "visionOS"];

// "com.apple.CoreSimulator.SimRuntime.iOS-26-0" -> "iOS 26.0".
export function runtimeLabel(id) {
  const m = /SimRuntime\.([A-Za-z]+)-(\d+(?:-\d+)*)$/.exec(id);
  if (!m) return id;
  return `${m[1] === "xrOS" ? "visionOS" : m[1]} ${m[2].replaceAll("-", ".")}`;
}

const simState = (s) => (s === "Booted" ? "on" : s === "Shutdown" ? "off" : s.toLowerCase());

// `xcrun simctl list devices -j` -> one section per runtime that has an
// available device, iOS first, newest version first.
export function parseSimctl(json) {
  const sections = [];
  for (const [runtime, list] of Object.entries(JSON.parse(json).devices ?? {})) {
    const title = runtimeLabel(runtime), detail = title.split(" ").pop();
    const devices = list.filter((d) => d.isAvailable).map((d) => ({ kind: "sim", id: d.udid, name: d.name, state: simState(d.state), detail, lastUsed: Date.parse(d.lastBootedAt ?? "") || 0 }));
    if (devices.length) sections.push({ title, devices });
  }
  const rank = (title) => {
    const [os, version] = title.split(" ");
    const i = OS_ORDER.indexOf(os);
    return [i < 0 ? OS_ORDER.length : i, (version ?? "").split(".").map(Number)];
  };
  return sections.sort((a, b) => {
    const [ai, av] = rank(a.title), [bi, bv] = rank(b.title);
    if (ai !== bi) return ai - bi;
    for (let k = 0; k < Math.max(av.length, bv.length); k++) if ((av[k] ?? 0) !== (bv[k] ?? 0)) return (bv[k] ?? 0) - (av[k] ?? 0);
    return 0;
  });
}

// The AVD home's files -> AVD names: each AVD has a <name>.ini there (names
// are [A-Za-z0-9._-]).
export const avdNamesFrom = (files) => files.map((f) => /^([A-Za-z0-9._-]+)\.ini$/.exec(f)?.[1]).filter(Boolean).sort((a, b) => a.localeCompare(b));

// Whether a watchFolder batch on the AVD home added, changed or removed an
// AVD: a <name>.ini, not one inside a running AVD's <name>.avd folder.
export const avdListChanged = (paths) => paths.some((p) => p.endsWith(".ini") && !/\.avd\//.test(p));

// `adb devices -l` -> [{ serial, state, model }].
export function parseAdbDevices(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith("List of devices") || l.startsWith("*")) continue;
    const [serial, state] = l.split(/\s+/);
    if (!state) continue;
    out.push({ serial, state, model: /\bmodel:(\S+)/.exec(l)?.[1].replaceAll("_", " ") ?? null });
  }
  return out;
}

export const isEmulator = (serial) => /^emulator-\d+$/.test(serial);

// The serial -> AVD name cache against a new `adb devices` read: names of the
// serials adb still lists stay (`keep`); running emulators without one are to
// be asked (`ask`).
export function nameCache(cache, adb) {
  const listed = new Set(adb.map((d) => d.serial));
  const keep = Object.fromEntries(Object.entries(cache).filter(([serial]) => listed.has(serial)));
  return { keep, ask: adb.filter((d) => isEmulator(d.serial) && d.state === "device" && !keep[d.serial]).map((d) => d.serial) };
}

// `adb -s emulator-5554 emu avd name` prints "<name>\r\nOK".
export const parseEmuAvdName = (text) => text.split(/\r?\n/)[0].trim() || null;

const adbState = (s) => (s === "device" ? "on" : s);

// How a phone is attached: adb-over-Wi-Fi serials carry a host:port or mDNS name.
export const phoneLink = (serial) => (/:\d+$|\._adb-tls-connect\./.test(serial) ? "Wi-Fi" : "USB");

// AVDs (running or not) and physical devices in one list. `names` maps a
// running emulator's serial to its AVD name; `apis` an AVD's name to "API 36".
export function androidDevices(avds, adb, names, apis = {}) {
  const running = new Map();
  for (const d of adb) if (isEmulator(d.serial) && names[d.serial]) running.set(names[d.serial], d);
  const rows = avds.map((name) => {
    const r = running.get(name);
    const detail = apis[name] ?? "emulator";
    return r ? { kind: "avd", id: r.serial, serial: r.serial, avd: name, name, state: adbState(r.state), detail } : { kind: "avd", id: name, avd: name, name, state: "off", detail };
  });
  for (const d of adb) {
    const name = names[d.serial];
    if (isEmulator(d.serial)) {
      // An emulator of an AVD the list doesn't know (another AVD home), or still starting.
      if (!name || !avds.includes(name)) rows.push({ kind: "avd", id: d.serial, serial: d.serial, avd: null, name: name ?? d.serial, state: adbState(d.state), detail: "emulator" });
    } else rows.push({ kind: "phone", id: d.serial, serial: d.serial, name: d.model ?? d.serial, state: adbState(d.state), detail: phoneLink(d.serial) });
  }
  return rows;
}

// Where to look for a tool: PATH first, then the Android SDK's homes.
export function toolCandidates(name, { androidHome, sdkRoot, home }) {
  if (name === "xcrun") return ["xcrun"];
  const sub = name === "adb" ? "platform-tools/adb" : "emulator/emulator";
  const roots = [androidHome, sdkRoot, `${home}/Library/Android/sdk`].filter(Boolean);
  return [name, ...new Set(roots.map((r) => `${r.replace(/\/+$/, "")}/${sub}`))];
}

// `<avd home>/<name>.ini` names the AVD's folder on its `path=` line.
export const parseAvdIni = (text) => /^path=(.+)$/m.exec(text ?? "")?.[1].trim() || null;

// Its `target=android-36` line -> "API 36".
export const avdApi = (text) => {
  const level = /^target=android-(\w+)/m.exec(text ?? "")?.[1];
  return level ? `API ${level}` : null;
};

// How long a tool none of whose paths started counts as not installed, so the
// polls don't try every path each time.
const MISSING_MS = 60000;
export const stillMissing = (at, now) => at != null && now - at < MISSING_MS;

// Why exec rejected: "missing" (the program isn't there), "timeout" (exec
// stops a program after 30 s), else "failed" (it couldn't start otherwise).
export function execFailure(e) {
  const m = String(e?.message ?? e);
  return /cannot run .+: No such file or directory/.test(m) ? "missing" : /took longer than \d+ s/.test(m) ? "timeout" : "failed";
}

// A rejection as a line to show: "<tool> not found", "<what> timed out", else
// its own words.
export function rejectionLine(e, what) {
  const m = String(e?.message ?? e).replace(/^`herdr\.exec`: /, "");
  const kind = execFailure(e);
  if (kind === "missing") return `${/^cannot run (.+?): /.exec(m)[1].split("/").pop()} not found`;
  return kind === "timeout" ? `${what} timed out` : m;
}

// The line of a failed command worth showing. simctl opens every error with a
// generic "An error was encountered..." line; the reason is on the next one.
export function errorLine(r) {
  const lines = `${r.stderr ?? ""}\n${r.stdout ?? ""}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => !l.startsWith("An error was encountered processing the command")) ?? `exit code ${r.code}`;
}

// ~/Desktop/<name>-20261031-142501.png
export function screenshotPath(home, name, date) {
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `${home}/Desktop/${name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "device"}-${stamp}.png`;
}

// A URL worth sending: a scheme, then something.
export const validUrl = (url) => /^[A-Za-z][A-Za-z0-9+.-]*:\S+$/.test(url.trim());

// `adb shell` joins its arguments into one command line for the device's
// shell, so a value must be quoted for that shell.
const deviceQuote = (s) => `'${s.replaceAll("'", `'\\''`)}'`;

const REMOTE_SHOT = "/sdcard/herdr-devices-shot.png";

// Where a detached emulator's output goes: $TMPDIR/herdr-devices-<avd>.log.
export const emulatorLogPath = (tmp, avd) => `${(tmp || "/tmp").replace(/\/+$/, "")}/herdr-devices-${avd}.log`;

// `pgrep -f` pattern for an emulator of this AVD: `-avd <name>`, then a space
// or the end, so Pixel_7 doesn't match Pixel_7_API_34.
export const avdProcessPattern = (avd) => `-avd ${avd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`;

// The last line with something on it, or null.
export const lastLine = (text) => (text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() ?? null;

// Starts a program detached with its output in a log: sh -c DETACH sh <log> <argv...>.
const DETACH = 'log=$1; shift; nohup "$@" >"$log" 2>&1 &';

// What a row offers, in menu order.
export function actionsFor(d) {
  const on = d.state === "on", list = [];
  if (d.kind === "sim" || (d.kind === "avd" && d.avd)) {
    if (on) list.push({ action: "shutdown", label: "Shut down", icon: "power" });
    else if (d.state === "off") list.push({ action: "boot", label: "Boot", icon: "play" });
  } else if (d.kind === "avd" && on) list.push({ action: "shutdown", label: "Shut down", icon: "power" });
  if (on) list.push({ action: "screenshot", label: "Screenshot", icon: "camera" }, { action: "openurl", label: "Open URL…", icon: "link" });
  list.push({ action: "copy", label: d.kind === "sim" ? "Copy UDID" : d.serial ? "Copy serial" : "Copy name", icon: "copy" });
  // An AVD is erased by deleting its files, so only while it's off.
  if (d.kind === "sim" || (d.kind === "avd" && d.avd && d.state === "off")) list.push({ action: "erase", label: "Erase…", icon: "trash", danger: true });
  return list;
}

// The commands an action runs, in order: { argv, ok } where ok lists the exit
// codes that count as success ("any": the step may fail). `x` carries the tool
// paths (adb, emulator), the screenshot path, the URL and the AVD's folder.
export function stepsFor(action, d, x) {
  const sim = d.kind === "sim";
  const adb = (...args) => [x.adb, "-s", d.serial, ...args];
  switch (action) {
    case "boot":
      // 149: already booted. The emulator never returns, so it's started detached.
      return sim
        ? [{ argv: ["xcrun", "simctl", "boot", d.id], ok: [0, 149] }, { argv: ["open", "-a", "Simulator"] }]
        : [{ argv: ["sh", "-c", DETACH, "sh", x.log, x.emulator, "-avd", d.avd] }];
    case "shutdown":
      return sim ? [{ argv: ["xcrun", "simctl", "shutdown", d.id] }] : [{ argv: adb("emu", "kill") }];
    case "screenshot":
      return sim
        ? [{ argv: ["xcrun", "simctl", "io", d.id, "screenshot", x.path] }]
        : [{ argv: adb("shell", "screencap", "-p", REMOTE_SHOT) }, { argv: adb("pull", REMOTE_SHOT, x.path) }, { argv: adb("shell", "rm", "-f", REMOTE_SHOT), ok: "any" }];
    case "openurl":
      return sim
        ? [{ argv: ["xcrun", "simctl", "openurl", d.id, x.url] }]
        : [{ argv: adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", deviceQuote(x.url)) }];
    case "erase": {
      if (sim) return [{ argv: ["xcrun", "simctl", "shutdown", d.id], ok: "any" }, { argv: ["xcrun", "simctl", "erase", d.id] }];
      // Never rm anything but an absolute "<something>.avd" folder's data.
      if (!/^\/.+\.avd$/.test(x.avdPath ?? "")) throw new Error(`Unexpected AVD folder: ${x.avdPath}`);
      return [{ argv: ["sh", "-c", 'rm -rf "$1"/userdata-qemu.img* "$1"/snapshots', "sh", x.avdPath] }];
    }
  }
  throw new Error(`Unknown action: ${action}`);
}

// One id per device across reads: an AVD keeps its name while its serial
// comes and goes.
export const deviceKey = (d) => (d.kind === "avd" ? `avd:${d.avd ?? d.id}` : `${d.kind}:${d.id}`);

// Most recently used first: simctl's lastBootedAt, or the latest action this
// mod ran on it (`used`: key -> ms). Ties keep their order.
export function sortRecent(devices, used = {}) {
  const at = (d) => Math.max(d.lastUsed ?? 0, used[deviceKey(d)] ?? 0);
  return devices.map((d, i) => [d, i]).sort(([a, i], [b, j]) => at(b) - at(a) || i - j).map(([d]) => d);
}

// A section's rows by default: the `keep` most recent plus every one that
// isn't off (booted, starting, offline) or has an action under way.
export function foldRows(sorted, { all = false, pending = {}, keep = 3 } = {}) {
  if (all) return { shown: sorted, hidden: 0 };
  const shown = sorted.filter((d, i) => i < keep || d.state !== "off" || pending[deviceKey(d)]);
  return { shown, hidden: sorted.length - shown.length };
}

const PENDING_MS = 180000;
const LAUNCH_GRACE_MS = 10000;

// Boot and shut down are under way from the press until the device gets
// there (an AVD: until it reports sys.boot_completed, `completed` holds its
// key), or for at most three minutes; `ended` holds keys to end now. Returns
// the entries still under way.
export function settlePending(pending, devices, now, completed = new Set(), ended = new Set()) {
  const byKey = new Map(devices.map((d) => [deviceKey(d), d]));
  const next = {};
  for (const [key, p] of Object.entries(pending ?? {})) {
    if (now - p.at > PENDING_MS || ended.has(key)) continue;
    const d = byKey.get(key);
    if (p.phase === "booting" && d?.state === "on" && (d.kind !== "avd" || completed.has(key))) continue;
    if (p.phase === "stopping" && (!d || d.state === "off")) continue;
    next[key] = p;
  }
  return next;
}

// What the settle pass does with an AVD's emulator launch under way (`p`: its
// pending "booting" entry): "done" once booted; "late" after three minutes;
// "wait" for its first 10 s; then "check" (is it still running? ask pgrep, and
// pass the answer as `running`), and "gone" when it isn't.
export function launchStep(p, now, booted, running) {
  if (booted) return "done";
  if (now - p.at > PENDING_MS) return "late";
  if (now - p.at <= LAUNCH_GRACE_MS) return "wait";
  return running === undefined ? "check" : running ? "wait" : "gone";
}

// "booting" | "stopping" | null: a press under way, else simctl's own phases.
export const phaseOf = (d, pending = {}) =>
  pending[deviceKey(d)]?.phase ?? (d.state === "booting" ? "booting" : d.state === "shutting down" ? "stopping" : null);

// The status glyph: "spin" (a phase), "on", "off", or "warn" (offline, unauthorized, ...).
export const glyphOf = (d, phase) => (phase ? "spin" : d.state === "on" || d.state === "off" ? d.state : "warn");

const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const ago = (ms) => (ms < 60000 ? `${Math.max(0, Math.floor(ms / 10000) * 10)}s ago` : ms < 3600000 ? `${Math.floor(ms / 60000)}m ago` : `${Math.floor(ms / 3600000)}h ago`);

// "5 simulators · 1 emulator · 1 device · refreshed 10s ago"
export function footerText(sims, android, refreshedAt, now) {
  const parts = [count(sims.length, "simulator"), count(android.filter((d) => d.kind === "avd").length, "emulator"), count(android.filter((d) => d.kind === "phone").length, "device")];
  if (refreshedAt) parts.push(`refreshed ${ago(now - refreshedAt)}`);
  return parts.join(" · ");
}

// A row's hover icons, at most three: boot or shut down, screenshot, more
// (the full menu, where Erase lives).
export function hoverActions(d, phase) {
  const list = actionsFor(d).filter((a) => (a.action === "boot" || a.action === "shutdown" ? !phase : a.action === "screenshot"));
  return [...list, { action: "more", label: "More", icon: "more" }];
}

// What clicking a row does: boot it when off, bring a booted simulator's
// window forward ("focus"), else nothing.
export function primaryAction(d, phase) {
  if (phase) return null;
  if (d.state === "off" && (d.kind === "sim" || d.avd)) return "boot";
  return d.state === "on" && d.kind === "sim" ? "focus" : null;
}
