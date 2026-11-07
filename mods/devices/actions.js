// Runs the device tools: reading the lists and doing an action. Every program
// may be missing or hang (exec rejects then); that becomes a line in the panel
// or an error toast, never a thrown error.
import { exec, home, notify, window as herdrWindow, shared, setShared, readTextFile, run, focused, panes, terminals } from "herdr";
import { readdir } from "fs/promises";
import * as D from "./devices.js";

const found = {}; // tool -> the path that started
const missing = {}; // tool -> when none of its paths started
let sdk = null;
let avdBySerial = {}; // running emulator's serial -> AVD name, while adb lists it
const asking = new Set(); // serials whose name is being asked for
let avdList = null; // { avds, apis }, until forgetAvds()
let maestro = { found: true, at: null }; // whether `maestro` starts, and when that was last checked
let hook = { installed: true, at: null }; // whether an agent hook is wired in, and when that was last read
const apps = {}; // device key -> its user apps' ids, while it is on
const askingApps = new Set(); // keys whose apps are being asked for

// The Android SDK's env vars, TMPDIR and the OS name, read once from the login environment.
function sdkEnv() {
  sdk ??= exec("sh", ["-c", 'printf "%s\\n%s\\n%s\\n%s\\n%s" "$ANDROID_HOME" "$ANDROID_SDK_ROOT" "$ANDROID_AVD_HOME" "$TMPDIR" "$(uname -s)"'])
    .then((r) => r.stdout.split("\n"))
    .catch(() => ["", "", "", "", ""])
    .then(([androidHome = "", sdkRoot = "", avdHome = "", tmp = "", os = ""]) => ({ androidHome, sdkRoot, avdHome, tmp, os, home: home() }));
  return sdk;
}

// Runs a tool from the path that worked last, else PATH, else the SDK's homes.
// null: it isn't installed (remembered for a minute). Rejects when it started
// but timed out, or couldn't start for another reason.
async function tool(name, args) {
  if (D.stillMissing(missing[name], Date.now())) return null;
  for (const path of new Set([found[name], ...D.toolCandidates(name, await sdkEnv())])) {
    if (!path) continue;
    try {
      const r = await exec(path, args);
      found[name] = path;
      return r;
    } catch (e) {
      if (D.execFailure(e) !== "missing") throw e;
      if (found[name] === path) delete found[name];
    }
  }
  missing[name] = Date.now();
  return null;
}

// Whether the maestro CLI is installed, as last checked. Known (true) until the
// first check answers; checked again once a minute, behind the answer. The check
// mirrors the pane, which runs maestro under plain `sh -c`.
export function maestroFound() {
  if (!D.stillMissing(maestro.at, Date.now())) {
    maestro.at = Date.now();
    exec("sh", ["-c", "command -v maestro"]).then((r) => r.code === 0 && !!r.stdout.trim(), () => false).then((found) => { maestro.found = found; });
  }
  return maestro.found;
}

// Whether the claim hook is installed, as last read: known (true) until the first
// read answers, then read again once a minute, behind the answer.
export function hookInstalled() {
  if (!D.stillMissing(hook.at, Date.now())) {
    hook.at = Date.now();
    const read = (p) => readTextFile(`${home()}/${p}`).catch(() => null);
    Promise.all([".claude/plugins/installed_plugins.json", ".claude/settings.json", ".codex/hooks.json", ".codex/config.toml"].map(read))
      .then(([plugins, claudeSettings, codexHooks, codexConfig]) => { hook.installed = D.hookDetected({ plugins, claudeSettings, codexHooks, codexConfig }); });
  }
  return hook.installed;
}

// A tool's path, finding it with a harmless call when no list read did yet.
async function toolPath(name) {
  if (!found[name]) await tool(name, name === "adb" ? ["version"] : ["-list-avds"]).catch(() => null);
  return found[name] ?? null;
}

