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
    updatePaymentStatus: async (id, status) => {
        const response = await api.put(`/orders/${id}/payment-status?new_status=${status}`);
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
    getAuditHistory: async (entityType = null, skip = 0, limit = 100) => {
        const params = new URLSearchParams({ skip, limit });
        if (entityType) params.append('entity_type', entityType);
        const response = await api.get(`/orders/audit/history?${params}`);
        return response.data;
    },
    cancelOrder: async (id, pin) => {
        const response = await api.put(`/orders/${id}/cancel`, { pin });
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
    /** Get available offcut pieces for a product. Pass variantId to filter. */
    getOffcuts: async (productId, variantId = null) => {
        const params = variantId ? `?variant_id=${variantId}` : '';
        const response = await api.get(`/products/${productId}/offcuts${params}`);
        return response.data;
    },
    getRestockHistory: async (skip = 0, limit = 100, productId = null) => {
        const params = new URLSearchParams({ skip, limit });
        if (productId) params.append('product_id', productId);
        const response = await api.get(`/products/restock-history?${params}`);
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
    createPayment: async (paymentData) => {
        const response = await api.post('/financials/payments', paymentData);
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

// Attach services to api instance for convenience
api.orderService = OrderService;
api.invoiceService = InvoiceService;
api.productService = ProductService;
api.attributeService = AttributeService;
api.financialService = FinancialService;
api.userService = UserService;
api.messagingService = MessagingService;
api.settingsService = SettingsService;

export default api;
