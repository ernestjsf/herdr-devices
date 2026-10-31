# Devices

A side panel listing the Mac's iOS simulators, one folding section per runtime,
and its Android emulators and devices, most recently used first, each with a
status glyph and its OS version or API level. Clicking a row boots it (or brings
Simulator forward); hovering shows up to three icons (Boot or Shut down,
Screenshot, More); right-click or More opens the full menu, where Erase lives
behind a confirm dialog. Booting and stopping show as a spinning ring until the
device gets there. It fills a side panel (a Devices button beside Files and
Changes) or a pane.


## What you see

One column on the `background` color, radius 10, 1px `border`, base type 13px
in `foreground`. Top to bottom:

- **Header**, 42px, 14px side padding, 1px `border` underneath. "Devices" at
  13px semibold on the left. On the right a 24px Refresh button (radius 6,
  `hover` under the pointer) with a 14px refresh icon in `muted`; while the
  first read, a Refresh or a panel Screenshot/Copy/URL action runs, a 14px ring
  spinner in `muted` (Herdr's `mods/workspace-chrome/spinner.svg`,
  `.spin(900)`) takes its place. Background polls never show it.
- **The list**, scrolling with a scrollbar, 8px bottom padding:
  - **Section headers** like Files' folders: 26px, 14px side padding, 4px above,
    6px gaps: a 12px chevron in `dim` (Herdr's `mods/files/chevron-down.svg`,
    `chevron-right.svg` when folded), the title uppercased at 11px semibold `dim`
    (`IOS 26.5`, `ANDROID`), and a count badge (5px side padding, radius 4, 1px
    `border`, 10px `muted`) with the section's device count. One section per
    simulator runtime (`com.apple.CoreSimulator.SimRuntime.iOS-26-5` reads `iOS
    26.5`; `xrOS` reads `visionOS`), iOS first then watchOS, tvOS, visionOS,
    newest version first; then Android.
  - **Rows**, 24px, 6px outer side margin, 4px right padding, radius 6, 6px
    gaps, 12.5px type. Left to right: a 2px wide, 14px tall bar slot (drawn
    empty: reserved for a per-space color later), a 9px glyph slot, the name in
    `foreground` (truncated; semibold when booted), the secondary at 11px `dim`
    (never truncated: the runtime's version `26.5`, an AVD's `API 36`, `emulator`
    for an unknown AVD, a phone's `USB` or `Wi-Fi`), during a phase `booting…`
    or `stopping…` at 11px `dim`, then on hover the icons at the right edge.
    Booted rows are tinted `done` at 8% (`done` + `14`); the clicked row is
    `selected`; `hover` under the pointer.
  - **Status glyphs**: booted/online a filled 7px `done` dot; off a 7px ring
    (1px `dim` border); booting/stopping a 9px spinning ring in `working`;
    offline, unauthorized and other adb states an 8px filled triangle in
    `blocked`.
  - **Hover icons**, at most three, 24px squares, radius 5, `raised` under the
    pointer, 13px icons in `muted`: Shut down (power) when on or Boot (play)
    when off — simulators and AVDs, not during a phase; Screenshot (camera) when
    on; More (three dots) always.
  - **Fold row** under a section that has more than it shows: 24px, 23px left
    padding, 11.5px `muted`, `Show all (N)`, and `Show fewer` once open.
  - **Empty and error lines**, centered, 12px, 8px vertical padding: the text in
    `dim`, a `dim` `·`, and one `accent` link: `xcrun not found · Get Xcode`,
    `No simulators · Open Xcode`, simctl's error `· Retry`, `adb not found ·
    Set ANDROID_HOME` (also `emulator not found`), an adb error `· Retry`, `No
    emulators or devices · Open Android Studio`. `Loading devices…` before the
    first read when nothing is cached.
- **Footer**, 28px, 14px side padding, 1px `border` above, 11px `dim`,
  truncated: `5 simulators · 1 emulator · 0 devices · refreshed 10s ago`
  (seconds in steps of 10, then `2m ago`, `1h ago`).
- **Rail**: narrower than 160px, the header holds only Refresh (centered), each
  section is a 1px `border` line with 6px above and below, rows show the bar
  slot, the glyph and the name's first letter uppercased in semibold, and there
  are no hover icons, fold rows or footer.

**The menu** is a 210px popup at the pointer on `popover`, 5px padding, its
height 30px per item plus 38px: a 24px line with the device's name at 11px
`dim`, then 30px rows (radius 7, 9px gap, a 14px icon in `muted`, 12.8px text),
`selected` for the keyboard choice, `hover` under the pointer. Items, in order:
Shut down or Boot, Screenshot and `Open URL…` (when on), `Copy UDID` / `Copy
serial` / `Copy name`, `Erase…` in `ansi1` (icon and text). A running item reads
`Working…`.

**Dialogs** are 420px wide (Open URL 200px tall, Erase 190px) on `popover`,
18px padding, 10px gaps, like Herdr's prompt and confirm: a 15px semibold title
(`Open URL` or `Erase <name>?`) with `Esc` at 11px `dim` on the right, a `muted`
sentence, for Open URL a 36px input (radius 9, 1px `accent` border, `background`
fill, 12.8px, placeholder `https://… or myapp://…`), an error line at 12px
`ansi1` when there is one, and on the right 32px buttons (radius 8, 12.5px
medium): Cancel (`raised`, 1px `input` border) and the action — Open in
`solid` / `solid_foreground`, Erase in `ansi1` with `background` text. The
action button reads `Working…` while it runs.

## How it behaves

- Agent statuses aren't shown: this panel is about devices.
- **Start**: the last list (kept in `localStorage`, with when it was read)
  paints at once; both platforms are read behind it.
- **Simulators**: `xcrun simctl list devices -j`, read again whenever
  `watchFolder("~/Library/Developer/CoreSimulator/Devices")` reports a
  `device.plist` (it is rewritten on boot and shutdown: a boot from any terminal
  shows within about a second), every 15 s, after Refresh and after any action.
  Available ones only; `Booted` is on, `Shutdown` off, `Booting` and `Shutting
  Down` are phases, anything else is shown with a triangle.
- **Android**: every 5 s, after Refresh and after any action: `emulator
  -list-avds`, `adb devices -l`, for each running `emulator-NNNN` `adb -s
  <serial> emu avd name` (first line), and each AVD's `<avd home>/<name>.ini`
  for `target=android-NN`. Every AVD shows, on (with its serial) when a running
  emulator reports its name; other serials are phones by `model:` (underscores
  as spaces). Each platform's reads never overlap; one asked for meanwhile runs
  right after.
- **Order and fold**: each section is sorted by the latest of simctl's
  `lastBootedAt` and this panel's own last action on the device (shared
  `devices.used`); it shows the three most recent plus every device that isn't
  off or has a phase under way. Show all / Show fewer and the header's fold are
  remembered per section title in `localStorage`.
