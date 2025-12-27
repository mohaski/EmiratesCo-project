import React, { useState, useMemo, useCallback, memo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PRODUCTS } from '../data/mockProducts';
import { useCart } from '../context/CartContext';
import { useCartTotals } from '../hooks/useCartTotals';

// --- SUB-COMPONENT: Memoized Item Card ---
// Extracts complex rendering logic so the list doesn't re-render when payment inputs change
// --- SUB-COMPONENT: Memoized Item Card ---
const ReviewItemCard = memo(({ item }) => {
    // Helper to find product def safely
    return (
        <div className="grid grid-cols-12 gap-6 p-6 hover:bg-gray-50/50 transition-colors group border-b border-gray-100 last:border-0">
            {/* Product Info */}
            <div className="col-span-6 md:col-span-7 flex gap-5">
                <div className="w-20 h-20 rounded-xl bg-gray-100 overflow-hidden flex-shrink-0 border border-gray-100 shadow-sm">
                    <img src={item.image} loading="lazy" className="w-full h-full object-cover mix-blend-multiply opacity-90" alt={item.name} />
                </div>
                <div className="flex flex-col justify-center">
                    <h4 className="font-bold text-gray-900 text-lg leading-tight mb-1">{item.name}</h4>
                    <div className="flex gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                        {item.details.color && <span className="bg-gray-100 px-2 py-0.5 rounded">{item.details.color}</span>}
                        {item.details.thickness && <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded">{item.details.thickness}</span>}
                    </div>
                </div>
            </div>

            {/* Breakdown Column (Receipt Style) */}
            <div className="col-span-12 md:col-span-3 flex flex-col justify-center text-sm text-gray-600 font-mono">
                {/* --- UNIVERSAL RENDERER (New Schema Only) --- */}
                {item.details.lineItems && (
                    <div className="space-y-2 w-full">
                        {/* 1. Attributes (Metadata) */}
                        {item.details.attributes && item.details.attributes.length > 0 && (
                            <div className="pb-2 mb-2 border-b border-gray-100 border-dashed">
                                {item.details.attributes.map((attr, idx) => (
                                    <div key={idx} className="flex justify-between items-baseline">
                                        <span className="text-gray-500 text-xs">{attr.label}</span>
                                        <span className="flex-1 border-b border-gray-200 border-dotted mx-2"></span>
                                        <span className="text-gray-800 font-semibold text-xs">{attr.value}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* 2. Line Items (Receipt) */}
                        {item.details.lineItems.map((li, idx) => (
                            <div key={idx} className="flex justify-between items-baseline">
                                <div className="flex flex-col">
                                    <span className="text-xs text-gray-700">{li.label}</span>
                                    {li.meta && (li.meta.length || (li.meta.l && `${li.meta.l}x${li.meta.w}`)) && (
                                        <span className="text-[10px] text-gray-400">
                                            {li.meta.length || `${li.meta.l}x${li.meta.w} ${li.meta.u || ''}`}
                                        </span>
                                    )}
                                </div>
                                <span className="flex-1 border-b border-gray-300 border-dotted mx-2 relative top-[-4px]"></span>
                                <span className="whitespace-nowrap">
                                    <span className="text-xs text-gray-800">
                                        {li.qty} x <span className="font-bold">{li.rate.toFixed(0)}=</span>
                                    </span>
                                    <span className="font-bold ml-1 text-gray-900">Ksh{li.total.toFixed(0)}</span>
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Price Column */}
            <div className="col-span-3 md:col-span-2 flex items-center justify-end">
                <span className="font-bold text-xl text-gray-900 tracking-tight">Ksh{item.totalPrice.toFixed(0)}</span>
            </div>
        </div>
    );
});

export default function CheckoutPage() {
    const location = useLocation();
    const navigate = useNavigate();

    // --- GLOBAL STATE (Context) ---
    const { cartItems, customer, taxEnabled: enableTax, clearCart } = useCart();

    // Mode specific state still comes from location (e.g. are we editing?)
    const { mode, originalTotal = 0 } = location.state || {};

    const [loading, setLoading] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState(null);
    const [discount, setDiscount] = useState('');
    const [isPartial, setIsPartial] = useState(false);
    const [amountPaid, setAmountPaid] = useState('');
    const [cashAmount, setCashAmount] = useState('');

    const isRegistered = useMemo(() => {
        if (!customer) return false;
        // Strict check: Only allow credit for specific account types
        const CREDIT_TYPES = ['registered', 'corporate', 'frequent'];
        return CREDIT_TYPES.includes(customer.type);
    }, [customer]);

    // --- OPTIMIZATION: Memoize Financials ---
    // --- OPTIMIZATION: Memoize Financials via Hook ---
    const { subtotal, tax, total: baseTotal } = useCartTotals(cartItems, enableTax);

    const financials = useMemo(() => {
        const discountValue = isPartial ? 0 : (parseFloat(discount) || 0);
        const total = Math.max(0, baseTotal - discountValue);

        // Edit Mode Logic
        const effectiveTotal = mode === 'edit' ? (total - originalTotal) : total;
        // If effectiveTotal is negative, it's a refund. If positive, it's balance due.

        // Payment Logic
        // For edit mode, we default to paying the difference
        const currentPayable = isPartial ? (parseFloat(amountPaid) || 0) : Math.max(0, effectiveTotal);

        const balance = Math.max(0, total - ((mode === 'edit' ? originalTotal : 0) + currentPayable));
        const mpesaAutoAmount = Math.max(0, currentPayable - (parseFloat(cashAmount) || 0));

        return { subtotal, tax, discountValue, total, currentPayable, balance, mpesaAutoAmount, effectiveTotal, originalTotal };
    }, [baseTotal, subtotal, tax, discount, isPartial, amountPaid, cashAmount, mode, originalTotal]);

    const { discountValue, total, currentPayable, balance, mpesaAutoAmount, effectiveTotal } = financials;

    // --- OPTIMIZATION: Stable Handler ---
    // --- OPTIMIZATION: Stable Handler ---
    const handlePayment = useCallback(() => {
        setLoading(true);
        setTimeout(() => {
            setLoading(false);
            alert('Payment Successful! Order Placed.');
            clearCart(); // Clear context state
            navigate('/');
        }, 2000);
    }, [navigate, clearCart]);

    if (cartItems.length === 0) {
        return (
            <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">Your Cart is Empty</h2>
                <button onClick={() => navigate('/sales')} className="text-blue-600 hover:underline">Return to Sales</button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#F8F9FA] font-sans text-gray-900 flex flex-col md:flex-row">

            {/* --- LEFT: ORDER SUMMARY (Memoized List) --- */}
            <div className="flex-1 p-8 md:p-12 overflow-y-auto">
                <div className="max-w-4xl mx-auto">
                    {/* Header Nav */}
                    {/* Header Nav */}
                    <button
                        onClick={() => navigate('/sales')}
                        className="text-gray-400 hover:text-gray-600 text-sm font-bold mb-6 flex items-center gap-2 transition-colors uppercase tracking-wide"
                    >
                        <span>←</span> Back to Dashboard
                    </button>

                    <div className="mb-10">
                        <h1 className="text-4xl font-bold tracking-tight text-gray-900">Order Details</h1>
                        <p className="text-gray-500 mt-2 text-lg">Review items and finalize payment.</p>
                    </div>

                    {/* Order Items List */}
                    <div className="bg-white rounded-3xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="grid grid-cols-12 gap-4 p-6 bg-gray-50 border-b border-gray-100 text-xs font-bold text-gray-400 uppercase tracking-wider">
                            <div className="col-span-6 md:col-span-7">Item Description</div>
                            <div className="col-span-3 md:col-span-3 text-right">Breakdown</div>
                            <div className="col-span-3 md:col-span-2 text-right">Total</div>
                        </div>

                        {/* List rendering is lightweight now */}
                        <div className="divide-y divide-gray-100">
                            {cartItems.map((item, idx) => (
                                <ReviewItemCard key={`${item.id}-${idx}`} item={item} />
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* --- RIGHT: PAYMENT SIDEBAR --- */}
            {/* Input changes here no longer re-render the left column items */}
            <div className="w-full md:w-[600px] bg-white border-l border-gray-200 h-auto md:h-screen sticky top-0 flex flex-col shadow-[-10px_0_40px_rgba(0,0,0,0.02)] z-20">
                <div className="p-8 border-b border-gray-100 bg-gray-50/50">
                    <h2 className="text-xl font-bold text-gray-900">Payment</h2>
                    <p className="text-sm text-gray-500 mt-1">Select method to complete order.</p>
                </div>

                <div className="flex-1 overflow-y-auto p-8 space-y-8">
                    {/* Customer Badge */}
                    <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-lg">👤</div>
                        <div>
                            <div className="text-xs font-bold text-blue-400 uppercase tracking-wider">Customer</div>
                            <div className="font-bold text-gray-900">{customer?.name || 'Walk-in Customer'}</div>
                            <div className="text-xs text-gray-500">{customer?.phone || ''}</div>
                        </div>
                    </div>

                    {/* Discount Input */}
                    {!isPartial && (
                        <div className="space-y-3">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wide flex justify-between">
                                <span>Discount</span>
                                <span className="text-gray-300">Optional</span>
                            </label>
                            <input
                                type="number"
                                value={discount}
                                onChange={(e) => setDiscount(e.target.value)}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-4 pr-4 font-bold text-gray-900 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder-gray-300"
                                placeholder="0.00"
                            />
                        </div>
                    )}

                    {/* Partial Toggle */}
                    {isRegistered && effectiveTotal > 0 && (
                        <div className="p-1 bg-gray-100 rounded-xl flex">
                            <button onClick={() => setIsPartial(false)} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${!isPartial ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Pay Full</button>
                            <button onClick={() => setIsPartial(true)} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${isPartial ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Pay Later / Partial</button>
                        </div>
                    )}

                    {/* Amount Paying Input */}
                    {isRegistered && isPartial && effectiveTotal > 0 && (
                        <div className="space-y-3">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wide">Amount Paying Now</label>
                            <div className="relative">
                                <span className="absolute left-4 top-3.5 text-green-600 font-bold">Ksh</span>
                                <input
                                    type="number"
                                    value={amountPaid}
                                    onChange={(e) => setAmountPaid(e.target.value)}
                                    className="w-full bg-green-50/50 border border-green-200 rounded-xl py-3 pl-12 pr-4 font-bold text-green-900 focus:border-green-500 outline-none transition-all"
                                    placeholder="Enter amount..."
                                />
                            </div>
                            <div className="text-xs font-bold text-amber-600 text-right">New Balance: Ksh{balance.toFixed(2)}</div>
                        </div>
                    )}

                    {/* Payment / Refund Method Selector */}
                    {effectiveTotal < 0 ? (
                        /* --- REFUND OPTIONS --- */
                        <div className="space-y-4">
                            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
                                <span className="text-2xl mt-1">⚠️</span>
                                <div>
                                    <h3 className="font-bold text-amber-900">Refund Required</h3>
                                    <p className="text-sm text-amber-700 mt-1">
                                        This order update results in a negative balance. Please select how to refund the customer.
                                    </p>
                                </div>
                            </div>

                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wide">Select Refund Method</label>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => setPaymentMethod('cash-refund')}
                                    className={`flex flex-col items-center justify-center p-4 rounded-xl border transition-all h-24
                                        ${paymentMethod === 'cash-refund'
                                            ? 'border-blue-500 bg-blue-50 text-blue-700 ring-1 ring-blue-500'
                                            : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                                        }`}
                                >
                                    <span className="text-2xl mb-1">💸</span>
                                    <span className="font-bold text-sm">Cash Refund</span>
                                </button>
                                {isRegistered && (
                                    <button
                                        onClick={() => setPaymentMethod('store-credit')}
                                        className={`flex flex-col items-center justify-center p-4 rounded-xl border transition-all h-24
                                            ${paymentMethod === 'store-credit'
                                                ? 'border-purple-500 bg-purple-50 text-purple-700 ring-1 ring-purple-500'
                                                : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                                            }`}
                                    >
                                        <span className="text-2xl mb-1">💳</span>
                                        <span className="font-bold text-sm">Store Credit</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    ) : (
                        /* --- STANDARD PAYMENT OPTIONS --- */
                        currentPayable > 0 && (
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-gray-400 uppercase tracking-wide">Select Payment Method</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {['cash', 'mpesa', 'split'].map(method => (
                                        <button
                                            key={method}
                                            onClick={() => setPaymentMethod(method)}
                                            className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all h-24 capitalize
                                                ${paymentMethod === method
                                                    ? method === 'split' ? 'border-purple-500 bg-purple-50 text-purple-700 ring-1 ring-purple-500' :
                                                        method === 'mpesa' ? 'border-green-500 bg-green-50 text-green-700 ring-1 ring-green-500' :
                                                            'border-blue-500 bg-blue-50 text-blue-700 ring-1 ring-blue-500'
                                                    : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                                                }`}
                                        >
                                            <span className="text-2xl mb-1">{method === 'cash' ? '💵' : method === 'mpesa' ? '📱' : '⚖️'}</span>
                                            <span className="font-bold text-sm">{method}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )
                    )}

                    {/* Split Form */}
                    {currentPayable > 0 && paymentMethod === 'split' && (
                        <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-3 relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-1 h-full bg-purple-500"></div>
                            <div className="space-y-2">
                                <span className="text-xs font-bold text-gray-500 uppercase">Cash</span>
                                <input
                                    type="number"
                                    className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 font-mono font-bold outline-none focus:border-purple-500"
                                    value={cashAmount}
                                    onChange={(e) => setCashAmount(e.target.value)}
                                    placeholder="0"
                                />
                            </div>
                            <div className="space-y-2">
                                <span className="text-xs font-bold text-gray-500 uppercase">M-Pesa</span>
                                <input
                                    type="number"
                                    className="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 font-mono font-bold outline-none text-gray-500 cursor-not-allowed"
                                    value={mpesaAutoAmount.toFixed(2)}
                                    readOnly
                                />
                            </div>
                            {(parseFloat(cashAmount) || 0) > currentPayable && (
                                <div className="text-red-500 text-xs font-bold pt-1">
                                    Cash violates total (Max: {currentPayable.toFixed(2)})
                                </div>
                            )}
                        </div>
                    )}
                </div>



                {/* Footer Totals & Pay */}
                <div className="p-8 bg-white border-t border-gray-200 space-y-4 shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between text-gray-500">
                            <span>Subtotal</span>
                            <span className="font-mono">Ksh{subtotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-gray-500">
                            <span>VAT (16%)</span>
                            <span className="font-mono">Ksh{tax.toFixed(2)}</span>
                        </div>
                        {discountValue > 0 && (
                            <div className="flex justify-between text-green-600 font-bold">
                                <span>Discount</span>
                                <span className="font-mono">-${discountValue.toFixed(2)}</span>
                            </div>
                        )}
                        {mode === 'edit' && (
                            <div className="flex justify-between text-blue-600 font-medium bg-blue-50 px-2 py-1 rounded">
                                <span>Original Paid</span>
                                <span className="font-mono">- Ksh{originalTotal.toFixed(2)}</span>
                            </div>
                        )}
                        <div className="flex justify-between text-gray-900 pt-2 border-t border-gray-100 font-bold text-lg items-baseline">
                            <span>
                                {mode === 'edit'
                                    ? (effectiveTotal >= 0 ? 'Balance Due' : 'Refund Due')
                                    : 'Total'}
                            </span>
                            <span className={`text-2xl tracking-tight ${mode === 'edit' ? (effectiveTotal >= 0 ? 'text-amber-600' : 'text-blue-600') : ''}`}>
                                Ksh{Math.abs(mode === 'edit' ? effectiveTotal : total).toFixed(2)}
                            </span>
                        </div>
                    </div>

                    <button
                        onClick={handlePayment}
                        disabled={loading || (currentPayable > 0 && !paymentMethod) || (paymentMethod === 'split' && (parseFloat(cashAmount) || 0) > currentPayable)}
                        className={`w-full py-4 rounded-xl font-bold shadow-xl transform active:scale-[0.99] transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed group
                            ${balance > 0 ? 'bg-orange-500 hover:bg-orange-600 text-white shadow-orange-500/20' : 'bg-gray-900 hover:bg-black text-white shadow-gray-900/10'}
                        `}
                    >
                        {loading ? (
                            <>
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                <span>Processing...</span>
                            </>
                        ) : (
                            <>
                                <span>{currentPayable === 0 ? 'Confirm On Credit' : (balance > 0 ? `Pay Ksh${currentPayable.toFixed(2)} & Credit Bal` : `Pay Ksh${total.toFixed(2)}`)}</span>
                                <span className="group-hover:translate-x-1 transition-transform">→</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div >
    );
}