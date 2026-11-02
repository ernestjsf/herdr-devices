#!/bin/sh
# Wires claim.sh into Codex: writes ~/.codex/hooks.json when there is none, else prints the entries to merge.
# Never modifies an existing file.
dir=$(cd "$(dirname "$0")" && pwd) || exit 1
file=$HOME/.codex/hooks.json
pre='"PreToolUse": [{"matcher": "mcp__maestro__.*", "hooks": [{"type": "command", "command": "'$dir'/claim.sh codex", "timeout": 10}]}]'
end='"SessionEnd": [{"hooks": [{"type": "command", "command": "'$dir'/claim.sh codex", "timeout": 3}]}]'

if [ ! -e "$file" ]; then
  mkdir -p "$HOME/.codex" || exit 1
  printf '{"hooks": {\n  %s,\n  %s\n}}\n' "$pre" "$end" > "$file" || exit 1
  echo "Wrote $file."
elif grep -q claim.sh "$file"; then
  echo "Already installed in $file."
else
  printf '%s,\n%s\n' "$pre" "$end"
  echo "Merge these into $file."
fi
echo "Run /hooks in Codex to trust the hook."
