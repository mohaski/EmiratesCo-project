// Small marks shared by the glass worksheet on both papers (GlassPanelThermal, GlassCuttingSheet).
// Inline styles only: QZ Tray prints the markup without the app's stylesheet.

// Circled cut-stage number, matching the tags on the diagram.
export const StageBadge = ({ n, size = 15, fontSize = 9.5 }) => (
    <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        width: size, height: size, border: '1.3px solid #000', borderRadius: '50%',
        fontSize, fontWeight: 700, lineHeight: 1, boxSizing: 'border-box',
    }}>{n}</span>
);

// Empty square to tick by hand.
export const TickBox = ({ size = 10 }) => (
    <span style={{
        display: 'inline-block', width: size, height: size, border: '1.3px solid #000',
        verticalAlign: '-1px', marginRight: 2, flexShrink: 0, boxSizing: 'border-box',
    }} />
);

// The offcut this panel is cut from belongs to an order whose cutting isn't reported done
// yet (server: core/inventory/sourceNotice.py) - advisory, same wording as the bar worksheet.
export const PendingNotice = ({ notice, fontSize = 9.5 }) => (
    <div style={{ fontSize, fontWeight: 700, border: '1px solid #000', borderRadius: 3, padding: '2px 5px', margin: '3px 0' }}>
        ⚠ Depends on an offcut from Order #{notice.order_no ?? notice.order_id}
        {notice.customer_name ? ` (${notice.customer_name})` : ''}.
    </div>
);