// Running emulators' AVD names by serial, as far as known. The serials not
// named yet are asked about all at once, in the background so a hung
// `adb emu` can't hold up a read (they show by serial until a later one), or
// awaited with `wait`.
async function avdNames(adb, wait = false) {
  const { keep, ask } = D.nameCache(avdBySerial, adb);
  avdBySerial = keep;
  const asked = ask.filter((serial) => !asking.has(serial)).map(async (serial) => {
    asking.add(serial);
    try {
      const r = await tool("adb", ["-s", serial, "emu", "avd", "name"]);
      const name = r?.code === 0 ? D.parseEmuAvdName(r.stdout) : null;
      if (name) avdBySerial[serial] = name;
    } catch {} finally { asking.delete(serial); }
  });
  if (wait) await Promise.all(asked);
  return { ...avdBySerial };
}

// The AVD list is read again on the next read (an .ini in the AVD home changed, or Refresh).
export function forgetAvds() { avdList = null; }

// The AVDs (<avd home>/<name>.ini) and their API levels. Kept until
// forgetAvds(); a missing AVD home isn't kept, so it is listed again next read.
async function listAvds() {
  if (avdList) return avdList;
  const avds = D.avdNamesFrom(await readdir(await avdHome()));
  const apis = Object.fromEntries(await Promise.all(avds.map(async (n) => [n, D.avdApi(await avdIni(n))])));
  return (avdList = { avds, apis });
}

// The app SpringBoard last put in front on a simulator, from its log: the
// first ask reads the last 30 minutes (about 2 s), later ones from the
// previous ask on (under 1 s). Null until it logs one; the last answer when
// the log can't be read.
const front = {}; // udid -> { id, at: when the log was last read }
async function simFront(d) {
  const f = front[d.id], at = Date.now();
  const since = f ? ["--start", D.logStart(f.at - 5000)] : ["--last", "30m"];
  const r = await tool("xcrun", ["simctl", "spawn", d.id, "log", "show", ...since, "--style", "compact", "--predicate", D.FRONT_PREDICATE]).catch(() => null);
  if (r?.code !== 0) return f?.id ?? null;
  front[d.id] = { id: D.parseIosFront(r.stdout) ?? f?.id ?? null, at };
  return front[d.id].id;
}

// A simulator's user apps, the one on screen first: SpringBoard's log says
// which, else ps tells which use CPU (ps exits 1 when a process is gone but
// still prints the rest). Without either they stay sorted by id.
async function simApps(d) {
  const r = await tool("xcrun", ["simctl", "spawn", d.id, "launchctl", "list"]);
  if (r?.code !== 0) return [];
  const apps = D.parseIosApps(r.stdout);
  if (!apps.length) return [];
  const [ps, frontId] = await Promise.all([exec("ps", ["-o", "pid=,%cpu=,etime=", "-p", apps.map((a) => a.pid).join(",")]).catch(() => null), simFront(d)]);
  return D.rankIosApps(apps, ps?.stdout ?? "", frontId);
}

// Puts the cached apps on the booted rows and asks every booted device again in
// the background (a slow one can't hold up a read; its apps show from the next
// read). Other rows lose their cache entry. A change nudges the panels to read.
function withApps(devices) {
  for (const d of devices) {
    const key = D.deviceKey(d);
    if (d.state !== "on") { delete apps[key]; delete front[d.id]; continue; }
    d.apps = apps[key] ?? [];
    if (askingApps.has(key)) continue;
    askingApps.add(key);
    const ask = d.kind === "sim" ? simApps(d) : tool("adb", ["-s", d.serial, "shell", "dumpsys", "activity", "activities"]).then((r) => (r?.code === 0 ? D.parseAndroidApp(r.stdout) : []));
    ask.catch(() => [])
      .then((ids) => {
        const changed = (apps[key] ?? []).join() !== ids.join();
        apps[key] = ids;
        if (changed) setShared("devices.changed", Date.now());
      })
      .finally(() => askingApps.delete(key));
  }
}

