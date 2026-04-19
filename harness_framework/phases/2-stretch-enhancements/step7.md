# Step 7: stretch-docs

## 읽어야 할 파일

- `docs/PRD.md` — "Stretch 2" 체크리스트 마지막 항목: "GLOSSARY / OPERATIONS / LLM_PROMPTS 문서"
- `docs/ADR.md` — ADR-005 (LLM 프롬프트 운영), ADR-018 (verifier), ADR-025 (playwings)
- 이전 산출물 (총체):
  - `app/src/services/crawlers/{ppomppu,ruliweb,playwings}.ts`
  - `app/src/services/parser/{rules,llm}.ts`
  - `app/src/services/{baseline,verifier,curator}.ts`
  - `app/scripts/{crawl,verify,cost_check,curate,archive_daily}.ts`
  - `app/.github/workflows/*.yml`
  - `app/README.md`

## 작업

앱 루트는 `cheapsky/app/`. 이 step 은 코드를 만들지 않음 — **Stretch 2 문서 3종** 추가만.

### 1) `app/docs/GLOSSARY.md`

프로젝트 용어 사전. UI 카피·ADR·코드 전반의 용어 일관성 기록.

최소 섹션:
- **가격 용어**: 🔥 저점 / 큰 폭 할인 / 역대가(금지) / 시장 평균 대비 / 하위 N%
- **분위수·통계**: p10 / p50 / p90 / confidence (low/medium/high) / mixed
- **항공사 분류**: FSC / LCC / mixed
- **소스 레이어**: 관측 (`price_observations`) / 시드 (`baseline_seed.json`) / ② 큐레이션 (playwings) / ③ 사회적 증거 (ppomppu / ruliweb) / 시세 API (Deprecated — Stretch 3 조건부)
- **운영 상태**: active / snapshot / price_changed / unchecked / hot_deal / stale / 🔒 캐시 모드
- **접근 제어**: Share Token / Basic Auth / noindex / fallback
- **금지 용어**: 역대가 / API 내부 명칭 / "Amadeus" / "Anthropic" / "AI 추천" / "Powered by AI" / "놓치면 손해"

형식: 용어 — 정의 — 사용 예 — 금지 맥락 (해당되면)

### 2) `app/docs/OPERATIONS.md`

운영 런북. 장애·대응 절차 구체화 (ARCHITECTURE.md "장애·복구" 확장판).

최소 섹션:
- **장애 타입별 대응**:
  - 크롤러 1개 실패 (뽐뿌/루리웹/플레이윙즈)
  - 크롤러 전체 2h+
  - 관측 오염 (시드 단독 강제 스위치 SQL)
  - LLM 장애 (규칙 폴백 자동 전환)
  - Supabase 장애 (Vercel revalidate 60s 버퍼)
  - 원문 링크 대량 깨짐
  - 시연 당일 전면 장애 (`SHOW_CACHED_ONLY=true` 절차)
- **주기 작업 타임라인**: crawl 15m / verify 3h / cost_check daily 09:00 KST / curate 1h / archive 00:05 KST
- **Vercel 배포·롤백 절차**
- **Supabase 500MB 한도 도달 시 조치**: body TTL 청소, 오래된 observation aggregation, 테이블 VACUUM
- **Share Token 유출 대응**: rotate 절차 + ShareButton 비활성 절차
- **ADR-025 플레이윙즈 이의 제기 수신 시**: 24시간 내 조치 체크리스트
- **주요 SQL snippets**: 관측 오염 감지·강제 시드 모드·body TTL 청소·특정 노선 드롭 등
- **헬스 대시보드**: `/api/health` + footer CrawlerHealth 점 색 의미

### 3) `app/docs/LLM_PROMPTS.md`

Stretch 2 의 두 LLM 용도 프롬프트 **완전 아카이빙**. 프롬프트 개정 시 diff 추적 용이.

최소 섹션:
- **파싱 폴백 프롬프트** (ADR-005 용도 1):
  - System (항공권 제목 JSON 추출)
  - User 템플릿 (제목 + 본문 500자 cut)
  - Tool use schema 또는 JSON mode 스키마 (origin/destination/priceKrw/tripType/departFrom/departTo/carrierCode)
  - 온도·max_tokens 설정값
  - 금칙어·환각 방지 조항
