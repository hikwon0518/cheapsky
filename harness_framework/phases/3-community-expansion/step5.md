# Step 5: naver-blog-conditional (선택, 타임박스)

**전제**:
- step4 완료 후 착수
- **각 블로거별 ADR-025 절차 재적용 필수** (RSS 탐색 → 메일 통보 → 10 영업일 대기)
- 응답 동의 받은 블로거만 구현. 미응답/거절 → skip

## 읽어야 할 파일

- `docs/ADR.md` — **ADR-025** (플레이윙즈 동의 절차 — 재사용 템플릿), **ADR-030** (블로거 후보 지정)
- 이전 구현:
  - `app/src/services/crawlers/playwings.ts` (블로거 크롤러 패턴)
  - `app/src/services/parser/llm.ts` (Stretch 2 — 제목·본문 500자에서 구조화 추출)
- 신규 산출물:
  - `docs/community_consent_log.md` (step4 신규)

## 작업 흐름

### 1) 후보 블로거 RSS 탐색 (step0 리스트 재사용)

각 블로거별:
- RSS 피드 URL 시도 (`/rss`, `/feed`, 네이버 블로그 `rss.xml`)
- 있음 → ADR-025 상 "크롤링 아님" 으로 판정. 절차 간소화 — 통보 메일만 보내고 즉시 진행 허용 (ADR-025 3-1)
- 없음 → 아래 2) 로

### 2) 메일 통보 (미응답 10 영업일 대기)

ADR-025 템플릿 그대로. 블로거 연락처 (About/Contact) 확인 후 발송.
`community_consent_log.md` 에 송부 시각 · 블로거 · 연락처 · 응답 상태 기록.

**타임박스**: 10 영업일 내 동의 응답 없으면 **해당 블로거만 skip**, 다음 블로거로. 전체 skip 이어도 step5 완료 처리.

### 3) 구현 (동의 받은 블로거 한정)

`app/src/services/crawlers/naver_blog.ts`:
- RSS 소비 우선 (그 경우 파싱 간단)
- HTML 크롤 시 ADR-008 동일 규칙 (UA v0.2, ≥1초 간격, 작성자 정보 제외)
- **LLM 기반 제목 추출** (Stretch 2 curator 재활용):
  - 블로그 글 제목이 딜 제목보다 narrative 한 경우 多 → `parser/llm.ts` 의 "제목 + 앞 500자 → 구조화 필드" 기존 파이프라인 재사용
  - `CHEAPSKY_STAGE=stretch` 아닐 때는 해당 블로거 건들지 않음 (Core 규칙 준수)
- `source='naver_blog'` (blogger 구분은 `source_urls` URL 호스트 경로로)

### 4) `scripts/crawl.ts` 통합

```ts
// CHEAPSKY_STAGE=stretch 에서만 활성화
if (isStretchStage()) {
  sources.push({
    name: 'naver_blog',
    crawler: () => crawlNaverBlog({ bloggers: APPROVED_BLOGGERS, maxPerBlogger: 2 }),
    timeoutMs: 120_000,
  });
}
```

### 5) 문서 · 테스트

- `community_consent_log.md` 에 동의 블로거 목록 및 경계 조건 기록
- fixture 테스트 ≥ 6 케이스 (RSS · HTML · LLM 폴백 각 2건)
- CrawlerHealth 에 `naver_blog` 점 추가 (없으면 off)

## Acceptance Criteria

**동의 받은 블로거 ≥ 1명 + 구현 완료:**
```bash
cd app
CHEAPSKY_STAGE=stretch pnpm tsx scripts/crawl.ts 2>&1 | grep naver_blog
pnpm test src/services/crawlers/naver_blog.test.ts
```

**전부 skip (동의 0명):**
- `community_consent_log.md` 에 skip 사유 기록
- step5 를 `completed_with_skip` 상태로 표기하고 phase 종료
- BACKLOG 에 "네이버 블로거 재접촉" 항목 추가

## 금지사항

- **ADR-025 절차 건너뛰기 절대 금지** — 동의 없이 크롤 시작하면 legal risk
- **블로거 본문 전문 저장 금지** (ADR-008) — 7일 TTL · 제목/가격/링크만 영구
- **다수 블로거 대량 팬아웃 금지** — 개인 실사용 맥락, 블로거 최대 3명 · 하루 30 요청 상한
- **블로거 간 점수 비교 UI 금지** — 개별 블로거 강약 노출은 관계 훼손
