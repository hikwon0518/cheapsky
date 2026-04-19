# UI 디자인 가이드

> 이 문서의 한 줄 요지: **라이트 베이스 대시보드** (Cheapsky Light v5, 2026-04-19 공식 리디자인). `#fafaf9` 종이 배경 + `#ffffff` 카드 + 1px hairline. 🔥 저점 · 큰 폭 할인 · 90일 스파크라인 · Verdict 한 줄로 "지금이 저점"을 한눈에.

## 디자인 원칙
1. **도구처럼 보일 것.** 마케팅 랜딩이 아니라 매일 열어보는 운영 대시보드.
2. **숫자가 주인공.** 가격·할인율·경과 시간이 먼저 꽂혀야 한다. 장식이 숫자를 침범하면 제거.
3. **밀도 > 여백.** 히어로 아래 일반 카드가 한 화면에 6~8개. 랜딩 감성 금지.
4. **증명 > 주장.** "🔥 저점" 문구 옆에 반드시 수치·차트·맥락 문장 중 최소 하나.
5. **사용자 언어 > 분석가 언어.** `−p9 · FSC 분위수` 대신 `지금 사기 좋아요 · 평소 X원이던 노선이에요` (verdict). 전문 수치는 hover 툴팁으로 숨김.

## AI 슬롭 안티패턴 — 하지 마라
| 금지 사항 | 이유 |
|-----------|------|
| `backdrop-filter: blur()` | glass morphism = AI 템플릿 1순위 징후 (sticky 헤더/필터 `backdrop-blur-sm` 만 예외) |
| gradient-text | AI SaaS 랜딩 특징 |
| "Powered by AI" 배지 | 장식, 사용자 가치 없음 |
| box-shadow 글로우 | 네온 글로우 = 슬롭 |
| 보라/인디고 브랜드 | "AI = 보라" 클리셰 |
| `rounded-3xl` 과 과도한 둥근 모서리 | hero 는 `rounded-2xl`(16px), 기본 `rounded-lg/xl` 만 허용 |
| 배경 gradient orb (`blur-3xl`) | AI 랜딩 장식 |
| 카드 hover 3D tilt / translate-y-2 | 대시보드에 거슬림 |
| 🔥 외의 이모지 카드 사용 | 🔥 저점 배지만 허용. 🎉🚀✨ 전부 금지 |

## 색상 (Light v5)

CSS 변수는 `app/src/app/globals.css :root` 에 선언, Tailwind 토큰 `page / card / surface-2 / ink-* / line / low / hot / warn / up` 으로 매핑 (`tailwind.config.ts`). 이 변수 외 neutral-* · emerald-* · amber-* 사용 금지.

### 배경
| 용도 | 변수 | 값 |
|------|------|------|
| 페이지 | `--page` | `#fafaf9` |
| 카드 (surface) | `--surface` | `#ffffff` |
| 보조 면 (카드 hover · segment active) | `--surface-2` | `#f6f6f4` |
| 필터 · 헤더 sticky | `--page` + `backdrop-blur-sm` | `rgba(250,250,249,.9)` |
| 구분선 (1px hairline) | `--line` | `#ececE7` |
| 강조 테두리 | `--line-2` | `#dedcd6` |

### 텍스트
| 용도 | 변수 | 값 | Tailwind |
|------|------|------|------|
| 주 텍스트 (가격·제목) | `--ink` | `#0b0b0c` | `text-ink` |
| 본문 | `--ink-2` | `#2a2a2c` | `text-ink-2` |
| 보조 (라벨) | `--ink-3` | `#5c5c5f` | `text-ink-3` |
| 메타 (경과 시간) | `--ink-4` | `#8a8a8d` | `text-ink-4` |
| 비활성 / snapshot | `--ink-5` | `#b4b2ac` | `text-ink-5` |

### 데이터·시맨틱 색상
| 용도 | 변수 | 값 | 사용 규칙 |
|------|------|------|----------|
| 🔥 저점 배지 (hot deal) | `--hot` + `--hot-soft` | `#b8330e` / `#fbe7df` | 카드당 1개. chip-hot |
| 큰 폭 할인 (-30% ↑) | `--low` + `--low-soft` | `#0b7a3b` / `#e8f2ea` | chip-low |
| 가격 상승 / 상위 분위 | `--up` + `--up-soft` | `#9a1b1b` / `#fbe3e3` | counter 섹션 |
| 가격 변경 경고 (price_changed) | `--warn` + `--warn-soft` | `#a55509` / `#faead3` | 배지 ring only |
| 키보드 포커스 링 | `--accent` | `#0a66ff` | focus-visible 전용, 장식 금지 |
| snapshot (원문 삭제됨) | `--ink-5` | `#b4b2ac` | opacity 0.5 + grayscale |

> 포인트 색은 **low(green) + hot(red-ember) 두 개만**. accent 파랑은 포커스 링 전용. 보라/핑크/amber 등 추가 금지. 다크 테마는 Deprecated (2026-04-19, Cheapsky Light v5 포팅).

## 컴포넌트

### 히어로 ("오늘의 추천 3")
페이지 최상단 고정. 히어로는 첫 인상.

