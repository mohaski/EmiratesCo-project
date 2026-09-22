import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FailoverService } from '../services/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { wsEvents } from '../utils/wsEvents';

const cardStyle = {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: '1.25rem',
};

const primaryBtn = (disabled) => ({
    padding: '0.9rem 1.5rem',
    borderRadius: '0.85rem',
    border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    background: disabled ? 'rgba(239,68,68,0.15)' : 'linear-gradient(135deg, #ef4444, #f97316)',
    color: disabled ? '#64748b' : '#fff',
    fontWeight: 800,
    fontSize: '0.95rem',
    width: '100%',
});

function Dot({ ok }) {
    return (
        <span style={{
            display: 'inline-block', width: '9px', height: '9px', borderRadius: '50%',
            background: ok ? '#4ade80' : '#f87171',
            boxShadow: ok ? '0 0 8px rgba(74,222,128,0.6)' : '0 0 8px rgba(248,113,113,0.6)',
        }} />
    );
}

function formatTimestamp(ts) {
    if (!ts) return 'Never';
    try {
        return new Date(ts).toLocaleString();
    } catch {
        return ts;
    }
}

function EventTile({ label, record }) {
    return (
        <div style={{ ...cardStyle, padding: '1.1rem 1.25rem', flex: 1, minWidth: '220px' }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                {label}
            </div>
            {record ? (
                <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.3rem' }}>
                        <Dot ok={record.success} />
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: record.success ? '#4ade80' : '#f87171' }}>
                            {record.success ? 'Succeeded' : 'Failed'}
                        </span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                        {formatTimestamp(record.timestamp)}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{record.detail}</div>
                </>
            ) : (
                <div style={{ fontSize: '0.85rem', color: '#475569' }}>No record yet</div>
            )}
        </div>
    );
}

export default function FailoverPage() {
    const navigate = useNavigate();
    const toast = useToast();
    const { user } = useAuth();
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [pushing, setPushing] = useState(false);
    const pollRef = useRef(null);

    const fetchStatus = useCallback(async () => {
        try {
            const data = await FailoverService.getStatus();
            setStatus(data);
        } catch {
            // interceptor already shows a toast on failure
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchStatus(); }, [fetchStatus]);
    useEffect(() => wsEvents.on('failover_status_updated', fetchStatus), [fetchStatus]);
    useEffect(() => {
        pollRef.current = setInterval(fetchStatus, 15000);
        return () => clearInterval(pollRef.current);
    }, [fetchStatus]);

    const handlePush = async () => {
        const peerLabel = status?.peer_machine_name || status?.peer_url || 'the peer machine';
        const confirmed = window.confirm(
            `This will overwrite ${peerLabel}'s current database with this machine's data, ` +
            `and business should continue from ${peerLabel} afterward. This cannot be undone from here.\n\n` +
            `Only proceed if you are certain this machine has the newest data. Continue?`
        );
        if (!confirmed) return;

        setPushing(true);
        try {
            const result = await FailoverService.pushToPeer();
            toast(result.message || 'Backup pushed and restored on peer.', 'success');
        } catch {
            // interceptor already shows a toast on failure
        } finally {
            setPushing(false);
            fetchStatus();
        }
    };

    const disabled = pushing || loading || !status?.peer_reachable || status?.operation_in_progress;

    return (
        <div style={{ minHeight: '100%', background: 'var(--color-bg)', color: 'var(--color-text)' }}>
            <div style={{
                padding: '1.5rem 2rem', borderBottom: '1px solid rgba(255,255,255,0.07)',
                background: 'rgba(9,14,26,0.8)', backdropFilter: 'blur(20px)',
                position: 'sticky', top: 0, zIndex: 20,
            }}>
                <button onClick={() => navigate('/')} style={{
                    background: 'none', border: 'none', cursor: 'pointer', color: '#475569',
                    fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.75rem', padding: 0,
                }}>← Back to Dashboard</button>
                <h1 style={{ fontSize: '1.375rem', fontWeight: 800, color: '#f1f5f9', margin: '0 0 0.4rem', letterSpacing: '-0.025em' }}>
                    ⚡ Emergency Failover
                </h1>
                <p style={{ fontSize: '0.82rem', color: '#64748b', margin: 0, maxWidth: '640px' }}>
                    Use this during a power outage or once power has returned, to move business
                    operations between this machine and its paired device.
                </p>
            </div>

            <div style={{ padding: '1.75rem 2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '780px' }}>
                {/* Identity + peer reachability */}
                <div style={{ ...cardStyle, padding: '1.25rem 1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.9rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <div>
                            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>This machine</div>
                            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#f1f5f9' }}>{status?.machine_name || '—'}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Peer</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', justifyContent: 'flex-end' }}>
                                <Dot ok={!!status?.peer_reachable} />
                                <span style={{ fontSize: '0.9rem', fontWeight: 700, color: status?.peer_reachable ? '#4ade80' : '#f87171' }}>
                                    {status?.peer_reachable ? (status?.peer_machine_name || 'Reachable') : 'Unreachable'}
                                </span>
                            </div>
                        </div>
                    </div>
                    {status && !status.peer_reachable && (
                        <div style={{ fontSize: '0.75rem', color: '#f87171', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '0.6rem', padding: '0.6rem 0.8rem' }}>
                            {status.peer_error || 'Peer is not reachable.'}
                        </div>
                    )}
                    {status?.operation_in_progress && (
                        <div style={{ fontSize: '0.75rem', color: '#fbbf24', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '0.6rem', padding: '0.6rem 0.8rem', marginTop: '0.6rem' }}>
                            A failover operation is currently in progress on this machine.
                        </div>
                    )}
                </div>

                {/* Last push / receive */}
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    <EventTile label="Last pushed to peer" record={status?.last_push} />
                    <EventTile label="Last received from peer" record={status?.last_receive} />
                </div>

                {/* Action */}
                <div style={{ ...cardStyle, padding: '1.5rem' }}>
                    <button onClick={handlePush} disabled={disabled} style={primaryBtn(disabled)}>
                        {pushing ? 'Pushing…' : `Fail over to ${status?.peer_machine_name || 'peer'}`}
                    </button>
                    <p style={{ fontSize: '0.72rem', color: '#64748b', margin: '0.75rem 0 0' }}>
                        Sends this machine's current data to the peer and has it restore there. Only
                        the manager or CEO should trigger this, and only when this machine is known
                        to have the newest data.
                    </p>
                </div>

                {/* History */}
                {status?.history?.length > 0 && (
                    <div style={{ ...cardStyle, padding: '1.25rem 1.5rem' }}>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>
                            History
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                            {status.history.map((h, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', fontSize: '0.78rem' }}>
                                    <Dot ok={h.success} />
                                    <div style={{ flex: 1 }}>
                                        <span style={{ fontWeight: 700, color: '#cbd5e1', textTransform: 'capitalize' }}>{h.direction}</span>
                                        <span style={{ color: '#475569' }}> · {formatTimestamp(h.timestamp)}</span>
                                        <div style={{ color: '#64748b' }}>{h.detail}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
