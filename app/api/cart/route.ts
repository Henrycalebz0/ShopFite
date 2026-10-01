import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
const schema=z.object({cartId:z.string().uuid(),items:z.array(z.object({id:z.string().min(1),quantity:z.number().int().min(1).max(20)})).max(40)});
export async function GET(request:NextRequest){
  const cartId=request.nextUrl.searchParams.get("cartId");
  if(!z.string().uuid().safeParse(cartId).success)return NextResponse.json({error:"Invalid cart id"},{status:400});
  try{const {data,error}=await supabaseAdmin().from("shopping_cart_items").select("product_id,quantity").eq("cart_id",cartId!);if(error)throw error;return NextResponse.json({items:(data??[]).map(line=>({id:line.product_id,quantity:line.quantity}))});}
  catch(error){console.error("Cart read failed",error);return NextResponse.json({error:"Cart database is unavailable"},{status:503});}
}
export async function PUT(request:NextRequest){
  const parsed=schema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:"Invalid cart"},{status:400});
  try{const {error}=await supabaseAdmin().rpc("save_shopfite_cart",{p_cart_id:parsed.data.cartId,p_items:parsed.data.items});if(error)throw error;return NextResponse.json({ok:true});}
  catch(error){console.error("Cart save failed",error);return NextResponse.json({error:"Cart database is unavailable"},{status:503});}
}
