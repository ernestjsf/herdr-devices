# Reference

[← README](../README.md)

The details behind the README: what each action runs, how the screen view works, what the mod touches on your machine, and its limits.

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

**Show screen** (the monitor icon on a running row, or V) puts that device's screen where the panel is, under a bar with its name and buttons. The arrow in the bar goes back to the list and stops the stream.

- Click to tap, drag to swipe, scroll with the wheel or trackpad, and type once you've clicked the screen.
- The bar's buttons press Home, Lock and the volume keys and rotate the device. On iOS one more shows or hides the software keyboard.
- An agent can drive the device at the same time: the view only watches and sends your own touches. It takes no claim.

| Device | Picture | Input |
|--------|---------|-------|
| iOS simulator | [serve-sim](https://github.com/EvanBacon/serve-sim)'s stream | serve-sim |
| Android emulator | the emulator's own gRPC frames, through `android-stream.mjs` | `adb shell input` |
| Android phone, or an emulator started without gRPC | `adb exec-out screencap`, about two a second | `adb shell input` |
| Connected iPhone | none: `devicectl` can't read the screen | |

How it is drawn: the screen is a terminal. A small viewer (`screen-term.mjs`, run by Node) draws the frames with the Kitty graphics protocol, which Herdr's terminals speak, so a frame is on screen a few hundredths of a second after the device made it. Herdr's own image element takes about 0.2 s to show a changed picture, which is fine for a tap and not for a swipe.

- While the screen moves, a simulator's frames are drawn at half the device's size with fewer colours; once it rests, the last one is drawn again at full sharpness.
- The screen sits in a thin bezel with the device's round corners.
- Show screen edits the shown layout's file: the panel's block becomes a column, a bar over the viewer's terminal. Back, or the viewer ending, puts the block back as it was. When the stream fails (the device shut down), the reason stays on screen until Back or a key. Opened from a pane instead of a layout block, the viewer opens as a pane beside it (Ctrl-C closes it).
- It needs Node on your login shell's `PATH`. serve-sim runs through `npx`, which downloads it from npm the first time.
- A simulator also needs Xcode's `swiftc`: the first Show screen builds a small frame scaler (`frame-scale.swift`) into `~/.cache/herdr-devices/`, which takes a couple of seconds.
- If something is off, `touch ~/.cache/herdr-devices/debug` makes the viewer log to `~/.cache/herdr-devices/screen-term.log`.

serve-sim and the emulator's gRPC frames are used the way [herdr-sim](https://github.com/wobsoriano/herdr-sim) does, which is the mod to use if the screen is all you want.

## What it runs

Only local tools, always as argument lists. The mod itself never reaches the network; the screen view's `npx serve-sim` downloads from npm on first use and then talks to it on localhost only; the viewer listens on a localhost port for the bar's buttons.

It calls `xcrun simctl`, `xcrun devicectl`, `emulator`, `adb` and `maestro`, plus `ps`, `pgrep`, `find`, `open`, `sh`, `mkdir` and `rm` for process checks, flow lists, claims and erase. Android tools are found on `PATH`, then under `$ANDROID_HOME`, `$ANDROID_SDK_ROOT` and `~/Library/Android/sdk`. It watches `~/Library/Developer/CoreSimulator` and the AVD home. The screen view adds `npx`, `node` and `nc` through your login shell, and writes its frames as image files to `~/.config/herdr-app/mods/devices-screen/`, because Herdr shows pictures from files.

## Limits

- iOS needs macOS and Xcode. The Android half should work on Linux, untested.
- A claim without a pid file stays until released from the menu or the pill's ×.
- The window icon on a booted device brings its window forward. On macOS the Simulator part needs Accessibility access for Herdr (System Settings → Privacy & Security → Accessibility); on Linux it needs `xdotool` and an X11 session (Wayland can't activate windows). Linux and Windows are untested live.
- The screen view was run on Herdr 0.1.15 with an iOS 26.5 simulator. The viewer drew an API 36 emulator's frames and pressed its Home button outside Herdr; an Android device has not been seen in the panel. It assumes a Retina display and a terminal font 0.6 as wide as its size (`HERDR_DEVICES_DPR` and `HERDR_DEVICES_CELL=<w>x<h>` override). An emulator started without `-grpc` shows screenshots, not a stream.
- Tested on macOS with Herdr 0.1.10. AVD erase, Android screenshots and Open URL, and connected iOS devices are covered by tests, not run live yet.

## Tests

```sh
node --test tests/
```

They cover `devices.js` (parsing and command building), `screen.js` (the screen view's readers, input mappings and commands) and the hook scripts. The panel itself is checked with `herdr-app check mods/devices`.

Stdlib only. Fixtures in `tests/fixtures/` are captured tool output.
Symlinking `mods/devices` into Herdr does not hot-reload on edits; remove and
recreate the link to reload.
