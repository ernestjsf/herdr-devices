// Devices: iOS simulators and Android emulators/devices, with actions.
// One mod, five roles (props.role): none, the panel; over the window "menu"
// (the right-click popup), "url", "maestro" and "erase" (dialogs). Mod commands carry no
// arguments, so the overlays run their action themselves and the panel
// reloads on the shared "devices.changed".
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, theme, shared, setShared, openOverlay, closeOverlay, notify, home, watchFolder, exec, pickFolder, terminals, agents, run } from "herdr";
import { actionsFor, parseVars, appSegment, validUrl, deviceKey, sortRecent, foldRows, settlePending, launchStep, updateUsed, phaseOf, glyphOf, deviceIcon, hoverActions, primaryAction, toggleAction, stepSelection, fitsUnfolded, footerText, avdListChanged, driversFrom, staleClaims, deviceDrivers, driverTag, claimId, claimTag, dividerBefore, menuDividers } from "./devices.js";
import { loadIos, loadAndroid, bootCompleted, emulatorRunning, emulatorLastLine, endWipe, focus, perform, avdHome, forgetAvds, maestroFound, maestroCwd, maestroStart, runMaestro, mark, readPs, claimsDir, readClaims, dropClaims } from "./actions.js";

const icon = (name) => `mods/devices/icons/${name}.svg`;
const SPINNER = "mods/workspace-chrome/spinner.svg";
const MENU_ROW = 30, MENU_DIVIDER = 9;

// Per-copy conveniences (the last list, the folds); never required.
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) ?? "null"); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

