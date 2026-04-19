# LLM_PROMPTS

> 이 문서의 한 줄 요지: Stretch 2 의 두 LLM 용도(파싱 폴백 · 카드 큐레이션) 프롬프트·스키마·토큰 설정·후처리 로직을 버전 관리하는 아카이브. 실제 구현은 `src/services/parser/llm.ts` 와 `src/services/curator.ts` 이며, 이 문서와 코드가 어긋나면 **코드를 기준으로 한 뒤 이 문서를 재동기화** 한다.

## 공통 조건 (ADR-005)

- **모델 고정**: `claude-haiku-4-5-20251001`. opus / sonnet / 타 provider 전부 금지.
- **Stretch 게이트**: `CHEAPSKY_STAGE=stretch` 환경변수 설정된 workflow 에서만 호출. Core 워크플로우는 설치 자체를 차단.
- **예산**: `BudgetTracker` (`lib/llm-budget.ts`) 가 일 300회 / 시간당 50회 / 월 $2 USD 상한 유지. 초과 감지 즉시 skip.
- **재시도**: 1회 지수 백오프 (500ms + 0~250ms 지터), 2회째 실패 시 skip, `429` 즉시 중단 (RateLimitError).
- **fail-soft**: 예외를 던지지 않는다. 실패 시 결과는 빈 필드(draft) 또는 `text=null`.
- **LLM 전송 범위**:
  - 파싱 폴백: 제목 + 본문 앞 500자 (`LLM_BODY_CHAR_LIMIT = 500`). 본문 전문 전송 금지 (ADR-008).
  - 큐레이션: 정제된 숫자 필드만. 제목·본문 전송 금지.
- **금칙어 후처리**: 출력에 `/역대가|Amadeus|Anthropic|Claude|LLM|API/i` 하나라도 매치 → 결과 버림.
- **숫자 환각 방지**: 출력 내 `N%` 가 input 의 `discountRate` · `pricePercentile` 에 ±1 오차로 매핑 안 되면 버림 (큐레이션 한정).

---

## 1. 파싱 폴백 프롬프트 (ADR-005 용도 1)

### 호출 시점
`services/parser/rules.ts` 가 필수 필드(`origin` / `destination` / `priceKrw`) 중 하나라도 null 인 `RawPost` 에 대해서만 `parseLlm(post, config)` 재시도.

### 파라미터
| 항목 | 값 |
|------|-----|
| 모델 | `claude-haiku-4-5-20251001` |
| `max_tokens` | 256 (짧은 JSON 만 받으면 됨) |
| `system` | 아래 전문 |
| `tool_choice` | `{ type: 'tool', name: 'record_deal_fields' }` |
| `tools` | `[{ name: 'record_deal_fields', input_schema }]` (아래) |
| `messages[0]` | `{ role: 'user', content: <buildUserPrompt(post)> }` |
| temperature | SDK 기본값 (1.0 계통 — tool use 는 구조화 출력으로 충분) |

### System 프롬프트 (전문)
```
당신은 한국어 항공권 딜 게시글에서 구조화된 필드를 추출하는 파서입니다.
오직 제공된 텍스트(제목+본문)에 명시된 정보만 사용하세요.
외부 지식·계절·이벤트·공항 별명 추론을 금지합니다.
확실하지 않으면 해당 필드는 null.
반드시 record_deal_fields 툴을 1회 호출해 결과를 반환하세요.
```

### User 메시지 템플릿 (`buildUserPrompt` 출력)
```
제목: <post.title>

본문(최대 500자):
<post.body.slice(0, 500)>
```

본문이 500자를 초과할 경우 **반드시 `.slice(0, 500)`** 로 자른 문자열만 전송 (ADR-008 / ADR-005 교차 규칙).

