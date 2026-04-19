# Step 2: dcinside-crawler

**전제**: `step0-output.json` 에서 `dcinside.passed == true` 인 경우에만 실행.

## 읽어야 할 파일

- `docs/ADR.md` — **ADR-030** (커뮤니티 확장, 디시 엄격 파서 메모), **ADR-008**
- 이전 step 산출물:
  - `app/src/services/crawlers/clien.ts` (step1 패턴 재사용)
  - `app/src/services/parser/rules.ts` + `llm.ts` (Stretch 2 LLM 폴백 재사용)

## 작업

### 1) `app/src/services/crawlers/dcinside.ts`

디시는 **노이즈가 뽐뿌·클리앙 대비 현저히 크므로 엄격 파서** 필요.

**순수 함수 서명**:
```ts
export type DcinsideConfig = {
  baseUrl: string;              // 'https://gall.dcinside.com'
  galleryId: string;            // 'airplane_new2'
  maxPages: number;             // 기본 2 (볼륨이 커서 파싱 실패 비율 제어)
  fetch?: typeof fetch;
};

export async function crawlDcinside(config: DcinsideConfig): Promise<RawPost[]>
```

**노이즈 필터 (엄격)**:
- 제목 길이 < 10자 또는 > 100자 → skip
- 제목에 `정보`, `질문`, `문의`, `후기`, `ㅇㅇ`, `ㅎㅇ` 등 비딜 토큰이 있고 가격 패턴 없음 → skip
- 가격 패턴 없음 + 항공사 코드 없음 → skip
- 본문 링크가 자체 링크가 아닌 dcinside 내부 이동 링크만 → skip (외부 원문 없는 이야기글)

### 2) 파싱 통합 (Stretch 2 LLM 폴백 재사용)

- `parseRules` 1차 → 실패 시 **기존 Stretch 2 LLM 파서** (`parser/llm.ts`) 재사용
- `CHEAPSKY_STAGE=stretch` 아닐 때는 규칙만 (기존 동작 유지)
- LLM 호출 budget 공유 (일 300회 상한, 기존 `lib/llm-budget.ts`)

### 3) `scripts/crawl.ts` 통합

```ts
{
  name: 'dcinside',
  crawler: () => crawlDcinside({ baseUrl: '...', galleryId: 'airplane_new2', maxPages: 2 }),
  timeoutMs: 90_000,    // 노이즈 필터 여유 시간
}
```

### 4) 회귀 테스트

`app/src/services/crawlers/dcinside.test.ts`:
- fixture `__fixtures__/dcinside-list.html` 기반 파싱 회귀 ≥ 10 케이스
- 노이즈 샘플 10건 (step0 수집) → skip 확인
- 항공사 매칭 실패 → `carrier_class='mixed'` 폴백
- 가격 floor 50K 통과
- LLM 폴백 경로 mock 테스트 (실 API 호출 없이 budget gate · 결과 병합 검증)

## Acceptance Criteria

```bash
cd app
pnpm test src/services/crawlers/dcinside.test.ts
pnpm typecheck && pnpm lint
pnpm tsx scripts/crawl.ts 2>&1 | grep dcinside
# Stretch 모드에서 한 번 더:
CHEAPSKY_STAGE=stretch pnpm tsx scripts/crawl.ts 2>&1 | grep -E "dcinside|llm"
```

- 노이즈 필터 효과로 parsed / fetched 비율이 ruliweb 대비 낮아도 정상 (예상 30~50%)
- 실 크롤 1회에서 `crawler_runs.source='dcinside'` 행 생성

## 금지사항

- 기존 step1 동일 규칙 적용 (UA · allowedPaths · 동시성 · 닉네임 저장 금지)
- **LLM 본문 전문 전송 금지** (ADR-005/008). 제목 + 본문 앞 500자만 (기존 정책 준수)
- **디시 작성자 식별자(ㅇㅇ/닉네임) 저장 금지** — 수집 시 CSS selector 로 제외
