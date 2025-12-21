import React, { useState, useMemo, memo } from 'react';

const CustomerSelectionOverlay = memo(({ customers, onSelectCustomer }) => {
    // Local state for the overlay only
    const [customerSearch, setCustomerSearch] = useState('');
    const [newCustomerName, setNewCustomerName] = useState('');
    const [newCustomerPhone, setNewCustomerPhone] = useState('');

    // Memoize the filtering list for speed
    const filteredCustomers = useMemo(() => {
        if (!customerSearch) return [];
        const lowerSearch = customerSearch.toLowerCase();
        return customers.filter(c =>
            c.name.toLowerCase().includes(lowerSearch) ||
            c.phone.includes(lowerSearch)
        );
    }, [customers, customerSearch]);

    return (
        <div className="absolute inset-0 z-[60] bg-slate-900/50 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full overflow-hidden animate-pop-in border border-gray-200">
                <div className="p-8 bg-white">
                    <h2 className="text-3xl font-bold text-gray-800 mb-2">Who is this order for?</h2>
                    <p className="text-gray-500 mb-8">Select a registered customer or enter a new name.</p>

                    {/* Search Existing */}
                    <div className="mb-8">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2 block">Search Registered Customer</label>
                        <div className="relative group">
                            <span className="absolute left-4 top-3.5 text-gray-400 group-focus-within:text-blue-500 transition-colors">🔍</span>
                            <input
                                type="text"
                                placeholder="Search by name or phone..."
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-10 pr-4 text-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                                value={customerSearch}
                                onChange={(e) => setCustomerSearch(e.target.value)}
                            />
                        </div>
                        {/* Results List */}
                        {customerSearch && (
                            <div className="mt-2 space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                                {filteredCustomers.map(c => (
                                    <button
                                        key={c.id}
                                        onClick={() => onSelectCustomer(c)}
                                        className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-blue-50 border border-transparent hover:border-blue-100 transition-all text-left group"
                                    >
                                        <div>
                                            <div className="font-bold text-gray-800">{c.name}</div>
                                            <div className="text-xs text-gray-500 font-mono">{c.phone}</div>
                                        </div>
                                        <span className="text-blue-500 opacity-0 group-hover:opacity-100 font-medium text-sm">Select →</span>
                                    </button>
                                ))}
                                {filteredCustomers.length === 0 && (
                                    <p className="text-sm text-gray-400 p-2 italic">No customers found.</p>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-4 py-4">
                        <span className="h-px bg-gray-200 flex-1"></span>
                        <span className="text-xs text-gray-400 font-bold uppercase">OR</span>
                        <span className="h-px bg-gray-200 flex-1"></span>
                    </div>

                    {/* One-time / New */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                        <div>
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2 block">New Customer Registration</label>
                            <div className="space-y-3">
                                <input
                                    type="text"
                                    placeholder="Full Name"
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-gray-800 outline-none focus:border-blue-500 transition-all font-medium"
                                    value={newCustomerName}
                                    onChange={(e) => setNewCustomerName(e.target.value)}
                                />
                                <input
                                    type="tel"
                                    placeholder="Phone Number (Required)"
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-gray-800 outline-none focus:border-blue-500 transition-all font-medium"
                                    value={newCustomerPhone}
                                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && newCustomerName.trim() && newCustomerPhone.trim()) {
                                            onSelectCustomer({ id: 'new-' + Date.now(), name: newCustomerName, phone: newCustomerPhone, type: 'new' });
                                        }
                                    }}
                                />
                                <button
                                    onClick={() => {
                                        if (newCustomerName.trim() && newCustomerPhone.trim()) {
                                            onSelectCustomer({ id: 'new-' + Date.now(), name: newCustomerName, phone: newCustomerPhone, type: 'new' });
                                        }
                                    }}
                                    disabled={!newCustomerName.trim() || !newCustomerPhone.trim()}
                                    className="w-full bg-gray-900 text-white py-3 rounded-xl font-bold disabled:opacity-50 hover:bg-black transition-colors shadow-lg shadow-gray-900/10 flex items-center justify-center gap-2"
                                >
                                    <span>Register & Start Sale</span>
                                    <span>→</span>
                                </button>
                            </div>
                        </div>
                        <div className="flex flex-col justify-end">
                            <button
                                onClick={() => onSelectCustomer({ id: 'walk-in', name: 'Walk-in Customer', type: 'walk-in' })}
                                className="w-full bg-blue-50 text-blue-600 hover:bg-blue-100 font-bold py-3 rounded-xl border border-blue-200 transition-colors"
                            >
                                Walk-in Customer
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default CustomerSelectionOverlay;
