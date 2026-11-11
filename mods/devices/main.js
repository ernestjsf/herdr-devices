// Devices: iOS simulators and Android emulators/devices, with actions, and one device's screen
// live where the panel is (screen-view.js).
// One mod, seven roles: none, the panel; props.screen, the bar over a device's screen; and by
// props.role, over the window, "menu"
// (the right-click popup), "url", "maestro", "erase" and "claimed" (dialogs). Mod commands carry no
// arguments, so the overlays run their action themselves and the panel
// reloads on the shared "devices.changed".
import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, theme, shared, setShared, openOverlay, closeOverlay, notify, home, watchFolder, exec, pickFolder, terminals, agents, run } from "herdr";
import { pollDue, actionsFor, parseVars, appSegment, validUrl, deviceKey, sortRecent, foldRows, settlePending, launchStep, updateUsed, phaseOf, glyphOf, deviceIcon, hoverActions, primaryAction, toggleAction, stepSelection, fitsUnfolded, filterSections, splitRunning, runningDetail, footerText, avdListChanged, driversFrom, staleClaims, claimHolders, deviceDrivers, claimId, deviceTags, dividerBefore, menuDividers } from "./devices.js";
import { loadIos, loadAndroid, bootCompleted, emulatorRunning, emulatorLastLine, endWipe, killEmulator, focus, perform, avdHome, forgetAvds, forgetTools, maestroFound, hookInstalled, forgetHook, maestroCwd, maestroStart, runMaestro, mark, readPs, claimsDir, readClaims, dropClaims } from "./actions.js";
import { showScreen, ScreenBar } from "./screen-view.js";

const icon = (name) => `mods/devices/icons/${name}.svg`;
const SPINNER = "mods/workspace-chrome/spinner.svg";
const MENU_ROW = 30, MENU_DIVIDER = 9;

// Per-copy conveniences (the last list, the folds); never required.
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) ?? "null"); } catch { return null; } },
  set(k, v, replacer) { try { localStorage.setItem(k, JSON.stringify(v, replacer)); } catch {} },
};
// The cached list carries no app tags: they are asked again on the first read, and until then a stale one would show.
const NO_APPS = (k, v) => (k === "apps" ? undefined : v);

const INSTALL = {
  claude: "claude plugin install herdr-devices --marketplace ernestjsf/herdr-devices",
  codex: "git clone https://github.com/ernestjsf/herdr-devices ~/.codex/herdr-devices && sh ~/.codex/herdr-devices/hooks/install-codex.sh",
};

function copy(text, cx) {
  cx.write_to_clipboard(text);
  notify({ level: "success", title: "Copied", body: text, timeout: 2000 });
}

// What the hint's links run. The same as INSTALL, except: `command`, past a shell function named
// claude, and a clone that is already there is updated instead of failing.
const SETUP = {
  claude: { name: "Claude Code", run: `command ${INSTALL.claude}`, after: "Restart your Claude Code sessions to load it." },
  codex: { name: "Codex", run: "{ [ -d ~/.codex/herdr-devices/.git ] && git -C ~/.codex/herdr-devices pull -q --ff-only || git clone -q https://github.com/ernestjsf/herdr-devices ~/.codex/herdr-devices; } && sh ~/.codex/herdr-devices/hooks/install-codex.sh" },
};

