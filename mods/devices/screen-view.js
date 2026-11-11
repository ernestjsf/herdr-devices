// A device's screen where the panel was. Show screen starts the viewer (screen-term.mjs) in a
// terminal of its own and edits the layout file: the panel's block becomes a column, this mod
// again as a bar (Back, the name, the device's buttons) over that terminal. Back, or the viewer
// ending, turns the column back into the block. The terminal draws the picture and takes the
// mouse and the keys itself; the bar's buttons reach it over a local port. Under the name the bar
// shows who holds or drives the device, as its row does.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as herdr from "herdr";
import net from "net";
import * as S from "./screen.js";
import { adbPath, perform, readPs, claimsDir, readClaims, dropClaims } from "./actions.js";
import { claimId, staleClaims, claimHolders, driversFrom, deviceDrivers, deviceTags } from "./devices.js";
import { agentTag } from "./tag.js";

const { hc, home, props, shared, notify, run, readTextFile, writeTextFile, theme, watchFolder, terminals, agents } = herdr;
// Newer than the rest of what the mod uses: fall back rather than fail to load.
const appHome = () => herdr.appHome?.() ?? `${home()}/.config/herdr-app`;
const MOD = "devices";
const icon = (name) => `mods/${MOD}/icons/${name}.svg`;
const sleep = (cx, ms) => new Promise((resolve) => cx.timer.after(ms, () => resolve()));

// Rewrites the shown layout's file through `change` (the tree, or null for nothing to do). The
// write only lands on the text that was read, so it is tried twice. True when it landed.
async function editLayout(change) {
  const path = `${appHome()}/layouts/${shared("layout")}.json`;
  for (let i = 0; i < 2; i++) {
    const text = await readTextFile(path).catch(() => null);
    if (text == null) return false;
    let next;
    try { next = change(JSON.parse(text)); } catch { return false; }
    if (!next) return false;
    try { await writeTextFile(path, `${JSON.stringify(next, null, 2)}\n`, text); return true; } catch {}
  }
  return false;
}

// Where this mod stands in the shown layout: "block" (a screen can take its place), "screen"
// (one already has), or "pane" (it isn't in the layout file: a pane in a tab).
async function placement() {
  const text = await readTextFile(`${appHome()}/layouts/${shared("layout")}.json`).catch(() => null);
  let tree = null;
  try { tree = JSON.parse(text); } catch {}
  return !tree ? "pane" : S.wrapScreen(tree, MOD, "t0", {}) ? "block" : S.unwrapScreen(tree, MOD) ? "screen" : "pane";
}

