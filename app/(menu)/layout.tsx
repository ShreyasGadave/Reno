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
        <main className="flex-1 p-6">
          {children}
        </main>
        <footer className="mt-auto border-t py-4 text-center text-xs text-muted-foreground bg-muted/20">
          <div className="container mx-auto flex flex-col sm:flex-row items-center justify-between px-6 gap-2">
            <span>DocFlow Editor • Fullstack Assignment 2</span>
            <span className="flex items-center gap-2.5">
              <span>Developer: <strong>Shreyas Gadave</strong></span>
              <span className="text-muted-foreground/45">•</span>
              <a href="https://github.com/ShreyasGadave" target="_blank" rel="noopener noreferrer" className="hover:text-primary hover:underline font-semibold">GitHub</a>
              <span className="text-muted-foreground/45">•</span>
              <a href="https://linkedin.com/in/shreyas-gadave" target="_blank" rel="noopener noreferrer" className="hover:text-primary hover:underline font-semibold">LinkedIn</a>
            </span>
          </div>
        </footer>
      </SidebarInset>
    </SidebarProvider>
  )
}