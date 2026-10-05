import { useCallback, useState } from 'react';
import api from '../services/api';
import CancelOrderModal from '../components/orders/CancelOrderModal';
import ResolveCutsModal from '../components/orders/ResolveCutsModal';

/**
 * The whole cancel sequence, in one place: reversal plan -> per-cut-line confirmation ->
 * PIN + refund -> cancel, reopening the confirmation if the material moved meanwhile (409).
 *
 * It lives here because it used to be written out separately in OrdersPage and
 * OrderSummaryPage, and the two drifted: the summary page kept a copy of the old
 * "already cut -> can't cancel" rule after the backend dropped it, and its Cancel button
 * skipped the cut confirmation entirely. One implementation can't disagree with itself.
 *
 *   const { startCancel, cancelFlowModals } = useCancelOrderFlow({ cancelOrder, onCancelled });
 *   <button onClick={() => startCancel(order)}>Cancel</button>
 *   {cancelFlowModals}
 *
 * `order` may be a list row ({ id }) or a full order ({ orderId }); both carry amountPaid.
 */
const idOf = order => order?.id ?? order?.orderId;

export default function useCancelOrderFlow({ cancelOrder, onCancelled }) {
    const [cutsToResolve, setCutsToResolve] = useState(null);  // { order, plan, notice }
    const [pending, setPending] = useState(null);              // { order, confirmations, token }

    const startCancel = useCallback(async (order) => {
        // The refund shown must be what the order has been paid NOW — the row or summary
        // this was opened from can predate a debt collected on another till. The server
        // also refuses a cancel whose expected refund no longer matches.
        try {
            const fresh = await api.orderService.getOrder(idOf(order));
            if (fresh && typeof fresh.amountPaid === 'number') {
                order = { ...order, amountPaid: fresh.amountPaid, balance: fresh.balance };
            }
        } catch (err) {
            console.error('Failed to refresh the order before cancelling', err);
        }
        try {
            const plan = await api.orderService.getReversalPlan(idOf(order));
            // ANY cut line means the floor confirms first, even one the cutting queue still
            // calls pending: the flag is a prefill, not evidence — bars are routinely cut
            // before anyone reports it. Orders with no cut material go straight to the PIN.
            if (plan?.has_cut_lines) {
                setCutsToResolve({ order, plan, notice: null });
                return;
            }
        } catch (err) {
            // Advisory pre-check only; the cancel call enforces the rules server-side.
            console.error('Failed to fetch the reversal plan', err);
        }
        setPending({ order, confirmations: null, token: null });
    }, []);

    const handleCutsResolved = useCallback((confirmations) => {
        const { order, plan } = cutsToResolve;
        setCutsToResolve(null);
        setPending({ order, confirmations, token: plan?.plan_token ?? null });
    }, [cutsToResolve]);

    const handleConfirm = useCallback(async (pin, refund) => {
        const { order, confirmations, token } = pending;
        try {
            await cancelOrder(idOf(order), pin, refund, confirmations, token);
        } catch (err) {
            // The material moved while the operator was confirming (another sale used one of
            // these offcuts). Reopen the confirmation on the fresh plan the server returned
            // rather than making them start over blind.
            const detail = err?.response?.status === 409 ? err?.response?.data?.detail : null;
            if (detail?.plan) {
                setPending(null);
                setCutsToResolve({ order, plan: detail.plan, notice: detail.message || null });
                return;
            }
            throw err;  // CancelOrderModal shows the message (wrong PIN, too old, ...)
        }
        setPending(null);
        onCancelled?.(order);
    }, [pending, cancelOrder, onCancelled]);

    const cancelFlowModals = (
        <>
            {cutsToResolve && (
                <ResolveCutsModal
                    plan={cutsToResolve.plan}
                    notice={cutsToResolve.notice}
                    onClose={() => setCutsToResolve(null)}
                    onConfirm={handleCutsResolved}
                    actionLabel="Continue to Cancel"
                    // Cancelling gives material back on the strength of these answers: every
                    // line must be answered "not cut" or "already cut" - none taken on trust.
                    requireAnswers
                />
            )}
            {pending && (
                <CancelOrderModal
                    order={{ ...pending.order, id: idOf(pending.order) }}
                    onClose={() => setPending(null)}
                    onConfirm={handleConfirm}
                />
            )}
        </>
    );

    return { startCancel, cancelFlowModals };
}
