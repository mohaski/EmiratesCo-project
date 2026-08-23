import axios from 'axios';
import { showToast, extractErrorMessage } from '../utils/toast';

// Base URL configuration.
// - VITE_API_URL explicitly set (e.g. split deployment) always wins.
// - Dev server (`npm run dev`) falls back to localhost:8000.
// - Production build falls back to '' (same-origin) since the API is served
//   from the same FastAPI process as the built frontend — this makes the
//   build work unchanged from any LAN client, no IP baked in.
const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8000' : '');

// Create Axios Instance
const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Interceptor: attach auth token
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Interceptor: global error toasts — every failed request shows a message
api.interceptors.response.use(
    (response) => response,
    (error) => {
        const status = error.response?.status;

        if (status === 401) {
            showToast('Your session has expired. Please log in again.', 'warning');
            return Promise.reject(error);
        }
        if (status === 403) {
            showToast('You do not have permission to perform this action.', 'warning');
            return Promise.reject(error);
        }

        const message = extractErrorMessage(error);
        showToast(message, status >= 500 ? 'error' : 'warning');
        return Promise.reject(error);
    }
);

export const OrderService = {
    // Transactional Order Creation
    createOrder: async (orderData) => {
        const response = await api.post('/orders/', orderData);
        return response.data;
    },
    getOrder: async (id) => {
        const response = await api.get(`/orders/${id}`);
        return response.data;
    },
    getAllOrders: async (skip = 0, limit = 100) => {
        const response = await api.get(`/orders/?skip=${skip}&limit=${limit}`);
        return response.data;
    },
    getCustomerOrders: async (customerId) => {
        const response = await api.get(`/orders/customer/${customerId}`);
        return response.data;
    },
    /** Orders with an outstanding balance — feeds the Collect Payments page. */
    getOutstandingOrders: async (skip = 0, limit = 200) => {
        const response = await api.get(`/orders/with-balance?skip=${skip}&limit=${limit}`);
        return response.data;
    },
    updateWorkflowStatus: async (id, status) => {
        const response = await api.put(`/orders/${id}/workflow-status?new_status=${status}`);
        return response.data;
    },
    getOrderItems: async (id) => {
        const response = await api.get(`/orders/${id}/items`);
        return response.data;
    },
    editOrder: async (id, orderData) => {
        const response = await api.put(`/orders/${id}/edit`, orderData);
        return response.data;
    },
    /** CEO/admin-only activity feed spanning every module that writes to edit_history
     * (restocks, stock-batch sessions, offcut corrections, order edits/status/cancellations).
     * since/until are inclusive YYYY-MM-DD bounds. */
    getAuditHistory: async (entityType = null, skip = 0, limit = 100, userId = null, since = null, until = null) => {
        const params = new URLSearchParams({ skip, limit });
        if (entityType) params.append('entity_type', entityType);
        if (userId) params.append('user_id', userId);
        if (since) params.append('since', since);
        if (until) params.append('until', until);
        const response = await api.get(`/orders/audit/history?${params}`);
        return response.data;
    },
    cancelOrder: async (id, pin) => {
        const response = await api.put(`/orders/${id}/cancel`, { pin });
        return response.data;
    },
    correctOffcutEvent: async (orderId, { item_id, line_idx, event_idx, new_remainders, failed_cut_indices, forced_offcut_id, notes }) => {
        const response = await api.put(`/orders/${orderId}/correct-offcut`, {
            item_id, line_idx, event_idx, new_remainders, failed_cut_indices, forced_offcut_id, notes,
        });
        return response.data;
    },
    /** 1D (bar/profile) analogue of correctOffcutEvent — corrects a single
     * offcut_sources entry's remainder, and/or replaces the source it came from. */
    correctProfileOffcutEvent: async (orderId, { item_id, line_idx, event_idx, new_remainder_length, replace_source, forced_offcut_id, notes }) => {
        const response = await api.put(`/orders/${orderId}/correct-profile-offcut`, {
            item_id, line_idx, event_idx, new_remainder_length, replace_source, forced_offcut_id, notes,
        });
        return response.data;
    },
    /** Batch-report a set of OrderItems as cut. Used by OrderSummaryPage's
     * single-item quick-mark. */
    markCuttingDone: async (itemIds) => {
        const response = await api.put('/orders/cutting-queue/mark-done', { item_ids: itemIds });
        return response.data;
    },
    /** Marks every still-pending item on one order as cut, and the order itself
     * as completed, in one call. */
    markOrderCuttingDone: async (orderId) => {
        const response = await api.put(`/orders/${orderId}/mark-cutting-done`);
        return response.data;
    },
    /** Order-queue batch report: marks every still-pending item across the given
     * orders as cut, and each order as completed. Used by the cutting-queue
     * multi-select page (whole orders, not individual items). */
    markOrdersCuttingDone: async (orderIds) => {
        const response = await api.put('/orders/cutting-queue/mark-orders-done', { order_ids: orderIds });
        return response.data;
    },
    /** Orders with at least one item still awaiting a cutting report, for the
     * order-level cutting-queue page. */
    getCuttingQueue: async (skip = 0, limit = 100) => {
        const response = await api.get(`/orders/cutting-queue?skip=${skip}&limit=${limit}`);
        return response.data;
    },
};

