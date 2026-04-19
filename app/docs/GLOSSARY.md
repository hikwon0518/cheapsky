# GLOSSARY

> 이 문서의 한 줄 요지: Cheapsky 코드·UI·ADR·운영 전반에서 일관되게 쓰이는 용어와 **쓰면 안 되는 용어**의 대조 사전. 충돌이 있으면 `../../harness_framework/docs/UI_GUIDE.md` 와 `ADR.md` 를 상위 기준으로 따른다.

## 읽는 법

각 항목은 다음 순서로 기술한다:

- **용어** — 짧은 정의
- **사용 예** — UI 카피 · 코드 · 문서에서의 실제 사용 방식
- **금지 맥락** (해당되면) — 이 용어를 섞어 쓰면 안 되는 다른 용어·화면·상황

---

## 1. 가격 / 딜 표현

### 🔥 저점
- 정의: 해당 노선·항공사 등급(FSC/LCC)의 baseline 분위수에서 `price_percentile ≤ 10` 인 상태 (ADR-006). 🔥 이모지와 함께 배지로만 렌더.
- 사용 예: UI 배지 `🔥 저점 -52%` · 코드 `hot_deal = true` · 문서 "오늘의 🔥 저점 딜".
- 금지 맥락: "역대 최저" 뉘앙스로 쓰지 말 것. 🔥 배지 1개 카드당 단 1번.

### 큰 폭 할인
- 정의: 할인율 자체가 크다는 사실 기반 표현. 분위수 근거가 약할 때 (confidence=low 또는 baseline mixed) 🔥 대신 쓴다.
- 사용 예: 히어로 상단 `오늘 찾은 큰 폭 할인 N개`.
- 금지 맥락: "역대" · "최저" · "대박" 같은 수사 병기 금지.

### 시장 평균 대비 N% 할인
- 정의: `baseline_krw` (p50 근사) 에 대한 현재가 비율. `discount_rate = 1 - price / baseline`.
- 사용 예: 팝오버 `기준 280,000원 / 현재 135,000원 / 할인 -52%` · 큐레이션 한 줄 "시장 평균 대비 52% 저렴".
- 금지 맥락: "시장 대비" 뒤에 구체 API 이름을 붙이지 말 것 (ADR-012).

### 하위 N% (pN)
- 정의: baseline 분위수에서 현재가가 차지하는 백분위. `p7` 은 하위 7% = 상위 93%.
- 사용 예: 팝오버 `하위 8% (p8) · LCC 분위수`.
- 금지 맥락: 상위/하위 개념 헷갈리게 쓰지 말 것. "상위 8%" 로 표기하면 "비싸다" 는 뜻.

### 역대가 (❌ 금지)
- 정의: 사용 금지 용어 (ADR-012).
- 사용 예: **없음**. 대체: `🔥 저점` · `큰 폭 할인` · `시장 평균 대비 N%`.
- 금지 맥락: UI·카피·파일명·커밋 메시지·주석 전부. 본 GLOSSARY 처럼 **"금지 용어로 언급"** 하는 경우만 허용.

---

## 2. 분위수 · 통계

### p5 / p10 / p25 / p50 / p90
- 정의: `route_market_data` 테이블 컬럼. 각각 5 / 10 / 25 / 50 / 90 백분위 가격 (KRW).
- 사용 예: `p10_krw` 는 🔥 저점 판정 기준, `p50_krw` 는 시장 평균(중앙값) 근사.
- 금지 맥락: `p50` 을 "평균" 이라고 UI 에 쓸 때도 수식(算術) 평균이 아님을 잊지 말 것. 카피에선 "시장 평균" 이라 부르되 내부적으로는 중앙값.

### confidence — low / medium / high
- 정의: baseline 신뢰도 (ADR-011).
  - `high`: `price_observations ≥ 30건` 관측 단독
  - `medium`: 관측 10~29건 혼합 또는 시드 FSC/LCC 매치
  - `low`: 시드 `mixed` 엔트리만 존재 → 🔥 배지 **미부여**
- 사용 예: 팝오버 하단 `confidence: medium`. `baseline_confidence` DB 컬럼.
- 금지 맥락: `high` confidence 는 관측 충분 누적 전까지 임의로 마킹 금지.

### baseline_source — observed / seed / mixed
- 정의: `deals.baseline_source` 컬럼 값. ADR-011 우선순위 결과.
  - `observed`: 관측 ≥ 30건 단독
  - `mixed`: 관측 10~29건 + 시드 가중 혼합 (`0.6·관측 + 0.4·시드`)
  - `seed`: 관측 < 10건, 시드 FSC/LCC 또는 mixed 엔트리 사용