// { sections, error }
export async function loadIos() {
  // Phones are optional (older Xcode has no devicectl): any failure means none.
  const phones = tool("xcrun", ["devicectl", "list", "devices", "-q", "--json-output", "/dev/stdout", "--timeout", "5"])
    .then((r) => (r?.code === 0 ? D.parseDevicectl(r.stdout) : []))
    .catch(() => []);
  let sims;
  try { sims = await tool("xcrun", ["simctl", "list", "devices", "-j"]); } catch (e) { return { sections: [], error: D.rejectionLine(e, "simctl list") }; }
  if (!sims) return { sections: [], error: "xcrun not found" };
  if (sims.code !== 0) return { sections: [], error: D.errorLine(sims) };
  try {
    const sections = D.parseSimctl(sims.stdout);
    withApps(sections.flatMap((s) => s.devices));
    return { sections: D.mergeIos(sections, await phones), error: null };
  } catch { return { sections: [], error: "simctl printed something unreadable" }; }
}

// Where agents claim devices, one folder per device.
export const claimsDir = () => `${home()}/.cache/herdr-devices/claims`;

// { id: { owner, pid } } for the claim folders there are.
export async function readClaims() {
  const dir = claimsDir(), file = (name, f) => readTextFile(`${dir}/${name}/${f}`).catch(() => null);
  const names = (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory()).map((e) => e.name);
  return D.claimsFrom(await Promise.all(names.map(async (name) => ({ name, owner: await file(name, "owner"), pid: await file(name, "pid"), start: await file(name, "start") }))));
}

// Removes the claim folders of `ids` (their holders are gone); a failure leaves the claim for the next read.
export const dropClaims = (ids) => Promise.all(ids.filter((id) => D.CLAIM_ID.test(id)).map((id) => exec("rm", ["-r", `${claimsDir()}/${id}`]).catch(() => null)));

// Every process with its parent, start and CPU time, to tell which terminal drives a device
// and whether a claim's holder is still the same process; [] when ps fails.
export async function readPs() {
  const r = await exec("ps", ["-axo", "pid=,ppid=,lstart=,time=,command="]).catch(() => null);
  return r?.code === 0 ? D.parsePs(r.stdout) : [];
}

// { devices, notes }
export async function loadAndroid() {
  const [{ avds, apis }, adbList, emulator] = await Promise.all([
    listAvds().catch(() => ({ avds: [], apis: {} })),
    tool("adb", ["devices", "-l"]).catch((e) => D.rejectionLine(e, "adb devices")),
    toolPath("emulator"),
  ]);
  const notes = [];
  if (!emulator) notes.push("emulator not found");
  if (!adbList) notes.push("adb not found");
  else if (typeof adbList === "string") notes.push(adbList);
  else if (adbList.code !== 0) notes.push(`adb: ${D.errorLine(adbList)}`);
  const adb = adbList?.code === 0 ? D.parseAdbDevices(adbList.stdout) : [];
  const devices = D.androidDevices(avds, adb, await avdNames(adb), apis);
  withApps(devices);
  return { devices, notes };
}

// Whether a running emulator has finished booting.
export async function bootCompleted(serial) {
  const r = await tool("adb", ["-s", serial, "shell", "getprop", "sys.boot_completed"]).catch(() => null);
  return r?.code === 0 && r.stdout.trim() === "1";
}

// An erase's wipe has booted, so the AVD is like new: stop it. The row spins
// "stopping" until it's off.
export async function endWipe(d) {
  const key = D.deviceKey(d);
  if (shared("devices.pending")?.[key]?.phase !== "erasing") return; // another copy got here first
  mark("devices.pending", key, { phase: "stopping", at: Date.now(), avd: d.avd });
  notify({ level: "success", title: `Erased ${d.name}`, timeout: 3000 });
  const r = await tool("adb", ["-s", d.serial, "emu", "kill"]).catch(() => null);
  if (r?.code !== 0) notify({ level: "error", title: `Couldn't stop ${d.name}`, body: "It's erased and still running without a window: shut it down from the menu." });
}

let toldAccess = false, toldXdotool = false; // each hint shows once per session

