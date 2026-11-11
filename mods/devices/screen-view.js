// The screen view: one device's screen, live in the panel, taking clicks, drags, the wheel and
// keys. iOS simulators stream through serve-sim (MJPEG frames, input over its socket); Android
// emulators through android-stream.mjs (the emulator's gRPC frames) with input over
// `adb shell input`. Without a stream (no Node, a phone) it falls back to a screenshot about
// once a second. The pure half is screen.js. After Robert Soriano's herdr-sim (MIT),
// https://github.com/wobsoriano/herdr-sim.
import { div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as herdr from "herdr";
import net from "net";
import { WebSocket } from "websocket";
import { exists, mkdir, readFile, writeFile } from "fs/promises";
import * as S from "./screen.js";
import { adbPath } from "./actions.js";

const { exec, home, props } = herdr;
// Newer than the rest of what the mod uses: fall back rather than fail to load.
const appHome = () => herdr.appHome?.() ?? `${home()}/.config/herdr-app`;
const icon = (name) => `mods/devices/icons/${name}.svg`;
const SPINNER = "mods/workspace-chrome/spinner.svg";
const HEADER = 42, TOOLBAR = 28, BEZEL = 8, PAD = 10, MODE = 18;
const LINE = 20; // pixels per line, for a wheel that reports lines
const POLL_MS = 500; // a screenshot view starts its next one this long after the last began

// Frame-file sets taken by open views. globalThis is shared by every copy and starts empty when Herdr does.
const views = (globalThis.__herdrDevicesViews ??= new Set());

const HOLDER = `// Holds the frames the Devices mod's screen view writes. It shows nothing.
import { View, div } from "gpui-kit";

export default class DevicesScreen extends View {
  render() { return div(); }
}
`;

const sleep = (cx, ms) => new Promise((resolve) => cx.timer.after(ms, () => resolve()));
const run = (argv, options) => exec(argv[0], argv.slice(1), options);

// The first npx run downloads serve-sim, so it gets two minutes (ignored by a Herdr without exec timeouts).
async function serveSim(args) {
  const r = await run(S.serveSimArgv(args), { timeout: 120000 });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").pop() || "serve-sim failed");
  return S.serveSimJson(r.stdout);
}

// One /ws connection to a simulator's serve-sim helper. Points are 0..1 of the screen.
class SimInput {
  constructor(at) {
    this.at = at;
    this.socket = null;
    this.closed = false;
    this.queue = Promise.resolve();
    this.send(null);
  }

  // Writes go out one at a time, in order; a dropped socket reconnects once. Input is
  // fire-and-forget, so a failure is logged rather than thrown.
  send(tag, body) {
    this.queue = this.queue.then(() => this.write(tag == null ? null : S.wsFrame(tag, body), true)).catch((e) => console.log(`devices: serve-sim input: ${e?.message ?? e}`));
    return this.queue;
  }

  async write(bytes, retry) {
    if (this.closed) return;
    try {
      if (!this.socket) {
        const socket = await WebSocket.connect(this.at.ws);
        if (this.closed) return void socket.close();
        this.socket = socket;
      }
      if (bytes) await this.socket.write(bytes);
    } catch (e) {
      this.socket = null;
      if (!retry) throw e;
      await this.write(bytes, false);
    }
  }

  close() { this.closed = true; this.socket?.close(); this.socket = null; }
  // A gesture keeps the edge its first touch had.
  touch(type, p, edge = 0) { return this.send(S.TAG.touch, edge ? { type, x: p.x, y: p.y, edge } : { type, x: p.x, y: p.y }); }
  button(button) { return this.send(S.TAG.button, { button }); }
  hid(page, usage) { return this.send(S.TAG.button, { button: "hid", page, usage, phase: "press" }); }
  key(type, usage) { return this.send(S.TAG.key, { type, usage }); }
  scroll(dx, dy, p) { return this.send(S.TAG.scroll, { dx, dy, x: p.x, y: p.y }); }
  softwareKeyboard() { return this.send(S.TAG.keyboard); }
  async rotate() {
    const config = await (await fetch(`${this.at.base}/config`)).json();
    return this.send(S.TAG.rotate, { orientation: S.ROTATE[config.orientation] ?? "portrait" });
  }
}

// The same surface over `adb shell input`. `size()`: the screen in pixels, as it is turned now.
class AdbInput {
  constructor(shell, size) {
    this.shell = shell;
    this.size = size;
    this.queue = Promise.resolve();
    this.move = null;
    this.held = new Set();
  }

  // Commands run one at a time, in order.
  run(words) {
    if (!words) return this.queue;
    this.queue = this.queue.then(() => this.shell(typeof words === "function" ? words() : words)).catch((e) => console.log(`devices: adb input: ${e?.message ?? e}`));
    return this.queue;
  }

  // Moves that pile up behind a slow command collapse into the latest one.
  touch(type, p) {
    // A move still waiting goes out before the lift, so a quick drag keeps its direction.
    if (type !== "move") { if (type === "begin") this.move = null; return this.run(S.androidInput.touch(type, p, this.size())); }
    const queued = this.move != null;
    this.move = p;
    if (queued) return this.queue;
    this.queue = this.queue.then(() => {
      const at = this.move;
      this.move = null;
      return at && this.shell(S.androidInput.touch("move", at, this.size()));
    }).catch(() => null);
    return this.queue;
  }

  key(type, usage) {
    if (S.isModifier(usage)) return void (type === "down" ? this.held.add(usage) : this.held.delete(usage));
    if (type === "down") return this.run(S.androidInput.key(usage, this.held.has(S.SHIFT)));
  }

  button(name) { return this.run(S.androidInput.button(name)); }
  hid(_page, usage) { return this.run(S.androidInput.volume(usage)); }
  scroll(dx, dy, p) { return this.run(S.androidInput.scroll(dx, dy, p, this.size())); }
  rotate() { return this.run(S.androidInput.rotate()); }
  close() {}
}

export class ScreenView {
  // `handle`: the panel's focus handle, which the keys arrive through. `lookup(key)`: the
  // device's row as the panel last read it, or null once it is gone.
  constructor(handle, lookup) {
    this.handle = handle;
    this.lookup = lookup;
    this.key = null; // the shown device's key; null while the list shows
    this.name = "";
    this.runId = 0; // bumped by every open and back: a loop of an older one stops
    this.phase = { kind: "starting" };
    this.session = null;
    this.socket = null;
    this.touch = null; // the pressed point of the gesture in progress
    this.keys = new Map(); // held key usage -> the modifier usages pressed with it
    this.aspect = 1206 / 2622;
    this.view = null; // this copy's frame files, taken at the first open
    this.frames = [];
    this.stack = []; // indexes into frames, bottom to top; the last is on show
    this.next = 0;
    const panel = props()?.panel;
    this.block = panel === true ? "devices" : typeof panel === "string" ? panel : null;
  }

  get open() { return this.key != null; }

  show(d, key, cx) {
    this.drop();
    if (!this.view) {
      this.view = S.freeSlot(views);
      views.add(this.view);
      this.frames = S.frameFiles(this.view);
      this.stack = this.frames.map((_, i) => i);
    }
    this.key = key;
    this.name = d.name;
    this.phase = { kind: "starting" };
    const id = ++this.runId;
    cx.spawn((cx) => this.loop(id, cx));
    cx.notify();
  }

  back(cx) {
    this.key = null;
    this.runId++;
    this.drop();
    cx.notify();
  }

  // Called when the copy goes: its frame files are free for the next view.
  close() {
    this.runId++;
    this.key = null;
    if (this.view) views.delete(this.view);
    this.drop();
  }

  // Lets go of the stream and the input, and stops a serve-sim helper this view started.
  drop() {
    const s = this.session;
    this.session = null;
    this.touch = null;
    this.keys.clear();
    this.socket?.close();
    this.socket = null;
    if (!s) return;
    s.input?.close();
    if (s.owned) serveSim(["--kill", s.device.id]).catch(() => null);
  }

  set(phase, cx) {
    this.phase = phase;
    if (phase.kind !== "live") { this.touch = null; this.keys.clear(); }
    cx.notify();
  }

  hidden() { return S.panelHidden(herdr.layout?.(), this.block); }

  // The frames' folder is its own mod. Made here when the install copied only mods/devices.
  async ready() {
    const dir = `${appHome()}/mods/${S.SCREEN_MOD}`;
    if (await exists(`${dir}/main.js`).catch(() => false)) return;
    await mkdir(dir, { recursive: true }).catch(() => null);
    await writeFile(`${dir}/mod.json`, '{ "place": "none", "title": "Devices screen" }\n');
    await writeFile(`${dir}/main.js`, HOLDER);
  }

  async start(d) {
    if (d.kind === "sim") {
      try {
        const running = S.runningHelper(await serveSim(["--list", "-q", d.id]), d.id);
        const at = S.helperAddress((running ?? (await serveSim(["--detach", "-q", d.id]))).streamUrl);
        if (!at) throw new Error("serve-sim gave no stream address");
        return { device: d, mode: "stream", ...at, owned: !running, input: new SimInput(at) };
      } catch (e) {
        console.log(`devices: serve-sim: ${e?.message ?? e}`);
        return { device: d, mode: "poll", input: null, why: "serve-sim didn't start: it needs Node" };
      }
    }
    const adb = await adbPath();
    if (!adb) throw new Error("adb not found");
    const shell = (words) => exec(adb, ["-s", d.serial, "shell", ...words]);
    const physical = S.parseWmSize((await shell(["wm", "size"]).catch(() => null))?.stdout) ?? { width: 1080, height: 2400 };
    const input = new AdbInput(shell, () => S.turned(physical, this.aspect));
    const helper = S.helperArgv(`${appHome()}/mods/devices/android-stream.mjs`, d.serial);
    if (helper && (await run(helper).catch(() => null))?.code === 0) return { device: d, mode: "stream", host: "127.0.0.1", port: S.streamPort(d.serial).port, path: "/stream", input };
    return { device: d, mode: "poll", adb, input, why: helper ? "the frame helper didn't start: it needs Node" : null };
  }

  async loop(id, cx) {
    const mine = () => this.runId === id;
    let paused = false;
    while (mine()) {
      try {
        if (this.hidden()) {
          // The emulator's helper exits once nothing watches, so its session starts again on return.
          if (!paused && this.session?.device.kind !== "sim") this.drop();
          this.socket?.close();
          paused = true;
          if (this.phase.kind !== "hidden") this.set({ kind: "hidden" }, cx);
          await sleep(cx, 500);
          continue;
        }
        paused = false;
        const d = this.lookup(this.key);
        if (!d || !S.canShow(d)) {
          this.drop();
          if (this.phase.kind !== "off") this.set({ kind: "off" }, cx);
          await sleep(cx, 1000);
          continue;
        }
        this.name = d.name;
        // An emulator that came back has another serial.
        if (this.session && this.session.device.serial !== d.serial) this.drop();
        if (!this.session) {
          this.set({ kind: "starting" }, cx);
          await this.ready();
          const session = await this.start(d);
          // Gone back while it started: the helper this start made would otherwise stay running.
          if (!mine()) {
            session.input?.close();
            if (session.owned && this.session?.device.id !== session.device.id) serveSim(["--kill", session.device.id]).catch(() => null);
            return;
          }
          this.session = session;
          cx.notify();
        }
        if (this.session.mode === "stream") await this.stream(id, cx);
        else await this.poll(id, cx);
        if (mine()) await sleep(cx, 300); // the stream ended: connect again, or fail and start over
      } catch (e) {
        if (!mine()) return;
        this.drop();
        this.set({ kind: "error", message: S.shortReason(e) }, cx);
        await sleep(cx, 5000);
      }
    }
  }

  async stream(id, cx) {
    const { host, port, path } = this.session;
    const socket = await net.connect(host, port);
    if (this.runId !== id) return void socket.close();
    this.socket = socket;
    try {
      await socket.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\n\r\n`);
      const body = new S.HttpBody(), parts = new S.Multipart();
      let due = 0;
      read: for (;;) {
        // A read on a socket closed here (back, another device) ends the stream like EOF.
        const chunk = await socket.read(1 << 16).catch(() => null);
        if (chunk == null || this.runId !== id) break;
        for (const piece of body.push(chunk)) {
          parts.push(piece);
          for (let part; (part = parts.take()) !== undefined; ) {
            if (!part) continue;
            const next = S.nextDue(due, Date.now());
            if (next == null) continue;
            if (this.hidden()) break read;
            due = next;
            await this.frame(part.slice(), id, cx);
            if (this.runId !== id) break read;
          }
        }
        if (body.done) break;
      }
    } finally {
      socket.close();
      if (this.socket === socket) this.socket = null;
    }
  }

  // Writes a frame to the next file of the ring; it goes on show once Herdr has reloaded it.
  async frame(bytes, id, cx) {
    this.aspect = S.imageAspect(bytes) ?? this.aspect;
    const slot = this.next;
    this.next = (slot + 1) % S.RING;
    await writeFile(`${appHome()}/${this.frames[slot]}`, bytes);
    cx.timer.after(S.RELOAD_MS, (cx) => this.promote(slot, id, cx));
  }

  promote(slot, id, cx) {
    if (this.runId !== id) return;
    this.stack = [...this.stack.filter((i) => i !== slot), slot];
    if (this.phase.kind !== "live") this.phase = { kind: "live" };
    cx.notify();
  }

  // No stream: the device's own screenshot, written straight into the ring.
  async poll(id, cx) {
    const { device, adb } = this.session;
    for (let n = 0; this.runId === id && !this.hidden(); n++) {
      const began = Date.now(), slot = this.next, path = `${appHome()}/${this.frames[slot]}`;
      this.next = (slot + 1) % S.RING;
      const r = await run(S.shotArgv(device, path, adb));
      if (this.runId !== id) return;
      if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || "the screenshot failed");
      // The size is read from the file now and then: it only changes when the device turns.
      if (n % 5 === 0) this.aspect = S.imageAspect((await readFile(path).catch(() => null)) ?? []) ?? this.aspect;
      cx.timer.after(S.RELOAD_MS, (cx) => this.promote(slot, id, cx));
      await sleep(cx, Math.max(50, POLL_MS - (Date.now() - began)));
    }
  }

  // Ends the gesture where the pointer let go, or where it last was.
  lift(p) {
    const touch = this.touch;
    if (!touch) return;
    this.touch = null;
    this.session?.input?.touch("end", p ?? touch, touch.edge);
  }

  keyDown(e, cx) {
    const input = this.phase.kind === "live" ? this.session?.input : null, k = input && S.keyUsages(e);
    if (!k) return;
    cx.stop_propagation();
    // A held key repeats here; iOS repeats it on its own.
    if (this.keys.has(k.usage)) { if (this.session.device.kind !== "sim") input.key("down", k.usage); return; }
    this.keys.set(k.usage, k.modifiers);
    for (const m of k.modifiers) input.key("down", m);
    input.key("down", k.usage);
  }

  keyUp(e, cx) {
    const input = this.session?.input, k = input && S.keyUsages(e), modifiers = k && this.keys.get(k.usage);
    if (!modifiers) return;
    cx.stop_propagation();
    this.keys.delete(k.usage);
    input.key("up", k.usage);
    for (const m of [...modifiers].reverse()) input.key("up", m);
  }

  tool(b, t, live) {
    const input = this.session?.input, on = live && Boolean(input);
    return h_flex().id(`tool-${b.id}`).size(TOOLBAR - 2).flex_none().items_center().justify_center().rounded(6).tooltip(b.tip)
      .when(on, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { const [method, ...args] = b.press; cx.spawn(async () => { try { await input[method](...args); } catch {} }); }))
      .when(!on, (el) => el.opacity(0.4))
      .child(svg(icon(b.icon)).size(14).text_color(t.muted));
  }

  // Press, drag and release are one finger; the wheel scrolls.
  picture(w, h, radius) {
    return div().id("screen").relative().w(w).h(h)
      .children(this.stack.map((i) => image(this.frames[i]).absolute().top(0).left(0).w(w).h(h).rounded(radius)))
      .on_mouse_down("left", (e, cx) => {
        this.handle.focus();
        cx.stop_propagation();
        const p = S.fraction(e), input = this.session?.input;
        if (!p || !input) return;
        this.touch = { ...p, edge: S.touchEdge(p) };
        input.touch("begin", p, this.touch.edge);
      })
      .on_mouse_move((e) => {
        const p = S.fraction(e);
        if (!this.touch || !p) return;
        Object.assign(this.touch, p);
        this.session?.input?.touch("move", p, this.touch.edge);
      })
      .on_mouse_up("left", (e) => this.lift(S.fraction(e)))
      // The pointer left with the button down: there is no capture, so the finger lifts where it was.
      .on_hover((hovered) => { if (!hovered) this.lift(null); })
      .on_scroll_wheel((e) => {
        const p = S.fraction(e), input = this.session?.input;
        if (!p || !input) return;
        const d = e.delta_lines ? { x: e.delta_lines.x * LINE, y: e.delta_lines.y * LINE } : e.delta;
        if (d) input.scroll(-d.x / e.bounds.width, -d.y / e.bounds.height, p);
      });
  }

  // The panel's content while a screen shows: the header with Back, the toolbar, the device.
  render(t, width, height) {
    const d = this.lookup(this.key), live = this.phase.kind === "live", note = S.screenNote(this.phase, this.name);
    const mode = live ? S.modeLine(this.session) : null;
    const fit = S.fitScreen(this.aspect, width - 2 - 2 * PAD - 2 * BEZEL - 2, height - 2 - HEADER - TOOLBAR - 3 * PAD - 2 * BEZEL - 2 - (mode ? MODE + PAD : 0));
    const screen = note == null ? this.picture(fit.w, fit.h, fit.radius)
      : v_flex().w(fit.w).h(fit.h).rounded(fit.radius).bg("#000000").items_center().justify_center().gap(10).p(16)
        .when(this.phase.kind === "starting", (el) => el.child(svg(SPINNER).size(14).text_color("#8e8e93").spin(900)))
        .child(div().text_size(12).text_color("#8e8e93").text_center().child(note));
    return [
      h_flex().h(HEADER).flex_none().px(8).gap(6).items_center().border_b(1).border_color(t.border)
        .child(div().id("screen-back").size(24).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
          .tooltip("Back to the devices").on_click((_e, cx) => this.back(cx))
          .child(svg(icon("chevron-left")).size(15).text_color(t.muted)))
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(this.name))
        .child(div().size(7).flex_none().mr(6).rounded(4).bg(live ? t.done : this.phase.kind === "error" ? t.blocked : t.dim)),
      v_flex().id("screen-body").flex_1().min_h(0).p(PAD).gap(PAD).items_center().on_click(() => this.handle.focus())
        .child(h_flex().h(TOOLBAR).w_full().flex_none().items_center().justify_center().gap(2).children(d ? S.toolsFor(d).map((b) => this.tool(b, t, live)) : []))
        .child(v_flex().flex_1().min_h(0).items_center().justify_center()
          .child(div().flex_none().p(BEZEL).rounded(fit.radius + BEZEL).bg("#1c1c1e").border(1).border_color("#3a3a3c").child(screen)))
        .when(Boolean(mode), (el) => el.child(div().h(MODE).flex_none().max_w(width - 2 * PAD).truncate().text_size(11).text_color(t.dim).child(mode ?? ""))),
    ];
  }
}
