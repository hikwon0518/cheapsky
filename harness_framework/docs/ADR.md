# Architecture Decision Records

> 각 ADR은 **결정 / 이유 / 트레이드오프 / Rollback 조건** 네 칸. 단계 태그(`Core` / `Stretch`)는 구현 우선순위.

## 철학
친구들끼리 각자 만들어 서로 평가·코멘트하는 1~2주짜리 프로젝트. 평가 기준은 **"실제로 돌아가고 쓰고 싶은 MVP"**.
- 작동하는 크롤러 + 실제 데이터 > 거창한 아키텍처
- 배포 2시간 안에 가는 스택 > 더 "옳은" 스택
- 차별화 1~2개에 시간 몰빵
- 모든 결정은 한 문장으로 "왜"에 답할 수 있어야 함
- 저작권·ToS 리스크 회피 1순위
- **Core 완성 전 Stretch 금지** (ADR-026)

---

### ADR-001 [Core] Next.js 15 App Router 단일 풀스택
**결정**: 프론트·API·SSR을 Next.js 15 App Router에 통합. 별도 백엔드 없음.
**이유**: Server Component SSR 빠른 첫 렌더, Vercel 원클릭 배포, 리뷰어 경험 공통분모.
**트레이드오프**: 크롤러·웹 독립 스케일 불가. 규모상 문제 없음.
**Rollback 조건**: 크롤러 무거워져 Vercel 배포에 영향 주기 시작하면 크롤러만 별도 repo로 분리.

---

### ADR-002 [Core] 배치는 GitHub Actions Cron (Public Repo 전제)
**결정**: crawl / ingest_market / verify / curate / archive / cost_check 모두 GH Actions cron. **Public repo 유지** 조건으로 분 할당량 무제한.
**이유**: Vercel Cron Hobby 제한 회피, GH Actions 로그가 repo 탭에서 즉시 확인, 웹/배치 장애 격리, public이면 분 무료.
**트레이드오프**: 비밀값 두 곳 설정. Public repo이므로 `.env.local`·service_role 키·Share Token 절대 commit 금지.
**Rollback 조건**: Repo를 private으로 전환해야 할 사유(민감 데이터 포함 등) 발생 시 cron 주기를 15분 → 30분으로 늘려 월 1,440분 한도 내 운영.

---

### ADR-003 [Core] Supabase Postgres
**결정**: 저장소 = Supabase free tier Postgres.
**이유**: 90일 집계 SQL 자연스럽고, 동시 읽기·쓰기 지원, RLS로 anon 쓰기 차단.
**트레이드오프**: 외부 의존성. 500MB 한계지만 수 년치 충분.
**Rollback 조건**: 500MB 30% 이상 소진 or p95 쿼리 > 500ms 지속 시 Neon/Turso 검토.

---

### ADR-004 [재작성 2026-04-18] 데이터 소스 구조 — 커뮤니티 관측 + 시드 baseline
**배경**: ADR-022 Deprecated 로 외부 시세 API 계층 제거. 2-레이어(커뮤니티) + Baseline(관측·시드) 구조로 재편.

**결정**:
| 레이어 | 소스 | 역할 | 단계 |
|--------|------|------|:----:|
| 🎯 Baseline (관측) | `price_observations` (크롤 데이터 누적) | 🔥 판정 분위수 — 주(主) | Core |
| 🎯 Baseline (시드) | `baseline_seed.json` (수동 조사 20 노선 × FSC/LCC/mixed) | 콜드 스타트·재난 폴백 | Core |
| ② 큐레이션 딜 | 플레이윙즈 블로그 | 빠른 1차 전파 + 관측 공급 | Stretch (ADR-025 통과 후) |
| ③ 사회적 증거 | 뽐뿌 해외여행 | 반응 신호 + 관측 공급 | Core |
| ③' 사회적 증거 | 루리웹 핫딜 | 반응 신호 + 관측 공급 | Stretch |

시세 API 계층은 Core 에 없음. 포털 재오픈·대안 확보 시 `BACKLOG.md` → ADR-026 **3-stretch-market-api** 로 부활.

클리앙·디시·레드비쥬·Secret Flying 등은 v2 Deferred. 상용 OTA(스카이스캐너 등) 직접 크롤링 **절대 금지** (검색 URL 생성은 예외, ADR-027).

**이유**: 외부 시세 API 의존 제거로 시연 안정성 상승. 뽐뿌 크롤만으로도 `price_observations` 가 자연 누적되어 시간이 지날수록 baseline 정확도 자동 상승. 초기 2~4주는 시드가 공백을 메움.

**트레이드오프**:
- 시세 히트맵(ADR-023 Stretch) 20개 노선 커버리지는 관측 누적 전까지 부분적 → 시드 기반 표시로 시작
- 관측 오염 가능성 → ADR-011 의 시드 단독 강제 스위치로 방어
- 플레이윙즈 저작권 민감 → 동의 절차 (ADR-025)
- Amadeus LCC 커버리지 약점 문제는 자연 해소 (시드 자체가 FSC/LCC 분리 조사)

