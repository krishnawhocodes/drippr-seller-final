import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Bell, 
  Package, 
  ShoppingCart, 
  DollarSign, 
  AlertCircle, 
  CheckCircle, 
  Clock, 
  TrendingUp,
  X,
  ExternalLink,
  Settings
} from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

interface Notification {
  id: string;
  type: "order" | "product" | "payment" | "alert" | "success" | "info";
  title: string;
  description: string;
  time: string;
  isRead: boolean;
  link?: string;
  actionText?: string;
}

const mockNotifications: Notification[] = [
  {
    id: "1",
    type: "order",
    title: "New Order Received",
    description: "Order #12345 has been placed. 3 items worth ₹2,499",
    time: "2 minutes ago",
    isRead: false,
    link: "/dashboard/orders",
    actionText: "View Order"
  },
  {
    id: "2",
    type: "success",
    title: "Product Approved",
    description: "Your product 'Premium Cotton T-Shirt' has been approved and is now live",
    time: "1 hour ago",
    isRead: false,
    link: "/dashboard/products",
    actionText: "View Product"
  },
  {
    id: "3",
    type: "payment",
    title: "Payment Received",
    description: "₹5,000 has been credited to your account",
    time: "3 hours ago",
    isRead: true,
    link: "/dashboard/payments",
    actionText: "View Details"
  },
  {
    id: "4",
    type: "alert",
    title: "Low Stock Alert",
    description: "5 products are running low on stock. Restock soon to avoid missing sales",
    time: "5 hours ago",
    isRead: true,
    link: "/dashboard/products",
    actionText: "Manage Stock"
  },
  {
    id: "5",
    type: "info",
    title: "Weekly Performance Report",
    description: "Your store had 45% more orders this week. Sales increased by ₹15,000",
    time: "1 day ago",
    isRead: true,
    link: "/dashboard/analytics",
    actionText: "View Analytics"
  },
  {
    id: "6",
    type: "product",
    title: "Product Under Review",
    description: "Your product 'Leather Wallet' is being reviewed by our team",
    time: "2 days ago",
    isRead: true,
    link: "/dashboard/products",
    actionText: "Check Status"
  }
];

const getNotificationIcon = (type: string) => {
  switch (type) {
    case "order": return ShoppingCart;
    case "product": return Package;
    case "payment": return DollarSign;
    case "alert": return AlertCircle;
    case "success": return CheckCircle;
    case "info": return TrendingUp;
    default: return Bell;
  }
};

const getNotificationColor = (type: string) => {
  switch (type) {
    case "order": return "text-primary bg-primary/10 border-primary/20";
    case "product": return "text-blue-500 bg-blue-500/10 border-blue-500/20";
    case "payment": return "text-green-500 bg-green-500/10 border-green-500/20";
    case "alert": return "text-destructive bg-destructive/10 border-destructive/20";
    case "success": return "text-emerald-500 bg-emerald-500/10 border-emerald-500/20";
    case "info": return "text-accent bg-accent/10 border-accent/20";
    default: return "text-muted-foreground bg-muted/10 border-border";
  }
};

export default function Notifications() {
  const [notifications, setNotifications] = useState(mockNotifications);
  const unreadCount = notifications.filter(n => !n.isRead).length;

  const markAsRead = (id: string) => {
    setNotifications(notifications.map(n => 
      n.id === id ? { ...n, isRead: true } : n
    ));
  };

  const markAllAsRead = () => {
    setNotifications(notifications.map(n => ({ ...n, isRead: true })));
  };

  const removeNotification = (id: string) => {
    setNotifications(notifications.filter(n => n.id !== id));
  };

  return (
    <DashboardLayout>
      {/* Animated Background */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-20 -left-20 w-72 h-72 bg-primary/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-20 -right-20 w-96 h-96 bg-accent/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-primary/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      <div className="space-y-6 animate-fade-in">
        {/* Header with Glass Effect */}
        <Card className="backdrop-blur-xl bg-card/60 border-border/50 shadow-xl">
          <div className="p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Bell className="h-8 w-8 text-primary animate-pulse" />
                    {unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold animate-scale-in">
                        {unreadCount}
                      </span>
                    )}
                  </div>
                  <h1 className="text-3xl font-bold text-foreground">Notifications</h1>
                </div>
                <p className="text-muted-foreground">
                  Stay updated with your store activities and important updates
                </p>
              </div>
              <Link to="/dashboard/settings">
                <Button variant="outline" size="icon" className="backdrop-blur-sm hover-scale">
                  <Settings className="h-4 w-4" />
                </Button>
              </Link>
            </div>

            {/* Stats */}
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 backdrop-blur-sm border border-primary/20">
                <Clock className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium text-foreground">{unreadCount} Unread</span>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent/10 backdrop-blur-sm border border-accent/20">
                <Bell className="h-4 w-4 text-accent-foreground" />
                <span className="text-sm font-medium text-foreground">{notifications.length} Total</span>
              </div>
              {unreadCount > 0 && (
                <Button 
                  onClick={markAllAsRead}
                  variant="outline" 
                  size="sm"
                  className="backdrop-blur-sm hover-scale"
                >
                  Mark all as read
                </Button>
              )}
            </div>
          </div>
        </Card>

        {/* Notifications List */}
        <div className="space-y-3">
          {notifications.length === 0 ? (
            <Card className="backdrop-blur-xl bg-card/60 border-border/50 shadow-xl">
              <div className="p-12 text-center space-y-4 animate-fade-in">
                <div className="flex justify-center">
                  <div className="p-4 rounded-full bg-muted/50 backdrop-blur-sm">
                    <Bell className="h-12 w-12 text-muted-foreground" />
                  </div>
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-semibold text-foreground">All caught up!</h3>
                  <p className="text-muted-foreground">You have no notifications at the moment</p>
                </div>
              </div>
            </Card>
          ) : (
            notifications.map((notification, index) => {
              const Icon = getNotificationIcon(notification.type);
              const colorClass = getNotificationColor(notification.type);
              
              return (
                <Card
                  key={notification.id}
                  className={cn(
                    "group backdrop-blur-xl border-border/50 shadow-lg hover:shadow-xl transition-all duration-300 hover-scale cursor-pointer animate-fade-in overflow-hidden",
                    notification.isRead ? "bg-card/40" : "bg-card/70 border-primary/30"
                  )}
                  style={{ animationDelay: `${index * 0.1}s` }}
                  onClick={() => !notification.isRead && markAsRead(notification.id)}
                >
                  {/* Gradient Overlay for Unread */}
                  {!notification.isRead && (
                    <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent pointer-events-none" />
                  )}
                  
                  <div className="relative p-5">
                    <div className="flex gap-4">
                      {/* Icon */}
                      <div className={cn(
                        "flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center border backdrop-blur-sm transition-transform duration-300 group-hover:scale-110",
                        colorClass
                      )}>
                        <Icon className="h-5 w-5" />
                      </div>

                      {/* Content */}
                      <div className="flex-1 space-y-2 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-1 flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                                {notification.title}
                              </h3>
                              {!notification.isRead && (
                                <Badge className="h-2 w-2 rounded-full p-0 bg-primary animate-pulse" />
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {notification.description}
                            </p>
                          </div>

                          {/* Remove Button */}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeNotification(notification.id);
                            }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {notification.time}
                          </div>

                          {notification.link && (
                            <Link to={notification.link} onClick={(e) => e.stopPropagation()}>
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                className="h-8 gap-1 text-primary hover:text-primary"
                              >
                                {notification.actionText}
                                <ExternalLink className="h-3 w-3" />
                              </Button>
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
