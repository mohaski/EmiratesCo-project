import { memo } from 'react';

function ProductCard({ product, onClick, selectedColor }) {
    // Resolve dynamic pricing based on selected color
    let displayPrice = {
        full: product.priceFull || product.price || 0,
        half: product.priceHalf || 0,
        unit: product.priceFoot || product.priceUnit || product.priceSqFt || 0
    };

    if (selectedColor && product.variants?.length > 0) {
        // Try to find a variant logic matching local color standards
        const normalizedColor = selectedColor.toLowerCase();
        const matchingVariant = product.variants.find(v => {
            const vName = v.name?.toLowerCase() || '';
            const vColor = v.attributes?.Color?.toLowerCase();
            return vColor === normalizedColor || vName.includes(normalizedColor);
        });

        if (matchingVariant) {
            displayPrice = {
                full: matchingVariant.price || 0,
                half: matchingVariant.priceHalf || (matchingVariant.price ? matchingVariant.price / 2 : 0),
                unit: matchingVariant.priceUnit || 0
            };
        }
    }

    return (
        <div
            onClick={() => onClick(product)}
            className="group relative flex flex-col p-4 rounded-2xl bg-white border border-gray-200 hover:border-blue-300 hover:shadow-lg hover:-translate-y-1 transition-all cursor-pointer shadow-sm"
        >
            <div className="aspect-[4/3] rounded-xl overflow-hidden mb-3 relative bg-gray-100">
                <img
                    src={product.image}
                    alt={product.name}
                    className="w-full h-full object-cover transform group-hover:scale-110 transition-duration-500 transition-transform"
                />
                {/* Subtle gradient on hover only */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>

            <h3 className="text-gray-800 font-semibold text-lg leading-tight mb-2 tracking-tight group-hover:text-blue-600 transition-colors">{product.name}</h3>

            <div className="mt-auto flex justify-between items-end border-t border-gray-100 pt-3">
                {/* Dynamic Price Display */}
                <div className="flex flex-col gap-1 w-full mr-2">
                    {displayPrice.full > 0 && (
                        <div className="flex justify-between items-center">
                            <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Full</span>
                            <span className="text-sm font-bold text-gray-900">Ksh{displayPrice.full}</span>
                        </div>
                    )}
                    {displayPrice.half > 0 && (
                        <div className="flex justify-between items-center">
                            <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Half</span>
                            <span className="text-sm font-bold text-gray-900">Ksh{displayPrice.half}</span>
                        </div>
                    )}
                    {displayPrice.unit > 0 && (
                        <div className="flex justify-between items-center">
                            <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Unit</span>
                            <span className="text-sm font-bold text-gray-900">Ksh{displayPrice.unit}</span>
                        </div>
                    )}

                    {(!displayPrice.full && !displayPrice.half && !displayPrice.unit) && (
                        <span className="text-xs text-gray-400 italic">Price on request</span>
                    )}
                </div>

                <button className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center hover:bg-blue-600 hover:text-white transition-colors shadow-sm">
                    <span className="text-xl leading-none mb-0.5">+</span>
                </button>
            </div>
        </div>
    );
}

export default memo(ProductCard);
