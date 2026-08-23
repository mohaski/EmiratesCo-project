// @refresh reset
import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import api from '../services/api';
import { wsEvents } from '../utils/wsEvents';
import { useAuth } from './AuthContext';

const ProductContext = createContext();

export const useProducts = () => {
    const context = useContext(ProductContext);
    if (!context) {
        throw new Error('useProducts must be used within a ProductProvider');
    }
    return context;
};

export const ProductProvider = ({ children }) => {
    const { user } = useAuth();
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
            const unit = p.unit || 'ft';
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
                unitQuantity: v.unit_quantity ?? null,
                lowStockThreshold: v.low_stock_threshold ?? 0,
                minUsable: v.min_usable ?? 150,
                allowRotation: v.allow_rotation ?? true,
                popularSizeRanges: v.popular_size_ranges ?? [],
                unit,
            })) : [];

            const applicableAttributes = p.applicable_attributes || [];
            const hasDimensions = p.has_dimensions || false;

            // Real attribute key -> distinct-value-list map, aggregated from the variants
            // themselves (list-type AND custom-type attributes alike, e.g. Color/Length/unit).
            // Sales calculators (Profile/Dynamic/Glass) use this to know which attributes are
            // selectable for a product — it must reflect actual variant data, not a guess.
            const attributeValueSets = {};
            feVariants.forEach(v => {
                Object.entries(v.attributes || {}).forEach(([key, val]) => {
                    if (val === undefined || val === null || val === '') return;
                    if (!attributeValueSets[key]) attributeValueSets[key] = new Set();
                    attributeValueSets[key].add(val);
                });
            });
            const variantAttributes = Object.fromEntries(
                Object.entries(attributeValueSets).map(([k, set]) => [k, Array.from(set)])
            );

            // Price/dimensions live only on variants now — derive a representative display value.
            let priceFull = 0, priceHalf = 0, priceFoot = 0;
            if (feVariants.length > 0) {
                const representative = feVariants.find(v => v.price > 0) || feVariants[0];
                priceFull = representative.price || 0;
                priceHalf = representative.priceHalf || 0;
                priceFoot = representative.priceUnit || 0;
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
                unit,
                stock: totalStock,
                image: p.image_url || 'https://placehold.co/300x200/CCCCCC/FFFFFF?text=Product',
                variants: feVariants,
                attributes: variantAttributes,
                applicableAttributes,
                hasDimensions,
                poolIgnoredAttributes: p.pool_ignored_attributes ?? null,
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

    // Refetch on login/logout — this provider lives above the router for the
    // whole app lifetime, so a mount-only effect never re-runs when the same
    // session logs out and back in.
    useEffect(() => {
        if (user) {
            initializeData();
        } else {
            setProducts([]);
            setCategories([]);
            setError(null);
            setLoading(false);
        }
    }, [user, initializeData]);

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
                trackOffcuts: productData.trackOffcuts || false,
                unit: productData.unit || 'ft',
                applicable_attributes: productData.applicableAttributes || [],
                has_dimensions: !!productData.hasDimensions,
                pool_ignored_attributes: productData.poolIgnoredAttributes ?? null,
                variants: productData.variants ? productData.variants.map(v => ({
                    attributes: v.attributes,
                    stock_quantity: parseInt(v.stock || 0),
                    price: parseFloat(v.price || 0),
                    price_half: v.details ? parseFloat(v.details.priceHalf || 0) : 0,
                    price_unit: v.details ? parseFloat(v.details.priceUnit || 0) : 0,
                    length: v.length ? parseFloat(v.length) : null,
                    width: v.width ? parseFloat(v.width) : null,
                    height: v.height ? parseFloat(v.height) : null,
                    unit_quantity: v.unitQuantity != null ? parseFloat(v.unitQuantity) : null,
                    // Offcut tuning — per-variant (see VariantCreate); different sizes/
                    // thicknesses of the same product can differ. null lets the backend
                    // pick a context-aware default (150mm for 2D, 2ft for 1D).
                    min_usable: v.minUsable ?? null,
                    allow_rotation: v.allowRotation ?? true,
                    popular_size_ranges: v.popularSizeRanges || [],
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
                trackOffcuts: updatedProduct.trackOffcuts,
                unit: updatedProduct.unit,
            };
            if (updatedProduct.applicableAttributes) payload.applicable_attributes = updatedProduct.applicableAttributes;
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

    const addSubCategory = useCallback(async (categoryId, label) => {
        try {
            const cat = categories.find(c => c.id === categoryId);
            if (!cat) throw new Error("Category not found");
            await api.productService.addSubCategory(cat.dbId, label);
            await refreshCategories();
            return true;
        } catch (err) {
            console.error("Failed to add sub-category", err);
            throw err;
        }
    }, [categories, refreshCategories]);

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

    // Adds one or more variants to an existing product in a single request.
    // `variantsData` items use the same frontend shape produced by the Add Product
    // matrix generator: { attributes, stock, price, details: {priceHalf, priceUnit}, length, width, unitQuantity }.
    const addProductVariants = useCallback(async (productId, variantsData) => {
        try {
            const payload = variantsData.map(v => ({
                attributes: v.attributes,
                stock_quantity: parseInt(v.stock || 0),
                price: parseFloat(v.price || 0),
                price_half: v.details ? parseFloat(v.details.priceHalf || 0) : 0,
                price_unit: v.details ? parseFloat(v.details.priceUnit || 0) : 0,
                length: v.length ? parseFloat(v.length) : null,
                width: v.width ? parseFloat(v.width) : null,
                unit_quantity: v.unitQuantity != null ? parseFloat(v.unitQuantity) : null,
                min_usable: v.minUsable ?? null,
                allow_rotation: v.allowRotation ?? true,
                popular_size_ranges: v.popularSizeRanges || [],
            }));
            await api.productService.addVariantsBulk(productId, payload);
            await refreshProducts();
            return true;
        } catch (err) {
            console.error("Failed to add variants", err);
            throw err;
        }
    }, [refreshProducts]);

    // Manager-entered offcuts — bulk list of leftover pieces measured by hand.
    // offcutsData items: { variantId, length, width, height, quantity }.
    const addProductOffcuts = useCallback(async (productId, offcutsData) => {
        try {
            const payload = offcutsData.map(o => ({
                variant_id: o.variantId ?? null,
                length: o.length != null ? parseFloat(o.length) : null,
                width: o.width != null ? parseFloat(o.width) : null,
                height: o.height != null ? parseFloat(o.height) : null,
                quantity: parseInt(o.quantity) || 1,
            }));
            await api.productService.addOffcutsBulk(productId, payload);
            return true;
        } catch (err) {
            console.error("Failed to add offcuts", err);
            throw err;
        }
    }, []);

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

    const deleteProductVariant = useCallback(async (variantId) => {
        try {
            await api.productService.deleteVariant(variantId);
            await refreshProducts();
            return true;
        } catch (err) {
            console.error("Failed to delete variant", err);
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
        addSubCategory,
        addProductVariant,
        addProductVariants,
        addProductOffcuts,
        updateProductVariant,
        deleteProductVariant,
        refreshProducts: initializeData
    }), [products, categories, loading, error, addProduct, deleteProduct, updateProduct, addCategory, addSubCategory, addProductVariant, addProductVariants, addProductOffcuts, updateProductVariant, deleteProductVariant, initializeData]);

    return (
        <ProductContext.Provider value={value}>
            {children}
        </ProductContext.Provider>
    );
};