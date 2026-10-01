import { createBrowserClient } from "@supabase/ssr";
export function supabaseBrowser() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL, key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!url || !key) throw new Error("Supabase browser credentials are not configured.");
  return createBrowserClient(url,key);
}
