import React from 'react';
import { useWindows } from '../../context/WindowContext';
import {
    secondsLeftOf, formatCountdown, useNow, WINDOW_LIMIT, IDLE_MINUTES, WARN_SECONDS,
} from '../../utils/saleWindows';

/**
 * "Still here?" strip for the active window once it is close to its idle expiry. Pressing it
 * restarts the server's 15-minute clock; ignoring it lets the window close and its items go
 * back to stock. Used on the sales screen and on checkout (where a cashier waits for money).
 */
export function WindowExpiryNotice({ window: w }) {
    const { touchWindow, isBusy } = useWindows();
    const now = useNow();
    if (!w) return null;
    const left = secondsLeftOf(w, now);
    if (left > WARN_SECONDS) return null;
    const expired = left === 0;
    return (
        <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
            padding: '0.625rem 0.875rem', margin: '0.5rem 0.75rem 0',
            background: expired ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)',
            border: `1px solid ${expired ? 'rgba(239,68,68,0.35)' : 'rgba(245,158,11,0.35)'}`,
            borderRadius: '0.75rem', fontSize: '0.78rem',
            color: expired ? '#fca5a5' : '#fcd34d',
        }}>
            <span>
                {expired
                    ? `${w.label} is being closed - its items are going back to stock.`
                    : `${w.label} closes in ${formatCountdown(left)} and its items go back to stock.`}
            </span>
            {!expired && (
                <button
                    onClick={() => touchWindow(w.windowId).catch(() => {})}
                    disabled={isBusy(w.windowId)}
                    style={{
                        flexShrink: 0, padding: '0.375rem 0.75rem', borderRadius: '0.5rem',
                        background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.45)',
                        color: '#fde68a', fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer',
                    }}
                >
                    Keep holding
                </button>
            )}
        </div>
    );
}

/**
 * The cashier's open sale windows, as tabs above the cart. Each tab: label, customer,
 * item count and the time left before an idle window is closed. "+" opens another window
 * (up to WINDOW_LIMIT); "x" closes one without selling, handing its stock back.
 */
export default function WindowTabs() {
    const {
        windows, activeWindowId, switchTo, openWindow, releaseWindow, canOpenMore, isBusy, customerOf,
    } = useWindows();
    const now = useNow();

    const handleClose = async (e, w) => {
        e.stopPropagation();
        const count = w.items.length;
        const question = count
            ? `Close ${w.label}? Its ${count} item${count === 1 ? '' : 's'} will be put back in stock.`
            : `Close ${w.label}?`;
        if (!window.confirm(question)) return;
        releaseWindow(w.windowId).catch(() => {});
    };

    return (
        <div style={{
            display: 'flex', alignItems: 'stretch', gap: '0.375rem',
            padding: '0.625rem 0.75rem 0', overflowX: 'auto', flexShrink: 0,
        }} className="scrollbar-hide">
            {windows.map(w => {
                const active = w.windowId === activeWindowId;
                const left = secondsLeftOf(w, now);
                const warn = left <= WARN_SECONDS;
                const customer = customerOf(w);
                return (
                    <div
                        key={w.windowId}
                        role="tab"
                        aria-selected={active}
                        onClick={() => { if (!active) switchTo(w.windowId); }}
                        title={`${w.label} - closes after ${IDLE_MINUTES} minutes without activity`}
                        style={{
                            // Up to 3 tabs share the cart panel's width (and shrink on a narrow
                            // screen) rather than overflowing and pushing "+" out of view.
                            position: 'relative', flex: '1 1 0', minWidth: 0, maxWidth: '160px',
                            padding: '0.45rem 0.4rem 0.45rem 0.55rem',
                            borderRadius: '0.75rem 0.75rem 0 0',
                            background: active ? 'rgba(59,130,246,0.14)' : 'rgba(255,255,255,0.03)',
                            // Three sides only: the tab opens onto the cart below it. (Not `border` +
                            // `borderBottom` — React warns when shorthand and longhand mix on re-render.)
                            borderTop: `1px solid ${active ? 'rgba(59,130,246,0.45)' : 'rgba(255,255,255,0.08)'}`,
                            borderLeft: `1px solid ${active ? 'rgba(59,130,246,0.45)' : 'rgba(255,255,255,0.08)'}`,
                            borderRight: `1px solid ${active ? 'rgba(59,130,246,0.45)' : 'rgba(255,255,255,0.08)'}`,
                            cursor: active ? 'default' : 'pointer',
                            opacity: isBusy(w.windowId) ? 0.7 : 1,
                        }}
                    >
                        {/* Label and close share the first line, so a narrow tab keeps its label. */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <span style={{
                                flex: 1, minWidth: 0,
                                fontSize: '0.75rem', fontWeight: 700, color: active ? '#93c5fd' : '#94a3b8',
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}>
                                {w.label}
                            </span>
                            <button
                                onClick={(e) => handleClose(e, w)}
                                title={`Close ${w.label}`}
                                aria-label={`Close ${w.label}`}
                                style={{
                                    flexShrink: 0, width: '18px', height: '18px', borderRadius: '5px',
                                    background: 'transparent', border: 'none', padding: 0,
                                    color: '#64748b', cursor: 'pointer', fontSize: '0.75rem', lineHeight: 1,
                                }}
                                onMouseEnter={e => { e.currentTarget.style.color = '#f87171'; }}
                                onMouseLeave={e => { e.currentTarget.style.color = '#64748b'; }}
                            >✕</button>
                        </div>
                        <div style={{
                            fontSize: '0.68rem', color: '#64748b', whiteSpace: 'nowrap',
                            overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                            {customer?.name || 'No customer'} · {w.items.length} item{w.items.length === 1 ? '' : 's'}
                        </div>
                        <div style={{
                            fontSize: '0.68rem', fontFamily: 'var(--font-mono)', marginTop: '2px',
                            color: warn ? '#fbbf24' : '#475569', fontWeight: warn ? 700 : 500,
                        }}>
                            {formatCountdown(left)}
                        </div>
                    </div>
                );
            })}
            <button
                onClick={() => openWindow().catch(() => {})}
                disabled={!canOpenMore}
                title={canOpenMore ? 'Open another sale window' : `At most ${WINDOW_LIMIT} windows can be open. Confirm or close one first.`}
                style={{
                    minWidth: '34px', padding: '0 0.5rem',
                    borderRadius: '0.75rem 0.75rem 0 0',
                    background: 'rgba(255,255,255,0.03)',
                    borderTop: '1px dashed rgba(255,255,255,0.15)',
                    borderLeft: '1px dashed rgba(255,255,255,0.15)',
                    borderRight: '1px dashed rgba(255,255,255,0.15)',
                    borderBottom: 'none',
                    color: canOpenMore ? '#60a5fa' : '#334155',
                    fontSize: '1.1rem', fontWeight: 700,
                    cursor: canOpenMore ? 'pointer' : 'not-allowed', flexShrink: 0,
                }}
            >+</button>
        </div>
    );
}
