// The screen view's pure half: no herdr import, so node can test it and the viewer
// (screen-term.mjs, run by node) can share it. Which devices have a screen to show, the stream
// readers, image sizes, the key mappings for serve-sim (iOS) and `adb shell input` (Android),
// the argv of what the view runs, and the layout edit that puts the viewer's terminal where the
// panel was. serve-sim's MJPEG and /ws input and the emulator's gRPC frames are used the way
// Robert Soriano's herdr-sim (MIT) does, https://github.com/wobsoriano/herdr-sim.

// A booted simulator, a running emulator or an authorized phone. A connected iPhone has no
// screen to read (devicectl has no screenshot).
export const canShow = (d) => d.state === "on" && (d.kind === "sim" || ((d.kind === "avd" || d.kind === "phone") && Boolean(d.serial)));

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// A picture's size in pixels, from a PNG's IHDR or a JPEG's start-of-frame; null for anything else.
export function imageSize(bytes) {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    const u32 = (i) => ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
    const width = u32(16), height = u32(20);
    return width && height ? { width, height } : null;
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  for (let i = 2; i + 9 < bytes.length; ) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    // Start of frame: every C0..CF but the huffman (C4), JPEG (C8) and arithmetic (CC) tables.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6], width = (bytes[i + 7] << 8) | bytes[i + 8];
      return width && height ? { width, height } : null;
    }
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
  }
  return null;
}

// Width over height of the same.
export function imageAspect(bytes) {
  const size = imageSize(bytes);
  return size ? size.width / size.height : null;
}

// An HTTP response read off a raw socket: push() what the socket gave and get back the body's
// bytes, as a list of pieces. The head is taken off first (a status other than 200 throws), and a
// chunked body (what node's http sends for a stream without a length) loses its chunk framing,
// which would otherwise land inside the frames.
export class HttpBody {
  constructor() { this.head = []; this.chunked = null; this.state = "size"; this.left = 0; this.line = ""; this.done = false; }

  push(bytes) {
    if (this.chunked == null) {
      // The head is small: look for its blank line byte by byte across pushes.
      for (let i = 0; i < bytes.length; i++) {
        const h = this.head, n = h.push(bytes[i]);
        if (n >= 4 && h[n - 4] === 13 && h[n - 3] === 10 && h[n - 2] === 13 && h[n - 1] === 10) {
          const text = String.fromCharCode(...h), status = /^HTTP\/\d\.\d (\d+)/.exec(text)?.[1];
          if (status !== "200") throw new Error(`the stream answered ${status ?? "something that isn't HTTP"}`);
          this.chunked = /^transfer-encoding:.*chunked/im.test(text);
          return this.body(bytes.subarray(i + 1));
        }
        if (n > 16384) throw new Error("the stream's answer has no end");
      }
      return [];
    }
    return this.body(bytes);
  }

  body(bytes) {
    if (!bytes.length || this.done) return [];
    if (!this.chunked) return [bytes];
    const out = [];
    for (let i = 0; i < bytes.length && !this.done; ) {
      if (this.state === "data") {
        const n = Math.min(this.left, bytes.length - i);
        out.push(bytes.subarray(i, i + n));
        i += n;
        this.left -= n;
        if (!this.left) { this.state = "size"; this.line = ""; this.after = true; }
      } else {
        // A size line (hex, maybe with extensions), after the CRLF that closed the chunk before it.
        const c = bytes[i++];
        if (c !== 10) { if (c !== 13) this.line += String.fromCharCode(c); continue; }
        if (this.after && !this.line) { this.after = false; continue; }
        this.after = false;
        this.left = parseInt(this.line, 16);
        if (!(this.left > 0)) this.done = true; // the last chunk, or nonsense
        else this.state = "data";
      }
    }
    return out;
  }
}

// Reads a multipart/x-mixed-replace body: push() its bytes, then take() until it returns
// undefined. A part comes back as a view into the reader's buffer, good until the next call (copy
// it to keep it); a part without a Content-Length as null.
export class Multipart {
  constructor() { this.buf = new Uint8Array(1 << 20); this.len = 0; this.used = 0; }

  push(chunk) {
    this.drop();
    if (this.len + chunk.length > this.buf.length) {
      const grown = new Uint8Array((this.len + chunk.length) * 2);
      grown.set(this.buf.subarray(0, this.len));
      this.buf = grown;
    }
    this.buf.set(chunk, this.len);
    this.len += chunk.length;
  }

