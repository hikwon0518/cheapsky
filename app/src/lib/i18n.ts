// i18n — 3개 언어 (ko/ja/en) 핵심 UI 문자열 테이블 (Cheapsky Light v5).
//
// Server 기본은 cookie `cheapsky_lang` 또는 Accept-Language 헤더. Client 는
// Tweaks 패널에서 변경 시 cookie set + router.refresh.
//
// Hard red lines:
// - 키는 snake_case, 값은 한국어/일본어/영어 문자열만. "Anthropic / Claude / LLM" 같은
//   내부 서비스명 포함 금지 (ADR-012)
// - 키 누락 시 ko 로 fallback, 둘 다 없으면 key 문자열 반환

export type Lang = 'ko' | 'ja' | 'en';

const TABLE: Record<string, Record<Lang, string>> = {
  'app.title': {
    ko: 'Cheapsky',
    ja: 'Cheapsky',
    en: 'Cheapsky',
  },
  'app.subtitle': {
    ko: '인천 출발 항공권 저점 레이더',
    ja: '仁川発 航空券 底値レーダー',
    en: 'ICN departure airfare low-point radar',
  },
  'app.nav.routes': {
    ko: '아시아·미국 20개 노선',
    ja: 'アジア・アメリカ 20路線',
    en: 'Asia·US 20 routes',
  },
  'section.hero.top3': {
    ko: '오늘의 추천 3',
    ja: '今日のおすすめ 3',
    en: "Today's picks (3)",
  },
  'section.hero.sub': {
    ko: '지금 평소보다 많이 싼 딜이에요',
    ja: '今、普段より大幅に安いディールです',
    en: 'Deals significantly cheaper than usual',
  },
  'section.timeline': {
    ko: '최근 24시간 딜 흐름',
    ja: '直近 24 時間のディール動向',
    en: 'Last 24h deal flow',
  },
  'section.timeline.live': {
    ko: '라이브 업데이트',
    ja: 'ライブ更新',
    en: 'Live updates',
  },
  'section.month': {
    ko: '언제 사는 게 좋을까?',
    ja: 'いつ買うのが良い?',
    en: 'When to buy?',
  },
  'section.counter': {
    ko: '지금은 기다려 보세요',
    ja: '今は待ってみて',
    en: 'Hold off for now',
  },
  'section.counter.sub': {
    ko: '평소보다 비싸게 나온 노선이에요',
    ja: '普段より高めに出ている路線です',
    en: 'Routes priced higher than usual',
  },
  'section.community': {
    ko: '반응 많은 딜',
    ja: '話題のディール',
    en: 'Trending deals',
  },
  'section.heatmap': {
    ko: '오늘의 노선 시세',
    ja: '本日の路線相場',
    en: "Today's market rates",
  },
  'filter.presets': {
    ko: '빠른 필터',
    ja: 'クイックフィルター',
    en: 'Quick filters',
  },
  'filter.detail.open': {
    ko: '+ 자세히 설정',
    ja: '+ 詳細設定',
    en: '+ More filters',
  },
  'filter.detail.close': {
    ko: '− 상세 필터 닫기',
    ja: '− 詳細フィルターを閉じる',
    en: '− Hide filters',
  },
  'verdict.buy_now': {
    ko: '지금 사기 좋아요.',
    ja: '今が買い時です。',
    en: 'Good time to buy.',
  },
  'verdict.cheaper': {
    ko: '평소보다 많이 싸요.',
    ja: '普段よりかなり安いです。',
    en: 'Much cheaper than usual.',
  },
  'footer.disclaimer': {
    ko: '학습 프로젝트입니다. 구매·예약은 반드시 원본 출처 링크로 접속해주세요.',
    ja: '学習用プロジェクトです。購入・予約は必ず原文の出典リンクから。',
    en: 'Learning project. Always purchase via the original source link.',
  },
};

const COOKIE = 'cheapsky_lang';

/**
 * 주어진 키 · 언어로 번역 조회. 누락 시 ko → key 순 fallback.
 */
export function t(key: string, lang: Lang = 'ko'): string {
  const entry = TABLE[key];
  if (!entry) return key;
  return entry[lang] ?? entry.ko ?? key;
}

/**
 * 브라우저 cookie 에서 현재 언어 읽기 (client only). 없으면 ko.
 */
export function getLangFromCookie(): Lang {
  if (typeof document === 'undefined') return 'ko';
  const match = document.cookie.match(/cheapsky_lang=([^;]+)/);
  const v = match?.[1];
  if (v === 'ja' || v === 'en' || v === 'ko') return v;
  return 'ko';
}

export function setLangCookie(lang: Lang): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${COOKIE}=${lang}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}
