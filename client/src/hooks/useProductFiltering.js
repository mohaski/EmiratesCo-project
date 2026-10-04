import { useState, useMemo, useEffect, useDeferredValue } from 'react';
import { useProducts } from '../context/ProductContext';
import { isProfileCategory, isGlassCategory, isAccessoryCategory } from '../utils/colors';
import { matchesSubCategory as matchesSubCategory_ } from '../utils/subCategories';
export { PROFILE_COLORS } from '../utils/colors';

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
    const isProfileCategoryActive = useMemo(() =>
        isProfileCategory(activeCategory),
        [activeCategory]);

    const isGlassCategoryActive = useMemo(() =>
        isGlassCategory(activeCategory),
        [activeCategory]);

    const isAccessoriesCategoryActive = useMemo(() =>
        isAccessoryCategory(activeCategory),
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

            // A product with no sub-category counts as "general" — the same rule Product
            // Management uses; a strict match hid such products from Sales entirely.
            const matchesSubCategory = matchesSubCategory_(p, activeSubCategory);
            const matchesSearch = !lowerQuery || p.name.toLowerCase().includes(lowerQuery);

            let matchesColor = true;
            if (isProfileCategoryActive && profileColor) {
                // Strict Color Filtering:
                // Product must either have 'Color' in its attributes array matching the selection
                // OR have a variant with that Color.
                const hasColorAttribute = p.attributes?.Color?.includes(profileColor);
                const hasColorVariant = p.variants?.some(v => v.attributes?.Color === profileColor);

                // Only products that have colours are filtered by colour. (`p.variants` is
                // always an array, so the old check filtered every product and hid any
                // colourless profile item from Sales.)
                const hasAnyColor = !!p.attributes?.Color || (p.variants || []).some(v => v.attributes?.Color);
                if (hasAnyColor) {
                    matchesColor = hasColorAttribute || hasColorVariant;
                }
            }

            if (isProfileCategoryActive || isGlassCategoryActive || isAccessoriesCategoryActive) {
                return matchesSubCategory && matchesSearch && matchesColor;
            }
            return matchesSearch;
        });
    }, [activeCategory, activeSubCategory, deferredQuery, isProfileCategoryActive, isGlassCategoryActive, isAccessoriesCategoryActive, PRODUCTS, profileColor]);

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
        isProfileCategory: isProfileCategoryActive,
        isGlassCategory: isGlassCategoryActive,
        isAccessoriesCategory: isAccessoriesCategoryActive
    };
}
