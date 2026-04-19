# Step 0: llm-parser-fallback

## 읽어야 할 파일

- `docs/ADR.md` — **ADR-005 (LLM 제한적 사용)**, ADR-008 (저작권·ToS 방어), ADR-022 (시세 API Deprecated, Anthropic 무관)
- `docs/ARCHITECTURE.md` — "데이터 흐름 (2) 딜 크롤" 중 LLM 파싱 폴백 분기, "환경 변수" 표
- 이전 산출물:
  - `app/src/services/parser/rules.ts` (규칙 파서, fail-soft)
  - `app/src/types/deal.ts` (`DealDraft.parsedBy: 'rules' | 'llm' | null`)
  - `app/scripts/crawl.ts` (파이프라인)
  - `app/.env.example` · `app/.env.local` (`ANTHROPIC_API_KEY` 준비됨)

## 선행 조건

**이 step 및 전체 phases/2-stretch-enhancements 는 `CHEAPSKY_STAGE=stretch` 환경변수 하에서 실행**. Core gate 해제 시에만 Anthropic SDK 설치 허용 (ADR-005 훅 게이트).

## 작업

앱 루트는 `cheapsky/app/`. 이 step 은 **규칙 파서 실패분**에 한해 Claude Haiku 4.5 로 재시도하는 폴백 레이어.

### 1) Anthropic SDK 설치

```bash
cd C:/Users/hukyu/Project_Document/cheapsky/app
pnpm add @anthropic-ai/sdk
```

`package.json` 의 `dependencies` 에 `@anthropic-ai/sdk` 추가. 다른 LLM SDK 금지 (`openai`, `@google/generative-ai`, `cohere-ai`, `langchain`, `ai` 등 — ADR-005 red line).

### 2) `src/lib/llm-budget.ts`

```ts
export type BudgetTracker = {
  recordUsage(tokensIn: number, tokensOut: number): Promise<void>;  // api_usage_daily 에 UPSERT
  canSpend(): Promise<boolean>;  // 오늘 사용량 vs LLM_DAILY_BUDGET (기본 300 호출)
  remaining(): Promise<number>;
}
export function createBudget(client: SupabaseClient, env: Env): BudgetTracker
```

- 입력: `LLM_DAILY_BUDGET` env (기본 300 호출)
- 저장: `api_usage_daily.anthropic_tokens_{in,out}` 에 UPSERT
- 한도 초과 → `canSpend() === false` → caller 가 즉시 stop

**단위 테스트** (`llm-budget.test.ts`): budget 경계값, 동일 날짜 UPSERT 가산.

### 3) `src/services/parser/llm.ts`

```ts
import Anthropic from '@anthropic-ai/sdk';
import type { RawPost, DealDraft } from '@/types/deal';

export type LlmConfig = {
  apiKey: string;
  model?: string;  // 기본 'claude-haiku-4-5-20251001'
  budget: BudgetTracker;
  client?: Anthropic;  // 테스트 주입
};

export async function parseLlm(post: RawPost, config: LlmConfig): Promise<DealDraft>
```

요구사항 (ADR-005):
- **입력 범위**: 제목 + 본문 앞 500자까지만 prompt 에 포함. 본문 전문 전송 금지
- System prompt: "항공권 딜 제목에서 origin/destination (IATA), priceKrw(정수), tripType('oneway'|'roundtrip'), departFrom/To (ISO date 또는 null), carrierCode (IATA 2-letter)을 JSON 으로 추출. 모르면 null. **외부 지식·계절·이벤트 추론 금지**. 제공된 텍스트만 사용."
- Structured output: Anthropic tool use 또는 JSON mode 사용. 필드 스키마 강제
- **모델 고정**: `claude-haiku-4-5-20251001` (CLAUDE.md 기술 스택). claude-opus·sonnet·기타 모델 사용 금지
- **1회 지수 백오프, 2회째 실패 스킵, 429 즉시 중단** (ADR-005)
- `parsedBy: 'llm'` set
- 반환 DealDraft 는 rules 와 동일 스키마 (타입 재사용)
- budget.canSpend() 확인 후에만 호출. budget 초과 시 null 반환 대신 규칙 실패 그대로 둠

### 4) `scripts/crawl.ts` 분기 확장