// Sets the claim hook up for a harness, through the login shell (its PATH has the harness and
// git). When it fails the command goes on the clipboard, to run by hand.
function setUp(which, cx) {
  const { name, run, after } = SETUP[which];
  notify({ level: "info", title: `Setting up ${name}…`, timeout: 3000 });
  cx.spawn(async (cx) => {
    const r = await exec("sh", ["-c", 'exec "${SHELL:-/bin/zsh}" -lic "$1"', "sh", run], { timeout: 180000 }).catch((e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
    const said = (r.code === 0 ? r.stdout : r.stderr || r.stdout).trim().split("\n").slice(-2).join("\n");
    if (r.code === 0) {
      forgetHook();
      notify({ level: "success", title: `${name} now claims devices`, body: [said, after].filter(Boolean).join("\n"), timeout: 8000 });
    } else {
      cx.write_to_clipboard(INSTALL[which]);
      notify({ level: "error", title: `Couldn't set up ${name}`, body: `${said}\nThe command is on the clipboard: run it in a terminal.` });
    }
    cx.notify();
  });
}

function openDialog(role, d, extra = {}, height = role === "url" ? 200 : 212) {
  openOverlay({ mod: "devices", kind: "dialog", width: 420, height, props: { role, device: d, ...extra } });
}

// The flow picker fits up to 8 rows, then scrolls: TOP is the padding, title (22),
// folder line (18) and their gaps; the filter (36 + gap) shows past 6 flows;
// FOOTER is All flows' separator (9), the Variables field (36) and buttons (32)
// with their gaps, padding and 3 px slack.
const PICK_TOP = 78, PICK_FILTER = 46, PICK_FOOTER = 118;
const pickerHeight = (n) => PICK_TOP + (n > 6 ? PICK_FILTER : 0) + Math.min(n + 1, 8) * MENU_ROW + PICK_FOOTER;

// The flow last run, again, with the variables it ran with.
const runAgain = (d, path, cwd) => runMaestro(d, path, cwd, parseVars(shared("devices.maestroVars")?.[path] ?? "") ?? []);
// The Run Maestro dialog. The flows are listed first, so it opens at its size.
async function openPicker(d) {
  const start = await maestroStart();
  openDialog("maestro", d, start, start.flows.length ? pickerHeight(start.flows.length) : 230);
}

const menuHeight = (items) => items.length * MENU_ROW + menuDividers(items) * MENU_DIVIDER + 38;
// The tab folder's last flow is offered again and a missing maestro disables its row,
// so the menu knows its rows (and size) now.
function openMenu(d, claim) {
  const cwd = maestroCwd(), lastFlow = shared("devices.maestroLast")?.[cwd], maestro = maestroFound();
  const items = actionsFor(d, { lastFlow, maestro, claim });
  openOverlay({ mod: "devices", kind: "popup", width: 250, height: menuHeight(items), props: { role: "menu", device: d, cwd, lastFlow, maestro, claim } });
}

// The one link an empty or error line offers.
const LINKS = {
  xcode: { label: "Get Xcode", go: (cx) => cx.open_url("https://developer.apple.com/xcode/") },
  openXcode: { label: "Open Xcode", go: () => exec("open", ["-a", "Xcode"]).catch(() => null) },
  sdk: { label: "Set ANDROID_HOME", go: (cx) => cx.open_url("https://developer.android.com/tools/variables") },
  studio: { label: "Open Android Studio", go: () => exec("open", ["-a", "Android Studio"]).catch(() => null) },
};

class Panel {
  init(cx) {
    // Paint the last list at once; the reads refresh it behind.
    const cache = store.get("cache");
    this.ios = cache?.ios ?? null;
    this.android = cache?.android ?? null;
    this.refreshedAt = cache?.at ?? 0;
    this.folds = { closed: {}, all: {}, ...(store.get("folds") ?? {}) };
    this.parts = { ios: {}, android: {} };
    this.spinning = 0;
    this.busy = 0;
    this.selected = null;
    this.visible = []; // the shown rows, top to bottom, for the keys
    this.handle = cx.focus_handle();
    // The filter field: view state only. InputState can't say whether it holds the keyboard, so
    // its focus and blur keep `typing`, which keeps the row keys out of what is typed.
    this.filter = InputState.new({ placeholder: "Filter devices…" });
    this.typing = false;
    this.filter.on("change", (_e, cx) => cx.notify());
    this.filter.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.filter.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    // Enter in the field arrives as its submit (key() leaves it alone there): the selected row's click.
    this.filter.on("submit", (_e, cx) => {
      const d = this.visible.find((r) => deviceKey(r) === this.selected);
      if (d) this.click(d, phaseOf(d, shared("devices.pending") ?? {}), this.selected, false, cx);
    });
    this.width = 0;
    this.height = 0;
    this.drivers = []; // Maestro MCP's device servers, from the last iOS read
    this.cpu = {}; // their CPU seconds then, by pid
    this.claims = {}; // device claims by id, from the claims folder
    this.holders = {}; // claim pid -> its holder's terminal, as of the last iOS read
    this.seen = shared("devices.changed");
    this.reload(cx, "ios", !cache);
    this.reload(cx, "android", !cache);
    maestroFound(); // checked now, so the first menu already knows
    hookInstalled();
    this.hintHidden = store.get("hintHidden") === true;
    // adb can only be polled (exec waits for a program to end, so
    // `adb track-devices` can't stream). Timers run while hidden: no faster,
    // and every third tick only once the list has read the same six times (`poll`).
    // The AVDs themselves are listed again only when their .ini files change.
    cx.timer.every(5000, (cx) => this.poll(cx, "android"));
    cx.spawn(async (cx) => {
      try {
        const dir = await avdHome();
        for (;;) if (avdListChanged(await watchFolder(dir))) { forgetAvds(); this.reload(cx, "android"); }
      } catch {} // no AVD home: each read lists it again until there is one
    });
    // Simulators: their device.plist changes on boot and shutdown. Phones can
    // only be polled, and the poll is the simulators' safety net too.
    cx.timer.every(5000, (cx) => this.poll(cx, "ios"));
    cx.spawn(async (cx) => {
      try {
        const dir = claimsDir();
        await exec("mkdir", ["-p", dir]); // the watcher needs the folder (fs/promises may not write outside the app's folder)
        this.claims = await readClaims();
        cx.notify();
        for (;;) { await watchFolder(dir); this.claims = await readClaims(); cx.notify(); }
      } catch {} // no folder: the iOS poll reads it
    });
    cx.timer.every(10000, (cx) => cx.notify()); // the footer's "refreshed …m ago" and the claim pills' "idle …m"
    cx.spawn(async (cx) => {
      try {
        for (;;) {
          const paths = await watchFolder(`${home()}/Library/Developer/CoreSimulator/Devices`);
          if (paths.some((p) => p.endsWith("/device.plist"))) this.reload(cx, "ios");
        }
      } catch {} // no CoreSimulator folder: the poll covers it
    });
  }

  // A timer tick: reads unless the platform's list has been quiet (pollDue).
  poll(cx, which) {
    const s = this.parts[which];
    s.tick = (s.tick ?? 0) + 1;
    if (pollDue(s.quiet ?? 0, s.tick)) this.reload(cx, which);
  }

  // `shown`: the header spinner turns while it runs (first read, Refresh).
  // A reload asked for during one runs right after it.
  reload(cx, which, shown = false) {
    const s = this.parts[which];
    if (s.loading) { s.again = true; return; }
    s.loading = true;
    if (shown) this.spinning++;
    cx.spawn(async (cx) => {
      try {
        const prev = this[which] && this.rows(which), before = JSON.stringify(this[which]);
        do { s.again = false; this[which] = await (which === "ios" ? loadIos() : loadAndroid()); } while (s.again);
        s.quiet = JSON.stringify(this[which]) === before ? (s.quiet ?? 0) + 1 : 0;
        // MCP drives simulators and iPhones only: one ps per iOS read.
        if (which === "ios") {
          // Claims before ps: a pid written before the listing is in it while alive.
          this.claims = await readClaims(); // the watcher's safety net too
          const rows = await readPs(), stale = staleClaims(this.claims, rows);
          ({ drivers: this.drivers, cpu: this.cpu } = driversFrom(rows, terminals(), this.cpu));
          if (stale.length) { await dropClaims(stale, this.claims); this.claims = await readClaims(); } // holders gone
          this.holders = claimHolders(this.claims, rows, terminals());
        }
        this.refreshedAt = Date.now();
        // Read failed or partial: keep the recents it can't vouch for.
        const used = shared("devices.used") ?? {}, complete = which === "ios" ? !this.ios.error : !this.android.notes.length;
        const nextUsed = updateUsed(used, which, prev, this.rows(which), this.refreshedAt, complete);
        if (JSON.stringify(nextUsed) !== JSON.stringify(used)) setShared("devices.used", nextUsed);
        store.set("cache", { ios: this.ios, android: this.android, at: this.refreshedAt }, NO_APPS);
        await this.settle();
      } finally {
        s.loading = false;
        if (shown) this.spinning--;
        cx.notify();
      }
    });
  }

  reloadAll(cx, shown) { this.reload(cx, "ios", shown); this.reload(cx, "android", shown); }

  rows(which) { return which === "ios" ? (this.ios?.sections ?? []).flatMap((s) => s.devices) : this.android?.devices ?? []; }

  // The device's claim, if it has one.
  claimOf(d) { const id = claimId(d); return id ? this.claims[id] : undefined; }

  devices() { return [...this.rows("ios"), ...this.rows("android")]; }

  // Ends the booting / stopping phases that got where they were going, and an
  // AVD launch whose emulator exited (toasting the last line it printed). An
  // erase's wipe that booted is stopped; one past three minutes is given up.
  async settle() {
    const pending = shared("devices.pending") ?? {};
    if (!Object.keys(pending).length) return;
    const byKey = new Map(this.devices().map((d) => [deviceKey(d), d]));
    const completed = new Set(), gone = {};
    for (const [key, p] of Object.entries(pending)) {
      if (!p.avd || (p.phase !== "booting" && p.phase !== "erasing")) continue;
      const d = byKey.get(key), at = Date.now();
      let step = launchStep(p, at, d?.state === "on" && (await bootCompleted(d.serial)));
      if (step === "check") step = launchStep(p, at, false, await emulatorRunning(p.avd));
      if (step === "done") completed.add(key);
      else if (step === "kill") await endWipe(d);
      else if (step === "gone") gone[key] = await emulatorLastLine(p.avd);
      else if (step === "late" && p.phase === "erasing") { await killEmulator(p.avd); gone[key] = "The wipe didn't finish in three minutes, so its emulator was stopped."; }
    }
    const now = shared("devices.pending") ?? {}; // read again: a press may have landed meanwhile
    // Only the same launch, once: another copy may have ended it meanwhile.
    const ended = new Set(Object.keys(gone).filter((key) => now[key]?.at === pending[key].at));
    for (const key of ended) notify({ level: "error", title: `Couldn't ${now[key].phase === "erasing" ? "erase" : "boot"} ${now[key].avd}`, body: gone[key] });
    const next = settlePending(now, this.devices(), Date.now(), completed, ended);
    if (Object.keys(next).length !== Object.keys(now).length) setShared("devices.pending", next);
  }

  act(action, d, cx) {
    if (action === "more") return openMenu(d, this.claimOf(d));
    if (action === "screen") {
      if (this.showing) return; // one at a time: the first is still starting its viewer
      this.showing = true;
      return void cx.spawn(async () => { try { await showScreen(d); } finally { this.showing = false; } });
    }
    if (action === "focus") return void cx.spawn(async () => focus(d));
    const quiet = action === "boot" || action === "shutdown"; // the row's glyph shows those
    if (!quiet) this.busy++;
    cx.spawn(async (cx) => {
      try { await perform(action, d); }
      finally { if (!quiet) this.busy--; cx.notify(); }
    });
    cx.notify();
  }

  click(d, phase, key, rail, cx) {
    this.selected = key;
    this.handle.focus();
    this.typing = false; // the row keys are back even if the field's blur never came
    const action = primaryAction(d, phase, { rail });
    if (action === "focus") cx.spawn(async () => focus(d));
    else if (action === "boot") this.act("boot", d, cx);
    cx.notify();
  }

  // The list's keys, on the selected row (a stale one counts as none). Whole
  // keystrokes, so cmd-m and the like pass through. While the filter field has the keyboard only
  // up, down and Escape are the list's: a stopped key would never type, and Enter is its submit.
  key(e, cx) {
    const k = e.keystroke, d = this.visible.find((r) => deviceKey(r) === this.selected);
    if (this.typing && k !== "up" && k !== "down" && k !== "escape") return;
    const phase = d && phaseOf(d, shared("devices.pending") ?? {}), toggle = d && toggleAction(d, phase);
    if (k === "down" || k === "up") this.selected = stepSelection(this.visible.map(deviceKey), this.selected, k === "down" ? 1 : -1);
    else if (k === "escape" && this.filter.value()) this.filter.set_value("");
    else if (k === "escape" && this.selected) this.selected = null;
    else if (!d) return;
    else if (k === "enter" && hoverActions(d, phase).some((a) => a.action === "focus")) this.act("focus", d, cx);
    else if (k === "space" && toggle) this.act(toggle, d, cx);
    else if (k === "s" && hoverActions(d, phase).some((a) => a.action === "screenshot")) this.act("screenshot", d, cx);
    else if (k === "v" && hoverActions(d, phase).some((a) => a.action === "screen")) this.act("screen", d, cx);
    else if (k === "m") openMenu(d, this.claimOf(d));
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  // The panel's box: it holds the keyboard and knows its size.
  frame(t) {
    return v_flex().id("root").track_focus(this.handle).size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13)
      .on_size_change((size, cx) => { this.width = size.width; this.height = size.height; cx.notify(); })
      .on_key_down((e, cx) => this.key(e, cx));
  }


  fold(kind, title) {
    this.folds[kind][title] = !this.folds[kind][title];
    store.set("folds", this.folds);
  }

  // The device's icon, carrying its state: booted it is bright with a `done`
  // dot on its corner, off it is dim; the spinner in a phase, the warning
  // triangle offline.
  glyph(g, d, t) {
    if (g === "spin") return svg(SPINNER).size(13).text_color(t.working).spin(900);
    if (g === "warn") return svg(icon("triangle")).size(12).text_color(t.blocked);
    return div().relative().size(14).child(svg(icon(deviceIcon(d))).size(14).text_color(g === "on" ? t.foreground : t.dim))
      .when(g === "on", (el) => el.child(div().absolute().right(-3).bottom(-2).size(7).rounded(4).bg(t.done).border(1.5).border_color(t.background)));
  }

  // `two`: a Running row outside the rail, 40 px: the name and the icons, then under the name its
  // detail and phase and the tags. Else 26 px, all on one line. The glyph is centered on the row.
  row(d, c, two) {
    const { t, rail, pending } = c, key = deviceKey(d), phase = phaseOf(d, pending);
    const on = d.state === "on" && !phase, claim = this.claimOf(d);
    const drivers = deviceDrivers(d, this.drivers, c.terminals, c.agents);
    const tags = deviceTags(claim, drivers, c.agents, c.terminals, { holder: this.holders[claim?.pid] ?? null, now: c.now });
    const state = phase ? `${phase}…` : d.state === "on" ? "booted" : d.state;
    const row = h_flex().id(`row-${key}`).h(two ? 40 : 26).flex_none().mx(6).pr(4).gap(8).items_center().rounded(6).cursor_pointer().text_size(12.5)
      .when(rail, (el) => el.justify_center().tooltip(`${d.name} · ${state}`))
      .when(this.selected === key, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.click(d, phase, key, rail, cx))
      .on_mouse_down("right", (_e, cx) => { openMenu(d, this.claimOf(d)); cx.stop_propagation(); })
      // Reserved: the run half colors this bar by space. Nothing yet.
      .child(div().w(2).h(14).flex_none().rounded(1))
      .child(div().size(14).flex_none().child(this.glyph(glyphOf(d, phase), d, t)));
    if (rail) return row;
    const name = div().min_w(0).truncate().text_color(on ? t.foreground : t.muted).when(on, (n) => n.font_medium()).child(d.name);
    // The claim pill takes up to 200 px on a Running row's second line, for the session's name. Its
    // hover, like every hover here, is style only, never a cx.notify(): re-rendering on hover made the panel lag.
    const pills = [...(d.apps?.length ? [this.appTag(d, key, t)] : []), ...tags.map((g, i) => this.tag(g, i && tags.length > 1 ? `driver-${key}` : `tag-${key}`, t, d, two && g.icon === "lock" ? 200 : 96))];
    // Icons sit dim at the right edge and brighten under the pointer: gpui-kit has no
    // hover groups, and redrawing the panel on every row hover made it lag.
    const icons = h_flex().flex_none().opacity(0.4).hover((s) => s.opacity(1)).children(hoverActions(d, phase).map((a) => this.hoverIcon(a, d, key, t)));
    // Line 1 is the icons' 24 px, line 2 the tags' 16: the 40 px row.
    if (two) return row.child(v_flex().flex_1().min_w(0)
      .child(h_flex().h(24).gap(8).items_center().child(name).child(div().flex_1()).child(icons))
      .child(h_flex().h(16).gap(8).items_center().overflow_hidden().text_size(11).text_color(t.dim)
        .child(div().flex_none().child(runningDetail(d, phase))).children(pills)));
    // Left to right: name, app tag, agent tag(s), phase, then right-aligned the detail and the icons.
    return row
      .child(name)
      .children(pills)
      .when(Boolean(phase), (n) => n.child(div().flex_none().text_size(11).text_color(t.dim).child(`${phase}…`)))
      .child(div().flex_1())
      // A simulator's version is its section's title already.
      .when(d.kind !== "sim" && Boolean(d.detail), (n) => n.child(div().flex_none().text_size(11).text_color(t.dim).child(d.detail)))
      .child(icons);
  }

  // The running app's tag: the last segment of the app in front; the tooltip lists them all.
  appTag(d, key, t) {
    return div().id(`app-${key}`).flex_none().max_w(96).truncate().px(5).h(16).rounded(4)
      .bg(t.done + "1f").text_size(10.5).font_medium().text_color(t.done)
      .tooltip(d.apps.join(", "))
      .child(appSegment(d.apps[0]));
  }

  // One of a row's hover icons (hoverActions).
  hoverIcon(a, d, key, t) {
    return div().id(`b-${a.action}-${key}`).size(24).flex_none().flex().items_center().justify_center().rounded(5)
      .hover((s) => s.bg(t.raised))
      .on_click((_e, cx) => { cx.stop_propagation(); this.act(a.action, d, cx); })
      .tooltip(a.label)
      .child(svg(icon(a.icon)).size(13).text_color(t.muted));
  }

  // The agent pill, shaped like the app tag: an icon for the relationship (lock claimed, link
  // driven, triangle mismatch), the tone for liveness (`working` driving, `blocked` its agent is,
  // else muted), the holder's program icon, then the label (truncated), the idle text in `dim` and,
  // on a claim, a × that releases it; a claim pill gives way (its label truncates) before the row's detail does. With a click (the holder's or the first driver's terminal) it
  // brightens under the pointer, unlike the app tag.
  tag({ icon: ic, label, tone, tip, focus, terminal, program: p, idle: since, release }, id, t, d, max) {
    const idle = tone === "idle", color = idle ? t.muted : t[tone];
    return h_flex().id(id).when(!release, (el) => el.flex_none()).min_w(0).max_w(max).truncate().items_center().gap(3).px(5).h(16).rounded(4)
      .bg(idle ? t.raised : t[tone] + "1f").text_size(10.5).font_medium().text_color(color)
      .when(Boolean(focus), (el) => el
        .hover((s) => s.bg(idle ? t.hover : t[tone] + "40").text_color(idle ? t.foreground : color))
        .on_click((_e, cx) => { cx.stop_propagation(); run(focus, { terminal }); }))
      .tooltip(tip)
      .child(svg(icon(ic)).size(10).flex_none())
      .when(Boolean(p), (el) => el.child(p.tint ? svg(p.icon).size(10).flex_none() : image(p.icon).w(10).h(10).flex_none()))
      .when(Boolean(label), (el) => el.child(div().min_w(0).truncate().child(label)))
      .when(Boolean(since), (el) => el.child(div().flex_none().text_color(t.dim).child(since)))
      // Its own hit area: the release, never the pill's focus or the row's click.
      .when(Boolean(release), (el) => el.child(div().id(`${id}-release`).flex_none().px(2).text_size(11).text_color(t.dim).cursor_pointer()
        .hover((s) => s.text_color(t.foreground)).tooltip("Release claim")
        .on_click((_e, cx) => { cx.stop_propagation(); this.act("release", d, cx); }).child("×")));
  }

  // A centered dim line with accent links (one, or an array).
  line(id, text, link, t, hide) {
    const links = [link ?? []].flat();
    return h_flex().flex_none().flex_wrap().justify_center().gap(4).px(14).py(8).text_size(12)
      .child(div().text_color(t.dim).child(text))
      .children(links.flatMap((l, i) => [div().text_color(t.dim).child("·"),
        div().id(i ? `link-${id}-${i}` : `link-${id}`).text_color(t.accent).cursor_pointer().on_click((_e, cx) => l.go(cx)).child(l.label)]))
      .when(Boolean(hide), (el) => el.child(div().id(`hide-${id}`).text_color(t.dim).cursor_pointer().on_click((_e, cx) => hide(cx)).child("×")));
  }

  // A section: header (chevron, title, count), its rows (booted, then recent first,
  // folded to the recent ones unless all fit, `c.fits`), the fold row; `empty`: { text, link } instead of rows.
  // `running`: Running, never folded (foldRows keeps every row not off) and two-line outside the rail.
  // While filtering (`c.query`) every match shows and the header doesn't fold.
  section({ title, devices, empty, running }, c) {
    const { t, rail, pending, used } = c, two = running === true && !rail;
    const closed = !c.query && this.folds.closed[title] === true, all = c.fits || this.folds.all[title] === true;
    const sorted = sortRecent(devices, used, pending), { shown, hidden } = foldRows(sorted, { all, pending });
    const canFold = !c.fits && foldRows(sorted, { pending }).hidden > 0;
    if (rail || !closed) c.shown.push(...shown);
    if (rail) return [div().mx(8).my(6).h(1).flex_none().bg(t.border), ...shown.map((d) => this.row(d, c, false))];
    const out = [h_flex().id(`sec-${title}`).h(26).flex_none().px(14).mt(6).gap(6).items_center()
      .when(!c.query, (el) => el.cursor_pointer().on_click((_e, cx) => { this.fold("closed", title); cx.notify(); }))
      .child(svg(`mods/files/chevron-${closed ? "right" : "down"}.svg`).size(12).flex_none().text_color(t.dim))
      .child(div().text_size(11).font_semibold().text_color(t.dim).child(title))
      .child(div().text_size(11).text_color(t.dim + "99").child(String(devices.length)))];
    if (closed) return out;
    if (empty) out.push(this.line(title, empty.text, empty.link, t));
    out.push(...shown.map((d) => this.row(d, c, two)));
    if (canFold) out.push(h_flex().id(`fold-${title}`).h(24).flex_none().mx(6).pl(32).items_center().rounded(6).cursor_pointer()
      .text_size(11.5).text_color(t.muted).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.fold("all", title); cx.notify(); })
      .child(all ? "Show fewer" : `Show all (${sorted.length})`));
    return out;
  }

  render(cx) {
    const changed = shared("devices.changed");
    if (changed !== this.seen) { this.seen = changed; this.reloadAll(cx); }
    // A Boot or Shut down the menu handed over: taken once, and only fresh (it's persisted).
    const asked = shared("devices.request");
    if (asked) { setShared("devices.request", null); if (Date.now() - asked.at < 10000) this.act(asked.action, asked.device, cx); }
    const t = theme(), rail = this.width > 0 && this.width < 160;
    const body = [], all = []; // all: each section's { title, devices, empty }, drawn once the fit is known
    if (!this.ios && !this.android) body.push(this.line("loading", "Loading devices…", null, t));
    if (this.ios) {
      const { sections, error } = this.ios;
      if (error) all.push({ title: "iOS", devices: [], empty: { text: error, link: error === "xcrun not found" ? LINKS.xcode : { label: "Retry", go: (cx) => { forgetTools(); this.reload(cx, "ios", true); } } } });
      else if (!sections.length) all.push({ title: "iOS", devices: [], empty: { text: "No simulators", link: LINKS.openXcode } });
      for (const s of sections) all.push({ title: s.title, devices: s.devices, empty: null });
    }
    if (this.android) {
      const { devices, notes } = this.android;
      const missing = notes.some((n) => n.endsWith("not found"));
      const empty = notes.length ? { text: notes.join(" · "), link: missing ? LINKS.sdk : { label: "Retry", go: (cx) => { forgetTools(); this.reload(cx, "android", true); } } }
        : devices.length ? null : { text: "No emulators or devices", link: LINKS.studio };
      all.push({ title: "Android", devices, empty });
    }
    // The filter's matches (the rail has no field, so none there), the running ones in a section on top.
    const pending = shared("devices.pending") ?? {}, query = rail ? "" : this.filter.value().trim();
    const secs = splitRunning(filterSections(all, query), pending);
    if (query && !secs.length && all.length) body.push(this.line("nomatch", "No devices match", null, t));
    // Maestro is there but no agent can claim: one hint above the footer, unless hidden for good.
    const hint = !rail && maestroFound() && !hookInstalled() && !this.hintHidden;
    // The list: the panel less its border (2), header (42), filter field (38: 8 above, 28, 2 below),
    // footer (28) and hint (32), none in the rail, and bottom padding (8).
    const listHeight = this.height - 2 - 42 - (rail ? 0 : 38 + 28) - (hint ? 32 : 0) - 8;
    // While filtering every match shows, as if all fit.
    const fits = Boolean(query) || fitsUnfolded(secs.map((s) => ({ count: s.devices.length, closed: !rail && this.folds.closed[s.title] === true, row: s.running && !rail ? 40 : 26 })), listHeight);
    const c = { t, rail, fits, query, pending, used: shared("devices.used") ?? {}, terminals: terminals(), agents: agents(), shown: [], now: Date.now() };
    for (const s of secs) body.push(...this.section(s, c));
    this.visible = c.shown;
    const working = this.spinning > 0 || this.busy > 0;
    return this.frame(t)
      .child(h_flex().h(42).flex_none().px(rail ? 0 : 14).gap(8).items_center().when(rail, (el) => el.justify_center()).border_b(1).border_color(t.border)
        .when(!rail, (el) => el.child(div().font_semibold().child("Devices")).child(div().flex_1()))
        .child(div().id("refresh").size(24).flex_none().flex().items_center().justify_center().rounded(6)
          .when(!working, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { forgetTools(); forgetAvds(); this.reloadAll(cx, true); }))
          .child(working ? svg(SPINNER).size(14).text_color(t.muted).spin(900) : svg(icon("refresh")).size(14).text_color(t.muted))))
      // Outside the list: the list's click takes the keyboard back to the root.
      .when(!rail, (el) => el.child(v_flex().flex_none().px(8).pt(8).pb(2)
        .child(Input.new(this.filter).h(28).px(8).rounded(7).border_1().border_color(this.typing ? t.accent : t.border).bg(t.background).text_size(12).text_color(t.foreground))))
      .child(v_flex().id("devices-list").flex_1().min_h(0).pb(8).overflow_y_scrollbar().on_click(() => this.handle.focus()).children(body))
      .when(hint, (el) => el.child(this.line("hook", "Agents don't claim devices yet", [{ label: "Set up Claude Code", go: (cx) => setUp("claude", cx) }, { label: "Codex", go: (cx) => setUp("codex", cx) }], t,
        (cx) => { this.hintHidden = true; store.set("hintHidden", true); cx.notify(); })))
      .when(!rail, (el) => el.child(h_flex().h(28).flex_none().px(14).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
        .child(div().min_w(0).truncate().child(footerText(this.rows("ios"), this.android?.devices ?? [], this.refreshedAt, Date.now())))));
  }
}

