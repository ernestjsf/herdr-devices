# Claims

[← README](../README.md)

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

Until the panel finds the plugin (or a `claim.sh` hook), it shows an "Agents don't claim devices yet" line with **Set up Claude Code** and **Codex** links, when Maestro is installed. A click runs that harness's install for you (the commands below) and says how it went; if it fails, the command is put on the clipboard to run by hand. **×** hides the line for good.

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
