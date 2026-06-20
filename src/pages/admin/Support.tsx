import { useEffect, useState } from "react";
import { listSupport, replySupport } from "@/lib/adminApi";
import { SupportTicket } from "@/types/admin";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Search, Send } from "lucide-react";

export default function AdminSupport() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [replyMessage, setReplyMessage] = useState("");
  const [replyStatus, setReplyStatus] = useState<"processing" | "resolved" | "">("");

  const fetchTickets = async () => {
    setLoading(true);
    const res = await listSupport({ status: status === "all" ? undefined : status, q: search });
    if (res.ok) {
      setTickets(res.items);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchTickets();
  }, [status, search]);

  const handleReply = async () => {
    if (!selectedTicket || !replyMessage.trim()) return;

    await replySupport(
      selectedTicket.id,
      replyMessage,
      replyStatus || undefined
    );

    toast.success("Reply sent successfully!");

    // Update local state
    setSelectedTicket({
      ...selectedTicket,
      timeline: [
        ...selectedTicket.timeline,
        {
          at: Date.now(),
          by: "admin",
          type: "message",
          note: replyMessage,
        },
        ...(replyStatus
          ? [
              {
                at: Date.now(),
                by: "admin" as const,
                type: "status" as const,
                note: `Status changed to ${replyStatus}`,
              },
            ]
          : []),
      ],
      status: replyStatus || selectedTicket.status,
    });

    setReplyMessage("");
    setReplyStatus("");
    fetchTickets();
  };

  const getPriorityBadge = (priority: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      low: "secondary",
      medium: "default",
      high: "outline",
      critical: "destructive",
    };
    return <Badge variant={variants[priority] || "default"}>{priority}</Badge>;
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "outline"> = {
      pending: "default",
      processing: "outline",
      resolved: "secondary",
    };
    return <Badge variant={variants[status] || "default"}>{status}</Badge>;
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-full md:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>

            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by subject or merchant..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tickets Table */}
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Merchant</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((ticket) => (
                  <TableRow key={ticket.id}>
                    <TableCell className="font-medium">{ticket.subject}</TableCell>
                    <TableCell>{ticket.name}</TableCell>
                    <TableCell className="capitalize">{ticket.category}</TableCell>
                    <TableCell>{getPriorityBadge(ticket.priority)}</TableCell>
                    <TableCell>{getStatusBadge(ticket.status)}</TableCell>
                    <TableCell>
                      {new Date(ticket.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedTicket(ticket)}
                      >
                        Open
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Ticket Details Sheet */}
      <Sheet open={!!selectedTicket} onOpenChange={() => setSelectedTicket(null)}>
        <SheetContent className="overflow-y-auto w-full sm:max-w-xl">
          {selectedTicket && (
            <>
              <SheetHeader>
                <SheetTitle>{selectedTicket.subject}</SheetTitle>
                <SheetDescription>
                  Ticket #{selectedTicket.id} - {selectedTicket.name}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                {/* Ticket Info */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-semibold">Category:</span>
                    <p className="capitalize text-muted-foreground">
                      {selectedTicket.category}
                    </p>
                  </div>
                  <div>
                    <span className="font-semibold">Priority:</span>
                    <div className="mt-1">{getPriorityBadge(selectedTicket.priority)}</div>
                  </div>
                  <div>
                    <span className="font-semibold">Status:</span>
                    <div className="mt-1">{getStatusBadge(selectedTicket.status)}</div>
                  </div>
                  <div>
                    <span className="font-semibold">Email:</span>
                    <p className="text-muted-foreground">{selectedTicket.email}</p>
                  </div>
                </div>

                {/* Original Message */}
                <div>
                  <h4 className="font-semibold mb-2">Original Message</h4>
                  <p className="text-sm text-muted-foreground bg-muted p-3 rounded">
                    {selectedTicket.message}
                  </p>
                </div>

                {/* Timeline */}
                <div>
                  <h4 className="font-semibold mb-3">Timeline</h4>
                  <div className="space-y-3">
                    {selectedTicket.timeline.map((event, idx) => (
                      <div key={idx} className="flex gap-3 text-sm">
                        <div className="flex-shrink-0 w-20 text-xs text-muted-foreground">
                          {new Date(event.at).toLocaleTimeString()}
                        </div>
                        <div className="flex-1">
                          <Badge
                            variant={event.by === "admin" ? "default" : "secondary"}
                            className="text-xs mb-1"
                          >
                            {event.by}
                          </Badge>
                          <p className="text-muted-foreground">{event.note}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Reply Section */}
                <div className="space-y-3 border-t pt-4">
                  <h4 className="font-semibold">Send Reply</h4>
                  <Textarea
                    placeholder="Type your reply..."
                    value={replyMessage}
                    onChange={(e) => setReplyMessage(e.target.value)}
                    rows={4}
                  />

                  <div className="flex gap-2 items-center">
                    <Select value={replyStatus} onValueChange={(value) => setReplyStatus(value as "" | "processing" | "resolved")}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Update status (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="processing">Processing</SelectItem>
                        <SelectItem value="resolved">Resolved</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button onClick={handleReply} disabled={!replyMessage.trim()}>
                      <Send className="h-4 w-4 mr-2" />
                      Send
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
