import { useState, useEffect, useCallback } from 'react';
import ProfileCalculator from './calculators/ProfileCalculator';
import GlassCalculator from './calculators/GlassCalculator';
import AccessoryCalculator from './calculators/AccessoryCalculator';
import DynamicCalculator from './calculators/DynamicCalculator';
import StandardCalculator from './calculators/StandardCalculator';

// --- MAIN COMPONENT ---
export default function ProductModal({ product, isOpen, onClose, onAddToOrder, color, initialDetails }) {
    // State lifted from children
    console.log(product);
    const [total, setTotal] = useState(0);
    const [details, setDetails] = useState(null);

    // Stable handler passed to children to update parent state
    const handleUpdate = useCallback((newTotal, newDetails) => {
        setTotal(newTotal);
        setDetails(newDetails);
    }, []);

    // Helper to add to order
    const handleAdd = () => {
        if (total <= 0) return;
        onAddToOrder({
            image: product.image,
            id: product.id,
            name: product.name,
            category: product.category,
            totalPrice: total,
            details: details
        });
        onClose();
    };

    if (!isOpen || !product) return null;

    const isProfile = product.category === 'ke-profile' || product.category === 'tz-profile';
    const isGlass = product.category === 'glass';
    const isAccessory = product.category === 'accessories';
    // Check for dynamic schema
    const isDynamic = !!product.variants;

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-3xl bg-white rounded-3xl shadow-2xl overflow-hidden animate-pop-in max-h-[90vh] flex flex-col border border-gray-200">

                {/* Header */}
                <div className="relative h-40 flex-shrink-0 bg-gray-50 border-b border-gray-100">
                    <img src={product.image} alt={product.name} className="w-full h-full object-cover opacity-90 mix-blend-multiply" />
                    <div className="absolute inset-0 bg-gradient-to-t from-gray-900/60 to-transparent" />
                    <button onClick={onClose} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/90 text-gray-800 flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors shadow-sm">✕</button>
                    <div className="absolute bottom-4 left-6">
                        <h2 className="text-3xl font-bold text-white drop-shadow-md">{product.name}</h2>
                        <div className="flex items-center gap-2">
                            <span className="bg-white/20 backdrop-blur-md px-2 py-0.5 rounded text-sm text-white font-medium border border-white/20">
                                {product.category.toUpperCase().replace('-', ' ')}
                            </span>
                            {isProfile && color && (
                                <span className="bg-white/90 backdrop-blur-md px-2 py-0.5 rounded text-sm text-gray-900 font-bold border border-white/20 shadow-sm flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-current" style={{ color: color === 'White' ? '#ccc' : color === 'Brown' ? '#8B4513' : color === 'Silver' ? '#C0C0C0' : '#808080' }}></span>
                                    {color}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Content Area - Switches based on category */}
                <div className="p-6 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
                    {/* Key={product.id} forces a remount when product changes, resetting child state automatically */}
                    {isProfile ? (
                        <ProfileCalculator
                            key={product.id}
                            product={product}
                            color={color}
                            initialDetails={initialDetails}
                            onUpdate={handleUpdate}
                        />
                    ) : isGlass ? (
                        <GlassCalculator
                            key={product.id}
                            product={product}
                            initialDetails={initialDetails}
                            onUpdate={handleUpdate}
                        />
                    ) : isAccessory ? (
                        <AccessoryCalculator
                            key={product.id}
                            product={product}
                            initialDetails={initialDetails}
                            onUpdate={handleUpdate}
                        />
                    ) : isDynamic ? (
                        <DynamicCalculator
                            key={product.id}
                            product={product}
                            initialDetails={initialDetails}
                            onUpdate={handleUpdate}
                        />
                    ) : (
                        <StandardCalculator
                            key={product.id}
                            product={product}
                            initialDetails={initialDetails}
                            onUpdate={handleUpdate}
                        />
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 bg-gray-50 border-t border-gray-100 flex items-center justify-between flex-shrink-0">
                    <div>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Total Estimated</p>
                        <p className="text-3xl font-black text-gray-900">Ksh{total.toLocaleString()}</p>
                    </div>
                    <button
                        onClick={handleAdd}
                        disabled={total <= 0}
                        className={`px-8 py-3 rounded-2xl font-bold text-lg shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-0.5 ${total > 0
                            ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white'
                            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                            }`}
                    >
                        Add to Order
                    </button>
                </div>
            </div>
        </div>
    );
}