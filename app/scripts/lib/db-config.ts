/**
 * Supabase DSN → pg ClientConfig 정규화
 *
 * 다음 케이스를 모두 흡수:
 *   1) 정상 pooled DSN: postgresql://postgres.<ref>:<pwd>@aws-1-<region>.pooler.supabase.com:6543/postgres
 *   2) 정상 direct DSN: postgresql://postgres:<pwd>@db.<ref>.supabase.co:5432/postgres
 *      → IPv6 전용 host 라 IPv4 네트워크에서는 resolve 실패 → pooler 로 리라이트
 *   3) 템플릿 DSN: postgresql://postgres:[pwd@]@db.<ref>.supabase.co:5432/postgres
 *      → 브래킷 제거 + '@' URL-encode 후 pooler 로 리라이트
 *
 * pooler region 은 DNS 로 확인된 값 (2026-04-18 기준 ap-southeast-1) 을 기본값으로 사용.
 * 향후 region 이 바뀌면 DB_POOLER_HOST 환경변수로 덮어쓸 수 있다.
 */

export type DbConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

const DEFAULT_POOLER_HOST = 'aws-1-ap-southeast-1.pooler.supabase.com';
const DEFAULT_POOLER_PORT = 6543;

export function resolveDbConfig(rawDsn: string, supabaseUrl?: string): DbConfig {
  const normalized = normalizeDsn(rawDsn);

  const u = new URL(normalized);
  let host = u.hostname;
  let port = parseInt(u.port, 10) || 5432;
  let user = decodeURIComponent(u.username);
  const password = decodeURIComponent(u.password);
  const database = u.pathname.replace(/^\//, '') || 'postgres';

  // direct host 감지 → pooler 로 리라이트
  const directMatch = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/);
  if (directMatch) {
    const projectRef = directMatch[1];
    host = process.env.DB_POOLER_HOST ?? DEFAULT_POOLER_HOST;
    port = DEFAULT_POOLER_PORT;
    // pooler 는 user 포맷이 postgres.<ref> 여야 함
    if (!user.includes('.')) {
      user = `postgres.${projectRef}`;
    }
  }

  return { host, port, user, password, database };
}

function normalizeDsn(input: string): string {
  // 템플릿 형태 '[password@]' 또는 '[password]' 감지해서 cleanup
  // 예: postgresql://postgres:[gurdls1129@]@db.xxx.supabase.co:5432/postgres
  //     → postgresql://postgres:gurdls1129%40@db.xxx.supabase.co:5432/postgres
  const bracketMatch = input.match(/^(postgres(?:ql)?:\/\/[^:]+:)\[([^\]]+)\](@.*)$/);
  if (bracketMatch) {
    let pwd = bracketMatch[2];
    // 후행 '@' 는 원본 비밀번호의 일부 (예: gurdls1129@)
    // 브래킷 구분자 때문에 넣었다고 가정. @ 는 URL-encode.
    const encoded = encodeURIComponent(pwd);
    return bracketMatch[1] + encoded + bracketMatch[3];
  }
  return input;
}
