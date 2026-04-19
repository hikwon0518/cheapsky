이 프로젝트는 Harness 프레임워크를 사용한다. 아래 워크플로우에 따라 작업을 진행하라.

> **유일한 진실 소스는 `harness_framework/docs/`**. 본 커맨드·루트 `CLAUDE.md`·`harness_framework/CLAUDE.md`는 docs의 요약 포인터일 뿐이다. docs와 충돌이 보이면 **docs 기준으로 해석하고 사용자에게 지적한다**.

---

## 워크플로우

### A. 탐색

`harness_framework/docs/` 하위 문서를 **반드시 아래 순서로** 읽어 프로젝트의 기획·아키텍처·설계 의도를 파악한다. 필요 시 Explore 에이전트를 병렬로 사용한다.

1. `docs/PRD.md` — 목표·페르소나·Core/Stretch 범위·성공 지표·실패 경로 UX
2. `docs/ARCHITECTURE.md` — 디렉토리·데이터 모델·데이터 흐름·장애 복구
3. `docs/ADR.md` — 28개 결정. **각 ADR의 `[Core]` / `[Stretch]` 태그를 주목**
4. `docs/UI_GUIDE.md` — 팔레트·AI 슬롭 금지·접근성
5. `docs/methodology.md` — 시드 baseline (Amadeus 장애 폴백)
6. `docs/BACKLOG.md` — MVP 범위 밖 아이디어 (절대 이걸 구현 대상으로 끌어오지 않음)

루트 `cheapsky/CLAUDE.md`와 `harness_framework/CLAUDE.md`는 red line 요약이다. docs를 읽지 않고 CLAUDE.md만 참조하지 않는다.

### B. 논의

구현을 위해 구체화하거나 기술적으로 결정해야 할 사항이 있으면 사용자에게 제시하고 논의한다.

### C. Step 설계

사용자가 구현 계획 작성을 지시하면 여러 step으로 나뉜 초안을 작성해 피드백을 요청한다.

**task 분리 원칙 (Core/Stretch)**:
- Cheapsky는 `docs/ADR.md` ADR-026에 따라 **Core / Stretch 두 트랙**으로 분리된다
- **Core task를 먼저 설계하고 완성하지 않으면 Stretch task를 제안하거나 시작하지 않는다**
- 권장 task 구성:
  - `phases/0-core-mvp/` — Core 범위 전체 (6~8 steps 예상). **첫 step은 반드시 "부트스트랩"**: Next.js 프로젝트 생성 + `.env.example` + `tsconfig.json` + `tailwind.config.ts` + `pnpm-lock.yaml` + 디렉토리 스캐폴딩. 이 step 없이 다음 step들이 막힘
  - `phases/1-stretch-sources/` — 루리웹·플레이윙즈·Community Picks (크롤러 확장 + 사회적 신호 UI). Core 완료 후에만
  - `phases/2-stretch-enhancements/` — LLM 파싱 폴백·큐레이션 / 스파크라인 / 시세 히트맵 / 아카이브 / 노선 빈도
- Stretch task 실행 시 사용자에게 `export CHEAPSKY_STAGE=stretch`를 shell에서 먼저 설정하도록 안내한다 (ADR-005 LLM 훅 게이트 해제). 단, `1-stretch-sources`는 LLM 의존 없음이라 env 설정 불필요

설계 원칙:

1. **Scope 최소화** — 하나의 step에서 하나의 레이어 또는 모듈만. 여러 모듈을 동시에 수정해야 하면 step을 쪼갠다.
2. **자기완결성** — 각 step 파일은 독립된 Claude 세션에서 실행된다. "이전 대화에서 논의한 바와 같이" 같은 외부 참조 금지. 필요한 정보는 전부 파일 안에.
3. **사전 준비 강제** — 관련 문서 경로와 이전 step에서 생성/수정된 파일 경로를 명시한다.
4. **ADR 준수 명시 (최대 3개)** — 해당 step과 직접 관련된 **ADR 번호 3개 이하**만 "핵심 규칙" 블록에 명기한다. 예: `ADR-005 위반 금지: Core 단계 LLM SDK 설치 금지`. 그 외 ADR은 자동 주입(`execute.py`가 `docs/*.md` 전체를 매 step 프롬프트에 포함)으로 커버됨을 믿는다
5. **시그니처 수준 지시** — 함수/클래스 인터페이스만 제시, 내부 구현은 에이전트 재량. 단, 설계 의도에서 벗어나면 안 되는 핵심 규칙(멱등성·보안·데이터 무결성)은 명시
6. **AC는 실행 가능한 커맨드** — `pnpm build && pnpm test` 같은 실제 실행 커맨드
7. **주의사항은 구체적으로** — "조심해라" 대신 "X를 하지 마라. 이유: Y" 형식
8. **네이밍** — kebab-case slug, 한두 단어 (예: `project-bootstrap`, `amadeus-client`, `ppomppu-crawler`, `hero-section`)

### D. 파일 생성

