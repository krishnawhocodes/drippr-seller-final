import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { 
  ShoppingBag, 
  TrendingUp, 
  Truck, 
  Shield, 
  Zap, 
  Users,
  ArrowRight,
  CheckCircle2
} from "lucide-react";

export default function Landing() {
  const benefits = [
    {
      icon: Users,
      title: "Massive Customer Base",
      description: "Access millions of potential customers across India",
    },
    {
      icon: Zap,
      title: "Instant Payments",
      description: "Get paid quickly with automated payment settlements",
    },
    {
      icon: Truck,
      title: "Logistics Support",
      description: "End-to-end logistics and delivery management",
    },
    {
      icon: Shield,
      title: "Secure Platform",
      description: "Bank-grade security for all your transactions",
    },
    {
      icon: TrendingUp,
      title: "Growth Tools",
      description: "Analytics and insights to grow your business",
    },
    {
      icon: ShoppingBag,
      title: "Easy Onboarding",
      description: "Start selling in minutes with simple registration",
    },
  ];

  const testimonials = [
    {
      name: "Rajesh Kumar",
      store: "TechGear Store",
      quote: "DRIPPR helped me scale from 10 to 500 orders per month!",
      sales: "₹2.5L+ monthly",
    },
    {
      name: "Priya Sharma",
      store: "Fashion Hub",
      quote: "Best decision for my business. Payments are always on time.",
      sales: "₹4.2L+ monthly",
    },
    {
      name: "Amit Patel",
      store: "HomeStyle",
      quote: "The logistics support saved me countless hours and headaches.",
      sales: "₹1.8L+ monthly",
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="border-b bg-card">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <img className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold" src="../../logo_rounded.png" />
            <span className="text-xl font-bold">DRIPPR</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/login">
              <Button variant="ghost">Login</Button>
            </Link>
            <Link to="/register">
              <Button>Register as Seller</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-hero py-20 lg:py-32">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-4xl text-center text-white">
            <h1 className="mb-6 text-4xl font-bold tracking-tight lg:text-6xl">
              Start Selling on DRIPPR Today
            </h1>
            <p className="mb-8 text-lg lg:text-xl opacity-90">
              Join thousands of successful sellers and grow your business with India's fastest-growing marketplace
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link to="/register">
                <Button size="lg" variant="default" className="bg-accent hover:bg-accent/90 text-accent-foreground gap-2 group">
                  Register as Seller
                  <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
              <Link to="/login">
                <Button size="lg" variant="outline" className="bg-white/10 text-white border-white/20 hover:bg-white/20">
                  Login to Dashboard
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-12 bg-secondary/30">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { value: "50K+", label: "Active Sellers" },
              { value: "5M+", label: "Monthly Orders" },
              { value: "500+", label: "Cities Covered" },
              { value: "₹100Cr+", label: "Monthly GMV" },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl lg:text-4xl font-bold text-primary mb-2">{stat.value}</div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-2xl text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight lg:text-4xl mb-4">
              Why Sell on DRIPPR?
            </h2>
            <p className="text-lg text-muted-foreground">
              Everything you need to succeed as an online seller
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {benefits.map((benefit) => (
              <Card key={benefit.title} className="border-2 hover:border-primary/50 transition-all">
                <CardContent className="p-6">
                  <div className="mb-4 inline-flex rounded-lg bg-primary/10 p-3">
                    <benefit.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2">{benefit.title}</h3>
                  <p className="text-muted-foreground">{benefit.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20 bg-secondary/30">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-2xl text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight lg:text-4xl mb-4">
              Success Stories
            </h2>
            <p className="text-lg text-muted-foreground">
              See how sellers are growing with DRIPPR
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {testimonials.map((testimonial) => (
              <Card key={testimonial.name}>
                <CardContent className="p-6">
                  <div className="mb-4 text-2xl font-bold text-success">{testimonial.sales}</div>
                  <p className="mb-4 text-foreground italic">"{testimonial.quote}"</p>
                  <div>
                    <div className="font-semibold">{testimonial.name}</div>
                    <div className="text-sm text-muted-foreground">{testimonial.store}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <Card className="bg-gradient-primary text-white">
            <CardContent className="p-12 text-center">
              <h2 className="text-3xl font-bold mb-4">Ready to Start Selling?</h2>
              <p className="text-lg mb-8 opacity-90">
                Join DRIPPR today and take your business to the next level
              </p>
              <Link to="/register">
                <Button size="lg" className="bg-accent hover:bg-accent/90 text-accent-foreground gap-2 group">
                  Get Started Now
                  <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-card py-12">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold">
                  D
                </div>
                <span className="text-xl font-bold">DRIPPR</span>
              </div>
              <p className="text-sm text-muted-foreground">
                India's fastest-growing multi-vendor marketplace
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Seller</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link to="/register" className="hover:text-foreground">Register</Link></li>
                <li><Link to="/login" className="hover:text-foreground">Login</Link></li>
                <li><a href="#" className="hover:text-foreground">Seller Guide</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Support</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground">Help Center</a></li>
                <li><a href="#" className="hover:text-foreground">Contact Us</a></li>
                <li><a href="#" className="hover:text-foreground">FAQs</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Contact</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>Email: sellers@drippr.com</li>
                <li>Phone: 1800-123-4567</li>
                <li>Address: Mumbai, India</li>
              </ul>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t text-center text-sm text-muted-foreground">
            <p>© 2025 DRIPPR. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