**Rollback 조건**:
- 관측 오염 심각 → 시드 단독 모드
- 뽐뿌 차단 → 다른 커뮤니티 대체 검토 (v2 소스 승격)
- 플레이윙즈 거절·요청 → 영구 제외

---

### ADR-005 [Stretch] LLM 제한적 사용 — 파싱 폴백 + 카드 큐레이션
**결정**: Claude Haiku 4.5를 두 용도로만 사용. 둘 다 **Stretch**, Core에 포함되지 않음.
1. **파싱 폴백**: 규칙 실패분 재시도 (일 300회 상한)
2. **카드 큐레이션**: 저장된 딜에 한 줄 맥락 (시간당 50회 상한)

**LLM 전송 범위 (ADR-008과 일관)**:
- 파싱 폴백: 제목 + 본문 앞 500자만. 본문 전문 금지
- 큐레이션: 정제된 숫자 필드만 (노선·현재가·시장 평균·분위수). 원문 본문 전송 금지
- **API 이름(`Amadeus` 등) 노출 금지** — 한 줄 문구는 *"시장 평균 대비"* 같은 일반 용어만

**할루시네이션 완화**:
- 시스템 프롬프트: 제공된 숫자만 사용, 외부 지식·계절·이벤트 언급 금지, 60자 이내
- 후처리: 금칙어 + 60자 cut + 숫자 패턴 검증
- 위반 시 `curation_text = null`

**예산**: 1회 지수 백오프, 2회째 실패 스킵, 429 즉시 중단, 월 $2 상한.

**이유**: 규칙 파싱 60% 커버율 한계 보완, 카드 차별화. 비용 통제 가능.
**트레이드오프**: API 키 셋업 장벽 → `.env.example` + graceful degrade.
**Rollback 조건**: 월 비용 > $5 2개월 지속 / 커버율 < 50% 2주 / 할루시네이션 허위 1건 → LLM 제거 또는 로컬 모델 대체.

---

### ADR-006 [재작성 2026-04-18] 🔥 저점 판정 — 관측+시드 FSC/LCC 분위수 (하위 10%)
**배경**: ADR-022 Deprecated 로 Amadeus 분위수 경로 제거. baseline 소스는 ADR-011 우선순위 따름.

**결정**: 딜의 `carrier_class` 에 해당하는 baseline 분위수를 기준으로, `price_percentile ≤ 10` 일 때 `hot_deal = true`.

**세부 규칙**:
| 상황 | baseline 소스 | confidence | 🔥 부여 |
|------|:-------------:|:----------:|:------:|
| 관측 ≥ 30건 + carrier_class 매치 | observed | high | 가능 |
| 관측 10~29건 + carrier_class 매치 | observed+seed 혼합 (`0.6·관측+0.4·시드`) | medium | 가능 |
| 관측 < 10건, 시드 FSC/LCC 매치 | seed | medium | 가능 |
| 시드 mixed 만 존재 | seed mixed | low | **부여 안 함** (팝오버 문구만) |
| 어떤 baseline도 없음 | null | null | **부여 안 함** |

**표시**:
- 배지: `🔥 저점 -52%` (할인율, 직관)
- 팝오버: `하위 8% (p8) · LCC 분위수 · 시장 기준 (관측 42건)` 또는 `… · 기준 (수동 조사)`
- confidence 가 medium/low 인 경우 팝오버에 `confidence: medium` 명시

**이유**: 외부 API 없이도 커뮤니티 관측이 누적되면 자체 분위수 산출 가능. 초기 공백은 수동 시드로 메움. FSC/LCC 분리는 LCC 특가가 FSC 기준에 찍혀 과대 판정되는 것 방지(ADR-024 유지).

**트레이드오프**:
- 초기 몇 주 medium/low 비율이 높음 → UI 팝오버에 confidence 상시 노출하여 과신 방지
- 관측 오염(허위 가격)이 baseline을 끌어내릴 위험 → ADR-011 시드 단독 강제 스위치로 방어
- 초기 carrier_class=mixed 비율 높음 (파싱 부족) → 파서 개선이 중요

**Rollback 조건**:
- FSC/LCC 분리 정확도 < 70% 2주 지속 → mixed 단일 판정으로 회귀
- 🔥 배지 노선별 비율 > 30% → p10 임계를 p5 로 상향
- 관측 오염 감지 → 시드 단독 강제

---

### ADR-007 [Core] 필터 상태 = URL 쿼리 파라미터
**결정**: 상태 라이브러리 없음. `useSearchParams` + `router.replace` + 300ms debounce.
**이유**: 5개 필터 + 정렬 뿐, 공유 가능, SSR 자연스러움.
**트레이드오프**: 복잡 인터랙션 시 리팩토링 필요.
**Rollback 조건**: URL > 2KB 또는 필터 > 10개 시 `nuqs` 검토.

---

