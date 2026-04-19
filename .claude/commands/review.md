이 프로젝트의 변경 사항을 리뷰하라.

> **유일한 진실 소스는 `harness_framework/docs/`**. 루트에는 `CLAUDE.md` 가 없으므로 절대 경로가 아니라 아래 상대 경로로 문서를 읽어라.

먼저 다음 문서들을 읽어라:
- `harness_framework/CLAUDE.md`
- `harness_framework/docs/ARCHITECTURE.md`
- `harness_framework/docs/ADR.md`

그런 다음 변경된 파일들을 확인하고, 아래 체크리스트로 검증하라:

## 체크리스트

1. **아키텍처 준수**: ARCHITECTURE.md에 정의된 디렉토리 구조를 따르고 있는가?
2. **기술 스택 준수**: ADR에 정의된 기술 선택을 벗어나지 않았는가? (특히 ADR-022 Deprecated — Amadeus·시세 API 금지)
3. **테스트 존재**: 새로운 기능에 대한 테스트가 작성되어 있는가?
4. **CRITICAL 규칙**: CLAUDE.md의 CRITICAL 규칙을 위반하지 않았는가?
5. **빌드 가능**: 빌드 명령어가 에러 없이 통과하는가?
6. **시크릿 누출**: `.env*` 값이나 JWT/API 키가 소스에 인라인으로 들어갔는가?

## 출력 형식

| 항목 | 결과 | 비고 |
|------|------|------|
| 아키텍처 준수 | OK/FAIL | {상세} |
| 기술 스택 준수 | OK/FAIL | {상세} |
| 테스트 존재 | OK/FAIL | {상세} |
| CRITICAL 규칙 | OK/FAIL | {상세} |
| 빌드 가능 | OK/FAIL | {상세} |
| 시크릿 누출 | OK/FAIL | {상세} |

위반 사항이 있으면 수정 방안을 구체적으로 제시하라.
