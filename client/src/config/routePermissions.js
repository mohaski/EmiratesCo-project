// Single source of truth for which roles may access which routes.
// Used by Layout.jsx (to hide nav links) and App.jsx (to actually block navigation) —
// keeping both in sync so restricted pages can't be reached by bypassing the sidebar.
export const ROUTE_ROLES = {
    '/':                    ['admin', 'ceo', 'manager', 'cashier'],
    '/sales':               ['manager', 'cashier'],
    '/checkout':            ['manager', 'cashier'],
    '/checkout/receipt':    ['manager', 'cashier'],
    '/invoice':             ['manager', 'cashier'],
    '/invoice/review':      ['manager', 'cashier'],
    '/orders':              ['manager', 'ceo', 'admin'],
    '/orders/review':       ['manager', 'ceo', 'admin'],
    '/inventory':           ['cashier'],
    '/add-product':         ['admin', 'ceo'],
    '/manage-products':     ['admin', 'ceo'],
};