```
컨테이너: rounded-xl bg-card border border-line-2 p-5 md:p-7 mb-6
          shadow-[0_1px_0_rgba(0,0,0,.02),0_24px_48px_-32px_rgba(20,20,20,.14)]
```

**상단 바 (1줄)**:
- 왼쪽: `오늘 찾은 큰 폭 할인 <N>개` (`text-sm text-ink-3`, N은 `text-ink font-semibold`)
- 오른쪽: `최대 할인율 <X>%` (`text-sm tabular-nums text-low`)

**TOP 3 카드 그리드**:
- 데스크톱: `grid md:grid-cols-3 gap-3 mt-4`
- 히어로 카드 (DealCard `variant='hero'`): `rounded-xl border border-line-2 p-5`, 가격 `text-3xl`, 도시명 (`후쿠오카`) 15px semibold, 루트(`ICN → FUK`) + 체류일(`4박 5일`) tabular 캡션
- verdict 라인: hot deal 또는 ≥30% 할인이면 `<b>지금 사기 좋아요.</b> 평소 <strike>X원</strike>이던 노선이에요.`
- Dual CTA (hover 시 노출): `원문 · {source}` primary (btn-primary, `bg-ink text-white`) + `스카이스캐너 검색` ghost (btn-ghost). 모바일 `hover: none` 에선 항상 표시

**모바일 (< 640px)**:
- TOP 1만 히어로 카드로 크게 (전체 너비, 가격 `text-3xl`)
- TOP 2·3은 grid 세로 스택 (동일 카드, grid-cols-1)
- 3장 이하일 때 빈 자리는 렌더 안 함 (placeholder 금지)

**데이터 부족 시**: 히어로 섹션 자체를 렌더하지 않음. 아래 일반 리스트만 표시.

### 카드 두 유형 (ADR-027)
두 카드 컴포넌트는 **테두리**와 **라벨**로 시각적으로 구분된다. 사용자의 클릭 기대 행동이 다르기 때문.

| 유형 | 컴포넌트 | 테두리 | 상단 라벨 | 클릭 이동 |
|------|----------|--------|-----------|-----------|
| 딜 카드 (hero) | `DealCard variant="hero"` | `border-line-2` + soft shadow | 도시명 (`후쿠오카`) | dual CTA (원문 · 스카이스캐너) |
| 딜 카드 (list) | `DealCard variant="list"` | `border-line` | 노선 (`ICN → FUK`) | 원문 새 탭 (Link 래퍼) |
| 시세 카드 | `MarketCard` | `border-dashed border-line-2` | `참고 시세` (`text-ink-4`) | 스카이스캐너 검색 URL |

### 딜 카드 (DealCard)
```
list 기본:  rounded-lg bg-card border border-line p-4
hero 기본:  rounded-xl bg-card border border-line-2 p-5 + soft shadow
hover:     border-line-2 (transition 120ms)
snapshot:  opacity-50 grayscale italic (클릭 비활성)
```
- 모서리 `rounded-lg` (list 8px) / `rounded-xl` (hero 12px). `rounded-3xl` 금지
- 그림자 없음(list) / 저채도 soft shadow 만(hero)
- **list 레이아웃**:
  1. 상단: 노선 (`ICN → KIX`) + 항공사 (`대한항공 · FSC`) · 공유 버튼 (우측)
  2. 중단: 가격 (`text-2xl text-ink`) · 🔥 저점 배지
  3. 하단 1: LLM 한 줄 맥락 (Stretch, 있을 때만)
  4. 하단 2: 스파크라인 (Stretch, 좌) · 노선 빈도 + 경과시간 (Stretch, 우)
  5. 최하단: 출처 태그 (`PPOMPPU` 또는 `PPOMPPU · RULIWEB · PLAYWINGS`)
- **hero 레이아웃**:
  1. 상단: 도시명 (`후쿠오카`, 15px semibold) · 루트(`ICN → FUK · 4박 5일`) · 찜/공유 버튼
  2. 중단: 가격 (`text-3xl text-ink tabular-nums`) · 🔥 chip
  3. **Verdict 라인**: `<b>지금 사기 좋아요.</b> 평소 ~{baseline}~이던 노선이에요.`
  4. CurationLine (Stretch 2)
  5. 하단: dual CTA (`원문 · {source}` primary + `스카이스캐너 검색` ghost), 경과 시간 + 출처

### 시세 카드 (MarketCard)
```
기본: rounded-lg bg-surface border border-dashed border-line-2 p-3
hover: border-solid border-ink-4 (transition 120ms)
```
- 히트맵 섹션 전용. 딜 카드보다 패딩 작음 (밀도 ↑)
- 레이아웃:
  1. 상단: 노선 (`ICN → KIX`) · 우상단 `참고 시세` 라벨
  2. 중단: 가격 (`text-xl`, 딜 카드보다 작게) · 항공사 코드 한 줄
  3. 하단: 분위수 점 + `하위 15%` 텍스트
