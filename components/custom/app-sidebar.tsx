"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

import {
  Home,
  FileText,
  Users,
  Star,
  Archive,
  Trash2,
  Settings,
  User,
  LogOut,
} from "lucide-react";

// Menu items configuration
const menuItems = [
  {
    title: "Dashboard",
    href: "/dashboard",
    icon: Home,
  },
  {
    title: "My Documents",
    href: "/documents",
    icon: FileText,
  },
  {
    title: "Shared With Me",
    href: "/shared",
    icon: Users,
  },
  {
    title: "Favorites",
    href: "/favorites",
    icon: Star,
  },
  {
    title: "Archive",
    href: "/archive",
    icon: Archive,
  },
  {
    title: "Trash",
    href: "/trash",
    icon: Trash2,
  },
];
export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ name?: string; email: string } | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setUser(data.user);
        }
      })
      .catch((err) => console.error("Error fetching me:", err));
  }, []);

  const handleLogout = async () => {
    try {
      const res = await fetch("/api/auth/signout", { method: "POST" });
      if (res.ok) {
        toast.success("Signed out successfully");
        router.push("/signin");
        router.refresh();
      } else {
        toast.error("Logout failed");
      }
    } catch (err) {
      console.error(err);
      toast.error("An error occurred during logout");
    }
  };

  return (
    <Sidebar>
      <SidebarHeader className="border-b bg-card">
        <div className="flex items-center gap-2 px-4 py-3">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-primary-foreground font-bold shadow-md shadow-primary/20">
            D
          </div>
          <div>
            <p className="font-semibold text-sm tracking-tight text-foreground">DocFlow</p>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Collaborate • Create
            </p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="bg-card/50">
        {/* Workspace Group */}
        <SidebarGroup>
          <SidebarGroupLabel className="px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/75">
            Workspace
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="px-2 space-y-0.5">
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    isActive={
                      item.href === "/"
                        ? pathname === "/"
                        : pathname.startsWith(item.href)
                    }
                    className={`gap-x-4 h-9 px-3 rounded-md transition-all duration-200 ${
                      pathname.startsWith(item.href)
                        ? "bg-primary/10 text-primary font-semibold"
                        : "hover:bg-muted/80 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Link href={item.href} prefetch className="flex items-center gap-3 w-full">
                      <item.icon className={`size-4 ${pathname.startsWith(item.href) ? "text-primary" : ""}`} />
                      <span className="text-sm">{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t bg-card p-3">
        {user ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3 px-2 py-1.5 rounded-lg bg-muted/30">
              <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs uppercase">
                {user.name ? user.name[0] : user.email[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground truncate">
                  {user.name || "User"}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {user.email}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="w-full justify-start gap-2 h-8 text-xs font-medium text-destructive hover:text-destructive hover:bg-destructive/10 cursor-pointer"
            >
              <LogOut className="size-3.5" />
              Sign Out
            </Button>
          </div>
        ) : (
          <div className="text-center py-2">
            <Link href="/signin">
              <Button size="sm" className="w-full text-xs">
                Sign In
              </Button>
            </Link>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