  drop() {
    if (!this.used) return;
    this.buf.copyWithin(0, this.used, this.len);
    this.len -= this.used;
    this.used = 0;
  }

  take() {
    this.drop();
    const b = this.buf, n = Math.min(this.len, 4096);
    let head = -1;
    for (let i = 0; i + 3 < n; i++) if (b[i] === 13 && b[i + 1] === 10 && b[i + 2] === 13 && b[i + 3] === 10) { head = i; break; }
    if (head < 0) return undefined;
    let text = "";
    for (let i = 0; i < head; i++) text += String.fromCharCode(b[i]);
    const length = /content-length:\s*(\d+)/i.exec(text), start = head + 4, end = length ? start + Number(length[1]) : start;
    if (this.len < end) return undefined;
    this.used = end;
    return length ? b.subarray(start, end) : null;
  }
}

// ---- iOS: serve-sim ----

// Through an interactive login shell, so npx resolves the node the person's terminals do (Herdr's
// own PATH can find a broken one). On Xcode 27 serve-sim types through a Device Hub bridge that
// drops keys unless Device Hub is frontmost; without it keys take the path touches do.
export const SERVE_SIM_VERSION = "0.1.49";
const SERVE_SIM = `SERVE_SIM_DISABLE_DEVICE_HUB_KEYBOARD=1 exec "\${SHELL:-/bin/zsh}" -lic 'npx --yes serve-sim@${SERVE_SIM_VERSION} "$@"' serve-sim "$@"`;
export const serveSimArgv = (args) => ["sh", "-c", SERVE_SIM, "sh", ...args];

// The JSON line serve-sim printed, after whatever the login shell did.
export function serveSimJson(stdout) {
  const line = stdout.trim().split("\n").findLast((l) => l.trim().startsWith("{"));
  try { return line ? JSON.parse(line) : {}; } catch { return {}; }
}

// `--list` reports every running helper whatever udid it gets, as one object or as `streams`.
export function runningHelper(listed, udid) {
  return listed?.running ? (listed.streams ?? [listed]).find((s) => s.device === udid) ?? null : null;
}

// http://127.0.0.1:3100/helper/<udid>/stream.mjpeg -> where to read frames and send input.
export function helperAddress(streamUrl) {
  const m = /^http:\/\/([^/:]+):(\d+)(\/.*)$/.exec(streamUrl ?? "");
  if (!m) return null;
  const base = streamUrl.replace(/\/stream\.mjpeg$/, "");
  return { host: m[1], port: Number(m[2]), path: m[3], base, ws: `${base.replace(/^http/, "ws")}/ws` };
}

// The helper's /ws input: one tag byte, then a JSON body. Every body is ASCII (numbers and fixed
// names), and there is no TextEncoder in Herdr's runtime.
export const TAG = { touch: 0x03, button: 0x04, key: 0x06, rotate: 0x07, scroll: 0x0b, keyboard: 0x0c };
export function wsFrame(tag, body) {
  const json = body === undefined ? "" : JSON.stringify(body), bytes = new Uint8Array(json.length + 1);
  bytes[0] = tag;
  for (let i = 0; i < json.length; i++) bytes[i + 1] = json.charCodeAt(i);
  return bytes;
}

// Simulator.app's Rotate Left order.
export const ROTATE = { portrait: "landscape_left", landscape_left: "portrait_upside_down", portrait_upside_down: "landscape_right", landscape_right: "portrait" };

// A touch that starts in the bottom 7% is tagged as the home-indicator edge, so iOS reads a
// swipe up from there as going home (serve-sim's own band).
export const touchEdge = (p) => (p.y >= 0.93 ? 3 : 0);

// gpui key names -> USB HID keyboard usages.
const USAGES = {
  enter: 40, escape: 41, backspace: 42, tab: 43, space: 44,
  "-": 45, "=": 46, "[": 47, "]": 48, "\\": 49, ";": 51, "'": 52, "`": 53, ",": 54, ".": 55, "/": 56,
  home: 74, pageup: 75, delete: 76, end: 77, pagedown: 78, right: 79, left: 80, down: 81, up: 82,
};
for (let i = 0; i < 26; i++) USAGES[String.fromCharCode(97 + i)] = 4 + i;
for (let i = 0; i < 10; i++) USAGES["1234567890"[i]] = 30 + i;
for (let i = 1; i <= 12; i++) USAGES[`f${i}`] = 57 + i;
// A shifted symbol is its unshifted key with Shift held.
const UNSHIFTED = { "!": "1", "@": "2", "#": "3", $: "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0", _: "-", "+": "=", "{": "[", "}": "]", "|": "\\", ":": ";", '"': "'", "~": "`", "<": ",", ">": ".", "?": "/" };
const MODIFIERS = [["control", 224], ["shift", 225], ["alt", 226]];
export const SHIFT = 225;

