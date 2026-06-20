import { useEffect, useMemo, useRef, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CloudUpload, Copy, Loader2, Package } from "lucide-react";
import { toast } from "sonner";

import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  limit,
} from "firebase/firestore";

type MediaDoc = {
  id: string;
  merchantId: string;
  url: string;
  fileId: string;
  name: string;
  size?: number;
  width?: number;
  height?: number;
  mime?: string;
  folder?: string;
  thumbnailUrl?: string;
  createdAt?: any;
};

type IKAuth = {
  token: string;
  expire: number | string;
  signature: string;
  publicKey: string;
  urlEndpoint: string;
  folder?: string;
};

type UploadItem = {
  id: string;
  file: File;
  progress: number;
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
};

function uploadToImageKit(
  authParams: IKAuth,
  file: File,
  onProgress: (p: number) => void
): Promise<any> {
  const endpoint = "https://upload.imagekit.io/api/v1/files/upload";
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("fileName", file.name);
    form.append("publicKey", authParams.publicKey);
    form.append("signature", authParams.signature);
    form.append("token", authParams.token);
    form.append("expire", String(authParams.expire));
    if (authParams.folder) form.append("folder", authParams.folder);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint, true);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;
      try {
        const body = JSON.parse(xhr.responseText || "{}");
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else
          reject(
            new Error(
              body?.message ||
                `ImageKit upload failed (${xhr.status})`
            )
          );
      } catch (err: any) {
        reject(new Error(err?.message || "ImageKit upload failed"));
      }
    };
    xhr.onerror = () =>
      reject(new Error("Network error while uploading"));
    xhr.send(form);
  });
}