// Starts the viewer for `d` and puts it where the panel is. A copy that isn't a block of the
// layout (a pane in a tab) gets the viewer as a pane beside it, without the bar.
export async function showScreen(d) {
  const failed = (body) => notify({ level: "error", title: `Couldn't show ${d.name}`, body });
  const place = await placement();
  if (place === "screen") return; // a second press while the first is taking the panel's place
  const adb = d.kind === "sim" ? "" : await adbPath();
  if (d.kind !== "sim" && !adb) return failed("adb not found");
  const port = 27400 + Math.floor(Math.random() * 500);
  const argv = S.viewerArgv(`${appHome()}/mods/${MOD}/screen-term.mjs`, d, port, adb);
  const started = await hc(["run", "--json", "--bg", "--no-parent", "--rm", "--", ...argv]).catch((e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
  let terminal = null;
  try { terminal = JSON.parse(started.stdout).address; } catch {}
  if (!terminal) return failed((started.stderr || started.stdout).trim().split("\n").pop() || "the viewer didn't start");
  const screen = { device: { kind: d.kind, id: d.id, serial: d.serial, avd: d.avd, name: d.name }, terminal, port };
  if (place === "pane") return void run("terminal.keep", { terminal, place: "right" });
  if (!(await editLayout((tree) => S.wrapScreen(tree, MOD, terminal, screen)))) { await hc(["kill", terminal]).catch(() => null); failed("the layout file couldn't be changed"); }
}

const restore = (terminal) => editLayout((tree) => S.unwrapScreen(tree, MOD, terminal));

// The bar over the viewer: this mod's copy while its props carry `screen`.
export class ScreenBar {
  init(cx) {
    const { device, terminal, port } = props().screen;
    Object.assign(this, { device, terminal, port, leaving: false, tags: [], cpu: {}, reading: false });
    // Who holds or drives it: read now, when the claims folder changes, and every 5 s (the
    // drivers, the holder's liveness and the idle text have no event).
    cx.spawn(async (cx) => { try { for (;;) { await this.who(cx); await watchFolder(claimsDir()); } } catch {} });
    cx.timer.every(5000, (cx) => cx.spawn((cx) => this.who(cx)));
    // The viewer ended by itself (Ctrl-C, the device went off): the panel comes back.
    cx.spawn(async (cx) => {
      for (;;) {
        await sleep(cx, 2000);
        if (this.leaving) return;
        const r = await hc(["get", this.terminal, "--json"]).catch(() => ({ code: 1, stdout: "" }));
        let live = false;
        try { live = r.code === 0 && JSON.parse(r.stdout).state === "live"; } catch {}
        if (!live) { this.leaving = true; await restore(this.terminal); return; }
      }
    });
  }

  // The device's tags (deviceTags), read the way the panel reads them. The panel isn't there while
  // a screen is shown, so claims whose holder is gone are dropped here too.
  async who(cx) {
    if (this.reading) return;
    this.reading = true;
    try {
      let claims = await readClaims();
      const rows = await readPs(), stale = staleClaims(claims, rows);
      if (stale.length) { await dropClaims(stale, claims); claims = await readClaims(); }
      const live = terminals(), all = agents(), claim = claims[claimId(this.device)];
      let drivers;
      ({ drivers, cpu: this.cpu } = driversFrom(rows, live, this.cpu));
      this.tags = deviceTags(claim, deviceDrivers(this.device, drivers, live, all), all, live, { holder: claimHolders(claims, rows, live)[claim?.pid] ?? null, now: Date.now() });
      cx.notify();
    } catch {} finally { this.reading = false; }
  }

  // One line to the viewer's port: a tool's id, or quit.
  async send(line) {
    const socket = await net.connect("127.0.0.1", this.port);
    try { await socket.write(`${line}\n`); } finally { socket.close(); }
  }

  // The viewer stops its helper and ends; if it can't be reached its terminal is ended instead.
  async back() {
    if (this.leaving) return;
    this.leaving = true;
    await this.send("quit").catch(() => hc(["kill", this.terminal]).catch(() => null));
    await restore(this.terminal);
  }

  button(id, name, tip, t, press) {
    return div().id(id).size(24).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
      .tooltip(tip).on_click((_e, cx) => { cx.stop_propagation(); cx.spawn(async () => { try { await press(); } catch {} }); })
      .child(svg(icon(name)).size(name === "chevron-left" ? 15 : 14).text_color(t.muted));
  }

  render() {
    const t = theme();
    return h_flex().id("screen-bar").size_full().px(8).gap(2).items_center().bg(t.background).border_b(1).border_color(t.border).text_color(t.foreground).text_size(13)
      .child(this.button("screen-back", "chevron-left", "Back to the devices", t, () => this.back()))
      .child(v_flex().flex_1().min_w(0).ml(4).mr(4)
        .child(div().truncate().font_semibold().child(this.device.name))
        .when(this.tags.length > 0, (el) => el.child(h_flex().h(16).gap(4).overflow_hidden()
          .children(this.tags.map((g, i) => agentTag(g, `who-${i}`, t, 200, (cx) => cx.spawn(async (cx) => { await perform("release", this.device); await this.who(cx); })))))))
      .children(S.toolsFor(this.device).map((b) => this.button(`tool-${b.id}`, b.icon, b.tip, t, () => this.send(b.id))));
  }
}
