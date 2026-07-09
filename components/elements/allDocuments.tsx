"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText, Calendar, Clock, Star, Archive, Trash2, RotateCcw, AlertTriangle, Search } from "lucide-react";
import { createDocument, getAllDocument, updateDocument, deleteDocument } from "@/services/document.service";
import { localDB } from "@/lib/indexeddb";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import DocumentsSkeleton from "@/components/skeleton/DocumentsSkeleton";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface Document {
  id: string;
  title: string;
  description: string;
  visibility: string;
  status: string;
  wordCount: number;
  characterCount: number;
  isFavorite: boolean;
  isArchived: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  owner?: {
    name: string;
    email: string;
  };
}

export default function AllDocuments({ filter = "all" }: { filter?: string }) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const router = useRouter();

  const handleCreate = async () => {
    if (typeof window !== "undefined" && !navigator.onLine) {
      try {
        const tempId = `temp_${Date.now()}`;
        const tempDoc = {
          id: tempId,
          title: "Untitled Document",
          description: "",
          content: { blocks: [] },
          visibility: "PRIVATE" as const,
          status: "ACTIVE" as const,
          isFavorite: false,
          isArchived: false,
          isDeleted: false,
          version: 1,
          ownerId: "offline_user",
          updatedAt: new Date().toISOString(),
          localChangesCount: 1,
        };
        await localDB.saveDocument(tempDoc);

        // Queue creation sync op
        await localDB.enqueueSyncOp({
          id: `create_${Date.now()}`,
          documentId: tempId,
          action: "CREATE",
          payload: tempDoc,
          timestamp: Date.now(),
        });

        toast.info("Created document offline");
        router.push(`/document/${tempId}`);
      } catch (err) {
        console.error(err);
        toast.error("Failed to create document offline");
      }
      return;
    }

    try {
      const document = await createDocument();
      toast.success("Document created");
      router.push(`/document/${document.id}`);
    } catch {
      toast.error("Unable to create document");
    }
  };

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const data = await getAllDocument(filter);
      setDocuments(data);
    } catch (error) {
      console.error(error);
      toast.error("Failed to load documents");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, [filter]);

  const handleToggleFavorite = async (doc: Document, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await updateDocument(doc.id, { isFavorite: !doc.isFavorite });
      toast.success(doc.isFavorite ? "Removed from Favorites" : "Added to Favorites");
      fetchDocuments();
    } catch {
      toast.error("Failed to update favorite status");
    }
  };

  const handleToggleArchive = async (doc: Document, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const nextArchived = !doc.isArchived;
      await updateDocument(doc.id, {
        isArchived: nextArchived,
        status: nextArchived ? "ARCHIVED" : "ACTIVE"
      });
      toast.success(nextArchived ? "Document archived" : "Document restored from archive");
      fetchDocuments();
    } catch {
      toast.error("Failed to archive document");
    }
  };

  const handleToggleTrash = async (doc: Document, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const nextDeleted = !doc.isDeleted;
      await updateDocument(doc.id, {
        isDeleted: nextDeleted,
        status: nextDeleted ? "DELETED" : "ACTIVE"
      });
      toast.success(nextDeleted ? "Document moved to Trash" : "Document restored");
      fetchDocuments();
    } catch {
      toast.error("Failed to update trash status");
    }
  };

  const handlePermanentDelete = async (doc: Document, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Are you sure you want to permanently delete "${doc.title}"? This cannot be undone.`)) {
      return;
    }
    try {
      await deleteDocument(doc.id);
      toast.success("Document permanently deleted");
      fetchDocuments();
    } catch {
      toast.error("Failed to delete document permanently. (Owner only privilege)");
    }
  };

  // Filter local document array by search query
  const filteredDocs = documents.filter((doc) =>
    doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (doc.description && doc.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const getPageHeaderInfo = () => {
    switch (filter) {
      case "favorites":
        return { title: "Favorite Documents", desc: "Access your starred document entries." };
      case "archive":
        return { title: "Archived Documents", desc: "Review saved document records." };
      case "trash":
        return { title: "Trash Bin", desc: "Permanently delete or restore soft-deleted items." };
      case "shared":
        return { title: "Shared With Me", desc: "Collaborate on documents shared by others." };
      default:
        return { title: "My Documents", desc: "Manage and access all your documents." };
    }
  };

  const { title, desc } = getPageHeaderInfo();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {title}
          </h1>
          <p className="text-muted-foreground text-sm">
            {desc}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {filter === "all" && (
            <Button onClick={handleCreate} className="shadow-md shadow-primary/10">
              New Document
            </Button>
          )}
          <Button variant={"secondary"} className="shadow-md shadow-primary/10">
            {filteredDocs.length} Document
          </Button>
        </div>
      </div>

      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search documents by title or description..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 max-w-md bg-background/50 border-muted/50 focus-visible:ring-primary"
        />
      </div>

      {loading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <DocumentsSkeleton key={index} />
          ))}
        </div>
      ) : filteredDocs.length === 0 ? (
        <Card className="border-dashed border-2 bg-muted/20">
          <CardContent className="flex flex-col items-center justify-center gap-4 py-16">
            <FileText className="h-12 w-12 text-muted-foreground/50" />
            <p className="text-muted-foreground text-sm font-medium">No documents found matching the filter.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredDocs.map((doc) => (
            <Card
              key={doc.id}
              className="group flex flex-col justify-between overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1 border-muted/50 bg-card/60 backdrop-blur-sm relative"
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex gap-2">
                    <FileText className="h-8 w-8 text-primary/80 group-hover:text-primary transition-colors" />
                    {doc.owner && (
                      <div className="text-[10px] text-muted-foreground leading-tight">
                        <span className="block font-semibold">Owner:</span>
                        <span className="block truncate max-w-[80px]">{doc.owner.name}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    {/* Favorite action */}
                    {!doc.isDeleted && (
                      <button
                        onClick={(e) => handleToggleFavorite(doc, e)}
                        className={`p-1.5 rounded-md hover:bg-muted/80 transition-colors ${
                          doc.isFavorite ? "text-yellow-500" : "text-muted-foreground hover:text-foreground"
                        }`}
                        title={doc.isFavorite ? "Unfavorite" : "Favorite"}
                      >
                        <Star className={`h-4 w-4 ${doc.isFavorite ? "fill-yellow-400" : ""}`} />
                      </button>
                    )}

                    {/* Archive action */}
                    {!doc.isDeleted && filter !== "shared" && (
                      <button
                        onClick={(e) => handleToggleArchive(doc, e)}
                        className={`p-1.5 rounded-md hover:bg-muted/80 transition-colors ${
                          doc.isArchived ? "text-primary" : "text-muted-foreground hover:text-foreground"
                        }`}
                        title={doc.isArchived ? "Unarchive" : "Archive"}
                      >
                        <Archive className="h-4 w-4" />
                      </button>
                    )}

                    {/* Trash/Delete Action */}
                    {filter !== "shared" && (
                      <button
                        onClick={(e) => handleToggleTrash(doc, e)}
                        className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
                        title={doc.isDeleted ? "Restore" : "Move to Trash"}
                      >
                        {doc.isDeleted ? <RotateCcw className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
                      </button>
                    )}
                  </div>
                </div>

                <CardTitle className="truncate text-base font-bold text-foreground pt-2">
                  {doc.title}
                </CardTitle>

                <CardDescription className="line-clamp-2 text-xs h-8 text-muted-foreground">
                  {doc.description || "No description provided"}
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4 pt-0">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="text-[10px] py-0.5">
                    {doc.visibility}
                  </Badge>
                  <Badge className={`text-[10px] py-0.5 ${
                    doc.status === "ACTIVE" ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/25" :
                    doc.status === "ARCHIVED" ? "bg-purple-500/10 text-purple-500 hover:bg-purple-500/25" :
                    "bg-red-500/10 text-red-500 hover:bg-red-500/25"
                  }`}>
                    {doc.status}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs border-y border-muted/50 py-2.5">
                  <div>
                    <p className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground/75">Words</p>
                    <p className="font-semibold text-foreground">{doc.wordCount}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground/75">Characters</p>
                    <p className="font-semibold text-foreground">{doc.characterCount}</p>
                  </div>
                </div>

                <div className="space-y-1 text-[11px] text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-3 w-3" />
                    Created: {new Date(doc.createdAt).toLocaleDateString()}
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="h-3 w-3" />
                    Edited: {new Date(doc.updatedAt).toLocaleDateString()}
                  </div>
                </div>

                {doc.isDeleted ? (
                  <Button
                    onClick={(e) => handlePermanentDelete(doc, e)}
                    variant="destructive"
                    className="w-full text-xs h-8 gap-1"
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Delete Permanently
                  </Button>
                ) : (
                  <Link href={`/document/${doc.id}`} className="w-full">
                    <Button className="w-full text-xs h-8 shadow-sm cursor-pointer">Open Editor</Button>
                  </Link>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
