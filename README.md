# herdr-devices

A side panel for the [Herdr](https://herdr.dev) desktop app that lists your iOS
simulators and Android emulators and devices, most recently used first, with
the everyday actions one click away: boot, shut down, screenshot, copy id, open
a URL, erase.

![Devices](preview.png)

## What it shows

- **iOS**: one section per simulator runtime (`IOS 26.5`, `WATCHOS 11.2`, …),
  iOS first and newest first. Unavailable simulators are hidden.
- **Android**: every AVD (running or not) and every physical device `adb` sees,
  by model name.
- Each section is sorted by last use (simctl's `lastBootedAt`, and the last
  action this panel ran on a device) and shows the running ones plus the three
  most recent; **Show all (N)** reveals the rest. Section headers fold.
- A status glyph per row: a filled dot when booted or online, a ring when off,
  a spinning ring while booting or stopping, a triangle when offline or
  unauthorized. Beside the name: the OS version, the API level, or USB / Wi-Fi.
- A footer: `5 simulators · 1 emulator · 0 devices · refreshed 10s ago`.
- The last list paints at once when the panel starts, then refreshes behind it.
- Narrower than 160 px, the panel becomes a rail: status glyph and first letter.

### How it stays current

- **Simulators** live: the panel watches
  `~/Library/Developer/CoreSimulator/Devices` and rereads when a simulator's
  `device.plist` changes, so a boot from any terminal shows within a second. A
  15 s poll is the safety net.
- **Android** every 5 s. (`adb track-devices` would be live, but Herdr's `exec`
  waits for a program to finish, so it can't stream.)
- Right after every action.

## Actions

**Click a row** to boot it when it's off, or to bring Simulator to the front
when a simulator is booted. Hover a row for up to three icons (Boot or Shut
down, Screenshot, More); **More** or a **right-click** opens the full menu.

| Action     | Simulator                                  | AVD / emulator                                            | Physical Android |
|------------|--------------------------------------------|-----------------------------------------------------------|------------------|
| Boot       | `xcrun simctl boot <udid>`, then `open -a Simulator` | `emulator -avd <name>`, started detached          | –                |
| Shut down  | `xcrun simctl shutdown <udid>`             | `adb -s <serial> emu kill`                                | –                |
| Screenshot | `xcrun simctl io <udid> screenshot <path>` | `adb shell screencap` to `/sdcard`, `adb pull`, then removed from the device | same as AVD |
| Copy id    | the UDID                                   | the serial (running) or the AVD name (off)                | the serial       |
| Open URL…  | `xcrun simctl openurl <udid> <url>`        | `adb -s <serial> shell am start -a android.intent.action.VIEW -d <url>` | same as AVD |
| Erase…     | `xcrun simctl shutdown`, then `xcrun simctl erase <udid>` | deletes `userdata-qemu.img*` and `snapshots/` in the AVD's folder | – |

A row shows `booting…` from the moment Boot is pressed until the device is up
(an AVD: until `adb shell getprop sys.boot_completed` reads `1`), and
`stopping…` until it is off; at most three minutes either way.

Screenshots go to `~/Desktop/<device name>-<YYYYMMDD-HHMMSS>.png`.
Screenshot and Open URL are offered only while the device is running.

**Erase lives in the menu only, asks first**, in a dialog with a red Erase
button.

- A **simulator** is shut down and reset to factory state: every app and its
  data are gone; the simulator itself stays.
- An **AVD** must be off (the action is only offered then, and adb is asked
  again right before deleting; if adb can't answer, nothing is deleted). Its
  user data (`userdata-qemu.img*`) and saved snapshots (`snapshots/`) are
  deleted from the folder its `~/.android/avd/<name>.ini` names
  (`$ANDROID_AVD_HOME` is honored). The next boot starts like a new device. The
  AVD's configuration and system image stay.

## What it runs

Only local programs, always as argument lists: `xcrun simctl`, `open -a
Simulator`, `emulator`, `adb` (including `getprop sys.boot_completed` while an
AVD boots), `sh` (to start the emulator detached and to delete an AVD's data
files, with the names passed as arguments), and `rm` inside that `sh`. It reads
`~/.android/avd/<name>.ini` and watches the CoreSimulator devices folder.

**It never reaches the network itself.** Two setup links on empty states open
documentation in your browser when clicked (`Get Xcode`, `Set ANDROID_HOME`);
two others open Xcode or Android Studio.

`adb` and `emulator` are looked up on `PATH`, then under `$ANDROID_HOME`,
`$ANDROID_SDK_ROOT` and `~/Library/Android/sdk`. A missing tool shows as one
line (`xcrun not found`, `adb not found`) and never hides the other platform.

## Install

Ask your Herdr agent:

> add the mod at github.com/ernestjsf/herdr-devices

Or by hand: copy `mods/devices/` to `~/.config/herdr-app/mods/devices/`, then
check it:

```sh
herdr-app check ~/.config/herdr-app/mods/devices
```

The mod docks nowhere by itself (`"place": "none"`). Put it where you want it:
as a block in a layout (`{ "id": "devices", "type": "block", "content": { "mod": "devices" } }`)
or as a pane (`herdr-app do pane.split --direction right --mod devices`).

### A Devices button in the top bar

Herdr's main layout opens Files and Changes from buttons in the tab bar. A
Devices button beside them works exactly like
[git-graph's Graph button](https://github.com/rabeeh-ta/herdr-git-graph/blob/main/docs/top-bar.md),
with `devices` in place of `graph`:

1. Clone the tab bar and the layout (`mod.clone tabs`, `layout.clone main`).
2. In the cloned tab bar, add `"devices"` to the enabled panels and add
   `.child(panelButton("devices", "Devices", "mods/devices/icons/devices.svg"))`
   after the Changes (or Graph) button.
3. In the cloned layout, append
   `{ "id": "devices", "type": "block", "content": { "mod": "devices" } }` to the
   `panel-body` stack's children.

## Limits

- macOS only for iOS (it needs Xcode's `simctl`). The Android half should work
  on Linux too, untested.
- iOS physical devices are not listed yet: planned for v1.1 via `devicectl`.
- Clicking a booted AVD does nothing: the emulator's window has no app bundle
  `open -a` or AppleScript can bring forward.
- Android is polled every 5 s, also while the panel is hidden.
- Open URL on Android trusts `am start`; some Android versions exit 0 even when
  no app handles the URL, so no error shows then.
- Tested on macOS with Herdr 0.1.10, Xcode's iOS 26.5 runtime and one AVD. The
  Android actions on a running emulator or phone were not run live (none was
  running); their commands are covered by the tests.

## Development

```sh
node --test tests/
```

Stdlib only, no install. `tests/fixtures/` holds output captured on macOS
(home folder renamed) and hand-written samples for states that weren't on the
machine (a running emulator, a phone, an unauthorized device).

Herdr hot-reloads a mod when a file in `~/.config/herdr-app/mods/` changes. If
you symlink the folder there for development, edits in the repo do **not**
trigger a reload; remove the link and create it again to reload.

## License

MIT, see [LICENSE](LICENSE). Icons are drawn after [Lucide](https://lucide.dev)
(ISC, see `mods/devices/icons/LICENSE-lucide.txt`).