### ADR-008 [Core] 저작권·ToS 방어
**결정**:
1. **robots.txt 준수**: 크롤러별 `allowedPaths` 상수
2. **요청 간격 ≥ 1초**, 동시성 1
3. **UA 투명**: `Cheapsky/0.1 (학습 프로젝트, +mailto:<연락처>)`. 위장 금지
4. **저장 범위**: 제목·가격·링크·메타만 영구. 본문 7일 후 NULL. **작성자 닉네임 저장 안 함**
5. **공개 차단**: Share Token (`middleware.ts`) + `X-Robots-Tag: noindex, nofollow` + `<meta>` 태그
6. **트래픽 환원**: 딜 카드 주 액션 = 원문 링크
7. **고지**: 푸터 *"학습 프로젝트 · 원본 출처 링크로 접속해주세요"*
8. **LLM 전송 제한 (ADR-005 교차)**: 폴백 → 제목 + 본문 앞 500자. 큐레이션 → 정제 필드만. 본문 전문 전송 금지
9. **시세 카드 외부 링크**: 스카이스캐너 **검색 URL 생성만** (ToS 우호, 크롤링 아님)

**이유**: 평가 시 ToS·저작권 공격 한 마디로 신뢰 붕괴. LLM 제공자·제3자 배포 리스크도 동일하게 취급.
**트레이드오프**: 갱신 속도·공개성·LLM 파싱 정확도 감소.
**Rollback 조건**: 커뮤니티 운영진이 삭제 요청 → 해당 source 즉시 중단. LLM 제공자가 학습 미사용 보장 철회 → LLM 사용 전체 재검토.

---

### ADR-009 [Core] 중복 제거 키 — carrier_class 포함
**결정**: `sha1(origin | destination | floor(price_krw/1000)*1000 | YYYY-MM | carrier_class)`. 복수 출처는 `sources` 배열 병합.
**이유**: 같은 노선·가격대라도 FSC/LCC는 별개 딜. 천 원·월 단위 경도화로 부가세·수수료 차이 흡수.
**트레이드오프**: 연결편 차이가 해시에 안 반영 → 그 정도 충돌은 감수.
**Rollback 조건**: 잘못 병합된 비율 30% 초과 시 해상도 상향.

---

### ADR-010 [Core] 프로젝트명 Cheapsky
**결정**: repo·도메인·package.json 동일.
**이유**: 이름 기억성 = 차별화.
**트레이드오프**: 영문 전용.
**Rollback 조건**: 상표 충돌.

---

### ADR-011 [재작성 2026-04-18] Baseline 우선순위 — 관측 주(主), 시드 폴백
**배경**: ADR-022 Deprecated 로 Amadeus 계층 제거. 외부 시세 API 없이 운영.

**결정 (우선순위 내림차순)**:
1. **1순위**: `price_observations` ≥ 30건 + carrier_class 매치 → **관측 단독 분위수**
2. **2순위**: `price_observations` 10~29건 + carrier_class 매치 → **관측·시드 혼합** (`0.6·관측 + 0.4·시드`)
3. **3순위**: 관측 < 10건, `baseline_seed.json` FSC/LCC 매치 → **시드 단독**
4. **4순위**: 시드 mixed 엔트리만 존재 → **시드 mixed** (🔥 배지 미부여, 문구에서만 참조)
5. **5순위**: 없음 → 🔥 배지 미부여

관측 ≥ 30건이 되면 시드 참조 중단. 관측 오염 감지 시 3순위(시드 단독)로 수동 강제 가능.

**시드 조사 범위 확장**: `methodology.md` 의 **20개 노선 전수** 으로 확장 (기존 10개 → 20개). Amadeus가 빠진 만큼 시드가 콜드 스타트 주연.

**이유**: 관측 데이터는 뽐뿌 크롤로 자연 누적. 시드는 초기 2~4주의 공백을 메우는 콜드 스타트 + 재난 복구.

**트레이드오프**:
- 관측 10건 미만 노선은 🔥 배지 confidence 가 최대 `medium` → UI 팝오버에 상시 노출하여 과신 방지
- 커뮤니티 소스(뽐뿌)의 편향 위험 → 시드 FSC/LCC 분리 조사로 완화

**Rollback 조건**:
- 관측 오염(허위 가격 반복 UPSERT) 감지 → 해당 노선 시드 단독 강제
- 대안 API 확보 시 1~2 순위 사이에 새 API 계층 삽입 (새 ADR)

---

### ADR-012 [Core] "역대가" 용어 금지. 🔥 저점
**결정**: UI·카피 어디에도 "역대가" 사용 금지. 대체: 🔥 저점 / "시장 평균 대비 N% 할인" / "큰 폭 할인". **"Amadeus" 같은 내부 API 명칭도 UI 노출 금지**.
**이유**: "역대가"는 사상 최저가로 오해. API 이름 노출은 일반 사용자에게 무의미한 기술 누수.
**Rollback 조건**: 없음. 불가역.

---