### Tool Schema — `record_deal_fields`
```jsonc
{
  "name": "record_deal_fields",
  "description": "추출된 항공권 딜 필드를 기록합니다.",
  "input_schema": {
    "type": "object",
    "properties": {
      "origin":       { "type": ["string", "null"],  "description": "출발 공항 IATA 3-letter. 인천 출발이면 \"ICN\". 모르면 null." },
      "destination":  { "type": ["string", "null"],  "description": "도착 공항 IATA 3-letter. 모르면 null." },
      "priceKrw":     { "type": ["integer", "null"], "description": "가격 원화 정수. \"29만\" → 290000. 모르면 null." },
      "tripType":     { "type": ["string", "null"], "enum": ["oneway", "roundtrip", null], "description": "편도/왕복. \"편도\" 키워드 있으면 oneway, 아니면 roundtrip." },
      "departFrom":   { "type": ["string", "null"],  "description": "출발 가능 시작일 YYYY-MM-DD. 월만 있으면 월 1일. 모르면 null." },
      "departTo":     { "type": ["string", "null"],  "description": "출발 가능 종료일 YYYY-MM-DD. 월만 있으면 월 말일. 모르면 null." },
      "carrierCode":  { "type": ["string", "null"],  "description": "항공사 IATA 2-letter 코드 (예: KE, OZ, LJ, 7C). 모르면 null." }
    },
    "required": ["origin", "destination", "priceKrw", "tripType", "departFrom", "departTo", "carrierCode"]
  }
}
```

### 후처리 (`normalizeFields`)
1. 문자열 → `trim()` · 빈 문자열은 `null`
2. `origin` / `destination` / `carrierCode` → `toUpperCase()`
3. `priceKrw` → 숫자 파싱 (콤마 허용), 정수 반올림
4. `departFrom` / `departTo` → `YYYY-MM-DD` 정규식 매치 + UTC Date. 매치 실패 시 `null`
5. `tripType` 이 `'oneway' | 'roundtrip'` 외 값이면 `null`
6. `carrierCode` 기준 `lib/airlines.ts` 사전 조회로 `carrierClass` 파생 (`mixed` 폴백)

파싱 실패 · budget 소진 · 429 · 네트워크 예외 → `emptyDraft(post)` 반환.

### 금칙어 관찰 포인트
Tool use 반환값은 구조화 JSON 이므로 사실상 금칙어가 들어갈 여지가 없다. 하지만 설명 필드 등을 자유 텍스트로 확장할 때는 큐레이션과 동일한 정규식을 적용해야 한다.

---

## 2. 카드 큐레이션 프롬프트 (ADR-005 용도 2)

### 호출 시점
`scripts/curate.ts` 가 매 정시 30분에 실행.
- 대상: `deals.hot_deal = true` AND `expires_at > now()` AND (`curation_text IS NULL` OR `curation_generated_at < now() - 24h`)
- 배치 크기: 50 (ADR-005 시간당 50회 상한)
- 각 대상에 대해 `route_market_data.p50/p10` · `price_observations` 최근 30일 최저가를 불러 `CurationInput` 생성 후 `curateOne` 호출

### 파라미터
| 항목 | 값 |
|------|-----|
| 모델 | `claude-haiku-4-5-20251001` |
| `max_tokens` | 128 (한 문장이면 충분) |
| `system` | 배열 형식 + `cache_control: { type: 'ephemeral' }` (§3) |
| `tools` | 사용 안 함 — 자유 텍스트 한 문장만 |
| `messages[0]` | `{ role: 'user', content: <buildCurationUserPrompt(input)> }` |
| temperature | SDK 기본값 |

### System 프롬프트 (전문)
```
주어진 숫자만 사용하여 한국어 60자 이내 한 문장을 생성하세요.
'API', 'Claude', 'LLM', 'Amadeus', 'Anthropic' 같은 시스템 명칭 언급 금지.
'역대가' 표현 금지.
계절·이벤트·외부 지식·감성어·추측 금지.
반드시 마침표로 끝낼 것.
출력은 한 문장만, 다른 설명·머리말 없이 문장 자체만 반환.
```

