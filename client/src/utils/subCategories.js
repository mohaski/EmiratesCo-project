import { isProfileCategory, isGlassCategory, isAccessoryCategory } from './colors';

export const PROFILE_SUB_CATEGORIES = [{ id: 'window', label: 'Windows' }, { id: 'door', label: 'Doors' }, { id: 'general', label: 'General' }];
export const GLASS_SUB_CATEGORIES = [{ id: 'clear', label: 'Clear' }, { id: 'oneway', label: 'One/Way' }, { id: 'tint', label: 'Tinted' }, { id: 'mirror', label: 'Mirror' }, { id: 'frost', label: 'Frost' }, { id: 'obscure', label: 'Obscure' }, { id: 'alucoboard', label: 'Alucoboard' }];
export const ACCESSORY_SUB_CATEGORIES = [{ id: 'general', label: 'General' }];

// Family-based fallbacks — used only for a category that has no sub-categories
// of its own configured yet (via Manage Options), keyed off the category "family"
// (profile/glass/accessory) so any newly-added "<X> Profile" category automatically
// gets the same Windows/Doors/General usages as the existing ones.
export const fallbackSubCategoriesFor = (category) => {
    if (isProfileCategory(category)) return PROFILE_SUB_CATEGORIES;
    if (isGlassCategory(category)) return GLASS_SUB_CATEGORIES;
    if (isAccessoryCategory(category)) return ACCESSORY_SUB_CATEGORIES;
    return [];
};

/** The sub-category pills to show for a category: its own configured list
 * (added via Manage Options, stored on categories.sub_categories — the same
 * source useProductFiltering.js reads for the Sales/Inventory pages), falling
 * back to the family defaults only when none have been configured yet. */
export const subCategoriesFor = (categoryId, categories) => {
    const cat = categories.find(c => c.id === categoryId);
    if (cat?.subCategories?.length > 0) return cat.subCategories;
    return fallbackSubCategoriesFor(categoryId);
};

/** Products belonging to a category + sub-category pill. A product with no
 * sub-category of its own is treated as "general", matching how the catalogue
 * has always filtered them. */
export const matchesSubCategory = (product, subCategoryId) =>
    product.subCategory === subCategoryId || (!product.subCategory && subCategoryId === 'general');
