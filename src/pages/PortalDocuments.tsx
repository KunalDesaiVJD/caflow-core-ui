/**
 * PortalDocuments — Client document centre (Phase 2)
 *
 * - All documents uploaded by firm for this client
 * - Client can upload documents (categorised)
 * - Documents grouped by category
 */
import { useState, useEffect, useCallback } from "react";
import { usePortalClient } from "@/contexts/PortalClientContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { FolderOpen, FileText, Download, Upload, Loader2, Search, X, Eye, Trash2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

const UPLOAD_CATS = [
  "Bank Statement", "GST Return", "TDS Certificate", "Audit Report",
  "Investment Proof", "Insurance Document", "Vendor Invoice",
  "Board Resolution", "Loan Agreement", "Other",
];

const GROUP_MAP: Record<string, string[]> = {
  "Audit Documents":   ["Audit Report", "Board Resolution", "Loan Agreement"],
  "Tax & Compliance":  ["GST Return", "TDS Certificate"],
  "Banking":           ["Bank Statement"],
  "Investments":       ["Investment Proof", "Insurance Document"],
  "Vendor & Other":    ["Vendor Invoice", "Other"],
};

function getCategoryGroup(cat: string): string {
  for (const [group, cats] of Object.entries(GROUP_MAP)) {
    if (cats.some(c => cat?.toLowerCase().includes(c.toLowerCase()))) return group;
  }
  if (cat?.toLowerCase().includes("itr") || cat?.toLowerCase().includes("tax")) return "Tax & Compliance";
  if (cat?.toLowerCase().includes("audit")) return "Audit Documents";
  return "Other";
}

