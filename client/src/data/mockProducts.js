export const PRODUCTS = [
    // --- Ke Profiles ---
    {
        id: 'k1',
        name: 'Silver Anodized Profile (KE)',
        category: 'ke-profile',
        usage: 'general',
        priceFull: 120,
        priceHalf: 65,
        priceFoot: 25,
        image: 'https://placehold.co/300x200/C0C0C0/333333?text=Silver+KE',
        attributes: { Length: ['21ft', '10ft'] },
        defaultAttributes: { Length: '21ft' }, // Default selection
        variants: [
            { attributes: { Length: '21ft' }, priceFull: 120, priceHalf: 65, priceFoot: 25 },
            { attributes: { Length: '10ft' }, priceFull: 60, priceHalf: 35, priceFoot: 25 }
        ]
    },

    // --- Accessories ---
    {
        id: 'a1',
        name: 'Steel Hinge Set',
        category: 'accessories',
        usage: 'door',
        hasColor: false,
        price: 15,
        unit: 'pair',
        image: 'https://placehold.co/300x200/777777/FFFFFF?text=Hinges'
    },
    {
        id: 'a2',
        name: 'Rubber Gasket (EPDM)',
        category: 'accessories',
        usage: 'window',
        hasColor: false,
        thicknesses: ['4mm', '5mm', '6mm'], // New: Thickness options
        price: 5,
        unit: 'meter',
        // New: Multiple Roll Options (Big vs Small)
        rollOptions: [
            { label: 'Small Roll', length: 50, price: 200 },
            { label: 'Big Roll', length: 100, price: 350 }
        ],
        image: 'https://placehold.co/300x200/222222/FFFFFF?text=Gasket'
    },
    {
        id: 'a3',
        name: 'Window Handle (Touch Lock)',
        category: 'accessories',
        usage: 'window',
        hasColor: true, // White, Black, Silver
        price: 85,
        unit: 'pcs',
        image: 'https://placehold.co/300x200/555555/FFFFFF?text=Handle'
    },
    {
        id: 'a4',
        name: 'Assembly Screws (1.5")',
        category: 'accessories',
        usage: 'general',
        hasColor: false,
        price: 2,
        unit: 'pcs',
        image: 'https://placehold.co/300x200/999999/FFFFFF?text=Screws'
    },
    {
        id: 'a5',
        name: 'Wool Pile (Brush)',
        category: 'accessories',
        usage: 'window',
        hasColor: true, // Grey, Black
        price: 8,
        unit: 'meter',
        priceRoll: 700, // New
        rollLength: 100, // New
        image: 'https://placehold.co/300x200/666666/FFFFFF?text=Wool+Pile'
    },
];

export const CATEGORIES = [
    { id: 'ke-profile', label: 'Ke Profile', icon: '🏗️' },
    { id: 'tz-profile', label: 'Tz Profile', icon: '🏢' },
    { id: 'glass', label: 'Glass', icon: '🪟' },
    { id: 'accessories', label: 'Accessories', icon: '🔩' },
];