// The right-click menu. A popup's tasks end when it closes: Boot and Shut down
// go to the panel (the row spins) and it closes at once; anything else it
// finishes first ("Working…"), then closes.
class Menu {
  init(cx) {
    const { device, cwd, lastFlow, maestro, claim } = props();
    this.device = device;
    this.cwd = cwd;
    this.claim = claim;
    this.items = actionsFor(device, { lastFlow, maestro, claim });
    this.at = -1;
    this.busy = -1;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  choose(i, cx) {
    const a = this.items[i], { overlay } = props(), d = this.device;
    if (!a || a.disabled || this.busy >= 0) return;
    if (a.action === "copy" || a.action === "copyapp") { copy(a.action === "copy" ? d.id : d.apps[0], cx); closeOverlay(overlay); return; }
    // A claimed device: its agent is asked about first ("claimed"), since a run here interrupts it.
    if (this.claim && (a.action === "maestro" || a.action === "maestroAgain")) { closeOverlay(overlay); openDialog("claimed", d, { owner: this.claim.owner, next: a.action, path: a.path, cwd: this.cwd }); return; }
    if (a.action === "maestroAgain") { closeOverlay(overlay); runAgain(d, a.path, this.cwd); return; }
    if (a.action === "openurl" || a.action === "erase") { closeOverlay(overlay); openDialog(a.action === "openurl" ? "url" : a.action, d); return; }
    if (a.action === "boot" || a.action === "shutdown") { setShared("devices.request", { action: a.action, device: d, at: Date.now() }); closeOverlay(overlay); return; }
    this.busy = i;
    cx.spawn(async (cx) => {
      if (a.action === "maestro") { await openPicker(d); closeOverlay(overlay); return; }
      await perform(a.action, d, { app: a.app }); closeOverlay(overlay); cx.notify();
    });
    cx.notify();
  }

  render() {
    const t = theme();
    return v_flex().id("devices-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        const n = this.items.length;
        if (e.key === "down") this.at = (this.at + 1) % n;
        else if (e.key === "up") this.at = this.at < 0 ? n - 1 : (this.at - 1 + n) % n; // none selected: the last
        else if (e.key === "enter") this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(div().h(24).px(8).flex_none().truncate().text_size(11).text_color(t.dim).child(this.device.name))
      .children(this.items.flatMap((a, i) => [
        ...(dividerBefore(this.items, i) ? [div().mx(8).my(4).h(1).flex_none().bg(t.border)] : []),
        h_flex().id(`dm-${a.action}-${i}`).h(MENU_ROW).flex_none().px(8).gap(9).rounded(7).items_center()
          .text_color(a.disabled ? t.dim : a.danger ? t.ansi1 : t.foreground)
          .when(!a.disabled, (el) => el.cursor_pointer()
            .when(i === this.at || i === this.busy, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.choose(i, cx)))
          .child(svg(icon(a.icon)).size(14).flex_none().text_color(a.disabled ? t.dim : a.danger ? t.ansi1 : t.muted))
          .child(div().flex_1().min_w(0).truncate().child(i === this.busy ? "Working…" : a.label))
          .when(a.hint, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(a.hint)))]));
  }
}

// Open URL, Run Maestro flow, Erase and the question before a run on a claimed device
// ("claimed"). Styled like Herdr's prompt and confirm; the action's
// error closes nothing (it is also toasted). Run Maestro flow picks from the
// .maestro folder's flows, or asks for a path when there is none.
class Dialog {
  init(cx) {
    const { role, device, cwd, path, flows = [] } = props();
    this.role = role;
    this.device = device;
    this.cwd = cwd;
    this.path = path;
    this.flows = flows;
    this.picking = role === "maestro" && flows.length > 0;
    this.error = null;
    this.busy = false;
    this.handle = cx.focus_handle();
    // All flows is row 0; the flow last run here is preselected while it still exists.
    this.filter = "";
    this.at = this.picking ? flows.findIndex((f) => f.path === shared("devices.maestroLast")?.[cwd]) + 1 : 0;
    if (this.picking) {
      this.varsShown = this.varsFor(this.visible()[this.at]);
      this.vars = InputState.new({ placeholder: "KEY=VALUE, space separated (maestro -e)", value: this.varsShown });
      // Compared, not flagged: set_value may report a change too.
      this.vars.on("change", (_e, cx) => { if (this.vars.value() !== this.varsShown) this.varsEdited = true; this.varsError = null; cx.notify(); });
      this.vars.on("submit", (_e, cx) => this.pick(this.visible()[this.at], cx));
    }
    if (role === "url" || (role === "maestro" && (!this.picking || flows.length > 6))) {
      const placeholder = this.picking ? "Filter flows…" : role === "url" ? "https://… or myapp://…" : "Flow file or folder";
      this.input = InputState.new({ placeholder, ...(role === "maestro" && !this.picking && { value: path }) });
      this.input.on("change", (_e, cx) => {
        if (this.picking) { this.filter = this.input.value().trim().toLowerCase(); this.select(0); } else this.error = null;
        cx.notify();
      });
      this.input.on("submit", (_e, cx) => (this.picking ? this.pick(this.visible()[this.at], cx) : this.confirm(cx)));
      this.input.focus();
      cx.timer.after(600, () => this.input.focus());
    } else this.handle.focus();
  }

