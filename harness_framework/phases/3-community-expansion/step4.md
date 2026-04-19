# Step 4: crawler-health-ui-docs

## 읽어야 할 파일

- `app/src/components/CrawlerHealth.tsx` (기존 3-source 구조)
- `app/src/services/home-queries.ts` — `loadCrawlerHealth`
- `app/scripts/migrate.sql` · `app/scripts/migrations/` (기존 `crawler_runs.source` CHECK 제약)
- `app/docs/OPERATIONS.md` — 주기 작업 타임라인 표
- `app/docs/GLOSSARY.md` — ③ 사회적 증거 섹션 (뽐뿌/루리웹 정의)
- `harness_framework/docs/ADR.md` — ADR-030 (의존 지도)

## 작업

### 1) DB 스키마: `crawler_runs.source` CHECK 제약 확장

`app/scripts/migrations/20260419c_crawler_sources_extension.sql` (신규):

```sql
-- 2026-04-19c Phase 3 커뮤니티 확장 소스 허용
-- ADR-030 (3-community-expansion) 기반. clien · dcinside 추가.

alter table crawler_runs
  drop constraint if exists crawler_runs_source_check;

alter table crawler_runs
  add constraint crawler_runs_source_check
  check (source in (
    'ppomppu','ruliweb','playwings',
    'clien','dcinside','naver_blog',
    'curator','verifier','archiver','cost_check'
  ));
```

기존 `app/scripts/migrate.sql` 의 table def 에도 같은 check 반영 (신규 배포용).

### 2) `CrawlerHealth` 컴포넌트 5점 렌더

`app/src/components/CrawlerHealth.tsx`:
- 기존 3개 점(ppomppu/ruliweb/playwings) → 5개 점 (clien · dcinside 추가)
- 각 점 color: `active` (최근 실행 성공) · `warn` (6h 이내 실패) · `off` (24h+ 미실행)
- `aria-label` 각 소스명 병기 (접근성)
- 다시 말해 기존 패턴 그대로 소스 2개 추가

### 3) `loadCrawlerHealth` 확장

`app/src/services/home-queries.ts`:
- 쿼리 단순 — `crawler_runs` 최근 24h groupby source 에서 `active|warn|off` 계산
- `clien`, `dcinside` 미실행 상태면 `off` 반환 (신규 소스 drop 시 자연스럽게 off 표시)

### 4) 문서 동기화

- **`app/README.md`**: 주요 기능 리스트에 "Phase 3 소스 확장 (클리앙 · 디시)" 추가. 기존 `뽐뿌 · 루리웹 · 플레이윙즈` 문구를 `+클리앙 · 디시` 로 확장. "384 tests" 숫자는 실제 테스트 수로 갱신
- **`app/docs/OPERATIONS.md`**: 주기 작업 표에 clien · dcinside 엔트리 추가 (cron 동일 crawl.yml 매 15분). `## 3. 소스별 대응` 섹션 확장
- **`app/docs/GLOSSARY.md`**: ④ 커뮤니티 확장 섹션 신규 (Phase 3). 클리앙 · 디시 · (조건부) 네이버 블로그 정의
- **`harness_framework/docs/ADR.md`**: ADR-030 구현 완료 표기 (선택). 의존 지도는 이미 ADR 업데이트 시 반영됨

### 5) ADR-025 재적용 여부 플래그

네이버 블로그 (step5 조건부) 는 각 블로거별 ADR-025 절차 진행 상태를 추적해야 함:
- `docs/community_consent_log.md` 신규 — 블로거별 RSS 탐색 / 메일 통보 / 응답 상태 타임라인. step5 에서 사용

## Acceptance Criteria

```bash
cd app
pnpm typecheck && pnpm lint && pnpm test
psql "$SUPABASE_DB_URL" -f scripts/migrations/20260419c_crawler_sources_extension.sql
pnpm dev    # 브라우저에서 푸터에 CrawlerHealth 5점 확인
# 스모크: 크롤러 실행 안 된 상태 → clien/dcinside 'off' 색
pnpm tsx scripts/crawl.ts   # clien/dcinside crawler_runs 기록 → active 색 전환 확인
```

- CrawlerHealth 가 5점 표시
- README · OPERATIONS · GLOSSARY 동기화 — 3곳 기존 표현이 남아있지 않은지 grep
- 신규 migration 파일 존재

## 금지사항

- **기존 `20260419_*.sql` migration 파일 수정 금지.** 모든 변경은 새 migration 으로 (ed55a13 / 0184f13 방식 일관)
- **CrawlerHealth 에 조회수 등 정량 수치 노출 금지** (ADR-008). 이진 active/warn/off 만
