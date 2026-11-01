# herdr-devices

Your iOS simulators, connected iPhones and Android emulators and phones in a
side panel of the [Herdr](https://herdr.dev) desktop app, most recently used
first, with the everyday actions one click away. Pick a Maestro flow from the
right-click menu and it runs on that device in a pane below.

<img src="preview.png" width="900" alt="Left, the Devices panel: iOS 26.1 with two booted simulators running apps, one tagged claude and one codex for the agent driving it, a connected iPhone over USB, one simulator booting and one off; a watchOS section; Android with a booted emulator, a phone over USB, an off AVD and an offline phone. Right, the Run Maestro flow picker: All flows, six flows in their folders, one selected, a Variables field and Browse, Cancel and Run buttons.">

## What you get

- iOS simulators grouped by runtime, with connected iPhones, iPads, Watches, TVs and Vision Pros under their OS version. Android AVDs and `adb` devices in one section.
- Running devices first, then the most recent. When space runs short, **Show all** reveals the older off devices.
- Each row shows the device type and its state: booted, off, booting or offline.
- A booted device shows its running app as a tag (`com.example.budget` shows `budget`).
- A second tag names who is driving it: an agent (`claude`, `codex`) through Maestro MCP, or `maestro` for the panel's own run. Click it to jump to that agent. Android devices are tagged only for the panel's own run.
- Live: simulator changes show within a second. Android and connected iOS devices refresh every 5 s.
- Under 160 px the panel becomes an icon rail.

## Actions

Hover a row for Boot or Shut down, Screenshot and More. Right-click for the full menu. Clicking a booted simulator brings Simulator to the front. Arrow keys, Enter, space, S and M work once the list has focus.

| Action     | Simulator                          | Android                                              |
|------------|------------------------------------|------------------------------------------------------|
| Boot       | `simctl boot`, `open -a Simulator` | `emulator -avd`, detached                            |
| Shut down  | `simctl shutdown`                  | `adb emu kill`                                       |
| Screenshot | `simctl io screenshot`             | `adb shell screencap`, `adb pull`                    |
| Copy id    | UDID                               | serial, or the AVD name when off                     |
| Open URL…  | `simctl openurl`                   | `adb shell am start -a android.intent.action.VIEW`   |
| Run Maestro flow… | `maestro --device <UDID> test <flow>` in a pane below | the same, with the serial |
| Copy app id | the running app's bundle id       | its package name                                     |
| Stop *app* | `simctl terminate`                 | `adb shell am force-stop`                            |
| Erase…     | `simctl erase`                     | wipes data and snapshots, only while off             |

- **Run Maestro flow…** lists the flows in the tab's `.maestro` folder, or another folder via Browse…. Variables pass as `maestro test -e`. The last flow and its variables are remembered, and the menu offers **Run *flow* again**. Flows should launch the app themselves, since the mod only runs `maestro test`.
- **Erase…** asks first.
- Connected iPhones and iPads offer only Open URL…, Run Maestro flow… and Copy UDID. Open URL opens in Safari, so custom schemes don't resolve.

Screenshots go to `~/Desktop`. An emulator started from the panel logs to `$TMPDIR/herdr-devices-<avd>.log`.

## What it runs

Only local tools, always as argument lists. It never reaches the network.

It calls `xcrun simctl`, `xcrun devicectl`, `emulator`, `adb` and `maestro`, plus `ps`, `pgrep`, `find`, `open`, `sh` and `rm` for process checks, flow lists and erase. Android tools are found on `PATH`, then under `$ANDROID_HOME`, `$ANDROID_SDK_ROOT` and `~/Library/Android/sdk`. It watches `~/Library/Developer/CoreSimulator` and the AVD home.

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
