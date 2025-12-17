
export const MOCK_ORDERS = [
    {
        id: 'ORD-1734451200',
        date: '2024-12-17T14:30:00',
        customer: { name: 'Ahmed Al-Mansoor', phone: '050-123-4567', type: 'registered' },
        items: [
            { id: 'k1', name: 'Silver Anodized Profile (KE)', qty: 10, total: 2400 },
            { id: 'g1', name: '6mm Clear Glass', qty: 5, total: 4250 }
        ],
        totalAmount: 6650,
        status: 'completed',
        paymentMethod: 'cash'
    },
    {
        id: 'ORD-1734440000',
        date: '2024-12-17T10:15:00',
        customer: { name: 'Walk-in Customer', phone: '-', type: 'walk-in' },
        items: [
            { id: 'a1', name: 'Steel Hinge Set', qty: 2, total: 60 }
        ],
        totalAmount: 60,
        status: 'completed',
        paymentMethod: 'card'
    },
    {
        id: 'ORD-1734360000',
        date: '2024-12-16T16:45:00',
        customer: { name: 'BuildRight Construction', phone: '055-987-6543', type: 'registered' },
        items: [
            { id: 't1', name: 'Heavy Duty Frame (TZ)', qty: 20, total: 13000 },
            { id: 'k1', name: 'Silver Anodized Profile (KE)', qty: 50, total: 12000 }
        ],
        totalAmount: 25000,
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
