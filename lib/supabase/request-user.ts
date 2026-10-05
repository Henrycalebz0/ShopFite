import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export async function getRequestUser(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const { data, error } = await supabaseAdmin().auth.getUser(authorization.slice(7));
    return error ? null : data.user;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const cookieStore = await cookies();
  const client = createServerClient(url, key, {
    cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} },
  });
  const { data, error } = await client.auth.getUser();
  return error ? null : data.user;
}
