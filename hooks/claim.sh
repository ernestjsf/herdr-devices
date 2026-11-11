#!/bin/sh
# Claims the device a Maestro MCP call names, and releases the agent's claims at session end.
# Events: PreToolUse claims or denies, PostToolUse only stamps the holder's claim, SessionEnd releases.
# Usage: claim.sh <label>   (hook JSON on stdin; exit 2 + stderr denies the call; anything odd exits 0)
label=${1:-agent}
claims=$HOME/.cache/herdr-devices/claims
json=$(cat)

# first string value of a key; a key inside a string value is escaped (\"), so it can't match
field() { printf '%s' "$json" | grep -o "\"$1\" *: *\"[^\"]*\"" | head -n 1 | cut -d'"' -f4; }

# the agent is the first ancestor that is not a shell (hooks run as sh -c ...); $PPID if the walk fails
agent_pid() {
  cur=$$
  while [ "$cur" -gt 1 ]; do
    out=$(ps -o ppid=,comm= -p "$cur" 2>/dev/null) || break
    read -r parent comm <<EOT
$out
EOT
    [ -n "$parent" ] || break
    c=${comm##*/}
    case ${c#-} in sh|bash|zsh|dash) cur=$parent ;; *) echo "$cur"; return ;; esac
  done
  echo "$PPID"
}

me=$(agent_pid)

event=$(field hook_event_name)
case $event in
  SessionEnd)
    for d in "$claims"/*/; do
      [ "$(head -n 1 "$d/pid" 2>/dev/null)" = "$me" ] && rm -r "$d"
    done
    exit 0 ;;
  PreToolUse|PostToolUse) ;;
  *) exit 0 ;;
esac

looking=
case $(field tool_name) in
  *__take_screenshot|*__inspect_screen) looking=1 ;;   # looking doesn't drive: no claim, never denied
  mcp__*maestro*) ;;
  *) exit 0 ;;
esac
id=$(field device_id)
[ "$id" = chromium ] && exit 0   # Maestro's web browser, not a device: the panel has no row to release it from
printf '%s' "$id" | grep -Eq '^[A-Za-z0-9_:-][A-Za-z0-9._:-]*$' || exit 0
dir=$claims/$id
# Every call of the holder's, looking too, stamps the claim as it starts and as it ends (a
# flow can run long): its pid file's age is how long the agent has left the device alone.
if [ "$(head -n 1 "$dir/pid" 2>/dev/null)" = "$me" ]; then touch "$dir/pid"; exit 0; fi
[ "$event" = PostToolUse ] && exit 0
[ -n "$looking" ] && exit 0
mkdir -p "$claims" || exit 0

# A hook's claim its live holder hasn't used for this many minutes can be taken over.
idle_min=${HERDR_DEVICES_IDLE_MIN:-15}
case $idle_min in ''|*[!0-9]*) idle_min=15 ;; esac
idle() { [ -n "$(find "$dir/pid" -mmin "+$idle_min" 2>/dev/null)" ]; }

# when a process started, as ps prints it (trimmed; C locale and UTC, so the panel's ps
# prints the same text whatever the environment); empty when it is gone
start_of() { LC_ALL=C TZ=UTC ps -o lstart= -p "$1" 2>/dev/null | sed 's/^ *//; s/ *$//'; }
# pid, owner and the holder's start, so a pid reused by another process later isn't taken for the holder
claim() { echo "$me" > "$dir/pid" && echo "$label" > "$dir/owner" && start_of "$me" > "$dir/start"; }
# The booted devices nobody claims, as "name (id), ": what a denied agent can use instead.
# adb only when its server already runs, so the hook never waits for one to start.
booted() {
  xcrun simctl list devices booted 2>/dev/null | sed -n 's/^ *\(.*\) (\([0-9A-Fa-f-]\{36\}\)) (Booted).*$/\2 \1/p'
  pgrep -x adb >/dev/null 2>&1 && adb devices 2>/dev/null | awk 'NR > 1 && $2 == "device" { print $1, $1 }'
}
free() { booted | while read -r fid name; do [ -d "$claims/$fid" ] || printf '%s (%s), ' "$name" "$fid"; done; }
deny() {
  owner=$(head -n 1 "$dir/owner" 2>/dev/null)
  since=$(stat -f %Sm "$dir" 2>/dev/null || stat -c %y "$dir" 2>/dev/null)
  # At most 3 s for the list: a hook that runs out of time doesn't deny at all.
  list=$claims/.free.$$
  free > "$list" 2>/dev/null &
  n=0; while kill -0 $! 2>/dev/null && [ $n -lt 30 ]; do sleep 0.1; n=$((n + 1)); done
  kill $! 2>/dev/null
  others=$(sed 's/, $//' "$list" 2>/dev/null); rm -f "$list"
  if [ -n "$others" ]; then hint="Free booted devices: $others. Use one of them"; else hint="Call list_devices and pick another device"; fi   # none seen: not every device is one this can list
  echo "Device $id is claimed by ${owner:-another agent} since $since. $hint, or ask the user to release this one in the Devices panel." >&2
  exit 2
}

# plain mkdir, never -p: it is the atomic step, one creator wins
if mkdir "$dir" 2>/dev/null; then claim; exit 0; fi
# gone already (a takeover removed it between): claim it, not drive unclaimed
[ -d "$dir" ] || { mkdir "$dir" 2>/dev/null && claim; exit 0; }

held=$(head -n 1 "$dir/pid" 2>/dev/null)
case $held in ''|*[!0-9]*) deny ;; esac   # no pid: a manual reservation
# ps, not kill -0: that fails on another user's live process too. ps must be shown to
# work (on this shell) before an empty answer counts as "gone", or the holder is denied.
[ -n "$(start_of $$)" ] || deny
now=$(start_of "$held")
alive=
if [ -n "$now" ]; then
  # alive, and (when the claim recorded a start) started when the holder did: not a reused pid.
  # A claim without a start was made by hand, so nothing stamps it and it never counts as idle.
  recorded=$(head -n 1 "$dir/start" 2>/dev/null)
  [ -z "$recorded" ] && deny
  if [ "$now" = "$recorded" ]; then alive=1; idle || deny; fi
fi
# The holder is gone, or left the device alone: take over, one hook at a time. A lock folder (mkdir again; its dot
# keeps the panel from reading it as a claim) serializes the takeovers, and the pid is read
# again under it, so two hooks that both saw the dead holder can't both remove and claim:
# the second is denied and can try again. The lock goes however this script ends; one a
# killed hook left behind is removed once it is a minute old.
lock=$claims/.takeover.$id
find "$claims" -maxdepth 1 -name ".takeover.$id" -mmin +1 -exec rmdir {} \; 2>/dev/null
mkdir "$lock" 2>/dev/null || deny
trap 'rmdir "$lock" 2>/dev/null' EXIT INT TERM HUP
[ "$(head -n 1 "$dir/pid" 2>/dev/null)" = "$held" ] || deny
if [ -n "$alive" ]; then idle || deny; fi   # it used the device meanwhile
rm -r "$dir"
mkdir "$dir" 2>/dev/null || deny
claim
exit 0
