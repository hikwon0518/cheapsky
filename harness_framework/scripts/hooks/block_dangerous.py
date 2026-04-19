#!/usr/bin/env python3
"""PreToolUse Bash 훅: 위험 명령 차단.

하네스가 `--dangerously-skip-permissions`로 Claude를 실행하므로 권한 프롬프트가
없다. 그 대신 이 훅이 stdin의 tool_input.command를 검사해 파괴적 명령만 차단한다.
exit 2 = block (Claude Code 컨벤션).

rm -rf 는 첫 타겟 토큰을 추출해 금지 타겟 목록(루트/홈/.git/phases/docs 등)과
대조한다. 단순 `rm -rf /home/user/build` 같은 합법적 삭제는 통과한다.
"""
import json
import re
import sys

# python -c "..." 내부 위험 토큰 스캔 (dontAsk 모드 + python 와일드카드 대비)
PY_C_PAYLOAD_RE = re.compile(
    r"(?:\bpython[0-9.]*|\bpy(?:\.exe)?(?:\s+-\d[\d.]*)?|[^\s]+/python[0-9.]*(?:\.exe)?)\s+"
    r"(?:-[A-Za-z]+\s+)*-c\s+"
    r"([\"'])(.*?)\1",
    re.IGNORECASE | re.DOTALL,
)

DANGEROUS_PY_C = [
    (r"\bos\.system\s*\(", "python -c 내 os.system()"),
    (r"\bsubprocess\.(run|Popen|call|check_call|check_output)\b", "python -c 내 subprocess"),
    (r"\bshutil\.rmtree\s*\(", "python -c 내 shutil.rmtree()"),
    (r"\bos\.(remove|unlink|rmdir|removedirs)\s*\(", "python -c 내 os 파일 삭제"),
    (r"__import__\s*\(\s*[\"'](os|subprocess|shutil)", "python -c 내 __import__ (os/subprocess/shutil)"),
    (r"\bexec\s*\(", "python -c 내 exec()"),
    (r"\beval\s*\(", "python -c 내 eval()"),
]

# rm -rf (또는 -fr / -Rf 등) 뒤에 오는 첫 타겟을 추출
RM_RF_RE = re.compile(
    r"\brm\s+(?:-[a-zA-Z]*[rfRF][a-zA-Z]*\s+)+(?P<target>\S+)",
    re.IGNORECASE,
)

# 차단할 rm 타겟 (첫 토큰 기준)
RM_RF_BANNED_TARGETS = [
    (re.compile(r"^/$"), "루트 /"),
    (re.compile(r"^/\*"), "/* (루트 전체)"),
    (re.compile(r"^~/?$"), "홈 ~"),
    (re.compile(r"^\$\{?HOME\b"), "$HOME"),
    (re.compile(r"^\*$"), "wildcard *"),
    (re.compile(r"^\.{1,2}/?$"), ". 또는 .. (현재/상위)"),
    (re.compile(r"^(?:\./)?\.git(?:/|$)"), ".git (복구 불가)"),
    (re.compile(r"^(?:\./)?phases(?:/|$)"), "phases/ (하네스 산출물)"),
    (re.compile(r"^(?:\./)?docs(?:/|$)"), "docs/ (유일한 진실 소스)"),
    (re.compile(r"^(?:\./)?scripts(?:/|$)"), "scripts/ (하네스 코드)"),
    (re.compile(r"^(?:\./)?src(?:/|$)"), "src/ (앱 소스)"),
    (re.compile(r"^(?:\./)?\.claude(?:/|$)"), ".claude/ (설정)"),
    (re.compile(r"^\$\("), "$(...) 동적 타겟"),
    (re.compile(r"^`"), "백틱 동적 타겟"),
]

