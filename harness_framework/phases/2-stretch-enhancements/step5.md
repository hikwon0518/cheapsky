# Step 5: verifier-precise

## 읽어야 할 파일

- `docs/ADR.md` — **ADR-018 (Stretch: GET+patterns)**, ADR-008 (요청 간격·UA)
- `docs/ARCHITECTURE.md` — "데이터 흐름 (3) 실효성 검증"
- 이전 산출물:
  - `app/src/services/verifier.ts` (Core: HEAD only)
  - `app/scripts/verify.ts`

## 작업

앱 루트는 `cheapsky/app/`. Core HEAD 기반 검증을 **GET + 본문 가격 패턴 검출** 로 확장.

### 1) `src/services/verifier.ts` 확장

기존 HEAD 함수는 유지 (`verifyUrlHead`), 신규 추가:

```ts
export async function verifyUrlPrecise(url: string, expectedPriceKrw: number, opts?: { timeoutMs?: number }):
  Promise<{ status: 'active' | 'snapshot' | 'price_changed' | 'unchecked'; httpStatus: number | null; priceSignal: 'matched' | 'drifted' | 'missing' }>
```

로직 (ADR-018 Stretch):
1. GET 요청, 10 초 timeout (HEAD 보다 여유). UA=CRAWLER_USER_AGENT. 요청 간 500 ms
2. 404/410 → snapshot
3. 200~399 이고 본문 fetch 성공:
   - 본문 앞 **최대 20 KB** 만 읽고 종료 (`ReadableStream` 청크 단위 cut — 전체 다운로드 방지)
   - 본문에서 `expectedPriceKrw ± 10%` 범위의 숫자 패턴 검색 (`135,000` / `135000` / `135천원` 등)
   - 매치 있음 → `status='active', priceSignal='matched'`
   - 매치 없음 + 다른 가격 패턴 존재 → `status='price_changed', priceSignal='drifted'`
   - 가격 패턴 없음 (본문 짧음·인코딩 이슈) → `status='active', priceSignal='missing'` (보수적으로 active 유지)
4. 5xx / timeout / network error → `status='unchecked'`

**본문 20 KB cap** 은 ADR-008 저장 범위 제한 정신 (전체 본문 저장 금지) + 트래픽 절약.

### 2) `scripts/verify.ts` 업데이트

Core 에서는 HEAD 만 썼다. Stretch 에선 분기:

```ts
if (isStretchStage()) {
  const r = await verifyUrlPrecise(url, deal.price_krw);
  // status + priceSignal 반영
  // deal_verifications.note 에 "matched" / "drifted" / "missing" 기록
} else {
  // 기존 HEAD 흐름
}
```

`deal_verifications.note` 에 priceSignal 기록. `deals.verification_status` 는 `price_changed` 인 경우 UI 에서 amber 경고 처리 (Core UI 이미 대응).

### 3) `.github/workflows/verify.yml` 는 Core 에서 이미 있음. 수정 불필요 — Core 에선 HEAD, Stretch 배포 시 별도 workflow 나 env 주입은 현재 스코프에서 생략. 로컬 실행용으로는 `export CHEAPSKY_STAGE=stretch` 후 `pnpm tsx scripts/verify.ts` 로 새 경로 활성.

### 4) 테스트

`src/services/verifier.test.ts` 확장:
- 200 + 본문에 `135,000` 포함, expected=135000 → matched, status=active
- 200 + 본문에 `142,000` 만 있음, expected=135000 → drifted, status=price_changed
- 200 + 본문에 가격 텍스트 없음 → missing, status=active
- 본문 100 KB → 20 KB 까지만 스캔 (나머지 버림). fetch abort 확인
- 404 → snapshot
- timeout → unchecked

## Acceptance Criteria

```bash
export CHEAPSKY_STAGE=stretch
cd C:/Users/hukyu/Project_Document/cheapsky/app
pnpm build
pnpm test
pnpm exec tsc --noEmit
pnpm lint
pnpm tsx scripts/verify.ts   # Stretch 분기 타는지 확인 (deal_verifications.note)
```

## 검증 절차

1. 위 AC 전부 성공
2. 본문 20 KB cap 이 작동 (테스트로 증명)
3. 원래 HEAD 흐름은 Core env 에서 그대로 (기존 테스트 깨지지 않음)
4. `services/verifier.ts` 에 LLM SDK import 0건
5. 상태 업데이트:
   - 성공 → `"status": "completed"`, `"summary": "services/verifier.ts 에 verifyUrlPrecise 추가 (GET + 20KB cap + ±10% 가격 패턴 + matched/drifted/missing). scripts/verify.ts 분기 — Core HEAD, Stretch PRECISE. deal_verifications.note 에 priceSignal 기록."`

## 금지사항

- **본문 전체 다운로드 금지**. 이유: 트래픽 + ADR-008 저장 범위. 20 KB cap
- **Core 의 HEAD 경로 제거·변경 금지**. 이유: Stretch 없이도 동작해야 함
- **본문을 DB 에 저장 금지**. 이유: 검증용으로 읽고 버림. `deals.body` 는 Core 크롤 단계에서만 set
- **요청 간격 500ms 미만 금지** (ADR-008 원칙 적용). 이유: IP 차단 방어
- **UA 위장 금지** (ADR-008)
