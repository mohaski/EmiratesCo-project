import React, { useMemo, useCallback, memo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCartTotals } from '../../hooks/useCartTotals';

// --- OPTIMIZATION 1: Extract and Memoize the List Item ---
// This prevents every single item from re-rendering when you add/remove just one.
const CartItem = memo(({ item, index, onEdit, onRemove }) => {
    return (
        <div className="group relative animate-fade-in">
            {/* Top Row: Image & Name & Price */}
            <div className="flex gap-4 mb-3">
                <div className="w-12 h-12 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0">
                    <img
                        src={item.image}
                        loading="lazy"
                        className="w-full h-full object-cover mix-blend-multiply opacity-80 group-hover:opacity-100 transition-opacity"
                        alt={item.name}
                    />
                </div>
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <div className="flex justify-between items-start">
                        <h4 className="text-gray-900 font-bold text-sm leading-tight pr-4">{item.name}</h4>
                        <span className="text-gray-900 font-bold text-sm leading-tight">Ksh{(item.totalPrice || 0).toFixed(0)}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                        <button
                            onClick={() => onEdit(index)}
                            className="text-xs text-blue-500 font-medium opacity-0 group-hover:opacity-100 transition-opacity -ml-1 px-1 hover:bg-blue-50 rounded flex items-center gap-1"
                        >
                            ✏️ Edit
                        </button>
                        <span className="text-gray-300 text-xs opacity-0 group-hover:opacity-100 transition-opacity">•</span>
                        <button
                            onClick={() => onRemove(index)}
                            className="text-xs text-red-500 font-medium opacity-0 group-hover:opacity-100 transition-opacity px-1 hover:bg-red-50 rounded"
                        >
                            Remove
                        </button>
                    </div>
                </div>
            </div>

            {/* Item Details */}
            <div className="pl-[64px] text-xs text-gray-500 space-y-2">
                {/* Meta Tags */}
                <div className="flex gap-3 mb-2 text-[11px] font-medium tracking-wide text-gray-400 uppercase flex-wrap">
                    {item.details.description && <span className="text-gray-600 font-bold">{item.details.description}</span>}
                    {item.details.color && (
                        <span className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: item.details.color === 'White' ? '#eee' : item.details.color }}></span>
                            {item.details.color}
                        </span>
                    )}

                    {/* Universal Attributes (New) */}
                    {item.details.attributes && item.details.attributes.length > 0 && (
                        item.details.attributes.map((attr, idx) => (
                            <span key={idx} className={attr.label === 'Thickness' ? 'text-blue-500' : ''}>
                                {/* Hide Label for specific obvious attributes if desired, or show generic */}
                                {attr.label === 'Color' ? (
                                    <span className="flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: attr.value === 'White' ? '#eee' : attr.value }}></span>
                                        {attr.value}
                                    </span>
                                ) : (
                                    <span>{attr.value}{attr.label === 'Length' && typeof attr.value === 'number' ? 'ft' : ''}</span>
                                )}
                            </span>
                        ))
                    )}

                    {/* Legacy Extras (Old) */}
                    {!item.details.attributes && item.details.extras ? (
                        Object.entries(item.details.extras).map(([key, val]) => {
                            if (key === 'Color' || key === 'Category') return null;
                            return (
                                <span key={key} className={key === 'Thickness' ? 'text-blue-500' : ''}>
                                    {val}{key === 'Length' && typeof val === 'number' ? 'ft' : ''}
                                </span>
                            );
                        }
                        )
                    ) : (
                        /* Legacy Simple Fields fallback */
                        !item.details.attributes && (
                            <>
                                {item.details.length && <span>{item.details.length}FT</span>}
                                {item.details.thickness && <span className="text-blue-500">{item.details.thickness}</span>}
                            </>
                        )
                    )}
                </div>

                {/* Universal Line Items Rendering */}
                {item.details?.lineItems && item.details.lineItems.length > 0 ? (
                    <div className="pt-2 space-y-1">
                        {item.details.lineItems.map((li, idx) => (
                            <div key={idx} className="flex justify-between items-start font-mono text-[11px] leading-tight group/line">
                                <div className="flex flex-col">
                                    <span className="text-gray-700 font-medium">{li.label}</span>
                                    {li.meta && Object.keys(li.meta).length > 0 && (
                                        <span className="text-[10px] text-gray-400">
                                            {Object.entries(li.meta).map(([k, v]) => {
                                                if (k === 'unit' || k === 'length') return `${v}${k === 'length' ? 'ft' : ''}`;
                                                return `${k}:${v}`;
                                            }).join(' ')}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-baseline gap-3">
                                    <span className="text-gray-400 text-[10px]">x{li.qty}</span>
                                    <span className="text-gray-900 font-bold">Ksh{(li.total || 0).toFixed(0)}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    /* Legacy Fallback for older items or direct qty items */
                    item.details?.qty > 0 && (
                        <div className="flex items-baseline justify-between mt-2">
                            <span>Quantity</span>
                            <span className="flex-1 mx-2 border-b border-dotted border-gray-200 translate-y-[-3px]"></span>
                            <span className="font-mono text-gray-900 font-medium">x{item.details.qty}</span>
                        </div>
                    )
                )}


            </div>
        </div>
    );
});

// --- MAIN COMPONENT ---
export default function CartSidebar({ cartItems, onRemoveItem, onEditItem, customer, onChangeCustomer, actionLabel, onAction, mode, originalTotal = 0, enableTax, onToggleTax }) {
    const navigate = useNavigate();

    // --- OPTIMIZATION 2: Memoize Financial Math ---
    // Only recalculate when cartItems or originalTotal changes
    // --- OPTIMIZATION 2: Centralized Financials via Hook ---
    const { subtotal: subTotal, tax: vat, total: grandTotal } = useCartTotals(cartItems, enableTax);

    // Balance / Edit Mode Logic (Specific to this component's needs)
    const balance = grandTotal - originalTotal;
    const isOwing = balance > 0;
    const isRefund = balance < 0;
    const isBalanced = Math.abs(balance) < 10;

    // --- OPTIMIZATION 3: Stable Handler ---
    const handleAction = useCallback(() => {
        if (onAction) {
            onAction();
        } else {
            navigate('/checkout', {
                state: {
                    cartItems,
                    customer,
                    enableTax // Pass tax state
                }
            });
        }
    }, [onAction, navigate, cartItems, customer, enableTax]);

    return (
        <div className="w-96 flex-shrink-0 bg-white border-l border-gray-100 flex flex-col h-full shadow-[0_0_50px_rgba(0,0,0,0.05)] z-30 font-sans tracking-tight">

            {/* Header */}
            <div className="px-8 py-8 bg-white z-10">
                <div className="flex items-center justify-between mb-8">
                    <div className="flex flex-col">
                        <h2 className="text-2xl font-bold text-gray-900">{mode === 'edit' ? 'Editing Order' : 'Order'}</h2>
                        <button
                            onClick={onChangeCustomer}
                            className="text-left group flex items-center gap-2 hover:bg-gray-50 -ml-2 px-2 py-1 rounded-lg transition-colors"
                        >
                            <span className="text-gray-400 text-sm font-medium">
                                {customer ? (
                                    <span className="text-blue-600 font-bold group-hover:underline">{customer.name}</span>
                                ) : (
                                    "Select Customer"
                                )}
                            </span>
                            <span className="text-xs text-gray-300 group-hover:text-blue-500">
                                {customer ? '(Change)' : '▼'}
                            </span>
                        </button>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-gray-400">
                        {customer ? (customer.type === 'corporate' ? '🏢' : '👤') : '👤'}
                    </div>
                </div>

                {/* Search/Customer Note */}
                <div className="relative">
                    <input
                        type="text"
                        placeholder={customer ? "Add specific note..." : "Add customer note..."}
                        className="w-full bg-gray-50 border-none rounded-lg py-3 px-4 text-gray-900 text-sm focus:ring-2 focus:ring-blue-500/20 transition-all outline-none placeholder-gray-400 font-medium"
                    />
                </div>
            </div>

            {/* Cart Items List */}
            <div className="flex-1 overflow-y-auto px-8 pb-4 space-y-8 custom-scrollbar">
                {(cartItems || []).length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-300 space-y-4 opacity-60">
                        <span className="text-4xl grayscale">🛒</span>
                        <p className="font-medium">No items added</p>
                    </div>
                ) : (
                    cartItems.map((item, idx) => (
                        <CartItem
                            key={`${item.id || 'item'}-${idx}`} // Prefer Unique ID if available, fallback to idx
                            item={item}
                            index={idx}
                            onEdit={onEditItem}
                            onRemove={onRemoveItem}
                        />
                    ))
                )}
            </div>

            {/* Footer / Checkout */}
            <div className="p-8 bg-gray-50 border-t border-gray-100 z-10">
                {originalTotal > 0 && (
                    <div className="mb-4 pt-2 border-t border-gray-200">
                        <div className="flex justify-between text-gray-400 text-xs mb-1">
                            <span className="font-medium">Original Paid</span>
                            <span className="font-mono">Ksh{originalTotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-baseline">
                            <span className={`font-bold text-sm ${isOwing ? 'text-amber-600' : isRefund ? 'text-blue-600' : 'text-green-600'}`}>
                                {isOwing ? 'Balance Due' : isRefund ? 'Refund Due' : 'Status'}
                            </span>
                            <span className={`font-bold text-xl font-mono ${isOwing ? 'text-amber-600' : isRefund ? 'text-blue-600' : 'text-green-600'}`}>
                                {isBalanced ? 'Balanced' : `Ksh${Math.abs(balance).toFixed(2)}`}
                            </span>
                        </div>
                    </div>
                )}

                {originalTotal === 0 && (
                    <div className="space-y-4 mb-8">
                        <div className="flex justify-between text-gray-500 text-sm group relative">
                            <div className="flex items-center gap-2">
                                <span className="font-medium">Subtotal</span>
                                {/* Stealth Tax Toggle */}
                                <input
                                    type="checkbox"
                                    checked={enableTax}
                                    onChange={(e) => onToggleTax && onToggleTax(e.target.checked)}
                                    className="w-3 h-3 rounded border-gray-300 text-gray-400 focus:ring-0 opacity-0 group-hover:opacity-30 transition-opacity cursor-pointer"
                                    title="Toggle Tax"
                                />
                            </div>
                            <span className="font-mono tracking-tight">Ksh{subTotal.toFixed(2)}</span>
                        </div>

                        {enableTax && (
                            <div className="flex justify-between text-gray-500 text-sm animate-fade-in">
                                <span className="font-medium">VAT (16%)</span>
                                <span className="font-mono tracking-tight">Ksh{vat.toFixed(2)}</span>
                            </div>
                        )}

                        <div className="flex justify-between text-gray-900 items-baseline pt-4 border-t border-gray-200">
                            <span className="font-bold text-xl">Total</span>
                            <span className="font-bold text-3xl tracking-tighter">Ksh{grandTotal.toFixed(2)}</span>
                        </div>
                    </div>
                )}

                <button
                    onClick={handleAction}
                    disabled={cartItems.length === 0}
                    className={`w-full py-4 rounded-xl font-bold text-white shadow-xl transform active:scale-[0.99] transition-all flex items-center justify-between px-6 disabled:opacity-50 disabled:cursor-not-allowed
                        ${mode === 'edit'
                            ? (isRefund ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-900/10' : 'bg-amber-600 hover:bg-amber-700 shadow-amber-900/10')
                            : 'bg-gray-900 hover:bg-black shadow-gray-900/10'
                        }`}
                >
                    <span>
                        {mode === 'edit'
                            ? (isOwing ? 'Confirm & Pay' : isRefund ? 'Confirm Refund' : 'Update Order')
                            : (actionLabel || 'Checkout')}
                    </span>
                    <span className="font-mono opacity-80">
                        {mode === 'edit'
                            ? (isBalanced ? '✓' : `Ksh${Math.abs(balance).toFixed(0)}`)
                            : `Ksh${grandTotal.toFixed(0)}`}
                    </span>
                </button>
            </div>
        </div>
    );
}