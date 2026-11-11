// The screen view's pure half: node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import * as S from "../mods/devices/screen.js";

const bytes = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const png = (w, h) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, w >> 24, (w >> 16) & 255, (w >> 8) & 255, w & 255, h >> 24, (h >> 16) & 255, (h >> 8) & 255, h & 255, 8, 6, 0, 0, 0]);
// SOI, an APP0 segment of 16 bytes, then SOF0 with the height and width.
const jpeg = (w, h) => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...new Array(14).fill(0), 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 0, 0, 0]);

test("which devices have a screen to show", () => {
  assert.ok(S.canShow({ kind: "sim", id: "U", state: "on" }));
  assert.ok(S.canShow({ kind: "avd", id: "emulator-5554", serial: "emulator-5554", avd: "a", state: "on" }));
  assert.ok(S.canShow({ kind: "phone", id: "R5", serial: "R5", state: "on" }));
  assert.ok(!S.canShow({ kind: "sim", id: "U", state: "off" }));
  assert.ok(!S.canShow({ kind: "avd", id: "a", avd: "a", state: "off" }));
  assert.ok(!S.canShow({ kind: "phone", id: "R5", serial: "R5", state: "unauthorized" }));
  assert.ok(!S.canShow({ kind: "ios", id: "U", state: "on" }));
});

test("image sizes from a PNG and a JPEG", () => {
  assert.deepEqual(S.imageSize(png(1080, 2400)), { width: 1080, height: 2400 });
  assert.deepEqual(S.imageSize(jpeg(1206, 2622)), { width: 1206, height: 2622 });
  assert.equal(S.imageSize(bytes("nope")), null);
  assert.equal(S.imageAspect(png(540, 1170)), 540 / 1170);
  assert.equal(S.imageAspect(jpeg(1206, 2622)), 1206 / 2622);
  assert.equal(S.imageAspect(jpeg(2622, 1206)), 2622 / 1206);
  assert.equal(S.imageAspect(bytes("not an image at all, just some text")), null);
  assert.equal(S.imageAspect(new Uint8Array(0)), null);
});

test("the multipart reader: frames across chunks, parts without a length", () => {
  const m = new S.Multipart(), part = (body) => `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${body.length}\r\n\r\n${body}\r\n`;
  const text = (v) => String.fromCharCode(...v);
  assert.equal(m.take(), undefined);
  m.push(bytes("--frame\r\nContent-Type: text/plain\r\n\r\n"));
  assert.equal(m.take(), null); // a part without a length
  assert.equal(m.take(), undefined);
  const stream = part("AAAA") + part("BBBBBB") + part("CC");
  m.push(bytes(stream.slice(0, 60)));
  assert.equal(text(m.take()), "AAAA");
  assert.equal(m.take(), undefined); // B's body isn't all here
  m.push(bytes(stream.slice(60)));
  assert.equal(text(m.take()), "BBBBBB");
  assert.equal(text(m.take()), "CC");
  assert.equal(m.take(), undefined);
  // A frame larger than the buffer grows it.
  const big = "x".repeat((1 << 20) + 10);
  m.push(bytes(part(big).slice(0, 500000)));
  assert.equal(m.take(), undefined);
  m.push(bytes(part(big).slice(500000)));
  assert.equal(m.take().length, big.length);
  // A lower-case header, as node's http would never write but another server might.
  m.push(bytes("--frame\r\ncontent-length: 2\r\n\r\nZZ\r\n"));
  assert.equal(text(m.take()), "ZZ");
});

