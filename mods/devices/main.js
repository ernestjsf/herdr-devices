// Devices: iOS simulators and Android emulators/devices, with actions.
// One mod, four roles (props.role): none, the panel; over the window "menu"
// (the right-click popup), "url" and "erase" (dialogs). Mod commands carry no
// arguments, so the overlays run their action themselves and the panel
// reloads on the shared "devices.changed".
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, theme, shared, setShared, openOverlay, closeOverlay, notify, home, watchFolder, exec } from "herdr";
import { actionsFor, validUrl, deviceKey, sortRecent, foldRows, settlePending, launchStep, updateUsed, phaseOf, glyphOf, hoverActions, primaryAction, footerText, avdListChanged } from "./devices.js";
import { loadIos, loadAndroid, bootCompleted, emulatorRunning, emulatorLastLine, endWipe, focus, perform, avdHome, forgetAvds } from "./actions.js";

const icon = (name) => `mods/devices/icons/${name}.svg`;
const SPINNER = "mods/workspace-chrome/spinner.svg";
const MENU_ROW = 30;

// Per-copy conveniences (the last list, the folds); never required.
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) ?? "null"); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

function copy(d, cx) {
  cx.write_to_clipboard(d.id);
  notify({ level: "success", title: "Copied", body: d.id, timeout: 2000 });
}

function openDialog(role, d) {
  openOverlay({ mod: "devices", kind: "dialog", width: 420, height: role === "url" ? 200 : 190, props: { role, device: d } });
}