  // The picker's rows: All flows, then every flow; filtered, only the flows that match.
  visible() {
    const f = this.filter;
    return f ? this.flows.filter((r) => (r.sub + r.label).toLowerCase().includes(f)) : [{ all: true, path: this.path }, ...this.flows];
  }

  // A row's variables: what was typed in the field, else the ones it ran with last.
  varsFor(r) {
    return this.varsEdited ? this.vars.value() : (shared("devices.maestroVars")?.[r?.path] ?? "");
  }

  // The Variables field follows the selected row until it is typed in.
  select(at) {
    this.at = at;
    if (this.varsEdited) return;
    this.varsShown = this.varsFor(this.visible()[at]);
    this.vars.set_value(this.varsShown);
  }

  // The variables as argv words, or null with the error shown.
  typedVars(text, cx) {
    const vars = parseVars(text);
    if (!vars) { this.varsError = "Variables are KEY=VALUE, space separated"; cx.notify(); }
    return vars;
  }

  // Once: Enter can come both as the input's submit and as a key.
  run(path, vars = []) {
    if (this.ran) return;
    this.ran = true;
    runMaestro(this.device, path, this.cwd, vars);
    closeOverlay(props().overlay);
  }

  pick(r, cx) {
    if (!r || this.ran) return;
    const text = this.varsFor(r), vars = this.typedVars(text, cx);
    if (!vars) return;
    mark("devices.maestroLast", this.cwd, r.all ? undefined : r.path);
    mark("devices.maestroVars", r.path, text.trim() || undefined);
    this.run(r.path, vars);
  }

