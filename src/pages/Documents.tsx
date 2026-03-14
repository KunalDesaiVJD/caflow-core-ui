import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  FolderOpen, Upload, FileText, FileSpreadsheet, FileImage, File,
  Download, Trash2, Search, Loader2, Bot, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DocRow {
  id: string;
  filename: string | null;
  category: string | null;
  tags: string[] | null;
  r2_key: string | null;
  client_id: string | null;
  firm_id: string | null;
  extracted_text: string | null;
}

interface ClientOption {
  id: string;
  name: string | null;
}

const FOLDERS = [
  { key: "trial_balance", label: "Trial Balance", icon: FileSpreadsheet },
  { key: "audit", label: "Audit", icon: FileText, children: [
    { key: "audit_planning", label: "Planning" },
    { key: "audit_fieldwork", label: "Fieldwork" },
    { key: "audit_reports", label: "Reports" },
  ]},
  { key: "tds", label: "TDS", icon: FileText },
  { key: "itr", label: "ITR", icon: FileText },
  { key: "gst", label: "GST", icon: FileText },
  { key: "billing", label: "Billing", icon: FileText },
  { key: "other", label: "Other", icon: File },
];

const YEARS = ["2024-25", "2023-24", "2022-23", "2021-22"];

function getFileIcon(filename: string | null) {
  if (!filename) return File;
  const ext = filename.split(".").pop()?.toLowerCase();
  if (["xlsx", "xls", "csv"].includes(ext || "")) return FileSpreadsheet;
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext || "")) return FileImage;
  if (["pdf", "doc", "docx", "txt"].includes(ext || "")) return FileText;
  return File;
}

const CATEGORY_COLORS: Record<string, string> = {
  trial_balance: "bg-emerald-100 text-emerald-700",
  audit: "bg-sky-100 text-sky-700",
  audit_planning: "bg-sky-100 text-sky-700",
  audit_fieldwork: "bg-sky-100 text-sky-700",
  audit_reports: "bg-sky-100 text-sky-700",
  tds: "bg-amber-100 text-amber-700",
  itr: "bg-purple-100 text-purple-700",
  gst: "bg-rose-100 text-rose-700",
  billing: "bg-orange-100 text-orange-700",
  other: "bg-muted text-muted-foreground",
};

