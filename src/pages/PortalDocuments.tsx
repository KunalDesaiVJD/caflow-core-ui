/**
 * PortalDocuments — Client document centre (Phase 2)
 *
 * - All documents uploaded by firm for this client
 * - Client can upload documents (categorised)
 * - Documents grouped by category
 */
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { FolderOpen, FileText, Download, Upload, Loader2, Search, X } from "lucide-react";
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
  const { user } = useAuth();
  const [loading,    setLoading]    = useState(true);
  const [clientData, setClientData] = useState<any>(null);
  const [documents,  setDocuments]  = useState<any[]>([]);
  const [uploading,  setUploading]  = useState(false);
  const [uploadCat,  setUploadCat]  = useState("Other");
  const [search,     setSearch]     = useState("");

  const fetchDocs = useCallback(async () => {
    if (!user) return;
    const { data: client } = await supabase.from("clients").select("*").eq("user_id", user.id).maybeSingle();
    if (!client) { setLoading(false); return; }
    setClientData(client);
    const { data } = await supabase.from("documents").select("*").eq("client_id", client.id).order("filename");
    setDocuments(data || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !clientData) return;
    setUploading(true);
    try {
      const path = `clients/${clientData.id}/client_uploads/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from("firm-assets").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      await supabase.from("documents").insert({
        firm_id: clientData.firm_id,
        client_id: clientData.id,
        filename: file.name,
        category: "client_upload",
        sub_category: uploadCat,
        r2_key: path,
      });
      toast.success("Document uploaded");
      fetchDocs();
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function handleDownload(doc: any) {
    try {
      const { data, error } = await supabase.functions.invoke("get-document-url", { body: { document_id: doc.id } });
      if (error) throw error;
      if (data?.signed_url) window.open(data.signed_url, "_blank");
      else {
        // fallback: direct storage URL
        const { data: sd } = await supabase.storage.from("firm-assets").createSignedUrl(doc.r2_key, 60);
        if (sd?.signedUrl) window.open(sd.signedUrl, "_blank");
      }
    } catch (e: any) { toast.error(e.message || "Download failed"); }
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

  if (loading) return <div className="space-y-3"><Skeleton className="h-8 w-48"/><Skeleton className="h-40"/></div>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <FolderOpen size={22} className="text-primary" /> My Documents
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Documents shared by your CA firm and files you've uploaded
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
                <CardTitle className="text-sm font-semibold">{group}</CardTitle>
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
                      </div>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 flex-shrink-0" onClick={() => handleDownload(doc)}>
                        <Download size={14} />
                      </Button>
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
            <Upload size={15} className="text-primary" /> Upload a Document to Your CA
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
            <Button variant="outline" asChild disabled={uploading} className="flex-1 h-9">
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