function copy(text, cx) {
  cx.write_to_clipboard(text);
  notify({ level: "success", title: "Copied", body: text, timeout: 2000 });
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
    this.width = 0;
    this.height = 0;
    this.drivers = []; // Maestro MCP's device servers, from the last iOS read
    this.cpu = {}; // their CPU seconds then, by pid
    this.claims = {}; // device claims by id, from the claims folder
    this.seen = shared("devices.changed");
    this.reload(cx, "ios", !cache);
    this.reload(cx, "android", !cache);
    maestroFound(); // checked now, so the first menu already knows
    // adb can only be polled (exec waits for a program to end, so
    // `adb track-devices` can't stream). Timers run while hidden: no faster.
    // The AVDs themselves are listed again only when their .ini files change.
    cx.timer.every(5000, (cx) => this.reload(cx, "android"));
    cx.spawn(async (cx) => {
      try {
        const dir = await avdHome();
        for (;;) if (avdListChanged(await watchFolder(dir))) { forgetAvds(); this.reload(cx, "android"); }
      } catch {} // no AVD home: each read lists it again until there is one
    });
    // Simulators: their device.plist changes on boot and shutdown. Phones can
    // only be polled, and the poll is the simulators' safety net too.
    cx.timer.every(5000, (cx) => this.reload(cx, "ios"));
    cx.spawn(async (cx) => {
      try {
        const dir = claimsDir();
        await exec("mkdir", ["-p", dir]); // the watcher needs the folder (fs/promises may not write outside the app's folder)
        this.claims = await readClaims();
        cx.notify();
        for (;;) { await watchFolder(dir); this.claims = await readClaims(); cx.notify(); }
      } catch {} // no folder: the iOS poll reads it
    });
    cx.timer.every(10000, (cx) => cx.notify()); // the footer's "refreshed …m ago"
    cx.spawn(async (cx) => {
      try {
        for (;;) {
          const paths = await watchFolder(`${home()}/Library/Developer/CoreSimulator/Devices`);
          if (paths.some((p) => p.endsWith("/device.plist"))) this.reload(cx, "ios");
        }
      } catch {} // no CoreSimulator folder: the poll covers it
    });
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
        const prev = this[which] && this.rows(which);
        do { s.again = false; this[which] = await (which === "ios" ? loadIos() : loadAndroid()); } while (s.again);
        // MCP drives simulators and iPhones only: one ps per iOS read.
        if (which === "ios") {
          // Claims before ps: a pid written before the listing is in it while alive.
          this.claims = await readClaims(); // the watcher's safety net too
          const rows = await readPs(), stale = staleClaims(this.claims, rows);
          ({ drivers: this.drivers, cpu: this.cpu } = driversFrom(rows, terminals(), this.cpu));
          if (stale.length) { await dropClaims(stale); this.claims = await readClaims(); } // holders gone
        }
        this.refreshedAt = Date.now();
        // Read failed or partial: keep the recents it can't vouch for.
        const used = shared("devices.used") ?? {}, complete = which === "ios" ? !this.ios.error : !this.android.notes.length;
        const nextUsed = updateUsed(used, which, prev, this.rows(which), this.refreshedAt, complete);
        if (JSON.stringify(nextUsed) !== JSON.stringify(used)) setShared("devices.used", nextUsed);
        store.set("cache", { ios: this.ios, android: this.android, at: this.refreshedAt });
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
      else if (step === "late" && p.phase === "erasing") gone[key] = "The wipe didn't finish in three minutes.";
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
    const action = primaryAction(d, phase, { rail });
    if (action === "focus") cx.spawn(async () => focus(d));
    else if (action === "boot") this.act("boot", d, cx);
    cx.notify();
  }

  // The list's keys, on the selected row (a stale one counts as none). Whole
  // keystrokes, so cmd-m and the like pass through.
  key(e, cx) {
    const k = e.keystroke, d = this.visible.find((r) => deviceKey(r) === this.selected);
    const phase = d && phaseOf(d, shared("devices.pending") ?? {}), toggle = d && toggleAction(d, phase);
    if (k === "down" || k === "up") this.selected = stepSelection(this.visible.map(deviceKey), this.selected, k === "down" ? 1 : -1);
    else if (k === "escape" && this.selected) this.selected = null;
    else if (!d) return;
    else if (k === "enter") this.click(d, phase, this.selected, false, cx);
    else if (k === "space" && toggle) this.act(toggle, d, cx);
    else if (k === "s" && hoverActions(d, phase).some((a) => a.action === "screenshot")) this.act("screenshot", d, cx);
    else if (k === "m") openMenu(d, this.claimOf(d));
    else return;
    cx.stop_propagation();
    cx.notify();
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

  row(d, c) {
    const { t, rail, pending } = c, key = deviceKey(d), phase = phaseOf(d, pending);
    const on = d.state === "on" && !phase, drivers = deviceDrivers(d, this.drivers, c.terminals, c.agents), claim = this.claimOf(d);
    return h_flex().id(`row-${key}`).h(26).flex_none().mx(6).pr(4).gap(8).items_center().when(rail, (el) => el.justify_center()).rounded(6).cursor_pointer().text_size(12.5)
      .when(this.selected === key, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.click(d, phase, key, rail, cx))
      .on_mouse_down("right", (_e, cx) => { openMenu(d, this.claimOf(d)); cx.stop_propagation(); })
      .when(rail, (el) => el.tooltip(`${d.name} · ${phase ? `${phase}…` : d.state === "on" ? "booted" : d.state}`))
      // Reserved: the run half colors this bar by space. Nothing yet.
      .child(div().w(2).h(14).flex_none().rounded(1))
      .child(div().size(14).flex_none().child(this.glyph(glyphOf(d, phase), d, t)))
      .when(!rail, (el) => el
        .child(div().min_w(0).truncate().text_color(on ? t.foreground : t.muted).when(on, (n) => n.font_medium()).child(d.name))
        .when(Boolean(d.apps?.length), (n) => n.child(div().id(`app-${key}`).flex_none().max_w(96).truncate().px(5).h(16).rounded(4).bg(t.done + "1f").text_size(10.5).font_medium().text_color(t.done).tooltip(d.apps.join(", ")).child(appSegment(d.apps[0]))))
        .when(drivers.length > 0, (n) => n.child(this.driver(drivers, key, c)))
        .when(Boolean(claim), (n) => { const g = claimTag(claim); return n.child(div().id(`claim-${key}`).flex_none().max_w(96).truncate().px(5).h(16).rounded(4).bg(t.raised).text_size(10.5).font_medium().text_color(t.muted).tooltip(g.tip).child(g.label)); })
        .when(Boolean(phase), (n) => n.child(div().flex_none().text_size(11).text_color(t.dim).child(`${phase}…`)))
        .child(div().flex_1())
        // Right-aligned before the icons. A simulator's version is its section's title already.
        .when(d.kind !== "sim" && Boolean(d.detail), (n) => n.child(div().flex_none().text_size(11).text_color(t.dim).child(d.detail)))
        // Icons sit dim at the right edge and brighten under the pointer: gpui-kit has no
        // hover groups, and redrawing the panel on every row hover made it lag.
        .child(h_flex().flex_none().opacity(0.4).hover((s) => s.opacity(1)).children(hoverActions(d, phase).map((a) =>
          div().id(`b-${a.action}-${key}`).size(24).flex_none().flex().items_center().justify_center().rounded(5)
            .hover((s) => s.bg(t.raised))
            .on_click((_e, cx) => { cx.stop_propagation(); this.act(a.action, d, cx); })
            .tooltip(a.label)
            .child(svg(icon(a.icon)).size(13).text_color(t.muted))))));
  }

  // Who drives the device, shaped like the app tag: `working` while driving,
  // `blocked` when its agent is, else muted (holds it, idle). It brightens under
  // the pointer, unlike the app tag: a click focuses the first driver's terminal.
  // The tooltip lists every driver.
  driver(drivers, key, c) {
    const { t } = c, tags = drivers.map((x) => driverTag(x, c.agents.find((a) => a.address === x.address), c.terminals.find((y) => y.address === x.address)));
    const { label, tone, focus } = tags[0], idle = tone === "idle";
    return div().id(`driver-${key}`).flex_none().max_w(96).truncate().px(5).h(16).rounded(4).bg(idle ? t.raised : t[tone] + "1f").text_size(10.5).font_medium().text_color(idle ? t.muted : t[tone])
      .hover((s) => s.bg(idle ? t.hover : t[tone] + "40").text_color(idle ? t.foreground : t[tone]))
      .tooltip(tags.map((g) => g.tip).join("\n"))
      .on_click((_e, cx) => { cx.stop_propagation(); run(focus, { terminal: drivers[0].address }); })
      .child(label);
  }

  // A centered dim line with one accent link.
  line(id, text, link, t) {
    return h_flex().flex_none().flex_wrap().justify_center().gap(4).px(14).py(8).text_size(12)
      .child(div().text_color(t.dim).child(text))
      .when(Boolean(link), (el) => el.child(div().text_color(t.dim).child("·"))
        .child(div().id(`link-${id}`).text_color(t.accent).cursor_pointer().on_click((_e, cx) => link.go(cx)).child(link?.label ?? "")));
  }

  // A section: header (chevron, title, count), its rows (booted, then recent first,
  // folded to the recent ones unless all fit, `c.fits`), the fold row; `empty`: { text, link } instead of rows.
  section(title, devices, empty, c) {
    const { t, rail, pending, used } = c;
    const closed = this.folds.closed[title] === true, all = c.fits || this.folds.all[title] === true;
    const sorted = sortRecent(devices, used, pending), { shown, hidden } = foldRows(sorted, { all, pending });
    const canFold = !c.fits && foldRows(sorted, { pending }).hidden > 0;
    if (rail || !closed) c.shown.push(...shown);
    if (rail) return [div().mx(8).my(6).h(1).flex_none().bg(t.border), ...shown.map((d) => this.row(d, c))];
    const out = [h_flex().id(`sec-${title}`).h(26).flex_none().px(14).mt(6).gap(6).items_center().cursor_pointer()
      .on_click((_e, cx) => { this.fold("closed", title); cx.notify(); })
      .child(svg(`mods/files/chevron-${closed ? "right" : "down"}.svg`).size(12).flex_none().text_color(t.dim))
      .child(div().text_size(11).font_semibold().text_color(t.dim).child(title))
      .child(div().text_size(11).text_color(t.dim + "99").child(String(devices.length)))];
    if (closed) return out;
    if (empty) out.push(this.line(title, empty.text, empty.link, t));
    out.push(...shown.map((d) => this.row(d, c)));
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
    const body = [], secs = []; // secs: each section's (title, devices, empty), drawn once the fit is known
    if (!this.ios && !this.android) body.push(this.line("loading", "Loading devices…", null, t));
    if (this.ios) {
      const { sections, error } = this.ios;
      if (error) secs.push(["iOS", [], { text: error, link: error === "xcrun not found" ? LINKS.xcode : { label: "Retry", go: (cx) => this.reload(cx, "ios", true) } }]);
      else if (!sections.length) secs.push(["iOS", [], { text: "No simulators", link: LINKS.openXcode }]);
      for (const s of sections) secs.push([s.title, s.devices, null]);
    }
    if (this.android) {
      const { devices, notes } = this.android;
      const missing = notes.some((n) => n.endsWith("not found"));
      const empty = notes.length ? { text: notes.join(" · "), link: missing ? LINKS.sdk : { label: "Retry", go: (cx) => this.reload(cx, "android", true) } }
        : devices.length ? null : { text: "No emulators or devices", link: LINKS.studio };
      secs.push(["Android", devices, empty]);
    }
    // The list: the panel less its border (2), header (42), footer (28, not in the rail) and bottom padding (8).
    const listHeight = this.height - 2 - 42 - (rail ? 0 : 28) - 8;
    const fits = fitsUnfolded(secs.map(([title, devices]) => ({ count: devices.length, closed: !rail && this.folds.closed[title] === true })), listHeight);
    const c = { t, rail, fits, pending: shared("devices.pending") ?? {}, used: shared("devices.used") ?? {}, terminals: terminals(), agents: agents(), shown: [] };
    for (const [title, devices, empty] of secs) body.push(...this.section(title, devices, empty, c));
    this.visible = c.shown;
    const working = this.spinning > 0 || this.busy > 0;
    return v_flex().id("root").track_focus(this.handle).size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13)
      .on_size_change((size, cx) => { this.width = size.width; this.height = size.height; cx.notify(); })
      .on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().h(42).flex_none().px(rail ? 0 : 14).gap(8).items_center().when(rail, (el) => el.justify_center()).border_b(1).border_color(t.border)
        .when(!rail, (el) => el.child(div().font_semibold().child("Devices")).child(div().flex_1()))
        .child(div().id("refresh").size(24).flex_none().flex().items_center().justify_center().rounded(6)
          .when(!working, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { forgetAvds(); this.reloadAll(cx, true); }))
          .child(working ? svg(SPINNER).size(14).text_color(t.muted).spin(900) : svg(icon("refresh")).size(14).text_color(t.muted))))
      .child(v_flex().id("devices-list").flex_1().min_h(0).pb(8).overflow_y_scrollbar().on_click(() => this.handle.focus()).children(body))
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
    if (a.action === "maestroAgain") { closeOverlay(overlay); runMaestro(d, a.path, this.cwd, parseVars(shared("devices.maestroVars")?.[a.path] ?? "") ?? []); return; }
    if (a.action === "openurl" || a.action === "erase") { closeOverlay(overlay); openDialog(a.action === "openurl" ? "url" : a.action, d); return; }
    if (a.action === "boot" || a.action === "shutdown") { setShared("devices.request", { action: a.action, device: d, at: Date.now() }); closeOverlay(overlay); return; }
    this.busy = i;
    cx.spawn(async (cx) => {
      // Maestro lists the flows first, so the dialog opens at its size.
      if (a.action === "maestro") { const start = await maestroStart(); openDialog("maestro", d, start, start.flows.length ? pickerHeight(start.flows.length) : 230); closeOverlay(overlay); return; }
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
        else if (e.key === "up") this.at = (this.at - 1 + n) % n;
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

// Open URL, Run Maestro flow and Erase. Styled like Herdr's prompt and confirm; the action's
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
    const t = theme(), d = this.device, erase = this.role === "erase", maestro = this.role === "maestro";
    const detail = maestro
      ? `Opens a pane below running maestro --device ${d.id} test <path>.`
      : !erase
      ? `Opens it on ${d.name} (${d.kind === "sim" ? "xcrun simctl openurl" : d.kind === "ios" ? "xcrun devicectl, in Safari" : "am start -a android.intent.action.VIEW"}).`
      : d.kind === "sim"
        ? `Removes every app and its data on ${d.name}. Shuts it down and resets it to factory state; it stays in the list.`
        : `Removes every app and its data on ${d.name}; it starts like new. Deletes its snapshots/, then boots it once without a window with the emulator's -wipe-data and stops it.`;
    return v_flex().id("devices-dialog").track_focus(this.handle).size_full().min_h(0).p(18).gap(10).bg(t.popover).text_size(13).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(props().overlay);
        else if (e.key === "enter" && erase) this.confirm(cx);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child(erase ? `Erase ${d.name}?` : maestro ? "Run Maestro flow" : "Open URL"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().text_color(t.muted).child(detail))
      .when(!erase, (el) => el.child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(t.accent).bg(t.background).text_size(12.8).text_color(t.foreground)))
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(t.ansi1).child(this.error ?? "")))
      .child(div().flex_1())
      .child(h_flex().gap(8).justify_end()
        .when(maestro, (el) => el.child(this.button("dd-browse", "Browse…", false, (_e, cx) => cx.spawn(async (cx) => {
          const path = await pickFolder({ prompt: "Use" });
          if (path) { this.input.set_value(path); this.error = null; cx.notify(); }
        }))).child(div().flex_1()))
        .child(this.button("dd-cancel", "Cancel", false, () => closeOverlay(props().overlay)))
        .child(this.button("dd-ok", this.busy ? "Working…" : erase ? "Erase" : maestro ? "Run" : "Open", true, (_e, cx) => this.confirm(cx))));
  }
}

export default class Devices extends View {
  init(_props, cx) {
    const role = props()?.role;
    this.part = role === "menu" ? new Menu() : role === "url" || role === "maestro" || role === "erase" ? new Dialog() : new Panel();
    this.part.init(cx);
  }

  render(cx) { return this.part.render(cx); }
}
