import { useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { useCart } from '../context/CartContext';
import { answersComplete, answersPayload, stockSignature } from '../utils/cutAnswers';

/**
 * Editing a saved order: the "was it cut?" questions for the item open in a calculator.
 *
 * They are asked in the calculator, before the cashier chooses material for the new size,
 * because the answers decide which pieces exist to choose from - a cut never made is joined
 * back onto what is left of the bar, an already-cut piece goes back to the pool as it is.
 * Checkout re-uses these answers and only asks about items removed from the order entirely.
 *
 * Only active once the item actually differs from what is saved (the same comparison the
 * server makes - orderService._stock_signature): an untouched item's material never moves,
 * so it is never asked about. Rendered by components/orders/EditCutPanel.
 */
export function useEditCutAnswers({ initialDetails, variantId, lineItems }) {
    const { editingOrderId } = useCart();
    const sourceItemId = initialDetails?._sourceItemId ?? null;
    const [plan, setPlan] = useState(null);
    const [answers, setAnswers] = useState(() => initialDetails?.cutAnswers || {});

    useEffect(() => {
        if (!editingOrderId || !sourceItemId) return undefined;
        let cancelled = false;
        api.orderService.getReversalPlan(editingOrderId)
            .then(p => { if (!cancelled) setPlan(p); })
            .catch(() => { if (!cancelled) setPlan({ lines: [] }); });
        return () => { cancelled = true; };
    }, [editingOrderId, sourceItemId]);

    const lines = useMemo(
        () => (plan?.lines || []).filter(l => l.item_id === sourceItemId),
        [plan, sourceItemId],
    );

    // What was saved, captured once when the calculator opened.
    const [originalSig] = useState(() => {
        const saved = initialDetails?._source || initialDetails;
        return stockSignature(saved?.lineItems, saved?.variantId);
    });
    const changed = !!sourceItemId && stockSignature(lineItems, variantId) !== originalSig;
    const active = changed && lines.length > 0;
    const complete = !active || answersComplete(lines, answers);

    return {
        active,
        lines,
        answers,
        setAnswers,
        complete,
        editingOrderId,
        sourceItemId,
        // For the stock check and the projected pool: only once they mean something.
        apiAnswers: active && complete ? answersPayload(lines, answers) : null,
        // Stored on the cart item for checkout.
        cartAnswers: active ? answers : null,
    };
}
