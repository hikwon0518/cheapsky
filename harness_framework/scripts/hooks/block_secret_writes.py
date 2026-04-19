#!/usr/bin/env python3
"""PreToolUse Write/Edit/MultiEdit 훅: 시크릿/환경변수 파일 보호.

1) 파일 경로가 `.env`·`.env.local` 등이면 차단 (`.env.example` 만 예외)
2) content/new_string 에 실제 시크릿 문자열(JWT, API 키 등)이 인라인으로
   포함되면 차단. 저장 위치는 항상 `.env.local` 과 `process.env` 참조여야 함.

ADR-002: public repo 전제. 시크릿 유출이 생기면 되돌릴 수 없다.
"""
import json
import re
import sys

# .env / .env.local / .env.production ... — 단 .env.example 은 통과
SECRET_FILE_RE = re.compile(r"(?:^|[/\\])\.env(?:\..+)?$", re.IGNORECASE)
EXAMPLE_RE = re.compile(r"\.env\.example$", re.IGNORECASE)

SECRET_PATTERNS = [
    (r"eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}",
     "JWT 토큰 (Supabase/Auth0 등)"),
    (r"sk-ant-[A-Za-z0-9_-]{20,}", "Anthropic API 키"),
    (r"sk-[A-Za-z0-9]{32,}", "OpenAI API 키"),
    (r"AKIA[0-9A-Z]{16}", "AWS Access Key"),
    (r"AIza[A-Za-z0-9_-]{30,}", "Google API 키"),
    (r"ghp_[A-Za-z0-9]{30,}", "GitHub PAT"),
    (r"xoxb-[A-Za-z0-9-]{40,}", "Slack Bot Token"),
    (r"SUPABASE_SERVICE_ROLE_KEY\s*=\s*[\"']?eyJ", "SUPABASE_SERVICE_ROLE_KEY 인라인"),
]


def _is_exempted_path(path: str) -> bool:
    """훅/테스트 파일은 리터럴 시크릿 스캔 예외 (파일경로 차단은 계속 적용)."""
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


def _mask(s: str) -> str:
    if len(s) <= 12:
        return s[:4] + "..."
    return s[:8] + "..." + s[-4:]


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception as e:
        sys.stderr.write(f"[hook error: block_secret_writes] {type(e).__name__}: {e}\n")
        return 1

    tool = data.get("tool_name", "")
    if tool not in ("Write", "Edit", "MultiEdit"):
        return 0

    tool_input = data.get("tool_input") or {}
    path = str(tool_input.get("file_path", ""))

    if path and SECRET_FILE_RE.search(path) and not EXAMPLE_RE.search(path):
        sys.stderr.write(
            f"차단됨: .env* 파일 Write/Edit\n"
            f"  경로: {path}\n"
            ".env.local 등은 수동 편집만 허용. .env.example을 대신 수정하거나\n"
            "`CHEAPSKY_ALLOW_ENV_WRITE=1 ...` 같은 우회 env 변수를 도입하지 말고,\n"
            "훅을 일시 비활성화 후 직접 편집하세요.\n"
        )
        return 2

    # 훅/테스트 파일은 인라인 시크릿 패턴 리터럴일 수 있으므로 스캔 예외.
    # 단, .env* 경로 차단은 위에서 이미 처리된 상태이므로 영향 없음.
    if _is_exempted_path(path):
        return 0

    text = extract_content(tool_input)
    if text:
        for pat, label in SECRET_PATTERNS:
            m = re.search(pat, text)
            if m:
                sys.stderr.write(
                    f"차단됨: 코드에 시크릿 인라인 포함 ({label})\n"
                    f"  경로: {path}\n"
                    f"  매치(마스킹): {_mask(m.group(0))}\n"
                    "시크릿은 .env.local 에 두고 process.env.* 로 참조하세요.\n"
                )
                return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
