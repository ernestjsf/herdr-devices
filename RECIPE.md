# Devices

Your iOS simulators, connected iPhones and Android emulators and phones in a
Herdr side panel, most recently used first. Hover a device for Boot,
Shut down and Screenshot. The menu adds Open URL, Run Maestro flow, Copy id,
Stop app and Erase. Each row shows the device's state and the app it is running.
Run Maestro flow opens a picker of the project's flows, remembers the last one
and its variables, and runs it in a pane below. A second tag names the agent
driving the device; clicking it jumps to that agent.

![Devices](preview.png)


## What you see

One column on the `background` color, radius 10, 1px `border`, base type 13px
in `foreground`. Top to bottom:

- **Header**, 42px, 14px side padding, 1px `border` underneath. "Devices" at
  13px semibold on the left. On the right a 24px Refresh button (radius 6,
  `hover` under the pointer) with a 14px refresh icon in `muted`; while the
  first read, a Refresh or a panel Screenshot/Copy/URL action runs, a 14px ring
  spinner in `muted` (Herdr's `mods/workspace-chrome/spinner.svg`,
  `.spin(900)`) takes its place. Background polls never show it.
- **Filter field**, not in the rail: 38px in all, 8px side padding, 8px above
  and 2px below a 28px input (8px inner side padding, radius 7, 1px `border`,
  `accent` while it has the keyboard, `background` fill, 12px `foreground`),
  placeholder `Filter devices…`. Outside the list, so the list's click doesn't
  pull the keyboard back. See Filter.
- **The list**, scrolling with a scrollbar, 8px bottom padding:
  - **Section headers** like Files' folders: 26px, 14px side padding, 6px above,
    6px gaps: a 12px chevron in `dim` (Herdr's `mods/files/chevron-down.svg`,
    `chevron-right.svg` when folded), the title at 11px semibold `dim` (`iOS
    26.5`, `Android`), and the section's device count at 11px in `dim` at 60%
    (`dim` + `99`). First `Running` (see Order and fold), when anything runs. Then one section per
    simulator runtime (`com.apple.CoreSimulator.SimRuntime.iOS-26-5` reads `iOS
    26.5`; `xrOS` reads `visionOS`), iOS first then watchOS, tvOS, visionOS,
    newest version first; then Android. These hold only off devices; one left
    with none goes, unless it has an empty or error line. The count is the rows the section lists.
  - **Running rows**, outside the rail, 40px, the same margins, padding, slots and
    gaps, the glyph centered on the row. Then a column: line 1 (24px) the name as
    below and the icons at the right edge; line 2 (16px, 11px `dim`, 8px gaps,
    clipped) under the name: the detail (a simulator's section title, `iOS 26.5`;
    an iPhone's `iOS 26.1 · USB`; Android's `API 36`, `emulator`, `USB`,
    `Wi-Fi`), then `· booting…` (or another phase), then the app tag and the
    agent tag(s) (`runningDetail`). `selected` and `hover` fill the whole 40px.
  - **Rows** (off devices), 26px, 6px outer side margin, 4px right padding, radius 6, 8px
    gaps, 12.5px type. Left to right: a 2px wide, 14px tall bar slot (drawn
    empty: reserved for a per-space color later), a 14px icon slot, the name
    (truncated; `muted`: an off device), then a claim's agent tag (see Claims),
    then on the right, just before the icons, the secondary at 11px `dim` (never
    truncated: an AVD's `API 36`, `emulator` for an unknown AVD; a simulator's
    version is its section's title, so none), and the icons at the right edge,
    dim until the pointer is over them. The clicked row is `selected`; `hover`
    under the pointer. Rows carry no tint of their own. The **app tag** (Running
    rows only, see Apps): 16px tall, 5px side padding, radius 4, `done` at 12%
    (`done` + `1f`) behind 10.5px medium `done` text, at most 96px wide
    (truncated); the agent tag (see Drivers, Claims) has the same shape (the claim
    pill on a Running row: 200px at most).
  - **Icons** (Lucide, in `icons/`): by the device's name, `tablet` (iPad,
    Tablet, Fold, Pad), `watch` (Watch, Wear), `tv` (TV, Television), `glasses`
    (Vision), else `smartphone`. Booted/online the icon is `foreground` with a
    7px `done` dot (1.5px `background` border) over its bottom-right corner,
    3px out to the right and 2px down; off it is `dim`. Booting/stopping a 13px
    spinning ring in `working` takes its place; offline, unauthorized and other
    adb states a 12px filled triangle in `blocked`.
  - **Hover icons**, at most five, 24px squares, radius 5, `raised` under the
    pointer, 13px icons in `muted`: Shut down (power) when on or Boot (play)
    when off — simulators and AVDs, not during a phase, except Shut down while
    `booting` cancels the boot (a simulator always, an AVD once it has a serial);
    Show screen (monitor) when on and not in a phase, where there is a screen to read;
    Screenshot (camera) when on; More (three dots) always.
  - **Fold row** under a section that has more than it shows: 24px, 32px left
    padding (the text lines up with the names), 11.5px `muted`, `Show all (N)`, and `Show fewer` once open.
  - **Empty and error lines**, centered, 12px, 8px vertical padding: the text in
    `dim`, a `dim` `·`, and one `accent` link: `xcrun not found · Get Xcode`,
    `No simulators · Open Xcode`, simctl's error `· Retry`, `adb not found ·
    Set ANDROID_HOME` (also `emulator not found`), an adb error `· Retry`, `No
    emulators or devices · Open Android Studio`. `Loading devices…` before the
    first read when nothing is cached.
- **Footer**, 28px, 14px side padding, 1px `border` above, 11px `dim`,
  truncated: `5 simulators · 1 emulator` (only the kinds
  there are; `No devices` when none); `· refreshed 2m ago` (or `1h ago`) only
  once the last read is a minute old, as when the reads stall.
- **Rail**: narrower than 160px, the header holds only Refresh (centered), each
  section is a 1px `border` line with 6px above and below (Running's first), rows show only the
  icon, centered, 26px, Running's too, with `<name> · booted` (or `off`, `booting…`, the adb state)
  as a tooltip, and there are no hover icons, fold rows, filter field or footer.
  Typed filter text is ignored there.

**The menu** is a 250px popup at the pointer on `popover`, 5px padding, its
height 30px per item, 9px per divider, plus 38px: a 24px line with the device's name at 11px
`dim`, then 30px rows (radius 7, 9px gap, a 14px icon in `muted`, 12.8px text),
`selected` for the keyboard choice, `hover` under the pointer; a hint at 11px `dim`
after the label names the panel's key: `space` on Boot and Shut down, `S` on Screenshot. Items, in sections
parted by a 1px `border` line (8px side margin, 4px above and below): Shut down or
Boot | Screenshot and `Open URL…` (when on) | `Run Maestro flow…` and `Run <flow>
again` | `Release claim` (when the device is claimed) | `Copy app id` and a `Stop <app>` per app (when on with a known app) |
`Copy UDID` / `Copy serial` / `Copy name` | `Erase…` in `ansi1` (icon and text).
Without `maestro` installed `Run Maestro flow…` is a `dim` row (icon and text) with a
`not installed` hint in the key hints' place, no hover or click.
An empty section leaves no divider. Boot and Shut down
close it at once (the row spins); Screenshot reads `Working…` while it runs.

**Dialogs** are 420px wide (Open URL 200px tall, Erase 212px) on `popover`,
18px padding, 10px gaps, like Herdr's prompt and confirm: a 15px semibold title
(`Open URL` or `Erase <name>?`) with `Esc` at 11px `dim` on the right, a `muted`
sentence (Erase's leads with the cost: `Removes every app and its data on
<name>.`, an AVD's adding `; it starts like new`, then how), for Open URL a 36px input (radius 9, 1px `accent` border, `background`
fill, 12.8px, placeholder `https://… or myapp://…`), an error line at 12px
`ansi1` when there is one, and on the right 32px buttons (radius 8, 12.5px
medium): Cancel (`raised`, 1px `input` border) and the action — Open in
`solid` / `solid_foreground`, Erase in `ansi1` with `background` text. The
action button reads `Working…` while it runs.

