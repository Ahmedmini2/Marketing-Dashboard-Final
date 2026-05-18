"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { BarChart3, Megaphone, Users2, Building2, Settings, LogOut } from "lucide-react";

const links = [
  { href: "/dashboard", label: "Overview", icon: BarChart3 },
  { href: "/dashboard/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/dashboard/agents", label: "Agents", icon: Users2 },
  { href: "/dashboard/teams", label: "Teams", icon: Building2 },
  { href: "/dashboard/settings/integrations", label: "Integrations", icon: Settings },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <aside className="w-60 shrink-0 border-r border-border bg-panel h-screen sticky top-0 flex flex-col">
      <div className="px-5 py-4 border-b border-border">
        <div className="font-semibold">Marketing</div>
        <div className="text-xs text-muted">Meta × Salesforce</div>
      </div>
      <nav className="px-2 py-3 space-y-1 flex-1">
        {links.map((l) => {
          const active = pathname === l.href || (l.href !== "/dashboard" && pathname.startsWith(l.href));
          const Icon = l.icon;
          return (
            <Link key={l.href} href={l.href} prefetch
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
                active ? "bg-white/10 text-text" : "text-muted hover:bg-white/5 hover:text-text"
              )}>
              <Icon size={16} /> {l.label}
            </Link>
          );
        })}
      </nav>
      <form action="/api/auth/signout" method="post" className="p-2 border-t border-border">
        <button className="btn w-full justify-center"><LogOut size={14}/> Sign out</button>
      </form>
    </aside>
  );
}
