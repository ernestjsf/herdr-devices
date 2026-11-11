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
  return sortSections(sections);
}

// iOS first, then watchOS, tvOS, visionOS; newest version first.
function sortSections(sections) {
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

// `xcrun devicectl list devices --json-output` -> the physical devices
// connected now, as rows. devicectl also lists every paired device that is
// away, so those are dropped, like adb only lists the phones it sees.
export function parseDevicectl(json) {
  return JSON.parse(json).result.devices
    .filter((d) => d.hardwareProperties.reality === "physical" && (d.connectionProperties.transportType === "wired" || d.connectionProperties.tunnelState === "connected"))
    .map((d) => ({
      kind: "ios", id: d.hardwareProperties.udid, name: d.deviceProperties.name.replaceAll("\u00a0", " "), state: "on",
      detail: d.connectionProperties.transportType === "wired" ? "USB" : "Wi-Fi",
      platform: d.hardwareProperties.platform, version: d.deviceProperties.osVersionNumber,
      lastUsed: Date.parse(d.connectionProperties.lastConnectionDate ?? "") || 0,
    }));
}

// Each phone goes in the section titled like its simulators' runtime, a new one if none.
export function mergeIos(sections, phones) {
  const out = sections.map((s) => ({ ...s, devices: [...s.devices] }));
  for (const p of phones) {
    const title = `${p.platform} ${p.version}`;
    let s = out.find((x) => x.title === title);
    if (!s) out.push((s = { title, devices: [] }));
    s.devices.push(p);
  }
  return sortSections(out);
}

// The AVD home's files -> AVD names: each AVD has a <name>.ini there (names
// are [A-Za-z0-9._-]).
export const avdNamesFrom = (files) => files.map((f) => /^([A-Za-z0-9._-]+)\.ini$/.exec(f)?.[1]).filter(Boolean).sort();

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

// `simctl spawn <udid> launchctl list` -> the user apps running as { id, pid },
// sorted by id: each app is a `<pid> <status> UIKitApplication:<bundle id>[...]`
// line; Apple's own are dropped.
export function parseIosApps(text) {
  const byId = new Map();
  for (const m of text.matchAll(/^\s*(\d+)\s+\S+\s+UIKitApplication:([A-Za-z0-9.-]+)\[/gm))
    if (!m[2].startsWith("com.apple.") && !byId.has(m[2])) byId.set(m[2], { id: m[2], pid: m[1] });
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ps's etime, `[[D-]HH:]MM:SS`, in seconds.
const etimeSeconds = (t) => {
  const [, d = 0, rest] = /^(?:(\d+)-)?(.+)$/.exec(t);
  return rest.split(":").reduce((n, p) => n * 60 + Number(p), 0) + Number(d) * 86400;
};

// SpringBoard logs each app it puts in front. `simctl spawn <udid> log show
// --predicate FRONT_PREDICATE` -> the bundle id of the last one, or null.
export const FRONT_PREDICATE = 'process == "SpringBoard" AND category == "Common" AND eventMessage CONTAINS "visibility: Foreground"';
export function parseIosFront(text) {
  let id = null;
  for (const m of text.matchAll(/Application process state changed for ([A-Za-z0-9.-]+): <[^>]*visibility: Foreground>/g)) id = m[1];
  return id;
}

// A time as `log show --start` takes it, local: "2026-10-31 13:13:54".
export function logStart(ms) {
  const d = new Date(ms), n = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${n(d.getMonth() + 1)}-${n(d.getDate())} ${n(d.getHours())}:${n(d.getMinutes())}:${n(d.getSeconds())}`;
}

// The apps' ids, the one on screen first: `front` (parseIosFront) when it is
// still running. Without it CPU use tells, since the simulator suspends
// backgrounded apps (`psText`: `ps -o pid=,%cpu=,etime=` for their pids; under
// 0.5 counts as idle); when all are idle the newest launch leads. Apps ps
// didn't print go last, in the order given.
export function rankIosApps(apps, psText, front = null) {
  const stat = new Map();
  for (const m of psText.matchAll(/^\s*(\d+)\s+([\d.]+)\s+(\S+)\s*$/gm)) stat.set(m[1], { cpu: Number(m[2]) < 0.5 ? 0 : Number(m[2]), age: etimeSeconds(m[3]) });
  const at = (a) => stat.get(a.pid);
  return [...apps].sort((a, b) => {
    if (a.id === front || b.id === front) return (b.id === front) - (a.id === front);
    const x = at(a), y = at(b);
    if (!x || !y) return !x - !y;
    return y.cpu - x.cpu || x.age - y.age || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }).map((a) => a.id);
}

const ANDROID_SYSTEM = /^(com\.android\.|com\.google\.android\.(apps\.nexuslauncher|gms|googlequicksearchbox)|android$)|launcher$/i;

// `dumpsys activity activities` -> [the package in front], or [] when it is a
// launcher or system app. Older APIs only print mResumedActivity.
export function parseAndroidApp(text) {
  const m = /topResumedActivity=ActivityRecord\{\S+ \S+ ([\w.]+)\//.exec(text) ?? /mResumedActivity[=:] ?ActivityRecord\{\S+ \S+ ([\w.]+)\//.exec(text);
  return m && !ANDROID_SYSTEM.test(m[1]) ? [m[1]] : [];
}

// "com.example.budget" -> "budget"
export const appSegment = (id) => id.split(".").pop();

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

// Whether a poll is due: every tick until a platform's list has read the same `after`
// times in a row, then every `every`th tick (15 s at a 5 s tick), so an idle panel
// polls gently. Anything that changes the list, or a watcher, Refresh or an action, reads at once.
export const pollDue = (quiet, tick, { after = 6, every = 3 } = {}) => quiet < after || tick % every === 0;

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

// ~/Desktop/<name>-20261031-142501-042.png (milliseconds last, so two in one
// second don't collide)
export function screenshotPath(home, name, date) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}-${p(date.getMilliseconds(), 3)}`;
  return `${home}/Desktop/${name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "device"}-${stamp}.png`;
}

// A URL worth sending: a scheme, then something.
export const validUrl = (url) => /^[A-Za-z][A-Za-z0-9+.-]*:\S+$/.test(url.trim());

// `adb shell` joins its arguments into one command line for the device's
// shell, so a value must be quoted for that shell.
const deviceQuote = (s) => `'${s.replaceAll("'", `'\\''`)}'`;

// Where a detached emulator's output goes: $TMPDIR/herdr-devices-<avd>.log,
// else the user's own cache folder (never the shared /tmp, where a predictable
// name could be a planted symlink).
export function emulatorLogPath({ tmp, home, os }, avd) {
  const dir = tmp ? tmp.replace(/\/+$/, "") : os === "Darwin" ? `${home}/Library/Caches/herdr-devices` : `${home}/.cache/herdr-devices`;
  return `${dir}/herdr-devices-${avd}.log`;
}

// `pgrep -f` pattern for an emulator of this AVD: `-avd <name>`, then a space
// or the end, so Pixel_7 doesn't match Pixel_7_API_34.
export const avdProcessPattern = (avd) => `-avd ${avd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`;

// An emulator's window title on every OS: "Android Emulator - <avd>:<port>", the
// port being the serial's digits. null when the AVD or the serial is unknown.
export function emulatorWindowTitle(d) {
  const port = /^emulator-(\d+)$/.exec(d.serial ?? "")?.[1];
  return d.avd && port ? `Android Emulator - ${d.avd}:${port}` : null;
}

// Simulator's Window menu lists "<name> – iOS <ver>" (en dash); clicking the item raises that window and
// switches Spaces, which AXRaise doesn't. The click comes before the activation, so Simulator's last window doesn't flash first.
// Needs Accessibility access for the caller.
const SIM_FOCUS = `on run argv
tell application "System Events" to tell process "Simulator"
click (first menu item of menu "Window" of menu bar 1 whose name starts with (item 1 of argv))
set frontmost to true
end tell
end run`;

// The command that brings a booted device's window to the front, or null when
// this OS can't (or it has no window): `pid` is the emulator process, macOS only.
// The sim's prefix ends in " – " so "iPhone 17 Pro" doesn't match "iPhone 17 Pro B".
export function focusCommand(platform, d, pid) {
  if (platform === "macos" && d.kind === "sim") return { cmd: "osascript", args: ["-e", SIM_FOCUS, "--", `${d.name} – `] };
  if (platform === "macos" && d.kind === "avd") {
    return /^\d+$/.test(pid ?? "") ? { cmd: "osascript", args: ["-e", `tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`] } : null;
  }
  const title = d.kind === "avd" ? emulatorWindowTitle(d) : null;
  if (!title) return null;
  if (platform === "linux") return { cmd: "xdotool", args: ["search", "--name", title, "windowactivate"] };
  if (platform === "windows") return { cmd: "powershell", args: ["-NoProfile", "-Command", `(New-Object -ComObject WScript.Shell).AppActivate('${title.replaceAll("'", "''")}')`] };
  return null;
}

// The last line with something on it, or null.
export const lastLine = (text) => (text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() ?? null;

// Starts a program detached with its output in a log: sh -c DETACH sh <log> <argv...>.
const DETACH = 'log=$1; shift; mkdir -p "$(dirname "$log")"; nohup "$@" >"$log" 2>&1 &';

// What a row offers, in menu order. `lastFlow`: the flow last run in the tab's
// folder, offered again right under Run Maestro flow. `maestro`: false when the
// CLI isn't installed, so the row stays but disabled, and there is no Run again.
// `claim`: the device is claimed, so it can be released. `hint`: the panel's key for it.
export function actionsFor(d, { lastFlow, maestro = true, claim = false } = {}) {
  const on = d.state === "on", list = [];
  if (d.kind === "sim" || (d.kind === "avd" && d.avd)) {
    if (on) list.push({ action: "shutdown", label: "Shut down", icon: "power", hint: "space" });
    else if (d.state === "off") list.push({ action: "boot", label: "Boot", icon: "play", hint: "space" });
  } else if (d.kind === "avd" && on) list.push({ action: "shutdown", label: "Shut down", icon: "power", hint: "space" });
  // devicectl has no screenshot.
  if (on && d.kind !== "ios") list.push({ action: "screenshot", label: "Screenshot", icon: "camera", hint: "S" });
  if (on) list.push({ action: "openurl", label: "Open URL…", icon: "link" });
  if (on) {
    if (!maestro) list.push({ action: "maestro", label: "Run Maestro flow…", icon: "flask", disabled: true, hint: "not installed" });
    else list.push({ action: "maestro", label: "Run Maestro flow…", icon: "flask" });
    if (maestro && lastFlow) list.push({ action: "maestroAgain", label: `Run ${lastFlow.split("/").pop().replace(/\.ya?ml$/, "")} again`, icon: "flask", path: lastFlow });
  }
  if (claim) list.push({ action: "release", label: "Release claim", icon: "square" });
  if (on && d.apps?.length) {
    list.push({ action: "copyapp", label: "Copy app id", icon: "copy" });
    for (const app of d.apps) list.push({ action: "stop", label: `Stop ${appSegment(app)}`, icon: "square", app });
  }
  list.push({ action: "copy", label: d.kind === "sim" || d.kind === "ios" ? "Copy UDID" : d.serial ? "Copy serial" : "Copy name", icon: "copy" });
  // An AVD is erased by booting it once with -wipe-data, so only while it's off.
  if (d.kind === "sim" || (d.kind === "avd" && d.avd && d.state === "off")) list.push({ action: "erase", label: "Erase…", icon: "trash", danger: true });
  return list;
}

// The terminal pane's command for a Maestro run: the device id, the flows
// path and the variables (-e KEY=VALUE ...) are positional arguments, never
// part of the script. A failed run names its debug folder (the newest under
// ~/.maestro/tests); the shell that follows keeps the pane open.
const MAESTRO = 'dev=$1; flow=$2; shift 2; maestro --device "$dev" test "$@" "$flow"; s=$?; printf \'\\n[maestro exited %s]\\n\' "$s"; '
  + '[ "$s" -eq 0 ] || printf \'debug output: %s\\n\' "$(ls -td "$HOME"/.maestro/tests/*/ 2>/dev/null | head -1 | sed \'s:/$::\')"; exec "${SHELL:-sh}" -l';
export const maestroArgv = (d, flows, vars = []) => ["sh", "-c", MAESTRO, "sh", d.id, flows, ...vars.flatMap((v) => ["-e", v])];

// The Variables field -> ["KEY=VALUE", ...] ([] when empty), or null when a
// word isn't KEY=VALUE.
export function parseVars(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.every((w) => /^[A-Za-z_][A-Za-z0-9_]*=.*$/.test(w)) ? words : null;
}

// A device's Maestro pane, to end before the next run opens one. terminal.open's
// name doesn't reach the core's terminal (name stays null), so its argv also tells.
export const maestroPaneName = (d) => `maestro · ${d.name}`;
const isMaestroArgv = (argv, d) => argv?.[0] === "sh" && argv[1] === "-c" && String(argv[2]).includes("maestro --device") && argv[4] === d.id;
export const isMaestroPane = (t, d) => t?.state !== "finished" && (t?.name === maestroPaneName(d) || isMaestroArgv(t?.argv, d));
// Its run is going while the foreground is still that command: after it the pane execs the shell.
export const maestroRunning = (t, d) => isMaestroPane(t, d) && isMaestroArgv(t.foreground?.argv, d);

// `ps -axo pid=,ppid=,lstart=,time=,command=` -> [{ pid, ppid, start, cpu, command }],
// cpu in seconds (time is [dd-][hh:]mm:ss.ss; macOS lets minutes pass 59). lstart is
// the process's start, "Sat Nov  7 01:36:10 2026" (24 characters); a listing without it reads too (start null).
export function parsePs(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(?:([A-Z][a-z]{2} [A-Z][a-z]{2} [ \d]\d \d\d:\d\d:\d\d \d{4})\s+)?(?:(\d+)-)?([\d:.]+)\s+(.*)$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), start: m[3] ?? null, cpu: Number(m[4] ?? 0) * 86400 + m[5].split(":").reduce((n, part) => n * 60 + Number(part), 0), command: m[6] });
  }
  return rows;
}

const SIM_SERVER = /(?:^|\/)simulator-server ios --id (\S+)/;

// Maestro MCP's per-device servers (`simulator-server ios --id <udid>`), each
// with the terminal it runs under: its parents are walked (50 at most, never
// past pid 1) to a terminal's pid or foreground pid. Active: its CPU time grew
// since `prevCpu` (pid -> seconds; a first sighting isn't). Returns { drivers:
// [{ udid, address, pid, cpu, active }], cpu: the next prevCpu }.
export function driversFrom(rows, terminals, prevCpu = {}) {
  const byPid = new Map(rows.map((r) => [r.pid, r])), owner = new Map();
  for (const t of terminals) if (t.state !== "finished") for (const pid of [t.pid, t.foreground?.pid]) if (pid) owner.set(pid, t.address);
  const drivers = [], cpu = {};
  for (const r of rows) {
    const udid = SIM_SERVER.exec(r.command)?.[1];
    if (!udid) continue;
    cpu[r.pid] = r.cpu;
    let p = r.ppid;
    for (let hops = 0; p > 1 && hops < 50 && !owner.has(p); hops++) p = byPid.get(p)?.ppid ?? 0;
    if (owner.has(p)) drivers.push({ udid, address: owner.get(p), pid: r.pid, cpu: r.cpu, active: prevCpu[r.pid] !== undefined && r.cpu > prevCpu[r.pid] });
  }
  return { drivers, cpu };
}

// Who drives a device, the one to show first: one per terminal, this panel's
// Maestro run while it's going ("pane", active), MCP servers from driversFrom
// ("mcp"); active before attached, then the agent whose status changed last
// (agents()' seq). An idle agent's server still ticks CPU now and then, so an
// agent's server is active only while it's working. [{ address, via, active }]
export function deviceDrivers(d, drivers, terminals, agents) {
  const agent = (address) => agents.find((a) => a.address === address);
  const list = terminals.filter((t) => maestroRunning(t, d)).map((t) => ({ address: t.address, via: "pane", active: true }));
  for (const x of drivers) {
    if (x.udid !== d.id) continue;
    const active = x.active && (agent(x.address)?.status ?? "working") === "working";
    const same = list.find((y) => y.address === x.address);
    if (same) same.active ||= active;
    else list.push({ address: x.address, via: "mcp", active });
  }
  const seq = (address) => agent(address)?.seq ?? -1;
  return list.sort((a, b) => Number(b.active) - Number(a.active) || seq(b.address) - seq(a.address));
}

// A driver's tag: { label, tone: "working" | "blocked" | "idle", tip (starts
// with what a click does), focus (the click's command) }. `agent`: its agents() entry, if any; `t`: its terminal.
export function driverTag(x, agent, t) {
  const where = agent ? `${agent.space_name} / ${agent.tab_name}` : t?.labels?.where;
  const status = agent?.status ?? t?.status ?? null;
  // The program's table key ("claude", "codex"); where it runs is the tooltip's.
  const label = x.via === "pane" ? "maestro" : (agent ?? t)?.program?.key ?? x.address;
  const tone = x.active ? "working" : status === "blocked" ? "blocked" : "idle";
  const program = x.via === "pane" ? "maestro" : (agent ?? t)?.program?.name ?? x.address;
  const via = x.via === "pane" ? "this panel's Run Maestro pane" : "via Maestro MCP";
  const tip = [`Click to focus ${program}`, where, status, x.active ? "driving now" : "attached, idle", via].filter(Boolean).join(" · ");
  return { label, tone, tip, focus: agent ? "agent.focus" : "pane.focus" };
}

// A device claim is the folder <claims>/<id>, made with a plain `mkdir` (exactly one
// creator wins). The id is what Maestro's --device takes: the UDID, or the serial
// (an AVD that is off has none, so it can't be claimed).
export const claimId = (d) => (d.kind === "sim" || d.kind === "ios" ? d.id : d.serial ?? null);

// A claim folder's name: one path segment, never `..` or a path that climbs out of the claims folder.
export const CLAIM_ID = /^[A-Za-z0-9_:-][A-Za-z0-9._:-]*$/;

// [{ name, owner, pid, start }] (the owner, pid and start files' text, if any) -> { id: { owner, pid, start } }:
// the owner's first line (40 characters at most), the pid as a positive integer, the holder's
// start as ps's lstart prints it (so a reused pid isn't the holder), else null.
export const claimsFrom = (entries) =>
  Object.fromEntries(entries.map((e) => [e.name, { owner: e.owner?.split("\n")[0].trim().slice(0, 40) || null, pid: Number(e.pid?.trim()) > 0 ? Number(e.pid) : null, start: e.start?.trim() || null }]));

// The claim ids whose holder is gone: its pid is not in ps's rows, or is but started at another
// time (the pid was reused; compared only when both sides know the start). No pid: nothing to
// check. No rows: ps failed, so drop nothing.
export const staleClaims = (claims, rows) =>
  rows.length
    ? Object.keys(claims).filter((id) => {
        const { pid, start } = claims[id];
        if (!pid) return false;
        const r = rows.find((r) => r.pid === pid);
        return !r || Boolean(start && r.start && r.start !== start);
      })
    : [];

// Removes a stale claim, in step with claim.sh's takeover: under the same lock folder
// (.takeover.<id>; one a killed hook left is removed once a minute old), and only while the
// pid file still names the holder that was seen gone, so a takeover since keeps its fresh claim.
const DROP = 'dir=$1/$2; lock=$1/.takeover.$2; find "$1" -maxdepth 1 -name ".takeover.$2" -mmin +1 -exec rmdir {} \\; 2>/dev/null; '
  + 'mkdir "$lock" 2>/dev/null || exit 0; trap \'rmdir "$lock" 2>/dev/null\' EXIT; [ "$(head -n 1 "$dir/pid" 2>/dev/null | tr -d "[:space:]")" = "$3" ] && rm -r "$dir"; exit 0';
export function dropClaimArgv(claimsDir, id, pid) {
  if (!CLAIM_ID.test(id ?? "") || !/^\/./.test(claimsDir ?? "") || !(pid > 0)) throw new Error(`Unexpected claim: ${claimsDir}/${id}`);
  return ["sh", "-c", DROP, "sh", claimsDir, id, String(pid)];
}

// Whether an agent can claim: the plugin is installed for the user (a `local` install belongs
// to one project, which may not be this one), or a hook script is wired in Claude's settings
// (user or local) or Codex's hooks or config (the file texts, null when missing).
export function hookDetected({ plugins, claudeSettings, claudeLocal, codexHooks, codexConfig }) {
  let plugin = false;
  try {
    plugin = Object.entries(JSON.parse(plugins ?? "{}").plugins ?? {}).some(([name, installs]) => name.startsWith("herdr-devices@") && (installs ?? []).some((i) => i?.scope !== "local"));
  } catch {}
  return plugin || [claudeSettings, claudeLocal, codexHooks, codexConfig].some((text) => Boolean(text?.includes("claim.sh")));
}


// A row's agent tag(s): [{ icon, label, tone, tip, focus, terminal }], none when the device is neither
// claimed nor driven. One tag: `lock` when claimed, else `link` (driven); label the claim's owner, else
// the first driver's program key; tone from the first driver (idle without one). A claim whose owner no
// driver matches (case-insensitive) is two: the claim (`lock`, idle) then the driver (`triangle`, blocked).
// focus/terminal (the click) only on a tag that stands for the first driver.
export function deviceTags(claim, drivers, agents, terminals) {
  const tags = drivers.map((x) => driverTag(x, agents.find((a) => a.address === x.address), terminals.find((y) => y.address === x.address)));
  const [first] = tags, terminal = drivers[0]?.address, owner = claim?.owner;
  const driven = (ts) => ts.map((g) => g.tip).join("\n");
  if (!claim) return first ? [{ icon: "link", label: first.label, tone: first.tone, tip: `${driven(tags)}\nNot claimed`, focus: first.focus, terminal }] : [];
  const head = [owner ? `Claimed by ${owner}` : "Claimed", claim.pid && `pid ${claim.pid}`, "Release from the menu"].filter(Boolean).join(" · ");
  if (first && owner && !tags.some((g) => g.label.toLowerCase() === owner.toLowerCase()))
    return [{ icon: "lock", label: owner, tone: "idle", tip: head }, { icon: "triangle", label: first.label, tone: "blocked", tip: driven(tags), focus: first.focus, terminal }];
  return [{ icon: "lock", label: owner || first?.label || "", tone: first?.tone ?? "idle", tip: first ? `${head}\n${driven(tags)}` : `${head} · not attached`, focus: first?.focus, terminal }];
}

// The flows path to offer: the project's .maestro folder when it has one, else its folder.
export const flowsDefault = (cwd, hasDotMaestro) => (!cwd ? "" : hasDotMaestro ? `${cwd}/.maestro` : cwd);

// The YAML files under a .maestro folder, four levels deep (-H: the folder may be a symlink).
export const findFlowsArgv = (dir) => ["find", "-H", dir, "-maxdepth", "4", "-type", "f", "(", "-name", "*.yaml", "-o", "-name", "*.yml", ")"];

// find's paths -> the picker's rows { label, sub, path }: "auth/" and "login"
// for <dir>/auth/login.yaml, sorted by folder then name. The top-level
// config.yaml is Maestro's workspace config, not a flow.
export function flowRows(flowsDir, paths) {
  const root = `${flowsDir.replace(/\/+$/, "")}/`, by = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  return paths.filter((p) => p.startsWith(root)).map((path) => {
    const rel = path.slice(root.length), i = rel.lastIndexOf("/") + 1;
    return { label: rel.slice(i).replace(/\.ya?ml$/, ""), sub: rel.slice(0, i), path };
  }).filter((r) => r.sub || !/^config\.ya?ml$/.test(r.path.slice(root.length))).sort((a, b) => by(a.sub, b.sub) || by(a.label, b.label));
}

// The commands an action runs, in order: { argv, ok, phase } where ok lists the
// exit codes that count as success ("any": the step may fail) and phase is the
// row's phase from that step on. `x` carries the tool
// paths (adb, emulator), the screenshot path, the URL and the AVD's folder.
export function stepsFor(action, d, x) {
  // Only <claims folder>/<id>, never a path that climbs out of it.
  if (action === "release") {
    const id = claimId(d);
    if (!CLAIM_ID.test(id ?? "") || !/^\/./.test(x.claimsDir ?? "")) throw new Error(`Unexpected claim: ${x.claimsDir}/${id}`);
    return [{ argv: ["rm", "-r", `${x.claimsDir}/${id}`] }];
  }
  // A device over devicectl: Safari opens the URL; nothing else is offered.
  if (d.kind === "ios") {
    if (action === "openurl") return [{ argv: ["xcrun", "devicectl", "device", "process", "launch", "--device", d.id, "com.apple.mobilesafari", "--payload-url", x.url] }];
    throw new Error(`Unknown action: ${action}`);
  }
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
    case "screenshot": {
      if (sim) return [{ argv: ["xcrun", "simctl", "io", d.id, "screenshot", x.path] }];
      // Named after the Desktop file (its characters are shell-safe), so it carries the same stamp.
      const remote = `/sdcard/herdr-devices-${x.path.split("/").pop()}`;
      return [{ argv: adb("shell", "screencap", "-p", remote) }, { argv: adb("pull", remote, x.path) }, { argv: adb("shell", "rm", "-f", remote), ok: "any" }];
    }
    case "openurl":
      return sim
        ? [{ argv: ["xcrun", "simctl", "openurl", d.id, x.url] }]
        : [{ argv: adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", deviceQuote(x.url)) }];
    case "stop":
      return sim ? [{ argv: ["xcrun", "simctl", "terminate", d.id, x.app] }] : [{ argv: adb("shell", "am", "force-stop", x.app) }];
    case "erase": {
      if (sim) return [{ argv: ["xcrun", "simctl", "shutdown", d.id], ok: "any", phase: "stopping" }, { argv: ["xcrun", "simctl", "erase", d.id], phase: "erasing" }];
      // Never rm anything but an absolute "<something>.avd" folder's snapshots:
      // a quick-boot snapshot would bring the old data back. Then the
      // emulator's own wipe, detached; the settle pass stops it once booted.
      if (!/^\/.+\.avd$/.test(x.avdPath ?? "")) throw new Error(`Unexpected AVD folder: ${x.avdPath}`);
      return [
        { argv: ["rm", "-rf", `${x.avdPath}/snapshots`], phase: "erasing" },
        { argv: ["sh", "-c", DETACH, "sh", x.log, x.emulator, "-avd", d.avd, "-wipe-data", "-no-snapshot", "-no-window"] },
      ];
    }
  }
  throw new Error(`Unknown action: ${action}`);
}

// One id per device across reads: an AVD keeps its name while its serial
// comes and goes.
export const deviceKey = (d) => (d.kind === "avd" ? `avd:${d.avd ?? d.id}` : `${d.kind}:${d.id}`);

// Booted (or with a press under way, `pending`) first, then most recently used:
// simctl's lastBootedAt, or the latest action this mod ran on it (`used`: key -> ms).
// Ties keep their order.
export function sortRecent(devices, used = {}, pending = {}) {
  const at = (d) => Math.max(d.lastUsed ?? 0, used[deviceKey(d)] ?? 0);
  const on = (d) => (d.state === "on" || pending[deviceKey(d)] ? 1 : 0);
  return devices.map((d, i) => [d, i]).sort(([a, i], [b, j]) => on(b) - on(a) || at(b) - at(a) || i - j).map(([d]) => d);
}

const PLATFORM_KEYS = { ios: ["sim:", "ios:"], android: ["avd:", "phone:"] };

// devices.used after a read of one platform (`prev`, `next`: its rows before
// and now; no `prev` on the first read): a device that came on since (listed,
// not on, now on) was used now, wherever it was started. When the read was
// `complete`, that platform's entries for devices it no longer lists go.
export function updateUsed(used, which, prev, next, now, complete) {
  const was = new Map((prev ?? []).map((d) => [deviceKey(d), d.state]));
  const listed = new Set(next.map(deviceKey));
  const mine = (key) => PLATFORM_KEYS[which].some((p) => key.startsWith(p));
  const out = Object.fromEntries(Object.entries(used).filter(([key]) => !complete || !mine(key) || listed.has(key)));
  for (const d of next) {
    const key = deviceKey(d), before = was.get(key);
    if (d.state === "on" && before !== undefined && before !== "on") out[key] = now;
  }
  return out;
}

// A section's rows by default: every one that isn't off (booted, starting,
// offline) or has an action under way, plus the `keep` most recent off ones.
export function foldRows(sorted, { all = false, pending = {}, keep = 3 } = {}) {
  if (all) return { shown: sorted, hidden: 0 };
  let off = 0;
  const shown = sorted.filter((d) => d.state !== "off" || pending[deviceKey(d)] || off++ < keep);
  return { shown, hidden: sorted.length - shown.length };
}

// Whether every section, unfolded, fits the list's height (`sections`: { count, closed }):
// a header is 32 px with its margin, a row 26; a closed section is its header.
export const fitsUnfolded = (sections, listHeight) =>
  listHeight > 0 && sections.reduce((h, s) => h + 32 + (s.closed ? 0 : 26 * s.count), 0) <= listHeight;

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
// pending "booting" entry, or an erase's "erasing" wipe): "done" once booted
// (a wipe: "kill", it has done its work); "late" after three minutes;
// "wait" for its first 10 s; then "check" (is it still running? ask pgrep, and
// pass the answer as `running`), and "gone" when it isn't.
export function launchStep(p, now, booted, running) {
  if (booted) return p.phase === "erasing" ? "kill" : "done";
  if (now - p.at > PENDING_MS) return "late";
  if (now - p.at <= LAUNCH_GRACE_MS) return "wait";
  return running === undefined ? "check" : running ? "wait" : "gone";
}

// "booting" | "stopping" | null: a press under way, else simctl's own phases.
export const phaseOf = (d, pending = {}) =>
  pending[deviceKey(d)]?.phase ?? (d.state === "booting" ? "booting" : d.state === "shutting down" ? "stopping" : null);

// The status glyph: "spin" (a phase), "on", "off", or "warn" (offline, unauthorized, ...).
export const glyphOf = (d, phase) => (phase ? "spin" : d.state === "on" || d.state === "off" ? d.state : "warn");

// The row's icon, by what the device is: tablet, watch, tv, glasses (Vision
// Pro) or smartphone, read from the name.
export function deviceIcon(d) {
  const n = d.name ?? "";
  if (/ipad|tablet|fold|pad\b/i.test(n)) return "tablet";
  if (/watch|wear/i.test(n)) return "watch";
  if (/\btv\b|television/i.test(n)) return "tv";
  if (/vision/i.test(n)) return "glasses";
  return "smartphone";
}

const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const ago = (ms) => (ms < 3600000 ? `${Math.floor(ms / 60000)}m ago` : `${Math.floor(ms / 3600000)}h ago`);

// "5 simulators · 1 emulator": only the kinds there are; "No devices" when none.
// "· refreshed 2m ago" only once the reads have stalled for a minute.
export function footerText(ios, android, refreshedAt, now) {
  const n = (rows, kind) => rows.filter((d) => d.kind === kind).length;
  const kinds = [[n(ios, "sim"), "simulator"], [n(android, "avd"), "emulator"], [n(android, "phone") + n(ios, "ios"), "device"]];
  const parts = kinds.filter(([n]) => n > 0).map(([n, word]) => count(n, word));
  if (!parts.length) parts.push("No devices");
  if (refreshedAt && now - refreshedAt >= 60000) parts.push(`refreshed ${ago(now - refreshedAt)}`);
  return parts.join(" · ");
}

// A row's hover icons, at most three: boot or shut down, screenshot, more
// (the full menu, where Erase lives). A boot under way can be cancelled where a
// shutdown runs (the menu's, as if booted): simctl shuts a booting simulator, adb emu kill needs the serial.
export function hoverActions(d, phase) {
  const list = actionsFor(d).filter((a) => (a.action === "boot" || a.action === "shutdown" ? !phase : a.action === "screenshot"));
  if (phase === "booting" && (d.kind === "sim" || (d.kind === "avd" && d.serial))) list.unshift(actionsFor({ ...d, state: "on" })[0]);
  return [...list, { action: "more", label: "More", icon: "more" }];
}

// The space key does what the row's power icon does: Boot an off device, Shut
// down a booted one (or cancel its boot); nothing in another phase.
export const toggleAction = (d, phase) => hoverActions(d, phase).find((a) => a.action === "boot" || a.action === "shutdown")?.action ?? null;

// Up / down through the visible rows' keys, wrapping: with no selection (or one
// no longer shown) down takes the first, up the last.
export function stepSelection(keys, selected, delta) {
  if (!keys.length) return null;
  const i = keys.indexOf(selected);
  return i < 0 ? keys[delta > 0 ? 0 : keys.length - 1] : keys[(i + delta + keys.length) % keys.length];
}

// What clicking a row does: bring a booted simulator's or AVD's window forward
// ("focus"), else nothing. Booting is the hover icon's, so a stray click starts
// nothing; the rail has no hover icons, so there a click boots an off simulator or AVD.
export function primaryAction(d, phase, { rail = false } = {}) {
  if (phase) return null;
  if (d.state === "on") return d.kind === "sim" || d.kind === "avd" ? "focus" : null;
  return rail && d.state === "off" && (d.kind === "sim" || (d.kind === "avd" && d.avd)) ? "boot" : null;
}

// The menu's sections, in actionsFor's order: a divider sits where the group changes.
const MENU_GROUP = { boot: "power", shutdown: "power", screenshot: "view", openurl: "view", maestro: "maestro", maestroAgain: "maestro", release: "claim", copyapp: "app", stop: "app", copy: "copy", erase: "erase" };
export const dividerBefore = (items, i) => i > 0 && MENU_GROUP[items[i].action] !== MENU_GROUP[items[i - 1].action];
export const menuDividers = (items) => items.filter((_a, i) => dividerBefore(items, i)).length;
