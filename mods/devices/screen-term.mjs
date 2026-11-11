// A device's screen in a terminal, drawn with the Kitty graphics protocol, which a Herdr terminal
// speaks. Frames go straight from the device to the terminal: no image file, so none of the
// ~200 ms Herdr takes to reload one. The Devices mod puts this terminal where its panel was
// (screen-view.js). Run by node, not by Herdr.
// usage: node screen-term.mjs sim <udid> <name> <port>
//        node screen-term.mjs android <serial> <name> <port> <adb>
// <port>: where it listens for the bar's buttons, one line each: a tool's id (screen.js), or quit.
//
// A simulator's frames are full-size JPEGs, which a terminal can't draw, so frame-scale.swift
// turns each into raw pixels at the size shown. While the screen moves they are drawn small (fast
// to scale and send); once it rests, the last one is drawn again at the pane's full sharpness.
// An emulator's frames are PNGs at the width asked for, drawn as they come.
import { spawn, execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import zlib from "node:zlib";
import * as S from "./screen.js";

const [, , kind, id, name = "Device", port, adb = "adb"] = process.argv;
if (!id || (kind !== "sim" && kind !== "android")) { console.error("usage: screen-term.mjs sim|android <id> <name> <port> [adb]"); process.exit(2); }

const here = dirname(fileURLToPath(import.meta.url));
const cache = join(homedir(), ".cache", "herdr-devices");
// A log for when something is off: set HERDR_DEVICES_DEBUG, or make the file ~/.cache/herdr-devices/debug.
const debugOn = Boolean(process.env.HERDR_DEVICES_DEBUG) || existsSync(join(cache, "debug"));
const debug = debugOn ? (line) => appendFileSync(join(cache, "screen-term.log"), `${new Date().toISOString()} ${line}\n`) : () => {};
debug.on = debugOn;
const out = (s) => process.stdout.write(s);
const run = (argv, options = {}) => new Promise((resolve) => execFile(argv[0], argv.slice(1), { timeout: 120000, ...options }, (err, stdout, stderr) => resolve({ code: err ? 1 : 0, stdout, stderr })));
const clamp = (v) => Math.min(1, Math.max(0, v));

// The longest side, in pixels, of a simulator frame drawn while the screen moves. A quarter of
// the device's own size is the cheapest for the JPEG decoder; measured on a 1206x2622 frame, 600
// costs ~23 ms a frame end to end (scale 10, deflate 5, the terminal 8), 1100 ~72 ms.
// HERDR_DEVICES_MOVING_SIDE trades delay for sharpness in motion.
const MOVING_SIDE = Number(process.env.HERDR_DEVICES_MOVING_SIDE) || 656;
// This long without a new frame, and no finger down, and the screen counts as resting. A sharp
// picture is several megabytes: compressing it and pushing it through the terminal holds up the
// moving frames behind it (measured: gaps of 200 to 900 ms when it was drawn at every short
// pause), so it is drawn late, never mid-gesture, and compressed off the main thread.
const REST_MS = 350;
const IMAGES = [7301, 7302]; // two ids: the new frame goes up before the old one comes down

// ---- the terminal ----

// A terminal cell in the pixels the mouse is reported in. The width comes from the app's font
// size (a monospace cell is 0.6 of it; Herdr's own answer rounds it, 9 for 8.4). The height
// starts as Herdr's usual 18/14 of the font size and is corrected by the terminal's answer to
// CSI 16 t, asked at the start and after every resize. HERDR_DEVICES_CELL=<w>x<h> (pixels) overrides.
const DPR = Number(process.env.HERDR_DEVICES_DPR) || 2; // pixels per point: a Retina display
const FIXED_CELL = /^([\d.]+)x([\d.]+)$/.exec(process.env.HERDR_DEVICES_CELL ?? "");
let points = 14;
function cellSize() {
  if (FIXED_CELL) return { w: Number(FIXED_CELL[1]), h: Number(FIXED_CELL[2]) };
  try {
    const st = JSON.parse(execFileSync("herdr-app", ["status"], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }));
    points = st.font_size * (st.zoom ?? 1);
  } catch {}
  return { w: points * 0.6 * DPR, h: points * (18 / 14) * DPR };
}