// The HID usage and modifier usages for a gpui key event: null for keys a device has no use for,
// and for cmd chords, which stay Herdr's.
export function keyUsages(event) {
  const mods = event.modifiers ?? {};
  if (mods.platform) return null;
  let key = event.key, shift = Boolean(mods.shift);
  if (UNSHIFTED[key]) [key, shift] = [UNSHIFTED[key], true];
  if (/^[A-Z]$/.test(key)) [key, shift] = [key.toLowerCase(), true];
  const usage = USAGES[key];
  if (!usage) return null;
  const held = { ...mods, shift };
  return { usage, modifiers: MODIFIERS.filter(([name]) => held[name]).map(([, u]) => u) };
}

// ---- Android: adb ----

// HID keyboard usages -> Android key codes.
const KEYCODES = { 40: 66, 41: 111, 42: 67, 43: 61, 44: 62, 45: 69, 46: 70, 47: 71, 48: 72, 49: 73, 51: 74, 52: 75, 53: 68, 54: 55, 55: 56, 56: 76, 74: 122, 75: 92, 76: 112, 77: 123, 78: 93, 79: 22, 80: 21, 81: 20, 82: 19 };
for (let u = 4; u <= 29; u++) KEYCODES[u] = u + 25; // a..z
for (let u = 30; u <= 38; u++) KEYCODES[u] = u - 22; // 1..9
KEYCODES[39] = 7; // 0
const ANDROID_BUTTONS = { home: 3, lock: 26 };
const ANDROID_VOLUME = { 233: 24, 234: 25 };
export const isModifier = (usage) => usage >= 224 && usage <= 231;