- **The screen view** takes the panel's place while a device's screen shows
  (Show screen): the panel's block in the layout becomes a column of two.
  - **The bar**, 42px, this mod again (its props carry `screen`), `background`
    with a 1px `border` underneath, 8px at the sides: a 24px Back button (15px
    `chevron-left` in `muted`, radius 6, `hover` under the pointer, tooltip
    `Back to the devices`), the device's name at 13px semibold, truncated, and
    at the right 24px icon buttons (14px icons in `muted`, radius 6, `hover`
    under the pointer, each with a tooltip): Home (`house`), Lock (`lock`),
    Volume down (`volume-1`), Volume up (`volume-2`), Rotate (`rotate-ccw`) and,
    for a simulator only, Keyboard (`keyboard`).
  - **The screen**, the rest: a terminal block running the viewer, which draws
    the picture as large as fits at the frames' aspect ratio, centered, and
    until the first frame one dim line in the middle (`Connecting…`, `Building
    the frame scaler (once)…`).

## How it behaves

- Agent statuses aren't shown, except as a device's driver (below): this panel
  is about devices.
- **Start**: the last list (kept in `localStorage` without its app tags, with when it was read)
  paints at once; both platforms are read behind it.
- **Simulators**: `xcrun simctl list devices -j`, read again whenever
  `watchFolder("~/Library/Developer/CoreSimulator/Devices")` reports a
  `device.plist` (it is rewritten on boot and shutdown: a boot from any terminal
  shows within about a second), every 5 s, after Refresh and after any action.
  Available ones only; `Booted` is on, `Shutdown` off, `Booting` and `Shutting
  Down` are phases, anything else is shown with a triangle.
