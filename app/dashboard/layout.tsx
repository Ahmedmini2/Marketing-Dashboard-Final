import { Nav } from "@/components/nav";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Nav />
      <main className="flex-1 p-6 space-y-6 max-w-[1500px]">{children}</main>
    </div>
  );
}
