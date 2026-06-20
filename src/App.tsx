import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import PasswordReset from "./pages/PasswordReset";
import Dashboard from "./pages/Dashboard";
import Products from "./pages/Products";
import Orders from "./pages/Orders";
import Payments from "./pages/Payments";
import Analytics from "./pages/Analytics";
import Support from "./pages/Support";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";
import SellerSupportAI from "./pages/SellerSupportAI";
import { AuthProvider } from "@/providers/AuthProvider";
import RequireAuth from "@/components/RequireAuth";
import { AdminGuard } from "./components/AdminGuard";
import { AdminLayout } from "./components/AdminLayout";
import AdminDashboard from "./pages/admin/Dashboard";
import Merchants from "./pages/admin/Merchants";
import ProductQueue from "./pages/admin/Queue";
import AdminSettings from "./pages/admin/Settings";
import AdminSupport from "./pages/admin/Support";
import MediaBucket from "./pages/MediaBucket";
import Notifications from "./pages/Notifications";
import AdminOrdersMonitor from "./pages/admin/OrdersMonitor";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
  <TooltipProvider delayDuration={0}>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* public */}
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/password-reset" element={<PasswordReset />} />

          {/* protected */}
          <Route path="/dashboard" element={
            <RequireAuth><Dashboard /></RequireAuth>
          } />
          <Route path="/dashboard/products" element={
            <RequireAuth><Products /></RequireAuth>
          } />
          <Route path="/dashboard/orders" element={
            <RequireAuth><Orders /></RequireAuth>
          } />
          <Route path="/dashboard/payments" element={
            <RequireAuth><Payments /></RequireAuth>
          } />
          <Route path="/dashboard/analytics" element={
            <RequireAuth><Analytics /></RequireAuth>
          } />

          <Route path="/dashboard/media-bucket" element={
            <RequireAuth><MediaBucket /></RequireAuth>
            } />
          <Route path="/dashboard/notifications" element={
            <RequireAuth><Notifications /></RequireAuth>
            } />

          <Route path="/dashboard/seller-support-ai" element={
            <RequireAuth><SellerSupportAI /></RequireAuth>
          } />
          <Route path="/dashboard/support" element={
            <RequireAuth><Support /></RequireAuth>
          } />
          <Route path="/dashboard/settings" element={
            <RequireAuth><Settings /></RequireAuth>
          } />


          {/* Admin Routes */}
          <Route path="/admin" element={<AdminGuard><AdminLayout /></AdminGuard>}>
            <Route index element={<AdminDashboard />} />
            <Route path="queue" element={<ProductQueue />} />
            <Route path="orders" element={<AdminOrdersMonitor />} />
            <Route path="merchants" element={<Merchants />} />
            <Route path="support" element={<AdminSupport />} />
            <Route path="settings" element={<AdminSettings />} />
          </Route>

          {/* catch-all */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </TooltipProvider>
</QueryClientProvider>
);

export default App;