// Counted while the debug log is on: a line a second while frames come.
const stats = { got: 0, drawn: 0, scale: 0, send: 0, gap: 0, lastDraw: 0 };
if (debug.on) setInterval(() => {
  if (stats.got) debug(`1s: ${stats.got} frames in, ${stats.drawn} drawn, scale ${(stats.scale / (stats.drawn || 1)).toFixed(1)} ms, deflate+write ${(stats.send / (stats.drawn || 1)).toFixed(1)} ms, longest gap ${stats.gap.toFixed(0)} ms`);
  Object.assign(stats, { got: 0, drawn: 0, scale: 0, send: 0, gap: 0 });
}, 1000).unref();
const view = { cell: cellSize(), aspect: kind === "sim" ? 1206 / 2622 : 1080 / 2400, box: null, note: "Connecting…", shown: 0, compress: true, drawn: 0 };

// Where the picture goes: as large as fits, centered.
function layout() {
  const cols = process.stdout.columns ?? 80, rows = process.stdout.rows ?? 24, { w: cw, h: ch } = view.cell;
  const h = Math.min(rows * ch, (cols * cw) / view.aspect), w = h * view.aspect;
  const c = Math.max(1, Math.min(cols, Math.round(w / cw))), r = Math.max(1, Math.min(rows, Math.round(h / ch)));
  const col = Math.floor((cols - c) / 2) + 1, row = Math.floor((rows - r) / 2) + 1;
  view.box = { col, row, c, r, x: (col - 1) * cw, y: (row - 1) * ch, w: c * cw, h: r * ch };
}

// A line in the middle, while there is no picture.
function note(text) {
  view.note = text;
  const cols = process.stdout.columns ?? 80, rows = process.stdout.rows ?? 24, line = text.slice(0, cols);
  out(`\x1b[2J\x1b[${Math.max(1, Math.floor(rows / 2))};${Math.max(1, Math.floor((cols - line.length) / 2) + 1)}H\x1b[2m${line}\x1b[22m`);
}

let again = () => {}; // draws the last frame once more
function redraw() {
  debug(`redraw: ${process.stdout.columns}x${process.stdout.rows}, cell ${view.cell.w}x${view.cell.h}`);
  out("\x1b[2J");
  for (const image of IMAGES) out(`\x1b_Ga=d,d=I,i=${image},q=2\x1b\\`);
  layout();
  if (view.note) note(view.note);
  again();
}

// One frame onto the screen, in 4096-byte pieces. `format`: the protocol's f, o, s and v.
function draw(format, bytes) {
  if (view.note) { view.note = ""; out("\x1b[2J"); }
  if (view.drawn < 3) debug(`draw ${format}, ${bytes.length} bytes`);
  const { col, row, c, r } = view.box, image = IMAGES[view.shown ^ 1], old = IMAGES[view.shown], b64 = bytes.toString("base64");
  let s = `\x1b[?2026h\x1b[${row};${col}H`;
  const ctrl = `a=T,${format},i=${image},p=1,c=${c},r=${r},C=1,q=1`;
  for (let i = 0; i < b64.length; i += 4096) s += `\x1b_G${i === 0 ? `${ctrl},` : ""}m=${i + 4096 < b64.length ? 1 : 0};${b64.slice(i, i + 4096)}\x1b\\`;
  s += `\x1b_Ga=d,d=I,i=${old},q=2\x1b\\\x1b[?2026l`;
  out(s);
  view.shown ^= 1;
  view.drawn++;
}

// The picture's proportions changed (the device turned): lay it out again. True when it did.
function turnedTo(aspect) {
  if (Math.abs(aspect - view.aspect) <= 0.01) return false;
  view.aspect = aspect;
  redraw();
  return true;
}

