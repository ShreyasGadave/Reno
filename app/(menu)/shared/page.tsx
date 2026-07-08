"use client";

import AllDocuments from "@/components/elements/allDocuments";

export default function SharedPage() {
  return (
    <div className="container mx-auto">
      <AllDocuments filter="shared" />
    </div>
  );
}