# Harness Framework

Claude Code를 `-p --dangerously-skip-permissions` 모드로 불러 **phase 기반 단계 실행**을 자동화하는 도구. 문서(`docs/`) + `CLAUDE.md` + 각 step 파일을 가드레일로 주입해 일관된 맥락에서 코드를 생성한다.

## 빠른 시작

### 0. 사전 준비
- Python **3.12 이상** (`py -3.12 --version` 으로 확인)
- `claude` CLI가 PATH에 있어야 함 (`which claude` 로 확인)
- 이 디렉토리가 git 레포여야 함 (`_commit_step`, `_checkout_branch`가 git 사용)

### 1. Phase 설계
interactive Claude 세션에서:
```
/harness
```
를 실행하면 `.claude/commands/harness.md` 가 로드되어 phase 설계 워크플로우를 가이드한다. 산출물:
- `phases/index.json` — 전체 phase 목록
- `phases/<task-name>/index.json` — 해당 phase의 step 목록
- `phases/<task-name>/stepN.md` — 각 step의 명세 (읽을 파일, 작업, AC, 금지사항)

### 2. 실행
```bash
python scripts/execute.py <task-name>            # 순차 실행
python scripts/execute.py <task-name> --push     # 완료 후 origin push
python scripts/execute.py <task-name> --dry-run  # 다음 pending step 프롬프트만 출력
```

### 3. 에러 복구
- **error**: `phases/<task>/index.json`에서 해당 step `status`를 `pending`으로 바꾸고 `error_message` 삭제 → 재실행
- **blocked**: `blocked_reason`을 해결(보통 API 키·외부 인증·수동 설정)한 뒤 `status`를 `pending`으로 바꾸고 `blocked_reason` 삭제 → 재실행

## 구성

```
harness_framework/
├── .claude/
│   ├── commands/        # /harness, /review 슬래시 커맨드
│   └── settings.json    # Bash 위험 명령 차단 훅 (block_dangerous.py)
├── CLAUDE.md            # 프로젝트 red line (execute.py가 매 step 프롬프트에 주입)
├── docs/                # PRD/ARCHITECTURE/ADR/UI_GUIDE 등 (_load_guardrails가 전체 주입)
├── phases/              # task별 index.json + stepN.md + stepN-output.json (gitignored)
└── scripts/
    ├── execute.py       # StepExecutor — phase 순차 실행 + 재시도 + 자동 커밋
    ├── test_execute.py  # 60개 유닛 테스트
    └── hooks/           # Claude Code 훅
        ├── check_ui_slop.py    # Write/Edit: AI 슬롭 CSS/Tailwind 차단
        ├── block_llm_deps.py   # Bash: LLM SDK 설치 차단 (ADR-005)
        ├── block_dangerous.py  # Bash: rm -rf / 등 파괴적 명령 차단
        └── phase_status.py     # SessionStart: phases/index.json 상태를 컨텍스트로 주입
```

## StepExecutor가 자동화하는 것

- `feat-<phase-name>` 브랜치 생성·checkout
- 매 step 프롬프트 조립: `CLAUDE.md + docs/*.md + 이전 step summary + 재시도 시 직전 에러 + step 본문`
- `claude -p --dangerously-skip-permissions --output-format json` 서브프로세스 실행 (UTF-8, 1800s timeout)
- AC 검증 실패 시 **최대 3회 재시도** (직전 에러 메시지를 다음 프롬프트에 포함)
- 2단계 커밋: 코드 변경은 `feat(<phase>): step N — <name>`, 메타데이터는 `chore(<phase>): step N output`
- 타임스탬프 자동 기록: `created_at`, `started_at`, `completed_at`, `failed_at`, `blocked_at`
- `phases/index.json` (top-level)의 phase 상태 동기화

## 상태 전이

| From | To | 트리거 | 기록 |
|------|----|----|------|
| pending | in_progress | step 시작 | `started_at` |
| in_progress | completed | Claude 세션이 status 변경 + AC 통과 | `completed_at`, `summary` |
| in_progress | error | 3회 재시도 후 status 미변경 | `failed_at`, `error_message` |
| in_progress | blocked | Claude 세션이 명시적으로 blocked로 변경 | `blocked_at`, `blocked_reason` |

## 테스트

```bash
py -3.12 -m pytest scripts/test_execute.py -v
```
60개 테스트. 인코딩·타임아웃·재시도·forward iteration 등 회귀 방지 포함.

## 훅 동작 확인

훅은 `cheapsky/.claude/settings.local.json` (Write/Edit/Bash/SessionStart) + `harness_framework/.claude/settings.json` (Bash) 에 등록되어 있다. 훅이 동작하지 않는 것처럼 보이면:

1. `py -3.12` 런처가 잡히는지: `which py` + `py -3.12 --version`
2. 훅 스크립트 직접 실행: `echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /"}}' | py -3.12 scripts/hooks/block_dangerous.py` → exit 2
3. Claude Code `--debug` 로 훅 디버그 로그 확인

## 훅 상속 (하네스-자식 Claude 세션)

`execute.py::_invoke_claude`는 `claude -p --dangerously-skip-permissions`로 자식 Claude 세션을 `cwd=harness_framework/`에서 실행한다. 이 자식 세션은:

1. **부모 설정 상속** — Claude Code는 cwd 조상 방향으로 `.claude/settings*.json`을 탐색. 따라서 `cheapsky/.claude/settings.local.json`의 훅(block_llm_deps, block_dangerous, check_ui_slop)이 자식 세션에도 적용된다.
2. **`--dangerously-skip-permissions`의 범위** — 이 플래그는 permission prompt만 우회. 훅(PreToolUse/PostToolUse/Stop 등)은 **bypass하지 않음**. 따라서 자식 세션이 `rm -rf /` 같은 위험 명령을 시도해도 block_dangerous.py가 차단.
3. **실측 증거** — interactive 세션에서 동일 훅 체인이 `npm install ai` 를 실제로 차단한 것이 확인됨.

결론: 하네스가 생성한 Claude 세션도 훅이 작동한다. 훅 스크립트가 내부 예외로 죽으면 exit 1 + stderr 메시지를 남기므로(silent failure 방지), 이상 동작은 터미널에서 가시화된다.

## 주의

- `--dangerously-skip-permissions` 사용: 따라서 위험 명령 차단은 **훅 체인에 의존**. 훅 스크립트가 죽지 않도록 조심할 것 (예: Python 경로 변경, regex 문법 오류)
- `--output-format json` 으로 Claude 출력 파싱 → Claude CLI의 출력 형식 변경 시 깨질 수 있음
- phase 디렉토리·step 파일을 하네스 실행 중 수동 편집하면 상태 꼬임. 실행 전 편집 또는 `status: pending` 리셋 후 실행