// A multipart stream of pictures off a local port, each handed to `frame`.
function stream(host, streamPort, path, frame) {
  const socket = net.connect(streamPort, host, () => socket.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\n\r\n`));
  const body = new S.HttpBody(), parts = new S.Multipart();
  socket.on("data", (chunk) => {
    try {
      for (const piece of body.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length))) {
        parts.push(piece);
        for (let part; (part = parts.take()) !== undefined; ) if (part) frame(Buffer.from(part));
      }
    } catch (e) { quit(`The stream failed: ${e.message}`); }
  });
  socket.on("error", (e) => quit(`The stream failed: ${e.message}`));
  socket.on("close", () => quit("The stream ended."));
  return socket;
}

// ---- a simulator: serve-sim's JPEGs through the scaler, input over its socket ----

// A WebSocket client that only sends (and answers pings): node has one built in from 22 on.
function socketTo(url) {
  const u = new URL(url), socket = net.connect(Number(u.port), u.hostname);
  let open = false, buffer = Buffer.alloc(0);
  const frame = (opcode, payload) => {
    const n = payload.length, mask = randomBytes(4), body = Buffer.from(payload);
    const head = n < 126 ? Buffer.from([0x80 | opcode, 0x80 | n]) : Buffer.from([0x80 | opcode, 0x80 | 126, n >> 8, n & 255]);
    for (let i = 0; i < n; i++) body[i] ^= mask[i & 3];
    socket.write(Buffer.concat([head, mask, body]));
  };
  const queued = []; // sent before the handshake finished
  socket.on("connect", () => socket.write(`GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
  socket.on("data", (d) => {
    buffer = Buffer.concat([buffer, d]);
    if (!open) {
      const end = buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      open = /^HTTP\/1\.1 101/.test(buffer.toString("latin1", 0, end));
      buffer = buffer.subarray(end + 4);
      if (open) for (const bytes of queued.splice(0)) frame(2, bytes);
    }
    while (buffer.length >= 2) { // the server's frames: unmasked; only a ping needs an answer
      let n = buffer[1] & 127, at = 2;
      if (n === 126) { if (buffer.length < 4) return; n = buffer.readUInt16BE(2); at = 4; }
      else if (n === 127) { if (buffer.length < 10) return; n = Number(buffer.readBigUInt64BE(2)); at = 10; }
      if (buffer.length < at + n) return;
      if ((buffer[0] & 15) === 9) frame(10, buffer.subarray(at, at + n));
      buffer = buffer.subarray(at + n);
    }
  });
  socket.on("error", () => {});
  socket.on("close", () => { open = false; });
  return { send: (bytes) => { if (open) frame(2, bytes); else if (queued.length < 64) queued.push(bytes); }, get closed() { return socket.destroyed; }, close: () => socket.destroy() };
}

function simulator() {
  let ws = null, base = "", owned = false, rest = null, last = null, socket = null;
  const send = (tag, body) => { if (!ws || ws.closed) ws = socketTo(`${base.replace(/^http/, "ws")}/ws`); ws.send(S.wsFrame(tag, body)); };

  function scalerPath() {
    const source = join(here, "frame-scale.swift"), bin = join(cache, "frame-scale");
    if (!existsSync(bin) || statSync(bin).mtimeMs < statSync(source).mtimeMs) {
      mkdirSync(cache, { recursive: true });
      note("Building the frame scaler (once)…");
      execFileSync("xcrun", ["swiftc", "-O", source, "-o", bin], { stdio: ["ignore", "ignore", "pipe"] });
    }
    return bin;
  }

  // A scaler process: JPEGs in, raw pictures out, one at a time. A frame that arrives while it
  // works replaces the one waiting, so the newest wins.
  function scalerFor(bin, side, done) {
    const child = spawn(bin, [], { stdio: ["pipe", "pipe", "ignore"] });
    let busy = null, waiting = null, pending = Buffer.alloc(0);
    const next = (job) => {
      if (busy) { waiting = job; return; }
      busy = job;
      const head = Buffer.alloc(8);
      head.writeUInt32BE(job.jpeg.length, 0);
      head.writeUInt32BE(side(), 4);
      child.stdin.write(head);
      child.stdin.write(job.jpeg);
    };
    child.stdout.on("data", (chunk) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length >= 8) {
        const w = pending.readUInt32BE(0), h = pending.readUInt32BE(4), size = w * h * 4;
        if (pending.length < 8 + size) return;
        const rgba = pending.subarray(8, 8 + size), job = busy;
        pending = pending.subarray(8 + size);
        busy = null;
        if (w && h) done(job, w, h, rgba);
        if (waiting) { const job = waiting; waiting = null; next(job); }
      }
    });
    child.on("exit", () => quit("The frame scaler stopped."));
    return { next, stop() { child.removeAllListeners("exit"); child.kill(); } };
  }

  const full = () => Math.round(Math.max(view.box.w, view.box.h));
  const show = (w, h, rgba) => { if (!turnedTo(w / h)) draw(`f=32,s=${w},v=${h}${view.compress ? ",o=z" : ""}`, view.compress ? zlib.deflateSync(rgba, { level: 1 }) : rgba); };
  let fast = null, sharp = null, count = 0;
  // The sharp picture, unless the screen moved on or a finger went down while it was made.
  const settled = (n) => n === count && !touch;
  function showSharp(job, w, h, rgba) {
    if (!settled(job.n) || turnedTo(w / h)) return;
    if (!view.compress) return draw(`f=32,s=${w},v=${h}`, rgba);
    zlib.deflate(Buffer.from(rgba), { level: 1 }, (err, bytes) => { if (!err && settled(job.n) && !done) draw(`f=32,s=${w},v=${h},o=z`, bytes); });
  }
  // Waits out a finger that is still down, then asks for the sharp picture.
  function sharpen(jpeg, n) {
    clearTimeout(rest);
    rest = setTimeout(() => { if (n !== count) return; if (touch) sharpen(jpeg, n); else sharp.next({ jpeg, n }); }, REST_MS);
  }

  // Each new frame goes to the fast scaler at once. The sharp one has its own process, so a
  // full-size picture in the making never holds up the first frames of the next movement; its
  // picture is dropped when a newer frame came meanwhile.
  function frame(jpeg) {
    if (last?.equals(jpeg)) return; // a resting screen repeats its frame five times a second
    last = jpeg;
    const n = ++count;
    stats.got++;
    fast.next({ jpeg, n, at: performance.now() });
    sharpen(jpeg, n);
  }

  return {
    async start() {
      const bin = scalerPath();
      fast = scalerFor(bin, () => Math.min(full(), MOVING_SIDE), (job, w, h, rgba) => {
        const scaledAt = performance.now();
        show(w, h, rgba);
        const now = performance.now();
        stats.drawn++; stats.scale += scaledAt - job.at; stats.send += now - scaledAt;
        if (stats.lastDraw) stats.gap = Math.max(stats.gap, now - stats.lastDraw);
        stats.lastDraw = now;
      });
      sharp = scalerFor(bin, () => Math.min(full(), 2622), showSharp); // never larger than a device's own frame
      note("Connecting…");
      const listed = S.serveSimJson((await run(S.serveSimArgv(["--list", "-q", id]))).stdout);
      const running = S.runningHelper(listed, id);
      const started = running ?? S.serveSimJson((await run(S.serveSimArgv(["--detach", "-q", id]))).stdout);
      owned = !running;
      const at = S.helperAddress(started.streamUrl);
      if (!at) throw new Error("serve-sim gave no stream address (is the simulator booted?)");
      base = at.base;
      again = () => last && sharp.next({ jpeg: last, n: count });
      socket = stream(at.host, at.port, at.path, frame);
    },
    refused() { // a terminal that takes no deflated pixels gets them plain
      if (view.compress && view.drawn <= 3) view.compress = false;
      again();
    },
    touch: (type, p, edge) => send(S.TAG.touch, edge ? { type, x: p.x, y: p.y, edge } : { type, x: p.x, y: p.y }),
    scroll: (dy, p) => send(S.TAG.scroll, { dx: 0, dy, x: p.x, y: p.y }),
    key(k) {
      for (const m of k.modifiers) send(S.TAG.key, { type: "down", usage: m });
      send(S.TAG.key, { type: "down", usage: k.usage });
      send(S.TAG.key, { type: "up", usage: k.usage });
      for (const m of [...k.modifiers].reverse()) send(S.TAG.key, { type: "up", usage: m });
    },
    async tool([method, ...args]) {
      if (method === "button") send(S.TAG.button, { button: args[0] });
      else if (method === "hid") send(S.TAG.button, { button: "hid", page: args[0], usage: args[1], phase: "press" });
      else if (method === "softwareKeyboard") send(S.TAG.keyboard);
      else if (method === "rotate") send(S.TAG.rotate, { orientation: S.ROTATE[(await (await fetch(`${base}/config`)).json()).orientation] ?? "portrait" });
    },
    async stop() {
      clearTimeout(rest);
      socket?.removeAllListeners("close");
      socket?.destroy();
      ws?.close();
      fast?.stop();
      sharp?.stop();
      if (owned) await run(S.serveSimArgv(["--kill", id]));
    },
  };
}