- **Phases**: Boot and Shut down put the device in the shared
  `devices.pending` (`booting` / `stopping`, with the time) before they run, so
  the row spins at once, from the panel or the menu. A read ends a phase when
  the device gets there: booting when on (an AVD also needs `adb -s <serial>
  shell getprop sys.boot_completed` to read `1`, asked only while booting),
  stopping when off or gone; after three minutes in any case; a failed command
  ends it at once.
- **Click a row**: it becomes `selected`. Off and bootable (a simulator, a
  known AVD): Boot. A booted simulator: `open -a Simulator`. Anything else:
  nothing (an emulator window has no app to activate).
- **Hover** shows the row's icons; **More** and **right-click** open the menu
  (up, down, enter, esc work).
- **Actions**:
  - **Boot**: simulator `xcrun simctl boot <udid>` (exit 149, already booted,
    counts as success), then `open -a Simulator`; AVD `sh -c 'nohup "$1" -avd
    "$2" >/dev/null 2>&1 &' sh <emulator> <avd>`, so it starts detached.
  - **Shut down**: `xcrun simctl shutdown <udid>`; `adb -s <serial> emu kill`.
  - **Screenshot**: `xcrun simctl io <udid> screenshot <path>`; Android `adb -s
    <serial> shell screencap -p /sdcard/herdr-devices-shot.png`, `adb pull` it
    to `<path>`, `adb shell rm -f` it (that last step may fail). `<path>` is
    `~/Desktop/<name>-<YYYYMMDD-HHMMSS>.png` (name characters outside
    `[A-Za-z0-9._-]` become `-`). Toasts `Screenshot saved` with the path.
  - **Copy**: the UDID, serial, or (an off AVD) its name to the clipboard;
    toasts `Copied`.
  - **Open URL…**: the dialog; Enter or Open checks the URL has a scheme
    (`https://`, `myapp://`), then `xcrun simctl openurl <udid> <url>` or `adb
    -s <serial> shell am start -a android.intent.action.VIEW -d '<url>'` (the
    URL single-quoted for the device's shell, since `adb shell` joins its words).
  - **Erase…**: the dialog; Enter or Erase runs it. Simulator: `xcrun simctl
    shutdown` (failure ignored), then `xcrun simctl erase <udid>`. AVD: `adb
    devices -l` and the emulators' names are read again; no answer from adb, or
    the AVD running, refuses. Otherwise its folder is the `path=` line of `<avd
    home>/<name>.ini` (avd home `$ANDROID_AVD_HOME`, else `~/.android/avd`),
    else `<avd home>/<name>.avd`, and `sh -c 'rm -rf "$1"/userdata-qemu.img*
    "$1"/snapshots' sh <folder>` deletes its data. Toasts `Erased <name>`.
- An action stops at its first failing command and toasts an error: `Couldn't
  boot <name>` (shut down, take a screenshot of, open the URL on, erase) with
  the first useful line of stderr, then stdout (simctl's generic `An error was
  encountered processing the command` line is skipped). A dialog keeps its
  error on screen and stays open; on success it closes. After any action the
  shared `devices.changed` makes every copy reread.
- The footer's "ago" is redrawn every 10 s. Nothing animates on a background
  refresh.

## Built from

- `mods/devices/`, `mod.json` `{ "place": "none", "title": "Devices" }`: it docks
  nowhere by itself.
- `main.js`: one `View` with four roles by `props().role`: none, the panel;
  `"menu"`, the popup (`openOverlay({ mod: "devices", kind: "popup", width: 210,
  height, props: { role: "menu", device } })`); `"url"` and `"erase"`, dialogs
  (`kind: "dialog", width: 420, height: 200 | 190, props: { role, device }`).
- `devices.js`, no herdr import: parsing (`parseSimctl` with `detail` and
  `lastUsed`, `parseAvds`, `parseAdbDevices`, `parseEmuAvdName`,
  `androidDevices`, `parseAvdIni`, `avdApi`, `phoneLink`), the row model `{
  kind: "sim" | "avd" | "phone", id, name, state, detail, lastUsed?, serial?,
  avd? }`, `deviceKey` (an AVD by name, so its key survives its serial),
  `sortRecent`, `foldRows`, `settlePending`, `phaseOf`, `glyphOf`,
  `actionsFor` (the menu), `hoverActions` (at most three), `primaryAction` (the
  row click), `stepsFor` (the argv of every action), `footerText`,
  `toolCandidates`, `errorLine`, `screenshotPath`, `validUrl`.
- `actions.js`: `loadIos()`, `loadAndroid()`, `bootCompleted(serial)`,
  `focus(device)` and `perform(action, device, { url })` through `exec`.
  `adb` and `emulator` are tried on PATH, then `$ANDROID_HOME`,
  `$ANDROID_SDK_ROOT` (read once with `sh -c 'printf …'`) and
  `~/Library/Android/sdk`; the first that starts is kept.
- Shared state: `devices.changed` (reread), `devices.pending` (phases),
  `devices.used` (last action per device). `localStorage` (per copy): `cache`
  (the last list) and `folds`.
- `herdr` functions: `exec`, `home`, `readTextFile`, `watchFolder`, `notify`,
  `shared` / `setShared`, `openOverlay`, `closeOverlay`, `props`, `theme`.
  gpui-kit: `cx.write_to_clipboard`, `cx.open_url`, `svg(...).spin(900)`,
  `on_hover`, `on_mouse_down("right", …)`, `on_size_change`, `InputState` +
  `Input`.
- Programs: `xcrun`, `open`, `emulator`, `adb`, `sh`, `rm`. No network of its
  own; `Get Xcode` and `Set ANDROID_HOME` open developer.apple.com /
  developer.android.com pages with `cx.open_url`.
- Icons in `icons/` after Lucide (ISC notice there): devices, refresh, play,
  power, camera, copy, link, trash, more, and a filled triangle. Herdr's own
  `spinner.svg` and Files' chevrons.
- The top-bar button lives in clones of Herdr's `tabs` mod and `main` layout,
  as git-graph's `docs/top-bar.md` describes: `"devices"` in the enabled panels,
  a `panelButton("devices", "Devices", "mods/devices/icons/devices.svg")`, and
  a `devices` block in the `panel-body` stack.

## Watch out

- `nextCommand()` returns only the command's name, so Herdr's `confirm` and
  `prompt` mods (which `run` a command with args) can't carry a device id to
  this mod. The menu and dialogs are this mod's own roles and run the action
  themselves.
- The menu and dialogs are other copies of the mod: anything the panel must see
  from them (phases, last use) goes through `shared`, not `localStorage` (per
  copy) or module variables.
- A popup's tasks end when it closes: the menu finishes its command
  (`Working…`) before closing. Copy and the dialogs close it at once.
- `exec` waits for the program and returns text: `adb track-devices` can't
  stream (poll instead), `adb exec-out screencap -p` would corrupt the PNG (go
  through `/sdcard` and `adb pull`), and `emulator -avd` never returns (start it
  through `sh -c 'nohup … &'`, names as positional arguments; the child
  survives `exec` returning).
- `exec` rejects when a program can't start: catch it per tool, or one missing
  SDK hides the other platform's list.
- `watchFolder` on the CoreSimulator folder reports every write of a booted
  simulator: react only to `device.plist`.
- simctl's first stderr line is a generic preamble; the reason is on line two.
- `adb shell` joins its arguments into one device-shell command line: quote
  the URL, or `&` in it splits the command.
- `tell application "<process>" to activate` fails for a process without an app
  bundle (the emulator's `qemu-system-*`), so a booted AVD's click does nothing.
- `.transition` animates only opacity, width, height, left and top, not color:
  the status dot changes color at once.
- A hover icon inside a clickable row must `cx.stop_propagation()`, or the row
  click runs too.
- `cx` is only good inside its handler: write the clipboard before any `await`.
- No hover groups in gpui-kit: the row tracks `on_hover` and redraws.
- `.when(cond, …)` needs a real boolean; create focus handles and input states
  in `init`, never in `render`.
- Herdr hot-reloads on changes under `~/.config/herdr-app/mods/`. A symlinked
  mod folder is loaded and checked fine, but edits in its target don't reload
  it; remove the link and create it again.
- `herdr-app shot` returns the last drawn frame; a window behind another app
  draws nothing, so shots repeat byte for byte. Bring Herdr forward first.
- `done` is the theme's "finished" color, not necessarily green (a pale blue
  in graphite).
- `devices.used` keeps entries for devices that were deleted.
- Untested: Android actions on a running emulator or phone, the rail and the
  dialogs drawn on screen, Linux, zoom other than 1. iOS physical devices
  aren't listed (v1.1, `devicectl`).

## Done when

- `node --test tests/` passes: runtime labels, the captured simctl list (one
  runtime, five simulators, two booted, with versions and lastBootedAt),
  unavailable simulators hidden and runtimes ordered, AVD names with emulator
  chatter, `adb devices -l` with emulators, a phone, offline and unauthorized
  rows, AVD/serial mapping with API levels and USB / Wi-Fi, tool candidates,
  error lines, screenshot paths, recency order (the two booted simulators
  first in the captured list), the fold (three recent plus running and
  pending), phases settling (an AVD only after boot_completed, three minutes at
  most), glyphs, hover icons, the row click, the footer, the menu per row, and
  every action's argv (the URL quoted for `adb shell`, erase refusing a folder
  that isn't an absolute `*.avd`).
- `herdr-app check ~/.config/herdr-app/mods/devices` passes and `herdr-app
  status` shows `"errors": []` with the panel open.
- The panel shows `IOS <version>` and `ANDROID` headers with counts, booted rows
  tinted with a filled dot, off rows with a ring, versions and API levels beside
  the names, and the footer.
- On a throwaway simulator (`xcrun simctl create`): `xcrun simctl boot` and
  `shutdown` in a terminal flip its glyph within about a second; clicking it
  boots it with `booting…` and a spinning ring until it's on; Shut down shows
  `stopping…` until it's off; Boot again succeeds; Screenshot writes a PNG to
  the Desktop; Open URL opens the URL; Erase resets it; Open URL on a shut-down
  simulator toasts `Unable to lookup in current state: Shutdown`.