### ADR-013 [Core] Discovery 중심, 지도·캘린더 제외
**결정**: "오늘의 레이더" 히어로 + 필터 5종. 지도·캘린더 뷰 제외.
**이유**: 사용자 1차 동기 = 탐색. 한 방향 집중이 평가 유리.
**트레이드오프**: 특정 노선 감시 유저 제외.
**Rollback 조건**: 관측 ≥ 6개월 쌓이면 캘린더 히트맵 재검토.

---

### ADR-014 [Core] 출발일 범위 허용
**결정**: `depart_from` / `depart_to` / `return_from` / `return_to`. 단일 확실 시 `from == to`.
**이유**: 커뮤니티 다수 "3~5월" 식 범위.
**트레이드오프**: dedupe 해상도 월 단위.
**Rollback 조건**: 정확한 날짜 추출률 > 80% 달성 시 재검토.

---

### ADR-015 [Core] 타임존 — UTC 저장 / KST 표시
**결정**: DB `timestamptz` UTC / UI `lib/tz.ts` 변환 / Cron UTC + KST 병기 주석.
**Rollback 조건**: 없음.

---

### ADR-016 [Core] 스코프 크리프는 BACKLOG.md 격리
**결정**: 아이디어 즉시 구현 금지. `BACKLOG.md` 1줄 추가 후 개발 계속. PRD "MVP 제외" 목록 개발 중 수정 금지.
**Rollback 조건**: MVP 완성 후 BACKLOG.md 정기 리뷰.

---

### ADR-017 [Core] 공항 아이덴티티 — 대표 IATA 고정
**결정**: 도시당 대표 공항 하나 고정. 별명은 `airport-aliases.ts`에서 대표로 매핑 (카드 제목엔 원본 유지).

| 도시 | 대표 | 별명 |
|------|:----:|------|
| 도쿄 | NRT | HND |
| 오사카 | KIX | ITM |
| 뉴욕 | JFK | EWR, LGA |
| LA | LAX | BUR, ONT |
| 서울 | ICN | GMP (MVP 제외) |

**Rollback 조건**: 같은 대표에 묶인 공항 간 평균가 차이 > 30% → 분리.

---

### ADR-018 [Core: HEAD / Stretch: GET+patterns] 딜 실효성 검증
**결정**: 24h+ 딜은 3시간마다 원문 재방문.
- **Core**: HEAD 요청만. 404/410 → `snapshot`. 그 외 → `active`
- **Stretch**: GET + 본문에서 원 가격(±10%) 패턴 검출 → `active` / `price_changed` 분기
- `verification_fail_count >= 3` → `expires_at = now()` 조기 만료

**이유**: 핫딜 수명 짧음. 죽은 링크 표시는 신뢰 붕괴.
**트레이드오프**: 오탐 가능 (10% 가정) → 3회 연속일 때만 조기 만료.
**Rollback 조건**: 오탐 > 20% 시 기준 완화. 커뮤니티 IP 차단 신호 시 주기 6h 상향.

---

### ADR-019 [Core] Share Token 단일 경로 — Basic Auth 폴백 제거 (Updated 2026-04-19)
**결정**: `SHARE_TOKENS` env에 콤마 분리 다중 토큰. `?t=<token>` URL로 인증. 쿠키 세션 7일.

**변경 이력**:
- 2026-04-18 최초: Share Token + Basic Auth 2단 폴백
- **2026-04-19 업데이트**: Basic Auth 폴백 제거. 이유:
  - bcrypt 해시 관리 비용 (사용자가 평문 비밀번호 잊을 위험)
  - middleware 표면적 축소 (bcryptjs 의존성 제거, edge 호환성 개선)
  - Share Token 3개 (friend/backup/debug) 만으로 친구 평가용 충분
  - BASIC_AUTH_USER/PASS env 제거로 Vercel 배포 설정 단순화

**운영**: 토큰 3개 발급 (`friend`, `backup`, `debug`). 각 12자 이상 랜덤. 유출 의심 시 `SHARE_TOKENS` env rotate.

**Rollback 조건**: 유출 1건이라도 발견 시 즉시 rotate + ShareButton 비활성. Basic Auth 재도입 필요 시 신규 ADR.

---

### ADR-020 [Core] 필터 5종 확정
**결정**: 국가 / 최대 가격 / 출발 월 / 최소 할인율 / 신선도. 모두 기본값("전체") 제공.
**이유**: 가성비 탐험가는 예산·기간이 1차 질문.
**Rollback 조건**: 특정 필터 사용률 < 5% 지속 시 제거.

---

### ADR-021 [Core] 범위: 인천 출발 아시아 17 + 미국 3 = 20개 노선
**결정**: `docs/methodology.md`에 명시된 20개 노선만 수집·표시.
- 아시아 17: 일본 6 (NRT·KIX·FUK·CTS·OKA·NGO) / 동남아 7 (BKK·DAD·SGN·SIN·KUL·MNL·CEB) / 중화권 3 (TPE·HKG·PVG) / 괌 1 (GUM)
- 미국 3: LAX · JFK · HNL

**유럽·오세아니아·중동·남미**는 `BACKLOG.md` Deferred. 김포·제주 출발 / 국내선은 v2.