// The row click on a booted device: its own window to the front. macOS: a
// simulator via Simulator's Window menu (needs Accessibility access for Herdr,
// else plain `open -a Simulator`), an emulator by its process; Linux: xdotool
// on the emulator's window title (X11 only); Windows: AppActivate on that title.
export async function focus(d) {
  const platform = herdrWindow().platform;
  const pid = platform === "macos" && d.kind === "avd" && d.avd ? (await emulatorPids(d.avd)).pop() : null;
  const c = D.focusCommand(platform, d, pid);
  if (!c) return;
  const r = await exec(c.cmd, c.args).catch((e) => ({ code: 1, stderr: String(e?.message ?? e), missing: D.execFailure(e) === "missing" }));
  if (r.code === 0) return;
  if (d.kind === "sim") await exec("open", ["-a", "Simulator"]).catch(() => null);
  if (/assistive access/.test(r.stderr ?? "") && !toldAccess) {
    toldAccess = true;
    notify({ level: "warning", title: `Can't bring ${d.name} to the front`, body: "Give Herdr Accessibility access: System Settings → Privacy & Security → Accessibility." });
  }
  if (r.missing && platform === "linux" && !toldXdotool) {
    toldXdotool = true;
    notify({ level: "warning", title: `Can't bring ${d.name} to the front`, body: "Install xdotool to bring emulator windows to the front." });
  }
}

// What an emulator this mod started printed.
const emulatorLog = async (avd) => D.emulatorLogPath(await sdkEnv(), avd);

// pgrep for this AVD's emulator processes; null when it couldn't run.
const pgrep = (avd) => exec("pgrep", ["-f", "--", D.avdProcessPattern(avd)]).catch(() => null);

// Whether an emulator of this AVD is running (pgrep exits 1 when none is; not
// knowing counts as running).
export async function emulatorRunning(avd) {
  const r = await pgrep(avd);
  return r?.code !== 1;
}

// The pids of this AVD's emulator processes, oldest first.
const emulatorPids = async (avd) => ((await pgrep(avd))?.stdout ?? "").split(/\s+/).filter(Boolean);

// The last line an emulator this mod started printed before it exited.
export async function emulatorLastLine(avd) {
  return D.lastLine(await readTextFile(await emulatorLog(avd)).catch(() => null)) ?? "emulator exited";
}

// $ANDROID_AVD_HOME, else ~/.android/avd.
export async function avdHome() {
  const env = await sdkEnv();
  return (env.avdHome || `${env.home}/.android/avd`).replace(/\/+$/, "");
}

// <avd home>/<name>.ini, or null.
const avdIni = async (name) => readTextFile(`${await avdHome()}/${name}.ini`).catch(() => null);

// The AVD's folder: `path=` in its .ini, else <avd home>/<name>.avd.
async function avdFolder(name) {
  return (D.parseAvdIni(await avdIni(name)) ?? `${await avdHome()}/${name}.avd`).replace(/\/+$/, "");
}

// Shared so the menu and dialogs (other copies) and the panel agree:
// "devices.pending" (boot / shut down under way), "devices.used" (last action per device)
// "devices.maestroLast" (folder -> the flow last run there) and "devices.maestroVars"
// (flow -> its Variables field).
export function mark(name, key, value) {
  const next = { ...(shared(name) ?? {}) };
  if (value === undefined) delete next[key];
  else next[key] = value;
  setShared(name, next);
}

// The project folder for Maestro. The menu opens from the panel, a mod pane with
// no folder, so the tab's terminals say: the focused one, else the first with a
// folder, else home.
export function maestroCwd() {
  const f = focused(), inTab = panes().filter((p) => p.tab === f?.tab && p.cwd);
  return f?.cwd ?? (inTab.find((p) => p.focused) ?? inTab[0])?.cwd ?? home();
}

// The Run Maestro dialog's start: the project folder, the flows path to offer
// there and the flows in its .maestro folder ([] without one: the dialog asks
// for a path).
export async function maestroStart() {
  const cwd = maestroCwd();
  const has = await readdir(cwd).then((names) => names.includes(".maestro"), () => false);
  const [cmd, ...args] = D.findFlowsArgv(`${cwd}/.maestro`);
  // find exits 1 over an unreadable folder but still lists the rest.
  const flows = has ? await exec(cmd, args).then((r) => D.flowRows(`${cwd}/.maestro`, r.stdout.split("\n")), () => []) : [];
  return { cwd, path: D.flowsDefault(cwd, has), flows };
}

