#!/usr/bin/env python3
"""PreToolUse 훅: Write/Edit 시 AI 슬롭 패턴이 들어간 CSS/Tailwind를 차단.

docs/UI_GUIDE.md의 "AI 슬롭 안티패턴" 목록을 반영한다.

예외 규칙:
- `backdrop-blur-sm` 은 파일에 `sticky` 키워드가 있으면 허용 (sticky 헤더 1곳 예외).
- 같은 줄에 `allow-slop` 또는 `allow: backdrop-blur` 주석이 있으면 해당 매치는 통과.

차단 시 exit 2 로 사용자에게 사유를 보여주고 도구 호출을 막는다.
"""
import json
import re
import sys

SLOP_PATTERNS = [
    (r"backdrop-filter\s*:\s*blur", "backdrop-filter blur (glass morphism)"),
    (r"\bbackdrop-blur-(md|lg|xl|2xl|3xl)", "Tailwind backdrop-blur-md+ (sm 만 sticky 헤더/필터 에서 허용)"),
    (r"bg-clip-text[^\"']*text-transparent", "gradient-text (bg-clip-text + text-transparent)"),
    (r"\bfrom-(purple|indigo|violet|fuchsia)-\d", "보라/인디고/바이올렛 그라데이션 (AI 클리셰)"),
    (r"\bto-(purple|indigo|violet|fuchsia)-\d", "보라/인디고/바이올렛 그라데이션 (AI 클리셰)"),
    (r"\bvia-(purple|indigo|violet|fuchsia)-\d", "보라/인디고/바이올렛 그라데이션 (AI 클리셰)"),
    (r"\bblur-3xl\b", "배경 orb (blur-3xl)"),
    (r"Powered by AI", "'Powered by AI' 배지 금지"),
    (r"\banimate-(bounce|ping|spin)\b", "장식용 무한 애니메이션"),
    (r"\brounded-3xl\b", "과도한 둥근 모서리 (rounded-3xl). hero 는 rounded-2xl, 기본은 rounded-lg/xl"),
    (r"hover:translate-y-\d", "hover translate 금지 (대시보드에 거슬림)"),
    (r"hover:scale-\d", "hover scale 금지"),
    (r"hover:rotate-\d", "hover rotate 금지"),
]

TARGET_EXTS = (".tsx", ".ts", ".jsx", ".js", ".css", ".scss", ".mdx")

ESCAPE_RE = re.compile(r"allow[-:\s]+slop|allow[-:\s]+backdrop-blur", re.IGNORECASE)
STICKY_RE = re.compile(r"\bsticky\b", re.IGNORECASE)


def extract_content(tool_input: dict) -> str:
    parts = []
    if isinstance(tool_input.get("content"), str):
        parts.append(tool_input["content"])
    if isinstance(tool_input.get("new_string"), str):
        parts.append(tool_input["new_string"])
    edits = tool_input.get("edits")
    if isinstance(edits, list):
        for e in edits:
            if isinstance(e, dict) and isinstance(e.get("new_string"), str):
                parts.append(e["new_string"])
    return "\n".join(parts)


def line_of_match(text: str, m: re.Match) -> str:
    line_start = text.rfind("\n", 0, m.start()) + 1
    line_end = text.find("\n", m.end())
    if line_end == -1:
        line_end = len(text)
    return text[line_start:line_end]


def is_exempted(text: str, m: re.Match, has_sticky: bool) -> bool:
    matched = m.group(0).lower()
    line = line_of_match(text, m)
    if ESCAPE_RE.search(line):
        return True
    if "backdrop-blur-sm" in matched and has_sticky:
        return True
    return False


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception as e:
        sys.stderr.write(f"[hook error: check_ui_slop] {type(e).__name__}: {e}\n")
        return 1

    tool = data.get("tool_name", "")
    if tool not in ("Write", "Edit", "MultiEdit"):
        return 0

    tool_input = data.get("tool_input") or {}
    path = str(tool_input.get("file_path", "")).lower()
    if not path.endswith(TARGET_EXTS):
        return 0

    text = extract_content(tool_input)
    if not text:
        return 0

    has_sticky = bool(STICKY_RE.search(text))

    hits = []
    for pat, label in SLOP_PATTERNS:
        for m in re.finditer(pat, text, re.IGNORECASE):
            if is_exempted(text, m, has_sticky):
                continue
            hits.append(f"  - {label}  (matched: {m.group(0)!r})")
            break  # 같은 라벨 중복 출력 방지

    if hits:
        sys.stderr.write(
            "AI-slop guard (docs/UI_GUIDE.md)\n"
            + "\n".join(hits)
            + "\n\n승인된 라이트 팔레트 (page #fafaf9 · surface #fff · ink-* · line-* · low/hot/warn/up) 만 사용하세요.\n"
            "정당한 예외는 같은 줄에 `allow-slop` 주석을 달거나,\n"
            "sticky 헤더/필터의 backdrop-blur-sm은 파일에 `sticky` 키워드가 있으면 자동 허용됩니다.\n"
        )
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
