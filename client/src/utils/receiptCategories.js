// Maps product categories to the shop-floor departments that prep them,
// so Checkout (selection) and Receipt (grouping) agree on the same buckets.
export const CATEGORY_BUCKETS = {
    'ke-profile': 'profile',
    'tz-profile': 'profile',
    'glass': 'glass',
    'accessories': 'accessory',
};

export const BUCKET_ORDER = ['profile', 'glass', 'accessory'];

// Muted, print-friendly jewel tones — refined rather than the saturated app-UI palette.
export const BUCKET_META = {
    profile: { label: 'Profile Cutting', icon: '📐', color: '#6d4aa0' },
    glass: { label: 'Glass Cutting', icon: '🪟', color: '#0e7c86' },
    accessory: { label: 'Accessory Prep', icon: '🔩', color: '#3f7a4d' },
};

export const bucketOf = (category) => CATEGORY_BUCKETS[category] || null;