function openMenu(d) {
  openOverlay({ mod: "devices", kind: "popup", width: 210, height: actionsFor(d).length * MENU_ROW + 38, props: { role: "menu", device: d } });
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
    this.hovered = null;
    this.selected = null;
    this.width = 0;
    this.seen = shared("devices.changed");
    this.reload(cx, "ios", !cache);
    this.reload(cx, "android", !cache);
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
    // Simulators: their device.plist changes on boot and shutdown; the slow
    // poll is the safety net.
    cx.timer.every(15000, (cx) => this.reload(cx, "ios"));
    cx.timer.every(10000, (cx) => cx.notify()); // the footer's "refreshed …s ago"
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
    if (action === "more") return openMenu(d);
    const quiet = action === "boot" || action === "shutdown"; // the row's glyph shows those
    if (!quiet) this.busy++;
    cx.spawn(async (cx) => {
      try { await perform(action, d); }
      finally { if (!quiet) this.busy--; cx.notify(); }
    });
    cx.notify();
  }

  click(d, phase, key, cx) {
    this.selected = key;
    const a = primaryAction(d, phase);
    if (a === "boot") this.act("boot", d, cx);
    else if (a === "focus") cx.spawn(async () => focus(d));
    cx.notify();
  }

  fold(kind, title) {
    this.folds[kind][title] = !this.folds[kind][title];
    store.set("folds", this.folds);
  }

  glyph(g, t) {
    if (g === "spin") return svg(SPINNER).size(9).text_color(t.working).spin(900);
    if (g === "warn") return svg(icon("triangle")).size(8).text_color(t.blocked);
    return g === "on" ? div().size(7).rounded(4).bg(t.done) : div().size(7).rounded(4).border_1().border_color(t.dim);
  }

  row(d, c) {
    const { t, rail, pending } = c, key = deviceKey(d), phase = phaseOf(d, pending);
    const on = d.state === "on" && !phase, hovered = this.hovered === key && !rail;
    return h_flex().id(`row-${key}`).h(24).flex_none().mx(6).pr(4).gap(6).items_center().rounded(6).cursor_pointer().text_size(12.5)
      .when(on, (el) => el.bg(t.done + "14"))
      .when(this.selected === key, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .on_hover((h, cx) => { this.hovered = h ? key : this.hovered === key ? null : this.hovered; cx.notify(); })
      .on_click((_e, cx) => this.click(d, phase, key, cx))
      .on_mouse_down("right", (_e, cx) => { openMenu(d); cx.stop_propagation(); })
      // Reserved: the run half colors this bar by space. Nothing yet.
      .child(div().w(2).h(14).flex_none().rounded(1))
      .child(div().w(9).flex_none().flex().items_center().justify_center().child(this.glyph(glyphOf(d, phase), t)))
      .when(rail, (el) => el.child(div().flex_none().font_semibold().child(d.name.slice(0, 1).toUpperCase())))
      .when(!rail, (el) => el
        .child(div().min_w(0).truncate().text_color(t.foreground).when(on, (n) => n.font_semibold()).child(d.name))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(d.detail ?? ""))
        .when(Boolean(phase), (n) => n.child(div().flex_none().text_size(11).text_color(t.dim).child(`${phase}…`)))
        .child(div().flex_1())
        .when(hovered, (n) => n.children(hoverActions(d, phase).map((a) =>
          div().id(`b-${a.action}-${key}`).size(24).flex_none().flex().items_center().justify_center().rounded(5)
            .hover((s) => s.bg(t.raised))
            .on_click((_e, cx) => { cx.stop_propagation(); this.act(a.action, d, cx); })
            .child(svg(icon(a.icon)).size(13).text_color(t.muted))))));
  }

  // A centered dim line with one accent link.
  line(id, text, link, t) {
    return h_flex().flex_none().flex_wrap().justify_center().gap(4).px(14).py(8).text_size(12)
      .child(div().text_color(t.dim).child(text))
      .when(Boolean(link), (el) => el.child(div().text_color(t.dim).child("·"))
        .child(div().id(`link-${id}`).text_color(t.accent).cursor_pointer().on_click((_e, cx) => link.go(cx)).child(link?.label ?? "")));
  }

  // A section: header (chevron, title, count), its rows (recent first,
  // folded to the recent ones), the fold row; `empty`: { text, link } instead of rows.
  section(title, devices, empty, c) {
    const { t, rail, pending, used } = c;
    const closed = this.folds.closed[title] === true, all = this.folds.all[title] === true;
    const sorted = sortRecent(devices, used), { shown, hidden } = foldRows(sorted, { all, pending });
    const canFold = foldRows(sorted, { pending }).hidden > 0;
    if (rail) return [div().mx(8).my(6).h(1).flex_none().bg(t.border), ...shown.map((d) => this.row(d, c))];
    const out = [h_flex().id(`sec-${title}`).h(26).flex_none().px(14).mt(4).gap(6).items_center().cursor_pointer()
      .on_click((_e, cx) => { this.fold("closed", title); cx.notify(); })
      .child(svg(`mods/files/chevron-${closed ? "right" : "down"}.svg`).size(12).flex_none().text_color(t.dim))
      .child(div().text_size(11).font_semibold().text_color(t.dim).child(title.toUpperCase()))
      .child(div().px(5).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(String(devices.length)))];
    if (closed) return out;
    if (empty) out.push(this.line(title, empty.text, empty.link, t));
    out.push(...shown.map((d) => this.row(d, c)));
    if (canFold) out.push(h_flex().id(`fold-${title}`).h(24).flex_none().mx(6).pl(23).items_center().rounded(6).cursor_pointer()
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
    const c = { t, rail, pending: shared("devices.pending") ?? {}, used: shared("devices.used") ?? {} };
    const body = [];
    if (!this.ios && !this.android) body.push(this.line("loading", "Loading devices…", null, t));
    if (this.ios) {
      const { sections, error } = this.ios;
      if (error) body.push(...this.section("iOS", [], { text: error, link: error === "xcrun not found" ? LINKS.xcode : { label: "Retry", go: (cx) => this.reload(cx, "ios", true) } }, c));
      else if (!sections.length) body.push(...this.section("iOS", [], { text: "No simulators", link: LINKS.openXcode }, c));
      for (const s of sections) body.push(...this.section(s.title, s.devices, null, c));
    }
    if (this.android) {
      const { devices, notes } = this.android;
      const missing = notes.some((n) => n.endsWith("not found"));
      const empty = notes.length ? { text: notes.join(" · "), link: missing ? LINKS.sdk : { label: "Retry", go: (cx) => this.reload(cx, "android", true) } }
        : devices.length ? null : { text: "No emulators or devices", link: LINKS.studio };
      body.push(...this.section("Android", devices, empty, c));
    }
    const sims = (this.ios?.sections ?? []).flatMap((s) => s.devices);
    const working = this.spinning > 0 || this.busy > 0;
    return v_flex().id("root").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13)
      .on_size_change((size, cx) => { this.width = size.width; cx.notify(); })
      .child(h_flex().h(42).flex_none().px(rail ? 0 : 14).gap(8).items_center().when(rail, (el) => el.justify_center()).border_b(1).border_color(t.border)
        .when(!rail, (el) => el.child(div().font_semibold().child("Devices")).child(div().flex_1()))
        .child(div().id("refresh").size(24).flex_none().flex().items_center().justify_center().rounded(6)
          .when(!working, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { forgetAvds(); this.reloadAll(cx, true); }))
          .child(working ? svg(SPINNER).size(14).text_color(t.muted).spin(900) : svg(icon("refresh")).size(14).text_color(t.muted))))
      .child(v_flex().id("devices-list").flex_1().min_h(0).pb(8).overflow_y_scrollbar().children(body))
      .when(!rail, (el) => el.child(h_flex().h(28).flex_none().px(14).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
        .child(div().min_w(0).truncate().child(footerText(sims, this.android?.devices ?? [], this.refreshedAt, Date.now())))));
  }
}

