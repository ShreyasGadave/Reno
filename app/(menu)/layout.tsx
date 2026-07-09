import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/custom/app-sidebar"

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
   <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="flex flex-col min-h-screen">
        <header className="flex items-center gap-2 border-b px-4 py-3 bg-card">
          <SidebarTrigger className="cursor-pointer" />
          <div className="flex-1" />
        </header>
        <main className="px-6 pt-6">
          {children}
        </main>
     
      </SidebarInset>
    </SidebarProvider>
  )
}