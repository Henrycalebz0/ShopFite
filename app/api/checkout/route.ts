import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";

const schema = z.object({
  customer: z.object({ name:z.string().min(2).max(120), email:z.string().email(), phone:z.string().min(7).max(30), address:z.string().min(5).max(250), city:z.string().min(2).max(100), region:z.string().min(2).max(100), notes:z.string().max(500).optional().default("") }),
  items: z.array(z.object({ id:z.string().min(1), quantity:z.number().int().min(1).max(20) })).min(1).max(40),
});
function escapeHtml(value:string) { return value.replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!)); }
function ngn(cents:number) { return new Intl.NumberFormat("en-NG", {style:"currency",currency:"NGN",maximumFractionDigits:0}).format(cents/100); }

export async function POST(request:NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(()=>null));
  if (!parsed.success) return NextResponse.json({error:"Check your delivery details and cart, then try again."},{status:400});
  try {
    const {data,error}=await supabaseAdmin().rpc("place_shopfite_order",{p_customer:parsed.data.customer,p_items:parsed.data.items});
    if(error){
      console.error("Order transaction failed",error.message);
      const conflict=/stock|available/i.test(error.message);
      return NextResponse.json({error:conflict?"An item is unavailable or low on stock. Refresh your bag and try again.":"We couldn’t place your order right now. Please try again."},{status:conflict?409:500});
    }
    const order=Array.isArray(data)?data[0]:data;
    if(!order) throw new Error("Order transaction returned no order.");
    const customer=parsed.data.customer;
    const receiptItems=(order.receipt_items??[]) as {product_name:string;quantity:number;line_total_cents:number}[];
    const mailKey=process.env.MAILGUN_API_KEY, domain=process.env.MAILGUN_DOMAIN, from=process.env.MAILGUN_FROM_EMAIL;
    let emailSent=false;
    if(mailKey && domain && from){
      const details=receiptItems.map(line=>`<tr><td style="padding:10px 0;border-bottom:1px solid #eee">${escapeHtml(line.product_name)} × ${line.quantity}</td><td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right">${ngn(line.line_total_cents)}</td></tr>`).join("");
      const body=`<div style="max-width:600px;margin:auto;font:15px Arial,sans-serif;color:#17231c"><h1>Thanks for your order, ${escapeHtml(customer.name)}.</h1><p>We’ve received order <strong>${escapeHtml(order.order_number)}</strong>. We’ll contact you to confirm delivery.</p><table style="width:100%;border-collapse:collapse">${details}<tr><td style="padding:12px 0">Delivery</td><td style="text-align:right">${order.shipping_cents?ngn(order.shipping_cents):"Free"}</td></tr><tr><td style="padding:12px 0;font-weight:bold">Total due on delivery</td><td style="text-align:right;font-weight:bold">${ngn(order.total_cents)}</td></tr></table><p>Delivery to ${escapeHtml(customer.address)}, ${escapeHtml(customer.city)}, ${escapeHtml(customer.region)}.</p><p>ShopFite</p></div>`;
      try { const form=new FormData();form.set("from",from);form.set("to",customer.email);form.set("subject",`Order ${order.order_number} confirmed`);form.set("html",body);const auth=btoa(`api:${mailKey}`);const base=(process.env.MAILGUN_API_BASE_URL||"https://api.mailgun.net/v3").replace(/\/$/,"");const response=await fetch(`${base}/${domain}/messages`,{method:"POST",headers:{Authorization:`Basic ${auth}`},body:form,signal:AbortSignal.timeout(8000)});emailSent=response.ok;if(!response.ok)console.error("Mailgun send failed",response.status); }
      catch(error){console.error("Mailgun send failed",error);}
    }
    const {error:updateError}=await supabaseAdmin().from("orders").update({confirmation_email_sent:emailSent}).eq("id",order.id);
    if(updateError) console.error("Could not record email status",updateError.message);
    return NextResponse.json({orderNumber:order.order_number,emailSent},{status:201});
  } catch(error) {
    console.error("Checkout failed",error);
    return NextResponse.json({error:"We couldn’t place your order right now. Please try again or contact support."},{status:500});
  }
}
