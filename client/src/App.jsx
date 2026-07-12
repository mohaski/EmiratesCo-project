import { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ROUTE_ROLES } from './config/routePermissions';
import { CartProvider } from './context/CartContext';
import { OrderProvider } from './context/OrderContext';
import { ProductProvider } from './context/ProductContext';
import { AttributeProvider } from './context/AttributeContext';
import { ToastProvider } from './context/ToastContext';
import { WebSocketProvider } from './context/WebSocketContext';
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
const OrderSummaryPage    = lazy(() => import('./pages/OrderSummaryPage'));

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

const ProtectedRoute = ({ children, roles }) => {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
};

const AppLayout = () => (
  <ProtectedRoute>
    <Layout />
  </ProtectedRoute>
);

function App() {
  return (
    <ToastProvider>
    <AuthProvider>
      <WebSocketProvider>
      <ProductProvider>
      <AttributeProvider>
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
                    <ProtectedRoute roles={ROUTE_ROLES['/checkout']}><CheckoutPage /></ProtectedRoute>
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
                    <Route path="/orders/review"       element={<OrderSummaryPage />} />
                    <Route path="/invoice"             element={<InvoiceGenPage />} />
                    <Route path="/invoice/review"      element={<InvoiceReviewPage />} />
                  </Route>
                </Routes>
              </Suspense>
            </Router>
          </CartProvider>
        </OrderProvider>
      </AttributeProvider>
      </ProductProvider>
      </WebSocketProvider>
    </AuthProvider>
    </ToastProvider>
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
