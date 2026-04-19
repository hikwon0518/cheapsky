# Step 1: llm-curation

## 읽어야 할 파일

- `docs/ADR.md` — ADR-005 (LLM 한도: 큐레이션 시간당 50회), ADR-012 (용어·API 이름 노출 금지)
- `docs/ARCHITECTURE.md` — "데이터 흐름 (4) 큐레이션" 프롬프트 예시
- `docs/UI_GUIDE.md` — "카드 한 줄 맥락 (CurationLine)" 2단계 생성 구조
- 이전 산출물:
  - `app/src/services/parser/llm.ts` + `lib/llm-budget.ts` (step 0 에서 구축)
  - `app/src/components/CurationLine.tsx` (규칙 기반 폴백. step 5 Core 에서 `override` prop 추가된 상태)
  - `app/src/types/deal.ts` (`Deal.curationText`, `Deal.curationGeneratedAt`)

## 선행 조건

`CHEAPSKY_STAGE=stretch`. `ANTHROPIC_API_KEY` 준비 완료.

## 작업

### 1) `src/services/curator.ts`

```ts
export type CurationInput = {
  origin: string; destination: string;
  carrierCode: string | null; carrierClass: CarrierClass;
  priceKrw: number;
  baselineP50Krw: number | null; baselineP10Krw: number | null;
  discountRate: number | null; pricePercentile: number | null;
  last30dMinKrw: number | null;
};
export type CurationResult = { text: string | null; tokensIn: number; tokensOut: number };

export async function curateOne(input: CurationInput, config: { apiKey: string; budget: BudgetTracker; client?: Anthropic }): Promise<CurationResult>
```

**프롬프트 규칙 (ADR-005/008/012)**:
- System: *"주어진 숫자만 사용하여 한국어 **60자 이내** 한 문장을 생성. 'API', 'Claude', 'LLM', 'Amadeus', 'Anthropic' 같은 시스템 명칭 언급 금지. '역대가' 사용 금지. 계절·이벤트·외부 지식·감성어 금지. 마침표로 끝낼 것."*
- User: 정제된 숫자 필드만 (`docs/ARCHITECTURE.md` 예시 참조)
- **본문 전송 금지**. 제목도 전송 안 함 — 숫자 필드만
- 출력 예: *"시장 평균 대비 55% 저렴. 지난 30일 이 노선 LCC 최저 수준."*

**후처리 검증**:
- 60자 초과 → cut (`clampCurationText`)
- 금칙어 포함 (`역대가|Amadeus|Anthropic|Claude|LLM|API`) → `text = null` (규칙 폴백 유지)
- 숫자 환각 검증: 응답 문장 내 `\d+%` 숫자가 input 의 discountRate/pricePercentile 과 ±1 오차 이내가 아니면 → `text = null`
- 생성 시각 `curationGeneratedAt = new Date()`

### 2) `scripts/curate.ts` (신규 배치 스크립트)

```bash
pnpm tsx scripts/curate.ts
```

흐름:
1. `crawler_runs` INSERT (source='curator')
2. SELECT deals: `hot_deal=true AND (curation_text IS NULL OR curation_generated_at < now() - interval '24 hours') AND expires_at > now()` LIMIT 50
3. 각 딜마다 `curateOne` 호출. 시간당 50회 상한 (ADR-005). 루프 초반에 `budget.canSpend()` 확인
4. 성공한 text 를 `deals.curation_text`, `curation_generated_at` UPDATE
5. `api_usage_daily.anthropic_tokens_{in,out}` 누적
6. crawler_runs finalize

**프롬프트 캐싱**: 시스템 프롬프트가 정적(매번 동일)이라 `cache_control: { type: 'ephemeral' }` 적용. 50회 배치라 캐시 히트율 49/50 예상.

### 3) `src/components/CurationLine.tsx` — override prop 활용

Core step 5 에서 이미 optional `override` prop 이 있음. page.tsx 에서 deal.curation_text 가 있으면 override 로 전달:

```tsx
<CurationLine deal={deal} override={deal.curationText ?? undefined} />
```

`override` 가 있으면 규칙 기반 텍스트 대신 override 표시. 없으면 규칙 폴백. UI 행동 무영향.

### 4) GH Actions workflow (`.github/workflows/curate.yml`)

```yaml
name: curate
on:
  schedule:
    - cron: '30 * * * *'    # 시간당 1회
  workflow_dispatch:
jobs:
  curate:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: app } }
    env:
      CHEAPSKY_STAGE: stretch          # ADR-005 게이트 해제 (LLM SDK 허용)
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: '10' }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm', cache-dependency-path: app/pnpm-lock.yaml }
      - run: pnpm install --frozen-lockfile
      - run: pnpm tsx scripts/curate.ts
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          LLM_DAILY_BUDGET: '300'
```

CHEAPSKY_STAGE 가 env block 에 명시돼야 curate workflow 에서만 LLM SDK 설치 허용. Core workflows(crawl/verify/cost_check) 는 계속 미설정 상태로 유지.

### 5) 테스트

`src/services/curator.test.ts`:
- 성공 응답 → text 반환, 60자 이내
- 응답 64자 → 60자 cut
- 응답에 "Amadeus" 포함 → text=null
- 응답의 "55%" 가 input.discountRate=0.52 와 어긋남 → text=null
- budget.canSpend()=false → 호출 skip, text=null

### 6) 스모크

```bash
export CHEAPSKY_STAGE=stretch
cd C:/Users/hukyu/Project_Document/cheapsky/app
pnpm tsx scripts/curate.ts
# DB 확인: deals.curation_text 가 일부 행에 채워짐
psql-equivalent: select id, curation_text, curation_generated_at from deals where curation_text is not null limit 5;
```

## Acceptance Criteria

```bash
export CHEAPSKY_STAGE=stretch
cd C:/Users/hukyu/Project_Document/cheapsky/app
pnpm build
pnpm test
pnpm exec tsc --noEmit
pnpm lint
pnpm tsx scripts/curate.ts
```

Core env (CHEAPSKY_STAGE 미설정) 에서 build 통과, curate.ts 는 실행 시 "stage gate" 로 즉시 종료 + crawler_runs.errors 에 사유 기록.

## 검증 절차

1. 위 AC 전부 성공
2. `.github/workflows/curate.yml` 에 `CHEAPSKY_STAGE: stretch` 명시 (Core workflows 와 차별)
3. 시스템 프롬프트에 "역대가"·"Amadeus"·"Anthropic"·"Claude" 금칙어 명시
4. curateOne 반환 text 가 60자 이내 (테스트로 검증)
5. `curate.ts` 의 crawler_runs.source='curator' 기록
6. 상태 업데이트:
   - 성공 → `"status": "completed"`, `"summary": "services/curator.ts + scripts/curate.ts (Haiku 4.5, 60자 cut, 금칙어·숫자 환각 검증, 시스템 프롬프트 cache_control) + .github/workflows/curate.yml (CHEAPSKY_STAGE=stretch) + CurationLine override prop 연동. 실 curate 샘플: <N>건 큐레이션 성공."`

## 금지사항

- **시스템·내부 명칭 UI 노출 금지** (ADR-012). 이유: 불가역. 프롬프트·후처리 이중 방어
- **본문·제목 원문 LLM 전송 금지** (ADR-005/008). 이유: 저작권. 숫자 필드만
- **Core workflows (crawl/verify/cost_check) 에 `CHEAPSKY_STAGE: stretch` 전파 금지**. 이유: ADR-005 gate 정의
- **사용자 식별 토큰·이메일 LLM 전송 금지**
- **Claude Haiku 4.5 외 모델 사용 금지**
