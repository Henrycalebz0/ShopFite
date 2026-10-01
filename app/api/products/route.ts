import { NextResponse } from "next/server";
import { fallbackProducts } from "@/lib/products";
import { supabaseAdmin } from "@/lib/supabase/server";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin().from("products").select("id,name,category,description,price_cents,image_url,badge,inventory_count").eq("active", true).order("featured", { ascending:false });
    if (error) throw error;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(fallbackProducts, { headers: { "X-Catalog-Source":"demo-fallback" } });
  }
}
