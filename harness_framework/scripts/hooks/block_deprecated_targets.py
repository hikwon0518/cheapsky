#!/usr/bin/env python3
"""PreToolUse Write/Edit/MultiEdit 훅: Rejected 소스 가드.

ADR-022 Rejected (2026-04-19): 외부 시세 API 영구 제외. Amadeus · Duffel · Kiwi ·
Travelpayouts · FlightAPI · Skyscanner Partner · SerpAPI 등 GDS 기반 flight API
일체의 client 생성을 모든 단계에서 차단. 복원은 신규 ADR 로만 가능 (ADR-022
Rollback 조건 참조) — 환경변수 escape hatch 는 더 이상 제공하지 않음.

ADR-008: 상용 OTA 직접 크롤 금지. Skyscanner/Kayak/Expedia/Trip/Google Flights 등
의 `fetch(...)` 호출을 차단. 단, `lib/skyscanner-url.ts` 는 검색 URL 생성용이므로
예외 (파일 경로 기준).
"""
import json
import os
import re
import sys

REJECTED_PATHS = [
    (re.compile(r"services[/\\](amadeus|kiwi|travelpayouts|duffel|flightapi|skyscanner|serpapi)", re.IGNORECASE),
     "ADR-022 Rejected: 외부 시세 API 클라이언트 (Amadeus/Duffel/Kiwi/Travelpayouts/FlightAPI/Skyscanner Partner/SerpAPI 등)"),
]

# OTA URL fetch (skyscanner-url.ts 는 파일경로로 예외)
OTA_FETCH_PATTERNS = [
    (re.compile(r"""\bfetch\s*\(\s*[\"'`][^\"'`]*skyscanner\.(?:net|com)""", re.IGNORECASE),
     "ADR-008: Skyscanner fetch (검색 URL 생성만 허용)"),
    (re.compile(r"""\bfetch\s*\(\s*[\"'`][^\"'`]*google\.com/(?:travel/)?flights""", re.IGNORECASE),
     "ADR-008: Google Flights 크롤 금지"),
    (re.compile(r"""\bfetch\s*\(\s*[\"'`][^\"'`]*kayak\.(?:com|co\.kr)""", re.IGNORECASE),
     "ADR-008: Kayak 크롤 금지"),
    (re.compile(r"""\bfetch\s*\(\s*[\"'`][^\"'`]*expedia\.""", re.IGNORECASE),
     "ADR-008: Expedia 크롤 금지"),
    (re.compile(r"""\bfetch\s*\(\s*[\"'`][^\"'`]*trip\.com""", re.IGNORECASE),
     "ADR-008: Trip.com 크롤 금지"),
]


def _is_exempted_path(path: str) -> bool:
    """훅/테스트 파일은 리터럴 문자열 검사에서 제외 (자기 차단 방지)."""
    norm = path.lower().replace("\\", "/")
    if "/hooks/" in norm or "/scripts/hooks/" in norm:
        return True
    if re.search(r"(?:^|/)test_[^/]+\.py$", norm):
        return True
    if re.search(r"(?:^|/)[^/]+\.test\.(?:ts|tsx|js|jsx)$", norm):
        return True
    return False


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


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception as e:
        sys.stderr.write(f"[hook error: block_deprecated_targets] {type(e).__name__}: {e}\n")
        return 1

    tool = data.get("tool_name", "")
    if tool not in ("Write", "Edit", "MultiEdit"):
        return 0

    tool_input = data.get("tool_input") or {}
    path = str(tool_input.get("file_path", ""))

    # 훅/테스트 파일은 모든 검사 예외 (리터럴 문자열 방지)
    if _is_exempted_path(path):
        return 0

    for pat, label in REJECTED_PATHS:
        if pat.search(path):
            sys.stderr.write(
                f"차단됨: {label}\n"
                f"  경로: {path}\n"
                "ADR-022 Rejected 2026-04-19: 외부 시세 API 영구 제외. 복원은 신규 ADR 로만 가능.\n"
                "근거: GDS ≠ 핫딜 소스. 핫딜은 GDS 밖 채널(카드사/여행사/OTA 단독/error fare)에서 발생.\n"
                "Phase 3 슬롯은 `3-community-expansion` (ADR-030) 으로 재할당됨.\n"
            )
            return 2

    # skyscanner-url.ts / *-url.ts 는 URL 생성 전용이므로 예외
    norm_path = path.lower().replace("\\", "/")
    if "skyscanner-url" in norm_path:
        return 0

    text = extract_content(tool_input)
    if text:
        for pat, label in OTA_FETCH_PATTERNS:
            m = pat.search(text)
            if m:
                sys.stderr.write(
                    f"차단됨: {label}\n"
                    f"  경로: {path}\n"
                    f"  매치: {m.group(0)[:120]}\n"
                    "상용 OTA 직접 크롤 금지. 뽐뿌/루리웹/플레이윙즈만 허용.\n"
                )
                return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
