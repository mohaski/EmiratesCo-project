import { useState } from 'react';

const ConfigModal = ({ isOpen, onClose, activeTab, onTabChange, config, selectedParentCategory, onParentCategoryChange, onAdd, onRemove, onAddCategory, onRenameItem, onRenameClass, onDeleteClass }) => {
    const [newClassForm, setNewClassForm] = useState({ open: false, name: '', type: 'list' });

    if (!isOpen) return null;

    const handleAddSubmit = value => { if (value.trim()) onAdd(value); };
    const attributeKeys = Object.keys(config.attributes || {});
    const TABS = ['categories', 'subcats', ...attributeKeys];
    const isAttributeTab = activeTab !== 'categories' && activeTab !== 'subcats';
    const isCustomAttribute = isAttributeTab && config.attributeTypes?.[activeTab] === 'custom';

    const openNewClassForm = () => setNewClassForm({ open: true, name: '', type: 'list' });
    const closeNewClassForm = () => setNewClassForm({ open: false, name: '', type: 'list' });
    const submitNewClass = () => {
        const trimmed = newClassForm.name.trim();
        if (!trimmed) return;
        onAddCategory(trimmed, newClassForm.type === 'custom');
        closeNewClassForm();
    };

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
                            <button onClick={openNewClassForm}
                                style={{ padding: '0.375rem 0.875rem', borderRadius: '0.625rem', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.06)', color: '#94a3b8', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700 }}>
                                + New Class
                            </button>
                        )}
                        {isAttributeTab && onRenameClass && (
                            <button onClick={() => onRenameClass(activeTab)}
                                title="Rename this attribute class"
                                style={{ padding: '0.375rem 0.875rem', borderRadius: '0.625rem', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.06)', color: '#94a3b8', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700 }}>
                                ✎ Rename Class
                            </button>
                        )}
                        {isAttributeTab && onDeleteClass && (
                            <button onClick={() => onDeleteClass(activeTab)}
                                title="Delete this attribute class"
                                style={{ padding: '0.375rem 0.875rem', borderRadius: '0.625rem', border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.1)', color: '#f87171', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700 }}>
                                🗑 Delete Class
                            </button>
                        )}
                        <button onClick={onClose} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                    </div>
                </div>

                {/* New class creation panel — replaces prompt()/confirm() */}
                {newClassForm.open && (
                    <div style={{ margin: '1.25rem 2rem 0', padding: '1.25rem', borderRadius: '1rem', background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.25)', flexShrink: 0 }}>
                        <p style={{ fontSize: '0.72rem', fontWeight: 800, color: '#c084fc', margin: '0 0 0.875rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>New Attribute Class</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <div>
                                <label style={{ fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '0.375rem' }}>Class Name</label>
                                <input type="text" autoFocus value={newClassForm.name}
                                    onChange={e => setNewClassForm(prev => ({ ...prev, name: e.target.value }))}
                                    onKeyDown={e => { if (e.key === 'Enter') submitNewClass(); if (e.key === 'Escape') closeNewClassForm(); }}
                                    placeholder="e.g. Unit, Material, Finish..."
                                    style={{ ...inputStyle, width: '100%' }}
                                    onFocus={e => { e.target.style.borderColor = 'rgba(168,85,247,0.5)'; }}
                                    onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }} />
                            </div>
                            <div>
                                <label style={{ fontSize: '0.62rem', fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: '0.375rem' }}>Values Come From</label>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    {[
                                        { val: 'list', icon: '📋', label: 'Shared List', hint: 'Pick from one list across all products (e.g. Color)' },
                                        { val: 'custom', icon: '✏️', label: 'Per Product', hint: 'Typed in fresh for each product (e.g. Box / Pcs)' },
                                    ].map(opt => (
                                        <button key={opt.val} type="button" onClick={() => setNewClassForm(prev => ({ ...prev, type: opt.val }))} style={{
                                            flex: 1, padding: '0.625rem 0.75rem', borderRadius: '0.75rem', textAlign: 'left', cursor: 'pointer',
                                            border: `1px solid ${newClassForm.type === opt.val ? 'rgba(168,85,247,0.5)' : 'rgba(255,255,255,0.1)'}`,
                                            background: newClassForm.type === opt.val ? 'rgba(168,85,247,0.12)' : 'rgba(255,255,255,0.03)',
                                            transition: 'all 0.15s',
                                        }}>
                                            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: newClassForm.type === opt.val ? '#c084fc' : '#94a3b8' }}>{opt.icon} {opt.label}</div>
                                            <div style={{ fontSize: '0.6rem', color: '#475569', marginTop: '2px' }}>{opt.hint}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.25rem' }}>
                                <button type="button" onClick={closeNewClassForm} style={{ padding: '0.5rem 1rem', borderRadius: '0.625rem', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700 }}>Cancel</button>
                                <button type="button" onClick={submitNewClass} disabled={!newClassForm.name.trim()} style={{
                                    padding: '0.5rem 1.25rem', borderRadius: '0.625rem', border: 'none', cursor: newClassForm.name.trim() ? 'pointer' : 'not-allowed',
                                    background: newClassForm.name.trim() ? 'linear-gradient(135deg, #a855f7, #c084fc)' : 'rgba(168,85,247,0.2)',
                                    color: '#fff', fontWeight: 700, fontSize: '0.78rem',
                                }}>Create Class</button>
                            </div>
                        </div>
                    </div>
                )}

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
                            {config.attributeTypes?.[tab] === 'custom' ? ' •' : ''}
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

                    {isCustomAttribute ? (
                        <div style={{ padding: '1.5rem', textAlign: 'center', border: '1px dashed rgba(168,85,247,0.25)', borderRadius: '0.875rem', color: '#94a3b8', fontSize: '0.82rem', background: 'rgba(168,85,247,0.05)' }}>
                            <p style={{ margin: '0 0 4px', fontWeight: 700, color: '#c084fc' }}>Custom per-product attribute</p>
                            <p style={{ margin: 0, fontSize: '0.75rem' }}>
                                "{activeTab}" has no shared value list — each product enters its own values (e.g. Box / Pcs)
                                directly in the "Attributes" panel when creating that product.
                            </p>
                        </div>
                    ) : (
                        <>
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
                                                {isAttributeTab && onRenameItem && (
                                                    <button onClick={() => onRenameItem(item)} title="Rename" style={{
                                                        width: '20px', height: '20px', borderRadius: '5px', border: 'none', cursor: 'pointer',
                                                        background: 'transparent', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '0.78rem', marginRight: '2px',
                                                    }}
                                                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.15)'; e.currentTarget.style.color = '#60a5fa'; }}
                                                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#475569'; }}>
                                                        ✎
                                                    </button>
                                                )}
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
                        </>
                    )}
                </div>

                <div style={{ padding: '1rem 2rem', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
                    <button onClick={onClose} style={{ padding: '0.625rem 1.75rem', borderRadius: '0.875rem', border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg, #3b82f6, #06b6d4)', color: '#fff', fontWeight: 700, fontSize: '0.875rem', boxShadow: '0 4px 16px rgba(59,130,246,0.3)' }}>Done</button>
                </div>
            </div>
        </div>
    );
};

export default ConfigModal;
