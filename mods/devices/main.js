// Devices: iOS simulators and Android emulators/devices, with actions.
// One mod, four roles (props.role): none, the panel; over the window "menu"
// (the right-click popup), "url" and "erase" (dialogs). Mod commands carry no
// arguments, so the overlays run their action themselves and the panel
// reloads on the shared "devices.changed".
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, theme, shared, openOverlay, closeOverlay, notify } from "herdr";
import { actionsFor, validUrl } from "./devices.js";
import { load, perform } from "./actions.js";

const icon = (name) => `mods/devices/icons/${name}.svg`;
const SPINNER = "mods/workspace-chrome/spinner.svg";
const MENU_ROW = 30;

function copy(d, cx) {
  cx.write_to_clipboard(d.id);
  notify({ level: "success", title: "Copied", body: d.id, timeout: 2000 });
}

function openDialog(role, d) {
  openOverlay({ mod: "devices", kind: "dialog", width: 420, height: role === "url" ? 200 : 190, props: { role, device: d } });
}

class Panel {
  init(cx) {
    this.data = null;
    this.busy = 0;
    this.hovered = null;
    this.width = 0;
    this.seen = shared("devices.changed");
    this.reload(cx);
    // Timers run while hidden too, so no faster than this.
    cx.timer.every(5000, (cx) => this.reload(cx));
  }

  // A reload asked for during one runs right after it, so an action's result
  // isn't lost to the timer's read in flight.
  reload(cx) {
    if (this.loading) { this.again = true; return; }
    this.loading = true;
    cx.spawn(async (cx) => {
      try { do { this.again = false; this.data = await load(); } while (this.again); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  act(a, d, cx) {
    if (a.action === "copy") return copy(d, cx);
    if (a.action === "openurl" || a.action === "erase") return openDialog(a.action === "openurl" ? "url" : "erase", d);
    this.busy++;
    cx.spawn(async (cx) => {
      try { await perform(a.action, d); }
      finally { this.busy--; cx.notify(); }
    });
    cx.notify();
  }

  menu(d) {
    const items = actionsFor(d);
    openOverlay({ mod: "devices", kind: "popup", width: 210, height: items.length * MENU_ROW + 38, props: { role: "menu", device: d } });
  }

  row(d, t) {
    const key = `${d.kind}:${d.id}`;
    const dot = d.state === "on" ? t.done : d.state === "off" ? t.dim : t.blocked;
    const showActions = this.hovered === key && this.width >= 200 && this.busy === 0;
    return h_flex().id(`row-${key}`).h(30).flex_none().mx(6).px(8).gap(8).items_center().rounded(7)
      .hover((s) => s.bg(t.hover))
      .on_hover((on, cx) => { this.hovered = on ? key : this.hovered === key ? null : this.hovered; cx.notify(); })
      .on_mouse_down("right", (_e, cx) => { this.menu(d); cx.stop_propagation(); })
      .child(div().size(7).flex_none().rounded(4).bg(dot))
      .child(div().flex_1().min_w(0).truncate().text_color(d.state === "off" ? t.muted : t.foreground).child(d.name))
      .when(d.state !== "on" && d.state !== "off" && !showActions, (el) => el.child(div().flex_none().text_size(11).text_color(t.blocked).child(d.state)))
      .when(showActions, (el) => el.children(actionsFor(d).map((a) =>
        div().id(`b-${a.action}-${key}`).size(22).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
          .hover((s) => s.bg(t.raised))
          .on_click((_e, cx) => this.act(a, d, cx))
          .child(svg(icon(a.icon)).size(13).text_color(a.danger ? t.ansi1 : t.muted)))));
  }

  section(title, t) {
    return div().px(14).pt(12).pb(4).flex_none().text_size(11).font_semibold().text_color(t.dim).child(title);
  }

  line(text, t) {
    return div().px(14).py(4).flex_none().text_size(12).text_color(t.dim).child(text);
  }

  render(cx) {
    const changed = shared("devices.changed");
    if (changed !== this.seen) { this.seen = changed; this.reload(cx); }
    const t = theme(), data = this.data;
    const body = [];
    if (!data) body.push(this.line("Loading devices…", t));
    else {
      const { ios, android } = data;
      if (ios.error) body.push(this.section("iOS", t), this.line(ios.error, t));
      else if (!ios.sections.length) body.push(this.section("iOS", t), this.line("No simulators installed", t));
      for (const s of ios.sections) body.push(this.section(s.title, t), ...s.devices.map((d) => this.row(d, t)));
      body.push(this.section("Android", t), ...android.notes.map((n) => this.line(n, t)), ...android.devices.map((d) => this.row(d, t)));
      if (!android.devices.length && !android.notes.length) body.push(this.line("No emulators or devices", t));
    }
    return v_flex().id("root").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13)
      .on_size_change((size, cx) => { this.width = size.width; cx.notify(); })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Devices"))
        .child(div().flex_1())
        .when(this.busy > 0 || this.loading === true, (el) => el.child(svg(SPINNER).size(14).flex_none().text_color(t.muted).spin(900)))
        .child(div().id("refresh").size(24).flex().items_center().justify_center().rounded(6).cursor_pointer()
          .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.reload(cx))
          .child(svg(icon("refresh")).size(14).text_color(t.muted))))
      .child(v_flex().id("devices-list").flex_1().min_h(0).pb(8).overflow_y_scrollbar().children(body));
  }
}

// The right-click menu. A popup's tasks end when it closes, so it finishes
// its command first ("Working…"), then closes.
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
        : `Deletes its user data and snapshots (userdata-qemu.img*, snapshots/). The next boot starts like a new device.`;
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