test("the HTTP body: the head comes off, a chunked body loses its framing, other statuses throw", () => {
  const text = (list) => list.map((v) => String.fromCharCode(...v)).join("");
  // Plain: everything after the head, even when the head arrives in pieces.
  let b = new S.HttpBody();
  assert.equal(text(b.push(bytes("HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace\r"))), "");
  assert.equal(text(b.push(bytes("\n\r\n--frame\r\n"))), "--frame\r\n");
  assert.equal(text(b.push(bytes("more"))), "more");
  // Chunked, as node's http sends a stream: sizes and CRLFs go, split anywhere.
  const wire = "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1e\r\n--frame\r\nContent-Length: 4\r\n\r\n\r\n4\r\nABCD\r\n2\r\n\r\n\r\n";
  const want = "--frame\r\nContent-Length: 4\r\n\r\nABCD\r\n";
  assert.equal(text(new S.HttpBody().push(bytes(wire))), want);
  for (const step of [1, 2, 3, 7, 16]) {
    b = new S.HttpBody();
    let got = "";
    for (let i = 0; i < wire.length; i += step) got += text(b.push(bytes(wire.slice(i, i + step))));
    assert.equal(got, want, `in pieces of ${step}`);
  }
  // And through the multipart reader: the frame is whole.
  const m = new S.Multipart();
  for (const piece of new S.HttpBody().push(bytes(wire))) m.push(piece);
  assert.equal(String.fromCharCode(...m.take()), "ABCD");
  // The last chunk ends it; anything after is ignored.
  b = new S.HttpBody();
  assert.equal(text(b.push(bytes("HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n3;ext=1\r\nabc\r\n0\r\n\r\nzzz"))), "abc");
  assert.equal(b.done, true);
  assert.throws(() => new S.HttpBody().push(bytes("HTTP/1.1 404 Not Found\r\n\r\n")), /answered 404/);
  assert.throws(() => new S.HttpBody().push(bytes("SSH-2.0-OpenSSH\r\n\r\n")), /isn't HTTP/);
});

test("serve-sim: its argv, its JSON, the device's helper and its address", () => {
  const argv = S.serveSimArgv(["--detach", "-q", "UDID-1"]);
  assert.deepEqual([argv[0], argv[1]], ["sh", "-c"]);
  assert.match(argv[2], new RegExp(`npx --yes serve-sim@${S.SERVE_SIM_VERSION.replaceAll(".", "\\.")} `));
  assert.match(argv[2], /SERVE_SIM_DISABLE_DEVICE_HUB_KEYBOARD=1/);
  assert.deepEqual(argv.slice(3), ["sh", "--detach", "-q", "UDID-1"]); // the udid is an argument, never in the script
  assert.deepEqual(S.serveSimJson('motd from .zshrc\n{"running":true,"device":"A","streamUrl":"http://127.0.0.1:3100/helper/A/stream.mjpeg"}\n'), { running: true, device: "A", streamUrl: "http://127.0.0.1:3100/helper/A/stream.mjpeg" });
  assert.deepEqual(S.serveSimJson("nothing here"), {});
  assert.deepEqual(S.serveSimJson("{broken"), {});
  assert.equal(S.runningHelper({ running: false }, "A"), null);
  assert.equal(S.runningHelper({ running: true, device: "B" }, "A"), null); // --list ignores the udid
  assert.equal(S.runningHelper({ running: true, device: "A", streamUrl: "u" }, "A").streamUrl, "u");
  assert.equal(S.runningHelper({ running: true, streams: [{ device: "B" }, { device: "A", streamUrl: "u2" }] }, "A").streamUrl, "u2");
  assert.deepEqual(S.helperAddress("http://127.0.0.1:3100/helper/A/stream.mjpeg"), { host: "127.0.0.1", port: 3100, path: "/helper/A/stream.mjpeg", base: "http://127.0.0.1:3100/helper/A", ws: "ws://127.0.0.1:3100/helper/A/ws" });
  assert.equal(S.helperAddress(undefined), null);
});

test("serve-sim input frames: a tag byte, then JSON", () => {
  const f = S.wsFrame(S.TAG.touch, { type: "begin", x: 0.5, y: 0.25 });
  assert.equal(f[0], 3);
  assert.equal(String.fromCharCode(...f.subarray(1)), '{"type":"begin","x":0.5,"y":0.25}');
  assert.deepEqual([...S.wsFrame(S.TAG.keyboard)], [0x0c]);
  assert.equal(S.touchEdge({ x: 0.5, y: 0.95 }), 3);
  assert.equal(S.touchEdge({ x: 0.5, y: 0.5 }), 0);
  for (let o = "portrait", i = 0; i < 4; i++) { o = S.ROTATE[o]; if (i === 3) assert.equal(o, "portrait"); }
});

test("keys: HID usages with their modifiers, cmd chords left to Herdr", () => {
  const key = (key, modifiers = {}) => S.keyUsages({ key, modifiers });
  assert.deepEqual(key("a"), { usage: 4, modifiers: [] });
  assert.deepEqual(key("z"), { usage: 29, modifiers: [] });
  assert.deepEqual(key("1"), { usage: 30, modifiers: [] });
  assert.deepEqual(key("0"), { usage: 39, modifiers: [] });
  assert.deepEqual(key("enter"), { usage: 40, modifiers: [] });
  assert.deepEqual(key("a", { shift: true }), { usage: 4, modifiers: [225] });
  assert.deepEqual(key("A"), { usage: 4, modifiers: [225] });
  assert.deepEqual(key("?"), { usage: 56, modifiers: [225] });
  assert.deepEqual(key("left", { control: true, alt: true }), { usage: 80, modifiers: [224, 226] });
  assert.equal(key("c", { platform: true }), null);
  assert.equal(key("capslock"), null);
  assert.equal(S.keyUsages({ key: "a" }).usage, 4); // no modifiers on the event
});

test("Android input: touches in pixels, key codes, buttons, the wheel as a swipe", () => {
  const size = { width: 1080, height: 2400 }, I = S.androidInput;
  assert.deepEqual(I.touch("begin", { x: 0, y: 0 }, size), ["input", "motionevent", "DOWN", "0", "0"]);
  assert.deepEqual(I.touch("move", { x: 0.5, y: 0.5 }, size), ["input", "motionevent", "MOVE", "540", "1200"]);
  assert.deepEqual(I.touch("end", { x: 1, y: 1 }, size), ["input", "motionevent", "UP", "1079", "2399"]);
  assert.deepEqual(I.key(4, false), ["input", "keyevent", "29"]); // a
  assert.deepEqual(I.key(4, true), ["input", "keycombination", "59", "29"]); // A
  assert.deepEqual(I.key(39, false), ["input", "keyevent", "7"]); // 0
  assert.deepEqual(I.key(40, false), ["input", "keyevent", "66"]); // enter
  assert.deepEqual(I.key(41, false), ["input", "keyevent", "111"]); // escape
  assert.equal(I.key(58, false), null); // F1
  assert.deepEqual(I.button("home"), ["input", "keyevent", "3"]);
  assert.deepEqual(I.button("lock"), ["input", "keyevent", "26"]);
  assert.equal(I.button("siri"), null);
  assert.deepEqual(I.volume(233), ["input", "keyevent", "24"]);
  assert.deepEqual(I.volume(234), ["input", "keyevent", "25"]);
  assert.deepEqual(I.scroll(0, 0.25, { x: 0.5, y: 0.5 }, size), ["input", "swipe", "540", "1200", "540", "600", "120"]);
  assert.deepEqual(I.scroll(0, 0.9, { x: 0.5, y: 0.5 }, size).slice(4, 6), ["540", "0"]); // stays on the screen
  assert.equal(I.rotate().length, 1); // one string: adb joins its words anyway
  assert.ok(S.isModifier(225) && !S.isModifier(4));
});

test("Android screen size: the override wins, and a turned screen swaps", () => {
  assert.deepEqual(S.parseWmSize("Physical size: 1080x2400\n"), { width: 1080, height: 2400 });
  assert.deepEqual(S.parseWmSize("Physical size: 1080x2400\nOverride size: 720x1600\n"), { width: 720, height: 1600 });
  assert.equal(S.parseWmSize(""), null);
  assert.equal(S.parseWmSize(undefined), null);
  const size = { width: 1080, height: 2400 };
  assert.deepEqual(S.turned(size, 1080 / 2400), size);
  assert.deepEqual(S.turned(size, 2400 / 1080), { width: 2400, height: 1080 });
  assert.deepEqual(S.turned({ width: 2560, height: 1600 }, 2560 / 1600), { width: 2560, height: 1600 }); // a tablet, as it is
});

test("the emulator's frame helper: its port and how it starts", () => {
  assert.deepEqual(S.streamPort("emulator-5554"), { console: "5554", port: 32554 });
  assert.equal(S.streamPort("R5CT123"), null);
  assert.equal(S.streamPort("192.168.1.5:5555"), null);
  const argv = S.helperArgv("/h/mods/devices/android-stream.mjs", "emulator-5556");
  assert.deepEqual(argv.slice(3), ["sh", "/h/mods/devices/android-stream.mjs", "5556", "32556", "540"]);
  assert.match(argv[2], /^nc -z 127\.0\.0\.1 "\$3" && exit 0\n/); // one helper per emulator
  assert.equal(S.helperArgv("/h/x.mjs", "R5CT123"), null);
});

test("the toolbar per platform", () => {
  assert.deepEqual(S.toolsFor({ kind: "sim" }).map((b) => b.id), ["home", "lock", "volume-down", "volume-up", "rotate", "keyboard"]);
  assert.deepEqual(S.toolsFor({ kind: "avd" }).map((b) => b.id), ["home", "lock", "volume-down", "volume-up", "rotate"]);
  assert.deepEqual(S.toolsFor({ kind: "sim" })[2].press, ["hid", 12, 234]);
});

test("the viewer's argv: through the login shell, a simulator by udid, Android by serial with adb", () => {
  const sim = S.viewerArgv("/h/mods/devices/screen-term.mjs", { kind: "sim", id: "U-1", name: "iPhone 17 Pro" }, 27412);
  assert.deepEqual(sim.slice(0, 2), ["sh", "-c"]);
  assert.match(sim[2], /-lic 'exec node "\$@"' node "\$@"$/);
  assert.deepEqual(sim.slice(3), ["sh", "/h/mods/devices/screen-term.mjs", "sim", "U-1", "iPhone 17 Pro", "27412", ""]);
  const avd = S.viewerArgv("/s.mjs", { kind: "avd", id: "Pixel_9", serial: "emulator-5554", name: "Pixel 9" }, 27400, "/sdk/adb");
  assert.deepEqual(avd.slice(4), ["/s.mjs", "android", "emulator-5554", "Pixel 9", "27400", "/sdk/adb"]);
});

test("the layout: the panel's block becomes a bar over the viewer's terminal, and back", () => {
  const block = { id: "devices", type: "block", size: { weight: 1 }, content: { mod: "devices", props: { panel: true } } };
  const layout = { id: "root", type: "row", children: [{ id: "work", type: "block", content: { tab: "active" } },
    { id: "panel-body", type: "stack", active: "devices", children: [{ id: "files", type: "block", content: { mod: "files" } }, block] }] };
  const screen = { device: { kind: "sim", id: "U-1", name: "iPhone" }, terminal: "t9", port: 27401 };
  const wrapped = S.wrapScreen(layout, "devices", "t9", screen);
  // The column takes the block's id and size, so the stack still shows it.
  assert.deepEqual(wrapped.children[1].children[1], { id: "devices", size: { weight: 1 }, type: "column", children: [
    { id: "devices-bar", type: "block", size: { px: S.BAR }, content: { mod: "devices", props: { panel: true, screen: { ...screen, was: { id: "devices", size: { weight: 1 } } } } } },
    { id: "devices-screen", type: "block", content: { terminal: "t9" } },
  ] });
  assert.equal(wrapped.children[1].active, "devices");
  assert.deepEqual(layout.children[1].children[1], block); // the tree it was given is untouched
  // A second screen has no block left to take; a layout without the mod has none at all.
  assert.equal(S.wrapScreen(wrapped, "devices", "t10", screen), null);
  assert.equal(S.wrapScreen({ id: "root", type: "block", content: { tab: "active" } }, "devices", "t9", screen), null);
  // Back: the block again, with the props it had. Another terminal's column is left alone.
  assert.deepEqual(S.unwrapScreen(wrapped, "devices", "t9"), layout);
  assert.deepEqual(S.unwrapScreen(wrapped, "devices"), layout);
  assert.equal(S.unwrapScreen(wrapped, "devices", "t10"), null);
  assert.equal(S.unwrapScreen(layout, "devices"), null);
  // Herdr drops an ended terminal's block, then a column left with one child: both come back whole.
  const column = wrapped.children[1].children[1], bar = column.children[0];
  const inStack = (node) => ({ ...layout, children: [layout.children[0], { ...layout.children[1], children: [layout.children[1].children[0], node] }] });
  assert.deepEqual(S.unwrapScreen(inStack({ ...column, children: [bar] }), "devices", "t9"), layout);
  assert.deepEqual(S.unwrapScreen(inStack(bar), "devices", "t9"), layout);
  // A block without props or an id comes back without props, under the mod's name.
  const bare = S.wrapScreen({ type: "column", children: [{ type: "block", content: { mod: "devices" } }] }, "devices", "t9", screen);
  assert.equal(bare.children[0].id, "devices");
  assert.deepEqual(S.unwrapScreen(bare, "devices").children[0], { id: "devices", type: "block", content: { mod: "devices" } });
});
