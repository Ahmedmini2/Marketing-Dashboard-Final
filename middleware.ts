import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(items: { name: string; value: string; options: CookieOptions }[]) {
          items.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: request.headers } });
          items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const url = request.nextUrl;
  const isAuthRoute = url.pathname.startsWith("/login");
  const isPublic =
    isAuthRoute ||
    url.pathname.startsWith("/api/cron") ||
    url.pathname.startsWith("/api/auth") ||
    url.pathname.startsWith("/api/sync");

  if (!user && !isPublic) {
    const redirect = url.clone();
    redirect.pathname = "/login";
    redirect.searchParams.set("next", url.pathname);
    return NextResponse.redirect(redirect);
  }
  if (user && isAuthRoute) {
    const redirect = url.clone();
    redirect.pathname = "/dashboard";
    return NextResponse.redirect(redirect);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.svg).*)"],
};
