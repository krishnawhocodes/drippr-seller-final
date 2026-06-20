import { useState } from "react";
import { auth } from "@/lib/firebase";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type StagedTarget = {
  url: string;
  resourceUrl: string; // this is what we later pass to productCreateMedia.originalSource
  parameters: { name: string; value: string }[];
};

export default function AddProductForm() {
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState<string>("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);

  async function getIdToken() {
    if (!auth.currentUser) throw new Error("Not authenticated");
    return auth.currentUser.getIdToken();
  }

  async function startStagedUploads(idToken: string, files: File[]) {
    const payload = {
      files: files.map((f) => ({
        filename: f.name,
        mimeType: f.type || "image/jpeg",
        fileSize: f.size,
      })),
    };

    const r = await fetch("/api/admin/uploads/start", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || "stagedUploadsCreate failed");
    return j.targets as StagedTarget[];
  }

  async function uploadFileToShopify(target: StagedTarget, file: File) {
    const form = new FormData();
    for (const p of target.parameters) form.append(p.name, p.value);
    form.append("file", file); // field name must be 'file'
    const r = await fetch(target.url, { method: "POST", body: form });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`Upload failed (${r.status}) ${t}`);
    }
    return target.resourceUrl; // we’ll use this in productCreateMedia
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!auth.currentUser) return toast.error("You must be logged in.");
    if (!title || !price) return toast.error("Please add at least title and price.");

    try {
      setBusy(true);
      const idToken = await getIdToken();

      const localFiles = files ? Array.from(files).slice(0, 6) : [];
      let resourceUrls: string[] = [];

      if (localFiles.length) {
        // 1) request staged upload targets
        const targets = await startStagedUploads(idToken, localFiles);
        if (targets.length !== localFiles.length) throw new Error("Upload target count mismatch");

        // 2) upload each file directly to Shopify
        resourceUrls = [];
        for (let i = 0; i < localFiles.length; i++) {
          const url = await uploadFileToShopify(targets[i], localFiles[i]);
          resourceUrls.push(url);
        }
      }

      // 3) create product and attach images
      const r = await fetch("/api/admin/products/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          title,
          description,
          price: Number(price),
          currency: "INR",
          tags: [],
          resourceUrls, // staged uploads from step 2
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Create product failed");

      toast.success("Product created!");
      setTitle(""); setPrice(""); setDescription(""); setFiles(null);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Failed to create product");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 p-4 rounded-2xl border bg-card">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Cotton Oversized Tee" />
        </div>
        <div>
          <Label>Price (INR)</Label>
          <Input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <Label>Description</Label>
          <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Details, fabric, fit…" />
        </div>
        <div className="md:col-span-2">
          <Label>Images (upload directly to Shopify, up to 6)</Label>
          <Input type="file" accept="image/*" multiple onChange={(e) => setFiles(e.currentTarget.files)} />
        </div>
      </div>
      <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create Product"}</Button>
    </form>
  );
}