**이유**:
- 커뮤니티·블로그 공급이 편향되어 있는 영역 집중 (일·동남아 중심)
- 수동 시드 조사 공수가 20 노선에서 감당 가능 (ADR-011 methodology)
- 미국은 장거리 시세 레퍼런스로 3개만 유지 (LAX=서부, JFK=동부, HNL=하와이)

**트레이드오프**:
- "세계 탐색" 기대 축소 → 서브라벨 `인천 출발 아시아·미국 저점 레이더`로 명시
- 미국 3개는 할인율 기준 히어로에 거의 안 뜰 확률 → 주로 시세 히트맵(Stretch 2)에 등장

**Rollback 조건**:
- 관측 축적량 여유·시드 분기 갱신 안정화되면 노선 +5 추가 검토 가능
- 특정 노선 수집 딜 0건 30일 연속 → 해당 노선 드롭

---

### ADR-022 [Deprecated 2026-04-18] Amadeus Self-Service API 통합
**상태**: **Deprecated 2026-04-18** — Amadeus for Developers 개발자 포털 신규 가입 중단 확인. Client credentials 발급 경로 부재로 Core에서 제거.

**원결정 요약 (히스토리 보존)**: 무료 Flight 엔드포인트 3종(Cheapest Date Search · Price Analysis · Flight Offers Search)을 `services/amadeus.ts` 에서 호출, `route_market_data` 에 30h TTL 캐싱, FSC/LCC 이중 집계로 월 1,780/2,000 한도 내 운영.

**폐기 사유**:
1. 개발자 포털 자체 접근 불가 → OAuth2 client credentials 발급 불가능
2. 대안 API 실사용성 검토:
   - **Travelpayouts / Aviasales** — 제휴(referral) 수익화 전제. ADR-008 "학습 프로젝트 · 원문 트래픽 환원" 철학과 충돌
   - **Kiwi Tequila** — API 정책 축소 추세, 가용성 불확실
   - **SerpAPI Google Flights** — 월 $75 이상, 학습 프로젝트 예산 밖
   → Core 기간 내 신뢰 가능한 무료 대체 소스 없음

**대체 조치 (전면 재배치, ADR-004/006/011/024/026/028 교차 수정)**:
- Core baseline은 **수동 시드 + 관측 데이터 단독 운영** (ADR-011 재작성)
- `services/amadeus.ts`, `scripts/ingest_market.ts`, `route_market_data.source='amadeus'` 경로 **전부 미구현**
- `methodology.md` 시드 대상 10 → **20개 노선 전수**로 확장
- 환경변수 `AMADEUS_CLIENT_ID` / `AMADEUS_CLIENT_SECRET` 미사용 (`.env.example` 에서 제거)
- 포털 재오픈 또는 ToS·비용 기준 통과하는 대안 확보 시 `BACKLOG.md` "시세 API 통합" → ADR-026 **3-stretch-market-api** 로 부활

**Rollback 조건**: 없음 (이미 Rollback 상태). 부활은 신규 ADR 로 처리.

---

### ADR-023 [Core 히어로 / Stretch 나머지] 3-섹션 UI (히어로 / Community Picks / 시세 히트맵)
**결정**: 메인 페이지를 세 섹션으로 구성.
1. **히어로** — 오늘의 저점 딜 TOP 3 (② + ③ 레이어만). **Core**
2. **Community Picks** — 사회적 신호 딜 6~8개. **Stretch 1**
3. **오늘의 노선 시세 히트맵** — 관측+시드 baseline 기반 20 노선 (Stretch 3 진입 시 시세 API 로 커버리지 확대). **Stretch 2**

**Core 레이아웃**: 히어로 + 일반 리스트 (Community Picks·히트맵 없음)

**데스크톱 히트맵**: 5×4 그리드. **모바일**: 기본 접힘 + 리스트 대체.

**이유**:
- 3축 가치 (할인율 / 사회적 신호 / 시장 시세)를 명확히 분리
- 섹션별 정렬 기준 다름 (할인율 / 반응 / 노선)

**트레이드오프**:
- 첫 화면 밀도 높음 → 섹션 간 여백·제목 구분 명확히
- 모바일에서 길어질 수 있음 → 히트맵 접힘·Community Picks 카드 간소화

**Rollback 조건**:
- Community Picks 섹션 노출률(사용자 스크롤 도달) < 40% → 섹션 제거 검토
- 히트맵 셀 클릭률 < 5% → 히트맵 축소 or 제거

---

### ADR-024 [Core, 2026-04-18 소스 재조정] FSC/LCC 이중 Baseline 분리
**배경**: ADR-022 Deprecated 로 Amadeus 엔드포인트별 집계 계산 제거. FSC/LCC 분리 원칙 자체는 유지 — 소스만 `price_observations` + `baseline_seed.json` 으로 교체.

**결정**: baseline 저장·조회를 `(origin, destination, carrier_class)` 키로 분리. 딜 평가 시 자신의 `carrier_class` 분위수 사용. 미상일 때 `mixed` 집계 사용.

