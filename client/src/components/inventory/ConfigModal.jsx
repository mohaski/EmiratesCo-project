import React from 'react';

const ConfigModal = ({
    isOpen,
    onClose,
    activeTab,
    onTabChange,
    config,
    selectedParentCategory,
    onParentCategoryChange,
    onAdd,
    onRemove,
    onAddCategory // New Prop
}) => {
    if (!isOpen) return null;

    const handleAddSubmit = (value) => {
        if (value.trim()) {
            onAdd(value);
        }
    };

    // Derived tabs: Categories, Subcats, plus dynamically standard attributes like Color, Thickness
    // But also allow adding NEW attribute definitions if we wanted (advanced).
    // For now, let's look at `config.attributes` keys to generate tabs?
    // OR, just have an "Attributes" tab with a sub-selector.

    // Let's stick to the prompt's simplicity: Generate tabs for keys in config.attributes
    const attributeKeys = Object.keys(config.attributes || {});
    const TABS = ['categories', 'subcats', ...attributeKeys];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-fade-in">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden animate-pop-in flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50 shrink-0">
                    <div>
                        <h3 className="text-xl font-bold text-gray-900">Manage Options</h3>
                        <p className="text-xs text-gray-500">Configure system-wide categories and attributes.</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl transition-colors">×</button>
                </div>

                {/* Tab Navigation (Scrollable) */}
                <div className="border-b border-gray-100 bg-white shrink-0 flex items-center">
                    <div className="flex overflow-x-auto custom-scrollbar flex-1">
                        {TABS.map(tab => (
                            <button
                                key={tab}
                                onClick={() => onTabChange(tab)}
                                className={`px-6 py-4 font-bold text-xs whitespace-nowrap transition-all border-b-2 ${activeTab === tab
                                    ? 'text-blue-600 border-blue-600 bg-blue-50/30'
                                    : 'text-gray-500 border-transparent hover:bg-gray-50 hover:text-gray-700'
                                    }`}
                            >
                                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                            </button>
                        ))}
                    </div>
                    {onAddCategory && (
                        <button
                            onClick={() => {
                                const name = prompt("Enter new Attribute Category Name (e.g. 'Fabric', 'Material'):");
                                if (name) onAddCategory(name);
                            }}
                            className="px-4 py-2 mr-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-xs font-bold transition-colors whitespace-nowrap"
                            title="Add New Attribute Category"
                        >
                            + New Class
                        </button>
                    )}
                </div>

                {/* Content Area */}
                <div className="p-6 overflow-y-auto custom-scrollbar flex-1 bg-gray-50/50">
                    <div className="space-y-6">

                        {/* Sub-Cat Context: Parent Selector */}
                        {activeTab === 'subcats' && (
                            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-2">Select Parent Category</label>
                                <select
                                    value={selectedParentCategory}
                                    onChange={e => onParentCategoryChange(e.target.value)}
                                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500/20"
                                >
                                    {config.categories.map(c => (
                                        <option key={c.id} value={c.id}>{c.label}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Add New Item Input */}
                        <div className="flex gap-2">
                            <input
                                id="newItemInput"
                                type="text"
                                className="flex-1 bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm"
                                placeholder={`Add new ${activeTab} item...`}
                                onKeyDown={e => e.key === 'Enter' && (handleAddSubmit(e.target.value), e.target.value = '')}
                            />
                            <button
                                onClick={() => { const el = document.getElementById('newItemInput'); handleAddSubmit(el.value); el.value = ''; }}
                                className="bg-gray-900 text-white px-6 rounded-xl font-bold text-sm hover:bg-black transition-colors shadow-lg shadow-gray-900/10"
                            >
                                Add
                            </button>
                        </div>

                        {/* Items Grid */}
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            {(() => {
                                let items = [];
                                if (activeTab === 'categories') items = config.categories;
                                else if (activeTab === 'subcats') items = config.subCategories[selectedParentCategory] || [];
                                else {
                                    // It's a dynamic attribute tab
                                    items = config.attributes[activeTab] || [];
                                }

                                return items.length > 0 ? items.map(item => {
                                    const label = typeof item === 'string' ? item : item.label;
                                    const id = typeof item === 'string' ? item : item.id;

                                    return (
                                        <div key={id} className="group flex items-center justify-between p-3 bg-white border border-gray-200 rounded-xl shadow-sm text-sm font-bold text-gray-700 hover:border-gray-300 transition-all">
                                            <span className="truncate mr-2" title={label}>{label}</span>
                                            <button
                                                onClick={() => onRemove(item, selectedParentCategory)}
                                                className="w-6 h-6 rounded-md flex items-center justify-center text-gray-300 hover:bg-red-50 hover:text-red-500 transition-colors"
                                            >
                                                ×
                                            </button>
                                        </div>
                                    );
                                }) : (
                                    <div className="col-span-full py-8 text-center text-gray-400 text-sm italic">
                                        No items found. Add one above!
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ConfigModal;