// Opens a pane below running maestro on the device; the pane stays as a shell.
// The device's previous Maestro pane goes first, even mid-run: one simulator
// serves one Maestro session. `vars`: ["KEY=VALUE", ...].
export function runMaestro(d, flows, cwd, vars = []) {
  mark("devices.used", D.deviceKey(d), Date.now());
  for (const t of terminals().filter((t) => D.isMaestroPane(t, d))) run("terminal.kill", { terminal: t.address });
  run("terminal.open", { argv: D.maestroArgv(d, flows, vars), folder: cwd, place: "down", name: D.maestroPaneName(d) });
}

const VERB = { boot: "boot", shutdown: "shut down", screenshot: "take a screenshot of", openurl: "open the URL on", stop: "stop the app on", erase: "erase", release: "release the claim on" };
const LABEL = { boot: "Boot", shutdown: "Shut down", screenshot: "Screenshot", openurl: "Open URL", stop: "Stop", erase: "Erase", release: "Release claim" };

// Runs an action on a device, stopping at the first failure, and toasts what
// happened. Every panel copy reloads after. `url`: for openurl, `app`: for stop.
export async function perform(action, d, { url, app } = {}) {
  const fail = (message) => {
    mark("devices.pending", D.deviceKey(d), undefined);
    notify({ level: "error", title: `Couldn't ${VERB[action]} ${d.name}`, body: message });
    return { ok: false, message };
  };
  const key = D.deviceKey(d);
  // An AVD's entry names it: the settle pass checks on its emulator.
  const phase = (p) => mark("devices.pending", key, { phase: p, at: Date.now(), ...(d.avd && { avd: d.avd }) });
  mark("devices.used", key, Date.now());
  if (action === "boot" || action === "shutdown") phase(action === "boot" ? "booting" : "stopping");
  try {
    const x = { url, app, claimsDir: claimsDir(), path: action === "screenshot" ? D.screenshotPath(home(), d.name, new Date()) : null };
    if ((d.kind === "avd" || d.kind === "phone") && action !== "release") {
      x.adb = await toolPath("adb");
      const launch = action === "boot" || action === "erase";
      if (!x.adb && !launch) return fail("adb not found");
      if (launch) { x.emulator = await toolPath("emulator"); x.log = await emulatorLog(d.avd); }
      if (launch && !x.emulator) return fail("emulator not found");
      if (action === "erase") {
        if (!x.adb) return fail("adb not found");
        // It is started to be wiped, so it must not be running (another
        // instance would refuse): ask adb and pgrep now, not the last poll.
        const list = await tool("adb", ["devices", "-l"]);
        if (list?.code !== 0) return fail("adb didn't answer, so it can't confirm the AVD is off.");
        const names = await avdNames(D.parseAdbDevices(list.stdout), true);
        if (Object.values(names).includes(d.avd) || (await emulatorRunning(d.avd))) return fail("It's running. Shut it down first.");
        x.avdPath = await avdFolder(d.avd);
      }
    }
    for (const step of D.stepsFor(action, d, x)) {
      if (step.phase) phase(step.phase);
      let r;
      try { r = await exec(step.argv[0], step.argv.slice(1)); }
      catch (e) { if (step.ok === "any") continue; return fail(D.rejectionLine(e, LABEL[action])); }
      if (step.ok !== "any" && !(step.ok ?? [0]).includes(r.code)) return fail(D.errorLine(r));
    }
    if (action === "screenshot") notify({ level: "success", title: "Screenshot saved", body: x.path, timeout: 4000 });
    // An AVD's wipe goes on detached ("erasing"); endWipe() finishes it.
    if (action === "erase" && d.kind === "sim") {
      mark("devices.pending", key, undefined);
      notify({ level: "success", title: `Erased ${d.name}`, timeout: 3000 });
    }
    return { ok: true };
  } catch (e) {
    return fail(D.rejectionLine(e, LABEL[action]));
  } finally {
    setShared("devices.changed", Date.now());
  }
}
