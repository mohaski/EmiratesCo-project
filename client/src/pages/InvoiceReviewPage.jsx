import React, { useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PRODUCTS } from '../data/mockProducts';
import logo from '../assets/logo.png';

import InvoiceItemRow from '../components/invoices/InvoiceItemRow';

export default function InvoiceReviewPage() {
    const location = useLocation();
    const navigate = useNavigate();

    // Default to empty if accessed directly
    const { cartItems, customer } = location.state || { cartItems: [], customer: null };

    // --- OPTIMIZATION: Memoize Product Lookup Map ---
    // Converts array search O(n) to object lookup O(1)
    const productMap = useMemo(() => {
        return PRODUCTS.reduce((acc, p) => {
            acc[p.id] = p;
            return acc;
        }, {});
    }, []);

    // --- OPTIMIZATION: Stable Invoice Metadata ---
    // Prevents Date/Invoice# from changing if the component re-renders
    const invoiceMeta = useMemo(() => ({
        number: `INV-${Date.now().toString().slice(-6)}`,
        date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    }), []);

    // --- OPTIMIZATION: Memoize Totals ---
    const totals = useMemo(() => {
        const grandTotal = cartItems.reduce((sum, item) => sum + item.totalPrice, 0);
        const vat = grandTotal * 0.05;
        const total = grandTotal + vat;
        return { grandTotal, vat, total };
    }, [cartItems]);

    const handlePrint = () => {
        window.print();
    };

    if (!customer) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-100 flex-col gap-4">
                <p className="text-gray-500">No invoice data found.</p>
                <button onClick={() => navigate('/invoice')} className="text-blue-600 font-bold hover:underline">Return to Generator</button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-800 py-12 px-4 print:bg-white print:p-0">
            <style type="text/css" media="print">
                {`
                @page { size: auto; margin: 20mm; }
                body { background-color: white; -webkit-print-color-adjust: exact; }
                table { page-break-inside: auto; }
                tr { page-break-inside: avoid; break-inside: avoid; }
                thead { display: table-header-group; }
                tfoot { display: table-footer-group; }
                .print-hidden { display: none !important; }
                `}
            </style>

            {/* Action Bar (Hidden when printing) */}
            <div className="w-full md:max-w-[210mm] mx-auto mb-6 flex flex-col md:flex-row justify-between items-center gap-4 md:gap-0 print:hidden">
                <button
                    onClick={() => navigate('/invoice', { state: { cartItems, customer } })}
                    className="flex items-center text-slate-300 hover:text-white transition-colors font-medium self-start md:self-auto"
                >
                    ← Back to Edit
                </button>
                <div className="flex gap-4 w-full md:w-auto">
                    <button
                        className="flex-1 md:flex-none px-6 py-2 rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600 font-bold transition-colors shadow-sm"
                        onClick={() => alert('Save functionality mock')}
                    >
                        Save as Draft
                    </button>
                    <button
                        onClick={handlePrint}
                        className="flex-1 md:flex-none px-6 py-2 rounded-lg bg-amber-500 text-slate-900 hover:bg-amber-400 font-bold transition-colors shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2"
                    >
                        <span>🖨️ Print Invoice</span>
                    </button>
                </div>
            </div>

            {/* Invoice Paper A4 size approx - Scrollable on mobile */}
            <div className="overflow-x-auto pb-12 w-full custom-scrollbar">
                <div className="max-w-[210mm] min-w-[210mm] min-h-[297mm] mx-auto bg-white shadow-2xl print:shadow-none p-12 relative flex flex-col print:w-full print:h-auto print:p-0 print:mx-0">

                    {/* Header */}
                    <div className="flex justify-between items-start border-b-2 border-slate-900 pb-8 mb-8">
                        <div className="flex items-center gap-4">
                            <img src={logo} alt="EmiratesCo" className="h-16 object-contain" />
                            <div>
                                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">EmiratesCo</h1>
                                <p className="text-sm text-slate-500 font-medium">Aluminium & Glass</p>
                                <p className="text-xs text-slate-400 mt-1">PO Box 1234, Dubai, UAE</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <h2 className="text-4xl font-bold text-slate-200 uppercase tracking-widest">Invoice</h2>
                            <div className="mt-4 space-y-1">
                                <div className="flex justify-between w-48 ml-auto">
                                    <span className="text-slate-500 font-bold text-sm">Date:</span>
                                    <span className="text-slate-900 font-mono font-medium">{invoiceMeta.date}</span>
                                </div>
                                <div className="flex justify-between w-48 ml-auto">
                                    <span className="text-slate-500 font-bold text-sm">Invoice #:</span>
                                    <span className="text-slate-900 font-mono font-medium">{invoiceMeta.number}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* To / From */}
                    <div className="flex justify-between mb-12">
                        <div>
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Bill To</h3>
                            <div className="text-slate-900 font-bold text-lg">{customer.name}</div>
                            <div className="text-slate-600 font-mono">{customer.phone}</div>
                            <div className="text-slate-500 text-sm mt-1">{customer.type === 'new' ? 'New Customer' : 'Registered Client'}</div>
                        </div>
                    </div>

                    {/* Table */}
                    <div className="flex-1">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b-2 border-slate-900">
                                    <th className="py-3 text-xs font-bold text-slate-500 uppercase tracking-wider w-16">#</th>
                                    <th className="py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Description</th>
                                    <th className="py-3 text-xs font-bold text-slate-500 uppercase tracking-wider text-right w-32">Amount</th>
                                </tr>
                            </thead>
                            <tbody className="text-sm divide-y divide-slate-100">
                                {cartItems.map((item, idx) => (
                                    <InvoiceItemRow
                                        key={idx}
                                        item={item}
                                        index={idx}
                                        productDef={productMap[item.id]}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Footer Totals */}
                    <div className="border-t-2 border-slate-900 pt-8 mt-8 break-inside-avoid">
                        <div className="flex justify-end">
                            <div className="w-64 space-y-3">
                                <div className="flex justify-between text-slate-500 text-sm">
                                    <span className="font-medium">Subtotal</span>
                                    <span className="font-mono">${totals.grandTotal.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between text-slate-500 text-sm">
                                    <span className="font-medium">VAT (5%)</span>
                                    <span className="font-mono">${totals.vat.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between text-slate-900 pt-4 border-t border-slate-200 text-xl font-bold">
                                    <span>Total</span>
                                    <span className="font-mono">${totals.total.toFixed(2)}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Bottom Watermark */}
                    <div className="mt-16 pt-8 border-t border-slate-100 text-center text-xs text-slate-400 print:mt-auto">
                        <p>System Generated Invoice • All prices include VAT where applicable.</p>
                        <p className="mt-1 font-mono">EmiratesCo Management System</p>
                    </div>
                </div>
            </div>
        </div>
    );
}