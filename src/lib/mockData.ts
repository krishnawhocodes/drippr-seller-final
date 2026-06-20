export const mockProducts = [
  {
    id: "1",
    name: "Premium Cotton T-Shirt",
    category: "Apparel",
    price: 599,
    stock: 150,
    status: "active",
    image: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=200",
  },
  {
    id: "2",
    name: "Wireless Bluetooth Earbuds",
    category: "Electronics",
    price: 1999,
    stock: 45,
    status: "active",
    image: "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=200",
  },
  {
    id: "3",
    name: "Leather Wallet",
    category: "Accessories",
    price: 799,
    stock: 0,
    status: "out_of_stock",
    image: "https://images.unsplash.com/photo-1627123424574-724758594e93?w=200",
  },
  {
    id: "4",
    name: "Running Shoes",
    category: "Footwear",
    price: 2499,
    stock: 78,
    status: "active",
    image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=200",
  },
  {
    id: "5",
    name: "Stainless Steel Water Bottle",
    category: "Home & Kitchen",
    price: 399,
    stock: 200,
    status: "active",
    image: "https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=200",
  },
];

export const mockOrders = [
  {
    id: "ORD-001",
    customer: "Rajesh Kumar",
    products: "Premium Cotton T-Shirt x2",
    amount: 1198,
    status: "pending",
    date: "2025-09-28",
  },
  {
    id: "ORD-002",
    customer: "Priya Sharma",
    products: "Wireless Bluetooth Earbuds x1",
    amount: 1999,
    status: "shipped",
    date: "2025-09-27",
  },
  {
    id: "ORD-003",
    customer: "Amit Patel",
    products: "Running Shoes x1",
    amount: 2499,
    status: "delivered",
    date: "2025-09-25",
  },
  {
    id: "ORD-004",
    customer: "Sneha Reddy",
    products: "Leather Wallet x1, Water Bottle x1",
    amount: 1198,
    status: "cancelled",
    date: "2025-09-26",
  },
  {
    id: "ORD-005",
    customer: "Vikram Singh",
    products: "Premium Cotton T-Shirt x3",
    amount: 1797,
    status: "pending",
    date: "2025-09-28",
  },
];

export const mockPayouts = [
  {
    id: "PAY-001",
    amount: 24500,
    date: "2025-09-15",
    status: "completed",
    method: "Bank Transfer",
  },
  {
    id: "PAY-002",
    amount: 18750,
    date: "2025-09-01",
    status: "completed",
    method: "Bank Transfer",
  },
  {
    id: "PAY-003",
    amount: 31200,
    date: "2025-08-15",
    status: "completed",
    method: "Bank Transfer",
  },
  {
    id: "PAY-004",
    amount: 15800,
    date: "2025-09-25",
    status: "pending",
    method: "Bank Transfer",
  },
];

export const mockAnalytics = {
  salesData: [
    { month: "Apr", sales: 12000 },
    { month: "May", sales: 19000 },
    { month: "Jun", sales: 15000 },
    { month: "Jul", sales: 22000 },
    { month: "Aug", sales: 31000 },
    { month: "Sep", sales: 24000 },
  ],
  topProducts: [
    { name: "Running Shoes", sales: 45, revenue: 112455 },
    { name: "Bluetooth Earbuds", sales: 38, revenue: 75962 },
    { name: "Cotton T-Shirt", sales: 67, revenue: 40133 },
    { name: "Water Bottle", sales: 89, revenue: 35511 },
    { name: "Leather Wallet", sales: 23, revenue: 18377 },
  ],
};

export const mockVendorProfile = {
  name: "Rahul Merchant",
  storeName: "TechStyle Store",
  email: "rahul@techstyle.com",
  phone: "+91 98765 43210",
  businessCategory: "Fashion & Electronics",
  gstin: "27AABCU9603R1ZM",
  address: "Shop No. 12, ABC Market, Mumbai, Maharashtra 400001",
  joinDate: "2024-01-15",
};
