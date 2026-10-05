import "react-native-url-polyfill/auto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, AppState, FlatList, Image, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { createClient, type Session } from "@supabase/supabase-js";

WebBrowser.maybeCompleteAuthSession();

const apiBase = (process.env.EXPO_PUBLIC_SHOPFITE_API_URL || "https://shopfite-production.up.railway.app").replace(/\/$/, "");
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: { getItem: SecureStore.getItemAsync, setItem: SecureStore.setItemAsync, removeItem: SecureStore.deleteItemAsync },
    autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, flowType: "pkce",
  },
}) : null;

type Product = { id: string; name: string; category: string; description: string; price_cents: number; image_url: string; badge?: string | null };
type CartLine = { id: string; quantity: number };
type Delivery = { name: string; email: string; phone: string; address: string; city: string; region: string; notes: string };
const blankDelivery: Delivery = { name: "", email: "", phone: "", address: "", city: "", region: "", notes: "" };
const money = (kobo: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(kobo / 100);

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartId, setCartId] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [view, setView] = useState<"shop" | "bag" | "checkout">("shop");
  const [delivery, setDelivery] = useState(blankDelivery);
  const [category, setCategory] = useState("All");
  const [orderMessage, setOrderMessage] = useState("");

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const token = session?.access_token;
    const headers = new Headers(init.headers);
    if (init.body) headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(`${apiBase}${path}`, { ...init, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "ShopFite could not complete that request.");
    return data;
  }, [session]);

  const refreshCart = useCallback(async (id = cartId) => {
    if (!id) return;
    const data = await request(`/api/cart?cartId=${encodeURIComponent(id)}`);
    const nextId = data.cartId || id;
    if (nextId !== id) { setCartId(nextId); await SecureStore.setItemAsync("shopfite-cart-id", nextId); }
    if (Array.isArray(data.items)) setCart((current) => JSON.stringify(current) === JSON.stringify(data.items) ? current : data.items);
  }, [cartId, request]);

  const saveCart = useCallback(async (next: CartLine[]) => {
    if (!cartId) return;
    setCart(next);
    try {
      const data = await request("/api/cart", { method: "PUT", body: JSON.stringify({ cartId, items: next }) });
      if (data.cartId && data.cartId !== cartId) { setCartId(data.cartId); await SecureStore.setItemAsync("shopfite-cart-id", data.cartId); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Your bag could not be saved."); }
  }, [cartId, request]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { data } = await supabase?.auth.getSession() ?? { data: { session: null } };
        if (alive) setSession(data.session);
        const storedCartId = await SecureStore.getItemAsync("shopfite-cart-id");
        let id: string = storedCartId || Crypto.randomUUID();
        if (!storedCartId) await SecureStore.setItemAsync("shopfite-cart-id", id);
        if (alive) setCartId(id);
        const catalog = await fetch(`${apiBase}/api/products`).then((r) => r.ok ? r.json() : Promise.reject(new Error("Products could not be loaded.")));
        if (alive && Array.isArray(catalog)) setProducts(catalog);
        const result = await request(`/api/cart?cartId=${encodeURIComponent(id)}`);
        if (!alive) return;
        if (result.cartId && result.cartId !== id) { id = result.cartId; await SecureStore.setItemAsync("shopfite-cart-id", id); setCartId(id); }
        if (Array.isArray(result.items)) setCart(result.items);
      } catch (error) { if (alive) setMessage(error instanceof Error ? error.message : "ShopFite could not load."); }
      finally { if (alive) setReady(true); }
    })();
    if (supabase) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
      return () => { alive = false; subscription.unsubscribe(); };
    }
    return () => { alive = false; };
  // The initial request intentionally uses the persisted cart ID once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!session || !cartId || !ready) return;
    const timer = setInterval(() => { void refreshCart().catch(() => {}); }, 1200);
    const listener = AppState.addEventListener("change", (state) => { if (state === "active") void refreshCart().catch(() => {}); });
    return () => { clearInterval(timer); listener.remove(); };
  }, [session, cartId, ready, refreshCart]);

  useEffect(() => {
    const metadataName = session?.user.user_metadata?.full_name;
    const email = session?.user.email;
    if (!email && !metadataName) return;
    setDelivery((current) => ({ ...current, email: current.email || email || "", name: current.name || (typeof metadataName === "string" ? metadataName : "") }));
  }, [session]);

  const lines = useMemo(() => cart.map((line) => ({ ...line, product: products.find((p) => p.id === line.id) })).filter((line) => line.product), [cart, products]);
  const count = cart.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = lines.reduce((sum, line) => sum + line.product!.price_cents * line.quantity, 0);
  const shipping = subtotal >= 150000 ? 0 : 12000;
  const categories = ["All", ...new Set(products.map((product) => product.category))];
  const filtered = products.filter((product) => category === "All" || product.category === category);
  const add = (id: string) => { const current = cart.find((line) => line.id === id); void saveCart(current ? cart.map((line) => line.id === id ? { ...line, quantity: Math.min(20, line.quantity + 1) } : line) : [...cart, { id, quantity: 1 }]); };
  const change = (id: string, delta: number) => void saveCart(cart.map((line) => line.id === id ? { ...line, quantity: line.quantity + delta } : line).filter((line) => line.quantity > 0));

  async function signIn() {
    if (!supabase) { setMessage("This app build is missing its Supabase settings. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to mobile/.env, then restart Expo or make a new Android build."); return; }
    setBusy(true); setMessage("");
    try {
      const redirectTo = Linking.createURL("auth/callback", { scheme: "shopfite" });
      const { data, error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo, skipBrowserRedirect: true } });
      if (error || !data.url) throw error || new Error("Google sign-in could not start.");
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== "success") return;
      const code = Linking.parse(result.url).queryParams?.code;
      if (typeof code !== "string") throw new Error("Google sign-in did not return an authorization code.");
      const { data: authData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) throw exchangeError;
      setSession(authData.session);
      await refreshCart(cartId);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Google sign-in failed."); }
    finally { setBusy(false); }
  }

  async function signOut() {
    await supabase?.auth.signOut();
    setSession(null);
    const id = Crypto.randomUUID();
    setCartId(id); await SecureStore.setItemAsync("shopfite-cart-id", id);
    setCart([]); setMessage("You are signed out.");
  }

  async function checkout() {
    setBusy(true); setMessage("");
    try {
      const result = await request("/api/checkout", { method: "POST", body: JSON.stringify({ customer: delivery, items: cart }) });
      setOrderMessage(`Order ${result.orderNumber} is saved.${result.emailSent ? " A confirmation email is on its way." : " We could not send the confirmation email; our team will contact you."}`);
      await saveCart([]); setView("shop");
    } catch (error) { setMessage(error instanceof Error ? error.message : "We could not place that order."); }
    finally { setBusy(false); }
  }

  const field = (key: keyof Delivery, label: string, options: { keyboardType?: "default" | "email-address" | "phone-pad"; multiline?: boolean } = {}) => (
    <View style={styles.field} key={key}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} autoCapitalize={key === "email" ? "none" : "words"} keyboardType={options.keyboardType || "default"} multiline={options.multiline} style={[styles.input, options.multiline && styles.multiline]} value={delivery[key]} onChangeText={(value) => setDelivery((current) => ({ ...current, [key]: value }))} /></View>
  );

  if (!ready) return <SafeAreaView style={[styles.center, Platform.OS === "android" && styles.androidInset]}><StatusBar barStyle="dark-content" backgroundColor="#faf9f5"/><ActivityIndicator size="large" color="#294b38"/><Text style={styles.muted}>Loading your shop…</Text></SafeAreaView>;

  return <SafeAreaView style={[styles.safe, Platform.OS === "android" && styles.androidInset]}>
    <StatusBar barStyle="dark-content" backgroundColor="#faf9f5"/>
    <View style={styles.header}><View style={styles.brand}><View style={styles.brandMark}><Text style={styles.brandMarkLetter}>S</Text></View><Text style={styles.brandName}>shopfite<Text style={styles.dot}>.</Text></Text></View><Pressable style={styles.bagButton} onPress={() => setView(view === "bag" ? "shop" : "bag")}><Text style={styles.bagText}>Bag ({count})</Text></Pressable></View>
    {orderMessage ? <Pressable style={styles.orderBanner} onPress={() => setOrderMessage("")}><Text style={styles.orderText}>{orderMessage}  ×</Text></Pressable> : null}
    {message ? <Pressable style={styles.messageBanner} onPress={() => setMessage("")}><Text style={styles.messageText}>{message}  ×</Text></Pressable> : null}
    <View style={styles.accountRow}><Text numberOfLines={1} style={styles.account}>{session?.user.email || "Guest checkout is available"}</Text><Pressable onPress={session ? signOut : signIn} disabled={busy}><Text style={styles.accountAction}>{busy ? "Please wait…" : session ? "Sign out" : "Sign in with Google"}</Text></Pressable></View>

    {view === "shop" && <>
      <View style={styles.intro}><Text style={styles.eyebrow}>GOOD THINGS, THOUGHTFULLY MADE</Text><Text style={styles.title}>Everyday, elevated.</Text><Text style={styles.muted}>Thoughtful pieces for a slower, more considered home.</Text></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categories}>{categories.map((item) => <Pressable key={item} onPress={() => setCategory(item)} style={[styles.chip, category === item && styles.chipActive]}><Text style={[styles.chipText, category === item && styles.chipTextActive]}>{item}</Text></Pressable>)}</ScrollView>
      <FlatList data={filtered} keyExtractor={(item) => item.id} contentContainerStyle={styles.catalog} renderItem={({ item }) => <View style={styles.product}>
        <Image source={{ uri: item.image_url }} style={styles.productImage}/><View style={styles.productInfo}><View style={styles.productCopy}><Text style={styles.productName}>{item.name}</Text><Text style={styles.productCategory}>{item.category}</Text><Text style={styles.productPrice}>{money(item.price_cents)}</Text></View><Pressable style={styles.addButton} accessibilityLabel={`Add ${item.name} to bag`} onPress={() => add(item.id)}><Text style={styles.addText}>＋</Text></Pressable></View>
      </View>} ListEmptyComponent={<Text style={styles.muted}>Products could not be loaded. Pull down to refresh the app.</Text>} />
    </>}

    {view === "bag" && <ScrollView contentContainerStyle={styles.page}><Text style={styles.title}>Your bag ({count})</Text>{lines.length ? lines.map(({ product, quantity, id }) => <View key={id} style={styles.cartLine}><Image source={{ uri: product!.image_url }} style={styles.cartImage}/><View style={styles.cartCopy}><Text style={styles.productName}>{product!.name}</Text><Text style={styles.productCategory}>{money(product!.price_cents)} each</Text><View style={styles.qty}><Pressable onPress={() => change(id, -1)}><Text style={styles.qtyButton}>−</Text></Pressable><Text>{quantity}</Text><Pressable onPress={() => change(id, 1)}><Text style={styles.qtyButton}>＋</Text></Pressable></View></View><Text style={styles.productPrice}>{money(product!.price_cents * quantity)}</Text></View>) : <Text style={styles.muted}>Your bag is empty. Add something lovely from the shop.</Text>}
      <View style={styles.totalRow}><Text>Subtotal</Text><Text>{money(subtotal)}</Text></View><View style={styles.totalRow}><Text>Delivery</Text><Text>{shipping ? money(shipping) : "Free"}</Text></View><View style={styles.totalRow}><Text style={styles.totalLabel}>Total due on delivery</Text><Text style={styles.totalLabel}>{money(subtotal + shipping)}</Text></View><Text style={styles.muted}>Cash on delivery · Free delivery on orders over ₦1,500.</Text><Pressable disabled={!count} style={[styles.primary, !count && styles.disabled]} onPress={() => setView("checkout")}><Text style={styles.primaryText}>Continue to checkout</Text></Pressable>
    </ScrollView>}

    {view === "checkout" && <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}><ScrollView contentContainerStyle={styles.page}><Pressable onPress={() => setView("bag")}><Text style={styles.back}>‹  Back to bag</Text></Pressable><Text style={styles.title}>Checkout</Text><Text style={styles.muted}>Your order total is {money(subtotal + shipping)} · cash on delivery.</Text>{field("email", "Email address", { keyboardType: "email-address" })}{field("name", "Full name")}{field("phone", "Phone number", { keyboardType: "phone-pad" })}{field("address", "Street address")}{field("city", "City")}{field("region", "State / region")}{field("notes", "Delivery notes (optional)", { multiline: true })}<Pressable disabled={busy || !count} style={[styles.primary, (busy || !count) && styles.disabled]} onPress={() => void checkout()}><Text style={styles.primaryText}>{busy ? "Placing order…" : `Place order · ${money(subtotal + shipping)}`}</Text></Pressable></ScrollView></KeyboardAvoidingView>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#faf9f5" }, androidInset: { paddingTop: StatusBar.currentHeight || 0 }, flex: { flex: 1 }, center: { flex: 1, backgroundColor: "#faf9f5", alignItems: "center", justifyContent: "center", gap: 12 },
  header: { height: 62, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: "#e9e8e1", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, brand: { flexDirection: "row", gap: 8, alignItems: "center" }, brandMark: { width: 30, height: 30, borderRadius: 6, backgroundColor: "#294b38", alignItems: "center", justifyContent: "center" }, brandMarkLetter: { color: "#c8e18b", fontSize: 19, fontWeight: "900" }, brandName: { color: "#17231c", fontSize: 23, fontWeight: "800", letterSpacing: -1.1 }, dot: { color: "#7d9f4c" }, bagButton: { borderRadius: 99, backgroundColor: "#294b38", paddingHorizontal: 15, paddingVertical: 9 }, bagText: { color: "white", fontWeight: "700" },
  accountRow: { paddingHorizontal: 20, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, borderBottomWidth: 1, borderBottomColor: "#e9e8e1" }, account: { color: "#71796f", flex: 1, fontSize: 12 }, accountAction: { color: "#294b38", fontSize: 13, fontWeight: "700" },
  intro: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 16 }, eyebrow: { color: "#627248", fontSize: 10, fontWeight: "800", letterSpacing: 1.4 }, title: { color: "#17231c", fontSize: 29, fontWeight: "700", letterSpacing: -0.8, marginTop: 8, marginBottom: 7 }, muted: { color: "#71796f", fontSize: 14, lineHeight: 21 }, categories: { paddingHorizontal: 20, gap: 8, paddingBottom: 14 }, chip: { borderRadius: 99, borderWidth: 1, borderColor: "#e2e2da", paddingVertical: 8, paddingHorizontal: 14 }, chipActive: { backgroundColor: "#294b38", borderColor: "#294b38" }, chipText: { color: "#535a52", fontSize: 12 }, chipTextActive: { color: "white" },
  catalog: { paddingHorizontal: 16, paddingBottom: 30, flexDirection: "row", flexWrap: "wrap", gap: 12 }, product: { width: "48%", flexGrow: 1, flexBasis: "45%", backgroundColor: "white", borderWidth: 1, borderColor: "#eeede7", borderRadius: 5, overflow: "hidden" }, productImage: { width: "100%", height: 165, backgroundColor: "#eeede7" }, productInfo: { padding: 11, flexDirection: "row", alignItems: "center", gap: 6 }, productCopy: { flex: 1 }, productName: { color: "#17231c", fontWeight: "700", fontSize: 14 }, productCategory: { color: "#71796f", fontSize: 12, marginTop: 4 }, productPrice: { color: "#17231c", fontWeight: "700", marginTop: 7 }, addButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#294b38", alignItems: "center", justifyContent: "center" }, addText: { color: "white", fontSize: 23, lineHeight: 27 },
  page: { padding: 20, paddingBottom: 50 }, cartLine: { flexDirection: "row", alignItems: "center", paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: "#e9e8e1", gap: 12 }, cartImage: { width: 68, height: 76, backgroundColor: "#eeede7" }, cartCopy: { flex: 1 }, qty: { flexDirection: "row", alignItems: "center", gap: 15, marginTop: 8 }, qtyButton: { color: "#294b38", fontSize: 22 }, totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10 }, totalLabel: { fontWeight: "800", color: "#17231c" }, primary: { backgroundColor: "#294b38", paddingVertical: 15, paddingHorizontal: 18, alignItems: "center", borderRadius: 4, marginTop: 20 }, primaryText: { color: "white", fontWeight: "700" }, disabled: { opacity: 0.5 }, back: { color: "#294b38", marginBottom: 15, fontWeight: "600" },
  field: { marginTop: 17, gap: 7 }, label: { color: "#17231c", fontWeight: "600", fontSize: 13 }, input: { height: 48, borderWidth: 1, borderColor: "#deded6", borderRadius: 3, paddingHorizontal: 13, backgroundColor: "white", color: "#17231c" }, multiline: { minHeight: 78, paddingTop: 12, textAlignVertical: "top" }, messageBanner: { padding: 11, backgroundColor: "#fae8e2" }, messageText: { color: "#813c2c", fontSize: 13 }, orderBanner: { padding: 11, backgroundColor: "#e8ecdc" }, orderText: { color: "#354c31", fontSize: 13 },
});
