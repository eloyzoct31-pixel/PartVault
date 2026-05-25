// ── PartVault Supabase Client ─────────────────────────────────────────────────
// Project: https://buxcgttxhsukrsmjiupk.supabase.co

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL  = "https://buxcgttxhsukrsmjiupk.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ1eGNndHR4aHN1a3JzbWppdXBrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0MTUxOTAsImV4cCI6MjA5Mzk5MTE5MH0.LK06F49k4o6XpSlP7pYPzmaA_b-H-AZ3MsQbgkwKjDQ";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);
console.log("Supabase client created");

// ── Auth helpers ──────────────────────────────────────────────────────────────

export async function signUp(email, password, fullName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  return { data, error };
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  return { error };
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  return { data, error };
}

export async function updateProfile(userId, updates) {
  const { data, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", userId)
    .select()
    .single();
  return { data, error };
}

// ── Cart helpers ──────────────────────────────────────────────────────────────

async function getOrCreateCart(userId) {
  // Try to get existing cart
  let { data: cart } = await supabase
    .from("carts")
    .select("id")
    .eq("user_id", userId)
    .single();

  if (!cart) {
    const { data: newCart } = await supabase
      .from("carts")
      .insert({ user_id: userId })
      .select("id")
      .single();
    cart = newCart;
  }
  return cart;
}

export async function loadCartFromDB(userId) {
  const cart = await getOrCreateCart(userId);
  if (!cart) return [];

  const { data, error } = await supabase
    .from("cart_items")
    .select("product_id, qty")
    .eq("cart_id", cart.id);

  if (error) return [];
  return (data || []).map((row) => ({ id: row.product_id, qty: row.qty }));
}

export async function saveCartToDB(userId, cartLines) {
  const cart = await getOrCreateCart(userId);
  if (!cart) return;

  // Delete all existing items then re-insert (simple upsert strategy)
  await supabase.from("cart_items").delete().eq("cart_id", cart.id);

  if (cartLines.length === 0) return;

  const rows = cartLines.map((l) => ({
    cart_id: cart.id,
    product_id: l.id,
    qty: l.qty,
  }));

  await supabase.from("cart_items").insert(rows);
}

export async function upsertCartItem(userId, productId, qty) {
  const cart = await getOrCreateCart(userId);
  if (!cart) return;

  if (qty <= 0) {
    await supabase
      .from("cart_items")
      .delete()
      .eq("cart_id", cart.id)
      .eq("product_id", productId);
  } else {
    await supabase
      .from("cart_items")
      .upsert({ cart_id: cart.id, product_id: productId, qty },
               { onConflict: "cart_id,product_id" });
  }
}

// ── Wishlist helpers ──────────────────────────────────────────────────────────

export async function loadWishlistFromDB(userId) {
  const { data, error } = await supabase
    .from("wishlists")
    .select("product_id")
    .eq("user_id", userId);

  if (error) return [];
  return (data || []).map((row) => row.product_id);
}

export async function addToWishlistDB(userId, productId) {
  await supabase
    .from("wishlists")
    .upsert({ user_id: userId, product_id: productId },
             { onConflict: "user_id,product_id" });
}

export async function removeFromWishlistDB(userId, productId) {
  await supabase
    .from("wishlists")
    .delete()
    .eq("user_id", userId)
    .eq("product_id", productId);
}

// ── Address helpers ───────────────────────────────────────────────────────────

export async function getAddresses(userId) {
  const { data, error } = await supabase
    .from("addresses")
    .select("*")
    .eq("user_id", userId)
    .order("is_default", { ascending: false });
  return { data: data || [], error };
}

export async function addAddress(userId, addr) {
  const { data, error } = await supabase
    .from("addresses")
    .insert({ user_id: userId, ...addr })
    .select()
    .single();
  return { data, error };
}

export async function updateAddress(addressId, updates) {
  const { data, error } = await supabase
    .from("addresses")
    .update(updates)
    .eq("id", addressId)
    .select()
    .single();
  return { data, error };
}

export async function deleteAddress(addressId) {
  const { error } = await supabase
    .from("addresses")
    .delete()
    .eq("id", addressId);
  return { error };
}

export async function setDefaultAddress(userId, addressId) {
  // Clear all defaults first
  await supabase
    .from("addresses")
    .update({ is_default: false })
    .eq("user_id", userId);
  // Set new default
  await supabase
    .from("addresses")
    .update({ is_default: true })
    .eq("id", addressId);
}

// ── Order helpers ─────────────────────────────────────────────────────────────

export async function placeOrder(userId, addressId, cartLines, products, total) {
  // Create order
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .insert({ user_id: userId, address_id: addressId, total, status: "pending" })
    .select("id")
    .single();

  if (orderErr || !order) return { error: orderErr };

  // Insert order items
  const items = cartLines.map((line) => {
    const p = products.find((x) => x.id === line.id);
    return {
      order_id: order.id,
      product_id: line.id,
      product_name: p ? p.name : line.id,
      product_brand: p ? p.brand : "",
      price: p ? p.price : 0,
      qty: line.qty,
    };
  });

  const { error: itemsErr } = await supabase.from("order_items").insert(items);
  return { data: order, error: itemsErr };
}

export async function getOrders(userId) {
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return { data: data || [], error };
}