- 사용 예: 팝오버 `기준 (수동 조사)` 또는 `기준 (관측 42건)`.
- 금지 맥락: UI 에 `mixed` 를 그대로 노출하지 말 것 (용어가 carrier_class 와 겹침) — "관측 + 기준 혼합" 같은 자연어로.

### mixed (용어 충돌 주의)
- 정의: 두 곳에서 쓰이는 용어. 구분 필수.
  - `carrier_class = 'mixed'` — 항공사 등급 미상
  - `baseline_source = 'mixed'` — 관측+시드 혼합 (ADR-011 2순위)
- 사용 예: 코드에선 변수명·주석으로 문맥을 명시 (`carrierClass === 'mixed'` vs `baselineSource === 'mixed'`).
- 금지 맥락: 문서에서 문맥 없이 "mixed 일 때" 라고만 쓰지 말 것.

---

## 3. 항공사 분류

### FSC (Full Service Carrier)
- 정의: 풀 서비스 항공사. 대한항공(KE) · 아시아나(OZ) · ANA(NH) · JAL(JL) 등.
- 사용 예: 팝오버 `FSC 분위수 기준`. `lib/airlines.ts` 의 `class: 'fsc'` 엔트리.
- 금지 맥락: FSC 딜에 LCC baseline 을 적용하면 저점 과대 판정 (ADR-024). 혼용 금지.

### LCC (Low Cost Carrier)
- 정의: 저비용 항공사. 진에어(LJ) · 제주항공(7C) · 티웨이(TW) · 에어부산(BX) · 에어아시아(AK) · 비엣젯(VJ) 등.
- 사용 예: 팝오버 `LCC 분위수 기준`. `lib/airlines.ts` 의 `class: 'lcc'` 엔트리.
- 금지 맥락: 장거리(LAX·JFK·HNL) 에는 LCC 시드 엔트리가 없거나 `mixed` 만 존재 (methodology).

### mixed (carrier_class)
- 정의: 항공사 파싱 실패 또는 다수 항공사 섞인 딜. `services/parser/rules.ts` 에서 매칭 실패 시 기본값.
- 사용 예: `deals.carrier_class = 'mixed'`. UI 에는 "항공사 미상" 또는 출처 태그로만 표기.
- 금지 맥락: `mixed` 딜에 🔥 를 부여하려면 시드 `mixed` 엔트리가 아니라 실제 관측·FSC·LCC baseline 이 있어야 함 (ADR-011).

---

## 4. 소스 레이어

### 관측 (`price_observations`)
- 정의: 크롤로 수집된 실제 딜 가격이 `(origin, destination, trip_type, carrier_class, price_krw, observed_at)` 로 누적된 시계열.
- 사용 예: ADR-011 1 · 2순위 baseline · 스파크라인(Stretch 2) · 시세 히트맵(Stretch 2).
- 금지 맥락: 관측 30건 미만 노선을 `high confidence` 로 표시하지 말 것.

### 시드 (`baseline_seed.json`)
- 정의: 20 노선 × {FSC, LCC, mixed} 수동 조사 시드. 관측 콜드 스타트 폴백. `src/data/baseline_seed.json`.
- 사용 예: `scripts/seed.sql` 로 `route_market_data(source='seed')` 로 UPSERT. 분기 1회 수동 갱신 (`scripts/backfill.ts --seed-reload`).
- 금지 맥락: 시드는 medium 이하 confidence. UI 팝오버에 `(수동 조사)` 병기.

### ② 큐레이션 딜 (플레이윙즈, Stretch 1)
- 정의: 플레이윙즈 블로그 큐레이션 — 빠른 1차 전파 소스. ADR-025 동의 절차 필수.
- 사용 예: `deals.sources` 배열에 `playwings`.
- 금지 맥락: ADR-025 절차 통과 전 크롤 금지. RSS 우선 → 메일 통보 → 무응답 10일 경과 시 기간 한정 크롤.

### ③ 사회적 증거 (뽐뿌 / 루리웹)
- 정의: 커뮤니티 핫딜 게시판 — 반응(조회수·댓글) 기반 사회적 신호. 뽐뿌(Core) · 루리웹(Stretch 1).
- 사용 예: `deals.sources` = `['ppomppu']` · Community Picks 섹션 (Stretch).
- 금지 맥락: 조회수·댓글 **절대 숫자** 를 UI 에 노출 금지 (사이트 간 스케일 상이로 오해 소지). `HOT` / `TRENDING` 이진 라벨만.