export default function PortalDocuments() {
  const { activeClient, loading: clientLoading } = usePortalClient();
  const [loading,    setLoading]    = useState(false);
  const [documents,  setDocuments]  = useState<any[]>([]);
  const [uploading,  setUploading]  = useState(false);
  const [uploadCat,  setUploadCat]  = useState("Other");
  const [search,     setSearch]     = useState("");
  const [deleting,   setDeleting]   = useState<string | null>(null);

  const fetchDocs = useCallback(async () => {
    if (!activeClient) return;
    setLoading(true);
    const { data } = await supabase.from("documents").select("*").eq("client_id", activeClient.id).order("filename");
    setDocuments(data || []);
    setLoading(false);
  }, [activeClient]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !activeClient) return;
    setUploading(true);
    try {
      const path = `clients/${activeClient.id}/client_uploads/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from("firm-assets").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      await supabase.from("documents").insert({
        firm_id: activeClient.firm_id,
        client_id: activeClient.id,
        filename: file.name,
        category: "client_upload",
        sub_category: uploadCat,
        r2_key: path,
      });
      toast.success("Document uploaded");
      fetchDocs();
      // Notify firm via smart-batched digest (at most once per 4 hours)
      supabase.functions.invoke("send-notification", {
        body: {
          type:      "portal_client_activity",
          firm_id:   activeClient.firm_id,
          client_id: activeClient.id,
          payload: {
            client_name:   activeClient.name,
            activity_type: "document_upload",
            details:       `${file.name} (${uploadCat})`,
          },
        },
      }).catch(() => {});
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function getSignedUrl(doc: any): Promise<string | null> {
    const { data, error } = await supabase.storage.from("firm-assets").createSignedUrl(doc.r2_key, 120);
    if (error) { toast.error("Could not get file URL: " + error.message); return null; }
    return data.signedUrl;
  }

  async function handleView(doc: any) {
    const url = await getSignedUrl(doc);
    if (url) window.open(url, "_blank");
  }

  async function handleDownload(doc: any) {
    const url = await getSignedUrl(doc);
    if (!url) return;
    const a = document.createElement("a"); a.href = url; a.download = doc.filename; a.click();
  }

  async function handleDelete(doc: any) {
    if (!window.confirm(`Delete "${doc.filename}"? This cannot be undone.`)) return;
    setDeleting(doc.id);
    try {
      await supabase.storage.from("firm-assets").remove([doc.r2_key]);
      await supabase.from("documents").delete().eq("id", doc.id);
      toast.success("Document deleted");
      fetchDocs();
    } catch (e: any) {
      toast.error(e.message || "Delete failed");
    } finally {
      setDeleting(null);
    }
  }

  const filtered = search
    ? documents.filter(d => d.filename?.toLowerCase().includes(search.toLowerCase()))
    : documents;

  // Group
  const groups: Record<string, any[]> = {};
  for (const doc of filtered) {
    const g = getCategoryGroup(doc.sub_category || doc.category || "");
    if (!groups[g]) groups[g] = [];
    groups[g].push(doc);
  }
  const groupOrder = Object.keys(GROUP_MAP).filter(g => groups[g]?.length > 0);
  if (groups["Other"]?.length) groupOrder.push("Other");

  if (clientLoading || loading) {
    return <div className="space-y-3"><Skeleton className="h-8 w-48"/><Skeleton className="h-40"/></div>;
  }

  if (!activeClient) {
    return (
      <div className="text-center py-20 text-muted-foreground text-sm">
        No client profile found. Contact your CA firm.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2 text-[#1A2744]">
          <FolderOpen size={22} className="text-orange-600" /> My Documents
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {activeClient.name} · Documents shared by your CA firm and files you've uploaded
        </p>
      </div>

      {/* Search */}
      {documents.length > 3 && (
        <div className="relative w-56">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search files…"
            className="h-8 pl-8 pr-7 w-full text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
              <X size={12} />
            </button>
          )}
        </div>
      )}

      {/* Document groups */}
      {groupOrder.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <FolderOpen className="mx-auto h-10 w-10 mb-3 opacity-25" />
            <p className="text-sm">No documents yet. Upload your first document below.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {groupOrder.map(group => (
            <Card key={group}>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  <span>{group}</span>
                  <label className="cursor-pointer flex items-center gap-1 text-xs font-normal text-orange-600 hover:text-orange-800">
                    <Plus size={13} /> Upload more
                    <input type="file" className="hidden" disabled={uploading}
                      onChange={handleUpload} />
                  </label>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="divide-y">
                  {groups[group].map((doc: any) => (
                    <div key={doc.id} className="flex items-center justify-between py-2.5 gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText size={14} className="text-muted-foreground flex-shrink-0" />
                        <span className="text-sm truncate">{doc.filename}</span>
                        {doc.sub_category && (
                          <Badge variant="outline" className="text-[10px] flex-shrink-0">{doc.sub_category}</Badge>
                        )}
                        {doc.category === "client_upload" && (
                          <Badge variant="secondary" className="text-[10px] flex-shrink-0">My Upload</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1 text-blue-600 hover:bg-blue-50" onClick={() => handleView(doc)}>
                          <Eye size={13} /> View
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={() => handleDownload(doc)}>
                          <Download size={13} /> Save
                        </Button>
                        {doc.category === "client_upload" && (
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1 text-destructive hover:bg-red-50"
                            disabled={deleting === doc.id}
                            onClick={() => handleDelete(doc)}>
                            {deleting === doc.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Upload section */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Upload size={15} className="text-orange-600" /> Upload a Document to Your CA
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <Select value={uploadCat} onValueChange={setUploadCat}>
              <SelectTrigger className="w-full sm:w-56 h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UPLOAD_CATS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" asChild disabled={uploading} className="flex-1 h-9 border-orange-300 text-orange-700 hover:bg-orange-50">
              <label className="cursor-pointer flex items-center justify-center gap-2 text-sm">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload size={15} />}
                {uploading ? "Uploading…" : "Choose File to Upload"}
                <Input type="file" className="hidden" onChange={handleUpload} />
              </label>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