**소스별 FSC/LCC 이중 범위**:
| 소스 | FSC/LCC 이중 | 이유 |
|------|:------------:|------|
| `price_observations` (관측) | ✅ (`carrier_class` 컬럼 + 인덱스) | 파싱 결과가 바로 분리 축. 관측 UPSERT 시 carrier_class 함께 기록 |
| `baseline_seed.json` (시드) | ✅ (한 노선 × FSC/LCC/mixed 최대 3 엔트리) | `methodology.md` FSC/LCC 분리 조사로 입력 |

**carrier_class 판정** (Amadeus 경로 제거 후):
1. 파싱된 항공사명(한글) → `lib/airlines.ts` 사전 조회
2. 매칭 실패 → `mixed`

**이유**: LCC 특가가 FSC 기준에 찍혀 과대 판정되는 핵심 리스크는 소스와 무관하게 존재. 시드·관측 모두 FSC/LCC 분리 구조라 Amadeus 제거 후에도 원칙 유지 가능.

**트레이드오프**:
- 스키마·쿼리 복잡도 원안 그대로 (추가 비용 없음)
- 초기 mixed 비율이 높음 (파싱 품질에 의존) → 파서 정확도가 핵심
- Amadeus 호출 예산 계산이 사라진 대신, 시드 조사 공수가 10→20 노선으로 증가 (ADR-011 반영)

**Rollback 조건**:
- carrier_class 판정 정확도 < 70% 2주 지속 → mixed 단일 운영으로 회귀
- 관측 FSC/LCC 편중(예: 90% LCC) → 시드 가중치 일시 상향

---

### ADR-025 [Stretch] 플레이윙즈 동의·차단 절차
**결정**: 플레이윙즈 크롤러 활성화 전 아래 절차 필수 통과. Core 구현 종료 후 착수.

**절차**:
1. **RSS 피드 탐색**: `playwings.kr/feed`, `/rss` 등 확인
   - 있음 → RSS 소비. 크롤링 아님. 이 ADR의 나머지 절차 생략, 진행
   - 없음 → 2로
2. **운영자 메일 통보** (블로그 About/Contact 주소로):
   ```
   제목: [Cheapsky] 학습 프로젝트 관련 사용 문의
   
   내용:
   - 범위: 제목·가격·노선·링크 메타만 추출, 본문 저장 안 함
   - 목적: 개인 학습 프로젝트, 친구 간 비공개 평가용
   - 기간: 2~4주 평가 기간 한정
   - 트래픽 환원: 모든 카드에서 원문으로 연결
   - 저장 정책: 본문 캐시 7일 TTL
   - 요청 시: 즉시 중단
   ```
3. **응답 대기** 10 영업일
   - **동의**: 즉시 진행
   - **거절**: 영구 제외, BACKLOG에 기록
   - **조건부 동의**(예: 일 N회 제한): 조건 준수 후 진행
   - **무응답**: 평가 기간 한정(종료 시점 명시)으로 진행, 기간 종료 즉시 중단
4. **운영 중 이의 제기**: 즉시 크롤러 비활성 + 24시간 내 저장 데이터 삭제

**이유**: 1인 창작자 노동 무임승차 프레임 방어. 법적 불명확성 완화.

**트레이드오프**: 최장 2주 지연. MVP Core 기간에 플레이윙즈 의존 불가 → Stretch로 분류.

**Rollback 조건**: 위 4번(이의 제기) 시 즉시 Rollback. 다른 블로그 대체도 검토.

---

### ADR-026 [재작성 2026-04-18] MVP Core / Stretch 분리 — 3-트랙
**결정**: MVP를 세 트랙으로 나누어 개발 순서 강제. ADR-022 Deprecated 로 Core 시간 버퍼 단축.

**Core (친구 평가 최소 요건, ~5~7d)** — Amadeus 통합 제거로 반나절~1일 단축:
프로젝트 부트스트랩 + **시드 baseline + 관측 가중 혼합** + 뽐뿌 크롤러 + 규칙 파서 + FSC/LCC 판정 + 히어로 + 일반 리스트 + 🔥 배지 + **카드 한 줄 맥락 규칙 기반 폴백** + 필터 + Share Token + 실효성 검증(HEAD) + 크롤러 헬스 + `SHOW_CACHED_ONLY` + 비용 모니터(Supabase 크기 중심) + README(1분 DEMO 시나리오 인라인).

**Stretch (~+3~5d)** — 3개 task로 분리:
- **1-stretch-sources**: 루리웹 크롤러 / 플레이윙즈 크롤러(ADR-025 통과 후) / Community Picks 섹션
- **2-stretch-enhancements**: LLM 파싱 폴백 + 큐레이션 / 스파크라인 / 시세 히트맵(관측+시드 한정) / 노선 빈도 / 실효성 검증 정밀 / 아카이브 / GLOSSARY·OPERATIONS·LLM_PROMPTS 문서
- **3-stretch-market-api** (**외부 조건부**): 시세 API 재통합. Amadeus 포털 재오픈 또는 ADR-008 ToS·비용 통과하는 대안(예: 포털 복귀, 신규 무료 API 등장) 확보 시에만 착수. 산출물: `services/<market-api>.ts` 클라이언트 + `scripts/ingest_market.ts` + `route_market_data.source='api'` 갱신 + 시세 히트맵 20개 완전 커버

