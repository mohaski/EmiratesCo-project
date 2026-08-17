import { useState, useDeferredValue } from 'react';
import { CollectDebtTab } from './CollectPaymentsPage';
import { DuesTab } from './DuesPage';

// CEO/manager/admin's merged view of debt-related work — one sidebar entry
// instead of two, same idea as Order History (Sales Orders/Quotations/Cutting
// Queue tabs) and Tool Tracking (Worker Loans/Check Out/Return/Catalog tabs).
export default function DebtManagementPage() {
    const [activeTab, setActiveTab] = useState('collect');
    const [searchQuery, setSearchQuery] = useState('');
    const deferredQuery = useDeferredValue(searchQuery);
    const [collectCount, setCollectCount] = useState(0);
    const [duesCount, setDuesCount] = useState(0);

    const tabs = [
        { id: 'collect', label: 'Collect Debt', color: '#22c55e', count: collectCount },
        { id: 'dues', label: 'Dues Follow-Up', color: '#f59e0b', count: duesCount },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--color-bg)' }}>
            {/* Header */}
            <div style={{
                padding: '1.5rem 2rem',
                borderBottom: '1px solid rgba(255,255,255,0.07)',
                background: 'rgba(9,14,26,0.8)',
                backdropFilter: 'blur(20px)',
                position: 'sticky', top: 0, zIndex: 20,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap',
            }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 8px rgba(34,197,94,0.8)' }} />
                        <h1 style={{ fontSize: '1.375rem', fontWeight: 800, color: '#f1f5f9', margin: 0, letterSpacing: '-0.025em' }}>Debt Management</h1>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, marginLeft: '1.25rem', fontWeight: 500 }}>Collect outstanding balances & follow up overdue accounts</p>
                </div>

                <div style={{ position: 'relative', minWidth: '280px' }}>
                    <span style={{ position: 'absolute', left: '0.875rem', top: '50%', transform: 'translateY(-50%)', color: '#475569', fontSize: '0.875rem' }}>🔍</span>
                    <input
                        type="text"
                        placeholder="Search by order ID, customer, or phone..."
                        style={{
                            width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '0.75rem', padding: '0.625rem 1rem 0.625rem 2.25rem',
                            color: '#e2e8f0', fontSize: '0.82rem', outline: 'none', transition: 'border-color 0.2s', boxSizing: 'border-box',
                        }}
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        onFocus={e => { e.target.style.borderColor = 'rgba(34,197,94,0.5)'; }}
                        onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                    />
                </div>
            </div>

            {/* Tabs */}
            <div style={{ padding: '0 2rem', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: '0.25rem' }}>
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        style={{
                            padding: '1rem 0.25rem', marginRight: '1.5rem',
                            background: 'none', border: 'none', cursor: 'pointer',
                            fontSize: '0.875rem', fontWeight: 700,
                            color: activeTab === tab.id ? '#f1f5f9' : '#475569',
                            borderBottom: activeTab === tab.id ? `2px solid ${tab.color}` : '2px solid transparent',
                            transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '0.5rem',
                        }}
                    >
                        {tab.label}
                        <span style={{
                            fontSize: '0.65rem', fontWeight: 700,
                            background: activeTab === tab.id ? `${tab.color}20` : 'rgba(255,255,255,0.06)',
                            border: `1px solid ${activeTab === tab.id ? `${tab.color}30` : 'rgba(255,255,255,0.08)'}`,
                            color: activeTab === tab.id ? tab.color : '#475569',
                            borderRadius: '100px', padding: '1px 7px',
                        }}>{tab.count}</span>
                    </button>
                ))}
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: 'auto' }} className="custom-scrollbar">
                {activeTab === 'collect' && <CollectDebtTab searchQuery={deferredQuery} onCountChange={setCollectCount} />}
                {activeTab === 'dues' && <DuesTab searchQuery={deferredQuery} onCountChange={setDuesCount} />}
            </div>
        </div>
    );
}
