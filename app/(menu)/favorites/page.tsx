"use client";

import AllDocuments from "@/components/elements/allDocuments";

export default function FavoritesPage() {
  return (
    <div className="container mx-auto">
      <AllDocuments filter="favorites" />
    </div>
  );
}