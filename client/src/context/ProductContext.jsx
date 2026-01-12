import { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';

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

    const mapProducts = (rawProducts, catList) => rawProducts.map(p => {
        const cat = catList.find(c => c.dbId === p.category_id);
        const feVariants = p.variants ? p.variants.map(v => ({
            id: v.variantId,
            name: v.name,
            attributes: v.attributes,
            stock: v.stock_quantity,
            price: v.price,
            priceHalf: v.price_half,
            priceUnit: v.price_unit
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
            stock: totalStock,
            image: p.image_url || 'https://placehold.co/300x200/CCCCCC/FFFFFF?text=Product',
            variants: feVariants,
            attributes: { Length: p.description ? [p.description] : [] },
            length: p.length || null
        };
    });

    // --- Data Fetching ---
    const initializeData = async () => {
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
    };

    const refreshProducts = async () => {
        try {
            const raw = await api.productService.getAll();
            // Use current 'categories' state for mapping
            const mapped = mapProducts(raw, categories);
            setProducts(mapped);
        } catch (err) {
            console.error("Failed to refresh products", err);
        }
    };

    const refreshCategories = async () => {
        try {
            const raw = await api.productService.getAllCategories();
            const mapped = mapCategories(raw);
            setCategories(mapped);
        } catch (err) {
            console.error("Failed to refresh categories", err);
        }
    };

    useEffect(() => {
        initializeData();
    }, []);

    // --- Actions ---
    const addProduct = async (productData) => {
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
                trackOffcuts: productData.trackOffcuts || false,
                variants: productData.variants ? productData.variants.map(v => ({
                    attributes: v.attributes,
                    stock_quantity: parseInt(v.stock || 0),
                    price: parseFloat(v.price || 0),
                    price_half: v.details ? parseFloat(v.details.priceHalf || 0) : 0,
                    price_unit: v.details ? parseFloat(v.details.priceUnit || 0) : 0,
                    length: v.length ? parseFloat(v.length) : (productData.length ? parseFloat(productData.length) : null)
                })) : []
            };

            await api.productService.create(payload);
            await refreshProducts();
            return true;
        } catch (err) {
            console.error("Add Product Failed", err);
            throw err;
        }
    };

    const deleteProduct = async (productId) => {
        try {
            await api.productService.delete(productId);
            await refreshProducts();
        } catch (err) {
            console.error("Delete Product Failed", err);
            await refreshProducts();
        }
    };

    const updateProduct = async (updatedProduct) => {
        try {
            const payload = {
                name: updatedProduct.name,
                itemCode: updatedProduct.itemCode,
                price_full: updatedProduct.priceFull,
            };
            await api.productService.update(updatedProduct.id, payload);
            await refreshProducts();
        } catch (err) {
            console.error("Update Product Failed", err);
            throw err;
        }
    };

    const addCategory = async (categoryInput) => {
        try {
            const name = typeof categoryInput === 'string' ? categoryInput : categoryInput.label;
            await api.productService.createCategory({ name });
            await refreshCategories();
            return true;
        } catch (err) {
            console.error("Failed to add category", err);
        }
    };

    const addProductVariant = async (productId, variantData) => {
        try {
            await api.productService.addVariant(productId, variantData);
            await refreshProducts();
            return true;
        } catch (err) {
            console.error("Failed to add variant", err);
            throw err;
        }
    };

    const updateProductVariant = async (variantId, updateData) => {
        try {
            await api.productService.updateVariant(variantId, updateData);
            await refreshProducts();
            return true;
        } catch (err) {
            console.error("Failed to update variant", err);
            throw err;
        }
    };

    const value = {
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
        refreshProducts: initializeData // Keep exposed refresh as full refresh just in case? Or default to products
    };

    return (
        <ProductContext.Provider value={value}>
            {children}
        </ProductContext.Provider>
    );
};