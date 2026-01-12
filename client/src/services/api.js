import axios from 'axios';

// Base URL configuration (Vite proxy or direct)
const API_URL = 'http://localhost:8000';

// Create Axios Instance
const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Interceptor for Auth Token
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token'); // Assuming standard token storage
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

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
    getAllOrders: async (skip = 0, limit = 20) => {
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
    }
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
    updateVariant: async (variantId, updateData) => {
        const response = await api.put(`/products/variants/${variantId}`, updateData);
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
    }
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

// Attach services to api instance for convenience
api.orderService = OrderService;
api.productService = ProductService;
api.financialService = FinancialService;
api.userService = UserService;
api.messagingService = MessagingService;

export default api;