**규칙**:
- Core 완성 전 Stretch 금지 (PR/commit 단위 자가 규율)
- Stretch 중 막히면 다음 Stretch 로 이동, Core 회귀 금지
- **3-stretch-market-api 는 외부 조건부** — API 가용성·ToS·비용 사전 확인 없이 착수 금지. 진입 시 신규 ADR 추가 필수
- Stretch 항목 중 완료된 것만 평가 시 노출, 미완은 숨김

**Core 시간 버퍼 근거** (2026-04-18 갱신):
- ~~Amadeus OAuth 발급·테스트: 반나절~~ → 제거
- Supabase RLS 디버그: 반나절
- Vercel middleware (Share Token + Basic Auth) 테스트: 반나절
- 뽐뿌 파싱 골든셋 튜닝: 반나절~1일
- 숨은 셋업 비용 1~1.5d 가량 명시적 반영

**이유**: ADR-022 Deprecated 로 외부 시세 API 의존 제거. 완주 리스크 축소. Core 범위가 좁아진 만큼 완성도에 투입할 여유 확보.

**트레이드오프**:
- 🔥 배지 초기 confidence 가 낮음 (관측 누적 전)
- 시세 히트맵(Stretch 2)이 관측 쌓인 노선만 표시 → 20개 완전 커버는 Stretch 3 조건부
- 차별화 포인트 하나(실시간 시세 교차)가 약해짐 → 관측 누적과 시드 FSC/LCC 분리 정확도로 보완

**Rollback 조건**:
- Core 진도가 4일차에 50% 미만이면 Stretch 포기 선언하고 Core 완성도에 전력

---

### ADR-027 [Core] 카드 유형 분리 — 딜 카드 vs 시세 카드
**결정**: 시각적·동작적으로 두 종류 카드 분리.

| 유형 | 데이터 | 클릭 시 | 라벨 | 배치 |
|------|-------|---------|------|------|
| **딜 카드** (`DealCard`) | 뽐뿌/루리웹/플레이윙즈 | 원문 새 탭 | 출처 태그 | 히어로, 일반 리스트, Community Picks |
| **시세 카드** (`MarketCard`) | 관측(`price_observations`) + 시드(`baseline_seed.json`) | 스카이스캐너 **검색 URL** 새 탭 | `참고 시세` | 오늘의 노선 시세 히트맵 전용 (Stretch 2) |

**스카이스캐너 검색 URL 생성** (`lib/skyscanner-url.ts`):
```
https://www.skyscanner.co.kr/transport/flights/{origin}/{destination}/{YYMMDD}/
```
크롤링 아님. 공개된 URL 패턴 사용.

**이유**:
- 사용자 기대 행동 분리: 딜=구매 시도, 시세=학습
- 관측·시드 baseline 은 특정 예약 링크가 없는 집계치 → 외부 검색 페이지로 유도가 가장 정직
- 라벨로 "참고 시세"임을 명시해 사용자 혼동 방지

**트레이드오프**: 컴포넌트 두 개 관리. 공통 스타일은 UI_GUIDE에 공유.

**Rollback 조건**: 사용자가 두 카드 구분 못 하고 불평 → 스타일 더 차별화 (색 테두리, 아이콘).

---

### ADR-028 [Core] `SHOW_CACHED_ONLY` 패닉 모드 — **UI 전용**
**결정**: Vercel env에만 `SHOW_CACHED_ONLY=true` 설정. UI에 `🔒 캐시 모드` 배너 표시 + 사용자에게 공지. **배치 cron은 영향을 받지 않고 계속 운영**.

**동작**:
- **UI**: Server Component 쿼리는 평소와 동일 (RLS anon read). 배너 + "최근 캐시 사용 중" 문구만 추가
- **배치 cron** (crawl / verify / cost_check / (Stretch) curate / (Stretch) archive): **계속 운영**. Vercel env는 GH Actions에 전파되지 않으므로 자동으로 배치는 영향 없음
- 이유: 시연 중 UI에만 "지금 일시적 이슈입니다" 고지하고, 배치는 백그라운드에서 커뮤니티 복구를 자동 감지·재시도 → 시연이 끝날 즈음 자연스럽게 최신 상태

**이전 정책 (배치도 스킵)과의 차이**:
- 배치를 멈추면 커뮤니티가 복구돼도 UI 데이터 안 갱신 → 시연 끝 직전 수동 해제 필요
- UI 전용으로 바꾸면 배치가 알아서 복구 → 수동 개입 최소화

