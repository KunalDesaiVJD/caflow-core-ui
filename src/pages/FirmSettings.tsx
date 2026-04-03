import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Building, CreditCard, Palette, Crown, Landmark,
  Loader2, Save, Upload, Image, Plus, Trash2,
} from "lucide-react";

interface MembershipEntry {
  partner_name: string;
  membership_no: string;
}

const FirmSettings = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = ["superadmin", "firm_admin", "partner_ca"].includes(user?.role || "");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [firmId, setFirmId] = useState<string | null>(null);
  const [selectedFirmId, setSelectedFirmId] = useState<string | null>(null);
  const [firmsList, setFirmsList] = useState<{ id: string; name: string }[]>([]);

  // Basic Info
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [pan, setPan] = useState("");
  const [gstin, setGstin] = useState("");
  const [tan, setTan] = useState("");
  const [msmeNo, setMsmeNo] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [pincode, setPincode] = useState("");

  // Audit Registration
  const [icaiRegNo, setIcaiRegNo] = useState("");
  const [icaiFirmRegNo, setIcaiFirmRegNo] = useState("");
  const [isAuditFirm, setIsAuditFirm] = useState(false);
  const [peerReviewCertNo, setPeerReviewCertNo] = useState("");
  const [peerReviewValidTill, setPeerReviewValidTill] = useState("");
  const [memberships, setMemberships] = useState<MembershipEntry[]>([]);

  // Bank & Billing
  const [bankName, setBankName] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [branch, setBranch] = useState("");
  const [invoicePrefix, setInvoicePrefix] = useState("");
  const [gstRate, setGstRate] = useState("18");
  const [paymentTerms, setPaymentTerms] = useState("Net 30 days");
  const [billingEmail, setBillingEmail] = useState("");
  const [billingContactNo, setBillingContactNo] = useState("");

  // Branding
  const [logoUrl, setLogoUrl] = useState("");
  const [signatureUrl, setSignatureUrl] = useState("");
  const [letterheadUrl, setLetterheadUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState("");
  const [secondaryColor, setSecondaryColor] = useState("");

  // Subscription
  const [planType, setPlanType] = useState("");
  const [planExpiresAt, setPlanExpiresAt] = useState("");
  const [maxUsers, setMaxUsers] = useState(10);
  const [maxClients, setMaxClients] = useState(100);

  const logoRef = useRef<HTMLInputElement>(null);
  const sigRef = useRef<HTMLInputElement>(null);
  const lhRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadFirmsList();
  }, [user]);

  useEffect(() => {
    if (user?.role === "superadmin" && firmsList.length > 0 && !selectedFirmId) {
      setSelectedFirmId(firmsList[0].id);
    } else if (user?.firm_id && !selectedFirmId) {
      setSelectedFirmId(user.firm_id);
    }
  }, [user, firmsList, selectedFirmId]);

  useEffect(() => {
    if (selectedFirmId) {
      setFirmId(selectedFirmId);
      loadFirm(selectedFirmId);
    }
  }, [selectedFirmId]);

  async function loadFirmsList() {
    const { data } = await supabase.from("firms").select("id, name").order("name");
    setFirmsList(data || []);
  }

  async function loadFirm(id: string) {
    setLoading(true);
    const { data } = await supabase.from("firms").select("*").eq("id", id).single();
    if (data) {
      setName(data.name || "");
      setDisplayName((data as any).display_name || "");
      setPan((data as any).pan || "");
      setGstin((data as any).gstin || "");
      setTan((data as any).tan || "");
      setMsmeNo((data as any).msme_no || ((data as any).settings as any)?.msme_no || "");
      setEmail((data as any).email || "");
      setPhone((data as any).phone || "");
      setWebsite((data as any).website || "");
      setState((data as any).state || "");
      setPincode((data as any).pincode || "");
      setIcaiRegNo(data.icai_reg_no || "");
      setIcaiFirmRegNo((data as any).icai_firm_reg_no || "");
      setIsAuditFirm((data as any).is_audit_firm || false);
      setPeerReviewCertNo((data as any).peer_review_certificate_no || "");
      setPeerReviewValidTill((data as any).peer_review_valid_till || "");
      setMemberships((data as any).membership_numbers || []);
      setLogoUrl((data as any).logo_url || "");
      setSignatureUrl((data as any).signature_url || "");
      setLetterheadUrl((data as any).letterhead_url || "");
      setPrimaryColor((data as any).primary_color || "");
      setSecondaryColor((data as any).secondary_color || "");
      setPlanType((data as any).plan_type || data.plan || "");
      setPlanExpiresAt((data as any).plan_expires_at || "");
      setMaxUsers((data as any).max_users || 10);
      setMaxClients((data as any).max_clients || 100);

      const addr = (data as any).address;
      if (typeof addr === "object" && addr) {
        setAddressLine(addr.line || "");
        setCity(addr.city || "");
      } else {
        const settings = (data.settings || {}) as any;
        setAddressLine(settings.address || "");
        setCity("");
      }

      const settings = (data.settings || {}) as any;
      const billing = settings.billing || {};
      setBankName((data as any).bank_details?.bank_name || billing.bank_name || "");
      setAccountNo((data as any).bank_details?.account_number || billing.account_number || "");
      setIfsc((data as any).bank_details?.ifsc || billing.ifsc || "");
      setBranch((data as any).bank_details?.branch || billing.branch || "");
      setInvoicePrefix(billing.invoice_prefix || "INV/2425/");
      setGstRate(String(billing.gst_rate || 18));
      setPaymentTerms(billing.payment_terms || "Net 30 days");
      setBillingEmail(settings.billing_email || "");
      setBillingContactNo(settings.billing_contact_no || "");
    }
    setLoading(false);
  }

  async function handleUpload(file: File, path: string, setter: (url: string) => void, dbField?: string) {
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", variant: "destructive" });
      return;
    }
    try {
      await supabase.storage.from("firm-assets").upload(path, file, { upsert: true });
      const { data } = supabase.storage.from("firm-assets").getPublicUrl(path);
      const publicUrl = data.publicUrl;
      setter(publicUrl);
      // Auto-save to database immediately so it persists
      if (firmId && dbField) {
        const updatePayload: any = { [dbField]: publicUrl };
        // Also save into settings.logo_url for backward compat
        if (dbField === "logo_url") {
          const { data: current } = await supabase.from("firms").select("settings").eq("id", firmId).single();
          const existingSettings = (current?.settings || {}) as any;
          updatePayload.settings = { ...existingSettings, logo_url: publicUrl };
        }
        await supabase.from("firms").update(updatePayload as any).eq("id", firmId);
      }
      toast({ title: "Uploaded & saved" });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    }
  }

  async function save() {
    if (!firmId || !isAdmin) return;
    setSaving(true);
    try {
      const { data: current } = await supabase.from("firms").select("settings").eq("id", firmId).single();
      const existingSettings = (current?.settings || {}) as any;

      const { error } = await supabase.from("firms").update({
        name,
        display_name: displayName,
        pan,
        gstin,
        tan,
        email,
        phone,
        website,
        state,
        pincode,
        icai_reg_no: icaiRegNo,
        icai_firm_reg_no: icaiFirmRegNo,
        is_audit_firm: isAuditFirm,
        peer_review_certificate_no: peerReviewCertNo,
        peer_review_valid_till: peerReviewValidTill || null,
        membership_numbers: memberships,
        logo_url: logoUrl,
        signature_url: signatureUrl,
        letterhead_url: letterheadUrl,
        primary_color: primaryColor,
        secondary_color: secondaryColor,
        plan_type: planType,
        plan_expires_at: planExpiresAt || null,
        max_users: maxUsers,
        max_clients: maxClients,
        address: { line: addressLine, city },
        bank_details: { bank_name: bankName, account_number: accountNo, ifsc, branch },
        settings: {
          ...existingSettings,
          billing: { gst_rate: Number(gstRate), payment_terms: paymentTerms, invoice_prefix: invoicePrefix },
          logo_url: logoUrl,
          signature_url: signatureUrl,
          address: addressLine,
          msme_no: msmeNo,
          billing_email: billingEmail,
          billing_contact_no: billingContactNo,
        },
      } as any).eq("id", firmId);

      if (error) throw error;
      toast({ title: "Firm settings saved" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <Building className="h-6 w-6" /> Firm Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Complete firm profile, audit registration, and billing.</p>
        </div>
        {isAdmin && (
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save All
          </Button>
        )}
      </div>

      {user?.role === "superadmin" && firmsList.length > 1 && (
        <Select value={selectedFirmId || ""} onValueChange={v => setSelectedFirmId(v)}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Select firm" /></SelectTrigger>
          <SelectContent>
            {firmsList.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}

      <Tabs defaultValue="basic" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="basic" className="text-xs"><Building className="h-3.5 w-3.5 mr-1" /> Basic Info</TabsTrigger>
          <TabsTrigger value="audit" className="text-xs"><Landmark className="h-3.5 w-3.5 mr-1" /> Audit Registration</TabsTrigger>
          <TabsTrigger value="bank" className="text-xs"><CreditCard className="h-3.5 w-3.5 mr-1" /> Bank & Billing</TabsTrigger>
          <TabsTrigger value="branding" className="text-xs"><Palette className="h-3.5 w-3.5 mr-1" /> Branding</TabsTrigger>
          <TabsTrigger value="subscription" className="text-xs"><Crown className="h-3.5 w-3.5 mr-1" /> Subscription</TabsTrigger>
        </TabsList>

        {/* BASIC INFO */}
        <TabsContent value="basic">
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
              <CardDescription>Legal name, contact details, and address.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Legal Name</Label><Input value={name} onChange={e => setName(e.target.value)} disabled={!isAdmin} /></div>
                <div className="space-y-2"><Label>Display Name</Label><Input value={displayName} onChange={e => setDisplayName(e.target.value)} disabled={!isAdmin} /></div>
                <div className="space-y-2"><Label>PAN</Label><Input value={pan} onChange={e => setPan(e.target.value.toUpperCase())} disabled={!isAdmin} placeholder="AAACA1234A" maxLength={10} /></div>
                <div className="space-y-2"><Label>GSTIN</Label><Input value={gstin} onChange={e => setGstin(e.target.value.toUpperCase())} disabled={!isAdmin} /></div>
                <div className="space-y-2"><Label>TAN</Label><Input value={tan} onChange={e => setTan(e.target.value.toUpperCase())} disabled={!isAdmin} /></div>
                <div className="space-y-2"><Label>MSME No</Label><Input value={msmeNo} onChange={e => setMsmeNo(e.target.value)} disabled={!isAdmin} placeholder="UDYAM-XX-00-0000000" /></div>
                <div className="space-y-2"><Label>Email</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} disabled={!isAdmin} /></div>
                <div className="space-y-2"><Label>Phone</Label><Input value={phone} onChange={e => setPhone(e.target.value)} disabled={!isAdmin} /></div>
                <div className="space-y-2"><Label>Website</Label><Input value={website} onChange={e => setWebsite(e.target.value)} disabled={!isAdmin} /></div>
              </div>
              <div className="space-y-2"><Label>Address Line</Label><Textarea value={addressLine} onChange={e => setAddressLine(e.target.value)} disabled={!isAdmin} rows={2} /></div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2"><Label>City</Label><Input value={city} onChange={e => setCity(e.target.value)} disabled={!isAdmin} /></div>
                <div className="space-y-2"><Label>State</Label><Input value={state} onChange={e => setState(e.target.value)} disabled={!isAdmin} /></div>
                <div className="space-y-2"><Label>Pincode</Label><Input value={pincode} onChange={e => setPincode(e.target.value)} disabled={!isAdmin} maxLength={6} /></div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AUDIT REGISTRATION */}
        <TabsContent value="audit">
          <Card>
            <CardHeader>
              <CardTitle>Audit Registration</CardTitle>
              <CardDescription>ICAI registration, peer review, and partner membership numbers.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Switch checked={isAuditFirm} onCheckedChange={setIsAuditFirm} disabled={!isAdmin} />
                <Label>This firm is a registered audit firm</Label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2"><Label>ICAI Registration No (old)</Label><Input value={icaiRegNo} onChange={e => setIcaiRegNo(e.target.value)} disabled={!isAdmin} /></div>
                <div className="space-y-2"><Label>ICAI Firm Registration No</Label><Input value={icaiFirmRegNo} onChange={e => setIcaiFirmRegNo(e.target.value)} disabled={!isAdmin} /></div>
                <div className="space-y-2"><Label>Peer Review Certificate No</Label><Input value={peerReviewCertNo} onChange={e => setPeerReviewCertNo(e.target.value)} disabled={!isAdmin} /></div>
                <div className="space-y-2"><Label>Peer Review Valid Till</Label><Input type="date" value={peerReviewValidTill} onChange={e => setPeerReviewValidTill(e.target.value)} disabled={!isAdmin} /></div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Partner Membership Numbers</Label>
                  {isAdmin && (
                    <Button variant="outline" size="sm" onClick={() => setMemberships(prev => [...prev, { partner_name: "", membership_no: "" }])}>
                      <Plus className="h-3 w-3 mr-1" /> Add Partner
                    </Button>
                  )}
                </div>
                {memberships.map((m, i) => (
                  <div key={i} className="flex gap-3 items-center">
                    <Input placeholder="Partner Name" value={m.partner_name} onChange={e => {
                      const updated = [...memberships];
                      updated[i] = { ...updated[i], partner_name: e.target.value };
                      setMemberships(updated);
                    }} disabled={!isAdmin} className="flex-1" />
                    <Input placeholder="Membership No" value={m.membership_no} onChange={e => {
                      const updated = [...memberships];
                      updated[i] = { ...updated[i], membership_no: e.target.value };
                      setMemberships(updated);
                    }} disabled={!isAdmin} className="flex-1" />
                    {isAdmin && (
                      <Button variant="ghost" size="icon" onClick={() => setMemberships(prev => prev.filter((_, j) => j !== i))}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* BANK & BILLING */}
        <TabsContent value="bank">
          <Card>
            <CardHeader>
              <CardTitle>Bank & Billing</CardTitle>
              <CardDescription>Bank account details and invoice settings.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Bank Name</Label><Input value={bankName} onChange={e => setBankName(e.target.value)} disabled={!isAdmin} /></div>
                <div className="space-y-2"><Label>Account Number</Label><Input value={accountNo} onChange={e => setAccountNo(e.target.value)} disabled={!isAdmin} /></div>
                <div className="space-y-2"><Label>IFSC Code</Label><Input value={ifsc} onChange={e => setIfsc(e.target.value.toUpperCase())} disabled={!isAdmin} /></div>
                <div className="space-y-2"><Label>Branch</Label><Input value={branch} onChange={e => setBranch(e.target.value)} disabled={!isAdmin} /></div>
              </div>
              <div className="border-t border-border pt-4" />
              <p className="text-sm font-semibold text-foreground">Invoice Contact Details</p>
              <p className="text-xs text-muted-foreground">These will appear on the invoice header below MSME/Udyam No.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Billing Email</Label><Input type="email" value={billingEmail} onChange={e => setBillingEmail(e.target.value)} disabled={!isAdmin} placeholder="billing@firm.com" /></div>
                <div className="space-y-2"><Label>Billing Contact No</Label><Input value={billingContactNo} onChange={e => setBillingContactNo(e.target.value)} disabled={!isAdmin} placeholder="+91 98765 43210" /></div>
              </div>
              <div className="border-t border-border pt-4" />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2"><Label>Invoice Prefix</Label><Input value={invoicePrefix} onChange={e => setInvoicePrefix(e.target.value)} disabled={!isAdmin} /></div>
                <div className="space-y-2"><Label>GST Rate (%)</Label><Input type="number" value={gstRate} onChange={e => setGstRate(e.target.value)} disabled={!isAdmin} /></div>
                <div className="space-y-2"><Label>Payment Terms</Label><Input value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} disabled={!isAdmin} /></div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* BRANDING */}
        <TabsContent value="branding">
          <Card>
            <CardHeader>
              <CardTitle>Branding & Theme</CardTitle>
              <CardDescription>Logo, signature, letterhead, and brand colours.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Logo */}
                <div className="space-y-2">
                  <Label>Firm Logo</Label>
                  {logoUrl && <img src={logoUrl} alt="Logo" className="h-16 object-contain rounded border border-border p-1" />}
                  <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={e => {
                    const f = e.target.files?.[0];
                    if (f && firmId) handleUpload(f, `${firmId}/logo`, setLogoUrl);
                  }} />
                  <Button variant="outline" size="sm" onClick={() => logoRef.current?.click()} disabled={!isAdmin}>
                    <Upload className="h-3 w-3 mr-1" /> Upload Logo
                  </Button>
                </div>
                {/* Signature */}
                <div className="space-y-2">
                  <Label>Signature</Label>
                  {signatureUrl && <img src={signatureUrl} alt="Signature" className="h-16 object-contain rounded border border-border p-1" />}
                  <input ref={sigRef} type="file" accept="image/*" className="hidden" onChange={e => {
                    const f = e.target.files?.[0];
                    if (f && firmId) handleUpload(f, `${firmId}/signature`, setSignatureUrl);
                  }} />
                  <Button variant="outline" size="sm" onClick={() => sigRef.current?.click()} disabled={!isAdmin}>
                    <Upload className="h-3 w-3 mr-1" /> Upload Signature
                  </Button>
                </div>
                {/* Letterhead */}
                <div className="space-y-2">
                  <Label>Letterhead</Label>
                  {letterheadUrl && <img src={letterheadUrl} alt="Letterhead" className="h-16 object-contain rounded border border-border p-1" />}
                  <input ref={lhRef} type="file" accept="image/*" className="hidden" onChange={e => {
                    const f = e.target.files?.[0];
                    if (f && firmId) handleUpload(f, `${firmId}/letterhead`, setLetterheadUrl);
                  }} />
                  <Button variant="outline" size="sm" onClick={() => lhRef.current?.click()} disabled={!isAdmin}>
                    <Upload className="h-3 w-3 mr-1" /> Upload Letterhead
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                <div className="space-y-2">
                  <Label>Primary Colour</Label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={primaryColor || "#0D9488"} onChange={e => setPrimaryColor(e.target.value)} disabled={!isAdmin} className="h-8 w-8 rounded cursor-pointer" />
                    <Input value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} disabled={!isAdmin} placeholder="#0D9488" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Secondary Colour</Label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={secondaryColor || "#C9A84C"} onChange={e => setSecondaryColor(e.target.value)} disabled={!isAdmin} className="h-8 w-8 rounded cursor-pointer" />
                    <Input value={secondaryColor} onChange={e => setSecondaryColor(e.target.value)} disabled={!isAdmin} placeholder="#C9A84C" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SUBSCRIPTION */}
        <TabsContent value="subscription">
          <Card>
            <CardHeader>
              <CardTitle>Subscription</CardTitle>
              <CardDescription>Plan details, user limits, and feature flags.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Plan Type</Label>
                  <Select value={planType} onValueChange={setPlanType} disabled={user?.role !== "superadmin"}>
                    <SelectTrigger><SelectValue placeholder="Select plan" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="starter">Starter</SelectItem>
                      <SelectItem value="pro">Pro</SelectItem>
                      <SelectItem value="enterprise">Enterprise</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Plan Expires At</Label>
                  <Input type="date" value={planExpiresAt ? planExpiresAt.split("T")[0] : ""} onChange={e => setPlanExpiresAt(e.target.value)} disabled={user?.role !== "superadmin"} />
                </div>
                <div className="space-y-2">
                  <Label>Max Users</Label>
                  <Input type="number" value={maxUsers} onChange={e => setMaxUsers(Number(e.target.value))} disabled={user?.role !== "superadmin"} />
                </div>
                <div className="space-y-2">
                  <Label>Max Clients</Label>
                  <Input type="number" value={maxClients} onChange={e => setMaxClients(Number(e.target.value))} disabled={user?.role !== "superadmin"} />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <Badge variant="outline" className="text-xs">
                  Current Plan: {planType || "Not Set"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default FirmSettings;