export const ProductService = {
    getAll: async () => {
        const response = await api.get('/products/');
        return response.data;
    },
    create: async (productData) => {
        const response = await api.post('/products/', productData);
        return response.data;
    },
    update: async (id, data) => {
        const response = await api.put(`/products/${id}`, data);
        return response.data;
    },
    delete: async (id) => {
        const response = await api.delete(`/products/${id}`);
        return response.data;
    },
    updateStock: async (id, stockData) => {
        const response = await api.put(`/products/${id}/stock`, stockData);
        return response.data;
    },
    checkAvailability: async (id, qty) => {
        const response = await api.get(`/products/${id}/availability?qty=${qty}`);
        return response.data;
    },
    getAllCategories: async () => {
        const response = await api.get('/products/categories');
        return response.data;
    },
    createCategory: async (categoryData) => {
        const response = await api.post('/products/categories', categoryData);
        return response.data;
    },
    addSubCategory: async (categoryDbId, name) => {
        const response = await api.post(`/products/categories/${categoryDbId}/subcategories`, { name });
        return response.data;
    },
    addVariant: async (productId, variantData) => {
        const response = await api.post(`/products/${productId}/variants`, variantData);
        return response.data;
    },
    addVariantsBulk: async (productId, variantsData) => {
        const response = await api.post(`/products/${productId}/variants/bulk`, variantsData);
        return response.data;
    },
    updateVariant: async (variantId, updateData) => {
        const response = await api.put(`/products/variants/${variantId}`, updateData);
        return response.data;
    },
    deleteVariant: async (variantId) => {
        const response = await api.delete(`/products/variants/${variantId}`);
        return response.data;
    },
    /** Get available offcut pieces for a product. Pass variantId to filter. */
    getOffcuts: async (productId, variantId = null) => {
        const params = variantId ? `?variant_id=${variantId}` : '';
        const response = await api.get(`/products/${productId}/offcuts${params}`);
        return response.data;
    },
    /**
     * Manager-entered offcuts — leftover pieces measured by hand rather than
     * produced by a cutting job. offcuts: [{ variant_id, length, width, height, quantity }].
     */
    addOffcutsBulk: async (productId, offcuts) => {
        const response = await api.post(`/products/${productId}/offcuts/bulk`, offcuts);
        return response.data;
    },
    /**
     * Dry-run preview of how the 2D glass offcut engine would fulfil a set of
     * cuts — same scoring/batching as a real sale, nothing is persisted.
     * cuts: [{ l, w, qty, u }]. Returns { groups, optimization } — groups is one
     * merged entry per physical sheet/offcut touched; optimization summarizes the
     * multi-strategy search (which packing heuristics were tried and which won).
     */
    previewGlassCuts: async (productId, variantId, cuts) => {
        const response = await api.post(`/products/${productId}/glass-cut-preview`, { variant_id: variantId, cuts });
        return response.data;
    },
    /**
     * Dry-run whether the given line items — profile full/half/custom-cut,
     * glass sheet-full/sheet-half/glass-cut, etc. — can be fulfilled from
     * current stock — reuses the same deduction logic a real checkout would
     * run, but nothing is persisted. Returns { ok: boolean, message:
     * string|null }. Unlike previewGlassCuts, an "insufficient stock" result
     * is a normal 200 (not a 422): this is called automatically on every
     * debounced keystroke via ProfileCalculator/GlassCalculator, and a
     * routine "not enough stock yet" state shouldn't trigger the global
     * error-toast interceptor above.
     */
    checkCutFeasibility: async (productId, variantId, lineItems) => {
        const response = await api.post(`/products/${productId}/cut-feasibility`, { variant_id: variantId, line_items: lineItems });
        return response.data;
    },
    getRestockHistory: async (skip = 0, limit = 100, productId = null) => {
        const params = new URLSearchParams({ skip, limit });
        if (productId) params.append('product_id', productId);
        const response = await api.get(`/products/restock-history?${params}`);
        return response.data;
    },
    /**
     * Dry-run: given cut pieces whose recorded source turned out to be wrong
     * (the cutter missed), what replacement offcut/sheet would the engine use
     * to supply them, and what would it leave behind? Nothing is persisted.
     * pieces: [{ width, height }] (mm). forcedOffcutId overrides the
     * auto-suggestion with a specific existing offcut. Returns { events }.
     */
    previewOffcutReplacement: async (productId, { variantId, pieces, forcedOffcutId } = {}) => {
        const response = await api.post(`/products/${productId}/offcut-replacement-preview`, {
            variant_id: variantId, pieces, forced_offcut_id: forcedOffcutId,
        });
        return response.data;
    },
};