  confirm(cx) {
    if (this.busy) return;
    // Run anyway: what the menu row would have done on an unclaimed device.
    if (this.role === "claimed") {
      const { next, overlay } = props();
      if (next === "maestroAgain") { runAgain(this.device, this.path, this.cwd); closeOverlay(overlay); return; }
      this.busy = true;
      cx.spawn(async () => { await openPicker(this.device); closeOverlay(overlay); });
      cx.notify();
      return;
    }
    if (this.role === "maestro") {
      const path = this.input.value().trim();
      if (!path) { this.error = "Type a flow file or folder path, or Browse…"; cx.notify(); return; }
      this.run(path);
      return;
    }
    const url = this.role === "url" ? this.input.value().trim() : undefined;
    if (this.role === "url" && !validUrl(url)) { this.error = "Type a URL with a scheme, like https:// or myapp://."; cx.notify(); return; }
    this.busy = true;
    cx.spawn(async (cx) => {
      const r = await perform(this.role === "url" ? "openurl" : "erase", this.device, { url });
      this.busy = false;
      if (r.ok) closeOverlay(props().overlay);
      else { this.error = r.message; cx.notify(); }
    });
    cx.notify();
  }

  button(id, text, primary, action) {
    const t = theme(), erase = this.role === "erase";
    return h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1()
      .border_color(primary ? (erase ? t.ansi1 : t.solid) : t.input).bg(primary ? (erase ? t.ansi1 : t.solid) : t.raised)
      .text_color(primary ? (erase ? t.background : t.solid_foreground) : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
  }

  // A picker row, sized and styled like the menu's: click runs it, hover only paints.
  flowRow(r, i, t) {
    return h_flex().id(`df-${i}`).h(MENU_ROW).flex_none().px(8).gap(9).rounded(7).items_center().cursor_pointer()
      .when(i === this.at, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.pick(r, cx))
      .child(r.all ? svg(icon("flask")).size(14).flex_none().text_color(t.muted) : div().size(14).flex_none())
      .child(r.all ? div().flex_1().min_w(0).truncate().child("All flows")
        : h_flex().flex_1().min_w(0).when(Boolean(r.sub), (el) => el.child(div().min_w(0).truncate().text_color(t.dim).child(r.sub)))
          .child(div().min_w(0).truncate().text_color(t.foreground).child(r.label)));
  }

  picker() {
    const t = theme(), d = this.device, rows = this.visible(), h = home();
    const folder = this.path === h || this.path.startsWith(`${h}/`) ? `~${this.path.slice(h.length)}` : this.path;
    const list = rows.map((r, i) => (r.all ? div().flex_none().pb(4).mb(4).border_b(1).border_color(t.border).child(this.flowRow(r, i, t)) : this.flowRow(r, i, t)));
    return v_flex().id("devices-dialog").track_focus(this.handle).size_full().min_h(0).p(18).gap(10).bg(t.popover).text_size(13).text_color(t.foreground)
      .on_key_down((e, cx) => {
        const n = rows.length;
        if (e.key === "escape") closeOverlay(props().overlay);
        else if (e.key === "down" && n) this.select((this.at + 1) % n);
        else if (e.key === "up" && n) this.select((this.at - 1 + n) % n);
        else if (e.key === "enter" && !this.input) this.pick(rows[this.at], cx); // with a filter, its submit runs it
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().h(22).flex_none().items_center().child(div().flex_1().text_size(15).font_semibold().child("Run Maestro flow"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().h(18).flex_none().min_w(0).truncate().text_size(12).text_color(t.muted).child(`on ${d.name} · ${folder}`))
      .when(Boolean(this.input), (el) => el.child(Input.new(this.input).h(36).flex_none().px(10).rounded(9).border_1().border_color(t.accent).bg(t.background).text_size(12.8).text_color(t.foreground)))
      .child(v_flex().id("dd-flows").flex_1().min_h(0).overflow_y_scrollbar()
        .children(rows.length ? list : [div().h(MENU_ROW).flex_none().pl(31).flex().items_center().text_color(t.dim).child("No flows match")]))
      .child(Input.new(this.vars).h(36).flex_none().px(10).rounded(9).border_1().border_color(t.accent).bg(t.background).text_size(12.8).text_color(t.foreground))
      // Not in the height: the list gives it room.
      .when(Boolean(this.varsError), (el) => el.child(div().flex_none().text_size(12).text_color(t.ansi1).child(this.varsError ?? "")))
      .child(h_flex().flex_none().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child("↑↓ select · ↵ run"))
        .child(this.button("dd-browse", "Browse…", false, (_e, cx) => {
          const vars = this.typedVars(this.vars.value(), cx);
          if (vars) cx.spawn(async () => { const path = await pickFolder({ prompt: "Run" }); if (path) this.run(path, vars); });
        }))
        .child(this.button("dd-cancel", "Cancel", false, () => closeOverlay(props().overlay)))
        .child(this.button("dd-ok", "Run", true, (_e, cx) => this.pick(rows[this.at], cx))));
  }

  render() {
    if (this.picking) return this.picker();
    const t = theme(), d = this.device, erase = this.role === "erase", maestro = this.role === "maestro", claimed = this.role === "claimed";
    const detail = claimed
      ? `${props().owner ?? "An agent"} holds ${d.name}. A Maestro run from here will interrupt what it is doing.`
      : maestro
      ? `Opens a pane below running maestro --device ${d.id} test <path>.`
      : !erase
      ? `Opens it on ${d.name} (${d.kind === "sim" ? "xcrun simctl openurl" : d.kind === "ios" ? "xcrun devicectl, in Safari" : "am start -a android.intent.action.VIEW"}).`
      : d.kind === "sim"
        ? `Removes every app and its data on ${d.name}. Shuts it down and resets it to factory state; it stays in the list.`
        : `Removes every app and its data on ${d.name}; it starts like new. Deletes its snapshots/, then boots it once without a window with the emulator's -wipe-data and stops it.`;
    return v_flex().id("devices-dialog").track_focus(this.handle).size_full().min_h(0).p(18).gap(10).bg(t.popover).text_size(13).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(props().overlay);
        else if (e.key === "enter" && !this.input) this.confirm(cx); // with a field, its submit confirms
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child(erase ? `Erase ${d.name}?` : claimed ? `${d.name} is claimed` : maestro ? "Run Maestro flow" : "Open URL"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().text_color(t.muted).child(detail))
      .when(Boolean(this.input), (el) => el.child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(t.accent).bg(t.background).text_size(12.8).text_color(t.foreground)))
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(t.ansi1).child(this.error ?? "")))
      .child(div().flex_1())
      .child(h_flex().gap(8).justify_end()
        .when(maestro, (el) => el.child(this.button("dd-browse", "Browse…", false, (_e, cx) => cx.spawn(async (cx) => {
          const path = await pickFolder({ prompt: "Use" });
          if (path) { this.input.set_value(path); this.error = null; cx.notify(); }
        }))).child(div().flex_1()))
        .child(this.button("dd-cancel", "Cancel", false, () => closeOverlay(props().overlay)))
        .child(this.button("dd-ok", this.busy ? "Working…" : erase ? "Erase" : claimed ? "Run anyway" : maestro ? "Run" : "Open", true, (_e, cx) => this.confirm(cx))));
  }
}

export default class Devices extends View {
  init(_props, cx) {
    const role = props()?.role;
    this.part = props()?.screen ? new ScreenBar() : role === "menu" ? new Menu() : role === "url" || role === "maestro" || role === "erase" || role === "claimed" ? new Dialog() : new Panel();
    this.part.init(cx);
  }

  render(cx) { return this.part.render(cx); }
}
