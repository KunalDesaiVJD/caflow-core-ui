import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { HelpCircle, Loader2, Send } from "lucide-react";

const SUBJECTS = ["Bug Report", "Feature Request", "General Feedback"];

export function FeedbackWidget() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("General Feedback");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!description.trim() || !user) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from("feedback").insert({
        user_id: user.id,
        firm_id: user.firm_id,
        subject,
        description: description.trim(),
      });
      if (error) throw error;
      toast.success("Feedback submitted. Thank you!");
      setDescription("");
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to submit feedback");
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) return null;

  return (
    <div className="fixed bottom-20 md:bottom-6 right-4 z-40">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            size="icon"
            variant="outline"
            className="rounded-full w-10 h-10 shadow-lg bg-card border-border"
          >
            <HelpCircle size={18} />
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" className="w-72 p-3">
          <h4 className="text-sm font-semibold text-foreground mb-2">Send Feedback</h4>
          <div className="space-y-2">
            <Select value={subject} onValueChange={setSubject}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUBJECTS.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              placeholder="Describe your feedback..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="text-sm"
            />
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!description.trim() || submitting}
              className="w-full"
            >
              {submitting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Send className="w-3 h-3 mr-1" />}
              Submit
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
