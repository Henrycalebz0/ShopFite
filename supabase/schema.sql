create extension if not exists pgcrypto;

create table if not exists public.products (
  id text primary key,
  name text not null,
  category text not null,
  description text not null default '',
  price_cents integer not null check (price_cents >= 0),
  image_url text not null,
  badge text,
  inventory_count integer not null default 0 check (inventory_count >= 0),
  active boolean not null default true,
  featured boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('SF-' || upper(substr(encode(gen_random_bytes(6),'hex'),1,10))),
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  shipping_address text not null,
  shipping_city text not null,
  shipping_region text not null,
  customer_notes text not null default '',
  subtotal_cents integer not null check(subtotal_cents >= 0),
  shipping_cents integer not null check(shipping_cents >= 0),
  total_cents integer not null check(total_cents = subtotal_cents + shipping_cents),
  payment_method text not null default 'pay_on_delivery',
  status text not null default 'pending' check(status in ('pending','confirmed','shipped','delivered','cancelled')),
  confirmation_email_sent boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id text not null references public.products(id),
  product_name text not null,
  unit_price_cents integer not null check(unit_price_cents >= 0),
  quantity integer not null check(quantity > 0),
  line_total_cents integer not null check(line_total_cents = unit_price_cents * quantity),
  created_at timestamptz not null default now()
);

create table if not exists public.shopping_carts (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now()
);
alter table public.shopping_carts add column if not exists user_id uuid references auth.users(id) on delete cascade;
create unique index if not exists shopping_carts_user_id_key on public.shopping_carts(user_id);
create table if not exists public.shopping_cart_items (
  cart_id uuid not null references public.shopping_carts(id) on delete cascade,
  product_id text not null references public.products(id),
  quantity integer not null check(quantity between 1 and 20),
  updated_at timestamptz not null default now(),
  primary key(cart_id,product_id)
);

alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.shopping_carts enable row level security;
alter table public.shopping_cart_items enable row level security;
drop policy if exists "Anyone can view active products" on public.products;
create policy "Anyone can view active products" on public.products for select using (active);
grant select on public.products to anon, authenticated;
-- Orders and order items are accessed through the server's service role only.
revoke all on public.orders, public.order_items, public.shopping_carts, public.shopping_cart_items from anon, authenticated;

