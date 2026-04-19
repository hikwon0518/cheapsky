# OPERATIONS

> 이 문서의 한 줄 요지: Cheapsky 운영 중 발생할 수 있는 장애 타입 · 주기 작업 · Supabase/Vercel/Share Token 대응 절차 · 자주 쓰는 SQL 스니펫을 모은 런북. `../../harness_framework/docs/ARCHITECTURE.md` 의 "장애·복구" 표를 실행 가능한 단계로 구체화한 버전.

## 0. 스냅샷 · 핵심 연결 고리

- **DB**: Supabase Postgres (500MB free) · anon read · service_role write
- **웹**: Vercel Hobby · `runtime=nodejs` middleware (ADR-019 Share Token + Basic Auth)
- **배치**: GitHub Actions cron (`cheapsky/.github/workflows/*.yml`) — Public repo 전제 (ADR-002)
- **LLM**: Anthropic Claude Haiku 4.5 (Stretch 2 한정, `CHEAPSKY_STAGE=stretch` gate)
- **시세 API**: **없음** (ADR-022 Deprecated). Stretch 3 진입 조건부 부활
- **상시 관측**: `crawler_runs` · `deal_verifications` · `api_usage_daily` · `/api/health`

모든 시각은 저장 UTC / 표시 KST (ADR-015).

---

## 1. 주기 작업 타임라인

| 작업 | 스크립트 | cron (UTC) | KST | 워크플로우 | Stage 요구 |
|------|----------|:----------:|:---:|------------|:----------:|
| crawl | `scripts/crawl.ts` | `*/15 * * * *` | 매 15분 | `crawl.yml` | — (Stretch 면 LLM 폴백 활성) |
| verify | `scripts/verify.ts` | `0 */3 * * *` | 매 3시간 | `verify.yml` | — (Stretch 면 GET+패턴) |
| cost_check | `scripts/cost_check.ts` | `0 0 * * *` | 매일 09:00 | `cost_check.yml` | — |
| curate | `scripts/curate.ts` | `30 * * * *` | 매 정시 30분 | `curate.yml` | **stretch 필수** |
| archive | `scripts/archive_daily.ts` | `5 15 * * *` | 매일 00:05 | `archive_daily.yml` | — |

운영 관찰 포인트:

- `crawler_runs.source` 별 최근 성공 시각은 `/api/health` JSON 과 푸터 `<CrawlerHealth/>` 로 노출
- 배치가 15분 이상 성공 없이 흐르면 푸터 점이 회색, 2시간+ 면 빨강
- Curator 는 Stretch 2 에만 활성. Core workflow 에 `CHEAPSKY_STAGE=stretch` 설정 금지 (ADR-005)

---

## 2. 장애 타입별 대응

### 2.1 크롤러 1개 실패 (뽐뿌/루리웹/플레이윙즈)

**증상**: `crawler_runs` 의 특정 `source` 가 `success=false` 또는 `finished_at IS NULL`. 푸터 점 회색/빨강.

**대응**:
1. GitHub Actions `crawl.yml` 최신 런 로그 확인. 500 / 403 / 타임아웃 / 파싱 exception 중 분류
2. 403 차단 감지 시 UA (`CRAWLER_USER_AGENT`) 와 간격 `>=1s` 실수 여부 재확인 (ADR-008)
3. HTML 레이아웃 변경 의심 시 `__fixtures__/<source>-list-YYYY-MM-DD.html` 캡처 추가 → 파서 테스트 골든셋 업데이트
4. 다음 cron 에서 UPSERT 멱등으로 자동 복구. 수동 재실행은 `gh workflow run crawl.yml`
5. 2시간+ 회복 실패 시 Rollback 조건(ADR-004): 해당 source 비활성화 (env `DISABLE_<SOURCE>=true` 또는 `services/crawlers/<source>.ts` import 주석 처리 → 긴급 PR)

### 2.2 크롤러 전체 2h+ 실패

**증상**: 모든 source `crawler_runs.started_at > now()-2h` 에서 `success=true` 없음.

