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
