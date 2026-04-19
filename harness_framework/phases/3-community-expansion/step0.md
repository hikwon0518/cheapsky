# Step 0: preflight-tos-fixtures

## 읽어야 할 파일

- `docs/ADR.md` — **ADR-030** (커뮤니티 소스 확장), **ADR-008** (저작권·ToS 방어), **ADR-025** (플레이윙즈 동의 절차 — 재사용 템플릿)
- `docs/ADR.md` — **ADR-022 Rejected** (Phase 3 슬롯 재할당 근거)
- 이전 crawler 참조:
  - `app/src/services/crawlers/ppomppu.ts` (Core 완료)
  - `app/src/services/crawlers/ruliweb.ts` (Stretch 1 완료)
  - `app/src/services/crawlers/playwings.ts` (Stretch 1 완료)
  - `app/__fixtures__/` 기존 fixture 구조

## 작업

앱 루트는 `cheapsky/app/`. 이 step 은 **코드 생성 전 점검 + 차단 결정 단계**. 각 신규 소스에 대해 다음 체크리스트를 통과해야만 다음 step 진입.

### 1) 클리앙 `/service/board/jirum` (알뜰구매 게시판)

- [ ] `clien.net/robots.txt` 확인 — `/service/board/jirum` 경로 `Allow`/`Disallow` 여부
- [ ] 이용약관·공지사항 페이지에서 "자동화 수집 금지" 명시 여부 확인 (있으면 **즉시 drop**)
- [ ] rate limit 흔적 (분당 요청 제한 공지 등) 확인 — 없으면 ADR-008 기본 (≥1초 간격, 동시성 1) 적용
- [ ] 항공권 태그 URL 구조 조사 (예: `?od=T31` 같은 카테고리 필터 파라미터)
- [ ] fixture 수집: 리스트 페이지 HTML 저장 → `app/__fixtures__/clien-list.html` (개인정보·닉네임 수동 redact)

### 2) 디시인사이드 항공권 갤러리

- [ ] `gall.dcinside.com/robots.txt` 확인 — `/mgallery/board/lists/?id=airplane_new2` 허용 여부
- [ ] 갤러리 이용약관 "봇 수집 금지" 명시 여부 (있으면 drop)
- [ ] rate limit / IP 차단 기준 조사 (디시는 차단 공격적인 편)
- [ ] fixture 수집: `app/__fixtures__/dcinside-list.html`
- [ ] 노이즈 샘플 10건 별도 수집 → 엄격 파서 테스트 케이스용 (개드립/오타/offtopic 제외 규칙 수립)

### 3) (선택) 네이버 블로그 큐레이터 — step5 조건부

step5 에서 각 블로거별 ADR-025 절차 재적용 예정이므로 이 step 에서는 **후보 블로거 목록만 작성**:
- 어미새 · 트래블위즈 · 트립월드 등 (현재 운영 중 + 한국 출발 딜 정기 포스팅 3개월 이상)
- RSS 피드 존재 여부 prescan

### 4) UA 상수 업데이트

`app/src/services/crawlers/ua.ts` (또는 각 crawler 파일 상수) 의
```
Cheapsky/0.1 (학습 프로젝트, +mailto:<연락처>)
```
→
```
Cheapsky/0.2 (학습+개인 실사용 프로젝트, +mailto:<연락처>)
```

이유: ADR-030 frame extension 반영. 투명성 유지.

### 5) 차단 소스 결정 로그

점검 결과를 이 step 의 `step0-output.json` 에 기록:

```json
{
  "clien": { "passed": true/false, "reason": "...", "robots_ok": ..., "tos_ok": ..., "fixture_path": "..." },
  "dcinside": { "passed": true/false, "reason": "..." },
  "naver_bloggers_candidates": ["어미새", "트래블위즈"]
}
```

**`passed: false` 소스는 ADR-030 Rollback 조건에 따라 해당 소스만 영구 제외 + BACKLOG 에 기록. phase 는 나머지 소스로 계속 진행.**

## 금지사항

- **이 step 에서 크롤러 코드 생성 금지.** 점검 · fixture · 결정만.
- **실 요청 루프 금지.** 수동 1회 fetch 로 robots.txt / fixture 확보.
- **닉네임/아이디 fixture 저장 금지** (ADR-008). 수동 redact 또는 수집 시 CSS selector 로 제외.

## Acceptance Criteria

```bash
ls app/__fixtures__/clien-list.html
ls app/__fixtures__/dcinside-list.html
cat harness_framework/phases/3-community-expansion/step0-output.json  # passed 필드 true/false 명시
git grep 'Cheapsky/0.2' app/src/services/crawlers/    # UA 갱신 반영
```

- 최소 1개 소스는 `passed: true` (전부 drop 되면 phase 전체 보류 → BACKLOG 로 되돌림)
- 각 `passed: false` 는 BACKLOG.md `🟥 Rejected` 섹션에 한 줄 추가 (사유 명시)