System 은 **cache_control 블록 배열** 로 보낸다 (§3 참조).

### User 메시지 템플릿 (`buildCurationUserPrompt` 출력)
필드가 있는 줄만 포함하도록 동적 조립:
```
노선: <origin>-<destination>
항공사 등급: <FSC | LCC | 혼합> (<carrierCode?>)
현재가: <priceKrw>원
시장 평균(p50): <baselineP50Krw>원           ← null 이면 행 생략
하위 10% 기준(p10): <baselineP10Krw>원         ← null 이면 행 생략
할인율: <round(discountRate * 100)>%
분위수: p<round(pricePercentile)>              ← null 이면 행 생략
지난 30일 이 노선 최저: <last30dMinKrw>원      ← null 이면 행 생략
```

예시 input (ICN-KIX / LJ):
```
노선: ICN-KIX
항공사 등급: LCC (LJ)
현재가: 99000원
시장 평균(p50): 220000원
하위 10% 기준(p10): 110000원
할인율: 55%
분위수: p8
지난 30일 이 노선 최저: 95000원
```

### 출력 Few-shot (참고 · 코드에는 포함되지 않음)
모델이 생성할 전형 3~5개:
- `시장 평균 대비 55% 저렴. 지난 30일 이 노선 LCC 최저 수준.`
- `하위 p8 수준의 가격. 시장 평균 대비 55% 저렴.`
- `LCC 기준 시장 평균 대비 55% 저렴. 최근 30일 최저 근접.`
- `분위수 p8. 시장 평균 대비 55% 저렴.`
- `ICN-KIX LCC 기준 시장 평균 대비 55% 저렴.` (60자 여유)

Few-shot 은 **시스템 프롬프트에 포함하지 않는다** — 출력 일관성 확보 전까지는 system 을 짧게 유지하는 편이 토큰·품질 모두 유리. 필요하면 향후 변경 이력에 개정 이유와 함께 추가.

### 후처리 (`curateOne` 의 검증 파이프라인)

1. **trim** → 응답 text 공백 정리
2. **빈 문자열** → `null` 반환 (카드에 규칙 폴백 유지)
3. **금칙어 검사** (`FORBIDDEN = /역대가|Amadeus|Anthropic|Claude|LLM|API/i`) → `null`
4. **60자 clamp** (`clampCurationText(text, 60)`) — 문자 단위 (한글 조합형 기준)
5. **숫자 환각 검증** (`validateNumberFidelity`):
   - 문장 내 `\d+\s*%` 매치 추출
   - `input.discountRate` 를 `round(x*100)` 으로 정규화한 정수 허용
   - `input.pricePercentile` 을 `0~100` 로 clamp 한 정수 허용
   - 각 매치가 허용값 중 하나와 **±1** 오차 이내여야 함. 하나라도 벗어나면 `null`
6. 모두 통과 → `deals.curation_text` UPDATE, `curation_generated_at = now()`

### Anthropic 429 · 타임아웃
- `isRateLimit(err)` → 즉시 break (재시도 안 함). `budget` 은 호출 전 canSpend 로 이미 보호.
- 그 외 에러 → 500ms + 0~250ms 지터 백오프 후 1회 재시도. 두 번째도 실패하면 `text=null`.

---

## 3. 프롬프트 캐싱 전략

### 현재 적용
`services/curator.ts` 의 `callOnce` 에서 system 을 배열 블록으로 감싸 `cache_control: { type: 'ephemeral' }` 를 지정:

```ts
system: [
  {
    type: 'text',
    text: SYSTEM_PROMPT,
    cache_control: { type: 'ephemeral' },
  },
]
```

