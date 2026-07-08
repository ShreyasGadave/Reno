"use client";

import AllDocuments from "@/components/elements/allDocuments";
import { Button } from "@/components/ui/button";
import { createDocument } from "@/services/document.service";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export default function NewDocumentButton() {
  const router = useRouter();

 

  return (
    <div className="container mx-auto space-y-8 ">
    
      <AllDocuments/>
    </div>
  );
}