DANGEROUS = [
    (r"\bsudo\s+rm\s+-[rfRF]+\s+/", "sudo rm -rf /"),
    # git push --force — 플래그가 명령 중간 어디에 있어도 매치. --force-with-lease 는 예외.
    (r"\bgit\s+push\b[^\n]*?(?<!\S)(?:-f(?!\w)|--force(?!-with-lease))", "git push --force (--force-with-lease가 아님)"),
    (r"\bgit\s+reset\s+--hard\b", "git reset --hard"),
    (r"\bgit\s+clean\s+-[a-z]*f", "git clean -f"),
    (r"\bgit\s+checkout\s+\.", "git checkout . (변경 전부 날림)"),
    (r"\bgit\s+restore\s+\.", "git restore . (변경 전부 날림)"),
    (r"\bgit\s+branch\s+-D\b", "git branch -D"),
    (r"\bDROP\s+(TABLE|DATABASE|SCHEMA)\b", "DROP TABLE/DATABASE/SCHEMA"),
    (r"\bTRUNCATE\s+TABLE\b", "TRUNCATE TABLE"),
    (r"\bdd\s+[^\n]*\bof=/dev/[hs]d", "dd to physical device"),
    (r">\s*/dev/[hs]d[a-z]", "redirect to physical device"),
    (r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:", "fork bomb"),
    # curl/wget pipe-to-shell — 임의 스크립트 실행
    (r"\b(?:curl|wget)\b[^\n]*\|\s*(?:bash|sh|zsh|dash|ksh)\b", "curl/wget | sh (임의 스크립트 실행)"),
    # chmod -R 777 on 루트/홈
    (r"\bchmod\s+-R\s+[0-7]{3,4}\s+(?:/(?:\s|$)|~|\$HOME)", "chmod -R 777 on 루트/홈"),
    # Windows 포맷 / PowerShell 강제 재귀 삭제
    (r"\bformat(?:\.exe)?\s+[A-Za-z]:", "format C: 드라이브 포맷"),
    (r"\bRemove-Item\b[^\n]*-Recurse[^\n]*-Force", "PowerShell Remove-Item -Recurse -Force"),
]


def _check_rm_rf(cmd: str):
    """rm -rf 명령의 타겟이 금지 목록에 있으면 (label, matched_text) 반환."""
    for m in RM_RF_RE.finditer(cmd):
        target = m.group("target")
        # 옵션 플래그 연속은 이미 RM_RF_RE가 소비했으므로 여기서는 실제 타겟
        for pat, label in RM_RF_BANNED_TARGETS:
            if pat.search(target):
                return label, f"rm ... {target}"
    return None


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception as e:
        sys.stderr.write(f"[hook error: block_dangerous] {type(e).__name__}: {e}\n")
        return 1

    if data.get("tool_name") != "Bash":
        return 0

    cmd = str(data.get("tool_input", {}).get("command", ""))
    if not cmd:
        return 0

    rm_hit = _check_rm_rf(cmd)
    if rm_hit:
        label, matched = rm_hit
        sys.stderr.write(
            f"차단됨: rm -rf 금지 타겟 ({label})\n"
            f"  매치: {matched!r}\n"
            "복구 불가능한 디렉토리 삭제를 차단했습니다. 의도한 것이라면\n"
            "명령을 세분화하거나 block_dangerous.py 의 RM_RF_BANNED_TARGETS 를 조정하세요.\n"
        )
        return 2

    for pat, label in DANGEROUS:
        m = re.search(pat, cmd, re.IGNORECASE)
        if m:
            sys.stderr.write(
                f"차단됨: {label}\n"
                f"  매치: {m.group(0)!r}\n"
                "하네스는 --dangerously-skip-permissions 로 실행되므로 이 계열 명령은\n"
                "반드시 수동 확인을 거치세요.\n"
            )
            return 2

    for pm in PY_C_PAYLOAD_RE.finditer(cmd):
        payload = pm.group(2)
        for pat, label in DANGEROUS_PY_C:
            m2 = re.search(pat, payload, re.IGNORECASE)
            if m2:
                sys.stderr.write(
                    f"차단됨: {label}\n"
                    f"  매치: {m2.group(0)!r}\n"
                    f"  전체 payload: {payload[:120]!r}\n"
                    "python -c 인라인 코드로 임의 OS 호출 시도가 감지되었습니다.\n"
                )
                return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