사용자가 승인하면 아래 파일들을 생성한다.

#### D-1. `phases/index.json` (전체 현황)

여러 task를 관리하는 top-level 인덱스. 이미 존재하면 `phases` 배열에 새 항목을 추가한다.

```json
{
  "phases": [
    {
      "dir": "0-mvp",
      "status": "pending"
    }
  ]
}
```

- `dir`: task 디렉토리명.
- `status`: `"pending"` | `"completed"` | `"error"` | `"blocked"`. execute.py가 실행 중 자동으로 업데이트한다.
- 타임스탬프(`completed_at`, `failed_at`, `blocked_at`)는 execute.py가 상태 변경 시 자동 기록한다. 생성 시 넣지 않는다.

#### D-2. `phases/{task-name}/index.json` (task 상세)

```json
{
  "project": "<프로젝트명>",
  "phase": "<task-name>",
  "steps": [
    { "step": 0, "name": "project-setup", "status": "pending" },
    { "step": 1, "name": "core-types", "status": "pending" },
    { "step": 2, "name": "api-layer", "status": "pending" }
  ]
}
```

필드 규칙:

- `project`: 프로젝트명 (CLAUDE.md 참조).
- `phase`: task 이름. 디렉토리명과 일치시킨다.
- `steps[].step`: 0부터 시작하는 순번.
- `steps[].name`: kebab-case slug.
- `steps[].status`: 초기값은 모두 `"pending"`.

상태 전이와 자동 기록 필드:

| 전이 | 기록되는 필드 | 기록 주체 |
|------|-------------|----------|
| → `completed` | `completed_at`, `summary` | Claude 세션 (summary), execute.py (timestamp) |
| → `error` | `failed_at`, `error_message` | Claude 세션 (message), execute.py (timestamp) |
| → `blocked` | `blocked_at`, `blocked_reason` | Claude 세션 (reason), execute.py (timestamp) |

`summary`는 step 완료 시 산출물을 한 줄로 요약한 것으로, execute.py가 다음 step 프롬프트에 컨텍스트로 누적 전달한다. 따라서 다음 step에 유용한 정보(생성된 파일, 핵심 결정 등)를 담아야 한다.

`created_at`은 execute.py가 최초 실행 시 task 레벨에 한 번만 기록한다. step 레벨의 `started_at`도 execute.py가 각 step 시작 시 자동 기록한다. 생성 시 넣지 않는다.

#### D-3. `phases/{task-name}/step{N}.md` (각 step마다 1개)

```markdown
# Step {N}: {이름}

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md`
- {이전 step에서 생성/수정된 파일 경로}

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

{구체적인 구현 지시. 파일 경로, 클래스/함수 시그니처, 로직 설명을 포함.
코드 스니펫은 인터페이스/시그니처 수준만 제시하고, 구현체는 에이전트에게 맡겨라.
단, 설계 의도에서 벗어나면 안 되는 핵심 규칙은 명확히 박아넣어라.}

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 테스트 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/{task-name}/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (API 키, 외부 인증, 수동 설정 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- {이 step에서 하지 말아야 할 것. "X를 하지 마라. 이유: Y" 형식}
- 기존 테스트를 깨뜨리지 마라
```

### E. 실행

**Stage 환경 변수** (ADR-005 훅 게이트):
- Core task: 기본 (환경변수 설정 없음). LLM SDK 설치 차단
- Stretch task: `export CHEAPSKY_STAGE=stretch` 먼저 설정. Anthropic SDK만 추가 허용

```bash
# Core task (env 불필요)
python3 scripts/execute.py 0-core-mvp

# Stretch 1 — sources (env 불필요, LLM 미사용)
python3 scripts/execute.py 1-stretch-sources

# Stretch 2 — enhancements (LLM 사용, env 필수)
export CHEAPSKY_STAGE=stretch
python3 scripts/execute.py 2-stretch-enhancements

# 완료 후 push
python3 scripts/execute.py {task-name} --push
```

execute.py가 자동으로 처리하는 것:

- `feat-{task-name}` 브랜치 생성/checkout
- 가드레일 주입 — CLAUDE.md + docs/*.md 내용을 매 step 프롬프트에 포함
- 컨텍스트 누적 — 완료된 step의 summary를 다음 step 프롬프트에 전달
- 자가 교정 — 실패 시 최대 3회 재시도하며, 이전 에러 메시지를 프롬프트에 피드백
- 2단계 커밋 — 코드 변경(`feat`)과 메타데이터(`chore`)를 분리 커밋
- 타임스탬프 — started_at, completed_at, failed_at, blocked_at 자동 기록

에러 복구:

- **error 발생 시**: `phases/{task-name}/index.json`에서 해당 step의 `status`를 `"pending"`으로 바꾸고 `error_message`를 삭제한 뒤 재실행한다.
- **blocked 발생 시**: `blocked_reason`에 적힌 사유를 해결한 뒤, `status`를 `"pending"`으로 바꾸고 `blocked_reason`을 삭제한 뒤 재실행한다.