- `참고 시세` 라벨은 `text-[10px] text-ink-4 tracking-wide` — 색 대비 일부러 낮춤
- **하단 고지 문구** (딜 카드와 혼동 방지): `text-[10px] text-ink-4` 로 `예약 시 가격은 달라질 수 있어요` 한 줄. 마지막 줄 고정

### 카드 리듬 규칙
LLM 한 줄이 있는 카드와 없는 카드가 섞여도 높이가 크게 흔들리지 않게:
- 모든 카드 `min-height: 180px` (기본), `min-height: 220px` (히어로)
- LLM 한 줄 영역은 `min-h-[32px]` 확보 (문장 없어도 자리 고정, 빈 줄로)
- 단, 리스트 상단 5개는 높이 차이 시각적 거슬림 적으므로 모두 LLM 한 줄 있도록 큐레이션 우선순위 조정 (ADR-005 운영 정책)

### 버튼
```
Primary:   rounded-md bg-ink text-white px-3 py-1.5 text-sm hover:bg-[#26261f]
Secondary: rounded-md border border-line bg-surface text-ink-2 hover:border-ink-2
Text:      text-ink-3 hover:text-ink
Icon:      w-7 h-7 rounded grid place-items-center text-ink-4 hover:bg-surface-2
```

두 개를 flex 로 묶는 dual CTA 패턴 (Hero 카드 전용) — hover 시 opacity 0 → 1 reveal:
```
<div class="card-ctas flex gap-2">
  <a class="btn btn-primary flex-1">원문 · 뽐뿌</a>
  <button class="btn btn-ghost flex-1">스카이스캐너 검색</button>
</div>
```

### 필터 입력
```
rounded-md bg-surface border border-line px-3 py-2 text-sm text-ink
focus: border-ink-4 outline-none
```

### FilterBar (프리셋 + 5종 디테일)
sticky top (`top-14 z-20 bg-page/90 backdrop-blur-sm border-b border-line`).

**프리셋 칩 (row 1, 항상 노출)** — 첫 방문자의 학습 비용을 줄이는 퀵 필터. `.preset` 스타일:
```
display:inline-flex; padding:7px 12px; rounded-full;
font-size:12.5px; bg:white; border:1px solid var(--line); color:var(--ink-2);
hover: border-ink-2 color-ink
selected [data-on="true"]: bg-ink color-white border-ink
```
기본 프리셋 (6개 + `+ 자세히 설정` 토글):
- `🇯🇵 일본 30만 이하` → `region=JP&maxPrice=300000`
- `🔥 큰 폭 할인만` → `minDiscount=30`
- `여름휴가 7–8월` → `month=2026-07` or 08
- `주말 왕복` → (클라이언트 측 필터링, 금~일 범위 딜만)
- `🇺🇸 미국 100만 이하` → `region=US&maxPrice=1000000`
- `한 달 만에 처음` → (route-frequency.ordinal=1)

**기본 필터 (row 2, 기본 접힘)** — `+ 자세히 설정` 토글로 펼침. 5개 입력 가로 배치:
- 지역 · 최대 가격 · 출발 월 · 최소 할인율 · 신선도 segment
- **Debounce**: 300ms 후 URL 갱신. 입력 중에는 기존 리스트 유지 → fade 150ms
- **초기화**: 우측 `초기화` 텍스트 버튼 (기본값일 때 비활성)

**모바일**: preset chips 은 가로 스크롤, 기본 필터는 bottom sheet drawer.

### 🔥 저점 배지 (PriceBadge)
```
hot: bg-hot-soft text-hot border border-hot-line
low(>=30%): bg-low-soft text-low border border-low-line
mid: bg-surface-2 text-ink-2 border border-line
inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium tabular-nums
```
- 텍스트: `🔥 저점 -47%` / `큰 폭 할인 -32%` / `-12%`
- `tabular-nums`로 폭 고정
- **"역대가"라는 문자열 절대 사용 금지** (ADR-012)
- 배지 옆 보조: `text-[11px] text-ink-4`

#### 배지 근거 팝오버
배지 hover (데스크톱) / tap (모바일) 시:
```
팝오버: rounded-lg bg-surface border border-line-2 p-3
        text-xs text-ink-2 tabular-nums w-[240px]
        shadow-[0_12px_28px_-12px_rgba(20,20,20,0.24)]
```
내용 (4줄): 기준/현재/할인/분위수.

**구현 주의 (모바일 tap 충돌 방지)** — 기존과 동일. onClick 에 preventDefault + stopPropagation.

### Verdict 라인 (Hero 전용)
사용자 언어 한 줄 결론. `lib/format.ts::formatVerdict()` 가 `hotDeal / discountRate / baselineKrw` 로 tone 결정:
- `hot` (hotDeal=true): `vi-hot` 🔥 아이콘 + `"지금 사기 좋아요. 평소 ~{baseline}~이던 노선이에요."`
- `good` (≥30% 할인): `vi-good` ✓ 아이콘 + `"평소보다 많이 싸요. 평소 ~{baseline}~이던 노선이에요."`
- `null`: verdict 라인 생략

CSS `.verdict`, `.vi`, `.vi-hot`, `.vi-good` 는 `globals.css` 에 정의.

