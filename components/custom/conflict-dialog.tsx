"use client";

import React from "react";
import { AlertTriangle, Server, User, GitMerge, Clock, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ConflictData {
  hasConflict?: boolean;
  documentId?: string;
  conflictingUser?: {
    name: string;
    updatedAt: string;
  };
  localVersion: number;
  serverVersion: number;
  modifiedBlocks?: Array<{
    blockId: string;
    type: string;
    localContent: string;
    remoteContent: string;
  }>;
  serverTitle?: string;
  serverContent?: any;
  serverUpdatedAt?: string;
}

interface ConflictDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onResolve: (choice: "server" | "client" | "merge") => void;
  serverVersion: number;
  clientVersion: number;
  conflictData: ConflictData;
}

function formatRelativeTime(dateStr?: string): string {
  if (!dateStr) return "recently";
  const date = new Date(dateStr);
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString();
}

export function ConflictDialog({
  isOpen,
  onClose,
  onResolve,
  serverVersion,
  clientVersion,
  conflictData,
}: ConflictDialogProps) {
  const collaboratorName = conflictData?.conflictingUser?.name || "Another Collaborator";
  const initials = collaboratorName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase() || "AC";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()} >
      <DialogContent className="min-w-3xl bg-card shadow-2xl border-destructive/20 max-h-[90vh] flex flex-col">
        <DialogHeader className="space-y-3">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5.5 w-5.5 animate-pulse" />
          </div>
          <DialogTitle className="text-xl text-center font-bold text-foreground">
            Conflict Detected
          </DialogTitle>
          <DialogDescription className="text-center text-xs text-muted-foreground leading-relaxed max-w-lg mx-auto">
            Another collaborator modified this document while you were editing. 
            Choose which changes you would like to keep below.
          </DialogDescription>
        </DialogHeader>

        {/* Collaborator details header card */}
        <div className="flex items-center gap-3.5 p-3 rounded-lg border bg-muted/30 text-xs mt-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm tracking-wide">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-foreground text-sm truncate">{collaboratorName}</p>
            <div className="flex items-center gap-2 text-muted-foreground text-[10px] mt-0.5">
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Last updated: {formatRelativeTime(conflictData?.conflictingUser?.updatedAt)}</span>
              <span>•</span>
              <span className="flex items-center gap-1"><FileText className="h-3 w-3" /> Server version: v{serverVersion} (Local: v{clientVersion})</span>
            </div>
          </div>
        </div>

        {/* Conflicting block visual difference section */}
        {conflictData?.modifiedBlocks && conflictData.modifiedBlocks.length > 0 && (
          <div className="space-y-3 my-3 flex-1 overflow-hidden flex flex-col min-h-0">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
              Conflicting Content Sections ({conflictData.modifiedBlocks.length})
            </p>
            <div className="space-y-3.5 overflow-y-auto flex-1 pr-1 border rounded-lg p-3 bg-muted/10">
              {conflictData.modifiedBlocks.map((block) => (
                <div key={block.blockId} className="space-y-2 border-b border-muted pb-3.5 last:border-b-0 last:pb-0">
                  <div className="mb-1">
                    <span className="text-[9px] font-mono bg-muted p-1 rounded font-semibold text-muted-foreground uppercase tracking-wide">
                      Block type: {block.type}
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3 text-xs pt-1">
                    <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 space-y-1">
                      <span className="font-bold text-[9px] uppercase tracking-wider text-amber-700 block">Your Changes</span>
                      <p className="text-foreground leading-relaxed whitespace-pre-wrap select-text italic">
                        {block.localContent || <span className="text-muted-foreground font-light select-none">[Empty content]</span>}
                      </p>
                    </div>
                    
                    <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 space-y-1">
                      <span className="font-bold text-[9px] uppercase tracking-wider text-emerald-700 block">{collaboratorName}'s Changes</span>
                      <p className="text-foreground leading-relaxed whitespace-pre-wrap select-text italic">
                        {block.remoteContent || <span className="text-muted-foreground font-light select-none">[Empty content]</span>}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Choice Buttons */}
        <div className="space-y-2.5 my-2.5 overflow-y-auto max-h-[220px] pr-1">
          <button
            onClick={() => onResolve("merge")}
            className="w-full flex items-center justify-between p-3 rounded-lg border border-primary/20 hover:border-primary bg-primary/5 hover:bg-primary/10 transition-all duration-200 text-left group cursor-pointer"
          >
            <div className="flex gap-3 items-start">
              <div className="p-2 rounded bg-primary/15 text-primary mt-0.5 group-hover:bg-primary/25 transition-colors">
                <GitMerge className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-foreground">Merge Both Versions (Recommended)</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-normal">
                  Automatically combines client and server edits block-by-block. 
                  Preserves both collaborators' updates without data loss.
                </p>
              </div>
            </div>
          </button>

          <button
            onClick={() => onResolve("server")}
            className="w-full flex items-center justify-between p-3 rounded-lg border border-muted/50 hover:border-foreground/30 bg-card hover:bg-muted/30 transition-all duration-200 text-left group cursor-pointer"
          >
            <div className="flex gap-3 items-start">
              <div className="p-2 rounded bg-muted text-muted-foreground mt-0.5 group-hover:bg-muted/80 transition-colors">
                <Server className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-foreground">Keep Collaborator Changes</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-normal">
                  Discard your local offline changes. Pull the latest server version containing {collaboratorName}'s edits.
                </p>
              </div>
            </div>
          </button>

          <button
            onClick={() => onResolve("client")}
            className="w-full flex items-center justify-between p-3 rounded-lg border border-muted/50 hover:border-foreground/30 bg-card hover:bg-muted/30 transition-all duration-200 text-left group cursor-pointer"
          >
            <div className="flex gap-3 items-start">
              <div className="p-2 rounded bg-muted text-muted-foreground mt-0.5 group-hover:bg-muted/80 transition-colors">
                <User className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-foreground">Keep My Changes</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-normal">
                  Force-save your local changes to the server, overwriting remote edits.
                </p>
              </div>
            </div>
          </button>
        </div>

        <DialogFooter className="sm:justify-center mt-2.5">
          <Button variant="ghost" onClick={onClose} className="h-8 text-xs font-semibold text-muted-foreground cursor-pointer">
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
