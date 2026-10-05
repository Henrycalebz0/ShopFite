-- Link each signed-in Supabase account to one shared cart. Existing guest carts
-- remain supported and are merged the first time an account claims them.
alter table public.shopping_carts
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create unique index if not exists shopping_carts_user_id_key
  on public.shopping_carts(user_id);

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
