import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProductProvider } from './context/ProductContext';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import SalesDashboard from './pages/SalesDashboard';
import CheckoutPage from './pages/CheckoutPage';
import DashboardPage from './pages/DashboardPage';
import InventoryPage from './pages/InventoryPage';
import AddProductPage from './pages/AddProductPage';
import AdminProductsPage from './pages/AdminProductsPage';
import RoleSelectionPage from './pages/RoleSelectionPage';
import InvoiceGenPage from './pages/InvoiceGenPage';
import InvoiceReviewPage from './pages/InvoiceReviewPage';
import OrdersPage from './pages/OrdersPage';
import Layout from './components/Layout';

// Protected Route Component
const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) return <div>Loading...</div>;
  if (!user) return <Navigate to="/login" />;

  return children;
};

// Layout Wrapper for Protected Routes
const AppLayout = () => {
  return (
    <ProtectedRoute>
      <Layout />
    </ProtectedRoute>
  );
};

import { OrderProvider } from './context/OrderContext';

// ...

function App() {
  return (
    <AuthProvider>
      <ProductProvider>
        <OrderProvider>
          <Router>
            <Routes>
              {/* Public Routes */}
              <Route path="/login" element={<Login />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />

              {/* Standalone Protected Routes */}
              <Route path="/checkout" element={
                <ProtectedRoute>
                  <CheckoutPage />
                </ProtectedRoute>
              } />

              <Route path="/select-role" element={
                <ProtectedRoute>
                  <RoleSelectionPage />
                </ProtectedRoute>
              } />

              {/* Protected Main Layout Routes */}
              <Route element={<AppLayout />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/sales" element={<SalesDashboard />} />
                <Route path="/inventory" element={<InventoryPage />} />
                <Route path="/add-product" element={<AddProductPage />} />
                <Route path="/manage-products" element={<AdminProductsPage />} />
                <Route path="/orders" element={<OrdersPage />} />

                {/* Invoice Routes */}
                <Route path="/invoice" element={<InvoiceGenPage />} />
                <Route path="/invoice/review" element={<InvoiceReviewPage />} />
              </Route>

            </Routes>
          </Router>
        </OrderProvider>
      </ProductProvider>
    </AuthProvider>
  );
}

export default App;
