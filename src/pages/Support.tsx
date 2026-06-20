import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Mail, Phone, MessageCircle } from "lucide-react";
import { toast } from "sonner";

import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, where
} from "firebase/firestore";

type Ticket = {
  id: string;
  merchantId: string;
  name: string;
  email: string;
  category: "order" | "payment" | "product" | "account" | "technical" | "other";
  subject: string;
  message: string;
  priority: "low" | "medium" | "high" | "critical";
  status: "pending" | "processing" | "resolved";  // "processing" renders as "under processing"
  adminReply: string;
  createdAt?: any; // Firestore Timestamp
  updatedAt?: any; // Firestore Timestamp
  timeline?: Array<{
    at?: any;           // Firestore Timestamp
    by: "seller" | "admin" | "system";
    type: "created" | "status" | "reply";
    message?: string;
    status?: string;
  }>;
};

export default function Support() {
  // ---------- auth ----------
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [authEmail, setAuthEmail] = useState<string | null>(auth.currentUser?.email ?? null);
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUid(u?.uid ?? null);
      setAuthEmail(u?.email ?? null);
    });
    return () => unsub();
  }, []);

  // ---------- load merchant doc for name/email prefill ----------
  const [merchantName, setMerchantName] = useState<string>("");
  useEffect(() => {
    if (!uid) return;
    const ref = doc(db, "merchants", uid);
    const unsub = onSnapshot(ref, (snap) => {
      const d = snap.data() as any;
      if (!d) return;
      if (d.name && !formDirty) setName(d.name);
      if (d.email && !formDirty) setEmail(d.email);
      setMerchantName(d.name || "");
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // ---------- form state ----------
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [category, setCategory] = useState<Ticket["category"] | "">("");
  const [subject, setSubject] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [priority, setPriority] = useState<Ticket["priority"] | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [formDirty, setFormDirty] = useState(false);

  // ---------- submit ----------
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid) return toast.error("Please sign in to submit a support request.");
    if (!category) return toast.error("Please select a category.");
    if (!priority) return toast.error("Please select a priority.");

    try {
      setSubmitting(true);
      const colRef = collection(db, "supportRequests");

      // Generate a client-side timestamp for use inside the array
      const clientTimestamp = new Date();

      await addDoc(colRef, {
        merchantId: uid,
        name: name.trim() || merchantName || "Unknown",
        email: (email || authEmail || "").trim(),
        category,
        subject: subject.trim(),
        message: message.trim(),
        priority,
        status: "pending",
        adminReply: "",
        // These top-level fields CAN and SHOULD use serverTimestamp()
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        // For the array, use the client-generated timestamp
        timeline: [
          { at: clientTimestamp, by: "seller", type: "created", message: message.trim() },
          { at: clientTimestamp, by: "system", type: "status", status: "pending", message: "Ticket created" },
        ],
      } as Omit<Ticket, "id">);

      toast.success("Support request submitted successfully!");
      // reset
      setSubject("");
      setMessage("");
      setCategory("");
      setPriority("");
      setFormDirty(false);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- stream my tickets ----------
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  useEffect(() => {
    if (!uid) return;
    setLoadingList(true);
    const qRef = query(
      collection(db, "supportRequests"),
      where("merchantId", "==", uid),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const arr: Ticket[] = [];
        snap.forEach((d) => arr.push({ id: d.id, ...(d.data() as any) }));
        setTickets(arr);
        setLoadingList(false);
      },
      () => setLoadingList(false)
    );
    return () => unsub();
  }, [uid]);

  // ---------- helpers ----------
  const fmtTime = (ts?: any) => {
    if (!ts) return "";
    // works for Firestore Timestamp or millis
    const date =
      typeof ts?.toDate === "function" ? ts.toDate() :
      typeof ts === "number" ? new Date(ts) : new Date();
    return date.toLocaleString();
  };

  const statusText = (s: Ticket["status"]) =>
    s === "processing" ? "under processing" : s;

  const statusClass = (s: Ticket["status"]) => {
    switch (s) {
      case "pending":
        return "bg-warning/10 text-warning border-warning/20";
      case "processing":
        return "bg-primary/10 text-primary border-primary/20";
      case "resolved":
        return "bg-success/10 text-success border-success/20";
      default:
        return "bg-muted text-muted-foreground border-muted";
    }
  };

  const priorityPill = (p: Ticket["priority"]) => {
    switch (p) {
      case "low": return "bg-muted text-muted-foreground border-muted";
      case "medium": return "bg-primary/10 text-primary border-primary/20";
      case "high": return "bg-warning/10 text-warning border-warning/20";
      case "critical": return "bg-destructive/10 text-destructive border-destructive/20";
      default: return "bg-muted text-muted-foreground border-muted";
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Support</h2>
          <p className="text-muted-foreground">Get help from DRIPPR team</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Contact Methods */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Contact Us</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <Mail className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Email Support</p>
                    <p className="text-sm text-muted-foreground">sellers@drippr.com</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <Phone className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Phone Support</p>
                    <p className="text-sm text-muted-foreground">1800-123-4567</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <MessageCircle className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Ticket Response</p>
                    <p className="text-sm text-muted-foreground">Within 2-6 hours</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Quick Links</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button variant="ghost" className="w-full justify-start">Seller Guide</Button>
                <Button variant="ghost" className="w-full justify-start">FAQs</Button>
                <Button variant="ghost" className="w-full justify-start">Payment Policy</Button>
                <Button variant="ghost" className="w-full justify-start">Shipping Guidelines</Button>
              </CardContent>
            </Card>
          </div>

          {/* Support Form */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Submit a Support Request</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Your Name</Label>
                    <Input
                      id="name"
                      placeholder="Enter your name"
                      value={name}
                      onChange={(e) => { setName(e.target.value); setFormDirty(true); }}
                      required
                      disabled={!uid || submitting}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="your@email.com"
                      value={email || authEmail || ""}
                      onChange={(e) => { setEmail(e.target.value); setFormDirty(true); }}
                      required
                      disabled={!uid || submitting}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="category">Issue Category</Label>
                  <Select
                    value={category}
                    onValueChange={(v) => setCategory(v as Ticket["category"])}
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="order">Order Issues</SelectItem>
                      <SelectItem value="payment">Payment Issues</SelectItem>
                      <SelectItem value="product">Product Issues</SelectItem>
                      <SelectItem value="account">Account Issues</SelectItem>
                      <SelectItem value="technical">Technical Support</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="subject">Subject</Label>
                  <Input
                    id="subject"
                    placeholder="Brief description of your issue"
                    value={subject}
                    onChange={(e) => { setSubject(e.target.value); setFormDirty(true); }}
                    required
                    disabled={!uid || submitting}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="message">Message</Label>
                  <Textarea
                    id="message"
                    placeholder="Describe your issue in detail..."
                    className="min-h-32"
                    value={message}
                    onChange={(e) => { setMessage(e.target.value); setFormDirty(true); }}
                    required
                    disabled={!uid || submitting}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="priority">Priority</Label>
                  <Select
                    value={priority}
                    onValueChange={(v) => setPriority(v as Ticket["priority"])}
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select priority level" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low - General inquiry</SelectItem>
                      <SelectItem value="medium">Medium - Issue affecting operations</SelectItem>
                      <SelectItem value="high">High - Urgent issue</SelectItem>
                      <SelectItem value="critical">Critical - Business blocked</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button type="submit" className="w-full" size="lg" disabled={!uid || submitting}>
                  {submitting ? "Submitting…" : "Submit Request"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* My Tickets */}
        <Card>
          <CardHeader>
            <CardTitle>My Support Requests</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingList ? (
              <div className="text-sm text-muted-foreground p-2">Loading…</div>
            ) : tickets.length === 0 ? (
              <div className="text-sm text-muted-foreground p-2">No tickets yet.</div>
            ) : (
              <div className="space-y-4">
                {tickets.map((t) => (
                  <div key={t.id} className="p-4 border rounded-lg bg-card">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold">{t.subject}</p>
                          <span className={`px-2 py-0.5 text-xs rounded border ${statusClass(t.status)}`}>
                            {statusText(t.status)}
                          </span>
                          <span className={`px-2 py-0.5 text-xs rounded border ${priorityPill(t.priority)}`}>
                            {t.priority}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {t.category} • Created {fmtTime(t.createdAt)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Ticket ID</p>
                        <p className="text-sm font-mono">{t.id}</p>
                      </div>
                    </div>

                    {/* Admin reply */}
                    <div className="mt-3">
                      <p className="text-sm font-medium">Admin Reply</p>
                      <p className="text-sm text-muted-foreground">
                        {t.adminReply && t.adminReply.trim() !== "" ? t.adminReply : "No reply yet."}
                      </p>
                    </div>

                    {/* Timeline */}
                    <div className="mt-4">
                      <p className="text-sm font-medium mb-2">Timeline</p>
                      <div className="space-y-2">
                        {(t.timeline || []).map((ev, idx) => (
                          <div key={idx} className="flex items-start gap-3">
                            <div className="mt-1 h-2 w-2 rounded-full bg-muted-foreground/60" />
                            <div className="text-sm">
                              <span className="font-medium">{ev.type}</span>{" "}
                              <span className="text-muted-foreground">
                                ({ev.by}) • {fmtTime(ev.at)}
                              </span>
                              {ev.message ? <> — <span>{ev.message}</span></> : null}
                              {ev.type === "status" && ev.status ? (
                                <> — <span className="italic">{statusText(ev.status as any)}</span></>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