### ④ 커뮤니티 확장 (클리앙 / Phase 3)
- 정의: 클리앙 알뜰구매 게시판(jirum) 크롤러. Phase 3 3-community-expansion (ADR-030) 에서 추가된 4번째 소스. 항공권 딜 밀도는 뽐뿌·루리웹 대비 낮지만 **소스 교차 매칭** 으로 놓침 리스크 완화에 기여.
- 사용 예: `deals.sources` 에 `clien` 포함. `sources.length >= 3` 일 때 `social_signal='hot'` 강제 승격 (ADR-030).
- 금지 맥락: ADR-008 동일 원칙 — robots.txt `Allow: /service/board/` + `Disallow: /*?*` 준수, 쿼리 스트링 URL 금지 (canonical path 만). 작성자 식별자(`data-author-id` 등) 저장 금지.

### 🟥 Rejected: 디시인사이드 (2026-04-20 step0 preflight)
- 정의: `gall.dcinside.com/mgallery/board/lists/?id=airplane_new2` 항공권 갤러리.
- 상태: **영구 skip**. 이유: robots.txt `User-agent: * Disallow: /` — Googlebot/Yeti 등 whitelist 검색엔진만 허용. Cheapsky UA 미허용.
- 재개 조건: dcinside 정책 변경 시에만 (자동 재점검 없음).

### 소스 교차 매칭 (Cross-source matching, ADR-030)
- 정의: 동일 `dedupe_key` 에 복수 소스가 누적될 때 `deals.sources` 배열이 union.
- 승격 규칙: `sources.length >= 3` → `social_signal='hot'` 강제 (기존 views 기반 규칙과 OR).
- UI 표기: `SourceTag` 에 "A · B · C · 3곳 동시 등장" 포맷. 상위 3개 + 초과는 "(외 N곳)" overflow.
- 목적: 여러 커뮤니티 동시 포스팅 = 실제 핫 확률 압도적으로 높음. 각 소스 독립 검증.

### 시세 API (Rejected 2026-04-19, 영구 제외)
- 정의: Amadeus · Duffel · Kiwi · Travelpayouts · FlightAPI · Skyscanner Partner 등 GDS 기반 flight API 일체. **ADR-022 Rejected** 로 영구 미도입.
- 사용 예: **없음 (영구)**. `services/amadeus.ts` 등 어떤 시세 클라이언트도 존재하지 않음.
- 금지 맥락: 어떤 단계에서도 생성 금지. 근거: GDS 는 정규 retail 가격만 노출 → 한국 핫딜 (카드사·여행사 단독·OTA 단독·error fare) 은 GDS 밖 채널. "시장 baseline" 역할은 관측+시드가 수행 중. 복원은 신규 ADR 로만 가능하며 trigger 는 ADR-022 Rollback 조건.
- Phase 3 슬롯은 `3-community-expansion` (ADR-030) 으로 재할당 — 핫딜 감지력 강화 방향.

---

## 5. 운영 / 상태

### active
- 정의: `verification_status` 값. 최근 HEAD(Core) 또는 GET+가격패턴(Stretch) 검증에서 200·가격 매치.
- 사용 예: 메인 리스트 노출 기본 조건.

### snapshot
- 정의: `verification_status` 값. 원문이 404/410 또는 3회 연속 실패 (ADR-018).
- 사용 예: 카드 `opacity-50 grayscale italic` · 좌상단 라벨 `원문 삭제됨`. 아카이브 페이지에선 링크 유지.

### price_changed
- 정의: `verification_status` 값. Stretch GET 에서 본문에 원 가격 ±10% 매치 실패 (ADR-018).
- 사용 예: 🔥 배지 옆 앰버 `가격 변경 가능성` 라벨.

### unchecked
- 정의: `verification_status` 기본값. 24시간 미만 딜은 검증 스킵.
- 사용 예: 신선한 딜. UI 에 별도 라벨 없음.

### hot_deal
- 정의: `deals.hot_deal = true`. `price_percentile ≤ 10` AND `baseline_source != 'seed-mixed'` AND `confidence ≠ 'low'`.
- 사용 예: 히어로 TOP 3 쿼리 대상. Community Picks 와 독립.

### stale (StaleBanner)
- 정의: 크롤러 전체 2시간+ 실패 상태. 자동 상단 배너 표시.
- 사용 예: 문구 `최근 수집이 지연되고 있어요. 표시된 딜은 이전 수집 기준입니다.`