// ---- an Android device: the emulator's PNG frames (or screenshots), input through adb ----

function android() {
  const shell = (words) => run([adb, "-s", id, "shell", ...words]);
  let physical = { width: 1080, height: 2400 }, queue = Promise.resolve(), move = null, last = null, socket = null, polling = false;
  const size = () => S.turned(physical, view.aspect);
  // Commands run one at a time, in order.
  const send = (words) => { if (words) queue = queue.then(() => shell(typeof words === "function" ? words() : words)); };

  function frame(png) {
    last = png;
    const aspect = S.imageAspect(png);
    if (aspect && !turnedTo(aspect)) draw("f=100", png);
  }

  // No frame stream (a phone, or an emulator started without gRPC): a screenshot, again as soon as
  // the last one is drawn, at most twice a second.
  async function poll() {
    polling = true;
    while (polling) {
      const began = Date.now(), r = await run([adb, "-s", id, "exec-out", "screencap", "-p"], { encoding: "buffer", maxBuffer: 64 << 20 });
      if (!polling) return;
      if (r.code !== 0 || !r.stdout.length) return quit("The screenshot failed: is the device still connected?");
      frame(r.stdout);
      await new Promise((resolve) => setTimeout(resolve, Math.max(50, 500 - (Date.now() - began))));
    }
  }

  return {
    async start() {
      note("Connecting…");
      physical = S.parseWmSize((await shell(["wm", "size"])).stdout) ?? physical;
      view.aspect = physical.width / physical.height;
      layout();
      again = () => last && frame(last);
      const width = Math.min(1080, Math.max(360, Math.round(view.box.w))), helper = S.helperArgv(join(here, "android-stream.mjs"), id, width);
      if (helper && (await run(helper)).code === 0) socket = stream("127.0.0.1", S.streamPort(id).port, "/stream", frame);
      else poll();
    },
    refused: () => {},
    // Moves that pile up behind a slow command collapse into the latest one.
    touch(type, p) {
      if (type !== "move") { if (type === "begin") move = null; return send(() => S.androidInput.touch(type, p, size())); }
      const queued = move != null;
      move = p;
      if (!queued) send(() => { const at = move; move = null; return at ? S.androidInput.touch("move", at, size()) : ["true"]; });
    },
    scroll: (dy, p) => send(() => S.androidInput.scroll(0, dy, p, size())),
    key: (k) => send(S.androidInput.key(k.usage, k.modifiers.includes(S.SHIFT))),
    tool([method, ...args]) {
      if (method === "button") send(S.androidInput.button(args[0]));
      else if (method === "hid") send(S.androidInput.volume(args[1]));
      else if (method === "rotate") send(S.androidInput.rotate());
    },
    async stop() { polling = false; socket?.removeAllListeners("close"); socket?.destroy(); },
  };
}