create or replace function public.save_shopfite_cart(p_cart_id uuid, p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_item jsonb; v_product public.products%rowtype; v_qty integer;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 40 then raise exception 'Invalid cart'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::integer;
    if v_qty < 1 or v_qty > 20 then raise exception 'Invalid quantity'; end if;
    select * into v_product from public.products where products.id=v_item->>'id' and active;
    if not found then raise exception 'Item unavailable'; end if;
  end loop;
  insert into public.shopping_carts(id,updated_at) values(p_cart_id,now())
    on conflict(id) do update set updated_at=excluded.updated_at;
  delete from public.shopping_cart_items where cart_id=p_cart_id;
  insert into public.shopping_cart_items(cart_id,product_id,quantity)
    select p_cart_id,value->>'id',(value->>'quantity')::integer from jsonb_array_elements(p_items);
end $$;
revoke all on function public.save_shopfite_cart(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.save_shopfite_cart(uuid,jsonb) to service_role;

create or replace function public.get_shopfite_account_cart(p_user_id uuid, p_guest_cart_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_cart_id uuid;
begin
  if p_user_id is null then raise exception 'A signed-in account is required'; end if;
  select id into v_cart_id from public.shopping_carts where user_id=p_user_id;
  if v_cart_id is null then
    insert into public.shopping_carts(id,user_id,updated_at) values(gen_random_uuid(),p_user_id,now())
      on conflict(user_id) do nothing;
    select id into v_cart_id from public.shopping_carts where user_id=p_user_id;
  end if;
  if p_guest_cart_id is not null and p_guest_cart_id <> v_cart_id
     and exists(select 1 from public.shopping_carts where id=p_guest_cart_id and user_id is null) then
    insert into public.shopping_cart_items(cart_id,product_id,quantity,updated_at)
      select v_cart_id,i.product_id,i.quantity,now() from public.shopping_cart_items i
      join public.products p on p.id=i.product_id and p.active where i.cart_id=p_guest_cart_id
      on conflict(cart_id,product_id) do update set quantity=least(20,public.shopping_cart_items.quantity+excluded.quantity),updated_at=now();
    delete from public.shopping_carts where id=p_guest_cart_id and user_id is null;
  end if;
  return v_cart_id;
end $$;
revoke all on function public.get_shopfite_account_cart(uuid,uuid) from public, anon, authenticated;
grant execute on function public.get_shopfite_account_cart(uuid,uuid) to service_role;

create or replace function public.place_shopfite_order(p_customer jsonb, p_items jsonb)
returns table(id uuid, order_number text, subtotal_cents integer, shipping_cents integer, total_cents integer, receipt_items jsonb)
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_subtotal integer;
  v_shipping integer;
  v_items jsonb;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty integer;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Cart is empty'; end if;
  -- Lock inventory rows in stable order, validate all quantities, then decrement in the same transaction.
  for v_item in select value from jsonb_array_elements(p_items) order by value->>'id' loop
    select * into v_product from public.products where products.id = v_item->>'id' and active for update;
    if not found then raise exception 'An item is no longer available'; end if;
    v_qty := (v_item->>'quantity')::integer;
    if v_qty < 1 or v_qty > 20 or v_product.inventory_count < v_qty then raise exception 'Insufficient stock for %', v_product.name; end if;
  end loop;
  select sum((p.price_cents * (i.value->>'quantity')::integer))::integer
    into v_subtotal from jsonb_array_elements(p_items) i
    join public.products p on p.id=i.value->>'id' and p.active;
  if v_subtotal is null then raise exception 'Invalid cart'; end if;
  v_shipping := case when v_subtotal >= 150000 then 0 else 12000 end;
  insert into public.orders(customer_name,customer_email,customer_phone,shipping_address,shipping_city,shipping_region,customer_notes,subtotal_cents,shipping_cents,total_cents)
  values (p_customer->>'name',p_customer->>'email',p_customer->>'phone',p_customer->>'address',p_customer->>'city',p_customer->>'region',coalesce(p_customer->>'notes',''),v_subtotal,v_shipping,v_subtotal+v_shipping)
  returning * into v_order;
  for v_item in select value from jsonb_array_elements(p_items) loop
    select * into v_product from public.products where products.id=v_item->>'id';
    v_qty := (v_item->>'quantity')::integer;
    insert into public.order_items(order_id,product_id,product_name,unit_price_cents,quantity,line_total_cents)
      values(v_order.id,v_product.id,v_product.name,v_product.price_cents,v_qty,v_product.price_cents*v_qty);
    update public.products set inventory_count=inventory_count-v_qty where products.id=v_product.id;
  end loop;
  select jsonb_agg(jsonb_build_object('product_name',oi.product_name,'quantity',oi.quantity,'line_total_cents',oi.line_total_cents) order by oi.created_at)
    into v_items from public.order_items oi where oi.order_id=v_order.id;
  return query select v_order.id,v_order.order_number,v_order.subtotal_cents,v_order.shipping_cents,v_order.total_cents,v_items;
end $$;

revoke all on function public.place_shopfite_order(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.place_shopfite_order(jsonb,jsonb) to service_role;

insert into public.products(id,name,category,description,price_cents,image_url,badge,inventory_count,featured) values
('linen-duvet','Washed Linen Duvet Set','Bedroom','Relaxed Belgian flax linen, made for slow mornings.',1890000,'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?auto=format&fit=crop&w=900&q=85','Bestseller',12,true),
('ceramic-vase','Sculpted Ceramic Vase','Decor','Hand-finished stoneware with a soft matte glaze.',680000,'https://images.unsplash.com/photo-1578500494198-246f612d3b3d?auto=format&fit=crop&w=900&q=85','Handmade',18,true),
('oak-lamp','Oak Bedside Lamp','Lighting','Solid oak and a warm linen shade for a softer glow.',1240000,'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=85',null,9,true),
('woven-basket','Woven Storage Basket','Storage','A sturdy, natural-fibre catch-all for everyday clutter.',540000,'https://images.unsplash.com/photo-1594620302200-9a762244a156?auto=format&fit=crop&w=900&q=85','Natural',20,true),
('cotton-throw','Chunky Cotton Throw','Bedroom','Soft recycled cotton, woven in a timeless textured check.',890000,'https://images.unsplash.com/photo-1600369671236-e74521d4b6ad?auto=format&fit=crop&w=900&q=85',null,15,true),
('tableware','Everyday Stoneware Set','Kitchen','A four-piece, dishwasher-safe set in warm oat.',720000,'https://images.unsplash.com/photo-1490312278390-ab64016e0aa9?auto=format&fit=crop&w=900&q=85','Set of 4',14,true),
('wood-board','Acacia Serving Board','Kitchen','Responsibly sourced acacia, shaped and oiled by hand.',460000,'https://images.unsplash.com/photo-1603199506016-b9a594b593c0?auto=format&fit=crop&w=900&q=85',null,22,true),
('wall-print','Quiet Morning Art Print','Decor','An archival art print on FSC-certified paper.',390000,'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?auto=format&fit=crop&w=900&q=85',null,25,true)
on conflict(id) do nothing;