**대응**:
1. `StaleBanner` 자동 표시 확인 (`최근 수집이 지연되고 있어요...`). 사용자 고지는 OK
2. Supabase/Vercel/GitHub 상태 페이지 확인 (일반 인프라 장애 vs 우리쪽 코드 버그 구분)
3. 5분 이내 복구 예상 → 대기. 그 이상 → `SHOW_CACHED_ONLY=true` 시연용 스위치 (§2.7)
4. 코드 버그가 원인이면 직전 배포 **Vercel rollback**으로 되돌리고 원인 조사는 별도 브랜치 (§3)

### 2.3 관측 오염 (허위 가격 반복 UPSERT)

**증상**: 특정 노선 `price_observations` 가 급격히 낮아져 `baseline_krw` 가 하락. 🔥 배지 비율 > 30% (ADR-006 Rollback 조건).

**대응**:
1. 오염 감지 쿼리 실행 (§5 SQL 스니펫 #1)
2. 오염 원인 파악:
   - 파싱 버그 → 골든셋 회귀, 수정 PR
   - 특정 게시자의 반복 허위 게시 → sourceId 기반 필터
3. **시드 단독 강제 스위치** — 해당 노선의 `route_market_data(source='observed')` 행 삭제 → `baseline.ts` 가 ADR-011 우선순위에 따라 자동으로 `seed` 로 폴백 (§5 SQL #2)
4. 오염 `price_observations` 행 삭제는 보수적으로. 지우기 전에 `SELECT` 로 영향 범위 먼저 확인

### 2.4 LLM 장애 (Stretch 2)

**증상**: `curate.yml` 연속 실패 · 429 반복 · Anthropic API 지연. `api_usage_daily.anthropic_tokens_*` 미증가 또는 `crawler_runs.errors` 에 Anthropic 에러 누적.

**대응**:
1. 시스템 자동 폴백 동작 확인:
   - `services/parser/llm.ts` — 1회 백오프 → 빈 draft → 해당 게시글 규칙 파싱만 남음
   - `services/curator.ts` — `text=null` → UI 는 규칙 기반 한 줄 그대로 표시 (100% 커버율 유지)
2. `cost_check` 가 월 예산 80% 도달 알림을 보냈다면 `LLM_DAILY_BUDGET` env 를 낮춰 추가 발신 방지
3. API 키 rotate 가 필요한 경우: GH Actions Secrets 만 갱신 (Vercel 에는 Anthropic 키를 두지 않는다)
4. 완전 차단하고 싶다면 `.github/workflows/curate.yml` 의 `CHEAPSKY_STAGE` 환경변수를 주석 처리 → 스크립트가 stage gate 로 즉시 종료하고 `crawler_runs.errors` 에 "stage gate" 사유 기록

### 2.5 Supabase 장애

**증상**: 페이지가 500 또는 빈 리스트. `/api/health` 가 타임아웃.

**대응**:
1. Supabase status 페이지 확인. 일시 장애면 Vercel `revalidate: 60` 캐시로 1~2분 버티고 자동 회복
2. 2분+ 지속 시 사용자 고지: 배너 아닌 에러 페이지 (`잠시 후 다시 와주세요`)
3. RLS 정책 실수로 쓰기 실패 시 `SUPABASE_SERVICE_ROLE_KEY` 환경 변수 누락이 가장 흔함 — GH Actions Secrets 재확인
4. 500MB 한도 도달 시 §4 참조

### 2.6 원문 링크 대량 깨짐

**증상**: `deal_verifications.status='snapshot'` 비율 급증. 대시보드에 `원문 삭제됨` 카드가 다수.

**대응**:
1. 단일 source 에 국한되는지 쿼리 (§5 SQL #3)
2. 단일 source 라면 커뮤니티가 일괄 삭제 정책 변경 가능성 → 해당 source 관리자 문의
3. 전체에 걸쳐 있으면 `services/verifier.ts` 버그 의심 (예: HEAD 허용 안 하는 사이트). Stretch GET 폴백으로 전환해 비교
4. `verification_fail_count >= 3` 은 이미 조기 만료로 처리됨. 임계값 조정은 `scripts/verify.ts` 의 `FAIL_THRESHOLD` 수정 후 PR

### 2.7 시연 당일 전면 장애 — `SHOW_CACHED_ONLY=true` 절차

**증상**: 시연 30분 전 외부 요소(Supabase/뽐뿌/Anthropic) 중 하나 이상 장애.

**대응 (5분 이내 실행)**:
1. Vercel Dashboard → Project → Settings → Environment Variables → `SHOW_CACHED_ONLY=true` 추가 (Production)
2. Vercel → Deployments → 최근 프로덕션 배포에서 **Redeploy** (env 변경 반영)
3. UI 상단에 `🔒 캐시 모드` 배너 표시 확인 (`CacheOnlyBanner`)
4. **배치 cron 은 건드리지 않음** (ADR-028). GH Actions 는 계속 돌면서 복구 시 자동 갱신
5. 복구 후 정상화: Vercel env 에서 `SHOW_CACHED_ONLY` 삭제 → Redeploy

금지: GH Actions Secrets 에 같은 env 를 주입해 배치를 멈추지 말 것 (ADR-028 의 "UI 전용" 결정 위반).

---

## 3. Vercel 배포 · 롤백 절차

### 배포
- `main` 브랜치 push → Vercel 이 자동 빌드 → Preview URL 생성 후 Production promote
- `CHEAPSKY_STAGE` 는 Vercel 에 주입하지 않는다 (Core 렌더링에 영향 없음)

### 롤백 (1분 이내)
1. Vercel Dashboard → Project → Deployments
2. 직전 Production 배포 찾기 → 우측 `...` → **Promote to Production**
3. 30초 이내 CDN 전파. `CacheOnlyBanner` 가 필요하면 병행 (§2.7)

### 핫픽스
- 급한 수정은 `main` 으로 직접 PR → Vercel Preview 에서 동작 확인 후 squash merge
- DB 스키마 변경은 반드시 PR + 수동 `psql -f scripts/migrate.sql` 리뷰 후 실행 (자동 실행 금지)

---

## 4. Supabase 500MB 한도 대응

**관측**: `cost_check.ts` 가 매일 09:00 KST `api_usage_daily.supabase_rows_total` 를 읽고 80% 도달 시 Discord webhook 알림.

**단계별 조치**:

### 4.1 본문 TTL 청소 (ADR-008 7일)
```sql
-- 7일 지난 body 를 NULL 로 (제목·가격·링크·메타는 유지)
UPDATE deals
   SET body = NULL
 WHERE body IS NOT NULL
   AND body_expires_at < now();
```
크롤 파이프라인이 `body_expires_at` 를 자동 설정하므로 이 쿼리는 **감시용**. 실제로는 이미 NULL 처리된 상태여야 한다.

### 4.2 오래된 observation 집계 · 삭제
```sql
-- 180일 이상 된 price_observations 를 월별 집계로 축소 (관측 과도 보존 방지)
-- 실행 전 반드시 COUNT 로 영향도 확인
SELECT date_trunc('month', observed_at) AS month, COUNT(*)
  FROM price_observations
 WHERE observed_at < now() - interval '180 days'
 GROUP BY 1 ORDER BY 1;

-- 집계가 백업되었다면 삭제
DELETE FROM price_observations
 WHERE observed_at < now() - interval '180 days';
```
관측이 분위수 계산의 1차 소스이므로 함부로 자르지 말 것. 180일 이후부터가 안전 커트라인.

### 4.3 만료 딜 정리 (신중)
```sql
-- 30일 이상 만료된 딜 제거. archive_snapshots 에서 참조되는 deal_ids 는 보존
DELETE FROM deals d
 WHERE d.expires_at < now() - interval '30 days'
   AND NOT EXISTS (
     SELECT 1 FROM archive_snapshots a
      WHERE d.id = ANY(a.deal_ids)
   );
```

### 4.4 테이블 VACUUM
```sql
VACUUM (VERBOSE, ANALYZE) deals;
VACUUM (VERBOSE, ANALYZE) price_observations;
VACUUM (VERBOSE, ANALYZE) crawler_runs;
```
Supabase Free 는 autovacuum 이 돌지만 수동 실행이 유효함. `VACUUM FULL` 은 락이 걸려 위험 — 쓰지 말 것.

---

## 5. 자주 쓰는 SQL 스니펫

### SQL #1 — 관측 오염 감지
```sql
-- 최근 7일 관측 최저가가 직전 30일 p10 대비 50% 아래로 떨어진 노선
WITH base AS (
  SELECT origin, destination, carrier_class, p10_krw
    FROM route_market_data
   WHERE source IN ('observed', 'seed')
),
recent AS (
  SELECT origin, destination, carrier_class,
         MIN(price_krw) AS recent_min_krw,
         COUNT(*) AS recent_n
    FROM price_observations
   WHERE observed_at >= now() - interval '7 days'
   GROUP BY origin, destination, carrier_class
)
SELECT r.*, b.p10_krw,
       round(100.0 * (1 - r.recent_min_krw::numeric / b.p10_krw), 1) AS drop_pct
  FROM recent r
  JOIN base b USING (origin, destination, carrier_class)
 WHERE r.recent_min_krw < b.p10_krw * 0.5
 ORDER BY drop_pct DESC;
```

### SQL #2 — 특정 노선 시드 단독 강제 (관측 오염 대응)
```sql
-- 주의: 해당 노선의 observed 집계를 제거해 baseline.ts 가 seed 로 폴백하게 한다.
-- 관측 자체(price_observations)는 보존. 언제든 재집계하면 복구 가능.
DELETE FROM route_market_data
 WHERE source = 'observed'
   AND origin = 'ICN'
   AND destination = 'KIX';
-- carrier_class 범위는 (fsc, lcc, mixed) 전부. 필요 시 WHERE carrier_class = 'lcc' 추가.
```

### SQL #3 — 원문 링크 깨짐 분포
```sql
-- 최근 24시간 source 별 snapshot 비율
SELECT unnest(sources) AS src,
       verification_status,
       COUNT(*) AS n
  FROM deals
 WHERE verified_at >= now() - interval '24 hours'
 GROUP BY 1, 2
 ORDER BY 1, 3 DESC;
```

### SQL #4 — 특정 노선 드롭 (ADR-021 Rollback)
```sql
-- 30일 수집 0건 노선 탐지
SELECT origin, destination, COUNT(*) AS n
  FROM deals
 WHERE posted_at >= now() - interval '30 days'
 GROUP BY 1, 2
 ORDER BY n;
-- n=0 노선은 코드 레벨에서 HEATMAP_DESTINATIONS 제거 검토
```

### SQL #5 — 본문 TTL 청소 (확인용)
```sql
SELECT COUNT(*) FROM deals
 WHERE body IS NOT NULL AND body_expires_at < now();
-- 0 이 정상. 0 이 아니면 파이프라인에서 body_expires_at 설정 누락 의심.
```

### SQL #6 — api_usage_daily 관찰
```sql
SELECT date,
       anthropic_tokens_in, anthropic_tokens_out,
       supabase_rows_total
  FROM api_usage_daily
 WHERE date >= date_trunc('month', current_date AT TIME ZONE 'Asia/Seoul')
 ORDER BY date DESC;
```

### SQL #7 — Hot deal 수 · 평균 할인율 (확인)
```sql
SELECT COUNT(*) FILTER (WHERE hot_deal) AS hot_n,
       COUNT(*) AS total_active,
       round(avg(discount_rate) FILTER (WHERE hot_deal) * 100, 1) AS avg_hot_pct
  FROM deals
 WHERE expires_at > now()
   AND verification_status != 'snapshot';
```

### SQL #8 — archive_snapshots 확인 (멱등 검증)
```sql
SELECT date, cardinality(deal_ids) AS n, captured_at
  FROM archive_snapshots
 ORDER BY date DESC LIMIT 14;
```

---

## 6. Share Token 유출 대응

**증상**: 친구 외 접속 로그 발견, 토큰이 외부 채널(Slack · Notion 등)에 유출 의심.

**1~3분 절차**:
1. Vercel Dashboard → Project → Environment Variables → `SHARE_TOKENS` 에서 해당 토큰 **삭제**
2. 남아 있는 정상 토큰 중 하나로 대체 URL 생성 → 친구에게 재공유
3. Redeploy (env 변경 반영)
4. 이상 트래픽을 막아야 한다면 `ShareButton` 컴포넌트 주석 처리 + PR — 복사 버튼이 동작하는 동안 2차 전파가 계속될 수 있기 때문

**정기 관리**:
- 평가 기간 종료 시점에 `SHARE_TOKENS` 를 빈 값으로 설정 → Basic Auth 만 남음
- 토큰은 최소 12자 랜덤 (`openssl rand -hex 12` 수준)
- commit 금지, Slack · Notion · 이메일 본문에 평문 전송 금지

---

## 7. ADR-025 플레이윙즈 이의 제기 대응 (Stretch 1)

**증상**: 블로그 운영자에게서 이메일 · 댓글 · 다이렉트 메시지로 크롤링 중단 요청.

**24시간 이내 체크리스트**:
1. [ ] `.github/workflows/crawl.yml` 에서 `PLAYWINGS_ENABLED=false` 또는 해당 스텝 주석 처리 후 push
2. [ ] `services/crawlers/playwings.ts` import 를 `scripts/crawl.ts` 에서 제거 (PR)
3. [ ] 저장된 본문 삭제:
   ```sql
   UPDATE deals SET body = NULL WHERE 'playwings' = ANY(sources);
   ```
4. [ ] 딜 카드에서 `playwings` sources 제거 또는 Rollback:
   ```sql
   UPDATE deals
      SET sources = array_remove(sources, 'playwings'),
          source_urls = (SELECT array_agg(u) FROM unnest(source_urls) u
                          WHERE u NOT LIKE '%playwings.kr%')
    WHERE 'playwings' = ANY(sources);
   -- sources 가 빈 배열이 되는 딜은 expires_at = now() 로 즉시 만료
   UPDATE deals SET expires_at = now() WHERE sources = '{}';
   ```
5. [ ] 요청자에게 조치 완료 회신 (조치 내용·시각 명시)
6. [ ] `BACKLOG.md` 🟥 Rejected 섹션에 기록 ("플레이윙즈 — 운영자 요청으로 영구 제외 YYYY-MM-DD")

이의 제기가 일부 제한(일 N회) 인 경우는 요청 내용에 맞춰 `services/crawlers/playwings.ts` 의 요청 간격만 상향 후 유지 가능. 하지만 불확실할 땐 일단 중단 후 협의.

---

## 8. 헬스 대시보드

### `/api/health` JSON
```json
{
  "sources": {
    "ppomppu":  { "last_success_at": "...", "ok": true },
    "ruliweb":  { ... },
    "playwings": { ... }
  },
  "curator":   { "last_success_at": "...", "ok": true },
  "verifier":  { "last_success_at": "...", "ok": true },
  "archiver":  { "last_success_at": "...", "ok": true }
}
```

### 푸터 `<CrawlerHealth/>` 점 색
| 색 | 의미 | 기준 |
|----|------|------|
| `bg-emerald-500` | 정상 | 최근 성공 ≤ 30분 |
| `bg-neutral-600` | 지연 | 30분~2시간 |
| `bg-red-500` | 실패 | 2시간+ 또는 최근 run 이 `success=false` |

각 점에는 `aria-label="<source> 정상, <time> 전 수집"` 형태 텍스트가 붙는다.

---

## 9. 체크리스트 — 시연 전날

- [ ] 크롤러·verifier 최근 24h 내 각 1회 이상 성공 (`/api/health`)
- [ ] `archive_snapshots` 최근 날짜 존재 (`SELECT MAX(date) FROM archive_snapshots;`)
- [ ] Share Token 3개 유효 (`friend`, `backup`, `debug`)
- [ ] `noindex` 헤더 응답 (`curl -I https://... | grep X-Robots-Tag`)
- [ ] 푸터 `학습 프로젝트...` 고지 렌더
- [ ] `SHOW_CACHED_ONLY` Vercel env = `false` 또는 unset
- [ ] Supabase 용량 80% 미만
- [ ] Stretch 2 운영 시 `api_usage_daily` 의 월 누적 anthropic 토큰 확인

---

## 10. 참고

- 결정·히스토리: `../../harness_framework/docs/ADR.md`
- 구조·데이터 모델: `../../harness_framework/docs/ARCHITECTURE.md`
- 용어: `GLOSSARY.md`
- 프롬프트: `LLM_PROMPTS.md`