### 스파크라인 (Sparkline)
```
컨테이너: h-[30px] w-[120px]
선: stroke-ink-4 (기본), stroke-low (최저 구간)
현재 점: fill-low r=2
```
- 축·그리드·범례·애니메이션 없음
- **hover 예외 허용**: 점 hover 시 작은 tooltip 한 줄 (`2026-02-14 · 310,000원`)
  - tooltip 스타일: `text-[11px] text-ink-2 bg-ink rounded px-1.5 py-0.5`
  - 박스형 툴팁 X, 얇은 텍스트 오버레이만
- 데이터 3건 미만: 스파크라인 자리에 `text-[11px] text-ink-4 italic` 로 `데이터 수집 중` 한 줄

### 카드 한 줄 맥락 (CurationLine) — 규칙 기반 폴백 + LLM 큐레이션
```
text-xs text-ink-2 leading-snug line-clamp-2 min-h-[32px]
```

**두 단계 생성**:
1. **Core (규칙 기반 정적 한 줄, 모든 카드 100% 커버)** — 서버에서 딜 데이터로부터 템플릿 한 줄 생성
   - 예: `시장 평균 대비 -52% · 하위 p7 · LCC 분위수`
   - 예: `지난 7일 이 노선 최저 · 할인율 -38%`
   - 데이터 부족 시: `시장 평균 정보 수집 중` (빈 줄 대신)
2. **Stretch (LLM 자연어 큐레이션)** — Claude Haiku 4.5가 규칙 한 줄 위에 자연스러운 60자 문장으로 덮어씀
   - 예: *"지난 30일 이 노선 가장 낮은 가격대. LCC 기준 시장 평균 대비 52% 저렴."*

**규칙**:
- 최대 60자 (서버 cut)
- 형식: 사실형 서술. 감성·계절·이벤트 금지
- "Amadeus" 같은 API 명칭 노출 금지 (ADR-012)
- LLM 생성 실패·규칙 위반 시 **규칙 폴백으로 자동 대체** → 카드에 한 줄 빈 상태 없음
- 생성 실패 시 빈 영역 유지 (`min-h-[32px]`로 리듬 보존)
- 감성·계절·이벤트 추론 금지 (예: `"벚꽃 시즌에 좋아요"` ❌)

### 노선 빈도 (RouteFrequency)
카드 하단 한 줄 마이크로 지표.
```
text-[11px] text-ink-4
```
표기 규칙:
- 1번째: `이 노선 30일 내 첫 등장` (흰색 강조, `text-low`)
- 2~4번째: `이 노선 30일 3번째`
- 5번째 이상: `자주 올라오는 노선 (30일 5회)` (보조, 판단 주의 환기)

### 공유 버튼 (ShareButton)
카드 우상단 작은 아이콘. lucide `share-2` size=14, strokeWidth 1.5.
```
w-7 h-7 rounded hover:bg-surface-2 grid place-items-center
aria-label="이 딜 공유"
```
- Web Share API 지원 시: `navigator.share({ url, title })`
- 미지원 시: `navigator.clipboard.writeText(url)` + 토스트 `링크 복사됨` (2s)
- 공유 URL에는 현재 필터 쿼리 + share token 포함 (ADR-019)

### 출처 태그 (SourceTag)
```
text-[11px] text-ink-4 uppercase tracking-wide
```
- 뱃지화 금지. 그냥 텍스트. `PPOMPPU · RULIWEB`
- 아이콘 컨테이너 금지

### 크롤러 헬스 (CrawlerHealth)
푸터 우측. 시연에서 "지금 돌고 있음" 증거.
```
flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-4
점: inline-block w-1.5 h-1.5 rounded-full
  - 성공 (최근 30분): bg-low
  - 지연 (30분~2시간): bg-ink-4
  - 실패 (2h+ 또는 최근 run failed): bg-up
```
표기 (Core): `● 뽐뿌 3분 전`
표기 (Stretch 1): `● 뽐뿌 3분 · ● 루리웹 8분 · ● 플레이윙즈 6분`
표기 (Stretch 3 진입 시): 위 항목에 `· ● 시세 4h` 추가

- 시세 API(Stretch 3) 도입 시 갱신 주기가 일 1회 → 캐시이므로 "4h 전"까지 에메랄드, 30h+ 회색
- 각 점에 `aria-label="<source> 정상, <time> 전 수집"` 형태 텍스트 제공
- 클릭 시 `/api/health` JSON 새 탭

### StaleBanner (크롤러 전체 지연 시)
```
상단 고정: bg-warn-soft border-b border-warn-line text-warn
           text-xs px-4 py-2
```
문구: `최근 수집이 지연되고 있어요. 표시된 딜은 이전 수집 기준입니다.`
딜 크롤러(뽐뿌 Core, 루리웹·플레이윙즈 Stretch 1) 전부 최근 2시간 이상 성공 없음일 때만 표시.

### CacheOnlyBanner (`SHOW_CACHED_ONLY=true`)
```
상단 고정: bg-surface-2 border-b border-line-2 text-ink-2
           text-xs px-4 py-2 flex items-center gap-2
```
아이콘: 🔒 (유일하게 허용되는 비-🔥 이모지, `aria-hidden`)
문구: `캐시 모드로 표시 중입니다. 데이터 갱신이 일시 중단되었어요.`

