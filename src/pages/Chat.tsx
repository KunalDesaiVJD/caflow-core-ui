import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Search, Plus, Send, Paperclip, Pin, Reply, Copy, Trash2,
  Users, Info, X, Check, CheckCheck, MessageSquare, ChevronDown
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { format, isToday, isYesterday } from "date-fns";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger
} from "@/components/ui/context-menu";

interface Conversation {
  id: string;
  type: string;
  name: string | null;
  avatar_url: string | null;
  created_by: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  firm_id: string;
}

interface Message {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  content: string | null;
  file_url: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  message_type: string;
  reply_to_message_id: string | null;
  is_pinned: boolean;
  is_deleted: boolean;
  read_by: any;
  created_at: string;
}

interface Participant {
  id: string;
  conversation_id: string;
  user_id: string;
  role: string;
  joined_at: string;
  left_at: string | null;
  notification_muted: boolean;
}

interface FirmUser {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return "Yesterday";
  return format(d, "dd/MM/yy");
}

function getInitials(name: string | null) {
  if (!name) return "??";
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

export default function Chat() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [convTab, setConvTab] = useState<"all" | "groups">("all");
  const [messageText, setMessageText] = useState("");
  const [showInfo, setShowInfo] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [userSearch, setUserSearch] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch conversations
  const { data: conversations = [] } = useQuery({
    queryKey: ["chat_conversations", user?.firm_id, user?.role],
    queryFn: async () => {
      let q = supabase.from("chat_conversations").select("*").order("last_message_at", { ascending: false });
      if (user?.firm_id && user?.role !== "superadmin") {
        q = q.eq("firm_id", user.firm_id);
      }
      const { data } = await q;
      return (data || []) as Conversation[];
    },
    enabled: !!user,
  });

  // Fetch participants for active conversation
  const { data: participants = [] } = useQuery({
    queryKey: ["chat_participants", activeConvId],
    queryFn: async () => {
      if (!activeConvId) return [];
      const { data } = await supabase
        .from("chat_participants")
        .select("*")
        .eq("conversation_id", activeConvId)
        .is("left_at", null);
      return (data || []) as Participant[];
    },
    enabled: !!activeConvId,
  });

  // Fetch firm users for user directory
  const { data: firmUsers = [] } = useQuery({
    queryKey: ["firm_users_chat", user?.firm_id, user?.role],
    queryFn: async () => {
      if (!user) return [];
      let q = supabase.from("users").select("id, name, email, role").neq("id", user.id);
      if (user.firm_id && user.role !== "superadmin") q = q.eq("firm_id", user.firm_id);
      const { data } = await q;
      return (data || []) as FirmUser[];
    },
    enabled: !!user,
  });

  // Fetch messages for active conversation
  const { data: messages = [] } = useQuery({
    queryKey: ["chat_messages", activeConvId],
    queryFn: async () => {
      if (!activeConvId) return [];
      const { data } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("conversation_id", activeConvId)
        .order("created_at", { ascending: true });
      return (data || []) as Message[];
    },
    enabled: !!activeConvId,
  });

  // Fetch user names for display
  const { data: userNames = {} } = useQuery({
    queryKey: ["chat_user_names", participants.map(p => p.user_id).join(",")],
    queryFn: async () => {
      const ids = [...new Set([...participants.map(p => p.user_id), ...messages.map(m => m.sender_id).filter(Boolean)])];
      if (ids.length === 0) return {};
      const { data } = await supabase.from("users").select("id, name, email").in("id", ids as string[]);
      const map: Record<string, string> = {};
      (data || []).forEach(u => { map[u.id] = u.name || u.email || "Unknown"; });
      return map;
    },
    enabled: participants.length > 0 || messages.length > 0,
  });

  // Realtime subscription for new messages
  useEffect(() => {
    if (!activeConvId) return;
    const channel = supabase
      .channel(`chat:${activeConvId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "chat_messages",
        filter: `conversation_id=eq.${activeConvId}`,
      }, (payload) => {
        queryClient.invalidateQueries({ queryKey: ["chat_messages", activeConvId] });
        queryClient.invalidateQueries({ queryKey: ["chat_conversations"] });
        // Mark as read
        if (payload.new && (payload.new as any).sender_id !== user?.id) {
          markAsRead((payload.new as any).id);
        }
      })
      .on("broadcast", { event: "typing" }, (payload) => {
        if (payload.payload?.user_id !== user?.id) {
          setTypingUsers(prev => ({ ...prev, [payload.payload.user_id]: payload.payload.name }));
          setTimeout(() => {
            setTypingUsers(prev => {
              const next = { ...prev };
              delete next[payload.payload.user_id];
              return next;
            });
          }, 3000);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [activeConvId, user?.id]);

  // Realtime for conversation list updates
  useEffect(() => {
    const channel = supabase
      .channel("chat_conv_updates")
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "chat_conversations",
      }, () => {
        queryClient.invalidateQueries({ queryKey: ["chat_conversations"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Presence for online users
  useEffect(() => {
    if (!user) return;
    const channel = supabase.channel("online_users", {
      config: { presence: { key: user.id } },
    });
    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        setOnlineUsers(new Set(Object.keys(state)));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ user_id: user.id, name: user.name });
        }
      });
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const markAsRead = async (messageId: string) => {
    if (!user) return;
    const { data: msg } = await supabase
      .from("chat_messages")
      .select("read_by")
      .eq("id", messageId)
      .single();
    if (!msg) return;
    const readBy = Array.isArray(msg.read_by) ? msg.read_by : [];
    if (readBy.some((r: any) => r.user_id === user.id)) return;
    await supabase
      .from("chat_messages")
      .update({ read_by: [...readBy, { user_id: user.id, read_at: new Date().toISOString() }] })
      .eq("id", messageId);
  };

  const sendMessage = async () => {
    if (!messageText.trim() || !activeConvId || !user) return;
    const content = messageText.trim();
    setMessageText("");
    setReplyTo(null);

    await supabase.from("chat_messages").insert({
      conversation_id: activeConvId,
      sender_id: user.id,
      content,
      message_type: "text",
      reply_to_message_id: replyTo?.id || null,
    });

    await supabase.from("chat_conversations").update({
      last_message_at: new Date().toISOString(),
      last_message_preview: content.substring(0, 200),
      updated_at: new Date().toISOString(),
    }).eq("id", activeConvId);

    queryClient.invalidateQueries({ queryKey: ["chat_messages", activeConvId] });
    queryClient.invalidateQueries({ queryKey: ["chat_conversations"] });
  };

  const handleTyping = () => {
    if (!activeConvId || !user) return;
    const channel = supabase.channel(`chat:${activeConvId}`);
    channel.send({ type: "broadcast", event: "typing", payload: { user_id: user.id, name: user.name } });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeConvId || !user) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File size must be under 10MB");
      return;
    }
    const path = `chat/${activeConvId}/${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from("firm-assets").upload(path, file);
    if (error) { toast.error("Upload failed"); return; }
    const { data: urlData } = supabase.storage.from("firm-assets").getPublicUrl(path);

    const isImage = file.type.startsWith("image/");
    await supabase.from("chat_messages").insert({
      conversation_id: activeConvId,
      sender_id: user.id,
      content: file.name,
      file_url: urlData.publicUrl,
      file_name: file.name,
      file_size_bytes: file.size,
      message_type: isImage ? "image" : "file",
    });

    await supabase.from("chat_conversations").update({
      last_message_at: new Date().toISOString(),
      last_message_preview: `📎 ${file.name}`,
    }).eq("id", activeConvId);

    queryClient.invalidateQueries({ queryKey: ["chat_messages", activeConvId] });
    queryClient.invalidateQueries({ queryKey: ["chat_conversations"] });
    e.target.value = "";
  };

  const createIndividualChat = async (otherUserId: string) => {
    if (!user) return;
    // Check if conversation already exists
    const { data: existingParticipants } = await supabase
      .from("chat_participants")
      .select("conversation_id")
      .eq("user_id", user.id);

    if (existingParticipants) {
      for (const ep of existingParticipants) {
        const { data: otherP } = await supabase
          .from("chat_participants")
          .select("conversation_id")
          .eq("conversation_id", ep.conversation_id)
          .eq("user_id", otherUserId);
        if (otherP && otherP.length > 0) {
          const { data: conv } = await supabase
            .from("chat_conversations")
            .select("type")
            .eq("id", ep.conversation_id)
            .eq("type", "individual")
            .single();
          if (conv) {
            setActiveConvId(ep.conversation_id);
            setShowNewChat(false);
            return;
          }
        }
      }
    }

    // Create new conversation
    const convFirmId = user.firm_id;
    if (!convFirmId) { toast.error("Firm ID not found"); return; }
    const { data: conv, error: convError } = await supabase.from("chat_conversations").insert({
      firm_id: convFirmId,
      type: "individual",
      created_by: user.id,
    }).select().single();

    if (convError) { toast.error("Failed to create conversation: " + convError.message); return; }

    if (conv) {
      const { error: partError } = await supabase.from("chat_participants").insert([
        { conversation_id: conv.id, user_id: user.id, role: "admin" },
        { conversation_id: conv.id, user_id: otherUserId, role: "member" },
      ]);
      if (partError) { toast.error("Failed to add participants: " + partError.message); return; }
      setActiveConvId(conv.id);
      queryClient.invalidateQueries({ queryKey: ["chat_conversations"] });
    }
    setShowNewChat(false);
  };

  const createGroupChat = async () => {
    if (!user || !groupName.trim() || selectedUsers.length === 0) return;
    const convFirmId = user.firm_id || "";
    const { data: conv } = await supabase.from("chat_conversations").insert({
      firm_id: convFirmId,
      type: "group",
      name: groupName.trim(),
      created_by: user.id,
    }).select().single();

    if (conv) {
      await supabase.from("chat_participants").insert([
        { conversation_id: conv.id, user_id: user.id, role: "admin" },
        ...selectedUsers.map(uid => ({ conversation_id: conv.id, user_id: uid, role: "member" as const })),
      ]);
      setActiveConvId(conv.id);
      queryClient.invalidateQueries({ queryKey: ["chat_conversations"] });
    }
    setShowNewGroup(false);
    setGroupName("");
    setSelectedUsers([]);
  };

  const pinMessage = async (msgId: string, pinned: boolean) => {
    await supabase.from("chat_messages").update({ is_pinned: !pinned }).eq("id", msgId);
    queryClient.invalidateQueries({ queryKey: ["chat_messages", activeConvId] });
  };

  const deleteMessage = async (msgId: string) => {
    await supabase.from("chat_messages").update({ is_deleted: true, deleted_at: new Date().toISOString() }).eq("id", msgId);
    queryClient.invalidateQueries({ queryKey: ["chat_messages", activeConvId] });
  };

  const activeConv = conversations.find(c => c.id === activeConvId);
  const filteredConvs = conversations.filter(c => {
    if (convTab === "groups" && c.type !== "group") return false;
    if (searchTerm) {
      const name = c.name || c.last_message_preview || "";
      return name.toLowerCase().includes(searchTerm.toLowerCase());
    }
    return true;
  });

  const pinnedMessages = messages.filter(m => m.is_pinned && !m.is_deleted);
  const visibleMessages = messages.filter(m => !m.is_deleted);
  const typingNames = Object.values(typingUsers);

  const getConversationName = (conv: Conversation) => {
    if (conv.type === "group") return conv.name || "Group";
    return conv.last_message_preview ? conv.name || "Chat" : "Chat";
  };

  const getUnreadCount = (conv: Conversation) => {
    // Simple unread estimation — messages not read by current user
    return 0; // Would need per-conversation tracking
  };

  const getReadStatus = (msg: Message) => {
    if (msg.sender_id !== user?.id) return null;
    const readBy = Array.isArray(msg.read_by) ? msg.read_by : [];
    const otherReads = readBy.filter((r: any) => r.user_id !== user?.id);
    const totalOthers = participants.filter(p => p.user_id !== user?.id).length;
    if (totalOthers === 0) return "sent";
    if (otherReads.length >= totalOthers) return "read_all";
    if (otherReads.length > 0) return "read_some";
    return "sent";
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] rounded-lg border border-border overflow-hidden bg-background">
      {/* LEFT SIDEBAR */}
      <div className={cn("w-80 border-r border-border flex flex-col bg-muted/30 shrink-0", activeConvId && "hidden md:flex")}>
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-foreground">Messages</h2>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Plus size={18} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setShowNewChat(true)}>
                  <MessageSquare size={14} className="mr-2" /> Individual Chat
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowNewGroup(true)}>
                  <Users size={14} className="mr-2" /> New Group
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input
              placeholder="Search conversations..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-8 h-9 text-sm"
            />
          </div>
          <Tabs value={convTab} onValueChange={v => setConvTab(v as any)}>
            <TabsList className="w-full h-8">
              <TabsTrigger value="all" className="flex-1 text-xs">All</TabsTrigger>
              <TabsTrigger value="groups" className="flex-1 text-xs">Groups</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <ScrollArea className="flex-1">
          {filteredConvs.length === 0 && (
            <div className="p-6 text-center text-muted-foreground text-sm">No conversations yet</div>
          )}
          {filteredConvs.map(conv => (
            <button
              key={conv.id}
              onClick={() => setActiveConvId(conv.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-3 text-left hover:bg-muted/50 transition-colors border-b border-border/50",
                activeConvId === conv.id && "bg-primary/5 border-l-2 border-l-primary"
              )}
            >
              <Avatar className="h-10 w-10 shrink-0">
                <AvatarFallback className={cn("text-xs font-medium", conv.type === "group" ? "bg-primary/10 text-primary" : "bg-accent text-accent-foreground")}>
                  {conv.type === "group" ? <Users size={16} /> : getInitials(conv.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-foreground truncate">{getConversationName(conv)}</span>
                  {conv.last_message_at && (
                    <span className="text-[10px] text-muted-foreground shrink-0 ml-1">{formatTime(conv.last_message_at)}</span>
                  )}
                </div>
                {conv.last_message_preview && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{conv.last_message_preview}</p>
                )}
              </div>
            </button>
          ))}
        </ScrollArea>
      </div>

      {/* MIDDLE — MESSAGE AREA */}
      <div className={cn("flex-1 flex flex-col min-w-0", !activeConvId && "hidden md:flex")}>
        {!activeConvId ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center space-y-2">
              <MessageSquare size={48} className="mx-auto opacity-30" />
              <p className="text-sm">Select a conversation to start chatting</p>
            </div>
          </div>
        ) : (
          <>
            {/* Top bar */}
            <div className="h-14 border-b border-border flex items-center justify-between px-4 bg-background shrink-0">
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" className="md:hidden h-8 w-8" onClick={() => setActiveConvId(null)}>
                  <ChevronDown size={16} className="rotate-90" />
                </Button>
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs">
                    {activeConv?.type === "group" ? <Users size={14} /> : getInitials(activeConv?.name || null)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium text-foreground">{activeConv ? getConversationName(activeConv) : ""}</p>
                  {activeConv?.type === "group" && (
                    <p className="text-[10px] text-muted-foreground">{participants.length} members</p>
                  )}
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowInfo(!showInfo)}>
                <Info size={16} />
              </Button>
            </div>

            {/* Pinned messages bar */}
            {pinnedMessages.length > 0 && (
              <div className="px-4 py-2 bg-primary/5 border-b border-border flex items-center gap-2 text-xs">
                <Pin size={12} className="text-primary shrink-0" />
                <span className="text-muted-foreground truncate">
                  {pinnedMessages.length} pinned message{pinnedMessages.length > 1 ? "s" : ""}:
                  {" "}{pinnedMessages[pinnedMessages.length - 1]?.content?.substring(0, 60)}
                </span>
              </div>
            )}

            {/* Messages */}
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-3">
                {visibleMessages.map((msg, idx) => {
                  const isOwn = msg.sender_id === user?.id;
                  const senderName = msg.sender_id ? (userNames as Record<string, string>)[msg.sender_id] || "Unknown" : "System";
                  const readStatus = getReadStatus(msg);
                  const repliedMsg = msg.reply_to_message_id ? visibleMessages.find(m => m.id === msg.reply_to_message_id) : null;

                  if (msg.message_type === "system") {
                    return (
                      <div key={msg.id} className="text-center">
                        <span className="text-[10px] text-muted-foreground bg-muted px-3 py-1 rounded-full">{msg.content}</span>
                      </div>
                    );
                  }

                  return (
                    <ContextMenu key={msg.id}>
                      <ContextMenuTrigger>
                        <div className={cn("flex gap-2 max-w-[75%]", isOwn ? "ml-auto flex-row-reverse" : "")}>
                          {!isOwn && (
                            <Avatar className="h-7 w-7 shrink-0 mt-1">
                              <AvatarFallback className="text-[10px]">{getInitials(senderName)}</AvatarFallback>
                            </Avatar>
                          )}
                          <div>
                            {!isOwn && activeConv?.type === "group" && (
                              <p className="text-[10px] font-medium text-primary mb-0.5 px-1">{senderName}</p>
                            )}
                            {repliedMsg && (
                              <div className={cn("text-[10px] px-2 py-1 rounded-t border-l-2 border-primary/50 bg-muted/50 mb-0.5", isOwn ? "text-right" : "")}>
                                <span className="text-muted-foreground">{repliedMsg.content?.substring(0, 80)}</span>
                              </div>
                            )}
                            <div className={cn(
                              "px-3 py-2 rounded-xl text-sm",
                              isOwn ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted rounded-bl-sm"
                            )}>
                              {msg.message_type === "image" && msg.file_url && (
                                <img src={msg.file_url} alt={msg.file_name || ""} className="max-w-[240px] rounded-lg mb-1 cursor-pointer" onClick={() => window.open(msg.file_url!, '_blank')} />
                              )}
                              {msg.message_type === "file" && msg.file_url && (
                                <a href={msg.file_url} target="_blank" rel="noopener" className="flex items-center gap-2 underline text-xs">
                                  <Paperclip size={12} /> {msg.file_name} ({((msg.file_size_bytes || 0) / 1024).toFixed(0)} KB)
                                </a>
                              )}
                              {msg.content && msg.message_type === "text" && <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
                            </div>
                            <div className={cn("flex items-center gap-1 mt-0.5 px-1", isOwn ? "justify-end" : "")}>
                              <span className="text-[9px] text-muted-foreground">{format(new Date(msg.created_at), "HH:mm")}</span>
                              {msg.is_pinned && <Pin size={8} className="text-primary" />}
                              {readStatus === "sent" && <Check size={10} className="text-muted-foreground" />}
                              {readStatus === "read_some" && <CheckCheck size={10} className="text-muted-foreground" />}
                              {readStatus === "read_all" && <CheckCheck size={10} className="text-primary" />}
                            </div>
                          </div>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onClick={() => setReplyTo(msg)}>
                          <Reply size={14} className="mr-2" /> Reply
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => pinMessage(msg.id, msg.is_pinned)}>
                          <Pin size={14} className="mr-2" /> {msg.is_pinned ? "Unpin" : "Pin"}
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => { navigator.clipboard.writeText(msg.content || ""); toast.success("Copied"); }}>
                          <Copy size={14} className="mr-2" /> Copy
                        </ContextMenuItem>
                        {isOwn && (
                          <ContextMenuItem onClick={() => deleteMessage(msg.id)} className="text-destructive">
                            <Trash2 size={14} className="mr-2" /> Delete
                          </ContextMenuItem>
                        )}
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Typing indicator */}
            {typingNames.length > 0 && (
              <div className="px-4 py-1 text-xs text-muted-foreground">
                {typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing...
              </div>
            )}

            {/* Reply bar */}
            {replyTo && (
              <div className="px-4 py-2 bg-muted/50 border-t border-border flex items-center gap-2">
                <Reply size={14} className="text-primary shrink-0" />
                <span className="text-xs text-muted-foreground truncate flex-1">{replyTo.content?.substring(0, 80)}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setReplyTo(null)}>
                  <X size={12} />
                </Button>
              </div>
            )}

            {/* Message input */}
            <div className="p-3 border-t border-border bg-background flex items-end gap-2">
              <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
              <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => fileInputRef.current?.click()}>
                <Paperclip size={16} />
              </Button>
              <Textarea
                placeholder="Type a message..."
                value={messageText}
                onChange={e => { setMessageText(e.target.value); handleTyping(); }}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                className="min-h-[36px] max-h-[120px] resize-none text-sm"
                rows={1}
              />
              <Button size="icon" className="h-9 w-9 shrink-0" onClick={sendMessage} disabled={!messageText.trim()}>
                <Send size={16} />
              </Button>
            </div>
          </>
        )}
      </div>

      {/* RIGHT — INFO PANEL */}
      {showInfo && activeConv && (
        <div className="w-72 border-l border-border bg-muted/20 flex flex-col shrink-0">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Details</h3>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowInfo(false)}>
              <X size={14} />
            </Button>
          </div>
          <div className="p-4 text-center border-b border-border">
            <Avatar className="h-16 w-16 mx-auto mb-2">
              <AvatarFallback className="text-lg">
                {activeConv.type === "group" ? <Users size={24} /> : getInitials(activeConv.name)}
              </AvatarFallback>
            </Avatar>
            <p className="font-medium text-foreground">{getConversationName(activeConv)}</p>
            <p className="text-xs text-muted-foreground">{activeConv.type === "group" ? "Group" : "Individual"}</p>
          </div>
          <div className="p-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Members ({participants.length})</p>
            <div className="space-y-2">
              {participants.map(p => {
                const name = (userNames as Record<string, string>)[p.user_id] || "Unknown";
                const isOnline = onlineUsers.has(p.user_id);
                return (
                  <div key={p.id} className="flex items-center gap-2">
                    <div className="relative">
                      <Avatar className="h-7 w-7">
                        <AvatarFallback className="text-[9px]">{getInitials(name)}</AvatarFallback>
                      </Avatar>
                      <div className={cn("absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-background", isOnline ? "bg-green-500" : "bg-muted-foreground/30")} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{name}</p>
                    </div>
                    {p.role === "admin" && <Badge variant="secondary" className="text-[9px] h-4">Admin</Badge>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* NEW INDIVIDUAL CHAT DIALOG */}
      <Dialog open={showNewChat} onOpenChange={setShowNewChat}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New Chat</DialogTitle>
          </DialogHeader>
          <Input placeholder="Search users..." value={userSearch} onChange={e => setUserSearch(e.target.value)} className="mb-2" />
          <ScrollArea className="max-h-[300px]">
            <div className="space-y-1">
              {firmUsers.filter(u => !userSearch || (u.name || u.email || "").toLowerCase().includes(userSearch.toLowerCase())).map(u => (
                <button
                  key={u.id}
                  onClick={() => createIndividualChat(u.id)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted transition-colors text-left"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-xs">{getInitials(u.name)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">{u.name || u.email}</p>
                    <p className="text-[10px] text-muted-foreground">{u.role}</p>
                  </div>
                  {onlineUsers.has(u.id) && <div className="ml-auto w-2 h-2 rounded-full bg-green-500" />}
                </button>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* NEW GROUP DIALOG */}
      <Dialog open={showNewGroup} onOpenChange={setShowNewGroup}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Group</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Group name" value={groupName} onChange={e => setGroupName(e.target.value)} />
            <p className="text-xs text-muted-foreground font-medium">Select members:</p>
            <Input placeholder="Search..." value={userSearch} onChange={e => setUserSearch(e.target.value)} />
            <ScrollArea className="max-h-[250px]">
              <div className="space-y-1">
                {firmUsers.filter(u => !userSearch || (u.name || u.email || "").toLowerCase().includes(userSearch.toLowerCase())).map(u => (
                  <label key={u.id} className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted cursor-pointer">
                    <Checkbox
                      checked={selectedUsers.includes(u.id)}
                      onCheckedChange={checked => {
                        setSelectedUsers(prev => checked ? [...prev, u.id] : prev.filter(id => id !== u.id));
                      }}
                    />
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="text-[10px]">{getInitials(u.name)}</AvatarFallback>
                    </Avatar>
                    <span className="text-sm">{u.name || u.email}</span>
                  </label>
                ))}
              </div>
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button onClick={createGroupChat} disabled={!groupName.trim() || selectedUsers.length === 0}>
              Create Group ({selectedUsers.length} members)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
