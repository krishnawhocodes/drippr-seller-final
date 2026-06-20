import { useState, useEffect } from "react";
import { getPublicationId, setPublicationId } from "@/lib/adminApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Save } from "lucide-react";

export default function AdminSettings() {
  const [publicationId, setPublicationIdState] = useState("");

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

  return (
    <div className="space-y-6">
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
