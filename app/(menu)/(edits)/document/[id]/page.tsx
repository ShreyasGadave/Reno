"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { localDB, LocalDocument, LocalVersion } from "@/lib/indexeddb";
import { useSocket } from "@/hooks/useSocket";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { ConflictDialog } from "@/components/custom/conflict-dialog";
import {
  FileText,
  Users,
  Star,
  Archive,
  Trash2,
  ArrowLeft,
  CloudLightning,
  CloudOff,
  RefreshCw,
  Plus,
  Trash,
  ChevronUp,
  ChevronDown,
  Sparkles,
  History,
  Send,
  Loader2,
  CheckCircle,
  HelpCircle,
  Eye,
  Lock,
  Globe,
  Share2,
  RotateCcw
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Block {
  id: string;
  type: string; // "paragraph" | "heading-1" | "heading-2" | "todo" | "code"
  text: string;
  checked?: boolean; // For todo block
  updatedAt: number;
  updatedBy: string;
}

export default function DocumentEditorPage() {
  const router = useRouter();
  const params = useParams();
  const documentId = (params?.id as string) || "";

  // States
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string; email: string } | null>(null);

  // Socket Hook
  const {
    socketConnected,
    collaborators,
    sendCursor,
    sendTyping,
    socket,
  } = useSocket(documentId, currentUser?.name || currentUser?.email || "User");

  // Conflict state management
  const [conflictOpen, setConflictOpen] = useState(false);
  const [conflictData, setConflictData] = useState<any>(null);

  const handleConflictDetected = useCallback((data: any) => {
    setConflictData(data);
    setConflictOpen(true);
  }, []);

  // Offline Sync Hook
  const {
    isOnline,
    syncState,
    localDoc,
    pendingChanges,
    updateDocument,
    resolveConflictChoice,
    loadLocalDoc,
    syncNow,
  } = useOfflineSync(documentId, socket, socketConnected, handleConflictDetected);

  const [role, setRole] = useState<"OWNER" | "EDITOR" | "VIEWER">("VIEWER");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [activeSidebar, setActiveSidebar] = useState<"none" | "history" | "ai" | "share">("none");
  const [loading, setLoading] = useState(true);

  // Sharing states
  const [visibility, setVisibility] = useState<"PRIVATE" | "SHARED" | "PUBLIC">("PRIVATE");
  const [invitedCollaborators, setInvitedCollaborators] = useState<any[]>([]);
  const [newCollabEmail, setNewCollabEmail] = useState("");
  const [newCollabRole, setNewCollabRole] = useState<"EDITOR" | "VIEWER">("EDITOR");
  const [isShareOpen, setIsShareOpen] = useState(false);

  // Version History states
  const [versions, setVersions] = useState<LocalVersion[]>([]);
  const [previewVersion, setPreviewVersion] = useState<LocalVersion | null>(null);
  const [newSnapshotTitle, setNewSnapshotTitle] = useState("");

  // AI assistant states
  const [aiTone, setAiTone] = useState("professional");
  const [aiChatQuery, setAiChatQuery] = useState("");
  const [aiChatHistory, setAiChatHistory] = useState<Array<{ sender: "user" | "ai"; text: string }>>([]);
  const [aiLoading, setAiLoading] = useState(false);

  const isReadOnly = role === "VIEWER";

  // Fetch current user session
  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setCurrentUser(data.user);
        }
      })
      .catch((err) => console.error("Error loading profile:", err));
  }, []);

  // Fetch document details from server to initialize IndexedDB
  const initializeDocument = useCallback(async () => {
    try {
      setLoading(true);
      // Try to load cached document from IndexedDB
      const cached = await localDB.getDocument(documentId);

      if (cached) {
        setBlocks(cached.content.blocks || []);
        setVisibility(cached.visibility);
      }

      // Fetch latest from server
      const res = await fetch(`/api/document/${documentId}`);
      if (!res.ok) {
        if (res.status === 404) {
          toast.error("Document not found");
          router.push("/documents");
          return;
        }
        throw new Error("Failed to load document");
      }

      const data = await res.json();
      setRole(data.role);
      setVisibility(data.document.visibility);

      // Save server document to IndexedDB
      const serverDoc = data.document;
      const localDocToSave: LocalDocument = {
        id: serverDoc.id,
        title: serverDoc.title,
        description: serverDoc.description || "",
        content: serverDoc.content || { blocks: [] },
        visibility: serverDoc.visibility,
        status: serverDoc.status,
        isFavorite: serverDoc.isFavorite,
        isArchived: serverDoc.isArchived,
        isDeleted: serverDoc.isDeleted,
        version: serverDoc.currentVersion,
        ownerId: serverDoc.ownerId,
        updatedAt: serverDoc.updatedAt,
        localChangesCount: cached?.localChangesCount || 0,
      };

      await localDB.saveDocument(localDocToSave);
      await loadLocalDoc();

      if (serverDoc.content?.blocks) {
        setBlocks(serverDoc.content.blocks);
      }
    } catch (error) {
      console.error("Initialize error:", error);
      toast.warning("Failed to sync. Running in offline mode.");
    } finally {
      setLoading(false);
    }
  }, [documentId, router, loadLocalDoc]);

  useEffect(() => {
    initializeDocument();
  }, [initializeDocument]);

  // Synchronize local changes count and reload local state when localDoc changes
  useEffect(() => {
    if (localDoc && localDoc.content?.blocks) {
      setBlocks(localDoc.content.blocks);
      setVisibility(localDoc.visibility);
    }
  }, [localDoc]);

  // Save changes to IndexedDB and queue sync
  const saveBlocks = async (newBlocks: Block[]) => {
    setBlocks(newBlocks);
    if (isReadOnly) return;

    await updateDocument({
      content: { blocks: newBlocks },
    });
  };

  // --- Block Edit Functions ---

  const typingTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleBlockChange = (id: string, text: string) => {
    const updated = blocks.map((b) =>
      b.id === id
        ? {
            ...b,
            text,
            updatedAt: Date.now(),
            updatedBy: currentUser?.name || currentUser?.email || "User",
          }
        : b
    );
    saveBlocks(updated);

    // Send typing presence
    sendTyping(true);
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
    }
    typingTimerRef.current = setTimeout(() => {
      sendTyping(false);
    }, 1500);
  };

  const handleCheckboxChange = (id: string, checked: boolean) => {
    const updated = blocks.map((b) =>
      b.id === id
        ? {
            ...b,
            checked,
            updatedAt: Date.now(),
            updatedBy: currentUser?.name || currentUser?.email || "User",
          }
        : b
    );
    saveBlocks(updated);
  };

  const handleBlockTypeChange = (id: string, type: string) => {
    const updated = blocks.map((b) =>
      b.id === id
        ? {
            ...b,
            type,
            updatedAt: Date.now(),
            updatedBy: currentUser?.name || currentUser?.email || "User",
          }
        : b
    );
    saveBlocks(updated);
  };

  const handleAddBlock = (index: number) => {
    if (isReadOnly) return;
    const newBlock: Block = {
      id: Math.random().toString(36).substr(2, 9),
      type: "paragraph",
      text: "",
      updatedAt: Date.now(),
      updatedBy: currentUser?.name || currentUser?.email || "User",
    };
    const newBlocks = [...blocks];
    newBlocks.splice(index + 1, 0, newBlock);
    saveBlocks(newBlocks);
  };

  const handleDeleteBlock = (id: string) => {
    if (isReadOnly) return;
    if (blocks.length <= 1) {
      toast.warning("Cannot delete the last block.");
      return;
    }
    const newBlocks = blocks.filter((b) => b.id !== id);
    saveBlocks(newBlocks);
  };

  const handleMoveBlock = (index: number, direction: "up" | "down") => {
    if (isReadOnly) return;
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === blocks.length - 1) return;

    const newBlocks = [...blocks];
    const swapWith = direction === "up" ? index - 1 : index + 1;
    const temp = newBlocks[index];
    newBlocks[index] = newBlocks[swapWith];
    newBlocks[swapWith] = temp;

    saveBlocks(newBlocks);
  };

  const handleMetadataChange = async (updates: { title?: string; description?: string }) => {
    if (isReadOnly) return;
    await updateDocument(updates);
  };

  // --- Collaborator / Sharing Panel Operations ---

  const fetchCollaborators = async () => {
    try {
      const res = await fetch(`/api/document/${documentId}/collaborators`);
      if (res.ok) {
        const data = await res.json();
        setInvitedCollaborators(data.collaborators || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddCollaborator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCollabEmail) return;

    try {
      const res = await fetch(`/api/document/${documentId}/collaborators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newCollabEmail, role: newCollabRole }),
      });

      const data = await res.json();

      if (res.ok) {
        toast.success("Collaborator added successfully");
        setNewCollabEmail("");
        fetchCollaborators();
      } else {
        toast.error(data.message || "Failed to add collaborator");
      }
    } catch {
      toast.error("Failed to add collaborator");
    }
  };

  const handleRemoveCollaborator = async (userIdToRemove: string) => {
    try {
      const res = await fetch(`/api/document/${documentId}/collaborators?userId=${userIdToRemove}`, {
        method: "DELETE",
      });

      if (res.ok) {
        toast.success("Collaborator removed");
        fetchCollaborators();
      } else {
        toast.error("Failed to remove collaborator");
      }
    } catch {
      toast.error("Error removing collaborator");
    }
  };

  const handleVisibilityChange = async (newVisibility: "PRIVATE" | "SHARED" | "PUBLIC") => {
    if (isReadOnly) return;
    try {
      await updateDocument({ visibility: newVisibility });
      setVisibility(newVisibility);
      toast.success(`Document visibility updated to ${newVisibility}`);
    } catch {
      toast.error("Failed to update visibility");
    }
  };

  // --- Version Control Operations ---

  const fetchVersions = async () => {
    try {
      const res = await fetch(`/api/document/${documentId}/versions`);
      if (res.ok) {
        const data = await res.json();
        setVersions(data.versions || []);
        // Cache versions locally in IndexedDB for offline view
        await localDB.cacheVersions(data.versions || []);
      } else {
        // Fallback to offline versions cache
        const cachedVersions = await localDB.getVersionsForDocument(documentId);
        setVersions(cachedVersions);
      }
    } catch {
      const cachedVersions = await localDB.getVersionsForDocument(documentId);
      setVersions(cachedVersions);
    }
  };

  const handleCreateSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSnapshotTitle) return;

    try {
      const res = await fetch(`/api/document/${documentId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newSnapshotTitle, summary: "Manual snapshot" }),
      });

      if (res.ok) {
        toast.success("Version snapshot saved");
        setNewSnapshotTitle("");
        fetchVersions();
      } else {
        toast.error("Failed to save snapshot");
      }
    } catch {
      toast.error("Failed to save snapshot");
    }
  };

  const handleRestoreVersion = async (versionId: string) => {
    if (isReadOnly) {
      toast.error("Viewers are not authorized to restore states.");
      return;
    }
    if (!confirm("Are you sure you want to restore the document to this version? A backup of the current state will be created.")) {
      return;
    }

    try {
      const res = await fetch(`/api/document/${documentId}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId }),
      });

      if (res.ok) {
        toast.success("Document restored successfully!");
        setPreviewVersion(null);
        initializeDocument();
        fetchVersions();
      } else {
        toast.error("Restoration failed");
      }
    } catch {
      toast.error("Failed to restore version");
    }
  };

  // --- Artificial Intelligence Add-on Operations ---

  const handleAIChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiChatQuery) return;

    const userMsg = aiChatQuery;
    setAiChatQuery("");
    setAiChatHistory((prev) => [...prev, { sender: "user", text: userMsg }]);
    setAiLoading(true);

    try {
      const documentContextText = blocks.map((b) => b.text).join("\n");
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat",
          context: documentContextText,
          prompt: userMsg,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setAiChatHistory((prev) => [...prev, { sender: "ai", text: data.text }]);
      } else {
        toast.error(data.message || "AI failed to respond");
      }
    } catch {
      toast.error("Error communicating with AI");
    } finally {
      setAiLoading(false);
    }
  };

  const handleAIToneShift = async (blockId: string, tone: string) => {
    if (isReadOnly) return;
    const targetBlock = blocks.find((b) => b.id === blockId);
    if (!targetBlock || !targetBlock.text) {
      toast.info("Please add text to the block first");
      return;
    }

    toast.info(`Rewriting text to ${tone} tone...`);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rewrite",
          context: targetBlock.text,
          prompt: tone,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        handleBlockChange(blockId, data.text);
        toast.success("Text rewritten!");
      } else {
        toast.error(data.message || "Failed to rewrite");
      }
    } catch {
      toast.error("AI rewrite failed");
    }
  };

  const handleAISummarize = async () => {
    if (isReadOnly) return;
    toast.info("Generating summary description...");
    try {
      const documentContextText = blocks.map((b) => b.text).join("\n");
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "summarize",
          context: documentContextText,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        await handleMetadataChange({ description: data.text });
        toast.success("Summary description added successfully!");
      } else {
        toast.error(data.message || "Summarize failed");
      }
    } catch {
      toast.error("AI summarize failed");
    }
  };

  const handleAIAutocomplete = async (blockId: string) => {
    if (isReadOnly) return;
    const targetBlock = blocks.find((b) => b.id === blockId);
    if (!targetBlock) return;

    toast.info("AI Autocompleting next text...");
    try {
      const documentContextText = blocks.map((b) => b.text).join("\n");
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "autocomplete",
          context: documentContextText,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        handleBlockChange(blockId, targetBlock.text + data.text);
        toast.success("Autocomplete appended!");
      } else {
        toast.error(data.message || "Autocomplete failed");
      }
    } catch {
      toast.error("AI autocomplete failed");
    }
  };

  // Trigger panels loads
  useEffect(() => {
    if (activeSidebar === "share") {
      fetchCollaborators();
    } else if (activeSidebar === "history") {
      fetchVersions();
    }
  }, [activeSidebar]);

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm font-semibold text-muted-foreground animate-pulse">
            Configuring local database & syncing details...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Editor Top Bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-card/85 backdrop-blur-md px-6 py-3">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push("/documents")}
            className="cursor-pointer"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>

          <div className="flex flex-col">
            <input
              type="text"
              value={localDoc?.title || ""}
              onChange={(e) => handleMetadataChange({ title: e.target.value })}
              disabled={isReadOnly}
              className="text-lg font-bold bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-primary rounded px-1 max-w-[240px] md:max-w-md"
              placeholder="Untitled Document"
            />
            {localDoc?.description && (
              <p className="text-xs text-muted-foreground truncate max-w-xs pl-1">
                {localDoc.description}
              </p>
            )}
          </div>
        </div>

        {/* Sync/Status Controls */}
        <div className="flex items-center gap-3">
          {/* Connection Status Badge */}
          {syncState === "synced" && (
            <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/15 gap-1.5 flex items-center h-7 py-0 px-2.5">
              <CheckCircle className="h-3.5 w-3.5" />
              Synced
            </Badge>
          )}
          {syncState === "syncing" && (
            <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20 hover:bg-blue-500/15 gap-1.5 flex items-center h-7 py-0 px-2.5">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              Syncing
            </Badge>
          )}
          {syncState === "offline" && (
            <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20 hover:bg-yellow-500/15 gap-1.5 flex items-center h-7 py-0 px-2.5">
              <CloudOff className="h-3.5 w-3.5" />
              Offline
            </Badge>
          )}
          {syncState === "error" && (
            <Badge className="bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/15 gap-1.5 flex items-center h-7 py-0 px-2.5">
              <CloudLightning className="h-3.5 w-3.5" />
              Sync Error
            </Badge>
          )}

          {/* Sync Trigger button */}
          {isOnline && !isReadOnly && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncNow()}
              className="h-8 text-xs gap-1.5 font-medium cursor-pointer"
            >
              <RefreshCw className="h-3 w-3" />
              Sync Now
            </Button>
          )}

          {/* Active Collaborators list */}
          {collaborators.length > 0 && (
            <div className="flex items-center gap-1.5 border-l pl-3 mr-1">
              {collaborators.map((c) => (
                <div
                  key={c.socketId}
                  className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-[10px] text-white border border-background relative uppercase select-none shadow-sm shrink-0"
                  style={{ backgroundColor: getCollaboratorColor(c.userId) }}
                  title={`${c.name} (${c.role})${c.typing ? " - Typing..." : ""}`}
                >
                  {c.name[0]}
                  {c.typing && (
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Role badge */}
          <Badge variant="outline" className="h-7 border-muted-foreground/30 capitalize shrink-0">
            {role.toLowerCase()}
          </Badge>

          {/* Sidebar Toggle Options */}
          <div className="flex items-center gap-1 border-l pl-3">
            <Button
              variant={activeSidebar === "share" ? "default" : "outline"}
              size="sm"
              className="h-8 gap-1.5 font-medium cursor-pointer"
              onClick={() => setActiveSidebar(activeSidebar === "share" ? "none" : "share")}
            >
              <Share2 className="h-3.5 w-3.5" />
              Share
            </Button>
            <Button
              variant={activeSidebar === "history" ? "default" : "outline"}
              size="sm"
              className="h-8 gap-1.5 font-medium cursor-pointer"
              onClick={() => setActiveSidebar(activeSidebar === "history" ? "none" : "history")}
            >
              <History className="h-3.5 w-3.5" />
              History
            </Button>
            <Button
              variant={activeSidebar === "ai" ? "default" : "outline"}
              size="sm"
              className="h-8 gap-1.5 font-medium cursor-pointer"
              onClick={() => setActiveSidebar(activeSidebar === "ai" ? "none" : "ai")}
            >
              <Sparkles className="h-3.5 w-3.5" />
              AI Assistant
            </Button>
          </div>
        </div>
      </header>

      {/* Editor Body Wrapper */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main Editor Panel */}
        <main className="flex-1 overflow-y-auto px-12 py-10 max-w-4xl mx-auto space-y-6">
          {/* Read Only Banner */}
          {isReadOnly && (
            <div className="p-3 mb-6 bg-muted/40 border border-muted/50 rounded-lg text-xs text-muted-foreground flex items-center gap-2">
              <Eye className="h-4 w-4 text-primary" />
              <span>You are viewing this document in Read-Only Mode. Edits cannot be saved.</span>
            </div>
          )}

          {/* Document Content Blocks */}
          <div className="space-y-4">
            {blocks.map((block, idx) => (
              <div
                key={block.id}
                className="group relative flex items-start gap-4 p-2 rounded-lg hover:bg-muted/30 transition-all duration-200 border border-transparent hover:border-muted/50"
              >
                {/* Block Controls */}
                <div className="absolute left-[-45px] top-[14px] flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <div className="flex flex-col">
                    <button
                      onClick={() => handleMoveBlock(idx, "up")}
                      disabled={idx === 0 || isReadOnly}
                      className="p-0.5 hover:bg-muted rounded text-muted-foreground disabled:opacity-30"
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => handleMoveBlock(idx, "down")}
                      disabled={idx === blocks.length - 1 || isReadOnly}
                      className="p-0.5 hover:bg-muted rounded text-muted-foreground disabled:opacity-30"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger disabled={isReadOnly} className="p-1 hover:bg-muted rounded text-muted-foreground font-bold text-xs select-none cursor-pointer">
                      T
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="bg-card">
                      <DropdownMenuItem onClick={() => handleBlockTypeChange(block.id, "paragraph")}>
                        Paragraph
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleBlockTypeChange(block.id, "heading-1")}>
                        Heading 1
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleBlockTypeChange(block.id, "heading-2")}>
                        Heading 2
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleBlockTypeChange(block.id, "todo")}>
                        Todo Item
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleBlockTypeChange(block.id, "code")}>
                        Code Block
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Block Input Content */}
                <div className="flex-1 min-w-0 pt-1">
                  {block.type === "heading-1" && (
                    <input
                      type="text"
                      value={block.text}
                      onFocus={() => sendCursor({ blockId: block.id, offset: 0 })}
                      onBlur={() => sendCursor(null)}
                      onChange={(e) => handleBlockChange(block.id, e.target.value)}
                      disabled={isReadOnly}
                      className="text-2xl font-bold border-0 focus:outline-none w-full bg-transparent text-foreground placeholder-muted-foreground/50"
                      placeholder="Heading 1"
                    />
                  )}

                  {block.type === "heading-2" && (
                    <input
                      type="text"
                      value={block.text}
                      onFocus={() => sendCursor({ blockId: block.id, offset: 0 })}
                      onBlur={() => sendCursor(null)}
                      onChange={(e) => handleBlockChange(block.id, e.target.value)}
                      disabled={isReadOnly}
                      className="text-xl font-semibold border-0 focus:outline-none w-full bg-transparent text-foreground placeholder-muted-foreground/50"
                      placeholder="Heading 2"
                    />
                  )}

                  {block.type === "paragraph" && (
                    <Textarea
                      value={block.text}
                      onFocus={() => sendCursor({ blockId: block.id, offset: 0 })}
                      onBlur={() => sendCursor(null)}
                      onChange={(e) => handleBlockChange(block.id, e.target.value)}
                      disabled={isReadOnly}
                      rows={1}
                      className="border-0 focus-visible:ring-0 w-full min-h-[32px] p-0 bg-transparent text-foreground resize-none text-sm placeholder-muted-foreground/50 shadow-none leading-relaxed"
                      placeholder="Type '/' or click menu to change type..."
                    />
                  )}

                  {block.type === "todo" && (
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={block.checked || false}
                        disabled={isReadOnly}
                        onChange={(e) => handleCheckboxChange(block.id, e.target.checked)}
                        className="rounded border-muted/50 bg-background text-primary focus:ring-primary h-4 w-4"
                      />
                      <input
                        type="text"
                        value={block.text}
                        onFocus={() => sendCursor({ blockId: block.id, offset: 0 })}
                        onBlur={() => sendCursor(null)}
                        onChange={(e) => handleBlockChange(block.id, e.target.value)}
                        disabled={isReadOnly}
                        className={`text-sm border-0 focus:outline-none w-full bg-transparent text-foreground placeholder-muted-foreground/50 ${
                          block.checked ? "line-through text-muted-foreground/60" : ""
                        }`}
                        placeholder="Todo checklist item"
                      />
                    </div>
                  )}

                  {block.type === "code" && (
                    <textarea
                      value={block.text}
                      onFocus={() => sendCursor({ blockId: block.id, offset: 0 })}
                      onBlur={() => sendCursor(null)}
                      onChange={(e) => handleBlockChange(block.id, e.target.value)}
                      disabled={isReadOnly}
                      className="font-mono text-xs w-full p-3 bg-muted/60 border border-muted/50 rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary h-24 resize-none leading-relaxed"
                      placeholder="// Write code here..."
                    />
                  )}
                </div>

                {/* Collaborative Cursor Indicator Tags */}
                {collaborators.filter((c) => c.cursor?.blockId === block.id).length > 0 && (
                  <div className="flex flex-col gap-1 items-end ml-2 self-center shrink-0">
                    {collaborators
                      .filter((c) => c.cursor?.blockId === block.id)
                      .map((c) => (
                        <Badge
                          key={c.socketId}
                          variant="outline"
                          className="text-[9px] py-0.5 px-1.5 gap-1 select-none animate-fade-in"
                          style={{
                            color: getCollaboratorColor(c.userId),
                            borderColor: getCollaboratorColor(c.userId) + "30",
                            backgroundColor: getCollaboratorColor(c.userId) + "08",
                          }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: getCollaboratorColor(c.userId) }}
                          />
                          {c.name}
                          {c.typing && <span className="animate-pulse">✍️</span>}
                        </Badge>
                      ))}
                  </div>
                )}

                {/* Inline AI autocomplete and delete actions */}
                {!isReadOnly && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 self-center">
                    {block.text && (
                      <button
                        onClick={() => handleAIAutocomplete(block.id)}
                        className="p-1 hover:bg-muted text-primary hover:text-primary rounded"
                        title="AI Autocomplete Next Sentence"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteBlock(block.id)}
                      className="p-1 hover:bg-red-500/10 text-muted-foreground hover:text-red-500 rounded"
                      title="Delete Block"
                    >
                      <Trash className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleAddBlock(idx)}
                      className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded"
                      title="Add Block Below"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {!isReadOnly && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleAddBlock(blocks.length - 1)}
              className="mt-4 gap-1.5 w-full max-w-[140px] text-xs h-8 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Block
            </Button>
          )}
        </main>

        {/* Dynamic Sidebar panels */}

        {/* 1. Share / Collaborators Sidebar */}
        {activeSidebar === "share" && (
          <aside className="w-80 border-l bg-card/65 backdrop-blur-sm p-5 flex flex-col justify-between overflow-y-auto">
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-bold text-foreground">Sharing & Access</h2>
                <p className="text-xs text-muted-foreground mt-1">Configure who can edit or view this document.</p>
              </div>

              {/* Visibility selection */}
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Document Visibility</Label>
                <div className="flex gap-2">
                  <Button
                    variant={visibility === "PRIVATE" ? "default" : "outline"}
                    size="sm"
                    className="flex-1 text-xs gap-1 cursor-pointer"
                    disabled={isReadOnly}
                    onClick={() => handleVisibilityChange("PRIVATE")}
                  >
                    <Lock className="h-3 w-3" />
                    Private
                  </Button>
                  <Button
                    variant={visibility === "SHARED" ? "default" : "outline"}
                    size="sm"
                    className="flex-1 text-xs gap-1 cursor-pointer"
                    disabled={isReadOnly}
                    onClick={() => handleVisibilityChange("SHARED")}
                  >
                    <Users className="h-3 w-3" />
                    Shared
                  </Button>
                  <Button
                    variant={visibility === "PUBLIC" ? "default" : "outline"}
                    size="sm"
                    className="flex-1 text-xs gap-1 cursor-pointer"
                    disabled={isReadOnly}
                    onClick={() => handleVisibilityChange("PUBLIC")}
                  >
                    <Globe className="h-3 w-3" />
                    Public
                  </Button>
                </div>
              </div>

              {/* Add collaborator form */}
              {!isReadOnly && (
                <form onSubmit={handleAddCollaborator} className="space-y-3 pt-4 border-t">
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Add Collaborator</Label>
                  <Input
                    type="email"
                    placeholder="collab@example.com"
                    value={newCollabEmail}
                    onChange={(e) => setNewCollabEmail(e.target.value)}
                    required
                    className="h-8 text-xs bg-background/50"
                  />
                  <div className="flex items-center gap-2">
                    <select
                      value={newCollabRole}
                      onChange={(e) => setNewCollabRole(e.target.value as any)}
                      className="text-xs border rounded p-1.5 h-8 bg-background flex-1 focus:outline-none"
                    >
                      <option value="EDITOR">Editor (Can edit)</option>
                      <option value="VIEWER">Viewer (Read-only)</option>
                    </select>
                    <Button type="submit" size="sm" className="h-8 text-xs">
                      Invite
                    </Button>
                  </div>
                </form>
              )}

              {/* Collaborators List */}
              <div className="space-y-3 pt-4 border-t">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Collaborators</Label>
                <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                  {invitedCollaborators.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No collaborators invited yet.</p>
                  ) : (
                    invitedCollaborators.map((collab) => (
                      <div key={collab.id} className="flex items-center justify-between text-xs p-2 rounded-lg bg-muted/40 border border-muted/30">
                        <div className="min-w-0">
                          <p className="font-semibold truncate text-foreground">{collab.user.name || "Collaborator"}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{collab.user.email}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[9px] py-0">{collab.role}</Badge>
                          {!isReadOnly && (
                            <button
                              onClick={() => handleRemoveCollaborator(collab.user.id)}
                              className="text-muted-foreground hover:text-red-500"
                              title="Remove"
                            >
                              <Trash className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-6 text-xs w-full"
              onClick={() => setActiveSidebar("none")}
            >
              Close
            </Button>
          </aside>
        )}

        {/* 2. Version History Sidebar */}
        {activeSidebar === "history" && (
          <aside className="w-80 border-l bg-card/65 backdrop-blur-sm p-5 flex flex-col justify-between overflow-y-auto">
            <div className="space-y-6 flex-1 flex flex-col min-h-0">
              <div>
                <h2 className="text-base font-bold text-foreground">Timeline Checklist</h2>
                <p className="text-xs text-muted-foreground mt-1">Review older checkpoints and restore past states safely.</p>
              </div>

              {/* Create Snapshot Checkpoint */}
              {!isReadOnly && (
                <form onSubmit={handleCreateSnapshot} className="space-y-2.5 border-b pb-4">
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Save Checkpoint</Label>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      placeholder="Snapshot Title..."
                      value={newSnapshotTitle}
                      onChange={(e) => setNewSnapshotTitle(e.target.value)}
                      required
                      className="h-8 text-xs bg-background/50"
                    />
                    <Button type="submit" size="sm" className="h-8 text-xs">
                      Save
                    </Button>
                  </div>
                </form>
              )}

              {/* Timeline versions list */}
              <div className="flex-1 flex flex-col min-h-0">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2.5">Historical Checkpoints</Label>
                <ScrollArea className="flex-1 pr-1.5">
                  <div className="space-y-3">
                    {versions.map((ver) => (
                      <div
                        key={ver.id}
                        onClick={() => setPreviewVersion(ver)}
                        className={`p-3 rounded-lg border text-xs cursor-pointer transition-all duration-200 ${
                          previewVersion?.id === ver.id
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "border-muted/50 hover:bg-muted/40"
                        }`}
                      >
                        <div className="flex items-center justify-between font-bold mb-1 text-foreground">
                          <span>v{ver.version}: {ver.title}</span>
                          <Badge variant="secondary" className="text-[8px] py-0">Active</Badge>
                        </div>
                        {(() => {
                          const parts = ver.summary?.split(" | Hash: ") || [];
                          const baseSummary = parts[0] || "Automatic check";
                          const hash = parts[1];
                          return (
                            <>
                              <p className="text-[10px] text-muted-foreground italic truncate mb-1">
                                {baseSummary}
                              </p>
                              {hash && (
                                <p className="text-[8px] font-mono text-muted-foreground/60 select-all truncate mt-1 bg-muted/50 p-1 rounded" title={`SHA-256 Hash: ${hash}`}>
                                  SHA-256: {hash}
                                </p>
                              )}
                            </>
                          );
                        })()}
                        <div className="flex justify-between items-center text-[10px] text-muted-foreground/80 mt-2">
                          <span>By: {ver.createdBy}</span>
                          <span>{new Date(ver.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </div>

            {/* Version Preview Modal */}
            {previewVersion && (
              <Dialog open={!!previewVersion} onOpenChange={() => setPreviewVersion(null)}>
                <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col bg-card">
                  <DialogHeader>
                    <DialogTitle>Preview Checkpoint v{previewVersion.version}: "{previewVersion.title}"</DialogTitle>
                    <DialogDescription>
                      Created by {previewVersion.createdBy} on {new Date(previewVersion.createdAt).toLocaleString()}.
                    </DialogDescription>
                  </DialogHeader>

                   <ScrollArea className="flex-1 my-4 border p-4 rounded-lg bg-muted/20">
                    <div className="space-y-4">
                      {(() => {
                        const previewBlocks = (previewVersion.content as any)?.blocks || [];
                        const currentBlockMap = new Map(blocks.map((b) => [b.id, b]));
                        const previewBlockMap = new Map(previewBlocks.map((b: any) => [b.id, b]));

                        const combined: Array<{ block: any; status: "same" | "modified" | "deleted" | "added"; currentBlock?: any }> = [];

                        // 1. Add all blocks from preview, marking if same, modified, or deleted in current document
                        previewBlocks.forEach((pb: any) => {
                          const cb = currentBlockMap.get(pb.id);
                          if (!cb) {
                            combined.push({ block: pb, status: "deleted" });
                          } else {
                            const isDiff = pb.text !== cb.text || pb.type !== cb.type || pb.checked !== cb.checked;
                            combined.push({ block: pb, status: isDiff ? "modified" : "same", currentBlock: cb });
                          }
                        });

                        // 2. Add all blocks from current that do not exist in preview, marking them as added in current
                        blocks.forEach((cb) => {
                          if (!previewBlockMap.has(cb.id)) {
                            combined.push({ block: cb, status: "added" });
                          }
                        });

                        return combined.map(({ block: b, status, currentBlock }) => {
                          const bgClass =
                            status === "added"
                              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-700"
                              : status === "deleted"
                              ? "bg-red-500/10 border-red-500/20 text-red-600 line-through"
                              : status === "modified"
                              ? "bg-amber-500/10 border-amber-500/20 text-amber-800"
                              : "border-transparent text-foreground";

                          const statusLabel =
                            status === "added"
                              ? " [Added in active]"
                              : status === "deleted"
                              ? " [Deleted in active]"
                              : status === "modified"
                              ? " [Modified]"
                              : "";

                          return (
                            <div key={b.id} className={`p-3 border rounded-lg transition-all ${bgClass}`}>
                              <div className="flex items-center justify-between gap-2 mb-1.5 border-b border-muted-foreground/10 pb-1">
                                <span className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground/80">
                                  {b.type} {statusLabel}
                                </span>
                              </div>

                              {b.type.startsWith("heading") ? (
                                <p className="font-bold text-base">{b.text}</p>
                              ) : b.type === "todo" ? (
                                <div className="flex items-center gap-2 text-sm">
                                  <input type="checkbox" checked={b.checked || false} readOnly disabled />
                                  <span className={b.checked ? "line-through opacity-70" : ""}>{b.text}</span>
                                </div>
                              ) : b.type === "code" ? (
                                <pre className="font-mono text-xs p-2 bg-background/60 border rounded leading-relaxed overflow-x-auto">{b.text}</pre>
                              ) : (
                                <p className="text-sm leading-relaxed">{b.text}</p>
                              )}

                              {status === "modified" && currentBlock && (
                                <div className="mt-2.5 pt-2 border-t border-amber-500/20 text-xs text-muted-foreground space-y-1">
                                  <p className="font-semibold uppercase tracking-wider text-[8px] text-amber-700">Active Current Value:</p>
                                  <p className="text-foreground italic">
                                    {currentBlock.text || <span className="text-muted-foreground font-light">Empty content</span>}
                                  </p>
                                </div>
                              )}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </ScrollArea>

                  <DialogFooter>
                    <Button variant="outline" onClick={() => setPreviewVersion(null)} className="h-9 text-xs">
                      Close Preview
                    </Button>
                    {!isReadOnly && (
                      <Button
                        onClick={() => handleRestoreVersion(previewVersion.id)}
                        className="h-9 text-xs gap-1.5"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Restore to Current State
                      </Button>
                    )}
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}

            <Button
              variant="outline"
              size="sm"
              className="mt-6 text-xs w-full cursor-pointer"
              onClick={() => setActiveSidebar("none")}
            >
              Close History
            </Button>
          </aside>
        )}

        {/* 3. AI Assistant Sidebar */}
        {activeSidebar === "ai" && (
          <aside className="w-80 border-l bg-card/65 backdrop-blur-sm p-5 flex flex-col justify-between overflow-y-auto">
            <div className="space-y-6 flex-1 flex flex-col min-h-0">
              <div>
                <h2 className="text-base font-bold text-foreground">AI Assistant</h2>
                <p className="text-xs text-muted-foreground mt-1">Accelerate writing, tone shifting, and content summaries.</p>
              </div>

              {/* Tabs for AI features */}
              <Tabs defaultValue="actions" className="flex-1 flex flex-col min-h-0">
                <TabsList className="grid grid-cols-2 h-9">
                  <TabsTrigger value="actions" className="text-xs">Quick Tools</TabsTrigger>
                  <TabsTrigger value="chat" className="text-xs">Doc Chat</TabsTrigger>
                </TabsList>

                {/* Quick Tools */}
                <TabsContent value="actions" className="space-y-4 pt-4 flex-1 overflow-y-auto">
                  {/* Summary trigger */}
                  <div className="p-3 border rounded-lg bg-muted/20 border-muted/50 space-y-2">
                    <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 text-primary" />
                      Document Summary
                    </p>
                    <p className="text-[11px] text-muted-foreground">Generates a concise markdown bullet list summary directly into the description.</p>
                    <Button
                      onClick={handleAISummarize}
                      size="sm"
                      disabled={isReadOnly}
                      className="w-full text-xs h-8 gap-1.5 cursor-pointer mt-1"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Generate Summary
                    </Button>
                  </div>

                  {/* Tone rewrites instructions */}
                  {!isReadOnly && (
                    <div className="p-3 border rounded-lg bg-muted/20 border-muted/50 space-y-2">
                      <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-primary" />
                        Tone Rewriter
                      </p>
                      <p className="text-[11px] text-muted-foreground">Shift active blocks text to professional, witty, simple, or marketing-friendly copy.</p>

                      <div className="space-y-1.5">
                        <Label className="text-[10px] uppercase font-bold text-muted-foreground/80">Select Target Tone</Label>
                        <select
                          value={aiTone}
                          onChange={(e) => setAiTone(e.target.value)}
                          className="w-full text-xs p-1.5 border rounded bg-background"
                        >
                          <option value="professional">Professional</option>
                          <option value="casual and friendly">Casual</option>
                          <option value="witty and engaging">Witty</option>
                          <option value="simple and clear (elaboration)">Simple</option>
                          <option value="persuasive marketing">Marketing</option>
                        </select>
                      </div>

                      <div className="space-y-1.5 pt-2">
                        <Label className="text-[10px] uppercase font-bold text-muted-foreground/80">Choose Block to Apply</Label>
                        <div className="space-y-1 max-h-[140px] overflow-y-auto pr-1">
                          {blocks.filter((b) => b.text).map((b) => (
                            <button
                              key={b.id}
                              onClick={() => handleAIToneShift(b.id, aiTone)}
                              className="w-full text-left truncate p-1.5 border rounded hover:bg-muted text-[10px] text-muted-foreground"
                            >
                              "{b.text}"
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </TabsContent>

                {/* Doc Chat */}
                <TabsContent value="chat" className="pt-4 flex-1 flex flex-col min-h-0 space-y-3 justify-between">
                  <ScrollArea className="flex-1 bg-muted/30 border rounded-lg p-3 max-h-[300px]">
                    <div className="space-y-3.5">
                      {aiChatHistory.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic text-center py-6">
                          Ask questions about your document context. e.g. "What is the key theme of my writing?"
                        </p>
                      ) : (
                        aiChatHistory.map((msg, idx) => (
                          <div key={idx} className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}>
                            <span className="text-[9px] uppercase font-bold text-muted-foreground tracking-wider mb-0.5">
                              {msg.sender === "user" ? "You" : "Assistant"}
                            </span>
                            <div
                              className={`p-2.5 rounded-lg text-xs leading-relaxed max-w-[90%] ${
                                msg.sender === "user"
                                  ? "bg-primary text-primary-foreground rounded-tr-none"
                                  : "bg-muted border border-muted/50 rounded-tl-none text-foreground"
                              }`}
                            >
                              {msg.text}
                            </div>
                          </div>
                        ))
                      )}

                      {aiLoading && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground italic pl-1">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Analyzing document details...
                        </div>
                      )}
                    </div>
                  </ScrollArea>

                  {/* Chat Input form */}
                  <form onSubmit={handleAIChat} className="flex gap-2">
                    <Input
                      type="text"
                      placeholder="Ask AI..."
                      value={aiChatQuery}
                      onChange={(e) => setAiChatQuery(e.target.value)}
                      className="h-8 text-xs bg-background/50 flex-1"
                    />
                    <Button type="submit" size="sm" className="h-8 px-3 cursor-pointer" disabled={aiLoading || !aiChatQuery}>
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="mt-6 text-xs w-full cursor-pointer"
              onClick={() => setActiveSidebar("none")}
            >
              Close AI
            </Button>
          </aside>
        )}
      </div>

      {/* Conflict Resolution Choice Modal */}
      {conflictData && (
        <ConflictDialog
          isOpen={conflictOpen}
          onClose={() => setConflictOpen(false)}
          onResolve={(choice) => {
            setConflictOpen(false);
            resolveConflictChoice(choice, conflictData);
          }}
          serverVersion={conflictData.serverVersion}
          clientVersion={conflictData.clientVersion}
          conflictData={conflictData}
        />
      )}
    </div>
  );
}

function getCollaboratorColor(userId: string) {
  const colors = ["#3b82f6", "#10b981", "#6366f1", "#8b5cf6", "#ec4899", "#f97316"];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}