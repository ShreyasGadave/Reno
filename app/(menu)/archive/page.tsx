"use client";

import AllDocuments from "@/components/elements/allDocuments";

export default function ArchivePage() {
  return (
    <div className="container mx-auto">
      <AllDocuments filter="archive" />
    </div>
  );
}