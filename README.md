# herdr-devices

A Devices panel for the [Herdr](https://herdr.dev) desktop app: your iOS
simulators and Android emulators and phones, most recently used first, with
the everyday actions one click away.

<img src="preview.png" width="464" alt="The Devices panel: an iOS 26.5 section with two booted simulators, and an Android section">

## What you get

- **iOS** simulators grouped by runtime, **Android** AVDs and `adb` devices.
- Running devices and the three most recent per section; **Show all** for the rest.
- A status glyph per row: booted, off, booting or stopping, offline.
- Live: simulators update within a second of a boot or shutdown from any
  terminal. Android is polled every 5 s.
- The last list paints instantly on open. Under 160 px the panel becomes a rail.

## Actions

Click a row to boot it, or to bring Simulator to the front when it is booted.
Hover for Boot or Shut down, Screenshot and More. Right-click for the full menu.

| Action     | Simulator                          | Android                                              |
|------------|------------------------------------|------------------------------------------------------|
| Boot       | `simctl boot`, `open -a Simulator` | `emulator -avd`, detached                            |
| Shut down  | `simctl shutdown`                  | `adb emu kill`                                       |
| Screenshot | `simctl io screenshot`             | `adb shell screencap`, `adb pull`                    |
| Copy id    | UDID                               | serial, or the AVD name when off                     |
| Open URL…  | `simctl openurl`                   | `adb shell am start -a android.intent.action.VIEW`   |
| Erase…     | `simctl erase` (factory reset)     | deletes the AVD's `userdata-qemu.img*` and `snapshots/` |

Erase lives in the menu only and asks first. An AVD is erased only while off.
Screenshots go to `~/Desktop/<device>-<timestamp>.png`.

## What it runs

Only local tools, always as argument lists: `xcrun simctl`, `open`, `emulator`,
`adb`, and `sh` to start the emulator detached and to delete AVD data. It reads
`~/.android/avd/<name>.ini` and watches `~/Library/Developer/CoreSimulator`.
It never reaches the network. `adb` and `emulator` are found on `PATH`, then
under `$ANDROID_HOME`, `$ANDROID_SDK_ROOT` and `~/Library/Android/sdk`.

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
- iOS physical devices are not listed yet.
- Clicking a booted AVD does nothing: the emulator window has no app bundle to activate.
- Tested on macOS with Herdr 0.1.10. Android actions on a running emulator or
  phone are covered by tests, not run live yet.

## Development

```sh
node --test tests/
```

Stdlib only. Fixtures in `tests/fixtures/` are captured tool output.
Symlinking `mods/devices` into Herdr does not hot-reload on edits; remove and
recreate the link to reload.

## License

MIT. Icons after [Lucide](https://lucide.dev) (ISC).