export const AttributeService = {
    getAll: async () => {
        const response = await api.get('/attributes/');
        return response.data;
    },
    createClass: async (name, type = 'list') => {
        const response = await api.post('/attributes/', { name, type });
        return response.data;
    },
    renameClass: async (classId, name) => {
        const response = await api.put(`/attributes/${classId}`, { name });
        return response.data;
    },
    deleteClass: async (classId) => {
        const response = await api.delete(`/attributes/${classId}`);
        return response.data;
    },
    addValue: async (classId, value) => {
        const response = await api.post(`/attributes/${classId}/values`, { value });
        return response.data;
    },
    renameValue: async (valueId, value) => {
        const response = await api.put(`/attributes/values/${valueId}`, { value });
        return response.data;
    },
    deleteValue: async (valueId) => {
        const response = await api.delete(`/attributes/values/${valueId}`);
        return response.data;
    },
};

export const FinancialService = {
    /** paymentData: { orderId, amount, paymentMethod, paymentDetails? } — paymentDetails is the
     * cash/mpesa split breakdown (e.g. { cash: 100, mpesa: 200 }), only meaningful when paymentMethod is 'split'. */
    createPayment: async (paymentData) => {
        const response = await api.post('/financials/payments', paymentData);
        return response.data;
    },
    /** Aggregate outstanding balances across all customers — feeds the Dues page. */
    getOutstandingCredits: async () => {
        const response = await api.get('/financials/credits/outstanding');
        return response.data;
    },
    getTodayCash: async () => {
        const response = await api.get('/financials/payments/cash/today');
        return response.data;
    },
    getDateCash: async (date) => {
        const response = await api.get(`/financials/payments/cash/${date}`);
        return response.data;
    },
    /** CEO oversight: money received in a day/month/year, by payment method, plus order
     * volume/status counts for the same window. date (YYYY-MM-DD) defaults to today. */
    getSummary: async (period = 'day', date = null) => {
        const params = new URLSearchParams({ period });
        if (date) params.append('date', date);
        const response = await api.get(`/financials/summary?${params}`);
        return response.data;
    },
    createCredit: async (creditData) => {
        const response = await api.post('/financials/credits', creditData);
        return response.data;
    },
    updateCredit: async (orderId, amount, updateData) => {
        const response = await api.put(`/financials/credits/${orderId}?amount=${amount}`, updateData);
        return response.data;
    },
    getCustomerCredits: async (customerId) => {
        const response = await api.get(`/financials/credits/customer/${customerId}`);
        return response.data;
    }
};

