import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/request-user";
const schema=z.object({cartId:z.string().uuid(),items:z.array(z.object({id:z.string().min(1),quantity:z.number().int().min(1).max(20)})).max(40)});
export async function GET(request:NextRequest){
  const requestedCartId=request.nextUrl.searchParams.get("cartId");
  if(requestedCartId&&!z.string().uuid().safeParse(requestedCartId).success)return NextResponse.json({error:"Invalid cart id"},{status:400});
  try{const admin=supabaseAdmin(), user=await getRequestUser(request);let cartId=requestedCartId;
    if(user){const {data,error}=await admin.rpc("get_shopfite_account_cart",{p_user_id:user.id,p_guest_cart_id:requestedCartId});if(error)throw error;cartId=data;}
    if(!cartId)return NextResponse.json({error:"A cart id is required"},{status:400});
    if(!user){const {data:owner,error:ownerError}=await admin.from("shopping_carts").select("user_id").eq("id",cartId).maybeSingle();if(ownerError)throw ownerError;if(owner?.user_id)return NextResponse.json({error:"Sign in to access this cart"},{status:401});}
    const {data,error}=await admin.from("shopping_cart_items").select("product_id,quantity").eq("cart_id",cartId);if(error)throw error;return NextResponse.json({cartId,items:(data??[]).map(line=>({id:line.product_id,quantity:line.quantity}))});}
  catch(error){console.error("Cart read failed",error);return NextResponse.json({error:"Cart database is unavailable"},{status:503});}
}
export async function PUT(request:NextRequest){
  const parsed=schema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:"Invalid cart"},{status:400});
  try{const admin=supabaseAdmin(), user=await getRequestUser(request);let cartId=parsed.data.cartId;
    if(user){const {data,error}=await admin.rpc("get_shopfite_account_cart",{p_user_id:user.id,p_guest_cart_id:cartId});if(error)throw error;cartId=data;}
    else{const {data:owner,error:ownerError}=await admin.from("shopping_carts").select("user_id").eq("id",cartId).maybeSingle();if(ownerError)throw ownerError;if(owner?.user_id)return NextResponse.json({error:"Sign in to update this cart"},{status:401});}
    const {error}=await admin.rpc("save_shopfite_cart",{p_cart_id:cartId,p_items:parsed.data.items});if(error)throw error;return NextResponse.json({ok:true,cartId});}
  catch(error){console.error("Cart save failed",error);return NextResponse.json({error:"Cart database is unavailable"},{status:503});}
}
