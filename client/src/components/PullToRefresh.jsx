import { useRef, useState, useCallback } from 'react';

const THRESHOLD = 70;
const MAX_PULL = 110;
const RESISTANCE = 0.5;

function isScrollable(el) {
  const style = window.getComputedStyle(el);
  return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight;
}

// Walks up from the touched element to find which scrollable ancestor owns
// the gesture — lets nested scroll areas (modals, the cart sidebar) handle
// their own touches instead of triggering the page-level pull-to-refresh.
function findScrollParent(el, root) {
  let node = el;
  while (node && node !== root) {
    if (isScrollable(node)) return node;
    node = node.parentElement;
  }
  return root;
}

export default function PullToRefresh({ children, onRefresh, style, className }) {
  const containerRef = useRef(null);
  const trackingRef = useRef(false);
  const startYRef = useRef(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const handleTouchStart = useCallback((e) => {
    const container = containerRef.current;
    if (!container || refreshing) return;
    // Skip fixed-position overlays (modals, cart sidebar, mobile nav drawer)
    if (e.target.closest('[style*="position: fixed"]')) return;
    if (findScrollParent(e.target, container) !== container) return;
    if (container.scrollTop > 0) return;

    trackingRef.current = true;
    startYRef.current = e.touches[0].clientY;
  }, [refreshing]);

  const handleTouchMove = useCallback((e) => {
    if (!trackingRef.current) return;
    const delta = e.touches[0].clientY - startYRef.current;
    if (delta <= 0) {
      trackingRef.current = false;
      setDragging(false);
      setPullDistance(0);
      return;
    }
    setDragging(true);
    setPullDistance(Math.min(delta * RESISTANCE, MAX_PULL));
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!trackingRef.current) return;
    trackingRef.current = false;
    setDragging(false);

    setPullDistance((current) => {
      if (current >= THRESHOLD) {
        setRefreshing(true);
        const result = onRefresh ? onRefresh() : window.location.reload();
        Promise.resolve(result).finally(() => {
          setTimeout(() => {
            setRefreshing(false);
            setPullDistance(0);
          }, 400);
        });
        return THRESHOLD * 0.6;
      }
      return 0;
    });
  }, [onRefresh]);

  const progress = Math.min(pullDistance / THRESHOLD, 1);
  const settled = refreshing ? THRESHOLD * 0.6 : pullDistance;

  return (
    <main
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      className={className}
      style={{ ...style, position: 'relative' }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: '50%',
          width: '32px',
          height: '32px',
          transform: `translate(-50%, ${settled - 40}px)`,
          opacity: refreshing ? 1 : progress,
          transition: dragging ? 'none' : 'transform 0.25s ease, opacity 0.25s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          background: 'rgba(9,14,26,0.92)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#60a5fa"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={refreshing ? 'animate-spin' : ''}
          style={!refreshing ? { transform: `rotate(${progress * 360}deg)` } : undefined}
        >
          <path d="M21 12a9 9 0 11-3-6.7" />
          <polyline points="21 3 21 9 15 9" />
        </svg>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          transform: `translateY(${settled}px)`,
          transition: dragging ? 'none' : 'transform 0.25s ease',
        }}
      >
        {children}
      </div>
    </main>
  );
}
