
export const MOCK_ORDERS = [
    {
        id: 'ORD-PERFECT-001',
        date: '2024-12-18T16:45:00',
        customer: { name: 'Master Builder Co', phone: '055-123-9876', type: 'registered' },
        items: [
            // Item 1: Clear Glass 4mm (Mixed Sheets & Cuts)
            {
                id: 'perm-g1',
                name: '4mm Clear Glass',
                category: 'glass',
                image: 'https://placehold.co/300x200/87CEEB/333333?text=4mm+Clear',
                totalPrice: 2250, // Calculated total
                details: {
                    thickness: '4mm',
                    glassItems: [
                        {
                            label: 'Full Sheet',
                            qty: 2,
                            type: 'full',
                            width: 244,
                            height: 366,
                            area: 32, // approx sqft
                            unitListPrice: 18.00, // Ksh/sqft
                            unit: 'ft²',
                            totalPrice: 1152
                        },
                        {
                            label: 'Half Sheet',
                            qty: 1,
                            type: 'half',
                            width: 244,
                            height: 183,
                            area: 16,
                            unitListPrice: 18.00,
                            unit: 'ft²',
                            totalPrice: 288
                        },
                        {
                            label: 'Custom Cut 100x100',
                            qty: 3,
                            type: 'cut',
                            width: 100,
                            height: 100,
                            area: 10.76, // 1m2 -> ~10.76 sqft
                            unitListPrice: 25.00, // Premium for cut
                            unit: 'ft²',
                            totalPrice: 810
                        }
                    ]
                }
            },
            // Item 2: Clear Glass 6mm (Mixed Sheets & Cuts)
            {
                id: 'perm-g2',
                name: '6mm Clear Glass',
                category: 'glass',
                image: 'https://placehold.co/300x200/60A5FA/FFFFFF?text=6mm+Clear',
                totalPrice: 5800,
                details: {
                    thickness: '6mm',
                    glassItems: [
                        {
                            label: 'Full Sheet',
                            qty: 4,
                            type: 'full',
                            width: 244,
                            height: 366,
                            area: 32,
                            unitListPrice: 28.00,
                            unit: 'ft²',
                            totalPrice: 3584
                        },
                        {
                            label: 'Half Sheet',
                            qty: 1,
                            type: 'half',
                            width: 244,
                            height: 183,
                            area: 16,
                            unitListPrice: 28.00,
                            unit: 'ft²',
                            totalPrice: 448
                        },
                        {
                            label: 'Custom Cut 200x50',
                            qty: 6,
                            type: 'cut',
                            width: 200,
                            height: 50,
                            area: 10.76,
                            unitListPrice: 35.00,
                            unit: 'ft²',
                            totalPrice: 1768 // approx
                        }
                    ]
                }
            },
            // Item 3: Profile (Mixed Lengths)
            {
                id: 'perm-p1',
                name: 'Heavy Duty Frame (TZ)',
                category: 'tz-profile',
                image: 'https://placehold.co/300x200/555555/FFFFFF?text=Heavy+TZ',
                totalPrice: 2400,
                details: {
                    full: 10,
                    half: 0,
                    feet: 14,
                    color: 'Champagne',
                    qty: 10,
                    unit: 'pcs',
                    // Optional breakdown for profile logic if needed in future
                    profileItems: [
                        { type: 'full', length: 6.0, qty: 10, unitPrice: 200 },
                        { type: 'cut', length: 2.5, qty: 2, unitPrice: 100 }
                    ]
                }
            }
        ],
        totalAmount: 10450,
        status: 'completed',
        paymentMethod: 'invoice'
    },
    {
        id: 'ORD-SIMPLE-002',
        date: '2024-12-18T10:15:00',
        customer: { name: 'Studio Design', phone: '04-333-4444', type: 'registered' },
        items: [
            {
                id: 't1',
                name: 'Heavy Duty Frame (TZ)',
                category: 'tz-profile',
                image: 'https://placehold.co/300x200/555555/FFFFFF?text=Heavy+TZ',
                totalPrice: 2400,
                details: { full: 10, half: 0, feet: 0, color: 'Champagne', length: 19, qty: 10, unit: 'pcs' }
            }
        ],
        totalAmount: 2400,
        status: 'completed',
        paymentMethod: 'invoice'
    }
];

export const MOCK_INVOICES = [
    {
        id: 'INV-100234',
        date: '2024-12-17T11:00:00',
        customer: { name: 'Sarah J.', phone: '052-555-1234', type: 'new' },
        items: 3,
        totalAmount: 1250.50,
        status: 'generated'
    },
    {
        id: 'INV-100233',
        date: '2024-12-16T09:30:00',
        customer: { name: 'Tech Solutions Office', phone: '04-111-2222', type: 'registered' },
        items: 12,
        totalAmount: 8400.00,
        status: 'generated'
    }
];
