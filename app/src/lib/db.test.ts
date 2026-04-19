import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  __resetClientsForTest,
  getAnonClient,
  getServiceClient,
} from '@/lib/db';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  __resetClientsForTest();
  // 깨끗한 슬레이트
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

afterEach(() => {
  __resetClientsForTest();
  process.env = { ...ORIGINAL_ENV };
});

describe('db.getAnonClient', () => {
  it('환경변수 누락 시 명확한 에러', () => {
    expect(() => getAnonClient()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    expect(() => getAnonClient()).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it('같은 인스턴스를 반복 반환 (module-level memo)', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-placeholder';
    const a = getAnonClient();
    const b = getAnonClient();
    expect(a).toBe(b);
  });
});

describe('db.getServiceClient', () => {
  it('서비스 키 누락 시 명확한 에러', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    expect(() => getServiceClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('url 누락 시 명확한 에러', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-placeholder';
    expect(() => getServiceClient()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('같은 인스턴스를 반복 반환', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-placeholder';
    const a = getServiceClient();
    const b = getServiceClient();
    expect(a).toBe(b);
  });

  it('anon 과 service 는 서로 다른 인스턴스', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-placeholder';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-placeholder';
    const anon = getAnonClient();
    const service = getServiceClient();
    expect(anon).not.toBe(service);
  });
});
