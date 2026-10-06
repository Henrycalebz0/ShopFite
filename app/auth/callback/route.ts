import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

function publicOrigin(request: NextRequest) {
  // On Railway, `request.nextUrl.origin` is the internal Next.js listener
  // (localhost). The proxy headers retain the address the customer used.
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwardedHost && /^[a-z0-9.-]+(?::\d+)?$/i.test(forwardedHost)) {
    return `${forwardedProtocol === "http" ? "http" : "https"}://${forwardedHost}`;
  }

  return (process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin).replace(/\/$/, "");
}

export async function GET(request:NextRequest){
  const code=request.nextUrl.searchParams.get("code");
  const destination=request.nextUrl.searchParams.get("next") ?? "/";
  const safePath=destination.startsWith("/") && !destination.startsWith("//") ? destination : "/";
  const siteOrigin=publicOrigin(request);
  const redirect=(path:string)=>NextResponse.redirect(new URL(path,siteOrigin));
  if(code){
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL, key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if(!url || !key) return redirect("/?auth=not-configured");
    const response=redirect(safePath);
    const supabase=createServerClient(url,key,{cookies:{getAll:()=>request.cookies.getAll(),setAll:(cookies:{name:string;value:string;options:CookieOptions}[])=>cookies.forEach(({name,value,options})=>response.cookies.set(name,value,options))}});
    await supabase.auth.exchangeCodeForSession(code);
    return response;
  }
  return redirect("/");
}
