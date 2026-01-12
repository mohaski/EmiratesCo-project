import { useState, useMemo, useEffect, useDeferredValue } from 'react';
import { useProducts } from '../context/ProductContext';

export const PROFILE_COLORS = [
    { name: 'White', hex: '#FFFFFF' },
    { name: 'Bronze', hex: '#8B4513' },
    { name: 'Silver', hex: '#C0C0C0' },
    { name: 'Grey', hex: '#808080' }
];

export function useProductFiltering() {
    const { products: PRODUCTS, categories: CATEGORIES } = useProducts();

    // --- STATE ---
    const [activeCategory, setActiveCategory] = useState('ke-profile');
    const [activeSubCategory, setActiveSubCategory] = useState('window');
    const [searchQuery, setSearchQuery] = useState('');
    const [profileColor, setProfileColor] = useState('White');

    // Performance: Defer the search query for filtering
    const deferredQuery = useDeferredValue(searchQuery);

    // --- MEMOIZED HELPERS ---
    const isProfileCategory = useMemo(() =>
        activeCategory === 'ke-profile' || activeCategory === 'tz-profile',
        [activeCategory]);

    const isGlassCategory = useMemo(() =>
        activeCategory === 'glass',
        [activeCategory]);

    const isAccessoriesCategory = useMemo(() =>
        activeCategory === 'accessories',
        [activeCategory]);

    const currentSubCategories = useMemo(() => {
        const cat = CATEGORIES.find(c => c.id === activeCategory);
        return cat?.subCategories || [];
    }, [activeCategory, CATEGORIES]);

    // --- EFFECT: Sub-category Reset ---
    useEffect(() => {
        if (currentSubCategories.length > 0) {
            setActiveSubCategory(currentSubCategories[0].id);
        } else {
            setActiveSubCategory('general');
        }
    }, [activeCategory, currentSubCategories]);

    // --- MEMOIZED FILTERING ---
    const filteredProducts = useMemo(() => {
        const lowerQuery = deferredQuery.toLowerCase();

        return PRODUCTS.filter(p => {
            const matchesCategory = p.category === activeCategory;
            if (!matchesCategory) return false;

            const matchesSubCategory = p.subCategory === activeSubCategory;
            const matchesSearch = !lowerQuery || p.name.toLowerCase().includes(lowerQuery);

            let matchesColor = true;
            if (isProfileCategory && profileColor) {
                // Strict Color Filtering:
                // Product must either have 'Color' in its attributes array matching the selection
                // OR have a variant with that Color.
                const hasColorAttribute = p.attributes?.Color?.includes(profileColor);
                const hasColorVariant = p.variants?.some(v => v.attributes?.Color === profileColor);

                if (p.attributes?.Color || p.variants) {
                    matchesColor = hasColorAttribute || hasColorVariant;
                }
            }

            if (isProfileCategory || isGlassCategory || isAccessoriesCategory) {
                return matchesSubCategory && matchesSearch && matchesColor;
            }
            return matchesSearch;
        });
    }, [activeCategory, activeSubCategory, deferredQuery, isProfileCategory, isGlassCategory, isAccessoriesCategory, PRODUCTS, profileColor]);

    return {
        // State
        activeCategory, setActiveCategory,
        activeSubCategory, setActiveSubCategory,
        searchQuery, setSearchQuery,
        profileColor, setProfileColor,

        // Data
        filteredProducts,
        currentSubCategories,
        CATEGORIES, // pass through from context

        // Helpers
        isProfileCategory,
        isGlassCategory,
        isAccessoriesCategory
    };
}
