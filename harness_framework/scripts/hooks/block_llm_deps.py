#!/usr/bin/env python3
"""PreToolUse 훅: ADR-005 LLM 정책 강제.

Core 단계 (기본): 모든 LLM SDK 설치 차단.
Stretch 단계 (CHEAPSKY_STAGE=stretch): Anthropic SDK만 예외 허용.
  - @anthropic-ai/sdk (Node)
  - anthropic (Python)
  나머지 LLM SDK (OpenAI / Google GenAI / Cohere / Mistral / Groq / LangChain /
  Vercel AI SDK 등)는 Stretch 단계에서도 계속 차단.

정밀도:
- `ai` 패키지(Vercel AI SDK)는 정확히 `npm install ai` 처럼 단독 인자로 올 때만 차단.
  `npm install some-ai-toolkit`, `open-ai-utils` 같은 유사 이름은 통과.
"""
import json
import os
import re
import sys

# Core 단계에서 차단. Stretch에서도 여기 남는 것은 계속 차단.
LLM_PACKAGES_JS_BASE = (
    r"(openai|@google/generative-ai|cohere-ai|@mistralai/mistralai|"
    r"groq-sdk|together-ai|langchain|langgraph)"
)
LLM_PACKAGES_PY_BASE = (
    r"(openai|google-generativeai|google-genai|cohere|mistralai|groq|"
    r"together|langchain|langgraph|litellm)"
)

# Core 단계에서만 차단되는 Anthropic SDK. Stretch에서 허용.
LLM_PACKAGES_JS_ANTHROPIC = r"(@anthropic-ai/sdk|@anthropic-ai/bedrock-sdk)"
LLM_PACKAGES_PY_ANTHROPIC = r"(anthropic)"

JS_INSTALL = r"\b(npm|pnpm|yarn|bun)\s+(install|add|i)\b"


def _build_blocked_patterns(stage: str) -> list[tuple[str, str]]:
    """단계에 따라 차단 패턴 리스트를 구성.

    Stretch면 Anthropic SDK 제외. Core(또는 미설정)면 전부 차단.
    """
    js_packages = LLM_PACKAGES_JS_BASE
    py_packages = LLM_PACKAGES_PY_BASE

    if stage != "stretch":
        # Core (기본): Anthropic도 차단 대상에 합류.
        # 패턴 결합: (base|anthropic) 형태로 한 번에 검사하기 위해 그룹 병합.
        js_packages = (
            f"(?:{LLM_PACKAGES_JS_BASE.strip('()')}|"
            f"{LLM_PACKAGES_JS_ANTHROPIC.strip('()')})"
        )
        py_packages = (
            f"(?:{LLM_PACKAGES_PY_BASE.strip('()')}|"
            f"{LLM_PACKAGES_PY_ANTHROPIC.strip('()')})"
        )

    return [
        (
            # scoped package (@anthropic-ai/sdk 등) 포함. word-char 선행 없음, 뒤는 공백/@/끝.
            rf"{JS_INSTALL}[^\n]*(?<!\w){js_packages}(?=[\s@]|$)",
            "Node LLM SDK 설치",
        ),
        (
            # Vercel AI SDK: 정확히 'ai'. 공백/줄시작 직후 + 공백/끝/@version.
            rf"{JS_INSTALL}[^\n]*(?:\s|^)ai(?:@[^\s]*)?(?=\s|$)",
            "Vercel AI SDK (npm install ai)",
        ),
        (
            rf"\bpip(?:3)?\s+install\b[^\n]*\b{py_packages}\b",
            "Python LLM SDK 설치",
        ),
        (
            rf"\buv\s+(add|pip\s+install)\b[^\n]*\b{py_packages}\b",
            "uv로 Python LLM SDK 설치",
        ),
    ]


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception as e:
        sys.stderr.write(f"[hook error: block_llm_deps] {type(e).__name__}: {e}\n")
        return 1

    if data.get("tool_name") != "Bash":
        return 0

    cmd = str(data.get("tool_input", {}).get("command", ""))
    if not cmd:
        return 0

    stage = os.environ.get("CHEAPSKY_STAGE", "core").lower()
    blocked = _build_blocked_patterns(stage)

    for pat, label in blocked:
        m = re.search(pat, cmd, re.IGNORECASE)
        if m:
            stage_msg = (
                "Stretch 단계에서 Anthropic SDK만 허용되며, 여기 매치된 것은 그 외 LLM SDK입니다."
                if stage == "stretch"
                else (
                    "Core 단계에서는 모든 LLM SDK 설치가 차단됩니다. "
                    "Stretch 진입 시 `export CHEAPSKY_STAGE=stretch` 후 재시도하세요 "
                    "(단, Anthropic SDK만 허용됨)."
                )
            )
            sys.stderr.write(
                f"차단됨: {label}\n"
                f"  매치: {m.group(0)!r}\n"
                f"  현재 CHEAPSKY_STAGE: {stage}\n\n"
                f"ADR-005: LLM 정책. {stage_msg}\n"
                "정책 변경이 필요하면 docs/ADR.md를 먼저 업데이트하세요.\n"
            )
            return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
