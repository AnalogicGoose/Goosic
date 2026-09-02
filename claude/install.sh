#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CLAUDE_HOME=${CLAUDE_HOME:-"$HOME/.claude"}
export SCRIPT_DIR CLAUDE_HOME

python3 - <<'PY'
import base64, hashlib, json, os, pathlib, shutil, time

src = pathlib.Path(os.environ["SCRIPT_DIR"])
home = pathlib.Path(os.environ["CLAUDE_HOME"]).expanduser()
agents = home / "agents"
instructions = home / "CLAUDE.md"
state_file = home / ".goosic-claude-state.json"
begin = "<!-- BEGIN goosic-claude-agents -->"
end = "<!-- END goosic-claude-agents -->"

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def backup(path):
    stamp = time.strftime("%Y%m%d%H%M%S")
    target = path.with_name(path.name + ".goosic-claude.bak-" + stamp)
    index = 1
    while target.exists():
        target = path.with_name(path.name + ".goosic-claude.bak-" + stamp + f"-{index}")
        index += 1
    shutil.copy2(path, target)
    print("backup:", target)
    return str(target)

try:
    old_state = json.loads(state_file.read_text())
except (FileNotFoundError, json.JSONDecodeError):
    old_state = {"files": {}}

sources = sorted((src / "agents").glob("*.md"))
if len(sources) != 6:
    raise SystemExit(f"error: expected six Claude agents, found {len(sources)}")
for path in sources:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n") or "\nname:" not in text or "\nmodel: " not in text:
        raise SystemExit(f"error: invalid Claude agent frontmatter: {path}")
print("Claude agent validation passed")

home.mkdir(parents=True, exist_ok=True)
current = {}

def install(source, target, key):
    target.parent.mkdir(parents=True, exist_ok=True)
    source_hash = digest(source)
    ownership, saved_backup = "created", None
    if target.exists():
        if digest(target) == source_hash:
            ownership = "preexisting"
            print("unchanged:", target)
        else:
            ownership = "replaced"
            saved_backup = backup(target)
            shutil.copy2(source, target)
            print("installed:", target)
    else:
        shutil.copy2(source, target)
        print("installed:", target)
    current[key] = {
        "target": str(target),
        "installed_hash": source_hash,
        "ownership": ownership,
        "backup": saved_backup,
    }

for source in sources:
    install(source, agents / source.name, "agents/" + source.name)

block = begin + "\n@" + str(src / "CLAUDE.md") + "\n" + end
old = instructions.read_text(encoding="utf-8") if instructions.exists() else ""
start = old.find(begin)
finish = old.find(end, start)
if start >= 0 and finish >= start:
    updated = old[:start] + block + old[finish + len(end):]
else:
    updated = old + ("\n\n" if old else "") + block + "\n"

global_state = {
    "target": str(instructions),
    "block": block,
    "before": base64.b64encode(old.encode()).decode(),
    "ownership": "managed" if updated != old else "unchanged",
}
if updated != old:
    if instructions.exists():
        global_state["backup"] = backup(instructions)
    instructions.write_text(updated, encoding="utf-8")
    print("updated:", instructions)
else:
    print("unchanged:", instructions)

state_file.write_text(json.dumps({"files": current, "global": global_state}, indent=2) + "\n")
print("Claude agents installed under", home)
print("Restart Claude Code to load the new agents and instructions")
PY