### Community Picks 섹션 (Stretch, ADR-023)
히어로 아래, 일반 리스트 위. 사회적 신호 기반 6~8개 딜.
```
섹션 헤더: text-lg font-medium text-ink mb-3 flex items-center gap-2
  + 서브라벨: text-xs text-ink-4 → `뽐뿌·루리웹·플레이윙즈에서 반응 많은 딜`
카드 그리드: grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3
카드 라벨(배지 옆): text-[10px] text-ink-4 uppercase
  → 'HOT' (뽐뿌 당일 조회 상위) · 'TRENDING' (댓글 급증)
```
**조회수·댓글 숫자는 표시하지 않는다** (사이트간 스케일 상이로 오해 소지).

### 오늘의 노선 시세 히트맵 (Stretch, ADR-023)
**데스크톱**: 5×4 그리드 (20개 셀).
```
섹션 헤더: text-lg font-medium text-ink mb-3
  + 서브라벨: `인천 출발 주요 20개 노선 오늘 최저가`
그리드: grid grid-cols-5 gap-2
셀 (MarketCard): 위 규정 적용
분위수 점 색:
  - p10 이하: bg-low
  - p10~p50: bg-ink-4
  - p50 초과: bg-surface-2
```

**모바일**: 기본 접힘. 단, **가장 싼 3개 노선 프리뷰**를 항상 표시 (히트맵 가치 손실 방지).
```
프리뷰 영역 (접힌 상태에서도 항상 표시):
  섹션 헤더 아래, 3개 행만 노출
  좌: 분위수 점 + `ICN → KIX` + `대한항공`
  우: `298,000원` (tabular-nums) + `하위 15%`

토글 버튼 (프리뷰 아래):
  w-full rounded-md border border-line py-2 text-sm text-ink-3
  flex items-center justify-between px-3
  → "노선 17곳 더 보기  ∨"   (3 + 17 = 20)

펼쳤을 때: 프리뷰 3개 유지 + 나머지 17개 행 추가 (grid grid-cols-1 gap-1)
각 행: flex items-center justify-between py-2 border-b border-line
       좌: 분위수 점 + `ICN → KIX` + `대한항공`
       우: `298,000원` (tabular-nums) + `하위 15%`
```
셀/행 클릭 → 스카이스캐너 검색 URL 새 탭.

### Baseline 데이터 부족 시 (Core)
시세 히트맵(Stretch 2)은 관측 데이터가 10건 미만인 노선 셀을 `데이터 수집 중` 라벨로 표시. 전 노선에서 관측이 10건 미만이면 섹션 자체 렌더 생략.

### (Stretch 3 진입 시) 시세 API 장애
시세 API 호출이 24h 이상 실패한 노선은 `route_market_data` 에서 `source='seed'` 로 자동 폴백. 시세 히트맵 셀은 confidence 를 낮춰 표시. 푸터 헬스에 시세 점 빨강 표시.

### 상태 배지 (VerificationStatus)
- `active`: 라벨 없음
- `snapshot` (원문 삭제): 카드 opacity 0.5 + 좌상단 `text-[10px] text-ink-4` 로 `원문 삭제됨`
- `price_changed`: 🔥 배지 옆 `text-[10px] text-warn` 로 `가격 변경 가능성`

## 레이아웃
- 전체 너비: `max-w-6xl mx-auto`
- 좌우 패딩: `px-4 md:px-6`
- 상단 헤더: `h-14 sticky top-0 bg-page/90 backdrop-blur-sm` (blur 단 1곳 예외)
- 헤더 내부: 로고 + 서브라벨 `인천 출발 항공권 저점 레이더` (`text-xs text-ink-4`)
- FilterBar: 헤더 바로 아래 sticky (`top-14`)
- 카드 그리드: `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3`
- 섹션 간격: `space-y-6`

## 타이포그래피
폰트: `Inter` (Latin) + `Pretendard Variable` (한글).
**Fallback**: `system-ui, -apple-system, sans-serif`. Pretendard 로드 실패해도 레이아웃 깨지지 않아야 함.

| 용도 | 스타일 |
|------|--------|
| 페이지 제목 | `text-2xl font-semibold text-ink tracking-tight` |
| 히어로 카드 가격 | `text-3xl font-semibold text-ink tabular-nums` |
| 카드 가격 | `text-2xl font-semibold text-ink tabular-nums` |
| 카드 노선 | `text-sm font-medium text-ink-2` (`ICN → KIX`) |
| LLM 한 줄 | `text-xs text-ink-2 leading-snug` |
| 할인 근거 | `text-xs text-ink-3 tabular-nums` |
| 경과 시간·노선 빈도 | `text-[11px] text-ink-4` |
| 출처 태그 | `text-[11px] text-ink-4 uppercase` |

**숫자 규칙**: 가격·할인율·경과 시간·기준가 등 모든 숫자 `tabular-nums` 필수.