const device = kind === "sim" ? simulator() : android();
const tools = S.toolsFor({ kind: kind === "sim" ? "sim" : "avd" });

// ---- input: the mouse and the keys from the terminal, the bar's buttons from the port ----

let touch = null;
// A pointer position in pixels as a 0..1 point of the picture; null outside it.
function point(x, y, inside) {
  const b = view.box, fx = (x - b.x) / b.w, fy = (y - b.y) / b.h;
  if (inside && (fx < 0 || fx > 1 || fy < 0 || fy > 1)) return null;
  return { x: clamp(fx), y: clamp(fy) };
}

function mouse(code, x, y, down) {
  if (!view.box || view.note) return;
  if (code & 64) { // the wheel
    const p = point(x, y, true);
    if (p) device.scroll(code & 1 ? 0.12 : -0.12, p);
    return;
  }
  if ((code & 3) !== 0) return; // only the left button
  if (code & 32) { // moved with the button down
    if (!touch) return;
    Object.assign(touch, point(x, y, false));
    device.touch("move", touch, touch.edge);
  } else if (down) {
    const p = point(x, y, true);
    if (!p) return;
    touch = { ...p, edge: S.touchEdge(p) };
    device.touch("begin", touch, touch.edge);
  } else if (touch) {
    device.touch("end", point(x, y, false), touch.edge);
    touch = null;
  }
}

const NAMED = { "\r": "enter", "\n": "enter", "\x7f": "backspace", "\b": "backspace", "\t": "tab", " ": "space", "\x1b": "escape" };
const ESCAPES = { "\x1b[A": "up", "\x1b[B": "down", "\x1b[C": "right", "\x1b[D": "left", "\x1b[H": "home", "\x1b[F": "end", "\x1b[3~": "delete", "\x1b[5~": "pageup", "\x1b[6~": "pagedown" };

