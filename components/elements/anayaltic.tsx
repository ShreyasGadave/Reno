"use client";

import { useEffect, useState } from "react";
import { FileText, Users, Star, Archive, Trash2, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../ui/card";

interface Stats {
  totalOwned: number;
  sharedWithMe: number;
  favorites: number;
  archived: number;
  trash: number;
}

const Analytic = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setStats(data.stats);
        }
      })
      .catch((err) => console.error("Error loading stats:", err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const cards = [
    {
      title: "Total Documents",
      count: stats?.totalOwned ?? 0,
      icon: FileText,
      color: "text-blue-500 bg-blue-500/10",
    },
    {
      title: "Shared With Me",
      count: stats?.sharedWithMe ?? 0,
      icon: Users,
      color: "text-green-500 bg-green-500/10",
    },
    {
      title: "Favorites",
      count: stats?.favorites ?? 0,
      icon: Star,
      color: "text-yellow-500 bg-yellow-500/10",
    },
    {
      title: "Archived",
      count: stats?.archived ?? 0,
      icon: Archive,
      color: "text-purple-500 bg-purple-500/10",
    },
    {
      title: "Trash",
      count: stats?.trash ?? 0,
      icon: Trash2,
      color: "text-red-500 bg-red-500/10",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard Overview</h1>
        <p className="text-muted-foreground">
          Quick summary of your collaborative documents.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((item, idx) => {
          const Icon = item.icon;

          return (
            <Card key={idx} className="overflow-hidden border-muted/50 shadow-sm hover:shadow-md transition-all duration-300">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {item.title}
                </CardTitle>
                <div className={`p-2 rounded-lg ${item.color}`}>
                  <Icon className="h-4 w-4" />
                </div>
              </CardHeader>

              <CardContent className="pt-2">
                <p className="text-3xl font-bold tracking-tight text-foreground">{item.count}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default Analytic;