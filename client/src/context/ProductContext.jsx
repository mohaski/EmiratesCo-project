import React, { createContext, useContext, useState, useEffect } from 'react';
import { PRODUCTS as INITIAL_PRODUCTS, CATEGORIES as INTIAL_CATEGORIES } from '../data/mockProducts';

const ProductContext = createContext();

export const useProducts = () => {
    const context = useContext(ProductContext);
    if (!context) {
        throw new Error('useProducts must be used within a ProductProvider');
    }
    return context;
};

export const ProductProvider = ({ children }) => {
    // Initialize products from LocalStorage if available, otherwise use mock data
    const [products, setProducts] = useState(() => {
        const savedProducts = localStorage.getItem('emirates_products');
        return savedProducts ? JSON.parse(savedProducts) : INITIAL_PRODUCTS;
    });

    const [categories, setCategories] = useState(() => {
        const savedCategories = localStorage.getItem('emirates_categories');
        return savedCategories ? JSON.parse(savedCategories) : INTIAL_CATEGORIES;
    });

    // Persistence Effect
    useEffect(() => {
        localStorage.setItem('emirates_products', JSON.stringify(products));
    }, [products]);

    useEffect(() => {
        localStorage.setItem('emirates_categories', JSON.stringify(categories));
    }, [categories]);

    // Actions
    const addProduct = (newProduct) => {
        setProducts(prev => [...prev, newProduct]);
    };

    const deleteProduct = (productId) => {
        setProducts(prev => prev.filter(p => p.id !== productId));
    };

    const updateProduct = (updatedProduct) => {
        setProducts(prev => prev.map(p => p.id === updatedProduct.id ? updatedProduct : p));
    };

    const addCategory = (newCategory) => {
        // Expects { id, label, icon }
        setCategories(prev => [...prev, newCategory]);
    };

    const value = {
        products,
        categories,
        addProduct,
        deleteProduct,
        updateProduct,
        addCategory
    };

    return (
        <ProductContext.Provider value={value}>
            {children}
        </ProductContext.Provider>
    );
};