function typed(text) {
  // Mouse reports and the terminal's answers come out first; what is left was typed.
  text = text.replace(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/g, (_m, code, x, y, press) => { mouse(Number(code), Number(x), Number(y), press === "M"); return ""; });
  // The cell height, asked with CSI 16 t: in points in a tab, in pixels in a layout block (told
  // apart by the font size). A terminal not on show answers a fixed 10x20, which is ignored.
  text = text.replace(/\x1b\[6;([\d.]+);([\d.]+)t/g, (_m, h, w) => {
    const height = Number(h) > points * 1.9 ? Number(h) : Number(h) * DPR;
    debug(`cell answer: ${w}x${h}`);
    if (!FIXED_CELL && !(Number(h) === 20 && Number(w) === 10) && Math.abs(height - view.cell.h) > 0.5) { view.cell.h = height; redraw(); }
    return "";
  });
  text = text.replace(/\x1b_G([^\x1b]*)\x1b\\/g, (_m, reply) => { debug(`terminal: ${reply}`); if (/;E[A-Z]+/.test(reply) && !done) device.refused(); return ""; });
  if (failed) { if (text.length) quit(); return; } // any key closes the reason
  if (done) return;
  for (let i = 0; i < text.length; ) {
    if (text[i] === "\x03" || text[i] === "\x04") return quit(); // Ctrl-C, Ctrl-D
    const escape = Object.keys(ESCAPES).find((e) => text.startsWith(e, i));
    if (!escape && text[i] === "\x1b" && i + 1 < text.length) { // a sequence it has no key for
      const m = /^\x1b(\[[\d;?<>=]*[ -\/]*[@-~]|O.|.)/.exec(text.slice(i));
      i += m ? m[0].length : 1;
      continue;
    }
    const k = S.keyUsages({ key: escape ? ESCAPES[escape] : NAMED[text[i]] ?? text[i], modifiers: {} });
    i += escape ? escape.length : 1;
    if (k) device.key(k);
  }
}

function command(line) {
  if (line === "quit") return quit();
  const tool = tools.find((b) => b.id === line);
  if (tool) Promise.resolve(device.tool(tool.press)).catch(() => null);
}

// ---- start and stop ----

// Asked to stop (Back, Ctrl-C): everything is put back and it ends. Stopped by a failure (the
// device went off, a helper didn't start): the reason stays on screen until Back or a key, or
// nobody would get to read it.
let done = false, failed = false, control = null;
function leave(code) {
  out("\x1b[?25h\x1b[?1049l");
  process.stdin.setRawMode?.(false);
  process.exit(code);
}
function quit(message) {
  if (done) { if (failed && !message) leave(1); return; }
  done = true;
  debug(`quit: ${message ?? "asked to"}`);
  for (const image of IMAGES) out(`\x1b_Ga=d,d=I,i=${image},q=2\x1b\\`);
  out("\x1b[?1002l\x1b[?1006l\x1b[?1016l");
  failed = Boolean(message);
  if (failed) note(message);
  else control?.close();
  Promise.resolve(device.stop()).catch(() => null).then(() => { if (!failed) leave(0); });
}

out("\x1b[?1049h\x1b[?25l");
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on("data", (d) => typed(d.toString("latin1")));
process.on("SIGTERM", () => quit());
process.on("SIGHUP", () => quit());
layout();
note("Connecting…");

// The bar's port opens first, so Back works while it is still connecting.
if (Number(port)) {
  control = net.createServer((client) => {
    let text = "";
    client.on("data", (d) => { text += d; for (let at; (at = text.indexOf("\n")) >= 0; text = text.slice(at + 1)) command(text.slice(0, at).trim()); });
    client.on("error", () => {});
  }).on("error", () => {}).listen(Number(port), "127.0.0.1");
}

try {
  await device.start();
  if (done) await device.stop(); // asked to stop while it started
  process.stdout.on("resize", () => { redraw(); out("\x1b[16t"); });
  out("\x1b[?1002h\x1b[?1006h\x1b[?1016h\x1b[16t");
  debug(`started ${kind} ${id}: cell ${view.cell.w}x${view.cell.h}, ${process.stdout.columns}x${process.stdout.rows}`);
} catch (e) {
  quit(`Couldn't show the screen: ${e.message}`);
}
