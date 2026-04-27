import { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { OrderProvider } from './context/OrderContext';
import { ProductProvider } from './context/ProductContext';
import PWAPrompt from './components/PWAPrompt';

// Eager: auth pages load instantly on first visit
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Layout from './components/Layout';

// Lazy: every other page is code-split into its own chunk
const SalesDashboard      = lazy(() => import('./pages/SalesDashboard'));
const CheckoutPage        = lazy(() => import('./pages/CheckoutPage'));
const DashboardPage       = lazy(() => import('./pages/DashboardPage'));
const InventoryPage       = lazy(() => import('./pages/InventoryPage'));
const AddProductPage      = lazy(() => import('./pages/AddProductPage'));
const AdminProductsPage   = lazy(() => import('./pages/AdminProductsPage'));
const RoleSelectionPage   = lazy(() => import('./pages/RoleSelectionPage'));
const InvoiceGenPage      = lazy(() => import('./pages/InvoiceGenPage'));
const InvoiceReviewPage   = lazy(() => import('./pages/InvoiceReviewPage'));
const OrdersPage          = lazy(() => import('./pages/OrdersPage'));
const StoreActiveOrdersPage = lazy(() => import('./pages/StoreActiveOrdersPage'));

// Minimal spinner shown during lazy-load transitions
const PageLoader = () => (
  <div style={{
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: '100%', minHeight: '200px',
    color: '#475569', fontSize: '0.875rem',
  }}>
    Loading…
  </div>
);

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" />;
  return children;
};

const AppLayout = () => (
  <ProtectedRoute>
    <Layout />
  </ProtectedRoute>
);

function App() {
  return (
    <AuthProvider>
      <ProductProvider>
        <OrderProvider>
          <CartProvider>
            <Router>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  {/* Public */}
                  <Route path="/login"           element={<Login />} />
                  <Route path="/forgot-password" element={<ForgotPassword />} />
                  <Route path="/reset-password"  element={<ResetPassword />} />

                  {/* Standalone protected */}
                  <Route path="/checkout" element={
                    <ProtectedRoute><CheckoutPage /></ProtectedRoute>
                  } />
                  <Route path="/select-role" element={
                    <ProtectedRoute><RoleSelectionPage /></ProtectedRoute>
                  } />

                  {/* Main layout */}
                  <Route element={<AppLayout />}>
                    <Route path="/"                    element={<DashboardPage />} />
                    <Route path="/sales"               element={<SalesDashboard />} />
                    <Route path="/inventory"           element={<InventoryPage />} />
                    <Route path="/add-product"         element={<AddProductPage />} />
                    <Route path="/manage-products"     element={<AdminProductsPage />} />
                    <Route path="/orders"              element={<OrdersPage />} />
                    <Route path="/store/active-orders" element={<StoreActiveOrdersPage />} />
                    <Route path="/invoice"             element={<InvoiceGenPage />} />
                    <Route path="/invoice/review"      element={<InvoiceReviewPage />} />
                  </Route>
                </Routes>
              </Suspense>
            </Router>
          </CartProvider>
        </OrderProvider>
      </ProductProvider>
    </AuthProvider>
  );
}

function AppWithPWA() {
  return (
    <>
      <App />
      <PWAPrompt />
    </>
  );
}

export default AppWithPWA;
