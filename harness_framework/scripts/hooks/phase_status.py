#!/usr/bin/env python3
"""SessionStart 훅: 현재 phase 진행 상황을 컨텍스트로 주입.

phases/index.json 이 존재하면 phase별 status를 한 줄씩 요약한다.
아직 하네스가 돌기 전이면 조용히 종료한다.
"""
import json
import sys
from pathlib import Path

MARKS = {
    "completed": "[V]",
    "pending": "[ ]",
    "error": "[X]",
    "blocked": "[!]",
    "in_progress": "[.]",
}


def find_index() -> Path | None:
    for root in (Path.cwd(), Path.cwd() / "harness_framework"):
        idx = root / "phases" / "index.json"
        if idx.exists():
            return idx
    return None


def main() -> int:
    idx_path = find_index()
    if idx_path is None:
        return 0

    try:
        data = json.loads(idx_path.read_text(encoding="utf-8"))
    except Exception as e:
        sys.stderr.write(f"[hook error: phase_status] {type(e).__name__}: {e}\n")
        return 1

    phases = data.get("phases") or []
    if not phases:
        return 0

    lines = ["Cheapsky phase status:"]
    for p in phases:
        status = p.get("status", "pending")
        mark = MARKS.get(status, "[?]")
        name = p.get("dir", "?")
        lines.append(f"  {mark} {name} - {status}")

    current = next((p for p in phases if p.get("status") == "pending"), None)
    if current:
        lines.append(f"Next pending: {current.get('dir')}")

    sys.stdout.write("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
