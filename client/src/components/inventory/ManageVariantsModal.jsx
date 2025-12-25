import React, { Fragment, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { useProducts } from '../../context/ProductContext';
import ConfirmationModal from '../common/ConfirmationModal';

export default function ManageVariantsModal({ isOpen, onClose, product }) {
    const { updateProduct } = useProducts();
    const [confirmDelete, setConfirmDelete] = useState({ open: false, variant: null });

    // Editing State
    const [editingVariantId, setEditingVariantId] = useState(null);
    const [editForm, setEditForm] = useState({ price: '' });

    if (!product) return null;

    const variants = product.variants || [];
    const hasVariants = variants.length > 0;

    // Helper to get unique ID for variant
    const getVariantId = (v) => v.name || Object.values(v.attributes).join(' - ');

    const handleDeleteClick = (variant) => {
        setConfirmDelete({ open: true, variant });
    };

    const handleEditClick = (variant) => {
        const id = getVariantId(variant);
        setEditingVariantId(id);
        // Pre-fill form - Price Only
        setEditForm({
            price: variant.price || variant.priceFull || 0
        });
    };

    const handleCancelEdit = () => {
        setEditingVariantId(null);
        setEditForm({ price: '' });
    };

    const handleSaveEdit = (originalVariant) => {
        const updatedVariants = variants.map(v => {
            if (getVariantId(v) === getVariantId(originalVariant)) {
                return {
                    ...v,
                    price: parseFloat(editForm.price),
                    priceFull: parseFloat(editForm.price), // Sync for legacy compat
                };
            }
            return v;
        });

        updateProduct({ ...product, variants: updatedVariants });
        setEditingVariantId(null);
    };

    const confirmDeletion = () => {
        const variantToDelete = confirmDelete.variant;
        if (!variantToDelete) return;

        const updatedVariants = variants.filter(v => getVariantId(v) !== getVariantId(variantToDelete));

        updateProduct({ ...product, variants: updatedVariants });
        setConfirmDelete({ open: false, variant: null });
    };

    return (
        <>
            <Transition appear show={isOpen} as={Fragment}>
                <Dialog as="div" className="relative z-40" onClose={onClose}>
                    <Transition.Child
                        as={Fragment}
                        enter="ease-out duration-300"
                        enterFrom="opacity-0"
                        enterTo="opacity-100"
                        leave="ease-in duration-200"
                        leaveFrom="opacity-100"
                        leaveTo="opacity-0"
                    >
                        <div className="fixed inset-0 bg-black/25 backdrop-blur-sm" />
                    </Transition.Child>

                    <div className="fixed inset-0 overflow-y-auto">
                        <div className="flex min-h-full items-center justify-center p-4 text-center">
                            <Transition.Child
                                as={Fragment}
                                enter="ease-out duration-300"
                                enterFrom="opacity-0 scale-95"
                                enterTo="opacity-100 scale-100"
                                leave="ease-in duration-200"
                                leaveFrom="opacity-100 scale-100"
                                leaveTo="opacity-0 scale-95"
                            >
                                <Dialog.Panel className="w-full max-w-3xl transform overflow-hidden rounded-2xl bg-white p-8 text-left align-middle shadow-2xl transition-all">
                                    <div className="flex justify-between items-start mb-6">
                                        <div>
                                            <Dialog.Title as="h3" className="text-2xl font-bold leading-6 text-gray-900 border-b pb-2 mb-1 border-gray-100">
                                                Manage Variants
                                            </Dialog.Title>
                                            <p className="text-sm text-gray-500 font-medium">{product.name} ({variants.length})</p>
                                        </div>
                                        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 rounded-full p-1 hover:bg-gray-100 transition-colors">
                                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                        </button>
                                    </div>

                                    <div className="min-h-[300px] max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                                        {!hasVariants ? (
                                            <div className="flex flex-col items-center justify-center h-40 text-gray-400 border-2 border-dashed border-gray-100 rounded-xl bg-gray-50/50">
                                                <span className="text-3xl mb-2">📦</span>
                                                <p>No variants found for this product.</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {variants.map((variant, idx) => {
                                                    const name = getVariantId(variant);
                                                    const isEditing = editingVariantId === name;

                                                    return (
                                                        <div key={idx} className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-gray-50 rounded-xl border transition-all group ${isEditing ? 'border-blue-400 ring-1 ring-blue-100 shadow-md bg-white' : 'border-gray-100 hover:border-blue-200 hover:shadow-sm'}`}>

                                                            {/* INFO SECTION */}
                                                            <div className="flex items-center gap-4 flex-1">
                                                                <div className="w-10 h-10 rounded-lg bg-white border border-gray-200 flex items-center justify-center font-bold text-gray-400 shrink-0">
                                                                    {idx + 1}
                                                                </div>
                                                                <div className="flex-1">
                                                                    <h4 className="font-bold text-gray-800 text-sm sm:text-base">{name}</h4>

                                                                    {isEditing ? (
                                                                        <div className="flex items-center gap-4 mt-2 animate-fade-in w-full">
                                                                            <div className="flex flex-col">
                                                                                <label className="text-[10px] uppercase font-bold text-gray-400">Price</label>
                                                                                <input
                                                                                    type="number"
                                                                                    className="w-24 px-2 py-1 bg-white border border-gray-300 rounded text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                                                                                    value={editForm.price}
                                                                                    onChange={(e) => setEditForm({ ...editForm, price: e.target.value })}
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="flex gap-3 text-xs text-gray-500 mt-1">
                                                                            <span className="bg-white px-2 py-0.5 rounded border border-gray-200 font-mono">
                                                                                Price: <span className="text-gray-900 font-bold">{variant.price || variant.priceFull || '-'}</span>
                                                                            </span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            {/* ACTIONS SECTION */}
                                                            <div className="flex items-center gap-2 mt-4 sm:mt-0 justify-end">
                                                                {isEditing ? (
                                                                    <>
                                                                        <button
                                                                            onClick={() => handleSaveEdit(variant)}
                                                                            className="px-3 py-1.5 rounded-lg bg-green-500 hover:bg-green-600 text-white text-xs font-bold transition-colors shadow-sm"
                                                                        >
                                                                            Save
                                                                        </button>
                                                                        <button
                                                                            onClick={handleCancelEdit}
                                                                            className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-bold transition-colors"
                                                                        >
                                                                            Cancel
                                                                        </button>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <button
                                                                            onClick={() => handleEditClick(variant)}
                                                                            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors group-hover:opacity-100 sm:opacity-60"
                                                                            title="Edit Price"
                                                                        >
                                                                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                                                        </button>
                                                                        <button
                                                                            onClick={() => handleDeleteClick(variant)}
                                                                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors group-hover:opacity-100 sm:opacity-60"
                                                                            title="Delete Variant"
                                                                        >
                                                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                                                        </button>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>

                                    <div className="mt-8 flex justify-end">
                                        <button
                                            type="button"
                                            className="inline-flex justify-center rounded-xl border border-transparent bg-gray-900 px-6 py-3 text-sm font-bold text-white hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 transition-all shadow-lg shadow-gray-900/10"
                                            onClick={onClose}
                                        >
                                            Done
                                        </button>
                                    </div>
                                </Dialog.Panel>
                            </Transition.Child>
                        </div>
                    </div>
                </Dialog>
            </Transition>

            <ConfirmationModal
                isOpen={confirmDelete.open}
                onClose={() => setConfirmDelete({ open: false, variant: null })}
                onConfirm={confirmDeletion}
                title="Delete Variant"
                message={`Are you sure you want to delete the variant "${confirmDelete.variant?.name || 'Selected Variant'}"? This action cannot be undone.`}
                confirmText="Delete Variant"
                confirmStyle="danger"
            />
        </>
    );
}
