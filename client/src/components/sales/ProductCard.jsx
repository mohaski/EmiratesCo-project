export default function ProductCard({ product, onClick }) {
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
                {/* Display appropriate price based on category */}
                {product.category.includes('profile') ? (
                    <div className="flex flex-col">
                        <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Per Foot</span>
                        <span className="text-lg font-bold text-gray-900">${product.priceFoot}</span>
                    </div>
                ) : product.category === 'glass' ? (
                    <div className="flex flex-col">
                        <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Per Sq.Ft</span>
                        <span className="text-lg font-bold text-gray-900">${product.priceSqFt}</span>
                    </div>
                ) : (
                    <div className="flex flex-col">
                        <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Per {product.unit}</span>
                        <span className="text-lg font-bold text-gray-900">${product.price}</span>
                    </div>
                )}

                <button className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center hover:bg-blue-600 hover:text-white transition-colors shadow-sm">
                    <span className="text-xl leading-none mb-0.5">+</span>
                </button>
            </div>
        </div>
    );
}
