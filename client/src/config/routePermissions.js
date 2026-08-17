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
    '/orders':              ['manager', 'cashier', 'ceo', 'admin'],
    '/orders/review':       ['manager', 'cashier', 'ceo', 'admin'],
    // Cashier's standalone "Collect Debt" entry — manager/ceo/admin get it
    // merged with Dues Follow-Up under '/debt-management' instead (see below).
    '/collect-payments':    ['cashier'],
    '/debt-management':     ['ceo', 'manager', 'admin'],
    '/inventory':           ['cashier', 'manager'],
    '/add-product':         ['admin', 'ceo'],
    '/manage-products':     ['admin', 'ceo'],
    // Manager gets everything (checkout, return, loans, catalog) as tabs on one page — see '/tools/manage'.
    '/tools':               ['cashier'],
    '/tools/manage':        ['manager'],
    '/change-password':     ['admin', 'ceo', 'manager', 'cashier'],
    '/users':               ['ceo', 'admin'],
};