- **카드 큐레이션 프롬프트** (ADR-005 용도 2):
  - System (60자 이내, 숫자만 사용, 시스템 명칭 금지, 감성·계절 금지)
  - User 템플릿 (노선·항공사·현재가·시장평균·지난30일최저·분위수)
  - 온도·max_tokens (짧은 출력이라 max 80 권장)
  - 출력 예시 3~5건 (few-shot 은 system 에 포함 시 cache_control 적용)
- **프롬프트 캐싱 전략**: 시스템 프롬프트 `cache_control: { type: 'ephemeral' }` 적용 위치, 기대 히트율, 비용 절감 추정
- **금칙어 목록**: `역대가, Amadeus, Anthropic, Claude, LLM, API, AI, 추천` + 후처리 regex
- **숫자 환각 검증 로직**: 출력 내 `\d+%` 와 input discountRate 의 오차 허용 범위
- **변경 이력**: 프롬프트 수정 시 날짜·이유·영향 기록

### 4) `app/README.md` 에 Stretch 2 섹션 업데이트

Core README 의 "Stretch 1/2/3 는 진행 중 플레이스홀더" 부분을 교체:
- Stretch 1: "커뮤니티 확장 (루리웹·플레이윙즈) — 완료"
- Stretch 2: "LLM 큐레이션·스파크라인·시세 히트맵·아카이브 — 완료"
- Stretch 3: "커뮤니티 확장 (클리앙 · 디시 · 조건부 네이버 블로그, ADR-030). 이전 '시세 API 재통합' 슬롯은 ADR-022 Rejected 2026-04-19 로 영구 폐기"

### 5) docs 링크 추가

`app/README.md` 푸터 "관련 문서" 에 신규 3 문서 링크 추가. harness_framework/docs/*.md 는 건드리지 않는다 (프로젝트 헌법).

## Acceptance Criteria

```bash
cd C:/Users/hukyu/Project_Document/cheapsky/app
pnpm build
pnpm test
pnpm exec tsc --noEmit
pnpm lint
ls docs/GLOSSARY.md docs/OPERATIONS.md docs/LLM_PROMPTS.md   # 3개 존재
```

문서 자체 검사:
- `grep -i "역대가" docs/` → GLOSSARY·LLM_PROMPTS 의 **금지 용어로 언급하는** 형태만 허용 (실사용 X)
- 각 문서 1000자 이상

## 검증 절차

1. 위 AC 전부 성공
2. GLOSSARY 가 UI_GUIDE 용어 정책과 일치 (충돌 없음)
3. OPERATIONS 가 ARCHITECTURE.md 의 "장애·복구" 표를 구체화 (재작성 X)
4. LLM_PROMPTS 가 실제 `services/parser/llm.ts` + `services/curator.ts` 의 system 메시지와 일치
5. 상태 업데이트:
   - 성공 → `"status": "completed"`, `"summary": "docs/GLOSSARY.md (용어 사전, 금지 용어 포함) + docs/OPERATIONS.md (장애 타입별 런북 + SQL snippets + 주기 작업 타임라인) + docs/LLM_PROMPTS.md (파싱·큐레이션 프롬프트 아카이빙 + 금칙어 + 캐싱 전략 + 변경 이력). README Stretch 섹션 업데이트."`

## 금지사항

- **`harness_framework/docs/*.md` 수정 금지**. 이유: 프로젝트 헌법. 신규 문서는 `app/docs/` 에
- **프롬프트 원본을 UI 에 노출 금지** (ADR-012). 이유: 내부 운영 자료
- **LLM_PROMPTS 에 실제 API key·secret 포함 금지**
- **GLOSSARY 에 "역대가" 를 허용된 용어로 기록 금지** (ADR-012). 이유: 금지 용어로만 표기
- **OPERATIONS 에 "CHEAPSKY_STAGE=stretch 를 Core workflows 에 적용" 같은 잘못된 절차 금지** (ADR-005 위반)