- **iOS devices**: with each simulator read, `xcrun devicectl list devices -q
  --json-output /dev/stdout --timeout 5` in parallel; any failure (older Xcode,
  non-zero exit, unreadable JSON) means no phones, silently. Only `reality:
  "physical"` devices that are `transportType: "wired"` or `tunnelState:
  "connected"` show (paired devices that are away are dropped, like adb's);
  each is an `on` row `{ kind: "ios", id: udid, detail: "USB" | "Wi-Fi" }` (NBSP in
  names becomes a space) in the section titled `<platform> <osVersionNumber>`,
  created and sorted in with the simulators'; being on, it shows in Running, that
  title on its second line. Click does nothing; the menu has
  Open URL… (`xcrun devicectl device process launch --device <udid>
  com.apple.mobilesafari --payload-url <url>`, Safari only), Run Maestro
  flow… and Copy UDID.
  No apps are asked for.
- **Polls**: both platforms every 5 s (`poll`), and every third tick once a
  platform's list has read the same six times in a row (`pollDue`); a change,
  a watcher, Refresh or an action reads at once.
- **Android**: every 5 s, after Refresh and after any action: `adb devices
  -l`, and for each running `emulator-NNNN` not named yet `adb -s <serial> emu
  avd name` (first line), all at once and not awaited (a hung one can't hold up
  the read; the row shows by serial until a later read). A name is kept until
  adb stops listing its serial. The AVDs are the `<name>.ini` files of the AVD
  home (`readdir` from `fs/promises`; avd home `$ANDROID_AVD_HOME`, else
  `~/.android/avd`) with `target=android-NN` from each, listed again only when
  `watchFolder` on the AVD home reports an `.ini` outside a `<name>.avd/`
  folder, or on Refresh. Every AVD shows, on (with its serial) when a running
  emulator reports its name; other serials are phones by `model:` (underscores
  as spaces). Each platform's reads never overlap; one asked for meanwhile runs
  right after.
- **Apps**: after each successful read, every booted device (simulator `on`,
  adb state `device`) is asked which app runs, all at once, in the background
  (a slow one can't hold up a read; the result is cached per device key in
  `actions.js` and put on the row as `d.apps`, shown from the next read; a
  change nudges the panels to read again). The cache entry goes when the device
  isn't on; a failed call means no suffix. Simulator: `xcrun simctl spawn <udid>
  launchctl list`, each `UIKitApplication:<bundle id>[` line, `com.apple.*`
  dropped (it lists every running app, not only the front one); then one `ps -o
  pid=,%cpu=,etime= -p <pids>` orders them by %cpu descending (under 0.5 is 0:
  the simulator suspends backgrounded apps), then newest launch (etime), then
  id; apps ps doesn't print go last, and if ps fails the order is by id. Android:
  `adb -s <serial> shell dumpsys activity activities`, the package of
  `topResumedActivity=ActivityRecord{... <package>/...}` (older APIs:
  `mResumedActivity`), hidden when it matches
  `^(com\.android\.|com\.google\.android\.(apps\.nexuslauncher|gms|googlequicksearchbox)|android$)`
  or ends in `launcher`. The row shows the last dot-segment of the first id as the
  app tag, its tooltip all the full ids; nothing without an app.
- **Drivers**: which terminal drives a device. With each simulator read, one
  `ps -axo pid=,ppid=,time=,command=` (`time` is CPU time, `[dd-][hh:]mm:ss.ss`,
  minutes past 59 on macOS): every `simulator-server ios --id <udid>` (Maestro
  MCP starts one per simulator or iPhone it drives) has its parents walked, 50
  at most and never past pid 1, until one is a live terminal's `pid` or
  `foreground.pid` in `terminals()`. It is active when its CPU time grew since
  the previous read (the panel keeps each server's last CPU time; a first
  sighting isn't) and its terminal's agent, if it is one, is `working`: an idle
  agent's server still ticks 0.01 to 0.5 s now and then. Otherwise attached.
  This panel's Run Maestro pane (`isMaestroPane`) drives its device, active,
  while its `foreground.argv` is still the `sh -c … maestro --device` command;
  once it execs the shell, it drives nothing. One driver per terminal (the
  pane wins over its own run's server); the first is the active one, then the
  agent whose status changed last (`agents()`' `seq`). The row's tag (`deviceTags`, one
  pill, see Claims) shows the first: its terminal's `program.key` (`claude`,
  `codex`), else its address; the pane reads `maestro`. With a driver it brightens
  under the pointer (`hover` on `raised`, `foreground` text; or the tone at `40`),
  the row's only tag that does. Color is liveness: active `working` (`working` + `1f` behind), attached with its
  agent `blocked` likewise in `blocked`, else `muted` on `raised`. The tooltip
  has a line per driver: `Click to focus <program name> · <space> / <tab> · <status> · driving now`
  (or `attached, idle`) `· via Maestro MCP` (or `· this panel's Run Maestro
  pane`), then `Not claimed` when no claim. A click runs `agent.focus {terminal}` for an agent, else `pane.focus
  {terminal}`, without the row's click; right-click opens the row's menu. Not in
  the rail. Android via Maestro MCP is not tagged: no per-device process was
  found to read (no emulator was running to look).
- **Claims**: which agent holds a device. A claim is the folder
  `~/.cache/herdr-devices/claims/<id>`, made by the agent with a plain `mkdir`
  (one creator wins) and holding `pid` (the agent's process), optionally
  `owner` (its first line, 40 characters at most, is the tag's label) and
  `start` (the process's start as `LC_ALL=C TZ=UTC ps -o lstart=` prints it, so a pid reused by
  another process later isn't taken for the holder). The `pid` file's mtime is the holder's last use
  (the hook touches it on every call): `readClaims` gets every claim's at once from one
  `sh -c 'cd <claims>; stat -f "%m %N" */pid || stat -c "%Y %n" */pid'` (`pidMtimesArgv`,
  `parsePidMtimes`; `fs` has no stat), as `used` (ms); a failure leaves it unknown. `<id>` is
  `claimId(d)`: what Maestro's `--device` takes, the UDID for `sim` and `ios`,
  the serial for `avd` and `phone`; an off AVD has none. At start the panel runs
  `mkdir -p` on the folder through `exec` (`fs/promises` writes only under the
  app's folder), reads it (`readClaims` -> `claimsFrom`), and reads again on
  every `watchFolder(dir)` change and every iOS read. On the iOS read, before
  the one `ps` (which lists `lstart=` too), the claims are read; `staleClaims(claims, rows)` are those whose
  `pid` is absent from the rows, or present with another start than the claim's `start`
  (compared only when both are known), `dropClaims` removes each (`dropClaimArgv`: ids must pass
  `CLAIM_ID`; under the hook's `.takeover.<id>` lock folder, and only while the `pid` file
  still names that holder, so a takeover since keeps its claim), and the claims are read once more. No usable `pid`: kept. No ps
  rows: nothing dropped. Then the same rows give each claim's **holder** (`claimHolders`, by pid):
  the terminal whose `pid` or `foreground.pid` the claim's pid is, or whose its parents reach
  (the Drivers walk); none without ps rows. The row has one agent pill, not in the rail (same shape as the
  app tag: 16px tall, 5px side padding, radius 4, 10.5px medium, 96px at most, truncated; the
  claim pill on a 40px Running row 200px), a 10px icon, 3px gap, then on a claim the holder's
  `program` icon at 10px when it has one (`svg` when `tint`, else `image`), the text (truncated),
  the idle text in `dim` and a `×`. Icon = relationship: `lock` claimed, `link`
  a driver and no claim, `triangle` mismatch. Color = liveness, as under Drivers (claimed
  with no driver: idle; idle too once the claim can be taken over). Text: the holder agent's
  `title`, else its `tab_name`, else `space_name` (trimmed), else the claim's owner, else the
  first driver's key; a claim with none shows the icon alone. Idle text (`idleText(used, now)`, `now`
  the render's): under 2 minutes none, then `idle 14m`, from an hour `idle 2h`; only on a claim with
  a `pid`, a `start` (the hook's: one made by hand never goes idle) and a known `used`. From 15
  minutes (the hook's default; the env var isn't read) the pill is idle-toned. The 10 s re-render
  (the footer's) keeps it current. Mismatch: with a holder, there are drivers and none is in the
  holder's terminal; without, the claim has an owner and no driver's key equals it,
  case-insensitively (a pane driver reads `maestro`). Then two pills, the claim (`lock`, idle)
  then the driver (`triangle`, `blocked`, key, clickable). Ids `tag-<key>` and `driver-<key>`.
  A claim pill with a holder clicks to it, driving or not (`agent.focus {terminal}` for an agent,
  else `pane.focus {terminal}`); without one, only when it stands for the first driver (no
  mismatch), to that driver. Hover only with a click. Tooltip: with a holder `Click to focus
  <program name>`, then `Claimed by <agent program name, else owner>` (or `Claimed`) `· <space> / <tab> ·
  <status> · pid <n> · idle 14m` (each when known) `· another agent can take it over` (from 15
  minutes), then the driver lines (one per line), or `· not attached`. The claim pill's `×`
  (11px `dim`, `foreground` under the pointer, 2px side padding, its own hit area, tooltip
  `Release claim`) stops the click there and runs the release; not on the link or triangle pill.
  Hover is style only: no `cx.notify()`. The menu gets `Release claim` (icon `square`) after the Maestro items
  while the device is claimed: `rm -r <claims>/<id>`, refused unless the id
  passes `CLAIM_ID` and the folder is absolute.
  **Hook** (`hooks/claim.sh <label>`, POSIX sh, no dependencies, hook JSON on stdin): the agent is the
  first ancestor of the script that is not sh, bash, zsh or dash (`ps -o ppid=,comm=`; `$PPID` if the walk
  fails). On `PreToolUse` for a tool matching `mcp__*maestro*` with a `device_id` that passes the `CLAIM_ID`
  pattern, it `mkdir`s the claim and writes `pid`, `owner` (the label) and `start` (`ps -o lstart=`). If the folder exists: the same
  pid passes and stamps the claim (`touch` of its `pid` file, on `PostToolUse` too, which does nothing else; `take_screenshot` and `inspect_screen` stamp too,
  and otherwise pass without a claim; `device_id` `chromium`, Maestro's web browser, is never claimed); another live pid (`ps -o lstart= -p`, not `kill -0`, which fails on another user's process too)
  whose start matches the recorded one (or with none recorded), or no usable pid (a manual reservation),
  denies with exit 2 and a reason on stderr (`since` from `stat -f %Sm`, else GNU `stat -c %y`; then the
  booted devices with no claim folder as `name (id)`, from `xcrun simctl list devices booted` and, only while
  an adb server runs, `adb devices`, listed in the background and given 3 s at most, else the advice to call `list_devices`); a dead
  or reused pid, or a live holder with a recorded start whose `pid` file is older than 15 minutes
  (`HERDR_DEVICES_IDLE_MIN`; checked again under the lock), is taken over under a lock folder `.takeover.<id>` (`mkdir`; removed on exit by a trap,
  or by the next hook once it is a minute old, should a killed hook leave it), with the pid read again
  under it, so two hooks seeing the dead holder at once can't both claim: the second is denied. A folder
  that vanished between the first `mkdir` and the read (a takeover removed it) is claimed with a second
  `mkdir`, not left unclaimed. On `SessionEnd` it removes the folders whose pid is the agent's. Anything
  else, and any failure, exits 0 (fail open).
- **Hook hint**: under the list, above the footer, not in the rail: a `line()`
  (`Agents don't claim devices yet · Claude Code · Codex`, then a dim `×`; `line()` takes one link or an array).
  Shown while `maestroFound()` and not `hookInstalled()` (`actions.js`, read
  once a minute, true until the first read; `hookDetected` over
  `~/.claude/plugins/installed_plugins.json` with a `herdr-devices@…` install
  whose scope isn't `local` (that belongs to one project, maybe another),
  `~/.claude/settings.json`, `~/.claude/settings.local.json`, `~/.codex/hooks.json`
  or `~/.codex/config.toml` containing `claim.sh`; a failed read is not installed) and not hidden. Each
  link copies its harness's command from `INSTALL` (toast `Copied`): Claude
  Code, `claude plugin install herdr-devices --marketplace
  ernestjsf/herdr-devices`; Codex, a `git clone` into `~/.codex/herdr-devices`
  then `hooks/install-codex.sh` (writes `~/.codex/hooks.json` when missing,
  else prints the entries to merge);
  `×` sets `hintHidden` in the panel's `localStorage`. The list gives up 32px
  of height while it shows.
- **Running**: every device, iOS and Android, whose state isn't `off` (booted,
  offline, unauthorized, anything else) or that has a phase under way
  (`phaseOf`, so a `devices.pending` boot of an off device too) leaves its
  section for `Running` on top (`splitRunning`); omitted when empty. Its rows
  never fold (the fold keeps every row not off) and it has no fold row; its
  header still closes it (`folds.closed["Running"]`).
- **Order and fold**: each section puts booted devices (and those with a
  phase under way) first, then sorts by the latest of simctl's
  `lastBootedAt` and the device's last use (shared `devices.used`: this
  panel's last action on it, or the read that first saw it on after it was
  off, booting or offline, wherever it was started; a complete read drops the
  entries of its platform's devices that are gone); it shows every device that isn't
  off or has a phase under way, plus the three most recent off ones. When every section unfolded fits the list's
  height (a header 32px with its margin, a row 26px, a Running row 40px outside the rail, a closed section only its
  header; the list is the panel less border 2, header 42, filter field 38 and footer 28 outside the rail,
  hint 32 when shown, padding 8), all rows show and no fold row does. Show all / Show fewer and the header's fold are
  remembered per section title in `localStorage`.
- **Filter**: typing in the field keeps the devices whose name holds the text
  (trimmed, any case; `filterSections`), not persisted. While it isn't empty
  every section shows all its matches (folds and closed headers ignored, no
  fold row, the header doesn't fold), sections without one go, counts are the
  matches, and the Running split still applies; none at all is one `line()`,
  `No devices match`. A selected row filtered out counts as none.
- **Phases**: Boot and Shut down put the device in the shared
  `devices.pending` (`booting` / `stopping`, with the time, and an AVD's name)
  before they run, so the row spins at once, from the panel or the menu (which
  hands them to the panel through the shared `devices.request` and closes).
  Erase moves a simulator through `stopping` and `erasing`, an AVD through
  `erasing` and `stopping`. A read ends a phase when the device gets there:
  booting when on (an AVD also needs `adb -s <serial> shell getprop
  sys.boot_completed` to read `1`, asked only while booting), stopping when off
  or gone; after three minutes in any case; a failed command ends it at once.
  An AVD booting or erasing for over 10 s whose emulator `pgrep -f -- "-avd
  <name>( |$)"` no longer finds ends at once with `Couldn't boot <name>` (or
  erase) and the last non-empty line of its log, else `emulator exited`.
- **Click a row**: it becomes `selected`, and nothing else (in the rail, which has no
  hover icons, the click also does what the window icon does). **Bring window forward** (the
  `app-window` hover icon after the power icon, or Enter, on a booted simulator or AVD): its window
  to the front (`focusCommand`). macOS simulator: `osascript` clicks its item in
  Simulator's Window menu (needs Accessibility access; else `open -a Simulator`);
  macOS AVD: `osascript` sets its `qemu-system-*` process (from `pgrep`)
  frontmost; Linux AVD: `xdotool search --name "Android Emulator - <avd>:<port>"
  windowactivate`; Windows AVD: `WScript.Shell` `AppActivate` on that title.
  Anything else: nothing. A click never boots; the Boot icon does. In the rail,
  which has no icons, a click boots an off simulator or AVD.
- **Keys**, once a row or the list was clicked (the panel's root tracks a focus
  handle): up / down move the selection through the shown rows of every open
  section, top to bottom, wrapping (with none, or one no longer shown, down
  takes the first, up the last); Enter does the row click (not the rail's
  boot); space does what the row's power icon does: boots an off simulator or AVD,
  shuts down a booted one, or cancels its boot; nothing in another phase; `s` takes a screenshot where the row offers one; `m` opens
  the menu; Escape empties a non-empty filter, else clears the selection. Only whole keystrokes, so `cmd-m`
  passes through; other keys propagate. While the filter field has the keyboard
  (its `focus` / `blur` events; `InputState` can't be asked) only up, down and
  Escape are the list's: letters and space type, Enter is the field's submit,
  which does the selected row's click (and so moves the keyboard to the root).
  Clicking a row or the list gives the root the keyboard back.
- The row's icons are always shown, dim until hovered, each with its label as a
  tooltip; **More** and **right-click** open the menu
  (up, down, enter, esc work).
- **Actions**:
  - **Boot**: simulator `xcrun simctl boot <udid>` (exit 149, already booted,
    counts as success), then `open -a Simulator`; AVD `sh -c 'log=$1; shift;
    mkdir -p "$(dirname "$log")"; nohup "$@" >"$log" 2>&1 &' sh <log>
    <emulator> -avd <avd>`, so it starts detached, its output in `<log>` =
    `$TMPDIR/herdr-devices-<avd>.log` (without `$TMPDIR`,
    `~/Library/Caches/herdr-devices/`, or `~/.cache/herdr-devices/` off macOS;
    never the shared `/tmp`).
  - **Shut down**: `xcrun simctl shutdown <udid>`; `adb -s <serial> emu kill`.
  - **Screenshot**: `xcrun simctl io <udid> screenshot <path>`; Android `adb -s
    <serial> shell screencap -p /sdcard/herdr-devices-<file>`, `adb pull` it
    to `<path>`, `adb shell rm -f` it (that last step may fail). `<path>` is
    `~/Desktop/<name>-<YYYYMMDD-HHMMSS>-<ms>.png`, `<file>` its file name (name
    characters outside `[A-Za-z0-9._-]` become `-`). Toasts `Screenshot saved` with the path.
  - **Copy**: the UDID, serial, or (an off AVD) its name to the clipboard;
    toasts `Copied`.
  - **Copy app id** / **Stop <app>**: the first app's full id to the clipboard;
    `xcrun simctl terminate <udid> <id>` or `adb -s <serial> shell am
    force-stop <package>`, one Stop per app, between Open URL… and Copy.
  - **Open URL…**: the dialog; Enter or Open checks the URL has a scheme
    (`https://`, `myapp://`), then `xcrun simctl openurl <udid> <url>` or `adb
    -s <serial> shell am start -a android.intent.action.VIEW -d '<url>'` (the
    URL single-quoted for the device's shell, since `adb shell` joins its words).
  - **Run Maestro flow…**: on any booted device, connected ones too. Without `maestro`
    (`maestroFound()`: `sh -c 'command -v maestro'`, rechecked every 60 s, true until
    the first answer) the row is `dim` with a `not installed` hint and does nothing. The menu
    row shows `Working…` while `maestroStart()`
    finds the tab's folder (the focused terminal's, else the tab's first with
    one, else home) and, when it has a `.maestro`, its flows (`find -H <dir>
    -maxdepth 4 -type f ( -name *.yaml -o -name *.yml )`; the top-level
    `config.yaml` is Maestro's config, not a flow), then opens the dialog at
    its size. The picker: "Run Maestro flow", `on <device> · ~/…/.maestro` in
    `muted`, a filter field past 6 flows (substring of folder + name; typing
    selects the first match and hides All flows; none: "No flows match"), then
    30px menu-style rows: **All flows** (flask icon, a `border` line under it,
    runs the folder) and each flow, its subfolder in `dim` before its name,
    sorted by folder then name. Up/down wrap, Enter or Run runs the selected
    row, a click runs that row, hover only paints. The flow last run per folder
    (shared `devices.maestroLast`) starts selected; the order never changes.
    Under the list a Variables field (`KEY=VALUE, space separated (maestro
    -e)`, styled like the filter): it shows the selected row's variables
    (shared `devices.maestroVars`, flow -> its text) as the keys move the
    selection, until typed in. `parseVars` accepts whitespace-separated
    `/^[A-Za-z_][A-Za-z0-9_]*=.*$/` words; anything else shows "Variables are
    KEY=VALUE, space separated" in red under it and nothing runs. Enter in it
    runs the selected row. Running a row saves its text for that flow (empty
    deletes it). Browse… (`pickFolder`) runs the folder picked with the typed
    variables. No `.maestro`, or `find` failing: the path field instead,
    prefilled with the folder, with Browse… and Run, no variables. Either way
    any terminal of this device's Maestro run (`terminals()` with the name
    `maestro · <device>`, or its argv, since the name doesn't reach the core)
    gets `terminal.kill`, even mid-run, then `terminal.open` runs `sh -c
    'dev=$1; flow=$2; shift 2; maestro --device "$dev" test "$@" "$flow"; …;
    exec "$SHELL" -l' sh <id> <path> [-e KEY=VALUE …]` in a pane below, in that
    folder. It prints `[maestro exited N]` and, when N isn't 0, `debug output:
    <newest folder under ~/.maestro/tests>`.
  - **Run *flow* again**: right under Run Maestro flow… when the tab's folder
    (`maestroCwd()`) has a last flow; `openMenu` reads it, so the popup's
    height counts the row. Runs it at once with its remembered variables.
    Not offered when `maestro` isn't installed.
  - **Erase…**: the dialog; Enter or Erase runs it. Simulator: `xcrun simctl
    shutdown` (failure ignored), then `xcrun simctl erase <udid>`; toasts
    `Erased <name>`. AVD: `adb devices -l` and the emulators' names are read
    again and `pgrep` asked; no answer from adb, or the AVD running, refuses.
    Otherwise its folder is the `path=` line of `<avd home>/<name>.ini`, else
    `<avd home>/<name>.avd` (refused unless an absolute `*.avd` path); `rm -rf
    <folder>/snapshots` deletes only its snapshots (a quick-boot snapshot would
    restore the old data), then the boot launch runs `<emulator> -avd <avd>
    -wipe-data -no-snapshot -no-window`, logged the same way, and the dialog
    closes. The row spins `erasing…`; the read that finds it booted
    (`sys.boot_completed`) runs `adb -s <serial> emu kill`, toasts `Erased
    <name>` and spins `stopping…` until it's off.
- An action stops at its first failing command and toasts an error: `Couldn't
  boot <name>` (shut down, take a screenshot of, open the URL on, erase) with
  `<tool> not found` when the program can't be found, `<Action> timed out` when
  `exec` stopped it after 30 s, else the first useful line of stderr, then
  stdout (simctl's generic `An error was encountered processing the command`
  line is skipped). A dialog keeps its
  error on screen and stays open; on success it closes. After any action the
  shared `devices.changed` makes every copy reread.
- The footer's "ago" is redrawn every 10 s. Nothing animates on a background
  refresh.

- **Show screen** (the `monitor` hover icon of a running row, or `V` on the selected
  row; not in the menu): for a booted simulator, a running emulator and an
  authorized phone, never a connected iPhone.
  - **Starting**: `hc run --json --bg --no-parent --rm -- <viewer>` gives the
    viewer (`node screen-term.mjs sim <udid> <name> <port>` or `android <serial>
    <name> <port> <adb>`, through `"$SHELL" -lic`) a terminal of its own, with a
    port between 27400 and 27899 for the bar's buttons.
  - **Into the layout**: the shown layout's file (`layouts/<shared "layout">.json`)
    is read, the first block whose content is this mod becomes a column (same
    id, same size) of the bar block (`<id>-bar`, 42px, the mod with its props
    plus `screen: { device, terminal, port, was: { id, size } }`) and a terminal
    block (`<id>-screen`), and written back with `writeTextFile`'s expected
    text, tried twice. A copy that is no layout block (a pane) gets the viewer
    as a pane instead: `terminal.keep {terminal, place: "right"}`.
  - **Back**: the bar writes `quit` to the viewer's port (or ends its terminal
    when the port doesn't answer), then turns the column back into the block.
    The bar also asks `hc get <terminal>` every 2 s and does the same when the
    viewer ended by itself (Ctrl-C, the device went off). Herdr drops an ended
    terminal's block from the file, and then a column left with one child, so
    the bar is recognised in its column of two, alone in it, or bare.
  - **Simulator frames**: `npx --yes serve-sim@0.1.49` through the login shell
    (with `SERVE_SIM_DISABLE_DEVICE_HUB_KEYBOARD=1`): `--list -q` for a helper
    already running for the device, else `--detach -q <udid>`; a helper the
    viewer started is stopped (`--kill <udid>`) when it ends. Its `streamUrl`
    is an MJPEG stream of full-size JPEGs. Each goes through `frame-scale`
    (built once from `frame-scale.swift` with `xcrun swiftc -O` into
    `~/.cache/herdr-devices/`), which answers raw RGBA at the size asked for:
    at most 656px on the long side while frames keep coming (a quarter of the
    device's own size, the cheapest to decode), and the picture's full pixel
    size 350 ms after the last one, from a second scaler process, compressed
    off the main thread, and only while no finger is down. Per scaler one
    frame is scaled at a time and the newest waiting one wins; a frame equal
    to the last is skipped.
  - **Android frames**: `android-stream.mjs` (unless `nc -z` finds it listening)
    reads the emulator's gRPC `streamScreenshot` and serves its PNGs as a
    multipart stream on `27000 + console port`, at the picture's pixel width
    (360 to 1080); it exits 3 s after its last viewer. When it doesn't start
    (an emulator without gRPC) and for a phone: `adb exec-out screencap -p`,
    at most twice a second.
  - **Onto the screen**: the Kitty graphics protocol. A frame is transmitted
    and placed in one command (`a=T`, `c` and `r` the picture's cells, `C=1`,
    `q=1`) as deflated RGBA (`f=32,o=z`) or as the PNG it is (`f=100`), in
    4096-byte base64 pieces, under one of two image ids in turn, and the other
    id is deleted after it, all inside synchronized output. Herdr's terminal
    takes PNG and raw pixels inline; it refuses JPEG and file paths.
  - **Cells**: the mouse is asked for in pixels (`1002`, `1006`, `1016`). A
    cell's width is 0.6 of the app's font size, its height the terminal's answer
    to `CSI 16 t` (asked at the start and after each resize; points in a tab,
    pixels in a layout block, a fixed 10x20 while not shown), two pixels a point.
  - **Pointer**: press, drag and release on the picture are one finger (begin,
    move, end) in 0..1 fractions of it; a drag that leaves the picture stays at
    its edge. The wheel scrolls 0.12 of the screen a notch (iOS: serve-sim's
    scroll; Android: a 120 ms `input swipe` from the pointer). A press that
    starts in the bottom 7% of a simulator carries the home-indicator edge.
  - **Keys**: what the terminal types, once the screen was clicked: letters,
    digits, symbols (a shifted one as its key with Shift), Enter, Backspace,
    Tab, Escape, the arrows, Home, End, Delete, Page Up and Down. HID usages on
    iOS, pressed and released at once; on Android `input keyevent`, with
    `keycombination 59 <code>` for Shift. Ctrl-C or Ctrl-D ends the viewer.
    Android coordinates use `wm size`, swapped while the frames are wider than tall.
  - **The device goes away**: the stream ends, the viewer ends, and the bar
    brings the panel back.
  - **Hidden**: a copy whose props carry `panel` (its block's id in
    `panel-body`, or `true` for `devices`) stops streaming while the `panel`
    column is hidden or `panel-body` shows another child, and looks again every
    500 ms. Other copies stream until Back.

## Built from

- `mods/devices/`, `mod.json` `{ "place": "none", "title": "Devices" }`: it docks
  nowhere by itself.
- `main.js`: one `View` with six roles by `props().role`: none, the panel;
  `"claimed"`, a dialog the menu opens instead of Run Maestro flow or Run again on a claimed device
  (`props: { role, device, owner, next, path, cwd }`; "<name> is claimed", Cancel and Run anyway, which
  does what the row would have);
  `"menu"`, the popup (`openOverlay({ mod: "devices", kind: "popup", width: 250,
  height, props: { role: "menu", device, cwd, lastFlow } })`); `"url"`, `"erase"` and
  `"maestro"`, dialogs (`kind: "dialog", width: 420, height: 200 | 212, props:
  { role, device }`; Maestro adds `cwd, path, flows`, 230 high without flows,
  else `78 + (filter ? 46 : 0) + min(flows + 1, 8) × 30 + 118`, at most 482).
- `devices.js`, no herdr import: parsing (`parseSimctl` with `detail` and
  `lastUsed`, `avdNamesFrom`, `avdListChanged`, `parseAdbDevices`,
  `parseEmuAvdName`, `nameCache`, `parseIosApps`, `parseAndroidApp`, `appSegment`,
  `androidDevices`, `parseAvdIni`, `avdApi`, `phoneLink`), the row model `{
  kind: "sim" | "ios" | "avd" | "phone", id, name, state, detail, lastUsed?, serial?,
  avd? }`, `deviceKey` (an AVD by name, so its key survives its serial),
  `sortRecent`, `updateUsed`, `foldRows`, `fitsUnfolded`, `filterSections`, `splitRunning`,
  `runningDetail`, `settlePending`, `launchStep`, `phaseOf`, `glyphOf`,
  `actionsFor` (the menu), `dividerBefore` and `menuDividers` (its sections), `hoverActions` (at most five), `primaryAction` (the
  row click), `toggleAction` (space), `stepSelection` (up / down), `stepsFor` (the argv of every action), `footerText`,
  `toolCandidates`, `stillMissing`, `checkedLately`, `sameApps`, `dropClaimArgv`, `execFailure`, `rejectionLine`,
  `errorLine`, `emulatorLogPath`, `avdProcessPattern`, `lastLine`,
  `screenshotPath`, `validUrl`, `maestroArgv`, `parseVars`, `maestroPaneName`, `isMaestroPane`, `flowsDefault`, `findFlowsArgv`,
  `flowRows` (find's paths -> `{ label, sub, path }`), `maestroRunning`, `parsePs`,
  `driversFrom` (ps rows, terminals, last CPU times -> `{ drivers, cpu }`), `claimHolders`,
  `deviceDrivers`, `driverTag`, `claimId`, `CLAIM_ID`, `claimsFrom`, `pidMtimesArgv`, `parsePidMtimes`, `idleText`,
  `staleClaims`, `deviceTags`, `hookDetected`.
- `actions.js`: `loadIos()`, `loadAndroid()`, `bootCompleted(serial)`,
  `emulatorRunning(avd)`, `emulatorLastLine(avd)`, `endWipe(device)`,
  `avdHome()`, `forgetAvds()`, `forgetTools()`, `killEmulator(avd)`, `focus(device)`, `maestroCwd()`, `maestroStart()`,
  `runMaestro(device, path, cwd, vars)`, `readPs()`, `readClaims()`, `hookInstalled()`, `dropClaims(ids)` and `perform(action, device, { url })`
  through `exec`. `adb` and `emulator` are tried from the path that
  worked last, then PATH, `$ANDROID_HOME`, `$ANDROID_SDK_ROOT` (read once with
  `$ANDROID_AVD_HOME`, `$TMPDIR` and `uname -s` by `sh -c 'printf …'`) and
  `~/Library/Android/sdk`; the first that starts is kept. A path that stops
  starting is dropped and the others tried again; when none starts, the tool
  is "not found" for a minute, or until Refresh or Retry (`forgetTools()`, which also reads the SDK environment again).
- `screen.js`, no herdr import (the viewer imports it too): `canShow`,
  `imageAspect` (PNG, JPEG), `HttpBody`, `Multipart`, `serveSimArgv`,
  `serveSimJson`, `runningHelper`, `helperAddress`, `wsFrame` and `TAG`,
  `ROTATE`, `touchEdge`, `keyUsages`, `androidInput`, `parseWmSize`, `turned`,
  `streamPort`, `helperArgv`, `toolsFor`, `viewerArgv`, `wrapScreen`,
  `unwrapScreen`, `BAR`.
- `screen-view.js`: `showScreen(d)`, which the panel calls, and `ScreenBar`,
  the mod's part while its props carry `screen`. Adds `net`, and herdr's `hc`,
  `readTextFile`, `writeTextFile` and `appHome` (read through the module
  object so an older Herdr still loads the mod).
- `screen-term.mjs`: the viewer, run by node. `frame-scale.swift`: its JPEG
  scaler. `android-stream.mjs`: the emulator's frame helper, run by node.

- Shared state: `devices.changed` (reread), `devices.pending` (phases),
  `devices.used` (last use per device), `devices.maestroLast` (folder -> the flow last run there), `devices.maestroVars` (flow -> its variables), `devices.request` (a Boot or Shut down
  from the menu, for the panel to run: taken once, ignored after 10 s). `localStorage` (per copy): `cache`
  (the last list) and `folds`.
- `herdr` functions: `exec`, `home`, `readTextFile`, `watchFolder`, `notify`,
  `shared` / `setShared`, `openOverlay`, `closeOverlay`, `props`, `theme`,
  `pickFolder`, `focused`, `panes`, `terminals`, `agents`, `run` (`terminal.open`,
  `terminal.kill`, `agent.focus`, `pane.focus`); `readdir` from `fs/promises`.
  gpui-kit: `cx.write_to_clipboard`, `cx.open_url`, `svg(...).spin(900)`,
  `on_hover`, `on_mouse_down("right", …)`, `on_size_change`, `InputState` +
  `Input`.
- Programs: `xcrun`, `open`, `emulator`, `adb`, `sh`, `rm`, `pgrep`, `find`, `ps`. No network of its
  own; `Get Xcode` and `Set ANDROID_HOME` open developer.apple.com /
  developer.android.com pages with `cx.open_url`.
- Icons in `icons/` after Lucide (ISC notice there): devices, refresh, play,
  power, camera, copy, link, trash, more, flask, square, smartphone, tablet,
  watch, tv, glasses, and a filled triangle. Herdr's own
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
- A popup's tasks end when it closes, plain promises included: the menu
  finishes Screenshot (`Working…`) before closing, and hands Boot and Shut down
  to the panel through `devices.request`. The panel takes it on its next
  render, and a window behind another app (Simulator, the emulator) doesn't
  render: in use the menu was just clicked, so Herdr is in front.
- `exec` waits for the program and returns text: `adb track-devices` can't
  stream (poll instead), `adb exec-out screencap -p` would corrupt the PNG (go
  through `/sdcard` and `adb pull`), and `emulator -avd` never returns (start it
  through `sh -c 'nohup … &'`, names as positional arguments; the child
  survives `exec` returning).
- `exec` rejects when a program can't start (`` `herdr.exec`: cannot run <cmd>:
  No such file or directory (os error 2) ``, also for a missing `cwd`) and when
  it runs past 30 s (`` `herdr.exec`: <cmd> took longer than 30 s and was
  stopped ``; the program is killed): catch it per tool, or one missing SDK
  hides the other platform's list.
- `fs/promises` reads only under the home folder: an AVD home elsewhere lists
  no AVDs.
- `watchFolder` on the AVD home reports a running emulator's writes inside its
  `<name>.avd/` (`hardware-qemu.ini` too): react only to `.ini` outside it.
- The emulator's process is `qemu-system-* -avd <name> …`; anchor the `pgrep`
  pattern after the name, or `Pixel_7` finds `Pixel_7_API_34`.
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
- No hover groups in gpui-kit, and redrawing the panel on every row hover (`on_hover` +
  `cx.notify()`) made the whole mod lag: the icon strip is always in the row at opacity 0.4
  and its own `hover` brings it to 1.
- `.when(cond, …)` needs a real boolean; create focus handles and input states
  in `init`, never in `render`.
- Herdr hot-reloads on changes under `~/.config/herdr-app/mods/`. A symlinked
  mod folder loads and checks fine, but its SVG icons never draw (the app
  serves assets from real paths under its home only) and edits in its target
  don't reload it. Install a copy and sync it after each edit: `rsync -a
  --delete mods/devices/ ~/.config/herdr-app/mods/devices/`.
- `herdr-app shot` returns the last drawn frame; a window behind another app
  draws nothing, so shots repeat byte for byte. Bring Herdr forward first.
- `done` is the theme's "finished" color, not necessarily green (a pale blue
  in graphite).
- Untested: AVD erase run live, Android screenshot / Open URL on a running
  emulator or phone, the rail and the dialogs drawn on screen, Linux, zoom other than 1. iOS devices: the
  connected test (`transportType` wired or `tunnelState` connected) was not
  observed with a device attached, and Open URL on one was not run live. The
  driver tag: a pointer click, its tooltip, the `working` and `blocked` looks
  and the Maestro pane's tag were not seen live; only the idle MCP tag and its
  `agent.focus` command were. The Running section's 40px rows and the filter
  field were not seen live, nor typing in it: that its `focus` / `blur` fire,
  that up, down and Escape reach the root's `on_key_down` from it (the Maestro
  picker's filter relies on the same) and that Enter arrives as its submit. The claim pill's
  session label, program icon, idle text, holder click and `×` were not seen live.

- **`image()` is too slow for a live screen**: a changed image file shows
  ~175 ms later, blank in between, and `image()` loads no `http://` path. The
  first version rotated frames through a ring of files; a tap was fine, a
  swipe visibly behind. A terminal block has no such wait.
- **Herdr drops an ended terminal's block from the layout file**, and then
  unwraps a column left with one child. Anything a later edit needs (the
  block's id and size) rides in the bar's props, which survive.
- **`CSI 16 t` answers in different units**: points in a tab's terminal,
  pixels in a layout terminal block, and a fixed size before the terminal is
  shown. The width it gives is rounded, so it comes from the font size.
- **A sharp frame stalls the moving ones**: it is megabytes to compress and
  push through the terminal. Drawn at every 150 ms pause it left gaps of 200 to
  900 ms and most frames undrawn; drawn late and never mid-gesture, every
  frame that arrives is drawn (`touch ~/.cache/herdr-devices/debug` logs a
  line a second: frames in, drawn, the longest gap).
- **The terminal sometimes refuses a frame** (`EINVAL`, a few in thousands):
  the last frame is drawn again. Only a refusal among the first three frames
  turns deflate off.
- **node's http sends a stream chunked.** Reading it by `Content-Length` alone
  puts the chunk sizes inside the frames; `HttpBody` takes them out.
- **Herdr's `PATH` can find a broken `node`**: the viewer, serve-sim and the
  helper start through `"$SHELL" -lic`. Mods have no `setTimeout`; wait with
  `cx.timer.after`.
- **`hc kill` gives the viewer no time to stop serve-sim's helper**, so Back
  asks the viewer to quit over its port first.
- **Not seen live**: a non-Retina display, a font that isn't 0.6 wide, the
  pane fallback, and an Android device inside the panel (the viewer drew an
  API 36 emulator's frames and pressed Home on it, outside Herdr).

## Done when

- `node --test tests/` passes: runtime labels, the captured simctl list (one
  runtime, five simulators, two booted, with versions and lastBootedAt),
  unavailable simulators hidden and runtimes ordered, AVD names from the AVD
  home's files and which watch events re-list them, the serial -> name cache,
  `adb devices -l` with emulators, a phone, offline and unauthorized
  rows, AVD/serial mapping with API levels and USB / Wi-Fi, tool candidates,
  exec rejections (missing, timed out, other) and the minute a missing tool is
  remembered, error lines, screenshot paths with milliseconds, the emulator
  log path and pgrep pattern, the launch step (wait, check, gone, done, kill,
  late), recency order (booted and pending first; the two booted simulators first in the captured list)
  and recents from devices that came on, with gone ones dropped, the fold
  (running and pending plus the three most recent off ones; unfolded when all fit, Running rows
  counted at 40px), the Running split (booted, offline, unauthorized, a pending boot of an off
  device; all off; a section emptied by it, kept only with its empty line) and its second line,
  the filter (any case, trimmed, sections without a match dropped), phases settling (an AVD only after boot_completed, three minutes at
  most; a boot cancelled into stopping), glyphs, hover icons (Shut down while booting), the row click, the keys (up / down, space), the footer, the menu per row with its key hints, and
  the app lists (iOS launchctl, Android dumpsys with its fallback and hidden
  packages) and segment, the menu's app items, the Maestro flow rows (sorted,
  nested folders, config.yaml dropped at the top only, .yml, paths outside the
  folder ignored), Run *flow* again, the variables' parsing, the Maestro
  argv (variables as `-e` words after the id and path), which terminal is a
  device's Maestro pane, the drivers (a hand-written `ps` listing: CPU times,
  a server's terminal four parents up, a walk stopping at pid 1, active from
  CPU growth only while its agent works, the Maestro pane driving during its
  run and not after, the pane winning over its own server, the first of two),
  the claims (holders found directly, through parents or not at all, pid mtimes, idle text, the
  pills' labels, clicks, mismatches, idle look and ×),
  and every action's argv (the URL quoted for `adb shell`, erase refusing a folder
  that isn't an absolute `*.avd`).
- `herdr-app check ~/.config/herdr-app/mods/devices` passes and `herdr-app
  status` shows `"errors": []` with the panel open.
- The panel shows the filter field, a `Running` header over two-line booted rows
  (bright with a dot on the icon, `iOS <version>` or the API level under the name), then
  `iOS <version>` and `Android` headers with counts over dim off rows, API levels beside
  off AVD names, and the footer.
- A simulator held by an idle agent's Maestro MCP shows that agent's program
  (`claude`, `codex`) as a muted tag after the app tag, and `herdr-app do agent.focus --terminal
  <its terminal>` (what the tag's click runs) focuses that agent.
- On a throwaway simulator (`xcrun simctl create`): `xcrun simctl boot` and
  `shutdown` in a terminal flip its glyph within about a second; its Boot icon
  boots it with `booting…` and a spinning ring until it's on; Shut down shows
  `stopping…` until it's off; Boot again succeeds; Screenshot writes a PNG to
  the Desktop; Open URL opens the URL; Erase resets it; Open URL on a shut-down
  simulator toasts `Unable to lookup in current state: Shutdown`.
- `node --test tests/` also passes for `screen.js`: which devices have a
  screen, PNG and JPEG sizes, the HTTP body (plain, chunked in pieces of any
  size, other statuses), the multipart reader (frames across chunks, a frame
  larger than the buffer), serve-sim's argv, JSON, helper and address, its
  input frames, the key usages, Android's touches, key codes, buttons, wheel
  and turned size, the helper's port and start, the toolbar per platform, the
  viewer's argv, and the layout wrapped and unwrapped in every shape Herdr leaves.
- On a booted simulator, Show screen shows it within a few seconds where the
  panel was; a drag on a list follows the pointer without a visible delay and
  the picture is sharp once it rests; typing into a focused field types, Shift
  included; Home goes home; Back returns to the list, the layout file is as it
  was, and `npx serve-sim --list` shows no helper left for it.
- On a running emulator the same, and `pgrep -f android-stream.mjs` finds
  nothing a few seconds after Back.
