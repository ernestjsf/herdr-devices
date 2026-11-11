# herdr-devices

This repo is a Herdr mod plus a Claude Code plugin (the claim hook, see Claims).

Your iOS simulators, connected iPhones and Android emulators and phones in a
side panel of the [Herdr](https://herdr.dev) desktop app, most recently used
first, with the everyday actions one click away. Pick a Maestro flow from the
right-click menu and it runs on that device in a pane below. **Show screen**
puts a booted simulator or emulator live in the panel, where you click, swipe
and type on it while your agent drives the same device.

<img src="preview.png" width="900" alt="Left, the Devices panel with placeholder devices: a filter field, then a Running section of seven two-line rows: a booted iPhone running an app and claimed by an agent session named Fix proof-of-delivery upload, a connected iPhone over USB, a booted iPad whose claim reads idle 6m, a booted Android emulator, a phone over USB, a simulator booting and an offline phone; below it the off devices under iOS 26.1, watchOS 26.1 and Android. Right, the Run Maestro flow picker: All flows, six flows in their folders, one selected, a Variables field and Browse, Cancel and Run buttons.">

## What you get

- Running devices of both platforms, connected iPhones, iPads, Watches, TVs and Vision Pros included, in a Running section on top. The rest: iOS simulators grouped by runtime, Android AVDs in one section.
- Running devices first, then the most recent. When space runs short, **Show all** reveals the older off devices.
- Each row shows the device type and its state: booted, off, booting or offline.
- A booted device shows its running app as a tag (`com.example.budget` shows `budget`).
- A second tag names who is driving it, with a link icon: an agent (`claude`, `codex`) through Maestro MCP, or `maestro` for the panel's own run. Click it to jump to that agent. Android devices are tagged only for the panel's own run.
- Live: simulator changes show within a second. Android and connected iOS devices refresh every 5 s, every 15 s once nothing has changed for half a minute.
- Under 160 px the panel becomes an icon rail.
- **Show screen**: the device's screen, live in the panel, taking your clicks, drags, scrolling and typing. See [The screen](#the-screen).

## Actions

Hover a row for Boot or Shut down, Bring window forward, Show screen, Screenshot and More. Right-click for the full menu. Clicking a row only selects it; the window icon (or Enter) brings a booted simulator or emulator to the front. Arrow keys, Enter, space, V, S and M work once the list has focus.

| Action     | Simulator                          | Android                                              |
|------------|------------------------------------|------------------------------------------------------|
| Boot       | `simctl boot`, `open -a Simulator` | `emulator -avd`, detached                            |
| Shut down  | `simctl shutdown`                  | `adb emu kill`                                       |
| Show screen | serve-sim's stream and input      | the emulator's gRPC frames, `adb shell input`        |
| Screenshot | `simctl io screenshot`             | `adb shell screencap`, `adb pull`                    |
| Copy id    | UDID                               | serial, or the AVD name when off                     |
| Open URL…  | `simctl openurl`                   | `adb shell am start -a android.intent.action.VIEW`   |
| Run Maestro flow… | `maestro --device <UDID> test <flow>` in a pane below | the same, with the serial |
| Copy app id | the running app's bundle id       | its package name                                     |
| Stop *app* | `simctl terminate`                 | `adb shell am force-stop`                            |
| Erase…     | `simctl erase`                     | wipes data and snapshots, only while off             |
| Release claim | `rm -r` of the claim folder     | the same                                             |

- **Run Maestro flow…** lists the flows in the tab's `.maestro` folder, or another folder via Browse…. Variables pass as `maestro test -e`. The last flow and its variables are remembered, and the menu offers **Run *flow* again**. Flows should launch the app themselves, since the mod only runs `maestro test`.
- **Erase…** asks first. So does a Maestro run on a device an agent has claimed.
- Connected iPhones and iPads offer only Open URL…, Run Maestro flow… and Copy UDID. Open URL opens in Safari, so custom schemes don't resolve.

Screenshots go to `~/Desktop`. An emulator started from the panel logs to `$TMPDIR/herdr-devices-<avd>.log`.

## The screen

**Show screen** (the monitor icon on a running row, or V) replaces the list with that device's screen. The arrow in the header goes back to the list and stops the stream.

- Click to tap, drag to swipe, scroll with the wheel or trackpad, and type once you've clicked the screen. ⌘ chords stay Herdr's.
- The buttons above the screen press Home, Lock and the volume keys and rotate the device. On iOS one more shows or hides the software keyboard.
- An agent can drive the device at the same time: the view only watches and sends your own touches. It takes no claim.

| Device | Picture | Input |
|--------|---------|-------|
| iOS simulator | [serve-sim](https://github.com/EvanBacon/serve-sim)'s stream, about 30 frames a second | serve-sim |
| Android emulator | the emulator's own gRPC frames, through `android-stream.mjs` | `adb shell input` |
| Android phone | `adb exec-out screencap`, about one a second | `adb shell input` |
| Connected iPhone | none: `devicectl` can't read the screen | |

- The streams need Node on your login shell's `PATH`. serve-sim runs through `npx`, which downloads it from npm the first time.
- Without Node the view falls back to screenshots, about one a second. An emulator still takes input then; a simulator is view only, and the line under the screen says so.
- The picture is about 0.2 s behind the device, because Herdr takes that long to show a changed image. Touches and keys go at once.
- As a panel block in a layout, give it `"props": { "panel": "<the block's id>" }` and it stops streaming while the panel is closed or on another tab. A pane can't tell whether it shows, so it streams until you go back to the list.

The design follows [herdr-sim](https://github.com/wobsoriano/herdr-sim), which is the mod to use if the screen is all you want.

## Claims

Two agents driving one simulator trample each other. A claim says "this device is mine".

- A claim is a folder named after the device id Maestro's `--device` takes: the UDID, or the adb serial.
- It holds the agent's pid. The hook also records the agent's start time, so a reused pid doesn't count.
- The panel drops a claim once its pid is gone. **Release claim** is in the menu, and the pill's **×** does the same.

The row shows one pill for the agent:

| Pill | Meaning |
|------|---------|
| lock, grey | claimed, and the owner isn't driving right now |
| lock, coloured | claimed, and the owner is driving (or attached and blocked) |
| link | driven by an agent, with no claim |
| lock, then a triangle pill | claimed by one session, driven by another |

```sh
mkdir -p ~/.cache/herdr-devices/claims
mkdir ~/.cache/herdr-devices/claims/<udid> && echo $PPID > ~/.cache/herdr-devices/claims/<udid>/pid   # fails if held
rm -r ~/.cache/herdr-devices/claims/<udid>   # release
```

A plain `mkdir`, never `mkdir -p`: `-p` succeeds on an existing folder. From an agent's command shell, `$PPID` is the agent itself. The pill names the holder's session (its terminal's title) once the panel finds the agent's terminal, else the `owner` file's first line.

To claim the first free booted simulator:

```sh
for udid in $(xcrun simctl list devices booted -j | grep -o '"udid" : "[^"]*"' | cut -d'"' -f4); do
  mkdir ~/.cache/herdr-devices/claims/$udid 2>/dev/null && { echo $PPID > ~/.cache/herdr-devices/claims/$udid/pid; echo "$udid"; break; }
done
```

### Agents claim automatically

Until the panel finds the plugin (or a `claim.sh` hook), it shows an "Agents don't claim devices yet" line with **Claude Code** and **Codex** links, each copying that harness's install command, when Maestro is installed. **×** hides it for good.

Claude Code:

```sh
claude plugin install herdr-devices --marketplace ernestjsf/herdr-devices
```

The hook claims the device on any Maestro MCP call with a `device_id` that drives it (`run`; `take_screenshot` and `inspect_screen` only look, so they pass without a claim), and denies the call with a reason when another live agent holds it. It takes over a dead agent's claim and releases its own at session end.

- A denial lists the booted simulators (and Android devices, while an adb server runs) nobody has claimed, so the agent can switch to one.
- Every Maestro call by the holder, looking included, counts as use, when it starts and when it ends. A claim its live holder hasn't used for 15 minutes can be taken over by the next agent that asks. `HERDR_DEVICES_IDLE_MIN` changes the minutes. A claim made by hand never goes idle.
 The matcher also covers a Maestro server installed as a plugin (`mcp__plugin_…_maestro__…`). Web runs (`device_id: chromium`) are never claimed.

After the plugin changes, update it, then restart Claude Code:

```sh
claude plugin marketplace update herdr-devices && claude plugin update herdr-devices@herdr-devices
```

Codex:

```sh
git clone https://github.com/ernestjsf/herdr-devices ~/.codex/herdr-devices && sh ~/.codex/herdr-devices/hooks/install-codex.sh
```

The script writes `~/.codex/hooks.json` when there is none, else prints the three entries to merge into it, and never edits an existing file. Codex asks you to trust the hook: run `/hooks`. The entries it writes:

```json
{"hooks": {
  "PreToolUse": [{"matcher": "mcp__.*maestro.*", "hooks": [{"type": "command", "command": "/path/to/herdr-devices/hooks/claim.sh codex", "timeout": 10}]}],
  "PostToolUse": [{"matcher": "mcp__.*maestro.*", "hooks": [{"type": "command", "command": "/path/to/herdr-devices/hooks/claim.sh codex", "timeout": 10}]}],
  "SessionEnd": [{"hooks": [{"type": "command", "command": "/path/to/herdr-devices/hooks/claim.sh codex", "timeout": 10}]}]
}}
```

## What it runs

Only local tools, always as argument lists. The mod itself never reaches the network; the screen view's `npx serve-sim` downloads from npm on first use and then talks to it on localhost only.

It calls `xcrun simctl`, `xcrun devicectl`, `emulator`, `adb` and `maestro`, plus `ps`, `pgrep`, `find`, `open`, `sh`, `mkdir` and `rm` for process checks, flow lists, claims and erase. Android tools are found on `PATH`, then under `$ANDROID_HOME`, `$ANDROID_SDK_ROOT` and `~/Library/Android/sdk`. It watches `~/Library/Developer/CoreSimulator` and the AVD home. The screen view adds `npx`, `node` and `nc` through your login shell, and writes its frames as image files to `~/.config/herdr-app/mods/devices-screen/`, because Herdr shows pictures from files.

## Install

Ask your Herdr agent:

> Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/ernestjsf/herdr-devices

Or copy `mods/devices/` and `mods/devices-screen/` into `~/.config/herdr-app/mods/` and run
`herdr-app check ~/.config/herdr-app/mods/devices`. (`devices-screen` only holds the screen view's frames; the mod creates it when it's missing.)

The mod docks nowhere by itself. Open it as a pane:

```sh
herdr-app do pane.split --direction right --mod devices
```

Or add a Devices button next to Files and Changes the same way
[git-graph's Graph button](https://github.com/rabeeh-ta/herdr-git-graph/blob/main/docs/top-bar.md)
is added, with `devices` in place of `graph`.

## Tests

```sh
node --test tests/
```

They cover `devices.js` (parsing and command building), `screen.js` (the screen view's readers, input mappings and commands) and the hook scripts. The panel itself is checked with `herdr-app check mods/devices`.

## Limits

- iOS needs macOS and Xcode. The Android half should work on Linux, untested.
- A claim without a pid file stays until released from the menu or the pill's ×.
- The window icon on a booted device brings its window forward. On macOS the Simulator part needs Accessibility access for Herdr (System Settings → Privacy & Security → Accessibility); on Linux it needs `xdotool` and an X11 session (Wayland can't activate windows). Linux and Windows are untested live.
- The screen view needs Herdr 0.1.13 or later and has not been run in Herdr yet. Its readers, input mappings and commands are covered by tests, and the view was exercised against stand-ins for Herdr, serve-sim and the emulator, not on a real device.
- Tested on macOS with Herdr 0.1.10. AVD erase, Android screenshots and Open URL, and connected iOS devices are covered by tests, not run live yet.

## Development

```sh
node --test tests/
```

Stdlib only. Fixtures in `tests/fixtures/` are captured tool output.
Symlinking `mods/devices` into Herdr does not hot-reload on edits; remove and
recreate the link to reload.

## License

MIT. Icons after [Lucide](https://lucide.dev) (ISC).