### 기대 효과
- System 토큰 수 (약 200~250 tokens) 가 배치 내 두 번째 호출부터 **cache read** 로 청구 (90% 할인)
- 배치 50건 기준, 첫 1건 cache write + 49건 cache read → 초기화 비용 5분(ephemeral TTL) 안에 회수 가능
- 예상 월 비용: 50/h × 24h × 30d × 평균 350 토큰 ≈ 12.6M tokens → Haiku 가격 기준 월 <$2 (ADR-005 상한)

### 파싱 폴백에는 cache_control 미적용
- `services/parser/llm.ts` 의 system 은 `string` 그대로. 이유: 호출 주기가 불규칙(규칙 실패분만)하고, tool_use 모드에서 system 토큰 수가 상대적으로 작아 캐시 write 오버헤드와의 손익 분기점이 애매함
- 파싱 커버율이 올라오면 캐시 적용도 검토 (변경 이력에 사유 기록)

### 관찰 포인트
- `api_usage_daily.anthropic_tokens_in` 은 cache read/write 구분 없이 합산. 실제 캐시 히트는 Anthropic Dashboard `Usage` 에서 확인
- 히트율 < 80% 지속 → system 변경 빈도 재검토 또는 배치 타이밍 조정

---

## 4. 금칙어 목록 · 정규식

코드 상수 (`services/curator.ts`):
```ts
const FORBIDDEN = /역대가|Amadeus|Anthropic|Claude|LLM|API/i;
```

이유:
- **역대가**: ADR-012 금지 용어 — "사상 최저가" 뉘앙스 금지
- **Amadeus**: 외부 API 내부 명칭 UI 노출 금지 (ADR-012). ADR-022 Deprecated 이후에도 금지 유지 (히스토리 표기 오염 방지)
- **Anthropic / Claude / LLM / API**: 내부 인프라 명칭 UI 노출 금지 (ADR-012). "AI 추천" · "Claude 가 추천" 식 표현 차단

확장 시:
- 후속 ADR 에서 새 금지 용어를 추가하면 이 상수 + 테스트 골든셋 + GLOSSARY 7장까지 동시 갱신
- 테스트: `curator.test.ts` 의 금칙어 케이스가 즉시 검증

---

## 5. 숫자 환각 검증 로직

`validateNumberFidelity(text, allowed)`:

```ts
const matches = text.match(/\d+\s*%/g);
if (!matches) return true;                      // 문장에 % 없음 → 환각 없음으로 간주

const allowedPcts: number[] = [];
if (allowed.discountPct  != null) allowedPcts.push(allowed.discountPct);
if (allowed.percentile   != null) allowedPcts.push(allowed.percentile);

for (const raw of matches) {
  const n = Number(raw.replace(/\s|%/g, ''));
  if (!Number.isFinite(n)) return false;
  const ok = allowedPcts.some((a) => Math.abs(a - n) <= 1);
  if (!ok) return false;
}
return true;
```

- 허용 오차 **±1** — 반올림 경계 대응
- `allowed.discountPct = round(input.discountRate * 100)`, `allowed.percentile = clamp(round(input.pricePercentile), 0, 100)`
- "하위 p8" 같이 `%` 가 없는 숫자 표현은 검증 대상 아님 (현재는 간접적으로만 검증됨)

---

## 6. 변경 이력

이 섹션은 프롬프트를 수정할 때마다 **위에 추가** (최신이 위). 코드 PR 과 일대일 매핑되도록 날짜 · 이유 · 영향 범위를 기록한다.

### 2026-04-19 — 초기 아카이빙
- 파싱 폴백(`parseLlm`) · 카드 큐레이션(`curateOne`) 프롬프트 · 스키마 · 후처리 규칙을 최초로 문서화
- 코드 기준: `services/parser/llm.ts` · `services/curator.ts`
- 후속: Stretch 2 운영 중 관찰된 실패 유형(환각 · 형식 이탈 · 금칙어 통과 실패)을 여기에 누적 반영

(이하 변경 시 append)
