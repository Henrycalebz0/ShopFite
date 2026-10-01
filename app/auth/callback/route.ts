import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function GET(request:NextRequest){
  const code=request.nextUrl.searchParams.get("code");
  const destination=request.nextUrl.searchParams.get("next") ?? "/";
  const safePath=destination.startsWith("/") && !destination.startsWith("//") ? destination : "/";
  if(code){
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL, key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if(!url || !key) return NextResponse.redirect(new URL("/?auth=not-configured",request.url));
    const response=NextResponse.redirect(new URL(safePath,request.url));
    const supabase=createServerClient(url,key,{cookies:{getAll:()=>request.cookies.getAll(),setAll:(cookies)=>cookies.forEach(({name,value,options})=>response.cookies.set(name,value,options))}});
    await supabase.auth.exchangeCodeForSession(code);
    return response;
  }
  return NextResponse.redirect(new URL("/",request.url));
}
