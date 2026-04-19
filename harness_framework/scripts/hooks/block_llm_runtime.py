#!/usr/bin/env python3
"""PreToolUse Write/Edit/MultiEdit 훅: LLM runtime import 차단.

ADR-005: Core 단계에는 LLM API 호출 전면 금지. block_llm_deps 는 SDK 설치를
막지만, 이미 설치되어 있거나 monorepo 의 다른 패키지로 제공되는 경우를 대비해
소스 코드 레벨에서도 LLM import 를 차단한다.

- Core (기본): 모든 LLM import 차단
- Stretch (`CHEAPSKY_STAGE=stretch`): `@anthropic-ai/sdk` · `anthropic` 만 허용

훅 스크립트 자체·테스트 파일은 리터럴 문자열로 패턴을 포함하므로 예외.
"""
import json
import os
import re
import sys

TARGET_EXTS = (".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".py")

# 모든 단계에서 항상 차단 (ADR-005: Anthropic 외 LLM SDK 사용 금지)
LLM_IMPORTS_ALWAYS = [
    (r"""(?:\bfrom|\bimport)\s+[\"']openai[\"']""", "openai import"),
    (r"""\bfrom\s+[^\s;'"\n]*\s+from\s+[\"']openai[\"']""", "openai import"),
    (r"""\brequire\s*\(\s*[\"']openai[\"']""", "openai require"),
    (r"""\bimport\s+openai\b(?!\s*=)""", "openai (Python)"),
    (r"""\bfrom\s+openai\s+import""", "from openai import (Python)"),
    (r"""[\"']@google/generative-ai[\"']""", "Google GenAI"),
    (r"""\bfrom\s+google\.generativeai\b""", "Google GenAI (Python)"),
    (r"""[\"']cohere-ai[\"']""", "cohere"),
    (r"""[\"']@mistralai/mistralai[\"']""", "Mistral"),
    (r"""[\"']groq-sdk[\"']""", "Groq"),
    (r"""[\"']together-ai[\"']""", "Together"),
    (r"""[\"']langchain(?:/[^\"']*)?[\"']""", "LangChain"),
    (r"""\bimport\s+langchain\b""", "LangChain (Python)"),
    (r"""\bfrom\s+langchain(?:\.\w+)*\s+import\b""", "LangChain (Python from ... import)"),
    (r"""\bfrom\s+langgraph(?:\.\w+)*\s+import\b""", "LangGraph (Python)"),
    (r"""\bimport\s+litellm\b""", "LiteLLM (Python)"),
    # Vercel AI SDK — 정확히 'ai' 패키지. 'ai-something' 은 통과.
    (r"""(?:\bfrom|\brequire\s*\()\s*[\"']ai[\"']""", "Vercel AI SDK"),
    (r"""\bimport\s+[^;'"\n]*\bfrom\s+[\"']ai[\"']""", "Vercel AI SDK"),
]

# Core 단계에서만 추가 차단 (Stretch 는 허용)
LLM_IMPORTS_CORE_ONLY = [
    (r"""[\"']@anthropic-ai/(?:sdk|bedrock-sdk)[\"']""", "Anthropic SDK"),
    (r"""\bfrom\s+anthropic(?:\.|\s+import)""", "Anthropic (Python)"),
    (r"""\bimport\s+anthropic\b(?!\s*=)""", "Anthropic (Python)"),
]


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


def _is_exempted_path(path: str) -> bool:
    norm = path.lower().replace("\\", "/")
    if "/hooks/" in norm or "/scripts/hooks/" in norm:
        return True
    # 훅/하네스 테스트 파일
    if re.search(r"(?:^|/)test_[^/]+\.py$", norm):
        return True
    if re.search(r"(?:^|/)[^/]+\.test\.(?:ts|tsx|js|jsx)$", norm):
        return True
    return False


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception as e:
        sys.stderr.write(f"[hook error: block_llm_runtime] {type(e).__name__}: {e}\n")
        return 1

    tool = data.get("tool_name", "")
    if tool not in ("Write", "Edit", "MultiEdit"):
        return 0

    tool_input = data.get("tool_input") or {}
    path = str(tool_input.get("file_path", ""))
    if _is_exempted_path(path):
        return 0
    if not path.lower().endswith(TARGET_EXTS):
        return 0

    text = extract_content(tool_input)
    if not text:
        return 0

    stage = os.environ.get("CHEAPSKY_STAGE", "core").lower()
    patterns = list(LLM_IMPORTS_ALWAYS)
    if stage != "stretch":
        patterns += LLM_IMPORTS_CORE_ONLY

    for pat, label in patterns:
        m = re.search(pat, text)
        if m:
            msg = (
                "Stretch 단계에서는 Anthropic 만 허용. 이 import는 정책 위반."
                if stage == "stretch"
                else "Core 단계에서는 모든 LLM import 금지. Stretch 진입 시 `export CHEAPSKY_STAGE=stretch`."
            )
            sys.stderr.write(
                f"차단됨: LLM runtime import ({label})\n"
                f"  경로: {path}\n"
                f"  매치: {m.group(0)!r}\n"
                f"  현재 CHEAPSKY_STAGE: {stage}\n\n"
                f"ADR-005: {msg}\n"
            )
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
