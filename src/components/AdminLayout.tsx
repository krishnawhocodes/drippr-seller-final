import { Outlet, Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Package, Users, MessageSquare, Settings, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useState } from "react";

const navItems = [
  { title: "Dashboard", path: "/admin", icon: LayoutDashboard },
  { title: "Review Queue", path: "/admin/queue", icon: Package },
  { title: "Order Manager", path: "/admin/orders", icon: Package },
  { title: "Merchants", path: "/admin/merchants", icon: Users },
  { title: "Support", path: "/admin/support", icon: MessageSquare },
  { title: "Settings", path: "/admin/settings", icon: Settings },
];

export function AdminLayout() {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const getPageTitle = () => {
    const item = navItems.find((item) => item.path === location.pathname);
    return item?.title || "Admin";
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside
        className={cn(
          "bg-card border-r transition-all duration-300 flex flex-col",
          sidebarOpen ? "w-64" : "w-16"
        )}
      >
        <div className="p-4 border-b flex items-center justify-between">
          {sidebarOpen && (
            <h1 className="text-xl font-bold text-primary">DRIPPR Admin</h1>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <Menu className="h-5 w-5" />
          </Button>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;

            return (
              <Link key={item.path} to={item.path}>
                <Button
                  variant={isActive ? "default" : "ghost"}
                  className={cn(
                    "w-full justify-start",
                    !sidebarOpen && "justify-center px-0"
                  )}
                >
                  <Icon className={cn("h-5 w-5", sidebarOpen && "mr-2")} />
                  {sidebarOpen && <span>{item.title}</span>}
                </Button>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="bg-card border-b p-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold">{getPageTitle()}</h2>
          <div className="flex items-center gap-4">
            <Avatar>
              <AvatarFallback className="bg-primary text-primary-foreground">
                AD
              </AvatarFallback>
            </Avatar>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