// "Physical size: 1080x2400", and the override when there is one.
export function parseWmSize(text) {
  const m = /Override size:\s*(\d+)x(\d+)/.exec(text ?? "") ?? /(\d+)x(\d+)/.exec(text ?? "");
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

// `wm size` is the portrait size; a frame wider than tall says the screen is turned.
export const turned = (size, aspect) => (aspect > 1) !== (size.width > size.height) ? { width: size.height, height: size.width } : size;

const px = (p, size) => [String(Math.round(p.x * (size.width - 1))), String(Math.round(p.y * (size.height - 1)))];

// The `adb shell` words (after `-s <serial> shell`) of each input; null when there is nothing to send.
export const androidInput = {
  touch: (type, p, size) => ["input", "motionevent", type === "begin" ? "DOWN" : type === "move" ? "MOVE" : "UP", ...px(p, size)],
  // Only presses go out: `input keyevent` is a whole press, and Shift rides along as a combination.
  key: (usage, shift) => (KEYCODES[usage] == null ? null : shift ? ["input", "keycombination", "59", String(KEYCODES[usage])] : ["input", "keyevent", String(KEYCODES[usage])]),
  button: (name) => (ANDROID_BUTTONS[name] == null ? null : ["input", "keyevent", String(ANDROID_BUTTONS[name])]),
  volume: (usage) => (ANDROID_VOLUME[usage] == null ? null : ["input", "keyevent", String(ANDROID_VOLUME[usage])]),
  // dx, dy: a fraction of the screen; positive scrolls toward what is below / right.
  scroll: (dx, dy, p, size) => ["input", "swipe", ...px(p, size), ...px({ x: clamp(p.x - dx, 0, 1), y: clamp(p.y - dy, 0, 1) }, size), "120"],
  // adb joins shell arguments into one command line, so this goes as one string.
  rotate: () => ["settings put system accelerometer_rotation 0; r=$(settings get system user_rotation); settings put system user_rotation $(( (${r:-0} + 1) % 4 ))"],
};

// The emulator's frame helper listens on a port from its console port: emulator-5554 -> 32554.
// null for a phone (no gRPC there).
export function streamPort(serial) {
  const m = /^emulator-(\d+)$/.exec(serial ?? "");
  return m ? { console: m[1], port: 27000 + Number(m[1]) } : null;
}

// Starts android-stream.mjs unless one already serves the emulator (another view of it), and
// returns once it listens. Through the login shell, whose PATH finds a working node.
export function helperArgv(script, serial, width = 540) {
  const p = streamPort(serial);
  if (!p) return null;
  const sh = [
    'nc -z 127.0.0.1 "$3" && exit 0',
    'nohup "${SHELL:-/bin/zsh}" -lic \'exec node "$@"\' node "$1" "$2" "$3" "$4" >/dev/null 2>&1 &',
    'for i in $(seq 50); do sleep 0.1; nc -z 127.0.0.1 "$3" && exit 0; done',
    "exit 1",
  ].join("\n");
  return ["sh", "-c", sh, "sh", script, p.console, String(p.port), String(width)];
}

// The view's toolbar, left to right. `press` names the input's method and its arguments.
export const CONSUMER = 12; // the HID consumer page, where volume up is 233 and down 234
const TOOLS = [
  { id: "home", icon: "house", tip: "Home", press: ["button", "home"] },
  { id: "lock", icon: "lock", tip: "Lock", press: ["button", "lock"] },
  { id: "volume-down", icon: "volume-1", tip: "Volume down", press: ["hid", CONSUMER, 234] },
  { id: "volume-up", icon: "volume-2", tip: "Volume up", press: ["hid", CONSUMER, 233] },
  { id: "rotate", icon: "rotate-ccw", tip: "Rotate", press: ["rotate"] },
  { id: "keyboard", icon: "keyboard", tip: "Show or hide the software keyboard", press: ["softwareKeyboard"], only: "sim" },
];
export const toolsFor = (d) => TOOLS.filter((b) => !b.only || b.only === d.kind);


// ---- the viewer and its place in the layout ----

// Starts screen-term.mjs through the login shell, whose PATH finds a working node. `port`: where
// the viewer listens for the bar's buttons. `adb`: its path, for an Android device.
export function viewerArgv(script, d, port, adb = "") {
  const sim = d.kind === "sim";
  return ["sh", "-c", 'exec "${SHELL:-/bin/zsh}" -lic \'exec node "$@"\' node "$@"', "sh", script, sim ? "sim" : "android", sim ? d.id : d.serial, d.name, String(port), adb];
}

export const BAR = 42; // the bar over the viewer, px

// A layout with `mod`'s block turned into a column: the mod again as a bar (its props plus
// `screen`), over the viewer's terminal. The column keeps the block's id and size, so a stack
// that shows it still does; `screen.was` remembers them too, for unwrapScreen. null when the
// layout has no such block (the mod is a pane in a tab).
export function wrapScreen(layout, mod, terminal, screen) {
  let done = false;
  const visit = (node) => {
    if (done || !node || typeof node !== "object") return node;
    if (node.type === "block" && node.content?.mod === mod && !node.content.props?.screen) {
      done = true;
      const { type: _type, content, ...rest } = node, id = node.id ?? mod, was = { id, ...(node.size && { size: node.size }) };
      return { ...rest, id, type: "column", children: [
        { id: `${id}-bar`, type: "block", size: { px: BAR }, content: { mod, props: { ...content.props, screen: { ...screen, terminal, was } } } },
        { id: `${id}-screen`, type: "block", content: { terminal } },
      ] };
    }
    return Array.isArray(node.children) ? { ...node, children: node.children.map(visit) } : node;
  };
  const next = visit(layout);
  return done ? next : null;
}

// The reverse: the mod's block again, with the id, size and props it had. Herdr rewrites the
// file when the viewer's terminal ends, dropping its block and then a column left with one
// child, so the bar is found in all three shapes: in its column of two, alone in it, or bare.
// `terminal`: only that screen's (any, when left out). null when there is none.
export function unwrapScreen(layout, mod, terminal) {
  let done = false;
  const isBar = (node) => node?.type === "block" && node.content?.mod === mod && node.content.props?.screen && (!terminal || node.content.props.screen.terminal === terminal);
  const block = (bar, rest) => {
    done = true;
    const { screen, ...props } = bar.content.props, was = screen.was ?? {};
    const { size: _size, ...kept } = rest;
    return { ...kept, id: was.id ?? rest.id, ...(was.size && { size: was.size }), type: "block", content: Object.keys(props).length ? { mod, props } : { mod } };
  };
  const visit = (node) => {
    if (!node || typeof node !== "object") return node;
    if (node.type === "column" && isBar(node.children?.[0]) && node.children.every((c, i) => i === 0 || c.content?.terminal)) { const { children, type: _type, ...rest } = node; return block(children[0], rest); }
    if (isBar(node)) { const { content: _content, type: _type, ...rest } = node; return block(node, rest); }
    return Array.isArray(node.children) ? { ...node, children: node.children.map(visit) } : node;
  };
  const next = visit(layout);
  return done ? next : null;
}
