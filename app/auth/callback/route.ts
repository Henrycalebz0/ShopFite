import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export async function GET(request:NextRequest){
  const code=request.nextUrl.searchParams.get("code");
  const destination=request.nextUrl.searchParams.get("next") ?? "/";
  const safePath=destination.startsWith("/") && !destination.startsWith("//") ? destination : "/";
  // Railway forwards requests to Next.js on an internal localhost port. Always use
  // the configured public site URL for redirects so OAuth cannot return to that port.
  const siteOrigin=(process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin).replace(/\/$/,"");
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
