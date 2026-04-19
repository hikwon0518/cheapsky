-- 2026-04-19 RLS hardening patch
-- Run in Supabase SQL editor or via: psql "$SUPABASE_DB_URL" -f scripts/migrations/20260419_rls_hardening.sql
--
-- 변경:
-- 1) deals.body 컬럼 anon 제거 — 뽐뿌·루리웹·플레이윙즈 본문 대량 덤프 방지 (ADR-008)
-- 2) deal_verifications · api_usage_daily anon 정책 제거 — 운영 메타데이터 공개 금지
--
-- 영향:
-- - UI (Server Component) 는 service_role client 로 읽어야 하는 경우 추가
-- - /api/health 는 현재 crawler_runs 만 쓰므로 영향 없음
-- - deals.body 는 LLM 파서 폴백 / curator 가 service_role 로 읽음 (기존 경로 유지)

-- 1) deals.body column-level revoke
revoke select (body) on deals from anon;

-- 2) deal_verifications · api_usage_daily anon 정책 제거
drop policy if exists anon_read_ver   on deal_verifications;
drop policy if exists anon_read_usage on api_usage_daily;

-- 참고: 정책이 없으면 RLS enabled 테이블에서 anon 은 빈 결과.
-- 필요 시 향후 컬럼별 view 로 재공개 가능.
