const ConfigModal = ({ isOpen, onClose, activeTab, onTabChange, config, selectedParentCategory, onParentCategoryChange, onAdd, onRemove, onAddCategory }) => {
    if (!isOpen) return null;

    const handleAddSubmit = value => { if (value.trim()) onAdd(value); };
    const attributeKeys = Object.keys(config.attributes || {});
    const TABS = ['categories', 'subcats', ...attributeKeys];

    const inputStyle = {
        flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '0.75rem', padding: '0.625rem 1rem', color: '#f1f5f9',
        fontSize: '0.875rem', outline: 'none', transition: 'border-color 0.2s',
    };
    const selectStyle = {
        width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '0.75rem', padding: '0.625rem 1rem', color: '#f1f5f9',
        fontSize: '0.875rem', outline: 'none', cursor: 'pointer',
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
            background: 'rgba(9,14,26,0.85)', backdropFilter: 'blur(12px)',
        }} onClick={onClose}>
            <div onClick={e => e.stopPropagation()} style={{
                width: '100%', maxWidth: '640px',
                background: 'linear-gradient(145deg, rgba(13,20,38,0.99), rgba(9,14,26,0.99))',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '1.5rem', overflow: 'hidden',
                boxShadow: '0 32px 80px rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column', maxHeight: '85vh',
                animation: 'fadeInScale 0.2s ease',
            }}>
                {/* Header */}
                <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                    <div>
                        <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#f1f5f9', margin: '0 0 4px' }}>Manage Options</h3>
                        <p style={{ fontSize: '0.72rem', color: '#64748b', margin: 0 }}>Configure categories and attributes.</p>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        {onAddCategory && (
                            <button onClick={() => { const name = prompt('Enter new Attribute Category Name:'); if (name) onAddCategory(name); }}
                                style={{ padding: '0.375rem 0.875rem', borderRadius: '0.625rem', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.06)', color: '#94a3b8', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700 }}>
                                + New Class
                            </button>
                        )}
                        <button onClick={onClose} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                    </div>
                </div>

                {/* Tabs */}
                <div style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0, overflowX: 'auto', display: 'flex' }} className="scrollbar-hide">
                    {TABS.map(tab => (
                        <button key={tab} onClick={() => onTabChange(tab)} style={{
                            padding: '0.75rem 1.25rem', fontWeight: 700, fontSize: '0.72rem', whiteSpace: 'nowrap',
                            cursor: 'pointer', border: 'none', borderBottom: `2px solid ${activeTab === tab ? '#3b82f6' : 'transparent'}`,
                            background: activeTab === tab ? 'rgba(59,130,246,0.08)' : 'transparent',
                            color: activeTab === tab ? '#60a5fa' : '#64748b', transition: 'all 0.15s', textTransform: 'capitalize',
                        }}>
                            {tab.charAt(0).toUpperCase() + tab.slice(1)}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 2rem' }} className="custom-scrollbar">
                    {/* Parent selector for subcats */}
                    {activeTab === 'subcats' && (
                        <div style={{ marginBottom: '1rem', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.875rem', padding: '1rem' }}>
                            <label style={{ fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '0.5rem' }}>Parent Category</label>
                            <select value={selectedParentCategory} onChange={e => onParentCategoryChange(e.target.value)} style={selectStyle}>
                                {config.categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                            </select>
                        </div>
                    )}

                    {/* Add input */}
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                        <input id="newItemInput" type="text" style={inputStyle}
                            placeholder={`Add new ${activeTab} item...`}
                            onFocus={e => { e.target.style.borderColor = 'rgba(59,130,246,0.5)'; }}
                            onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                            onKeyDown={e => { if (e.key === 'Enter') { handleAddSubmit(e.target.value); e.target.value = ''; } }}
                        />
                        <button onClick={() => { const el = document.getElementById('newItemInput'); handleAddSubmit(el.value); el.value = ''; }}
                            style={{ padding: '0.625rem 1.25rem', borderRadius: '0.75rem', border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg, #3b82f6, #06b6d4)', color: '#fff', fontWeight: 700, fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                            Add
                        </button>
                    </div>

                    {/* Items grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.5rem' }}>
                        {(() => {
                            let items = [];
                            if (activeTab === 'categories') items = config.categories;
                            else if (activeTab === 'subcats') items = config.subCategories[selectedParentCategory] || [];
                            else items = config.attributes[activeTab] || [];

                            return items.length > 0 ? items.map(item => {
                                const label = typeof item === 'string' ? item : item.label;
                                const id = typeof item === 'string' ? item : item.id;
                                return (
                                    <div key={id} style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        padding: '0.625rem 0.875rem', background: 'rgba(255,255,255,0.04)',
                                        border: '1px solid rgba(255,255,255,0.07)', borderRadius: '0.75rem',
                                        fontSize: '0.82rem', fontWeight: 600, color: '#e2e8f0', transition: 'border-color 0.15s',
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; }}>
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: '0.5rem' }} title={label}>{label}</span>
                                        <button onClick={() => onRemove(item, selectedParentCategory)} style={{
                                            width: '20px', height: '20px', borderRadius: '5px', border: 'none', cursor: 'pointer',
                                            background: 'transparent', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '0.875rem',
                                        }}
                                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.15)'; e.currentTarget.style.color = '#f87171'; }}
                                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#475569'; }}>
                                            ×
                                        </button>
                                    </div>
                                );
                            }) : (
                                <div style={{ gridColumn: '1 / -1', padding: '2rem', textAlign: 'center', border: '1px dashed rgba(255,255,255,0.07)', borderRadius: '0.875rem', color: '#334155', fontSize: '0.82rem' }}>
                                    No items yet. Add one above.
                                </div>
                            );
                        })()}
                    </div>
                </div>

                <div style={{ padding: '1rem 2rem', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
                    <button onClick={onClose} style={{ padding: '0.625rem 1.75rem', borderRadius: '0.875rem', border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg, #3b82f6, #06b6d4)', color: '#fff', fontWeight: 700, fontSize: '0.875rem', boxShadow: '0 4px 16px rgba(59,130,246,0.3)' }}>Done</button>
                </div>
            </div>
        </div>
    );
};

export default ConfigModal;
