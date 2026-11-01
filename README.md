# herdr-devices

Your iOS simulators, connected iPhones and Android emulators and phones in a
side panel of the [Herdr](https://herdr.dev) desktop app, most recently used
first, with the everyday actions one click away. Pick a Maestro flow from the
right-click menu and it runs on that device in a pane below.

<img src="preview.png" width="900" alt="The Devices panel: an iOS 26.1 section with two booted simulators running apps, one tagged claude and one codex for the agent driving it, a connected iPhone over USB, one simulator booting and one off, then a watchOS section.">

## What you get

- iOS simulators grouped by runtime, with the iPhones, iPads, Watches, TVs and Vision Pros connected to the Mac in the section of their OS version. Android AVDs and `adb` devices in one section.
- Running devices first, then the most recent. When the list has room, every device shows; otherwise running ones and the three most recent off ones per section, with **Show all** for the rest.
- Each row shows the device's icon (phone, tablet, watch, TV, Vision Pro) and its state: a dot when booted, dim when off, a spinner while booting or stopping, a triangle when offline.
- A booted device shows the app it is running as a tag (`com.example.budget` shows `budget`). Hover for the full id. With several iOS apps running, it is the one in front.
- A second tag names who is driving the device: the agent (`claude`, `codex`) whose Maestro MCP session holds a simulator or connected iPhone, or `maestro` while the panel's own Run Maestro flow runs. It is the `working` color while driving, `blocked` when the agent waits on you, and muted when it holds the device but is idle. Hover for every driver and its tab; the tag brightens, and a click jumps to that agent. Android devices driven over Maestro MCP aren't tagged yet: only the panel's own run tags them.
- Live: a simulator boot or shutdown from any terminal shows within a second. Android and connected iOS devices are polled every 5 s.
- The last list paints instantly on open. Under 160 px the panel becomes a rail: icons only, the name and state as a tooltip, and a click boots an off device.

## Actions

Hover a row for Boot or Shut down, Screenshot and More; Shut down on a booting device cancels the boot. Clicking a booted simulator's row brings
Simulator to the front; clicking never boots, except in the rail. Right-click for the full menu, in sections.

Keys, once you've clicked the list: up and down select a row, Enter does its click, space boots or shuts it down, S takes a screenshot, M opens the menu, Escape clears the selection.

| Action     | Simulator                          | Android                                              |
|------------|------------------------------------|------------------------------------------------------|
| Boot       | `simctl boot`, `open -a Simulator` | `emulator -avd`, detached, output to a log           |
| Shut down  | `simctl shutdown`                  | `adb emu kill`                                       |
| Screenshot | `simctl io screenshot`             | `adb shell screencap`, `adb pull`                    |
| Copy id    | UDID                               | serial, or the AVD name when off                     |
| Open URL…  | `simctl openurl`                   | `adb shell am start -a android.intent.action.VIEW`   |
| Run Maestro flow… | pick a flow, then a terminal pane runs `maestro --device <UDID> test <flow>` | the same, with the serial |
| Copy app id | the running app's bundle id       | its package name                                     |
| Stop *app* | `simctl terminate`                 | `adb shell am force-stop`                            |
| Erase…     | `simctl erase` (factory reset)     | deletes the AVD's `snapshots/`, boots it once with `emulator -wipe-data -no-snapshot -no-window`, stops it when booted |

Menu-only actions:

- **Run Maestro flow…** needs a booted device, connected phones included. It lists the flows in the tab's `.maestro` folder. **All flows** runs the whole folder, any other row runs that one flow. Up, down and Enter pick, a click runs. With more than 6 flows a filter field sits on top. Browse… runs another folder. Without a `.maestro` folder it asks for a path instead. Without `maestro` on the PATH the row shows disabled with "not installed", and there is no Run again.
  - The flow you last ran in that folder is selected next time, and the menu offers it directly as **Run *flow* again**.
  - The Variables field takes `KEY=VALUE` words, passed as `maestro test -e`, and remembers them per flow.
  - The run opens a terminal pane below, replacing that device's previous Maestro pane, and the pane stays open as a shell. A failed run prints its debug folder, the newest under `~/.maestro/tests`.
  - Flows should launch the app themselves (`launchApp` with `clearState` and `arguments` for preconditions), as Maestro recommends. The mod only runs `maestro test`.
- **Copy app id** and **Stop** need a known running app. With several iOS apps running, the menu offers Stop for each.
- **Erase…** asks first. An AVD is erased only while off.

A connected iPhone or iPad offers only Open URL…, Run Maestro flow… and Copy UDID. Open URL opens in Safari, so custom schemes like `myapp://` don't resolve. No boot, screenshot or erase.

Screenshots go to `~/Desktop/<device>-<YYYYMMDD-HHMMSS>-<ms>.png`.

An emulator started from the panel logs to `$TMPDIR/herdr-devices-<avd>.log`
(`~/Library/Caches/herdr-devices/` without `$TMPDIR`). If it exits before
booting, the row stops spinning after about 10 s and shows the log's last line.

## What it runs

Only local tools, always as argument lists. It never reaches the network.

- `xcrun simctl` to list, boot, shut down, screenshot, open URLs and erase simulators, and to see which apps run (`launchctl list`, `log show`).
- `xcrun devicectl` to list connected iOS devices and open a URL in Safari on one.
- `ps` to see which simulator app is using CPU, and which terminal's Maestro MCP drives a device (`ps -axo pid=,ppid=,time=,command=`, once per iOS read). `open` to bring Simulator forward.
- `emulator` and `adb` for Android, including `dumpsys` to see the app in front. Both are found on `PATH`, then under `$ANDROID_HOME`, `$ANDROID_SDK_ROOT` and `~/Library/Android/sdk`.
- `pgrep` to check a started emulator is still running, `sh` to start it detached, `rm` to delete an AVD's `snapshots/` on erase.
- `find` to list the flows in a `.maestro` folder. `maestro` from your `PATH`, in a terminal pane via Herdr; the mod checks for it with `command -v maestro` once a minute. Maestro's own network use is not the mod's.
- It lists and reads the AVD home (`$ANDROID_AVD_HOME`, else `~/.android/avd`) and watches it and `~/Library/Developer/CoreSimulator`.

## Install

Ask your Herdr agent:

> Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/ernestjsf/herdr-devices

Or copy `mods/devices/` into `~/.config/herdr-app/mods/` and run
`herdr-app check ~/.config/herdr-app/mods/devices`.

The mod docks nowhere by itself. Open it as a pane:

```sh
herdr-app do pane.split --direction right --mod devices
```

Or add a Devices button next to Files and Changes the same way
[git-graph's Graph button](https://github.com/rabeeh-ta/herdr-git-graph/blob/main/docs/top-bar.md)
is added, with `devices` in place of `graph`.

## Limits

- iOS needs macOS and Xcode. The Android half should work on Linux, untested.
- Clicking a booted AVD does nothing: the emulator window has no app bundle to activate.
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
