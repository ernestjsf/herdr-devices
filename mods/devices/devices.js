// What the device tools print, read into rows, and the argv of every action.
// No herdr imports: the tests run this on captured output.

const OS_ORDER = ["iOS", "watchOS", "tvOS", "visionOS"];

// "com.apple.CoreSimulator.SimRuntime.iOS-26-0" -> "iOS 26.0".
export function runtimeLabel(id) {
  const m = /SimRuntime\.([A-Za-z]+)-(\d+(?:-\d+)*)$/.exec(id);
  if (!m) return id;
  return `${m[1] === "xrOS" ? "visionOS" : m[1]} ${m[2].replaceAll("-", ".")}`;
}

const simState = (s) => (s === "Booted" ? "on" : s === "Shutdown" ? "off" : s.toLowerCase());

// `xcrun simctl list devices -j` -> one section per runtime that has an
// available device, iOS first, newest version first.
export function parseSimctl(json) {
  const sections = [];
  for (const [runtime, list] of Object.entries(JSON.parse(json).devices ?? {})) {
    const devices = list.filter((d) => d.isAvailable).map((d) => ({ kind: "sim", id: d.udid, name: d.name, state: simState(d.state) }));
    if (devices.length) sections.push({ title: runtimeLabel(runtime), devices });
  }
  const rank = (title) => {
    const [os, version] = title.split(" ");
    const i = OS_ORDER.indexOf(os);
    return [i < 0 ? OS_ORDER.length : i, (version ?? "").split(".").map(Number)];
  };
  return sections.sort((a, b) => {
    const [ai, av] = rank(a.title), [bi, bv] = rank(b.title);
    if (ai !== bi) return ai - bi;
    for (let k = 0; k < Math.max(av.length, bv.length); k++) if ((av[k] ?? 0) !== (bv[k] ?? 0)) return (bv[k] ?? 0) - (av[k] ?? 0);
    return 0;
  });
}
