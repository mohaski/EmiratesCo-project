import { provisionalLabel } from '../../utils/provisional';

/**
 * A provisional offcut (server: core/inventory/holdScope.py, PROVISIONAL_OFFCUTS_PLAN.md):
 * the leftover of a bar an open sale window has cut on paper but not paid for. Any till may
 * cut from it, but it doesn't exist on the rack yet - the bar is still whole until that sale
 * is paid. `windows`: [{orderId, window, cashier}] from the API's `provisional` field.
 */
export default function ProvisionalBadge({ windows, compact = false }) {
    if (!windows || windows.length === 0) return null;
    const who = provisionalLabel(windows);
    return (
        <span
            data-testid="provisional-badge"
            title={`Leftover of a bar ${who} hasn't paid for yet. It isn't cut yet - the bar is still whole on the rack. Ordinary offcuts are used first.`}
            style={{
                display: 'inline-block', fontSize: '0.66rem', fontWeight: 800, color: '#c4b5fd',
                marginLeft: '0.5rem', padding: '1px 7px', borderRadius: '999px', whiteSpace: 'nowrap',
                background: 'rgba(139,92,246,0.12)', border: '1px dashed rgba(167,139,250,0.55)',
            }}
        >
            Provisional{compact ? '' : ` · ${who}`}
        </span>
    );
}
