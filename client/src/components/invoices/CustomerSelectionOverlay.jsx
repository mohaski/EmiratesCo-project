import React, { useState, useMemo, memo } from 'react';

// --- EXTRACTED OVERLAY COMPONENT ---
// Keeps input state isolated from the main grid to prevent render thrashing
const CustomerSelectionOverlay = memo(({ customers, onSelectCustomer }) => {
    const [customerSearch, setCustomerSearch] = useState('');
    const [newCustomerName, setNewCustomerName] = useState('');
    const [newCustomerPhone, setNewCustomerPhone] = useState('');

    const filteredCustomers = useMemo(() => {
        if (!customerSearch) return [];
        const lower = customerSearch.toLowerCase();
        return customers.filter(c => c.name.toLowerCase().includes(lower) || c.phone.includes(lower));
    }, [customers, customerSearch]);

    return (
        <div className="absolute inset-0 z-[60] bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden animate-pop-in border border-amber-500/20">
                <div className="p-8 bg-gradient-to-br from-slate-50 to-white">
                    <h2 className="text-3xl font-bold text-slate-800 mb-2">Invoice Details</h2>
                    <p className="text-slate-500 mb-8">Who is this quotation for?</p>

                    <div className="mb-8">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2 block">Search Client</label>
                        <div className="relative group">
                            <span className="absolute left-4 top-3.5 text-slate-400">🔍</span>
                            <input
                                type="text"
                                placeholder="Search by name or phone..."
                                className="w-full bg-white border border-slate-200 rounded-xl py-3 pl-10 pr-4 text-lg focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none transition-all"
                                value={customerSearch}
                                onChange={(e) => setCustomerSearch(e.target.value)}
                            />
                        </div>
                        {customerSearch && (
                            <div className="mt-2 space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                                {filteredCustomers.map(c => (
                                    <button
                                        key={c.id}
                                        onClick={() => onSelectCustomer(c)}
                                        className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-amber-50 border border-transparent hover:border-amber-200 transition-all text-left group"
                                    >
                                        <div>
                                            <div className="font-bold text-slate-800">{c.name}</div>
                                            <div className="text-xs text-slate-500 font-mono">{c.phone}</div>
                                        </div>
                                        <span className="text-amber-500 opacity-0 group-hover:opacity-100 font-medium text-sm">Select</span>
                                    </button>
                                ))}
                                {filteredCustomers.length === 0 && (
                                    <p className="text-sm text-gray-400 p-2 italic">No clients found.</p>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-4 py-4">
                        <span className="h-px bg-slate-200 flex-1"></span>
                        <span className="text-xs text-slate-400 font-bold uppercase">OR</span>
                        <span className="h-px bg-slate-200 flex-1"></span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                        <div>
                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2 block">New Client</label>
                            <div className="space-y-3">
                                <input
                                    type="text"
                                    placeholder="Client Name"
                                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-slate-800 outline-none focus:border-amber-500 transition-all font-medium"
                                    value={newCustomerName}
                                    onChange={(e) => setNewCustomerName(e.target.value)}
                                />
                                <input
                                    type="tel"
                                    placeholder="Phone Number"
                                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-slate-800 outline-none focus:border-amber-500 transition-all font-medium"
                                    value={newCustomerPhone}
                                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && newCustomerName.trim()) {
                                            onSelectCustomer({ id: 'new-' + Date.now(), name: newCustomerName, phone: newCustomerPhone, type: 'new' });
                                        }
                                    }}
                                />
                                <button
                                    onClick={() => {
                                        if (newCustomerName.trim()) {
                                            onSelectCustomer({ id: 'new-' + Date.now(), name: newCustomerName, phone: newCustomerPhone, type: 'new' });
                                        }
                                    }}
                                    disabled={!newCustomerName.trim()}
                                    className="w-full bg-slate-900 text-amber-500 py-3 rounded-xl font-bold disabled:opacity-50 hover:bg-black transition-colors shadow-lg flex items-center justify-center gap-2"
                                >
                                    <span>Create Profile</span>
                                    <span>→</span>
                                </button>
                            </div>
                        </div>
                        <div className="flex flex-col justify-end">
                            <button
                                onClick={() => onSelectCustomer({ id: 'guest', name: 'Guest Client', type: 'walk-in' })}
                                className="w-full bg-slate-100 text-slate-600 hover:bg-slate-200 font-bold py-3 rounded-xl border border-slate-300 transition-colors"
                            >
                                Guest Client
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default CustomerSelectionOverlay;
