'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../modules/api';

const POLL_MS = 60000;

export default function NotificationBell({ session, disabled = false, refreshKey = 0 }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const rootRef = useRef(null);

  const load = useCallback(async () => {
    if (disabled || !session?.access_token) { setItems([]); setUnread(0); return; }
    setLoading(true);
    try {
      const data = await apiRequest(session, '/notifications');
      setItems(data?.items || []); setUnread(data?.unread || 0); setError('');
    } catch (problem) { setError(problem.message || '알림을 불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }, [session, disabled]);

  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => {
    if (disabled) return undefined;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [load, disabled]);
  useEffect(() => {
    if (!open) return undefined;
    const close = event => { if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false); };
    const esc = event => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  async function markRead(body) {
    try { await apiRequest(session, '/notifications/read', { method: 'POST', body }); await load(); }
    catch (problem) { setError(problem.message || '읽음 처리하지 못했습니다.'); }
  }

  if (disabled) return null;
  return <div className="bell-wrap" ref={rootRef}>
    <button type="button" className="bell-button" aria-label={unread ? `알림 ${unread}건 읽지 않음` : '알림'} aria-haspopup="true" aria-expanded={open} onClick={() => { setOpen(!open); if (!open) load(); }}>
      <span aria-hidden="true">🔔</span>{unread > 0 && <b className="bell-badge">{unread > 99 ? '99+' : unread}</b>}
    </button>
    {open && <div className="bell-panel" role="region" aria-label="알림 목록">
      <div className="bell-head"><b>알림</b><button type="button" className="text-button" disabled={!unread} onClick={() => markRead({ all: true })}>모두 읽음</button></div>
      {error && <p className="bell-error" role="alert">{error}</p>}
      {loading && !items.length ? <p className="bell-empty" role="status">알림을 불러오는 중…</p>
        : items.length ? <ul className="bell-list">{items.map(item => <li key={item.id} className={item.read_at ? '' : 'unread'}>
          <button type="button" onClick={() => { if (!item.read_at) markRead({ ids: [item.id] }); }}>
            <b>{item.title}</b><span>{item.body}</span><time>{new Date(item.created_at).toLocaleString('ko-KR')}</time>
          </button></li>)}</ul>
        : !error && <p className="bell-empty">새 알림이 없습니다.</p>}
    </div>}
  </div>;
}
