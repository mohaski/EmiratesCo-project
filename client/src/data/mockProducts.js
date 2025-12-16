export const PRODUCTS = [ // --- Ke Profiles ---
    {
        id: 'k1',
        name: 'Silver Anodized Profile (KE)',
        category: 'ke-profile',
        usage: 'general',
        priceFull: 120,
        priceHalf: 65,
        priceFoot: 25,
        image: 'https://placehold.co/300x200/C0C0C0/333333?text=Silver+KE'
    },
    {
        id: 'k2',
        name: 'Champagne Gold Profile (KE)',
        category: 'ke-profile',
        usage: 'door',
        priceFull: 140,
        priceHalf: 75,
        priceFoot: 30,
        image: 'https://placehold.co/300x200/D4AF37/333333?text=Gold+KE'
    },
    {
        id: 'k3',
        name: 'Window Sliding Track (KE)',
        category: 'ke-profile',
        usage: 'window',
        priceFull: 110,
        priceHalf: 60,
        priceFoot: 22,
        image: 'https://placehold.co/300x200/999999/FFFFFF?text=Sliding+Track'
    },
    {
        id: 'k4',
        name: 'Heavy Door Frame (KE)',
        category: 'ke-profile',
        usage: 'door',
        priceFull: 160,
        priceHalf: 85,
        priceFoot: 35,
        image: 'https://placehold.co/300x200/444444/FFFFFF?text=Door+Frame'
    },

    // --- Tz Profiles ---
    {
        id: 't1',
        name: 'Heavy Duty Frame (TZ)',
        category: 'tz-profile',
        usage: 'general',
        priceFull: 180,
        priceHalf: 95,
        priceFoot: 40,
        image: 'https://placehold.co/300x200/555555/FFFFFF?text=Heavy+TZ'
    },
    {
        id: 't2',
        name: 'Casement Window Sash (TZ)',
        category: 'tz-profile',
        usage: 'window',
        priceFull: 150,
        priceHalf: 80,
        priceFoot: 32,
        image: 'https://placehold.co/300x200/777777/FFFFFF?text=Window+Sash'
    },

    // --- Glass ---
    {
        id: 'g1',
        name: '6mm Clear Glass', // Name kept generic or updated dynamically
        category: 'glass',
        usage: 'clear',
        unit: 'sqft',
        // New structure: Pricing per thickness
        thicknessPrices: [
            { thickness: '4mm', priceFull: 400, priceHalf: 210, priceSqFt: 15 },
            { thickness: '6mm', priceFull: 500, priceHalf: 260, priceSqFt: 18 },
            { thickness: '8mm', priceFull: 600, priceHalf: 310, priceSqFt: 22 },
            { thickness: '10mm', priceFull: 800, priceHalf: 420, priceSqFt: 28 },
            { thickness: '12mm', priceFull: 1000, priceHalf: 520, priceSqFt: 35 },
        ],
        image: 'https://placehold.co/300x200/87CEEB/333333?text=Clear+Glass'
    },
    {
        id: 'g2',
        name: 'Frosted Glass Panel',
        category: 'glass',
        usage: 'frost',
        unit: 'sqft',
        thicknessPrices: [
            { thickness: '4mm', priceFull: 550, priceHalf: 280, priceSqFt: 20 },
            { thickness: '6mm', priceFull: 650, priceHalf: 350, priceSqFt: 25 },
        ],
        image: 'https://placehold.co/300x200/E0FFFF/333333?text=Frosted'
    },
    {
        id: 'g3',
        name: 'One-Way Vision Glass',
        category: 'glass',
        usage: 'oneway',
        unit: 'sqft',
        thicknessPrices: [
            { thickness: '6mm', priceFull: 700, priceHalf: 380, priceSqFt: 28 },
        ],
        image: 'https://placehold.co/300x200/333333/FFFFFF?text=One+Way'
    },
    {
        id: 'g4',
        name: 'Silver Mirror',
        category: 'glass',
        usage: 'mirror',
        unit: 'sqft',
        thicknessPrices: [
            { thickness: '4mm', priceFull: 450, priceHalf: 240, priceSqFt: 16 },
            { thickness: '6mm', priceFull: 550, priceHalf: 290, priceSqFt: 20 },
        ],
        image: 'https://placehold.co/300x200/E5E4E2/333333?text=Mirror'
    },
    {
        id: 'g5',
        name: 'Dark Grey Tinted Glass',
        category: 'glass',
        usage: 'tint',
        unit: 'sqft',
        thicknessPrices: [
            { thickness: '6mm', priceFull: 550, priceHalf: 290, priceSqFt: 20 },
            { thickness: '8mm', priceFull: 650, priceHalf: 340, priceSqFt: 24 },
        ],
        image: 'https://placehold.co/300x200/444444/FFFFFF?text=Tinted'
    },
    {
        id: 'g6',
        name: 'Obscure Patterned Glass',
        category: 'glass',
        usage: 'obscure',
        unit: 'sqft',
        thicknessPrices: [
            { thickness: '4mm', priceFull: 600, priceHalf: 320, priceSqFt: 22 },
        ],
        image: 'https://placehold.co/300x200/CCCCCC/333333?text=Obscure'
    },
    {
        id: 'g7',
        name: 'Alucoboard Silver',
        category: 'glass', // Kept under glass as requested
        usage: 'alucoboard',
        unit: 'sqft',
        thicknessPrices: [
            { thickness: '4mm', priceFull: 400, priceHalf: 210, priceSqFt: 14 },
        ],
        image: 'https://placehold.co/300x200/999999/FFFFFF?text=Alucoboard'
    },

    // --- Accessories ---
    {
        id: 'a1',
        name: 'Steel Hinge Set',
        category: 'accessories',
        price: 15,
        unit: 'pair',
        image: 'https://placehold.co/300x200/777777/FFFFFF?text=Hinges'
    },
    {
        id: 'a2',
        name: 'Rubber Gasket',
        category: 'accessories',
        price: 5,
        unit: 'meter',
        image: 'https://placehold.co/300x200/222222/FFFFFF?text=Gasket'
    }
];

export const CATEGORIES = [
    { id: 'ke-profile', label: 'Ke Profile', icon: '🏗️' },
    { id: 'tz-profile', label: 'Tz Profile', icon: '🏢' },
    { id: 'glass', label: 'Glass', icon: '🪟' },
    { id: 'accessories', label: 'Accessories', icon: '🔩' },
];
