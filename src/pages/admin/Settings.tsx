import { useState, useEffect } from "react";
import {
  getPublicationId,
  setPublicationId,
  listShopifyWebhooks,
  registerShopifyWebhooks,
  createTestDiscount,
  shopifyDiagnostics,
  type ShopifyDiagnostics,
} from "@/lib/adminApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Save, RefreshCw, Webhook, CheckCircle2, XCircle, Tag, Wrench, PlugZap, AlertTriangle } from "lucide-react";
import { auth } from "@/lib/firebase";

export default function AdminSettings() {
  const [publicationId, setPublicationIdState] = useState("");
  const [webhookStatus, setWebhookStatus] = useState<any[] | null>(null);
  const [registering, setRegistering] = useState(false);
  const [checking, setChecking] = useState(false);
  const [creatingDiscount, setCreatingDiscount] = useState(false);
  const [discountResult, setDiscountResult] = useState<any>(null);
  const [repairingPricing, setRepairingPricing] = useState(false);
  const [repairResult, setRepairResult] = useState<any>(null);
  const [repairProgress, setRepairProgress] = useState("");
  const [diagnostics, setDiagnostics] = useState<ShopifyDiagnostics | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);

  useEffect(() => {
    (async () => {
      const id = await getPublicationId();
      if (id) setPublicationIdState(id);
    })();
  }, []);

  const handleSave = async () => {
    await setPublicationId(publicationId);
    toast.success("Settings saved successfully!");
  };

  const runDiagnostics = async () => {
    setDiagnosing(true);
    try {
      const data = await shopifyDiagnostics();
      setDiagnostics(data);
      if (data.customerDataReadable === true) {
        toast.success("Shopify is sending full customer addresses");
      } else if (data.customerDataReadable === false) {
        toast.warning("Shopify is withholding customer addresses");
      } else {
        toast.info("Connected, but there was no order to test with");
      }
    } catch (err) {
      toast.error(
        'Diagnostics failed: ' + (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setDiagnosing(false);
    }
  };

  const checkWebhooks = async () => {
    setChecking(true);
    try {
      const data = await listShopifyWebhooks();
      setWebhookStatus(data.webhooks || []);
      toast.success(`Found ${(data.webhooks || []).length} registered webhook(s)`);
    } catch (err: any) {
      toast.error("Failed to check webhooks: " + (err?.message || err));
    } finally {
      setChecking(false);
    }
  };

  const registerWebhooks = async () => {
    setRegistering(true);
    try {
      const data = await registerShopifyWebhooks();
      if (data.ok) {
        toast.success("All webhooks registered successfully!");
        setWebhookStatus(null);
        // Refresh the list
        await checkWebhooks();
      } else {
        const failed = (data.results || []).filter((r: any) => !r.ok);
        toast.error(`${failed.length} webhook(s) failed to register. Check console.`);
        console.error("Webhook registration results:", data.results);
      }
    } catch (err: any) {
      toast.error("Failed to register webhooks: " + (err?.message || err));
    } finally {
      setRegistering(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Shopify Connection</CardTitle>
          <CardDescription>
            What the live Shopify token is actually allowed to do. Run this
            before changing anything in Shopify: it reads the granted scopes
            and then tries a real order, which is the only way to tell a
            missing scope apart from a plan restriction.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={runDiagnostics} disabled={diagnosing}>
            <PlugZap className={`h-4 w-4 mr-2 ${diagnosing ? "animate-pulse" : ""}`} />
            {diagnosing ? "Checking..." : "Check Shopify access"}
          </Button>

          {diagnostics && (
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground">
                {diagnostics.shop} &middot; API {diagnostics.apiVersion}
              </div>

              {diagnostics.customerDataReadable === true && (
                <div className="rounded-md border border-green-300 bg-green-50 p-3 text-sm">
                  <div className="flex items-center gap-2 font-medium text-green-900">
                    <CheckCircle2 className="h-4 w-4" />
                    Customer addresses are coming through
                  </div>
                  <p className="mt-1 text-xs text-green-800">
                    Tested against order {diagnostics.probedOrderNumber}, which
                    returned a street address.
                  </p>
                </div>
              )}

              {diagnostics.customerDataReadable === false && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
                  <div className="flex items-center gap-2 font-medium text-amber-900">
                    <AlertTriangle className="h-4 w-4" />
                    Shopify is withholding customer addresses
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-amber-800">
                    Order {diagnostics.probedOrderNumber} came back without a
                    street address.
                    {diagnostics.required.find((r) => r.scope === "read_customers")
                      ?.granted
                      ? " read_customers is already granted, so this is not a scope problem. Name, address, phone and email are Level 2 customer data, which an admin-created custom app only receives on some Shopify plans; a custom app created in the Partner Dashboard gets Level 2 on any plan."
                      : " read_customers is not granted. Add it to the app in Shopify, reinstall, and run this again before changing anything else."}
                  </p>
                  {diagnostics.probeError ? (
                    <p className="mt-1 text-xs text-amber-700">
                      Shopify said: {diagnostics.probeError}
                    </p>
                  ) : null}
                </div>
              )}

              {diagnostics.customerDataReadable === null && diagnostics.probeError ? (
                <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                  {diagnostics.probeError}
                </div>
              ) : null}

              <div className="space-y-1.5">
                <div className="text-sm font-medium">Scopes this panel uses</div>
                {diagnostics.scopeError ? (
                  <p className="text-xs text-destructive">{diagnostics.scopeError}</p>
                ) : (
                  <div className="divide-y rounded-md border">
                    {diagnostics.required.map((row) => (
                      <div
                        key={row.scope}
                        className="flex items-start gap-3 px-3 py-2 text-sm"
                      >
                        {row.granted ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                        ) : (
                          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                        )}
                        <div className="min-w-0">
                          <div className="font-mono text-xs">{row.scope}</div>
                          <div className="text-xs text-muted-foreground">
                            {row.why}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {diagnostics.grantedScopes.length ? (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">
                    All {diagnostics.grantedScopes.length} granted scopes
                  </summary>
                  <p className="mt-2 break-words font-mono text-muted-foreground">
                    {diagnostics.grantedScopes.join(", ")}
                  </p>
                </details>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Publishing Settings</CardTitle>
          <CardDescription>
            Configure settings for product publishing and synchronization
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="publicationId">Publication ID</Label>
            <Input
              id="publicationId"
              placeholder="Enter publication ID..."
              value={publicationId}
              onChange={(e) => setPublicationIdState(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              This ID is used to identify the publication channel for approved products.
            </p>
          </div>

          <Button onClick={handleSave}>
            <Save className="h-4 w-4 mr-2" />
            Save Settings
          </Button>
        </CardContent>
      </Card>

      {/* Webhook Management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-5 w-5" />
            Shopify Webhooks
          </CardTitle>
          <CardDescription>
            Webhooks receive order notifications from Shopify. If orders are not appearing in the seller panel, re-register them here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <Button variant="outline" onClick={checkWebhooks} disabled={checking}>
              {checking ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Check Webhooks
            </Button>
            <Button onClick={registerWebhooks} disabled={registering}>
              {registering ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Webhook className="h-4 w-4 mr-2" />}
              Re-register All Webhooks
            </Button>
          </div>

          {webhookStatus && (
            <div className="space-y-2 mt-4">
              <p className="text-sm font-medium">
                {webhookStatus.length} webhook(s) registered:
              </p>
              <div className="space-y-1">
                {webhookStatus.length === 0 && (
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <XCircle className="h-4 w-4" />
                    No webhooks found — click "Re-register All Webhooks" to fix this.
                  </div>
                )}
                {webhookStatus.map((wh: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span className="font-mono text-xs">{wh.topic}</span>
                    <span className="text-muted-foreground text-xs truncate max-w-[300px]">→ {wh.address}</span>
                  </div>
                ))}
              </div>

              {webhookStatus.length > 0 && !webhookStatus.some((w: any) => w.topic === "orders/create") && (
                <div className="flex items-center gap-2 text-sm text-destructive mt-2">
                  <XCircle className="h-4 w-4" />
                  Missing <span className="font-mono">orders/create</span> webhook — click "Re-register" to fix.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Test Discount Coupon */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            Test Discount Coupon
          </CardTitle>
          <CardDescription>
            Create a private 100% discount code for testing orders without paying. The code is NOT publicly visible.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={async () => {
              setCreatingDiscount(true);
              setDiscountResult(null);
              try {
                const data = await createTestDiscount(
                  "Testing-shopify-orderplacing-10000000",
                  "Internal Testing - 100% Off",
                );
                setDiscountResult(data);
                if (data.ok) {
                  toast.success("Discount code created: " + (data.discount?.code || ""));
                } else {
                  toast.error("Failed: " + JSON.stringify(data.userErrors || data.error || "Unknown error"));
                }
              } catch (err: any) {
                toast.error("Error: " + (err?.message || err));
                setDiscountResult({ ok: false, error: err?.message });
              } finally {
                setCreatingDiscount(false);
              }
            }}
            disabled={creatingDiscount}
            variant="outline"
          >
            {creatingDiscount ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Tag className="h-4 w-4 mr-2" />
            )}
            Create Test Coupon (100% Off)
          </Button>

          {discountResult && (
            <div className="text-sm mt-2">
              {discountResult.ok ? (
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>
                    Code <span className="font-mono font-bold">{discountResult.discount?.code}</span> created — use at checkout for 100% off.
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-destructive">
                  <XCircle className="h-4 w-4" />
                  <span>{JSON.stringify(discountResult.error || discountResult.userErrors)}</span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Repair Product Pricing */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Repair Product Pricing
          </CardTitle>
          <CardDescription>
            Fix missing Price section (Compare-at, Charge tax, Cost per item) for products created via the seller panel. This updates all existing product variants on Shopify.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={async () => {
              setRepairingPricing(true);
              setRepairResult(null);
              setRepairProgress("");
              let totalRepaired = 0;
              let totalSkipped = 0;
              let totalProducts = 0;
              const allErrors: string[] = [];
              try {
                const u = auth.currentUser;
                if (!u) throw new Error("Not signed in");
                const idToken = await u.getIdToken(true);
                let offset = 0;
                let hasMore = true;

                while (hasMore) {
                  const r = await fetch("/api/admin/admin?action=products.repairPricing", {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${idToken}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ action: "products.repairPricing", offset }),
                  });
                  const data = await r.json();
                  if (!data.ok) {
                    toast.error("Repair failed: " + (data.error || "Unknown error"));
                    setRepairResult({ ok: false, error: data.error });
                    return;
                  }
                  totalRepaired += data.repaired || 0;
                  totalSkipped += data.skipped || 0;
                  totalProducts = data.total || 0;
                  if (data.errors) allErrors.push(...data.errors);
                  hasMore = data.hasMore === true;
                  offset = data.nextOffset ?? offset + 10;
                  setRepairProgress(`Processing… ${Math.min(offset, totalProducts)} / ${totalProducts} products`);
                }

                const finalResult = {
                  ok: true,
                  total: totalProducts,
                  repaired: totalRepaired,
                  skipped: totalSkipped,
                  errors: allErrors.length ? allErrors : undefined,
                };
                setRepairResult(finalResult);
                toast.success(`Repaired ${totalRepaired} product(s). Skipped ${totalSkipped}.`);
              } catch (err: any) {
                toast.error("Error: " + (err?.message || err));
                setRepairResult({ ok: false, error: err?.message });
              } finally {
                setRepairingPricing(false);
                setRepairProgress("");
              }
            }}
            disabled={repairingPricing}
            variant="outline"
          >
            {repairingPricing ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Wrench className="h-4 w-4 mr-2" />
            )}
            {repairingPricing ? "Repairing..." : "Repair All Products"}
          </Button>
          {repairProgress && (
            <p className="text-sm text-muted-foreground mt-1">{repairProgress}</p>
          )}

          {repairResult && (
            <div className="text-sm mt-2">
              {repairResult.ok ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>
                      {repairResult.repaired} product(s) repaired, {repairResult.skipped} skipped
                      {repairResult.total ? ` (${repairResult.total} total)` : ""}
                    </span>
                  </div>
                  {repairResult.errors?.length > 0 && (
                    <div className="text-destructive text-xs mt-1">
                      {repairResult.errors.map((e: string, i: number) => (
                        <div key={i}>{e}</div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-destructive">
                  <XCircle className="h-4 w-4" />
                  <span>{repairResult.error || "Unknown error"}</span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>System Information</CardTitle>
          <CardDescription>Current system status and information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Version:</span>
            <span className="font-medium">1.0.0</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Environment:</span>
            <span className="font-medium">Production</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Developer:</span>
            <span className="font-medium">Sachin Verma, SWE Intern</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Last Updated:</span>
            <span className="font-medium">{new Date().toLocaleDateString()}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
