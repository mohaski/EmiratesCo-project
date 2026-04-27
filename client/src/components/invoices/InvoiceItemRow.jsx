// InvoiceItemRow — rendered inside a white print-safe table, light styles intentional
const InvoiceItemRow = ({ item, index, productDef }) => {
    const def = productDef || {};

    return (
        <tr className="break-inside-avoid page-break-inside-avoid">
            <td style={{ padding: '12px 0', color: '#94a3b8', fontFamily: 'monospace', verticalAlign: 'top', fontSize: '0.8rem' }}>{index + 1}</td>
            <td style={{ padding: '12px 8px', verticalAlign: 'top' }}>
                <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.9rem', marginBottom: '4px' }}>{item.name}</div>

                {/* Legacy meta tags */}
                {(!item.details.attributes || item.details.attributes.length === 0) && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '6px' }}>
                        {item.details.color && (
                            <span style={{ background: '#f1f5f9', borderRadius: '4px', padding: '1px 6px', fontSize: '0.72rem', color: '#475569', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', border: '1px solid #cbd5e1', background: item.details.color === 'White' ? '#FFFFFF' : item.details.color, display: 'inline-block' }} />
                                {item.details.color}
                            </span>
                        )}
                        {item.details.extras ? Object.entries(item.details.extras).map(([key, val]) => {
                            if (key === 'Color' || key === 'Category') return null;
                            return <span key={key} style={{ background: '#f1f5f9', borderRadius: '4px', padding: '1px 6px', fontSize: '0.72rem', color: '#475569' }}>{val}{key === 'Length' && typeof val === 'number' ? 'ft' : ''}</span>;
                        }) : (
                            <>
                                {item.details.length && <span style={{ background: '#f1f5f9', borderRadius: '4px', padding: '1px 6px', fontSize: '0.72rem', color: '#475569' }}>{item.details.length}FT</span>}
                                {item.details.thickness && <span style={{ background: '#f1f5f9', borderRadius: '4px', padding: '1px 6px', fontSize: '0.72rem', color: '#475569' }}>{item.details.thickness}</span>}
                            </>
                        )}
                    </div>
                )}

                {/* Universal line items breakdown */}
                {item.details.lineItems && (
                    <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                        {item.details.attributes && item.details.attributes.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
                                {item.details.attributes.map((attr, idx) => (
                                    <span key={idx} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '3px', padding: '1px 5px', fontSize: '0.68rem' }}>
                                        {attr.label}: <strong style={{ color: '#374151' }}>{attr.value}</strong>
                                    </span>
                                ))}
                            </div>
                        )}
                        {item.details.lineItems.map((li, idx) => (
                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: idx < item.details.lineItems.length - 1 ? '1px dotted #e2e8f0' : 'none', paddingBottom: '2px', marginBottom: '2px' }}>
                                <span>{li.label}{li.meta?.l ? ` (${li.meta.l}×${li.meta.w}${li.meta.u || ''})` : ''}</span>
                                <span style={{ fontFamily: 'monospace' }}>
                                    {li.qty} × {li.rate.toFixed(0)} = <strong style={{ color: '#1e293b' }}>{li.total.toFixed(0)}</strong>
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </td>
            <td style={{ padding: '12px 0', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#1e293b', verticalAlign: 'top', fontSize: '0.875rem' }}>
                {item.totalPrice.toFixed(2)}
            </td>
        </tr>
    );
};

export default InvoiceItemRow;
