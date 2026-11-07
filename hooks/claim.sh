#!/bin/sh
# Claims the device a Maestro MCP call names, and releases the agent's claims at session end.
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

case $(field hook_event_name) in
  SessionEnd)
    for d in "$claims"/*/; do
      [ "$(head -n 1 "$d/pid" 2>/dev/null)" = "$me" ] && rm -r "$d"
    done
    exit 0 ;;
  PreToolUse) ;;
  *) exit 0 ;;
esac

case $(field tool_name) in mcp__*maestro*) ;; *) exit 0 ;; esac
id=$(field device_id)
printf '%s' "$id" | grep -Eq '^[A-Za-z0-9_:-][A-Za-z0-9._:-]*$' || exit 0
mkdir -p "$claims" || exit 0
dir=$claims/$id

# when a process started, as ps prints it (trimmed; C locale and UTC, so the panel's ps
# prints the same text whatever the environment); empty when it is gone
start_of() { LC_ALL=C TZ=UTC ps -o lstart= -p "$1" 2>/dev/null | sed 's/^ *//; s/ *$//'; }
# pid, owner and the holder's start, so a pid reused by another process later isn't taken for the holder
claim() { echo "$me" > "$dir/pid" && echo "$label" > "$dir/owner" && start_of "$me" > "$dir/start"; }
deny() {
  owner=$(head -n 1 "$dir/owner" 2>/dev/null)
  since=$(stat -f %Sm "$dir" 2>/dev/null || stat -c %y "$dir" 2>/dev/null)
  echo "Device $id is claimed by ${owner:-another agent} since $since. Call list_devices and pick another device, or ask the user to release it in the Devices panel." >&2
  exit 2
}

# plain mkdir, never -p: it is the atomic step, one creator wins
if mkdir "$dir" 2>/dev/null; then claim; exit 0; fi
# gone already (a takeover removed it between): claim it, not drive unclaimed
[ -d "$dir" ] || { mkdir "$dir" 2>/dev/null && claim; exit 0; }

held=$(head -n 1 "$dir/pid" 2>/dev/null)
case $held in ''|*[!0-9]*) deny ;; esac   # no pid: a manual reservation
[ "$held" = "$me" ] && exit 0
# ps, not kill -0: that fails on another user's live process too. ps must be shown to
# work (on this shell) before an empty answer counts as "gone", or the holder is denied.
[ -n "$(start_of $$)" ] || deny
now=$(start_of "$held")
if [ -n "$now" ]; then
  # alive, and (when the claim recorded a start) started when the holder did: not a reused pid
  recorded=$(head -n 1 "$dir/start" 2>/dev/null)
  [ -z "$recorded" ] && deny
  [ "$now" = "$recorded" ] && deny
fi
# The holder is gone: take over, one hook at a time. A lock folder (mkdir again; its dot
# keeps the panel from reading it as a claim) serializes the takeovers, and the pid is read
# again under it, so two hooks that both saw the dead holder can't both remove and claim:
# the second is denied and can try again. The lock goes however this script ends; one a
# killed hook left behind is removed once it is a minute old.
lock=$claims/.takeover.$id
find "$claims" -maxdepth 1 -name ".takeover.$id" -mmin +1 -exec rmdir {} \; 2>/dev/null
mkdir "$lock" 2>/dev/null || deny
trap 'rmdir "$lock" 2>/dev/null' EXIT INT TERM HUP
[ "$(head -n 1 "$dir/pid" 2>/dev/null)" = "$held" ] || deny
rm -r "$dir"
mkdir "$dir" 2>/dev/null || deny
claim
exit 0