## 애니메이션
허용:
- fade-in on mount (`opacity 0 → 1`, 200ms)
- 카드 hover 배경 (120ms)
- 필터 변경 시 리스트 fade 교체 (150ms)
- 팝오버 등장 (fade + scale 95→100%, 120ms)
- 토스트 (slide-up from bottom, 150ms)

금지:
- bounce, spring, scale, rotate, 무한 반복 (skeleton pulse 제외)
- hover 시 translate / 기울기
- 첫 방문 "wow" 장식

## 아이콘
- `lucide-react` 사용. `strokeWidth={1.5}`, `size={14}` (카드), `size={16}` (FilterBar·헤더)
- 아이콘 단독 사용 금지. 항상 라벨 또는 `aria-label` 동반
- 아이콘 컨테이너(둥근 박스)로 감싸지 않음
- 카드당 아이콘 최대 2개 (공유 + 배지 옆 ?)

## 반응형
| 브레이크포인트 | 레이아웃 |
|----------------|----------|
| `< 640px` | 히어로 TOP 1만 크게, 2·3 간소화. 카드 1열. FilterBar → Drawer |
| `640 ~ 1024` | 히어로 TOP 3 1열(세로). 카드 2열 |
| `≥ 1280` | 히어로 TOP 3 3열. 카드 3열 |

**최소 너비 360px에서 가로 스크롤 발생 금지.**
- FilterBar가 공간 부족 시 drawer 자동 전환 (CSS container query 또는 JS 감지)
- 팝오버는 화면 경계 감지 후 상/하 방향 자동 선택

## 접근성

### 색 대비
- WCAG AA 이상
- `text-ink-3` on `#141414` = 4.5:1 (확보됨)
- `text-ink-4`은 보조 정보에만, 주요 조작엔 쓰지 않음

### 색에 의존하지 않는 신호
색맹 사용자 고려. 상태는 **색 + 패턴 + 텍스트** 세 신호 중 최소 둘 이상으로 전달한다.
| 상태 | 색 | 패턴 | 텍스트/아이콘 |
|------|---|------|--------------|
| 🔥 저점 | 에메랄드 | 🔥 이모지 | `-52%` 숫자 |
| 가격 변경 가능성 | 앰버 | 테두리만 앰버 | `!` 기호 + 텍스트 `가격 변경` |
| 원문 삭제 (snapshot) | 회색 | `opacity-50 grayscale italic` | 라벨 `원문 삭제됨` |
| 만료 임박 | 회색 | `line-through` | 경과 시간 강조 |
| 시세 카드 (딜과 구분) | 배경 톤 차이 | `border-dashed` | 라벨 `참고 시세` |
| 크롤러 헬스 | 에메랄드/회색/빨강 | 점 크기 동일 | `aria-label` 상태 병기 |

### 스파크라인 색 외 신호
- 현재 가격 점: 채워진 원 (크기 `r=2`), 색은 에메랄드
- 최고 구간: 선이 **두꺼워짐** (stroke 1px → 2px)
- 최저 구간: 선 색 + **점선 끊김** (dasharray로 강조)

### 포커스
```
focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400
focus-visible:outline-offset-2
```
- 절대 제거 금지
- 모든 인터랙티브 요소(a, button, input, select)에 자동 적용

### 키보드
- 카드는 `<a>` 태그로 구현 (Tab 순회)
- 순서: 헤더 로고 → FilterBar (왼→오른) → 히어로 TOP 3 → 일반 카드 (행 단위) → 푸터
- 배지 팝오버·스파크라인 툴팁: 포커스 받으면 hover와 동일하게 표시
- 단축키 `/` (검색, v2 대비) → `aria-keyshortcuts` 선언만 현재 주석

### 스크린리더 텍스트
- 🔥 저점 배지: `aria-label="저점 딜, 47% 할인"` (이모지 대체)
- 스파크라인: `aria-label="90일 가격 추이, 현재 최저 구간"`
- 공유 버튼: `aria-label="이 딜 공유하기"`
- 크롤러 헬스 점: `aria-label="뽐뿌 정상, 3분 전 수집"` 형태
- 가격: `aria-label="오사카행 왕복 13만 5천 원"` (텍스트 보조)

### 대체 텍스트 규칙
- 장식 이미지는 사용하지 않음 (현재 MVP 이미지 없음)
- 🔥 이모지는 항상 `aria-hidden="true"` 로 감싸고 텍스트 보조 병기

## 로딩·빈 상태·에러

### 로딩
- 카드와 동일 크기 skeleton (`bg-surface animate-pulse`)
- 히어로 skeleton은 TOP 3 카드 실루엣

### 빈 상태
- 히어로: 렌더 생략
- 리스트: `조건에 맞는 딜이 없어요. 필터를 완화해보세요.` + `필터 초기화` 텍스트 링크
- 일러스트·이모지 금지

### 에러
- 카드 자리에 `text-up` 한 줄. 경고 아이콘 금지
- 500 페이지: `잠시 후 다시 와주세요` 한 줄 + 로고
- 인증 실패(401): `접근 권한이 없습니다. 공유받은 링크를 다시 확인하세요.`

