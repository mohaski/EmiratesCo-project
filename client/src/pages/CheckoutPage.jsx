import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export default function CheckoutPage() {
    const location = useLocation();
    const navigate = useNavigate();
    const { cartItems = [], customer } = location.state || {};

    const [loading, setLoading] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState(null); // Force user selection
    const [discount, setDiscount] = useState('');
    const [isPartial, setIsPartial] = useState(false);
    const [amountPaid, setAmountPaid] = useState(''); // Only used if isPartial is true
    const [cashAmount, setCashAmount] = useState('');
    const [mpesaAmount, setMpesaAmount] = useState('');

    // Calculations
    const subtotal = cartItems.reduce((sum, item) => sum + item.totalPrice, 0);
    const tax = subtotal * 0.05;
    // Discount is NOT allowed for Partial/Credit orders
    const discountValue = isPartial ? 0 : (parseFloat(discount) || 0);
    const total = Math.max(0, subtotal + tax - discountValue);

    // Logic for amount to currently pay
    const currentPayable = isPartial ? (parseFloat(amountPaid) || 0) : total;
    const balance = Math.max(0, total - currentPayable);

    const isRegistered = customer && customer.id && !customer.id.toString().startsWith('walk-in');

    const handlePayment = () => {
        setLoading(true);
        // Mock payment delay
        setTimeout(() => {
            setLoading(false);
            alert('Payment Successful! Order Placed.');
            navigate('/');
        }, 2000);
    };

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

            {/* --- LEFT: ORDER SUMMARY (Main Content) --- */}
            <div className="flex-1 p-8 md:p-12 overflow-y-auto">
                <div className="max-w-4xl mx-auto">
                    {/* Header Nav */}
                    <button
                        onClick={() => navigate('/sales', { state: { cartItems, customer } })}
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
                        {/* Table Header */}
                        <div className="grid grid-cols-12 gap-4 p-6 bg-gray-50 border-b border-gray-100 text-xs font-bold text-gray-400 uppercase tracking-wider">
                            <div className="col-span-6 md:col-span-7">Item Description</div>
                            <div className="col-span-3 md:col-span-3 text-right">Breakdown</div>
                            <div className="col-span-3 md:col-span-2 text-right">Total</div>
                        </div>

                        <div className="divide-y divide-gray-100">
                            {cartItems.map((item, idx) => (
                                <div key={idx} className="grid grid-cols-12 gap-6 p-6 hover:bg-gray-50/50 transition-colors group">
                                    {/* Product Info */}
                                    <div className="col-span-6 md:col-span-7 flex gap-5">
                                        <div className="w-20 h-20 rounded-xl bg-gray-100 overflow-hidden flex-shrink-0 border border-gray-100 shadow-sm">
                                            <img src={item.image} className="w-full h-full object-cover mix-blend-multiply opacity-90" alt="" />
                                        </div>
                                        <div className="flex flex-col justify-center">
                                            <h4 className="font-bold text-gray-900 text-lg leading-tight mb-1">{item.name}</h4>
                                            <div className="flex gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                                                {item.details.color && <span className="bg-gray-100 px-2 py-0.5 rounded">{item.details.color}</span>}
                                                {item.details.thickness && <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded">{item.details.thickness}</span>}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Breakdown Column */}
                                    <div className="col-span-3 md:col-span-3 flex flex-col justify-center text-right text-xs text-gray-500 font-mono space-y-1">
                                        {item.details.glassItems ? (
                                            item.details.glassItems.map((gi, gIdx) => (
                                                <div key={gIdx}>
                                                    <span className="text-gray-600">
                                                        {gi.type === 'cut' && gi.l && gi.w && gi.u
                                                            ? `Cut: ${gi.l}x${gi.w} ${gi.u}`
                                                            : gi.label}
                                                    </span> <span className="text-gray-400">x{gi.q}</span>
                                                </div>
                                            ))
                                        ) : (
                                            <>
                                                {item.details.full > 0 && <div>Full Len x{item.details.full}</div>}
                                                {item.details.half > 0 && <div>Half Len x{item.details.half}</div>}
                                                {item.details.fullSheet > 0 && <div>Full Sheet x{item.details.fullSheet}</div>}
                                                {item.details.cutPieces?.length > 0 && <div className="text-blue-500 font-bold">{item.details.cutPieces.length} custom cuts</div>}
                                            </>
                                        )}
                                    </div>

                                    {/* Price Column */}
                                    <div className="col-span-3 md:col-span-2 flex items-center justify-end">
                                        <span className="font-bold text-xl text-gray-900 tracking-tight">Ksh{item.totalPrice.toFixed(0)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* --- RIGHT: PAYMENT SIDEBAR --- */}
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

                    {/* Discount Section - Not available for Partial/Later */}
                    {!isPartial && (
                        <div className="space-y-3 animate-fade-in">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wide flex justify-between">
                                <span>Discount</span>
                                <span className="text-gray-300">Optional</span>
                            </label>
                            <div className="relative">
                                <span className="absolute left-4 top-3.5 text-gray-400 font-bold"></span>
                                <input
                                    type="number"
                                    value={discount}
                                    onChange={(e) => setDiscount(e.target.value)}
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-8 pr-4 font-bold text-gray-900 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder-gray-300"
                                    placeholder="0.00"
                                />
                            </div>
                        </div>
                    )}

                    {/* Payment Mode (Full vs Partial) - REGISTERED ONLY */}
                    {isRegistered && (
                        <div className="p-1 bg-gray-100 rounded-xl flex">
                            <button
                                onClick={() => setIsPartial(false)}
                                className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${!isPartial ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Pay Full
                            </button>
                            <button
                                onClick={() => setIsPartial(true)}
                                className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${isPartial ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Pay Later / Partial
                            </button>
                        </div>
                    )}

                    {/* Partial Amount Input */}
                    {isRegistered && isPartial && (
                        <div className="space-y-3 animate-fade-in">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wide">Amount Paying Now</label>
                            <div className="relative">
                                <span className="absolute left-4 top-3.5 text-green-600 font-bold">Ksh</span>
                                <input
                                    type="number"
                                    value={amountPaid}
                                    onChange={(e) => setAmountPaid(e.target.value)}
                                    className="w-full bg-green-50/50 border border-green-200 rounded-xl py-3 pl-8 pr-4 font-bold text-green-900 focus:border-green-500 outline-none transition-all"
                                    placeholder="Enter amount..."
                                />
                            </div>
                            <div className="text-xs font-bold text-red-500 text-right">
                                Balance: Ksh{(total - (parseFloat(amountPaid) || 0)).toFixed(2)}
                            </div>
                        </div>
                    )}

                    {/* Method Selector (Only show if paying > 0) */}
                    {currentPayable > 0 && (
                        <div className="space-y-2 animate-fade-in">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wide">Select Payment Method</label>
                            <div className="grid grid-cols-3 gap-2">
                                <button
                                    onClick={() => setPaymentMethod('cash')}
                                    className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all h-24
                                        ${paymentMethod === 'cash'
                                            ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm ring-1 ring-blue-500'
                                            : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                                        }`}
                                >
                                    <span className="text-2xl mb-1">💵</span>
                                    <span className="font-bold text-sm">Cash</span>
                                </button>
                                <button
                                    onClick={() => setPaymentMethod('mpesa')}
                                    className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all h-24
                                        ${paymentMethod === 'mpesa'
                                            ? 'border-green-500 bg-green-50 text-green-700 shadow-sm ring-1 ring-green-500'
                                            : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                                        }`}
                                >
                                    <span className="text-2xl mb-1">📱</span>
                                    <span className="font-bold text-sm">M-Pesa</span>
                                </button>
                                <button
                                    onClick={() => setPaymentMethod('split')}
                                    className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all h-24
                                        ${paymentMethod === 'split'
                                            ? 'border-purple-500 bg-purple-50 text-purple-700 shadow-sm ring-1 ring-purple-500'
                                            : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                                        }`}
                                >
                                    <span className="text-2xl mb-1">⚖️</span>
                                    <span className="font-bold text-sm">Split</span>
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Split Form */}
                    {currentPayable > 0 && paymentMethod === 'split' && (
                        <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-3 animate-fade-in relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-1 h-full bg-purple-500"></div>
                            <div className="space-y-2">
                                <div className="flex justify-between text-xs font-bold text-gray-500 uppercase">
                                    <span>Cash</span>
                                </div>
                                <input
                                    type="number"
                                    className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 font-mono font-bold outline-none focus:border-purple-500"
                                    value={cashAmount}
                                    onChange={(e) => setCashAmount(e.target.value)}
                                    placeholder="0"
                                />
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between text-xs font-bold text-gray-500 uppercase">
                                    <span>M-Pesa</span>
                                </div>
                                <input
                                    type="number"
                                    className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 font-mono font-bold outline-none focus:border-purple-500"
                                    value={mpesaAmount}
                                    onChange={(e) => setMpesaAmount(e.target.value)}
                                    placeholder="0"
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-8 bg-white border-t border-gray-200 space-y-4 shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between text-gray-500">
                            <span>Subtotal</span>
                            <span className="font-mono">Ksh{subtotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-gray-500">
                            <span>VAT (5%)</span>
                            <span className="font-mono">Ksh{tax.toFixed(2)}</span>
                        </div>
                        {discountValue > 0 && (
                            <div className="flex justify-between text-green-600 font-bold">
                                <span>Discount</span>
                                <span className="font-mono">-${discountValue.toFixed(2)}</span>
                            </div>
                        )}
                        <div className="flex justify-between text-gray-900 font-bold pt-2 border-t border-gray-100">
                            <span>Total</span>
                            <span className="font-mono text-lg">Ksh{total.toFixed(2)}</span>
                        </div>
                    </div>

                    {/* Pay Button */}
                    <button
                        onClick={handlePayment}
                        disabled={loading || (currentPayable > 0 && !paymentMethod)}
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

        </div>
    );
}