// The right-click menu. A popup's tasks end when it closes: Boot and Shut down
// go to the panel (the row spins) and it closes at once; anything else it
// finishes first ("Working…"), then closes.
class Menu {
  init(cx) {
    this.device = props().device;
    this.items = actionsFor(this.device);
    this.at = -1;
    this.busy = -1;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  choose(i, cx) {
    const a = this.items[i], { overlay } = props(), d = this.device;
    if (!a || this.busy >= 0) return;
    if (a.action === "copy") { copy(d, cx); closeOverlay(overlay); return; }
    if (a.action === "openurl" || a.action === "erase") { closeOverlay(overlay); openDialog(a.action === "openurl" ? "url" : "erase", d); return; }
    if (a.action === "boot" || a.action === "shutdown") { setShared("devices.request", { action: a.action, device: d, at: Date.now() }); closeOverlay(overlay); return; }
    this.busy = i;
    cx.spawn(async (cx) => { await perform(a.action, d); closeOverlay(overlay); cx.notify(); });
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
      .children(this.items.map((a, i) =>
        h_flex().id(`dm-${a.action}`).h(MENU_ROW).flex_none().px(8).gap(9).rounded(7).items_center().cursor_pointer()
          .text_color(a.danger ? t.ansi1 : t.foreground)
          .when(i === this.at || i === this.busy, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.choose(i, cx))
          .child(svg(icon(a.icon)).size(14).flex_none().text_color(a.danger ? t.ansi1 : t.muted))
          .child(div().flex_1().min_w(0).truncate().child(i === this.busy ? "Working…" : a.label))));
  }
}

// Open URL and Erase. Styled like Herdr's prompt and confirm; the action's
// error closes nothing (it is also toasted).
class Dialog {
  init(cx) {
    const { role, device } = props();
    this.role = role;
    this.device = device;
    this.error = null;
    this.busy = false;
    this.handle = cx.focus_handle();
    if (role === "url") {
      this.input = InputState.new({ placeholder: "https://… or myapp://…" });
      this.input.on("change", (_e, cx) => { this.error = null; cx.notify(); });
      this.input.on("submit", (_e, cx) => this.confirm(cx));
      this.input.focus();
      cx.timer.after(600, () => this.input.focus());
    } else this.handle.focus();
  }

  confirm(cx) {
    if (this.busy) return;
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

  render() {
    const t = theme(), d = this.device, erase = this.role === "erase";
    const detail = !erase
      ? `Opens it on ${d.name}${d.kind === "sim" ? " (xcrun simctl openurl)" : " (am start -a android.intent.action.VIEW)"}.`
      : d.kind === "sim"
        ? `Shuts it down and resets it to factory state: every app and its data goes. ${d.name} stays in the list.`
        : `Deletes its snapshots/, then boots it once without a window with the emulator's -wipe-data and stops it. It starts like a new device.`;
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1()
      .border_color(primary ? (erase ? t.ansi1 : t.solid) : t.input).bg(primary ? (erase ? t.ansi1 : t.solid) : t.raised)
      .text_color(primary ? (erase ? t.background : t.solid_foreground) : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("devices-dialog").track_focus(this.handle).size_full().min_h(0).p(18).gap(10).bg(t.popover).text_size(13).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(props().overlay);
        else if (e.key === "enter" && erase) this.confirm(cx);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child(erase ? `Erase ${d.name}?` : "Open URL"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().text_color(t.muted).child(detail))
      .when(!erase, (el) => el.child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(t.accent).bg(t.background).text_size(12.8).text_color(t.foreground)))
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(t.ansi1).child(this.error ?? "")))
      .child(div().flex_1())
      .child(h_flex().gap(8).justify_end()
        .child(button("dd-cancel", "Cancel", false, () => closeOverlay(props().overlay)))
        .child(button("dd-ok", this.busy ? "Working…" : erase ? "Erase" : "Open", true, (_e, cx) => this.confirm(cx))));
  }
}

export default class Devices extends View {
  init(_props, cx) {
    const role = props()?.role;
    this.part = role === "menu" ? new Menu() : role === "url" || role === "erase" ? new Dialog() : new Panel();
    this.part.init(cx);
  }

  render(cx) { return this.part.render(cx); }
}