export default function Documents() {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [selectedClient, setSelectedClient] = useState<string>("all");
  const [selectedYear, setSelectedYear] = useState(YEARS[0]);
  const [selectedFolder, setSelectedFolder] = useState("all");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(["audit"]));

  const [documents, setDocuments] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const [deleteDoc, setDeleteDoc] = useState<DocRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Search (local text filter)
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [localSearchQuery, setLocalSearchQuery] = useState("");

  // Load clients
  useEffect(() => {
    supabase.from("clients").select("id, name").order("name").then(({ data }) => {
      setClients((data as ClientOption[]) || []);
    });
  }, []);

  // Load documents
  useEffect(() => {
    fetchDocuments();
  }, [selectedClient, selectedFolder]);

  async function fetchDocuments() {
    setLoading(true);
    let query = supabase.from("documents").select("*").order("filename");
    if (selectedClient !== "all") query = query.eq("client_id", selectedClient);
    if (selectedFolder !== "all") {
      // Handle audit sub-folders
      if (selectedFolder === "audit") {
        query = query.in("category", ["audit", "audit_planning", "audit_fieldwork", "audit_reports"]);
      } else {
        query = query.eq("category", selectedFolder);
      }
    }
    const { data, error } = await query.limit(500);
    if (error) {
      toast({ title: "Error loading documents", description: error.message, variant: "destructive" });
    }
    setDocuments((data as DocRow[]) || []);
    setLoading(false);
  }

  // Count docs per folder
  const folderCounts = documents.reduce<Record<string, number>>((acc, d) => {
    const cat = d.category || "other";
    acc[cat] = (acc[cat] || 0) + 1;
    // Also count audit sub-categories under "audit"
    if (cat.startsWith("audit")) {
      acc["audit"] = (acc["audit"] || 0) + 1;
    }
    return acc;
  }, {});

  // Filter docs by folder and search
  const allDocsForFolder = documents.filter(d => {
    // Folder filter
    if (selectedFolder !== "all") {
      if (selectedFolder === "audit") {
        if (!(d.category || "").startsWith("audit")) return false;
      } else if (d.category !== selectedFolder) return false;
    }
    // Local search filter
    if (localSearchQuery.trim()) {
      const q = localSearchQuery.toLowerCase();
      const matchName = (d.filename || "").toLowerCase().includes(q);
      const matchCategory = (d.category || "").toLowerCase().includes(q);
      const matchTags = (d.tags || []).some(t => t.toLowerCase().includes(q));
      const matchClient = clients.find(c => c.id === d.client_id)?.name?.toLowerCase().includes(q);
      if (!matchName && !matchCategory && !matchTags && !matchClient) return false;
    }
    return true;
  });

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const clientId = selectedClient !== "all" ? selectedClient : null;
      const category = selectedFolder !== "all" ? selectedFolder : "other";
      const firmId = user?.firm_id;

      // Insert document record
      const { error } = await supabase.from("documents").insert({
        filename: file.name,
        category,
        client_id: clientId,
        firm_id: firmId,
        tags: [],
      } as any);

      if (error) throw error;
      toast({ title: "Document uploaded", description: file.name });
      fetchDocuments();
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleDelete() {
    if (!deleteDoc) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("documents").delete().eq("id", deleteDoc.id);
      if (error) throw error;
      toast({ title: "Document deleted" });
      setDeleteDoc(null);
      fetchDocuments();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  async function handleAiSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("claude-gateway", {
        body: {
          request_type: "workpaper_assistant",
          user_message: `Search across documents for: ${searchQuery}\n\nAvailable documents:\n${documents.slice(0, 20).map(d => `- ${d.filename} (${d.category}): ${(d.extracted_text || "").slice(0, 200)}`).join("\n")}`,
        },
      });
      if (error) throw error;
      const content = data?.result?.raw || data?.result || JSON.stringify(data?.result, null, 2);
      setSearchResult(typeof content === "string" ? content : JSON.stringify(content, null, 2));
    } catch (err: any) {
      toast({ title: "Search failed", description: err.message, variant: "destructive" });
    } finally {
      setSearching(false);
    }
  }

  function toggleFolder(key: string) {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Document Vault</h1>
          <p className="text-sm text-muted-foreground">Manage and search your firm's documents.</p>
        </div>
      </div>

      {/* AI Search */}
      <Card>
        <CardContent className="p-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Bot className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Ask anything about your documents..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleAiSearch(); }}
                className="pl-9"
              />
            </div>
            <Button onClick={handleAiSearch} disabled={searching || !searchQuery.trim()} className="gap-2">
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Search
            </Button>
          </div>
          {/* Local filter below AI search */}
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Quick filter by name, type, client, or tags..."
              value={localSearchQuery}
              onChange={e => setLocalSearchQuery(e.target.value)}
              className="pl-9 h-8 text-xs"
            />
          </div>
          {searchResult && (
            <div className="mt-3 p-3 rounded-md border border-border bg-muted/50">
              <p className="text-sm text-foreground whitespace-pre-wrap">{searchResult}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-6">
        {/* Left Panel - Folder Tree */}
        <div className="w-64 shrink-0 space-y-4">
          {/* Client Selector */}
          <Select value={selectedClient} onValueChange={setSelectedClient}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All Clients" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Clients</SelectItem>
              {clients.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name || "Unnamed"}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Year Selector */}
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {YEARS.map(y => (
                <SelectItem key={y} value={y}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Folder Tree */}
          <div className="space-y-0.5">
            <button
              onClick={() => setSelectedFolder("all")}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                selectedFolder === "all" ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"
              )}
            >
              <FolderOpen className="h-4 w-4" />
              All Documents
              <Badge variant="secondary" className="ml-auto text-[10px]">{documents.length}</Badge>
            </button>

            {FOLDERS.map(folder => (
              <div key={folder.key}>
                <button
                  onClick={() => {
                    setSelectedFolder(folder.key);
                    if (folder.children) toggleFolder(folder.key);
                  }}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    selectedFolder === folder.key ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"
                  )}
                >
                  {folder.children && (
                    <ChevronRight className={cn("h-3 w-3 transition-transform", expandedFolders.has(folder.key) && "rotate-90")} />
                  )}
                  <folder.icon className="h-4 w-4" />
                  {folder.label}
                  {folderCounts[folder.key] ? (
                    <Badge variant="secondary" className="ml-auto text-[10px]">{folderCounts[folder.key]}</Badge>
                  ) : null}
                </button>
                {folder.children && expandedFolders.has(folder.key) && (
                  <div className="ml-6 space-y-0.5">
                    {folder.children.map(sub => (
                      <button
                        key={sub.key}
                        onClick={() => setSelectedFolder(sub.key)}
                        className={cn(
                          "w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                          selectedFolder === sub.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                      >
                        {sub.label}
                        {folderCounts[sub.key] ? (
                          <Badge variant="secondary" className="ml-auto text-[10px]">{folderCounts[sub.key]}</Badge>
                        ) : null}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right Panel - File Grid */}
        <div className="flex-1 space-y-4">
          {/* Upload Button */}
          <div className="flex justify-end">
            <Button onClick={() => fileRef.current?.click()} disabled={uploading} className="gap-2">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Upload Document
            </Button>
            <input ref={fileRef} type="file" className="hidden" onChange={handleUpload} />
          </div>

          {/* File Grid */}
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-32 rounded-lg" />
              ))}
            </div>
          ) : allDocsForFolder.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <FolderOpen className="h-10 w-10 mb-3 opacity-40" />
                <p className="font-medium">No documents found</p>
                <p className="text-xs mt-1">Upload a document to get started.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {allDocsForFolder.map(doc => {
                const IconComp = getFileIcon(doc.filename);
                return (
                  <Card key={doc.id} className="hover:border-primary/40 transition-colors">
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-start gap-3">
                        <IconComp className="h-8 w-8 text-muted-foreground shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{doc.filename || "Untitled"}</p>
                          {doc.category && (
                            <Badge variant="outline" className={cn("text-[10px] mt-1", CATEGORY_COLORS[doc.category] || "")}>
                              {doc.category.replace(/_/g, " ")}
                            </Badge>
                          )}
                        </div>
                      </div>
                      {doc.tags && doc.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {doc.tags.map((tag, i) => (
                            <Badge key={i} variant="secondary" className="text-[10px]">{tag}</Badge>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-1 pt-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Download"
                          onClick={async () => {
                            if (doc.r2_key) {
                              try {
                                const { data, error } = await supabase.functions.invoke("get-document-url", {
                                  body: { document_id: doc.id },
                                });
                                if (error || !data?.signed_url) throw new Error(error?.message || "Failed to get download URL");
                                const a = document.createElement("a");
                                a.href = data.signed_url;
                                a.download = doc.filename || "document";
                                a.target = "_blank";
                                a.click();
                              } catch (err: any) {
                                toast({ title: "Download failed", description: err.message, variant: "destructive" });
                              }
                            } else {
                              toast({ title: "No file stored", description: "This document has no associated file.", variant: "destructive" });
                            }
                          }}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteDoc(doc)}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteDoc} onOpenChange={open => { if (!open) setDeleteDoc(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteDoc?.filename}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
