import { useOrders } from '../context/OrderContext';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMemo } from 'react';
import logo from '../assets/logo.png';
import { useProducts } from '../context/ProductContext';
import InvoiceItemRow from '../components/invoices/InvoiceItemRow';
import { useCart } from '../context/CartContext';
import { useCartTotals } from '../hooks/useCartTotals';

export default function InvoiceReviewPage() {
    const { addInvoice } = useOrders();
    const { products: PRODUCTS } = useProducts();
    const location = useLocation();
    const navigate = useNavigate();

    const { cartItems: ctxCart, customer: ctxCustomer, taxEnabled: ctxTax } = useCart();

    const { cartItems, customer, savedInvoice, enableTax } = useMemo(() => {
        if (location.state?.invoice) {
            return { cartItems: location.state.invoice.items || [], customer: location.state.invoice.customer, savedInvoice: location.state.invoice, enableTax: location.state.invoice.vat_enabled ?? false };
        }
        return { cartItems: ctxCart, customer: ctxCustomer, savedInvoice: null, enableTax: location.state?.enableTax !== undefined ? location.state.enableTax : ctxTax };
    }, [location.state, ctxCart, ctxCustomer, ctxTax]);

    const productMap = useMemo(() => PRODUCTS.reduce((acc, p) => { acc[p.id] = p; return acc; }, {}), [PRODUCTS]);

    const invoiceMeta = useMemo(() => ({
        number: savedInvoice ? savedInvoice.id : `INV-${Date.now().toString().slice(-6)}`,
        date: savedInvoice
            ? new Date(savedInvoice.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
            : new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    }), [savedInvoice]);

    const { subtotal, tax, total } = useCartTotals(cartItems, enableTax);
    const totals = useMemo(() => ({ grandTotal: subtotal, vat: tax, total }), [subtotal, tax, total]);

    const handleSave = () => {
        if (!customer || cartItems.length === 0) return;
        addInvoice({ ...invoiceMeta, customer, items: cartItems, totals, type: 'invoice' });
        navigate('/orders');
    };

    const handlePrint = () => window.print();

    if (!customer) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1rem', background: 'var(--color-bg)' }}>
                <p style={{ color: '#64748b', fontSize: '0.875rem' }}>No invoice data found.</p>
                <button onClick={() => navigate('/invoice')} style={{ color: '#fbbf24', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.875rem' }}>← Return to Generator</button>
            </div>
        );
    }

    return (
        <div style={{ minHeight: '100vh', background: 'var(--color-bg)', padding: '3rem 1rem' }} className="print:bg-white print:p-0">
            <style type="text/css" media="print">{`
                @page { size: auto; margin: 20mm; }
                body { background-color: white !important; }
                table { page-break-inside: auto; }
                tr { page-break-inside: avoid; break-inside: avoid; }
                thead { display: table-header-group; }
                tfoot { display: table-footer-group; }
                .print-hidden { display: none !important; }
            `}</style>

            {/* Action Bar */}
            <div className="print-hidden" style={{ maxWidth: '210mm', margin: '0 auto 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                    <button onClick={() => navigate('/invoice', { state: { mode: 'edit', enableTax } })} style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)',
                        borderRadius: '0.75rem', padding: '0.5rem 1rem', color: '#94a3b8', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem', transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#f1f5f9'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)'; }}>
                        ← Back to Edit
                    </button>
                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                        <button onClick={handleSave} style={{
                            padding: '0.625rem 1.5rem', borderRadius: '0.75rem', border: '1px solid rgba(255,255,255,0.12)',
                            background: 'rgba(255,255,255,0.07)', color: '#e2e8f0', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}>
                            💾 Save as Draft
                        </button>
                        <button onClick={handlePrint} style={{
                            padding: '0.625rem 1.5rem', borderRadius: '0.75rem', border: 'none',
                            background: 'linear-gradient(135deg, rgba(245,158,11,0.85), rgba(234,88,12,0.85))',
                            color: '#fff', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
                            boxShadow: '0 4px 16px rgba(245,158,11,0.25)', transition: 'all 0.2s',
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                        }}>
                            🖨️ Print Invoice
                        </button>
                    </div>
                </div>
            </div>

            {/* A4 Paper — always white for printing */}
            <div style={{ overflowX: 'auto', paddingBottom: '3rem' }}>
                <div style={{
                    maxWidth: '210mm', minWidth: '210mm', minHeight: '297mm', margin: '0 auto',
                    background: '#ffffff', boxShadow: '0 4px 40px rgba(0,0,0,0.4)', padding: '48px',
                    display: 'flex', flexDirection: 'column', color: '#1e293b', fontFamily: 'var(--font-sans)',
                }} className="print:shadow-none print:p-0 print:mx-0">

                    {/* Invoice Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #0f172a', paddingBottom: '2rem', marginBottom: '2rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <img src={logo} alt="EmiratesCo" style={{ height: '64px', objectFit: 'contain' }} />
                            <div>
                                <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', margin: '0 0 2px', letterSpacing: '-0.02em' }}>EmiratesCo</h1>
                                <p style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 600, margin: '0 0 4px' }}>Aluminium & Glass</p>
                                <p style={{ fontSize: '0.72rem', color: '#94a3b8', margin: 0 }}>Dubai, UAE</p>
                            </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <h2 style={{ fontSize: '2.5rem', fontWeight: 900, color: '#e2e8f0', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 1rem' }}>Invoice</h2>
                            <table style={{ marginLeft: 'auto', borderSpacing: 0 }}>
                                <tbody>
                                    <tr>
                                        <td style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 700, paddingRight: '1rem', paddingBottom: '4px' }}>Date:</td>
                                        <td style={{ fontSize: '0.8rem', color: '#0f172a', fontFamily: 'monospace', fontWeight: 600 }}>{invoiceMeta.date}</td>
                                    </tr>
                                    <tr>
                                        <td style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 700, paddingRight: '1rem' }}>Invoice #:</td>
                                        <td style={{ fontSize: '0.8rem', color: '#0f172a', fontFamily: 'monospace', fontWeight: 600 }}>{invoiceMeta.number}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Bill To */}
                    <div style={{ marginBottom: '3rem' }}>
                        <p style={{ fontSize: '0.65rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Bill To</p>
                        <p style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a', margin: '0 0 4px' }}>{customer.name}</p>
                        {customer.phone && <p style={{ fontSize: '0.82rem', color: '#475569', fontFamily: 'monospace', margin: '0 0 4px' }}>{customer.phone}</p>}
                        <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0 }}>{customer.type === 'new' ? 'New Customer' : 'Registered Client'}</p>
                    </div>

                    {/* Items Table */}
                    <div style={{ flex: 1 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid #0f172a' }}>
                                    <th style={{ paddingBottom: '0.75rem', fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', width: '40px' }}>#</th>
                                    <th style={{ paddingBottom: '0.75rem', fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Description</th>
                                    <th style={{ paddingBottom: '0.75rem', fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'right', width: '120px' }}>Amount (KSH)</th>
                                </tr>
                            </thead>
                            <tbody style={{ borderBottom: '1px solid #e2e8f0' }}>
                                {cartItems.map((item, idx) => (
                                    <InvoiceItemRow key={idx} item={item} index={idx} productDef={productMap[item.id]} />
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Totals */}
                    <div style={{ borderTop: '2px solid #0f172a', paddingTop: '2rem', marginTop: '2rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <div style={{ width: '240px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.625rem' }}>
                                    <span style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 600 }}>Subtotal</span>
                                    <span style={{ fontSize: '0.82rem', color: '#1e293b', fontFamily: 'monospace', fontWeight: 600 }}>KSH {totals.grandTotal.toFixed(2)}</span>
                                </div>
                                {enableTax && (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.625rem' }}>
                                        <span style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 600 }}>VAT (5%)</span>
                                        <span style={{ fontSize: '0.82rem', color: '#1e293b', fontFamily: 'monospace', fontWeight: 600 }}>KSH {totals.vat.toFixed(2)}</span>
                                    </div>
                                )}
                                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e2e8f0', paddingTop: '0.75rem', marginTop: '0.375rem' }}>
                                    <span style={{ fontSize: '1.1rem', fontWeight: 900, color: '#0f172a' }}>Total</span>
                                    <span style={{ fontSize: '1.1rem', fontWeight: 900, color: '#0f172a', fontFamily: 'monospace' }}>KSH {totals.total.toFixed(2)}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div style={{ marginTop: 'auto', paddingTop: '3rem', borderTop: '1px solid #f1f5f9', textAlign: 'center' }}>
                        <p style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Thank you for your business · EmiratesCo Aluminium & Glass · Dubai, UAE</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
