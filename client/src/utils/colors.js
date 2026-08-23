// Single source of truth for the aluminium profile color swatches used
// across product tiles (sales grid, cart, order summary, product modal).
export const PROFILE_COLORS = [
    { name: 'White', hex: '#FFFFFF' },
    { name: 'Brown', hex: '#8B4513' },
    { name: 'Silver', hex: '#DCE1E6' },
    { name: 'Grey', hex: '#5B6370' },
];

export function getProfileColorHex(colorName) {
    if (!colorName) return null;
    return PROFILE_COLORS.find(c => c.name.toLowerCase() === colorName.toLowerCase())?.hex || null;
}

// Picks readable text color for an arbitrary background hex.
export function getContrastText(hex) {
    if (!hex) return '#e2e8f0';
    const c = hex.replace('#', '');
    const r = parseInt(c.substring(0, 2), 16);
    const g = parseInt(c.substring(2, 4), 16);
    const b = parseInt(c.substring(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6 ? '#0f172a' : '#f1f5f9';
}

// Category "family" classifiers — driven by the category slug (derived from
// whatever name the CEO gives the category, e.g. "TZ Profile" -> "tz-profile",
// "Euro Profile" -> "euro-profile"), NOT a fixed list of known categories, so
// any newly-added "<X> Profile" / "<X> Glass" / "<X> Accessories" category
// automatically inherits the right calculator/filtering/grouping behavior.
export function isProfileCategory(category) {
    return (category || '').toLowerCase().includes('profile');
}
export function isGlassCategory(category) {
    return (category || '').toLowerCase().includes('glass');
}
export function isAccessoryCategory(category) {
    return (category || '').toLowerCase().includes('accessor');
}

// Accent color per product category, used to tint tiles that have no
// single selected color to reflect (stock control, admin products table).
export function getCategoryAccent(category) {
    if (isProfileCategory(category)) return '#a855f7';
    if (isGlassCategory(category)) return '#06b6d4';
    if (isAccessoryCategory(category)) return '#22c55e';
    return '#3b82f6';
}

// Lightens (positive) or darkens (negative) a hex color by a percentage.
export function shade(hex, percent) {
    const c = hex.replace('#', '');
    const r = parseInt(c.substring(0, 2), 16);
    const g = parseInt(c.substring(2, 4), 16);
    const b = parseInt(c.substring(4, 6), 16);
    const amt = Math.round(2.55 * percent);
    const clamp = v => Math.min(255, Math.max(0, v + amt));
    return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
}

export function hexToRgba(hex, alpha) {
    const c = hex.replace('#', '');
    const r = parseInt(c.substring(0, 2), 16);
    const g = parseInt(c.substring(2, 4), 16);
    const b = parseInt(c.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Diagonal gradient tile background: an explicit hex reflects the real
// color (with a sheen from light to dark), otherwise falls back to a
// neutral glass panel. Pair with the .product-tile CSS class for the
// highlight overlay.
export function tileGradient(hex) {
    return hex
        ? `linear-gradient(155deg, ${shade(hex, 16)} 0%, ${hex} 48%, ${shade(hex, -16)} 100%)`
        : 'linear-gradient(155deg, rgba(255,255,255,0.075) 0%, rgba(255,255,255,0.025) 55%, rgba(255,255,255,0.01) 100%)';
}