## 실시간 업데이트 UX
- `revalidate: 60` 캐시로 사실상 60초마다 자동 갱신
- 사용자가 보고 있는 동안 데이터 바뀌면 **깜빡임 금지**
- Next.js RSC 부분 리렌더가 자연스럽게 커버 — 별도 폴링·WebSocket 안 씀
- 카드 추가/삭제 시 `animate-fade-in` (200ms), 위치 이동 시 순간 교체 (애니메이션 안 함)

## 푸터
좁은 너비, 낮은 대비. 저작권·ToS 방어 고지가 들어가는 핵심 영역.
```
max-w-6xl mx-auto px-4 md:px-6 py-6 border-t border-line
text-[11px] text-ink-4 flex flex-wrap justify-between gap-4
```
- 왼쪽: `학습 프로젝트입니다. 구매·예약은 반드시 원본 출처 링크로 접속해주세요.`
- 가운데: `methodology.md · BACKLOG · GitHub` 링크 (외부 탭)
- 오른쪽: `<CrawlerHealth />`

## 스크린샷 친화성
친구 평가에서 스크린샷 피드백이 잦음. 한 카드가 256×256 정사각으로 잘려도 이해되게:
- 카드 내용은 제목·가격·배지가 우선 영역 (카드 상단 60%)
- 노선은 항상 첫 줄
- 🔥 배지는 가격 옆 또는 우상단 고정

## 용어 (UI 카피 규칙)
| ❌ 쓰지 않는 말 | ✅ 쓰는 말 |
|----------------|-----------|
| 역대가 | 🔥 저점 / 큰 폭 할인 |
| AI 추천 / AI 큐레이션 | 한 줄 맥락 |
| 진짜 싸요 / 대박 | N% 할인 |
| 놓치면 손해 | (금지) |
| 지금 예약하세요 | 원문에서 확인하기 |
| 오늘의 핫딜 | 오늘의 저점 |

---

## Cheapsky Light v5 새 컴포넌트 (2026-04-19)

v5 포팅 후 추가된 UI 단위. 모두 서버 우선, 사회적 신호·상태 라이브러리 금지 (ADR-007) 유지.

### Preset 칩 (FilterBar 상단)
사용자의 첫 방문 학습 비용 완화용 퀵 필터. `lib/presets.ts` 에 정의된 6개 고정 프리셋 + `+ 자세히 설정` 토글.

```
.preset — inline-flex, px-3 py-[7px], rounded-full, text-[12.5px]
         bg-surface, border border-line, text-ink-2
         hover: border-ink-2 text-ink
         [data-on="true"]: bg-ink text-white border-ink
.p-count — tabular-nums text-[11px] text-ink-4
```
- 프리셋은 "여러 필터 값을 한 번에 URL 에 set". 예: `일본 30만 이하` → `?region=JP&maxPrice=300000`
- 활성 상태는 URL 과 비교해 자동 감지
- 모바일에서 가로 스크롤

### Hero dual CTA
Hero 카드는 hover 시 두 버튼 reveal. list 카드는 기존 `<Link>` 래퍼 유지.
```
.card-ctas — opacity:0 + translateY(4px), reveal on .deal:hover/focus-within
.btn-primary — bg-ink text-white
.btn-ghost   — bg-surface text-ink-2, hover border-ink-2
@media (hover: none) { .card-ctas: always visible }
```
- primary: `원문 · {sourceLabel}` (PPOMPPU/RULIWEB/PLAYWINGS 중 첫 번째)
- ghost: `스카이스캐너 검색` — `lib/skyscanner-url.ts::buildSkyscannerSearchUrl`
- Hero 카드의 `<Link>` 래퍼를 `<article>` 로 해체. CTA 각각이 실 `<a>` / `<button>` 이어야 중첩 방지

### Counter 섹션 (지금은 기다려 보세요)
Hero 아래, Community Picks 위. 평소보다 비싼 노선 3개 강조.
```
.bad-card — bg-gradient-to-b from-white to-[#fdfafa]
            border border-line rounded-lg p-3
```
- `route_market_data` + 최근 관측 p50 대비 +10% 이상인 노선만 (최대 3개)
- chip `chip-up` + "↑ 상위 pN" / "↑ 성수기 진입" / "↑ N주 연속 상승"
- 데이터 없으면 섹션 전체 생략

### Timeline Feed (최근 24시간 딜 흐름)
Hero 아래 `lg:col-span-3` 카드. `crawler_runs + deals` 기반 최근 7건.
```
.tl-item — grid-cols-[58px_1fr_auto], border-b border-line
.tl-time — mono text-[10.5px] text-ink-4
pulse dot: w-1.5 h-1.5 rounded-full bg-low animate-pulse
```
- 이벤트 4종: `신규 게시글` (chip) / `가격 하락` (chip-low) / `첫 등장` (chip-low) / `가격 상승` (chip-up)
- 30초 간격 client revalidate (native fetch, 3회 실패 시 중단)
- 라이브 라벨: `● LIVE` (pulsing low dot)

