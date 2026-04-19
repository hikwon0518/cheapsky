// Route watcher helpers (C1 — 노선 감시 + 알림).
// 개인 사용 전제: owner_email 은 env `WATCHER_OWNER_EMAIL` 로 단일 주입.

export type WatchedRouteRow = {
  id: string;
  owner_email: string;
  origin: string;
  destination: string;
  max_price_krw: number;
  carrier_class: 'fsc' | 'lcc' | 'mixed';
  depart_month: string | null;
  active: boolean;
  created_at: string;
  last_notified_at: string | null;
  notify_cooldown_h: number;
};

export type WatchedRoute = {
  id: string;
  ownerEmail: string;
  origin: string;
  destination: string;
  maxPriceKrw: number;
  carrierClass: 'fsc' | 'lcc' | 'mixed';
  departMonth: string | null;
  active: boolean;
  createdAt: Date;
  lastNotifiedAt: Date | null;
  notifyCooldownH: number;
};

export function rowToWatchedRoute(r: WatchedRouteRow): WatchedRoute {
  return {
    id: r.id,
    ownerEmail: r.owner_email,
    origin: r.origin,
    destination: r.destination,
    maxPriceKrw: r.max_price_krw,
    carrierClass: r.carrier_class,
    departMonth: r.depart_month,
    active: r.active,
    createdAt: new Date(r.created_at),
    lastNotifiedAt: r.last_notified_at ? new Date(r.last_notified_at) : null,
    notifyCooldownH: r.notify_cooldown_h,
  };
}

/**
 * Owner email from env. 개인 사용 전제 1명.
 */
export function getWatcherOwner(): string | null {
  return process.env.WATCHER_OWNER_EMAIL ?? null;
}
