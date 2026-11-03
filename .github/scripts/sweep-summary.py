"""Turn one /api/watch response into an Actions run summary.

Reads the JSON on stdin. Lives in a file rather than inline in the workflow
because a `run: |` block scalar ends at the first line indented less than the
block, and a Python program written flush-left inside one silently truncates it
— which is what happened here: the workflow was unparseable and every scheduled
sweep failed in zero seconds for as long as it existed. A file cannot be broken
that way, and it can be run by hand against a real response.
"""

import json
import sys

r = json.load(sys.stdin)

# An empty feed is ambiguous — no alerts, or NDMA down. Never log it as clear.
if not r.get("sourceReachable"):
    print("::warning::NDMA Sachet unreachable — this is NOT an all-clear")
    sys.exit(0)

changes = r.get("changes", [])
print(f"Checked {r.get('checked', 0)} live alerts. {len(changes)} changed.")

for c in changes:
    kind = "NEW" if c["change"] == "new" else f"ESCALATED from {c.get('previousColour')}"
    line = f"{kind} [{c['colour']}] {c['area']} — {c['source']}"
    print(line)
    # Surfaces on the run summary, so a red alert is visible without opening
    # the app.
    if c["colour"] == "red":
        print(f"::warning::{line}")

print(f"Queue awaiting a coordinator: {len(r.get('queue', []))}")
