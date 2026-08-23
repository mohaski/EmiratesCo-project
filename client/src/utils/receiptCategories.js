// Maps product categories to the shop-floor departments that prep them,
// so Checkout (selection) and Receipt (grouping) agree on the same buckets.
// Bucket is derived from the category slug (e.g. "euro-profile" -> profile)
// rather than a fixed list, so any newly-added "<X> Profile" category is
// automatically prepped/grouped the same way as the existing ones.
import { isProfileCategory, isGlassCategory, isAccessoryCategory } from './colors';

export const BUCKET_ORDER = ['profile', 'glass', 'accessory'];

// Muted, print-friendly jewel tones — refined rather than the saturated app-UI palette.
export const BUCKET_META = {
    profile: { label: 'Profile Cutting', icon: '📐', color: '#6d4aa0' },
    glass: { label: 'Glass Cutting', icon: '🪟', color: '#0e7c86' },
    accessory: { label: 'Accessory Prep', icon: '🔩', color: '#3f7a4d' },
};

export const bucketOf = (category) => {
    if (isProfileCategory(category)) return 'profile';
    if (isGlassCategory(category)) return 'glass';
    if (isAccessoryCategory(category)) return 'accessory';
    return null;
};