export const UserService = {
    login: async (formData) => {
        // Form Data for OAuth2
        const params = new URLSearchParams();
        params.append('username', formData.username);
        params.append('password', formData.password);

        const response = await api.post('/users/token', params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        return response.data;
    },
    register: async (userData) => {
        const response = await api.post('/users/register', userData);
        return response.data;
    },
    getMe: async () => {
        const response = await api.get('/users/me');
        return response.data;
    },
    createCustomer: async (customerData) => {
        const response = await api.post('/users/customers', customerData);
        return response.data;
    },
    getAllUsers: async () => {
        const response = await api.get('/users/');
        return response.data;
    },
    getUser: async (id) => {
        const response = await api.get(`/users/${id}`);
        return response.data;
    },
    deleteUser: async (id) => {
        const response = await api.delete(`/users/${id}`);
        return response.data;
    },
    getCustomers: async () => {
        const response = await api.get('/users/customers');
        return response.data;
    },
    resetPassword: async (userId, data) => {
        // data: { currentPassword, newPassword, confirmNewPassword }
        const response = await api.post(`/users/${userId}/password-reset`, data);
        return response.data;
    },
    changePassword: async (userId, data) => {
        // data: { newPassword, confirmNewPassword }
        const response = await api.post(`/users/${userId}/change-password`, data);
        return response.data;
    },
    adminResetPassword: async (userId, newPassword) => {
        const response = await api.post(`/users/${userId}/admin-reset-password`, { newPassword });
        return response.data;
    },
    updateRole: async (userId, role) => {
        const response = await api.put(`/users/${userId}/role`, { role });
        return response.data;
    },
    updateStatus: async (userId, isActive) => {
        const response = await api.put(`/users/${userId}/status`, { isActive });
        return response.data;
    },
};

export const InvoiceService = {
    /** Create a new invoice (quotation/draft). */
    create: async (invoiceData) => {
        const response = await api.post('/invoices/', invoiceData);
        return response.data;
    },
    /** List all invoices. Pass status to filter: 'draft'|'sent'|'converted'|'cancelled' */
    getAll: async (skip = 0, limit = 100, status = null) => {
        const params = new URLSearchParams({ skip, limit });
        if (status) params.append('status', status);
        const response = await api.get(`/invoices/?${params}`);
        return response.data;
    },
    /** Get a single invoice by ID. */
    get: async (id) => {
        const response = await api.get(`/invoices/${id}`);
        return response.data;
    },
    /** Update a draft invoice (items, customer, totals, or mark sent/cancelled). */
    update: async (id, data) => {
        const response = await api.put(`/invoices/${id}`, data);
        return response.data;
    },
    /**
     * Convert an invoice into a confirmed sales order.
     * data: { amount_paid, payment_method, payment_details?, discount? }
     */
    convert: async (id, data) => {
        const response = await api.post(`/invoices/${id}/convert`, data);
        return response.data;
    },
};

export const MessagingService = {
    send: async (msgData) => {
        const response = await api.post('/messages/', msgData);
        return response.data;
    },
    getInbox: async () => {
        const response = await api.get('/messages/inbox');
        return response.data;
    },
    markRead: async (id, statusData) => {
        const response = await api.put(`/messages/${id}/read`, statusData);
        return response.data;
    }
};

export const ToolService = {
    /** Tool catalog. Pass status to filter: 'available'|'taken'|'non_functional' */
    getAll: async (status = null) => {
        const params = status ? `?status=${status}` : '';
        const response = await api.get(`/tools/${params}`);
        return response.data;
    },
    create: async (toolData) => {
        const response = await api.post('/tools/', toolData);
        return response.data;
    },
    update: async (toolId, toolData) => {
        const response = await api.put(`/tools/${toolId}`, toolData);
        return response.data;
    },
    /** Loans (checkouts). params: { status, worker, skip, limit } */
    getLoans: async (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== '') query.append(k, v); });
        const response = await api.get(`/tools/loans?${query}`);
        return response.data;
    },
    /** data: { workerName, toolIds, notes } */
    createLoan: async (data) => {
        const response = await api.post('/tools/loans', data);
        return response.data;
    },
    /** data: { items: [{ toolId, defectNote, markNonFunctional }] } */
    returnLoan: async (loanId, data) => {
        const response = await api.put(`/tools/loans/${loanId}/return`, data);
        return response.data;
    },
};

export const SettingsService = {
    setCancelPin: async (pin) => {
        const response = await api.put('/settings/cancel-pin', { pin });
        return response.data;
    },
    getCancelPinStatus: async () => {
        const response = await api.get('/settings/cancel-pin/status');
        return response.data;
    },
};

export const StockSessionService = {
    /** Finalize a batch of Stock Control cart lines (restocks and/or manually-entered
     * offcuts) in one transaction. payload: { notes?,
     * stock_lines: [{ product_id, variant_id?, entered_quantity, entered_unit?, conversion_factor }],
     * offcut_lines: [{ product_id, variant_id?, length?, width?, height?, quantity }] } */
    finalize: async (payload) => {
        const response = await api.post('/stock-sessions/', payload);
        return response.data;
    },
    /** Session list — ceo/manager only. */
    list: async (skip = 0, limit = 100) => {
        const response = await api.get(`/stock-sessions/?skip=${skip}&limit=${limit}`);
        return response.data;
    },
    getById: async (sessionId) => {
        const response = await api.get(`/stock-sessions/${sessionId}`);
        return response.data;
    },
    /** CEO-only correction of a single finalized line's quantity. */
    correctItem: async (sessionId, itemId, payload) => {
        const response = await api.patch(`/stock-sessions/${sessionId}/items/${itemId}`, payload);
        return response.data;
    },
};

// Attach services to api instance for convenience
api.orderService = OrderService;
api.invoiceService = InvoiceService;
api.productService = ProductService;
api.attributeService = AttributeService;
api.financialService = FinancialService;
api.userService = UserService;
api.messagingService = MessagingService;
api.settingsService = SettingsService;
api.toolService = ToolService;
api.stockSessionService = StockSessionService;

export default api;