### 🔒 캐시 모드 (`SHOW_CACHED_ONLY=true`)
- 정의: Vercel env 로만 설정. **UI 전용** 패닉 플래그 (ADR-028). 배치 cron 은 영향 없이 계속 운영.
- 사용 예: `CacheOnlyBanner` 상단 표시. 문구 `캐시 모드로 표시 중입니다. 데이터 갱신이 일시 중단되었어요.`
- 금지 맥락: GH Actions 쪽에 같은 env 를 주입해 배치를 멈추지 말 것 (ADR-028 의 "UI 전용" 결정 위반).

---

## 6. 접근 제어

### Share Token
- 정의: `SHARE_TOKENS` Vercel env (콤마 분리 다중 토큰). URL `?t=<token>` 로 인증 (ADR-019).
- 사용 예: `friend_*`, `backup_*`, `debug_*` 세 토큰 (각 12자+).
- 금지 맥락: 토큰 하드코딩 금지. commit 금지. 유출 의심 시 즉시 rotate + ShareButton 비활성.

### Basic Auth
- 정의: Share Token 실패 시 폴백. `BASIC_AUTH_USER` · `BASIC_AUTH_PASS` (bcrypt 해시).
- 사용 예: `src/middleware.ts` 에서 검증.
- 금지 맥락: 평문 비밀번호 commit 금지. `.env.example` 에 예시값만.

### noindex / nofollow
- 정의: `X-Robots-Tag: noindex, nofollow` 헤더 + `<meta name="robots" content="noindex, nofollow">`. 모든 응답에 주입.
- 사용 예: 검색 엔진 인덱싱 방지.
- 금지 맥락: 배포 직전 `noindex` 를 빼지 말 것 (ADR-008 의 "공개 차단" 위반).

### fallback (Share Token → Basic Auth)
- 정의: URL `?t=` 실패 시 middleware 가 Basic Auth 로 전환하는 절차.
- 사용 예: 친구 링크를 북마크한 후 토큰 rotate 된 경우 Basic Auth 로 접근 가능.

---

## 7. 금지 용어 모음 (❌)

아래 용어는 **UI · 카피 · 문서 · 코드 주석 · 커밋 메시지** 전부에서 금지한다. 대체어를 함께 적는다.

| ❌ 금지 | ✅ 대체 | 근거 |
|---------|---------|------|
| 역대가 | `🔥 저점` / `큰 폭 할인` / `시장 평균 대비 N%` | ADR-012 |
| Amadeus (UI 문자열) | `시장 평균` · `기준 가격` | ADR-012 |
| Anthropic (UI 문자열) | (언급하지 않음) | ADR-012 |
| Claude (UI 문자열) | (언급하지 않음) | ADR-012 |
| LLM (UI 문자열) | `한 줄 맥락` | ADR-012 |
| API (UI 문자열) | `시세 기준` / 맥락에 따라 생략 | ADR-012 |
| AI 추천 · AI 큐레이션 | `한 줄 맥락` | ADR-012 / UI_GUIDE |
| Powered by AI | (삭제) | UI_GUIDE AI 슬롭 |
| 놓치면 손해 | (삭제) | UI_GUIDE 카피 규칙 |
| 지금 예약하세요 | `원문에서 확인하기` | UI_GUIDE |
| 진짜 싸요 · 대박 | `N% 할인` | UI_GUIDE |
| 오늘의 핫딜 (타이틀로) | `오늘의 저점` / `오늘의 레이더` | UI_GUIDE |

금칙어는 LLM 후처리에서도 정규식 `/역대가|Amadeus|Anthropic|Claude|LLM|API/i` 로 차단된다 (`services/curator.ts`).

---

## 8. 자주 혼동되는 쌍

- **baseline_source = 'mixed'** (관측+시드 혼합) ≠ **carrier_class = 'mixed'** (항공사 등급 미상).
- **시장 평균** 은 p50 (중앙값) 이지 산술 평균이 아님. UI 카피는 "평균" 이라 써도 내부 쿼리는 `p50_krw`.
- **🔥 저점** 은 분위수 기반이지 절대 가격 기반이 아님. 30만원짜리 미주 노선도 분위수 조건 만족 시 🔥.
- **SHOW_CACHED_ONLY** 는 UI 전용 (Vercel) — 배치(GH Actions) 와 혼동 금지.
- **Stretch 2 큐레이션** (`services/curator.ts`, 카드 한 줄) ≠ **Stretch 2 파싱 폴백** (`services/parser/llm.ts`, JSON 추출). 두 경로 모두 Haiku 4.5 고정.

---

## 참고

- 전체 규칙: `../../harness_framework/docs/UI_GUIDE.md` · `ADR.md` · `PRD.md`
- 프롬프트 전문: `LLM_PROMPTS.md`
- 운영 런북: `OPERATIONS.md`