```ts
// 현재: 규칙만
let draft = parseRules(post);

// Stretch 2:
if (isStretchStage() && (!draft.origin || !draft.destination || !draft.priceKrw)) {
  if (await budget.canSpend()) {
    const llmDraft = await parseLlm(post, llmConfig);
    if (llmDraft.origin && llmDraft.destination && llmDraft.priceKrw) {
      draft = llmDraft;
    }
  }
}

function isStretchStage(): boolean {
  return process.env.CHEAPSKY_STAGE === 'stretch';
}
```

Core 환경(CHEAPSKY_STAGE 미설정) 에서는 이 분기 자체가 실행 안 됨 → Anthropic SDK 도 dynamic import 또는 stage gate 로 Core 빌드에 영향 없게.

### 5) 프롬프트 캐싱 (Anthropic)

`claude-api` skill 원칙: 시스템 프롬프트 + 장문 지시문은 `cache_control: { type: 'ephemeral' }` 로 캐싱. 이 step 에서 파싱 프롬프트 길이 > 1024 토큰 되지 않으면 캐싱 생략 (해당 모델 캐싱 최소 길이 미달 가능). 단순 파싱이면 프롬프트 짧아 캐시 이득 없음 — 구현 안 해도 됨.

### 6) 테스트

`src/services/parser/llm.test.ts`:
- Anthropic client mock 으로 성공 응답 → DealDraft 반환, parsedBy='llm'
- 429 에러 → 빈 필드로 폴백 (throw 안 함)
- budget.canSpend()=false → 호출 자체 skip
- 본문 500자 초과 입력 → 500자로 cut 후 전송 (assertion 으로 확인)
- 모델명이 정확히 'claude-haiku-4-5-20251001' 로 호출됨

### 7) 스모크 (실 API 호출 — 비용 최소화)

```bash
export CHEAPSKY_STAGE=stretch
cd C:/Users/hukyu/Project_Document/cheapsky/app
pnpm tsx scripts/crawl.ts
```

api_usage_daily.anthropic_tokens_in 이 증가하는지 확인. 증가량은 rawPosts × 프롬프트 토큰 수.

## Acceptance Criteria

```bash
export CHEAPSKY_STAGE=stretch
cd C:/Users/hukyu/Project_Document/cheapsky/app
pnpm build
pnpm test
pnpm exec tsc --noEmit
pnpm lint
pnpm tsx scripts/crawl.ts   # api_usage_daily.anthropic_tokens_in > 0 (RawPost 있을 때)
```

Core 환경 (CHEAPSKY_STAGE 미설정) 에서도 build 는 통과해야 함:
```bash
unset CHEAPSKY_STAGE
pnpm build    # 빌드 OK
pnpm tsx scripts/crawl.ts   # LLM 분기 안 탐 → anthropic_tokens_in 증가 없음
```

## 검증 절차

1. 위 AC 전부 성공
2. `package.json` 에 `@anthropic-ai/sdk` 만 LLM SDK 로 추가, 다른 LLM/AI SDK 없음
3. `services/parser/llm.ts` 가 `claude-haiku-4-5-20251001` 하드코딩
4. 500자 cut 이 prompt 전송 전에 적용됨 (테스트로 증명)
5. budget 초과 시 호출 skip
6. 상태 업데이트:
   - 성공 → `"status": "completed"`, `"summary": "services/parser/llm.ts (Haiku 4.5, 제목+본문500자, structured JSON, 1회 백오프, 429 중단) + lib/llm-budget.ts (api_usage_daily UPSERT, 일 300회 상한) + scripts/crawl.ts 에 isStretchStage + canSpend 분기. 규칙 파싱 커버리지 위에 LLM 폴백 얹음. @anthropic-ai/sdk 추가, 기타 LLM SDK 없음."`

## 금지사항

- **Claude Haiku 4.5 외 모델 사용 금지** (CLAUDE.md 기술 스택). 이유: 비용·Stretch 경계
- **다른 LLM SDK 설치·import 금지** (ADR-005 red line). 이유: 훅이 차단하지만 defense-in-depth
- **본문 전문 LLM 전송 금지** (ADR-005/008 교차). 이유: 저작권·학습 데이터 리스크. 500자 cut 필수
- **계절·이벤트·외부 지식 추론 허용 금지** (할루시네이션). 이유: 시스템 프롬프트로 명시 차단
- **Core 빌드에 Anthropic SDK 정적 import 유출 금지**. 이유: CHEAPSKY_STAGE=stretch 때만 분기 타야 함. dynamic import 또는 stage gate 활용
- **`claude-opus-*` / `claude-sonnet-*` / `claude-3-*` 모델 사용 금지**. 이유: 비용 초과. Haiku 4.5 고정
