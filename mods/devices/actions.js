// Runs the device tools: reading the lists and doing an action. Every program
// may be missing (exec rejects then); that becomes a line in the panel or an
// error toast, never a thrown error.
import { exec, home, notify, shared, setShared, readTextFile } from "herdr";
import * as D from "./devices.js";

const found = {};
let sdk = null;

// The Android SDK's env vars, read once from the login environment.
function sdkEnv() {
  sdk ??= exec("sh", ["-c", 'printf "%s\\n%s\\n%s" "$ANDROID_HOME" "$ANDROID_SDK_ROOT" "$ANDROID_AVD_HOME"'])
    .then((r) => r.stdout.split("\n"))
    .catch(() => ["", "", ""])
    .then(([androidHome = "", sdkRoot = "", avdHome = ""]) => ({ androidHome, sdkRoot, avdHome, home: home() }));
  return sdk;
}

// Runs a tool from PATH, else from the SDK's homes. null: it isn't installed.
async function tool(name, args) {
  const tries = found[name] ? [found[name]] : D.toolCandidates(name, await sdkEnv());
  for (const path of tries) {
    try {
      const r = await exec(path, args);
      found[name] = path;
      return r;
    } catch {}
  }
  return null;
}

// A tool's path, finding it with a harmless call when no list read did yet.
async function toolPath(name) {
  if (!found[name]) await tool(name, name === "adb" ? ["version"] : ["-list-avds"]);
  return found[name] ?? null;
}

// Running emulators' AVD names by serial.
async function avdNames(adb) {
  const names = {};
  await Promise.all(adb.filter((d) => D.isEmulator(d.serial) && d.state === "device").map(async (d) => {
    const r = await tool("adb", ["-s", d.serial, "emu", "avd", "name"]);
    const name = r && r.code === 0 ? D.parseEmuAvdName(r.stdout) : null;
    if (name) names[d.serial] = name;
  }));
  return names;
}

// { sections, error }
export async function loadIos() {
  const sims = await tool("xcrun", ["simctl", "list", "devices", "-j"]);
  if (!sims) return { sections: [], error: "xcrun not found" };
  if (sims.code !== 0) return { sections: [], error: D.errorLine(sims) };
  try { return { sections: D.parseSimctl(sims.stdout), error: null }; } catch { return { sections: [], error: "simctl printed something unreadable" }; }
}

// { devices, notes }
export async function loadAndroid() {
  const [avdList, adbList] = await Promise.all([tool("emulator", ["-list-avds"]), tool("adb", ["devices", "-l"])]);
  const notes = [];
  if (!avdList) notes.push("emulator not found");
  if (!adbList) notes.push("adb not found");
  else if (adbList.code !== 0) notes.push(`adb: ${D.errorLine(adbList)}`);
  const adb = adbList?.code === 0 ? D.parseAdbDevices(adbList.stdout) : [];
  const avds = avdList?.code === 0 ? D.parseAvds(avdList.stdout) : [];
  const apis = Object.fromEntries(await Promise.all(avds.map(async (n) => [n, D.avdApi(await avdIni(n))])));
  return { devices: D.androidDevices(avds, adb, await avdNames(adb), apis), notes };
}

// Whether a running emulator has finished booting.
export async function bootCompleted(serial) {
  const r = await tool("adb", ["-s", serial, "shell", "getprop", "sys.boot_completed"]);
  return r?.code === 0 && r.stdout.trim() === "1";
}

// The row click on a booted simulator: Simulator.app to the front.
// (An emulator's window has no app bundle to activate, so AVDs get nothing.)
export async function focus(d) {
  if (d.kind === "sim") await exec("open", ["-a", "Simulator"]).catch(() => null);
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
  if (action === "boot" || action === "shutdown") mark("devices.pending", key, { phase: action === "boot" ? "booting" : "stopping", at: Date.now() });
  try {
    const x = { url, path: action === "screenshot" ? D.screenshotPath(home(), d.name, new Date()) : null };
    if (d.kind !== "sim") {
      x.adb = await toolPath("adb");
      if (action === "boot") x.emulator = await toolPath("emulator");
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
      catch { if (step.ok === "any") continue; return fail(`${step.argv[0]} not found`); }
      if (step.ok !== "any" && !(step.ok ?? [0]).includes(r.code)) return fail(D.errorLine(r));
    }
    if (action === "screenshot") notify({ level: "success", title: "Screenshot saved", body: x.path, timeout: 4000 });
    if (action === "erase") notify({ level: "success", title: `Erased ${d.name}`, timeout: 3000 });
    return { ok: true };
  } catch (e) {
    return fail(String(e?.message ?? e));
  } finally {
    setShared("devices.changed", Date.now());
  }
}