### Month Timing Card (언제 사는 게 좋을까)
Timeline 옆 `lg:col-span-2`. 일본 노선 12개월 시즌 calendar.
```
.month-cell — aspect-square, border, rounded-md, padding 4px 6px
.month-cell.good — bg-low-soft border-low-line (m 텍스트 color low)
.month-cell.mid — bg-surface
.month-cell.bad — bg-up-soft border-up-line (m 텍스트 color up)
.month-cell.best::before — content:"★", top-right
```
- 12 셀 × `grid-cols-6`
- 시즌 라벨: 성수기·저점·저렴·보통·최고가
- 데이터 소스: `baseline_seed.json` 월별 FSC 평균

### Mobile Bottom Tab Bar
`@media (max-width:768px)` 에서만 `display:flex`.
```
.tabbar — fixed bottom, bg-white/95 backdrop-blur border-t border-line
.tab — flex-col items-center gap-[2px] py-[9px], text-[10px] text-ink-4
.tab[data-on="true"] — text-ink
main padding-bottom:80px
```
4탭: 홈 / 찜 / 알림 / 설정. 홈만 활성, 나머지는 coming-soon 페이지로.

### Toast
신규 딜 / 가격 변동 알림.
```
.toast — fixed left-1/2 translate-x-[-50%] bottom-[80px]
         bg-ink text-white text-[12.5px] px-[14px] py-[10px]
         rounded-[10px] shadow-[0_12px_30px_-10px_rgba(0,0,0,.4)]
         opacity:0 translate-y-[20px], .show: visible
```
- 5분 간격 client polling `/api/recent-deals?since=<lastSeenAt>`
- `후쿠오카가 방금 3,200원 더 내렸어요` + `보기 | 닫기`
- 6초 후 자동 소멸. `prefers-reduced-motion` 존중

### Saved Routes Strip (로컬 찜)
Hero 바로 아래. localStorage 기반 (사용자 인증 시스템 없음).
```
헤더: "찜한 노선 알림" + 서브 "저장한 N개 중 M개가 지금 저점이에요"
.saved-row — flex items-center gap-[10px] px-3 py-[10px]
  좌: flag + 도시명 + 조건 한 줄
  우: 현재가 + 조건 충족 여부 ("✓ 조건 충족" / "조건보다 -X% 낮음")
```
- DealCard 에 찜 하트 버튼 추가 (localStorage `cheapsky_saved_routes`)
- 서버 렌더 후 client hydration 에서 조건 충족 여부 계산

### Route Detail Modal
딜 카드 "상세 보기" 또는 MarketHeatmap 셀 클릭 시.
```
.modal-scrim — fixed inset-0 bg-black/45 backdrop-blur-[2px] z-90
.modal — w-[760px] max-w-[96vw] bg-surface border border-line-2 rounded-2xl
```
구성: 라이브 SVG 차트 (30/90/365일 토글) + 12개월 시즌 calendar mini + 최근 딜 로그 + CTA.

### Command Palette (⌘K)
```
.pal-scrim — fixed inset-0 bg-black/45 z-80 flex items-start justify-center pt-[10vh]
.pal — w-[560px] bg-surface rounded-2xl border border-line-2
.pal-input — w-full p-[14px_16px] text-[14px] border-b border-line
.pal-item — flex gap-[10px] px-[16px] py-[10px] text-[13px]
           [data-hover="true"]: bg-surface-2
```
- `cmd/ctrl+k` 로 오픈
- 20 목적지 + 6 프리셋 검색
- ↑↓ Enter 네비게이션

### Compare Drawer
```
.compare-drawer — fixed right-0 top-0 bottom-0 w-[380px] bg-surface
                  border-l border-line-2 translate-x-full transition
.compare-drawer.open — translate-x-0
```
선택된 노선들(최대 4) 나란히 비교. Tweaks 에서 on/off.

### Tweaks 플로팅 패널 (dev)
우하단 floating 버튼 → `.tw-panel` 토글. accent 색 / density / CTA 모드 / verdict 모드 / traveler lens / heatmap 토글. localStorage 저장.
```
.tw-btn — fixed bottom-[76px] right-[16px] z-55
.tw-panel — w-[290px] bg-surface rounded-xl border border-line-2 shadow-lg
```
**Dev-only** (NODE_ENV !== 'production' 에서만 렌더). 프로덕션 빌드에서는 트리 셰이크.

### i18n Toggle
Tweaks 패널 내 언어 selector. 지원: `ko` (기본) / `ja` / `en`. 상수 string table 은 `lib/i18n.ts` 에.
- 적용 범위: 섹션 헤더·서브라벨·고지문·chip 텍스트
- Server 기본 언어는 `accept-language` 헤더 기반. 사용자 선택은 cookie `cheapsky_lang=...` 저장
- 번역 분기: `t(key, lang)` 한 함수

## 다크 테마 (Deprecated 2026-04-19)
Cheapsky v1~v4 에서 사용한 `bg-[#0a0a0a]` + emerald accent 다크 대시보드 팔레트는 **Cheapsky Light v5 포팅과 함께 Deprecated**. 새 컴포넌트는 light 만 지원. 다크 재도입 필요 시 신규 ADR 승인 후에만.