export default function MediaBucket() {
  const [uid, setUid] = useState<string | null>(
    auth.currentUser?.uid ?? null
  );
  const [images, setImages] = useState<MediaDoc[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [queue, setQueue] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [overall, setOverall] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) =>
      setUid(u?.uid ?? null)
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!uid) return;
    setLoadingList(true);

    const qy = query(
      collection(db, "merchantMedia"),
      where("merchantId", "==", uid),
      orderBy("createdAt", "desc"),
      limit(200)
    );

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows: MediaDoc[] = [];
        snap.forEach((d) => rows.push({ id: d.id, ...(d.data() as any) }));
        setImages(rows);
        setLoadingList(false);
      },
      (error) => {
        console.error("merchantMedia snapshot error:", error);
        setLoadingList(false);
      }
    );

    return () => unsub();
  }, [uid]);


  const addFiles = (files: File[]) => {
    const items = files
      .filter((f) => f.type.startsWith("image/"))
      .map((f) => ({
        id: `${Date.now()}_${Math.random()
          .toString(36)
          .slice(2)}`,
        file: f,
        progress: 0,
        status: "queued" as const,
      }));
    if (!items.length) return toast.error("Select image files");
    setQueue((q) => [...q, ...items]);
  };

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    addFiles(Array.from(e.target.files));
    e.target.value = "";
  };

  const getIdToken = async () => {
    if (!auth.currentUser) throw new Error("Please sign in");
    return auth.currentUser.getIdToken();
  };

  const startUpload = async () => {
    if (!uid || queue.length === 0) return;
    setBusy(true);
    setErr(null);
    setOverall(0);

    try {
      for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        if (item.status !== "queued") continue;

        // mark item as uploading
        setQueue((q) =>
          q.map((it) =>
            it.id === item.id
              ? { ...it, status: "uploading", progress: 0 }
              : it
          )
        );

        // 1) get ImageKit auth from server
        const idToken = await getIdToken();
        const signRes = await fetch(
          "/api/admin/products/update",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({ op: "mediaSign" }),
          }
        );
        const signJson = await signRes.json();
        if (!signRes.ok || !signJson.ok) {
          throw new Error(
            signJson?.error || "Failed to sign upload"
          );
        }

        const authParams: IKAuth = {
          token: signJson.auth.token,
          expire: signJson.auth.expire,
          signature: signJson.auth.signature,
          publicKey: signJson.publicKey,
          urlEndpoint: signJson.urlEndpoint,
          folder: signJson.folder,
        };

        // 2) upload to ImageKit
        const ik = await uploadToImageKit(
          authParams,
          item.file,
          (p) => {
            setQueue((prev) => {
              const next = prev.map((it) =>
                it.id === item.id
                  ? { ...it, progress: p }
                  : it
              );
              const sum = next.reduce(
                (s, it) =>
                  s +
                  (Number.isFinite(it.progress)
                    ? it.progress
                    : 0),
                0
              );
              const avg =
                next.length > 0
                  ? Math.round(sum / next.length)
                  : 0;
              setOverall(avg);
              return next;
            });
          }
        );

        // 3) save media record via server (into merchantMedia)
        const saveRes = await fetch(
          "/api/admin/products/update",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({
              op: "mediaSave",
              records: [
                {
                  url: ik.url,
                  fileId: ik.fileId,
                  name: ik.name || item.file.name,
                  size: ik.size,
                  width: ik.width,
                  height: ik.height,
                  mime: item.file.type,
                  folder:
                    ik.filePath
                      ?.split("/")
                      .slice(0, -1)
                      .join("/") ||
                    authParams.folder ||
                    null,
                  thumbnailUrl: ik.thumbnailUrl || null,
                },
              ],
            }),
          }
        );
        const saved = await saveRes.json();
        if (!saveRes.ok || !saved.ok) {
          throw new Error(
            saved?.error || "Failed to save media"
          );
        }

        // mark as done
        setQueue((q) =>
          q.map((it) =>
            it.id === item.id
              ? { ...it, status: "done", progress: 100 }
              : it
          )
        );
      }

      toast.success("All uploads completed");
      setTimeout(() => setQueue([]), 600);
    } catch (e: any) {
      console.error(e);
      const msg = e?.message || "Upload failed";
      setErr(msg);
      setQueue((q) =>
        q.map((it) =>
          it.status === "uploading"
            ? { ...it, status: "error", error: msg }
            : it
        )
      );
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const completed = useMemo(
    () => queue.filter((q) => q.status === "done").length,
    [queue]
  );
  const total = queue.length;

  const copy = (url: string) =>
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success("Copied"));

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Media Bucket</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className="border-2 border-dashed rounded-lg p-10 text-center cursor-pointer hover:bg-accent/50"
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*"
                onChange={handlePick}
                className="hidden"
              />
              <CloudUpload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Click to select images
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Permanent links via ImageKit
              </p>
            </div>

            {queue.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm">
                    Queue:{" "}
                    <span className="font-medium">
                      {completed}
                    </span>
                    /{total} done
                  </div>
                  <Button
                    onClick={startUpload}
                    disabled={busy}
                    className="min-w-[140px]"
                  >
                    {busy ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Uploading…
                      </>
                    ) : (
                      "Start upload"
                    )}
                  </Button>
                </div>
                <Progress value={overall} />
                <div className="space-y-2 max-h-[220px] overflow-y-auto border rounded-md p-3">
                  {queue.map((it) => (
                    <div
                      key={it.id}
                      className="flex items-center gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="truncate">
                            {it.file.name}
                          </span>
                          <span className="ml-3 text-muted-foreground">
                            {it.progress}%
                          </span>
                        </div>
                        <Progress
                          value={it.progress}
                          className="h-2 mt-1"
                        />
                        {it.status === "error" && (
                          <div className="text-xs text-destructive mt-1">
                            {it.error}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {err && (
              <Alert variant="destructive">
                <AlertDescription>{err}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>My Uploaded Images</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingList ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                Loading…
              </div>
            ) : images.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Package className="h-16 w-16 mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">
                  No images yet. Upload to get permanent links.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {images.map((img) => (
                  <Card key={img.id}>
                    <CardContent className="p-4 space-y-3">
                      <img
                        src={img.url}
                        alt={img.name}
                        className="w-full h-48 object-cover rounded-md"
                        loading="lazy"
                      />
                      <div className="text-xs text-muted-foreground">
                        {img.width && img.height
                          ? `${img.width}×${img.height} • `
                          : ""}
                        {img.size
                          ? `${Math.round(
                              img.size / 1024
                            )} KB`
                          : ""}{" "}
                        {img.mime ? ` • ${img.mime}` : ""}
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">
                          Permanent Link
                        </label>
                        <div className="flex gap-2">
                          <Input
                            value={img.url}
                            readOnly
                            className="flex-1"
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => copy(img.url)}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