**이유**: 시연 당일 뽐뿌(Core) 또는 (Stretch) 루리웹·플레이윙즈·Anthropic 중 하나라도 장애가 나면 최악. UI를 "정상 척 안 함"으로 전환하는 패닉 버튼. ADR-022 Deprecated 로 Amadeus 의존은 없음 (Stretch 3 진입 전까지).
**트레이드오프**: UI는 "캐시" 라벨로 덜 매력적이지만 방어적. 배치 오작동 시에도 UI는 조용함.
**Rollback 조건**: 한 번도 안 쓰이면 env조차 제거. 쓴 후 복구는 env 삭제.

---

### ADR-029 [Stretch] Cheapsky Light v5 — 라이트 테마 공식 리디자인 (2026-04-19)
**결정**: Cheapsky 공식 테마를 기존 다크 (`#0a0a0a` + emerald) → **라이트 (`#fafaf9` + ink-* + low/hot dual accent)** 로 전환. Claude Design 에서 사용자가 직접 이터레이션한 `Cheapsky Light v5.html` 프로토타입을 소스로 포팅.

**신규 팔레트** (전체 스펙 UI_GUIDE.md):
- 페이지 `#fafaf9` · 카드 `#ffffff` · 보조 면 `#f6f6f4`
- 텍스트 5단계 `ink-*` (`#0b0b0c` ~ `#b4b2ac`)
- Hairline `#ececE7` / 강조 테두리 `#dedcd6`
- 데이터 시맨틱: `low`(#0b7a3b) · `hot`(#b8330e) · `warn`(#a55509) · `up`(#9a1b1b) · `accent`(#0a66ff, focus 전용)

**v5 신규 UI 단위**:
- Verdict 한 줄 (사용자 언어 판단 문장)
- 프리셋 칩 + `자세히 설정` 토글 (FilterBar 재구성)
- Hero dual CTA (원문 + 스카이스캐너 검색)
- 도시명 한글화 (`후쿠오카 · 4박 5일`)
- Counter 섹션 · Timeline feed · Month timing card
- 모바일 하단 탭바 · Toast · Saved routes strip (localStorage)
- 노선 상세 모달 (라이브 SVG 차트 · 시즌 mini calendar · 딜 로그)
- ⌘K Command palette · i18n(KO/JA/EN) · Compare drawer · Tweaks 플로팅 패널(dev-only)

**이유**:
- 사용자 직접 이터레이션 완료 (v1→v5, 2026-04-19)
- 분석가 언어 (`−p9 · 하위 분위수`) → 사용자 언어 (`지금 사기 좋아요`) 로 판단 비용 완화
- 프리셋 + dual CTA 로 첫 방문자 마찰 제거

**트레이드오프**:
- 다크 테마 Deprecated → 재도입 시 신규 ADR
- `check_ui_slop.py` 훅 규칙 완화 (`rounded-2xl` 허용, `rounded-3xl` 금지, 라이트 팔레트 기준으로 에러 메시지 갱신)
- 일부 v5 기능 (⌘K · compare drawer · i18n) 은 프로토타입 수준 소프트 fallback

**Rollback 조건**: 사용자 평가에서 "가독성 낮다" 다수면 Tweaks 패널에 다크 변형 토글 추가. 전면 롤백은 신규 ADR 필요.

**수정된 문서·파일**: UI_GUIDE.md (전면) / 본 파일 (ADR-029 추가) / CLAUDE.md (팔레트 섹션) / `scripts/hooks/check_ui_slop.py` (슬롭 룰 라이트 기준) / `app/src/app/globals.css` (CSS 변수 + 유틸) / `app/tailwind.config.ts` / `app/src/lib/{city-names,format,presets,i18n}.ts` (신규) / 20+ 컴포넌트 light 전환

---

## ADR 상호 의존 지도 (2026-04-19 갱신)
- **004 (소스 구조, 2-레이어+baseline)** → **011 (우선순위)** / **025 (플레이윙즈 동의, Stretch ② 조건부)**
- **005 (LLM)** ↔ **008 (저작권)**: LLM 전송 범위 제한
- **006 (🔥 판정)** ← **024 (FSC/LCC 분리)** ← **011 (baseline 우선순위, 관측 주·시드 폴백)**
- **006** ← **017 (공항 표준화)**: 정규화 후 집계
- **006** ← **028 (SHOW_CACHED_ONLY)**: 캐시 모드에서 신뢰 하락 표시
- **009 (dedupe)** ← **017 (공항)**, **024 (carrier_class)**
- **014 (범위 출발일)** → **009**: 월 해시 근거
- **020 (필터 5종)** ← **007 (URL 상태)**
- **021 (범위, 20개 노선)** → **011 (시드 20개 전수)**
- **022 (Amadeus)**: **Deprecated 2026-04-18** — 대체: 011 (관측+시드 단독). 부활은 026 의 **3-stretch-market-api** 조건부
- **023 (3-섹션 UI)** ← **027 (카드 유형)**: 시세 카드는 히트맵 전용 (Stretch, 관측+시드 한정)
- **026 (Core / Stretch 1 / Stretch 2 / Stretch 3-market-api)** → 전 ADR: 각 결정의 단계 분류
