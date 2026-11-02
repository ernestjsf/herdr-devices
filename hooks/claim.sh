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

claim() { echo "$me" > "$dir/pid" && echo "$label" > "$dir/owner"; }
deny() {
  owner=$(head -n 1 "$dir/owner" 2>/dev/null)
  echo "Device $id is claimed by ${owner:-another agent} since $(stat -f %Sm "$dir" 2>/dev/null). Call list_devices and pick another device, or ask the user to release it in the Devices panel." >&2
  exit 2
}

# plain mkdir, never -p: it is the atomic step, one creator wins
if mkdir "$dir" 2>/dev/null; then claim; exit 0; fi
[ -d "$dir" ] || exit 0

held=$(head -n 1 "$dir/pid" 2>/dev/null)
case $held in ''|*[!0-9]*) deny ;; esac   # no pid: a manual reservation
[ "$held" = "$me" ] && exit 0
kill -0 "$held" 2>/dev/null && deny
# the holder is gone: take over
rm -r "$dir"
mkdir "$dir" 2>/dev/null || deny
claim
exit 0
