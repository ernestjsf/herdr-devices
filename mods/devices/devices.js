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
    const devices = list.filter((d) => d.isAvailable).map((d) => ({ kind: "sim", id: d.udid, name: d.name, state: simState(d.state) }));
    if (devices.length) sections.push({ title: runtimeLabel(runtime), devices });
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

// `emulator -list-avds`: one name per line. AVD names are [A-Za-z0-9._-], so
// anything else (the emulator's INFO/WARNING chatter) is dropped.
export const parseAvds = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[A-Za-z0-9._-]+$/.test(l));

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

// `adb -s emulator-5554 emu avd name` prints "<name>\r\nOK".
export const parseEmuAvdName = (text) => text.split(/\r?\n/)[0].trim() || null;

const adbState = (s) => (s === "device" ? "on" : s);

// AVDs (running or not) and physical devices in one list. `names` maps a
// running emulator's serial to its AVD name.
export function androidDevices(avds, adb, names) {
  const running = new Map();
  for (const d of adb) if (isEmulator(d.serial) && names[d.serial]) running.set(names[d.serial], d);
  const rows = avds.map((name) => {
    const r = running.get(name);
    return r ? { kind: "avd", id: r.serial, serial: r.serial, avd: name, name, state: adbState(r.state) } : { kind: "avd", id: name, avd: name, name, state: "off" };
  });
  for (const d of adb) {
    const name = names[d.serial];
    if (isEmulator(d.serial)) {
      // An emulator of an AVD the list doesn't know (another AVD home), or still starting.
      if (!name || !avds.includes(name)) rows.push({ kind: "avd", id: d.serial, serial: d.serial, avd: null, name: name ?? d.serial, state: adbState(d.state) });
    } else rows.push({ kind: "phone", id: d.serial, serial: d.serial, name: d.model ?? d.serial, state: adbState(d.state) });
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
        : [{ argv: ["sh", "-c", 'nohup "$1" -avd "$2" >/dev/null 2>&1 &', "sh", x.emulator, d.avd] }];
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
