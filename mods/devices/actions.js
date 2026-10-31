// Runs the device tools: reading the lists and doing an action. Every program
// may be missing or hang (exec rejects then); that becomes a line in the panel
// or an error toast, never a thrown error.
import { exec, home, notify, shared, setShared, readTextFile } from "herdr";
import * as D from "./devices.js";

const found = {}; // tool -> the path that started
const missing = {}; // tool -> when none of its paths started
let sdk = null;

// The Android SDK's env vars and TMPDIR, read once from the login environment.
function sdkEnv() {
  sdk ??= exec("sh", ["-c", 'printf "%s\\n%s\\n%s\\n%s" "$ANDROID_HOME" "$ANDROID_SDK_ROOT" "$ANDROID_AVD_HOME" "$TMPDIR"'])
    .then((r) => r.stdout.split("\n"))
    .catch(() => ["", "", "", ""])
    .then(([androidHome = "", sdkRoot = "", avdHome = "", tmp = ""]) => ({ androidHome, sdkRoot, avdHome, tmp, home: home() }));
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

// A tool's path, finding it with a harmless call when no list read did yet.
async function toolPath(name) {
  if (!found[name]) await tool(name, name === "adb" ? ["version"] : ["-list-avds"]).catch(() => null);
  return found[name] ?? null;
}

// Running emulators' AVD names by serial.
async function avdNames(adb) {
  const names = {};
  await Promise.all(adb.filter((d) => D.isEmulator(d.serial) && d.state === "device").map(async (d) => {
    const r = await tool("adb", ["-s", d.serial, "emu", "avd", "name"]).catch(() => null);
    const name = r && r.code === 0 ? D.parseEmuAvdName(r.stdout) : null;
    if (name) names[d.serial] = name;
  }));
  return names;
}

// { sections, error }
export async function loadIos() {
  let sims;
  try { sims = await tool("xcrun", ["simctl", "list", "devices", "-j"]); } catch (e) { return { sections: [], error: D.rejectionLine(e, "simctl list") }; }
  if (!sims) return { sections: [], error: "xcrun not found" };
  if (sims.code !== 0) return { sections: [], error: D.errorLine(sims) };
  try { return { sections: D.parseSimctl(sims.stdout), error: null }; } catch { return { sections: [], error: "simctl printed something unreadable" }; }
}

// { devices, notes }
export async function loadAndroid() {
  const [avdList, adbList] = await Promise.all([
    tool("emulator", ["-list-avds"]).catch((e) => D.rejectionLine(e, "emulator -list-avds")),
    tool("adb", ["devices", "-l"]).catch((e) => D.rejectionLine(e, "adb devices")),
  ]);
  const notes = [];
  if (!avdList) notes.push("emulator not found");
  else if (typeof avdList === "string") notes.push(avdList);
  if (!adbList) notes.push("adb not found");
  else if (typeof adbList === "string") notes.push(adbList);
  else if (adbList.code !== 0) notes.push(`adb: ${D.errorLine(adbList)}`);
  const adb = adbList?.code === 0 ? D.parseAdbDevices(adbList.stdout) : [];
  const avds = avdList?.code === 0 ? D.parseAvds(avdList.stdout) : [];
  const apis = Object.fromEntries(await Promise.all(avds.map(async (n) => [n, D.avdApi(await avdIni(n))])));
  return { devices: D.androidDevices(avds, adb, await avdNames(adb), apis), notes };
}

// Whether a running emulator has finished booting.
export async function bootCompleted(serial) {
  const r = await tool("adb", ["-s", serial, "shell", "getprop", "sys.boot_completed"]).catch(() => null);
  return r?.code === 0 && r.stdout.trim() === "1";
}

// The row click on a booted simulator: Simulator.app to the front.
// (An emulator's window has no app bundle to activate, so AVDs get nothing.)
export async function focus(d) {
  if (d.kind === "sim") await exec("open", ["-a", "Simulator"]).catch(() => null);
}

// What an emulator this mod started printed.
const emulatorLog = async (avd) => D.emulatorLogPath((await sdkEnv()).tmp, avd);

// Whether an emulator of this AVD is running (pgrep exits 1 when none is; not
// knowing counts as running).
export async function emulatorRunning(avd) {
  const r = await exec("pgrep", ["-f", "--", D.avdProcessPattern(avd)]).catch(() => null);
  return r?.code !== 1;
}

// The last line an emulator this mod started printed before it exited.
export async function emulatorLastLine(avd) {
  return D.lastLine(await readTextFile(await emulatorLog(avd)).catch(() => null)) ?? "emulator exited";
}

// $ANDROID_AVD_HOME, else ~/.android/avd.
async function avdHome() {
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
// "devices.pending" (boot / shut down under way) and "devices.used" (last action per device).
function mark(name, key, value) {
  const next = { ...(shared(name) ?? {}) };
  if (value === undefined) delete next[key];
  else next[key] = value;
  setShared(name, next);
}

const VERB = { boot: "boot", shutdown: "shut down", screenshot: "take a screenshot of", openurl: "open the URL on", erase: "erase" };
const LABEL = { boot: "Boot", shutdown: "Shut down", screenshot: "Screenshot", openurl: "Open URL", erase: "Erase" };

// Runs an action on a device, stopping at the first failure, and toasts what
// happened. Every panel copy reloads after. `url`: for openurl.
export async function perform(action, d, { url } = {}) {
  const fail = (message) => {
    mark("devices.pending", D.deviceKey(d), undefined);
    notify({ level: "error", title: `Couldn't ${VERB[action]} ${d.name}`, body: message });
    return { ok: false, message };
  };
  const key = D.deviceKey(d);
  mark("devices.used", key, Date.now());
  // An AVD's entry names it: the settle pass checks on its emulator.
  if (action === "boot" || action === "shutdown") mark("devices.pending", key, { phase: action === "boot" ? "booting" : "stopping", at: Date.now(), ...(d.avd && { avd: d.avd }) });
  try {
    const x = { url, path: action === "screenshot" ? D.screenshotPath(home(), d.name, new Date()) : null };
    if (d.kind !== "sim") {
      x.adb = await toolPath("adb");
      if (action === "boot") { x.emulator = await toolPath("emulator"); x.log = await emulatorLog(d.avd); }
      if (action === "erase") {
        // Its files are deleted, so it must not be running: ask adb now, not the last poll.
        const list = await tool("adb", ["devices", "-l"]);
        if (list?.code !== 0) return fail("adb didn't answer, so it can't confirm the AVD is off.");
        const names = await avdNames(D.parseAdbDevices(list.stdout));
        if (Object.values(names).includes(d.avd)) return fail("It's running. Shut it down first.");
        x.avdPath = await avdFolder(d.avd);
      }
      if (!x.adb && action !== "boot" && action !== "erase") return fail("adb not found");
      if (action === "boot" && !x.emulator) return fail("emulator not found");
    }
    for (const step of D.stepsFor(action, d, x)) {
      let r;
      try { r = await exec(step.argv[0], step.argv.slice(1)); }
      catch (e) { if (step.ok === "any") continue; return fail(D.rejectionLine(e, LABEL[action])); }
      if (step.ok !== "any" && !(step.ok ?? [0]).includes(r.code)) return fail(D.errorLine(r));
    }
    if (action === "screenshot") notify({ level: "success", title: "Screenshot saved", body: x.path, timeout: 4000 });
    if (action === "erase") notify({ level: "success", title: `Erased ${d.name}`, timeout: 3000 });
    return { ok: true };
  } catch (e) {
    return fail(D.rejectionLine(e, LABEL[action]));
  } finally {
    setShared("devices.changed", Date.now());
  }
}
