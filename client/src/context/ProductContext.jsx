// @refresh reset
import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import api from '../services/api';
import { wsEvents } from '../utils/wsEvents';

const ProductContext = createContext();

export const useProducts = () => {
    const context = useContext(ProductContext);
    if (!context) {
        throw new Error('useProducts must be used within a ProductProvider');
    }
    return context;
};

export const ProductProvider = ({ children }) => {
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // --- Helpers ---
    const mapCategories = (raw) => raw.map(c => ({
        id: c.type,
        label: c.name,
        icon: '📦',
        dbId: c.categoryId,
        subCategories: c.subCategories || c.sub_categories || []
    }));

    const mapProducts = (rawProducts, catList) => {
        const catMap = new Map(catList.map(c => [c.dbId, c]));

        return rawProducts.map(p => {
            const cat = catMap.get(p.category_id);
            const feVariants = p.variants ? p.variants.map(v => ({
                id: v.variantId,
                variantId: v.variantId,
                name: v.name,
                attributes: v.attributes,
                stock: v.stock_quantity,
                price: v.price,
                priceHalf: v.price_half,
                priceUnit: v.price_unit,
                length: v.length ?? null,
                width: v.width ?? null,
                height: v.height ?? null,
            })) : [];

            let priceFull = p.price_full || 0;
            let priceHalf = p.price_half || 0;
            let priceFoot = p.price_unit || 0;

            // If variable product with no root price, derive from first variant
            if (feVariants.length > 0) {
                // Find first variant with a price, or default to first variant
                const representative = feVariants.find(v => v.price > 0) || feVariants[0];

                if (priceFull === 0) priceFull = representative.price || 0;
                if (priceHalf === 0) priceHalf = representative.priceHalf || 0;
                if (priceFoot === 0) priceFoot = representative.priceUnit || 0;
            }

            const totalStock = p.stock_quantity || 0;

            return {
                id: p.productId,
                name: p.name,
                category: cat ? cat.id : 'general',
                subCategory: p.sub_category,
                itemCode: p.itemCode,
                priceFull: priceFull,
                priceHalf: priceHalf,
                priceFoot: priceFoot,
                trackOffcuts: p.trackOffcuts || p.track_offcuts || false,
                width: p.width ?? null,
                height: p.height ?? null,
                stock: totalStock,
                image: p.image_url || 'https://placehold.co/300x200/CCCCCC/FFFFFF?text=Product',
                variants: feVariants,
                attributes: { Length: p.description ? [p.description] : [] },
                length: p.length || null
            };
        });
    };

    // --- Data Fetching ---
    const initializeData = useCallback(async () => {
        try {
            setLoading(true);
            const [rawCats, rawProds] = await Promise.all([
                api.productService.getAllCategories(),
                api.productService.getAll()
            ]);

            const mappedCats = mapCategories(rawCats);
            setCategories(mappedCats);

            const mappedProds = mapProducts(rawProds, mappedCats);
            setProducts(mappedProds);
            setError(null);
        } catch (err) {
            console.error("Failed to fetch product data", err);
            setError("Failed to load products");
        } finally {
            setLoading(false);
        }
    }, []);

    const refreshProducts = useCallback(async () => {
        try {
            const raw = await api.productService.getAll();
            // Pull fresh categories inside the setter to avoid stale closure
            setCategories(currentCats => {
                const mapped = mapProducts(raw, currentCats);
                setProducts(mapped);
                return currentCats;
            });
        } catch (err) {
            console.error("Failed to refresh products", err);
        }
    }, []);

    const refreshCategories = useCallback(async () => {
        try {
            const raw = await api.productService.getAllCategories();
            const mapped = mapCategories(raw);
            setCategories(mapped);
        } catch (err) {
            console.error("Failed to refresh categories", err);
        }
    }, []);

    useEffect(() => {
        initializeData();
    }, []);

    // Re-fetch whenever another client (or tab) mutates products
    useEffect(() => {
        return wsEvents.on('products_updated', refreshProducts);
    }, [refreshProducts]);

    // --- Actions ---
    const addProduct = useCallback(async (productData) => {
        try {
            const cat = categories.find(c => c.id === productData.category);
            const dbCategoryId = cat ? cat.dbId : null;

            if (!dbCategoryId) {
                console.error("Category not found for ID:", productData.category);
            }

            const payload = {
                name: productData.name,
                itemCode: productData.itemCode,
                category_id: dbCategoryId || 1,
                sub_category: productData.subCategory,
                price_full: parseFloat(productData.priceFull || 0),
                price_half: parseFloat(productData.priceHalf || 0),
                price_unit: parseFloat(productData.priceFoot || 0),
                stock: parseInt(productData.stock || 0),
                length: parseFloat(productData.length || 0),
                width: productData.width ? parseFloat(productData.width) : null,
                height: productData.height ? parseFloat(productData.height) : null,
                trackOffcuts: productData.trackOffcuts || false,
                variants: productData.variants ? productData.variants.map(v => ({
                    attributes: v.attributes,
                    stock_quantity: parseInt(v.stock || 0),
                    price: parseFloat(v.price || 0),
                    price_half: v.details ? parseFloat(v.details.priceHalf || 0) : 0,
                    price_unit: v.details ? parseFloat(v.details.priceUnit || 0) : 0,
                    length: v.length ? parseFloat(v.length) : (productData.length ? parseFloat(productData.length) : null),
                    width: v.width ? parseFloat(v.width) : null,
                    height: v.height ? parseFloat(v.height) : null,
                })) : []
            };

            await api.productService.create(payload);
            await refreshProducts();
            return true;
        } catch (err) {
            console.error("Add Product Failed", err);
            throw err;
        }
    }, [categories, refreshProducts]);

    const deleteProduct = useCallback(async (productId) => {
        try {
            await api.productService.delete(productId);
            await refreshProducts();
        } catch (err) {
            console.error("Delete Product Failed", err);
            await refreshProducts();
        }
    }, [refreshProducts]);

    const updateProduct = useCallback(async (updatedProduct) => {
        try {
            const payload = {
                name: updatedProduct.name,
                itemCode: updatedProduct.itemCode,
                price_full: updatedProduct.priceFull,
                trackOffcuts: updatedProduct.trackOffcuts,
            };
            if (updatedProduct.length != null) payload.length = updatedProduct.length;
            await api.productService.update(updatedProduct.id, payload);
            await refreshProducts();
        } catch (err) {
            console.error("Update Product Failed", err);
            throw err;
        }
    }, [refreshProducts]);

    const addCategory = useCallback(async (categoryInput) => {
        try {
            const name = typeof categoryInput === 'string' ? categoryInput : categoryInput.label;
            await api.productService.createCategory({ name });
            await refreshCategories();
            return true;
        } catch (err) {
            console.error("Failed to add category", err);
        }
    }, [refreshCategories]);

    const addProductVariant = useCallback(async (productId, variantData) => {
        try {
            await api.productService.addVariant(productId, variantData);
            await refreshProducts();
            return true;
        } catch (err) {
            console.error("Failed to add variant", err);
            throw err;
        }
    }, [refreshProducts]);

    const updateProductVariant = useCallback(async (variantId, updateData) => {
        try {
            await api.productService.updateVariant(variantId, updateData);
            await refreshProducts();
            return true;
        } catch (err) {
            console.error("Failed to update variant", err);
            throw err;
        }
    }, [refreshProducts]);

    const value = useMemo(() => ({
        products,
        categories,
        loading,
        error,
        addProduct,
        deleteProduct,
        updateProduct,
        addCategory,
        addProductVariant,
        updateProductVariant,
        refreshProducts: initializeData
    }), [products, categories, loading, error, addProduct, deleteProduct, updateProduct, addCategory, addProductVariant, updateProductVariant, initializeData]);

    return (
        <ProductContext.Provider value={value}>
            {children}
        </ProductContext.Provider>
    );
};