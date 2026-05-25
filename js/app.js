import { PARTVAULT_PRODUCTS } from "./products.js";
import {
  supabase,
  signIn, signUp, signOut, getSession, getProfile, updateProfile,
  loadCartFromDB, saveCartToDB, upsertCartItem,
  loadWishlistFromDB, addToWishlistDB, removeFromWishlistDB,
  getAddresses, addAddress, updateAddress, deleteAddress, setDefaultAddress,
  placeOrder, getOrders,
} from "./supabase.js";

(function () {
  "use strict";
  
  console.log("App.js loaded, products count:", PARTVAULT_PRODUCTS.length);

  const STORAGE_KEY = "partvault_cart_v1";
  const WISHLIST_KEY = "partvault_wishlist_v1";
  const THEME_KEY = "partvault_theme_v1";

  // Apply saved theme before first render to avoid flash
  (function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark") document.documentElement.setAttribute("data-theme", "dark");
  })();

  const state = {
    cart: loadCart(),
    wishlist: loadWishlist(),
    compare: [],
    activeCategory: "all",
    activeBrands: new Set(),
    sort: "featured",
    search: "",
    minRating: 0,
    saleOnly: false,
    newOnly: false,
    viewMode: "grid",
    currentPage: 1,
    itemsPerPage: 24,
    user: null,       // Supabase user object when signed in
    profile: null,    // profiles row
  };

  const els = {
    grid: document.getElementById("product-grid"),
    resultCount: document.getElementById("result-count"),
    filterCategories: document.getElementById("filter-categories"),
    priceMin: document.getElementById("price-min"),
    priceMax: document.getElementById("price-max"),
    resetFilters: document.getElementById("reset-filters"),
    sortSelect: document.getElementById("sort-select"),
    search: document.getElementById("search"),
    searchBtn: document.querySelector(".search-btn"),
    cartBtn: document.getElementById("cart-btn"),
    cartCount: document.getElementById("cart-count"),
    cartOverlay: document.getElementById("cart-overlay"),
    cartDrawer: document.getElementById("cart-drawer"),
    cartClose: document.getElementById("cart-close"),
    cartLines: document.getElementById("cart-lines"),
    cartSubtotal: document.getElementById("cart-subtotal"),
    checkoutBtn: document.getElementById("checkout-btn"),
    modal: document.getElementById("product-modal"),
    modalClose: document.getElementById("modal-close"),
    modalBody: document.getElementById("modal-body"),
    navToggle: document.getElementById("nav-toggle"),
    mainNav: document.getElementById("main-nav"),
    promoBar: document.querySelector(".promo-bar"),
    promoClose: document.querySelector(".promo-close"),
    toast: document.getElementById("toast"),
    wishlistBtn: document.getElementById("wishlist-btn"),
    wishlistOverlay: document.getElementById("wishlist-overlay"),
    wishlistDrawer: document.getElementById("wishlist-drawer"),
    wishlistClose: document.getElementById("wishlist-close"),
    wishlistLines: document.getElementById("wishlist-lines"),
    wishlistAddAll: document.getElementById("wishlist-add-all"),
    compareBar: document.getElementById("compare-bar"),
    compareSlots: document.getElementById("compare-slots"),
    compareGo: document.getElementById("compare-go"),
    compareClear: document.getElementById("compare-clear"),
    compareModal: document.getElementById("compare-modal"),
    compareModalClose: document.getElementById("compare-modal-close"),
    compareTable: document.getElementById("compare-table"),
    viewToggle: document.getElementById("view-toggle"),
    backToTop: document.getElementById("back-to-top"),
    filterRating: document.getElementById("filter-rating"),
    filterSale: document.getElementById("filter-sale"),
    filterNew: document.getElementById("filter-new"),
    themeToggle: document.getElementById("theme-toggle"),
    pagination: document.getElementById("pagination"),
    signinBtn: document.getElementById("signin-btn"),
    authModal: document.getElementById("auth-modal"),
    authModalClose: document.getElementById("auth-modal-close"),
    authTabs: document.querySelectorAll(".auth-tab"),
    signinForm: document.getElementById("signin-form"),
    signinEmail: document.getElementById("signin-email"),
    signinPassword: document.getElementById("signin-password"),
    signinError: document.getElementById("signin-error"),
    signinSubmit: document.getElementById("signin-submit"),
    signupForm: document.getElementById("signup-form"),
    signupName: document.getElementById("signup-name"),
    signupEmail: document.getElementById("signup-email"),
    signupPassword: document.getElementById("signup-password"),
    signupError: document.getElementById("signup-error"),
    signupSubmit: document.getElementById("signup-submit"),
    accountOverlay: document.getElementById("account-overlay"),
    accountDrawer: document.getElementById("account-drawer"),
    accountClose: document.getElementById("account-close"),
    accountBody: document.getElementById("account-body"),
    signoutBtn: document.getElementById("signout-btn"),
  };

  const categories = [...new Set(PARTVAULT_PRODUCTS.map((p) => p.category))].sort();
  const brands = [...new Set(PARTVAULT_PRODUCTS.map((p) => p.brand))].sort();

  function loadCart() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveCart() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.cart));
    if (state.user) {
      saveCartToDB(state.user.id, state.cart).catch(() => {});
    }
  }

  function loadWishlist() {
    try {
      const raw = localStorage.getItem(WISHLIST_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveWishlist() {
    localStorage.setItem(WISHLIST_KEY, JSON.stringify(state.wishlist));
    // Per-item DB sync is handled in toggleWishlist
  }

  function formatMoney(n) {
    return "₱" + new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  }

  function stars(n) {
    const full = Math.min(5, Math.max(0, Math.round(n)));
    return "\u2605".repeat(full) + "\u2606".repeat(5 - full);
  }

  function getProduct(id) {
    return PARTVAULT_PRODUCTS.find((p) => p.id === id);
  }

  const IMG_FALLBACK =
    "https://images.unsplash.com/photo-1591488320449-011701bb6704?w=800&h=800&fit=crop&auto=format&q=85";

  function productImgTag(p, className, sizes) {
    const alt = escapeHtml(p.name);
    const cls = className ? ` class="${className}"` : "";
    const src = escapeHtml(p.image || IMG_FALLBACK);
    const sz = escapeHtml(sizes || "(max-width:640px) 50vw, 220px");
    return `<img${cls} src="${src}" alt="${alt}" loading="lazy" decoding="async" width="400" height="400" sizes="${sz}" />`;
  }

  function filteredProducts() {
    let list = [...PARTVAULT_PRODUCTS];

    if (state.activeCategory !== "all") {
      list = list.filter((p) => p.category === state.activeCategory);
    }

    if (state.activeBrands.size > 0) {
      list = list.filter((p) => state.activeBrands.has(p.brand));
    }

    const minVal = els.priceMin.value === "" ? null : Number(els.priceMin.value);
    if (minVal != null && !Number.isNaN(minVal)) {
      list = list.filter((p) => p.price >= minVal);
    }
    const maxVal = els.priceMax.value === "" ? null : Number(els.priceMax.value);
    if (maxVal != null && !Number.isNaN(maxVal)) {
      list = list.filter((p) => p.price <= maxVal);
    }

    if (state.minRating > 0) {
      list = list.filter((p) => p.rating >= state.minRating);
    }

    if (state.saleOnly) {
      list = list.filter((p) => p.was != null);
    }

    if (state.newOnly) {
      list = list.filter((p) => p.isNew === true);
    }

    const q = state.search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.brand.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q)
      );
    }

    switch (state.sort) {
      case "price-asc":
        list.sort((a, b) => a.price - b.price);
        break;
      case "price-desc":
        list.sort((a, b) => b.price - a.price);
        break;
      case "name":
        list.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "rating":
        list.sort((a, b) => b.rating - a.rating);
        break;
      default:
        list.sort((a, b) => (b.was ? 1 : 0) - (a.was ? 1 : 0) || b.rating - a.rating);
    }

    return list;
  }

  function renderFilters() {
    els.filterCategories.innerHTML = "";
    const allLabel = document.createElement("label");
    allLabel.innerHTML = `<input type="radio" name="fcat" value="all" ${state.activeCategory === "all" ? "checked" : ""} /> All parts`;
    els.filterCategories.appendChild(allLabel);

    categories.forEach((cat) => {
      const label = document.createElement("label");
      label.innerHTML = `<input type="radio" name="fcat" value="${cat}" ${state.activeCategory === cat ? "checked" : ""} /> ${cat}`;
      els.filterCategories.appendChild(label);
    });

    els.filterCategories.querySelectorAll('input[name="fcat"]').forEach((input) => {
      input.addEventListener("change", () => {
        state.activeCategory = input.value;
        state.currentPage = 1;
        syncNavActive();
        renderGrid();
      });
    });
  }

  function syncNavActive() {
    document.querySelectorAll(".nav-list a").forEach((a) => {
      const cat = a.dataset.cat || "all";
      a.classList.toggle("is-active", cat === state.activeCategory);
    });
  }

  function renderGrid() {
    const list = filteredProducts();
    
    // Update items per page based on view mode
    state.itemsPerPage = state.viewMode === "list" ? 8 : 24;
    
    // Calculate pagination
    const totalPages = Math.ceil(list.length / state.itemsPerPage);
    if (state.currentPage > totalPages && totalPages > 0) {
      state.currentPage = totalPages;
    }
    if (state.currentPage < 1) state.currentPage = 1;
    
    const startIdx = (state.currentPage - 1) * state.itemsPerPage;
    const endIdx = startIdx + state.itemsPerPage;
    const pageItems = list.slice(startIdx, endIdx);
    
    els.resultCount.textContent = `${list.length} item${list.length === 1 ? "" : "s"}`;
    els.grid.innerHTML = "";
    els.grid.className = state.viewMode === "list" ? "product-grid list-view" : "product-grid";

    pageItems.forEach((p) => {
      const inWishlist = state.wishlist.includes(p.id);
      const inCompare = state.compare.includes(p.id);
      const card = document.createElement("article");
      card.className = "product-card";
      card.innerHTML = `
        <div class="thumb">
          ${p.was ? '<span class="badge">SALE</span>' : ""}
          ${p.isNew ? '<span class="badge badge-new">NEW</span>' : ""}
          ${productImgTag(p, "", "(max-width:640px) 45vw, 220px")}
          <button type="button" class="btn-wishlist ${inWishlist ? "is-wishlisted" : ""}" data-wish="${p.id}" aria-label="${inWishlist ? "Remove from wishlist" : "Add to wishlist"}" title="Wishlist">${inWishlist ? "&#9829;" : "&#9825;"}</button>
        </div>
        <div class="body">
          <p class="brand">${escapeHtml(p.brand)}</p>
          <h3>${escapeHtml(p.name)}</h3>
          <p class="rating" aria-label="Rating ${p.rating} of 5">${stars(p.rating)} <span style="color:var(--muted);font-weight:400">(${p.rating})</span></p>
          <div class="price-row">
            <span class="price">${formatMoney(p.price)}</span>
            ${p.was ? `<span class="was">${formatMoney(p.was)}</span>` : ""}
            ${p.was ? `<span class="discount-pct">-${Math.round((1 - p.price / p.was) * 100)}%</span>` : ""}
          </div>
          <p class="stock-status ${p.stock === "low" ? "low-stock" : ""}">${p.stock === "low" ? "&#9888; Low stock" : p.stock === "out" ? "&#10005; Out of stock" : "&#10003; In stock"}</p>
          <div class="actions">
            <button type="button" class="btn-add" data-add="${p.id}" ${p.stock === "out" ? "disabled" : ""}>${p.stock === "out" ? "Out of Stock" : "Add to bag"}</button>
            <button type="button" class="btn-detail" data-detail="${p.id}" aria-label="Details for ${escapeHtml(p.name)}">Details</button>
            <button type="button" class="btn-compare ${inCompare ? "is-comparing" : ""}" data-compare="${p.id}" aria-label="Compare" title="Compare">&#9878;</button>
          </div>
        </div>
      `;
      els.grid.appendChild(card);
    });

    els.grid.querySelectorAll("[data-add]").forEach((btn) => {
      btn.addEventListener("click", () => addToCart(btn.getAttribute("data-add")));
    });
    els.grid.querySelectorAll("[data-detail]").forEach((btn) => {
      btn.addEventListener("click", () => openModal(btn.getAttribute("data-detail")));
    });
    els.grid.querySelectorAll("[data-wish]").forEach((btn) => {
      btn.addEventListener("click", () => toggleWishlist(btn.getAttribute("data-wish")));
    });
    els.grid.querySelectorAll("[data-compare]").forEach((btn) => {
      btn.addEventListener("click", () => toggleCompare(btn.getAttribute("data-compare")));
    });
    
    renderPagination(totalPages);
  }

  function renderPagination(totalPages) {
    if (!els.pagination) return;
    
    if (totalPages <= 1) {
      els.pagination.innerHTML = "";
      return;
    }
    
    els.pagination.innerHTML = "";
    
    // Previous button
    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "pagination-btn";
    prevBtn.textContent = "‹ Previous";
    prevBtn.disabled = state.currentPage === 1;
    prevBtn.addEventListener("click", () => {
      if (state.currentPage > 1) {
        state.currentPage--;
        renderGrid();
        document.getElementById("shop").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
    els.pagination.appendChild(prevBtn);
    
    // Page numbers
    const maxButtons = 7;
    let startPage = Math.max(1, state.currentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    
    if (endPage - startPage < maxButtons - 1) {
      startPage = Math.max(1, endPage - maxButtons + 1);
    }
    
    if (startPage > 1) {
      const firstBtn = document.createElement("button");
      firstBtn.type = "button";
      firstBtn.className = "pagination-btn";
      firstBtn.textContent = "1";
      firstBtn.addEventListener("click", () => {
        state.currentPage = 1;
        renderGrid();
        document.getElementById("shop").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      els.pagination.appendChild(firstBtn);
      
      if (startPage > 2) {
        const ellipsis = document.createElement("span");
        ellipsis.className = "pagination-ellipsis";
        ellipsis.textContent = "...";
        els.pagination.appendChild(ellipsis);
      }
    }
    
    for (let i = startPage; i <= endPage; i++) {
      const pageBtn = document.createElement("button");
      pageBtn.type = "button";
      pageBtn.className = "pagination-btn" + (i === state.currentPage ? " is-active" : "");
      pageBtn.textContent = String(i);
      pageBtn.addEventListener("click", () => {
        state.currentPage = i;
        renderGrid();
        document.getElementById("shop").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      els.pagination.appendChild(pageBtn);
    }
    
    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        const ellipsis = document.createElement("span");
        ellipsis.className = "pagination-ellipsis";
        ellipsis.textContent = "...";
        els.pagination.appendChild(ellipsis);
      }
      
      const lastBtn = document.createElement("button");
      lastBtn.type = "button";
      lastBtn.className = "pagination-btn";
      lastBtn.textContent = String(totalPages);
      lastBtn.addEventListener("click", () => {
        state.currentPage = totalPages;
        renderGrid();
        document.getElementById("shop").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      els.pagination.appendChild(lastBtn);
    }
    
    // Next button
    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "pagination-btn";
    nextBtn.textContent = "Next ›";
    nextBtn.disabled = state.currentPage === totalPages;
    nextBtn.addEventListener("click", () => {
      if (state.currentPage < totalPages) {
        state.currentPage++;
        renderGrid();
        document.getElementById("shop").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
    els.pagination.appendChild(nextBtn);
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function addToCart(id) {
    const p = getProduct(id);
    if (!p) return;
    const line = state.cart.find((l) => l.id === id);
    if (line) line.qty += 1;
    else state.cart.push({ id, qty: 1 });
    saveCart();
    if (state.user) {
      const updated = state.cart.find((l) => l.id === id);
      upsertCartItem(state.user.id, id, updated ? updated.qty : 1).catch(() => {});
    }
    updateCartUI();
    showToast(`Added ${p.name} to bag`);
  }

  function setQty(id, qty) {
    const line = state.cart.find((l) => l.id === id);
    if (!line) return;
    line.qty = Math.max(0, qty);
    state.cart = state.cart.filter((l) => l.qty > 0);
    saveCart();
    if (state.user) {
      upsertCartItem(state.user.id, id, qty).catch(() => {});
    }
    updateCartUI();
  }

  function cartSubtotal() {
    return state.cart.reduce((sum, line) => {
      const p = getProduct(line.id);
      return sum + (p ? p.price * line.qty : 0);
    }, 0);
  }

  function updateCartUI() {
    const n = state.cart.reduce((a, l) => a + l.qty, 0);
    els.cartCount.textContent = String(n);
    els.cartCount.style.display = n > 0 ? "flex" : "none";

    if (state.cart.length === 0) {
      els.cartLines.innerHTML = '<p class="empty-cart">Your bag is empty. Add a GPU or SSD to get started.</p>';
    } else {
      els.cartLines.innerHTML = "";
      state.cart.forEach((line) => {
        const p = getProduct(line.id);
        if (!p) return;
        const row = document.createElement("div");
        row.className = "cart-line";
        row.innerHTML = `
          <div class="cart-thumb">${productImgTag(p, "cart-line-img", "48px")}</div>
          <div>
            <div class="title">${escapeHtml(p.name)}</div>
            <div class="meta">${escapeHtml(p.brand)} - ${formatMoney(p.price)} each</div>
            <div class="qty-control">
              <button type="button" data-dec="${p.id}" aria-label="Decrease">\u2212</button>
              <span>${line.qty}</span>
              <button type="button" data-inc="${p.id}" aria-label="Increase">+</button>
            </div>
          </div>
          <div class="cart-line-price">${formatMoney(p.price * line.qty)}</div>
        `;
        els.cartLines.appendChild(row);
      });

      els.cartLines.querySelectorAll("[data-dec]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-dec");
          const line = state.cart.find((l) => l.id === id);
          if (line) setQty(id, line.qty - 1);
        });
      });
      els.cartLines.querySelectorAll("[data-inc]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-inc");
          const line = state.cart.find((l) => l.id === id);
          if (line) setQty(id, line.qty + 1);
        });
      });
    }

    els.cartSubtotal.textContent = formatMoney(cartSubtotal());
  }

  // ── Wishlist ──────────────────────────────────────────────────────────────
  function toggleWishlist(id) {
    const idx = state.wishlist.indexOf(id);
    const p = getProduct(id);
    if (idx === -1) {
      state.wishlist.push(id);
      showToast(`${p ? p.name : "Item"} added to wishlist ♥`);
      if (state.user) addToWishlistDB(state.user.id, id).catch(() => {});
    } else {
      state.wishlist.splice(idx, 1);
      showToast(`Removed from wishlist`);
      if (state.user) removeFromWishlistDB(state.user.id, id).catch(() => {});
    }
    saveWishlist();
    renderGrid();
    renderWishlist();
  }

  function renderWishlist() {
    if (state.wishlist.length === 0) {
      els.wishlistLines.innerHTML = '<p class="empty-cart">Your wishlist is empty.</p>';
      return;
    }
    els.wishlistLines.innerHTML = "";
    state.wishlist.forEach((id) => {
      const p = getProduct(id);
      if (!p) return;
      const row = document.createElement("div");
      row.className = "cart-line";
      row.innerHTML = `
        <div class="cart-thumb">${productImgTag(p, "cart-line-img", "48px")}</div>
        <div>
          <div class="title">${escapeHtml(p.name)}</div>
          <div class="meta">${escapeHtml(p.brand)} · ${formatMoney(p.price)}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:0.35rem;align-items:flex-end">
          <button type="button" class="btn-add" style="font-size:0.75rem;padding:0.35rem 0.6rem" data-wish-add="${p.id}">Add to bag</button>
          <button type="button" class="btn-text" style="font-size:0.75rem" data-wish-remove="${p.id}">Remove</button>
        </div>
      `;
      els.wishlistLines.appendChild(row);
    });
    els.wishlistLines.querySelectorAll("[data-wish-add]").forEach((btn) => {
      btn.addEventListener("click", () => { addToCart(btn.getAttribute("data-wish-add")); });
    });
    els.wishlistLines.querySelectorAll("[data-wish-remove]").forEach((btn) => {
      btn.addEventListener("click", () => { toggleWishlist(btn.getAttribute("data-wish-remove")); });
    });
  }

  function openWishlist() {
    renderWishlist();
    els.wishlistOverlay.hidden = false;
    els.wishlistDrawer.classList.add("is-open");
    els.wishlistDrawer.setAttribute("aria-hidden", "false");
  }

  function closeWishlist() {
    els.wishlistOverlay.hidden = true;
    els.wishlistDrawer.classList.remove("is-open");
    els.wishlistDrawer.setAttribute("aria-hidden", "true");
  }

  // ── Compare ───────────────────────────────────────────────────────────────
  function toggleCompare(id) {
    const idx = state.compare.indexOf(id);
    if (idx === -1) {
      if (state.compare.length >= 4) {
        showToast("You can compare up to 4 products");
        return;
      }
      state.compare.push(id);
    } else {
      state.compare.splice(idx, 1);
    }
    renderCompareBar();
    renderGrid();
  }

  function renderCompareBar() {
    if (state.compare.length === 0) {
      els.compareBar.hidden = true;
      return;
    }
    els.compareBar.hidden = false;
    els.compareSlots.innerHTML = "";
    state.compare.forEach((id) => {
      const p = getProduct(id);
      if (!p) return;
      const chip = document.createElement("span");
      chip.className = "compare-chip";
      chip.innerHTML = `${escapeHtml(p.name)} <button type="button" data-remove-compare="${id}" aria-label="Remove">&times;</button>`;
      els.compareSlots.appendChild(chip);
    });
    els.compareSlots.querySelectorAll("[data-remove-compare]").forEach((btn) => {
      btn.addEventListener("click", () => toggleCompare(btn.getAttribute("data-remove-compare")));
    });
  }

  function openCompareModal() {
    if (state.compare.length < 2) {
      showToast("Select at least 2 products to compare");
      return;
    }
    const products = state.compare.map(getProduct).filter(Boolean);
    const allSpecs = [...new Set(products.flatMap((p) => p.specs))];

    let html = '<div class="compare-table-wrap"><table class="compare-table"><thead><tr><th>Feature</th>';
    products.forEach((p) => {
      html += `<th><div class="compare-th-img">${productImgTag(p, "", "80px")}</div><div>${escapeHtml(p.name)}</div><div class="price" style="color:var(--zalora-red);font-weight:700">${formatMoney(p.price)}</div></th>`;
    });
    html += "</tr></thead><tbody>";

    const rows = [
      ["Brand", (p) => p.brand],
      ["Category", (p) => p.category],
      ["Rating", (p) => stars(p.rating) + ` (${p.rating})`],
      ["Price", (p) => formatMoney(p.price)],
    ];
    rows.forEach(([label, fn]) => {
      html += `<tr><td><strong>${label}</strong></td>`;
      products.forEach((p) => { html += `<td>${escapeHtml(String(fn(p)))}</td>`; });
      html += "</tr>";
    });

    allSpecs.forEach((spec) => {
      html += `<tr><td>${escapeHtml(spec)}</td>`;
      products.forEach((p) => {
        html += `<td>${p.specs.includes(spec) ? "&#10003;" : "&#8212;"}</td>`;
      });
      html += "</tr>";
    });

    html += "</tbody></table></div>";
    html += '<div class="compare-actions">';
    products.forEach((p) => {
      html += `<button type="button" class="btn-primary" data-add="${p.id}" ${p.stock === "out" ? "disabled" : ""}>Add ${escapeHtml(p.brand)} to bag</button>`;
    });
    html += "</div>";

    els.compareTable.innerHTML = html;
    els.compareTable.querySelectorAll("[data-add]").forEach((btn) => {
      btn.addEventListener("click", () => { addToCart(btn.getAttribute("data-add")); });
    });
    els.compareModal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeCompareModal() {
    els.compareModal.hidden = true;
    document.body.style.overflow = "";
  }

  function openCart() {
    els.cartOverlay.hidden = false;
    els.cartDrawer.classList.add("is-open");
    els.cartDrawer.setAttribute("aria-hidden", "false");
  }

  function closeCart() {
    els.cartOverlay.hidden = true;
    els.cartDrawer.classList.remove("is-open");
    els.cartDrawer.setAttribute("aria-hidden", "true");
  }

  function openModal(id) {
    const p = getProduct(id);
    if (!p) return;
    const inWishlist = state.wishlist.includes(p.id);
    els.modalBody.innerHTML = `
      <div class="modal-thumb">${productImgTag(p, "modal-img", "min(100vw, 520px)")}</div>
      <p class="brand" style="margin:0 0 0.25rem;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted)">${escapeHtml(p.brand)}</p>
      <h2 id="modal-title">${escapeHtml(p.name)}</h2>
      <div class="price-row" style="margin-bottom:0.5rem">
        <span class="price">${formatMoney(p.price)}</span>
        ${p.was ? `<span class="was">${formatMoney(p.was)}</span>` : ""}
        ${p.was ? `<span class="discount-pct">-${Math.round((1 - p.price / p.was) * 100)}%</span>` : ""}
      </div>
      <p class="stock-status ${p.stock === "low" ? "low-stock" : ""}" style="margin:0 0 1rem">${p.stock === "low" ? "&#9888; Low stock" : p.stock === "out" ? "&#10005; Out of stock" : "&#10003; In stock"}</p>
      <p style="font-weight:600;font-size:0.875rem;margin:0 0 0.35rem">Specs</p>
      <ul class="specs">${p.specs.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>
      <div style="display:flex;gap:0.75rem;margin-top:0.5rem">
        <button type="button" class="btn-primary" style="flex:1" data-add-modal="${p.id}" ${p.stock === "out" ? "disabled" : ""}>${p.stock === "out" ? "Out of Stock" : "Add to bag"}</button>
        <button type="button" class="btn-ghost btn-wish-modal ${inWishlist ? "is-wishlisted" : ""}" data-wish-modal="${p.id}">${inWishlist ? "&#9829; Wishlisted" : "&#9825; Wishlist"}</button>
      </div>
    `;
    els.modal.hidden = false;
    els.modalBody.querySelector("[data-add-modal]").addEventListener("click", () => {
      addToCart(p.id);
      closeModal();
    });
    els.modalBody.querySelector("[data-wish-modal]").addEventListener("click", (e) => {
      toggleWishlist(p.id);
      const btn = e.currentTarget;
      const nowIn = state.wishlist.includes(p.id);
      btn.innerHTML = nowIn ? "&#9829; Wishlisted" : "&#9825; Wishlist";
      btn.classList.toggle("is-wishlisted", nowIn);
    });
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    els.modal.hidden = true;
    document.body.style.overflow = "";
  }

  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      els.toast.hidden = true;
    }, 2200);
  }

  function bindNav() {
    document.querySelectorAll(".nav-list a").forEach((a) => {
      a.addEventListener("click", (e) => {
        const cat = a.dataset.cat || "all";
        state.activeCategory = cat;
        renderFilters();
        renderGrid();
        syncNavActive();
        if (window.innerWidth <= 640) {
          els.mainNav.classList.remove("is-open");
          els.navToggle.setAttribute("aria-expanded", "false");
        }
      });
    });

    document.querySelectorAll(".hero-ctas a[data-cat]").forEach((a) => {
      a.addEventListener("click", () => {
        state.activeCategory = a.dataset.cat || "all";
        renderFilters();
        renderGrid();
        syncNavActive();
      });
    });
  }

  els.sortSelect.addEventListener("change", () => {
    state.sort = els.sortSelect.value;
    state.currentPage = 1;
    renderGrid();
  });

  els.priceMin.addEventListener("input", () => { state.currentPage = 1; renderGrid(); });
  els.priceMax.addEventListener("input", () => { state.currentPage = 1; renderGrid(); });

  if (els.filterRating) {
    els.filterRating.querySelectorAll('input[name="frating"]').forEach((input) => {
      input.addEventListener("change", () => {
        state.minRating = Number(input.value);
        state.currentPage = 1;
        renderGrid();
      });
    });
  }

  if (els.filterSale) {
    els.filterSale.addEventListener("change", () => {
      state.saleOnly = els.filterSale.checked;
      state.currentPage = 1;
      renderGrid();
    });
  }

  if (els.filterNew) {
    els.filterNew.addEventListener("change", () => {
      state.newOnly = els.filterNew.checked;
      state.currentPage = 1;
      renderGrid();
    });
  }

  els.resetFilters.addEventListener("click", () => {
    state.activeCategory = "all";
    state.activeBrands.clear();
    els.priceMin.value = "";
    els.priceMax.value = "";
    state.sort = "featured";
    els.sortSelect.value = "featured";
    state.search = "";
    els.search.value = "";
    state.minRating = 0;
    state.saleOnly = false;
    state.newOnly = false;
    state.currentPage = 1;
    if (els.filterSale) els.filterSale.checked = false;
    if (els.filterNew) els.filterNew.checked = false;
    if (els.filterRating) {
      const anyRadio = els.filterRating.querySelector('input[value="0"]');
      if (anyRadio) anyRadio.checked = true;
    }
    renderFilters();
    renderGrid();
    syncNavActive();
  });

  function runSearch() {
    state.search = els.search.value;
    state.currentPage = 1;
    renderGrid();
  }

  els.search.addEventListener("input", runSearch);
  els.searchBtn.addEventListener("click", runSearch);

  els.cartBtn.addEventListener("click", openCart);
  els.cartClose.addEventListener("click", closeCart);
  els.cartOverlay.addEventListener("click", closeCart);

  els.wishlistBtn.addEventListener("click", openWishlist);
  els.wishlistClose.addEventListener("click", closeWishlist);
  els.wishlistOverlay.addEventListener("click", closeWishlist);
  els.wishlistAddAll.addEventListener("click", () => {
    if (state.wishlist.length === 0) { showToast("Wishlist is empty"); return; }
    state.wishlist.forEach((id) => addToCart(id));
    showToast("All wishlist items added to bag");
  });

  els.compareGo.addEventListener("click", openCompareModal);
  els.compareClear.addEventListener("click", () => {
    state.compare = [];
    renderCompareBar();
    renderGrid();
  });
  els.compareModalClose.addEventListener("click", closeCompareModal);
  els.compareModal.addEventListener("click", (e) => { if (e.target === els.compareModal) closeCompareModal(); });

  if (els.viewToggle) {
    els.viewToggle.addEventListener("click", () => {
      state.viewMode = state.viewMode === "grid" ? "list" : "grid";
      state.currentPage = 1;
      els.viewToggle.title = state.viewMode === "grid" ? "Switch to list view" : "Switch to grid view";
      renderGrid();
    });
  }

  els.modalClose.addEventListener("click", closeModal);
  els.modal.addEventListener("click", (e) => {
    if (e.target === els.modal) closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
      closeCart();
      closeWishlist();
      closeCompareModal();
      closeAuthModal();
      closeAccountDrawer();
    }
  });

  els.checkoutBtn.addEventListener("click", () => {
    if (state.cart.length === 0) {
      showToast("Your bag is empty");
      return;
    }
    if (!state.user) {
      showToast("Please sign in to checkout");
      openAuthModal("signin");
      return;
    }
    openCheckoutFlow();
  });

  els.navToggle.addEventListener("click", () => {
    const open = els.mainNav.classList.toggle("is-open");
    els.navToggle.setAttribute("aria-expanded", open ? "true" : "false");
  });

  if (els.promoClose && els.promoBar) {
    els.promoClose.addEventListener("click", () => els.promoBar.classList.add("is-hidden"));
  }

  // Back to top
  if (els.backToTop) {
    window.addEventListener("scroll", () => {
      els.backToTop.hidden = window.scrollY < 400;
    }, { passive: true });
    els.backToTop.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  // ── Dark mode ─────────────────────────────────────────────────────────────
  function updateThemeIcon() {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    els.themeToggle.textContent = isDark ? "\u2600" : "\u263E";
    els.themeToggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
  }

  if (els.themeToggle) {
    updateThemeIcon();
    els.themeToggle.addEventListener("click", () => {
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      if (isDark) {
        document.documentElement.removeAttribute("data-theme");
        localStorage.setItem(THEME_KEY, "light");
      } else {
        document.documentElement.setAttribute("data-theme", "dark");
        localStorage.setItem(THEME_KEY, "dark");
      }
      updateThemeIcon();
    });
  }
  // ── Auth modal ────────────────────────────────────────────────────────────
  function openAuthModal(tab = "signin") {
    if (!els.authModal) return;
    switchAuthTab(tab);
    els.authModal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeAuthModal() {
    if (!els.authModal) return;
    els.authModal.hidden = true;
    document.body.style.overflow = "";
    if (els.signinError) els.signinError.hidden = true;
    if (els.signupError) els.signupError.hidden = true;
    if (els.signinForm) els.signinForm.reset();
    if (els.signupForm) els.signupForm.reset();
  }

  function switchAuthTab(tab) {
    if (!els.authTabs || !els.signinForm || !els.signupForm) return;
    els.authTabs.forEach((t) => t.classList.toggle("is-active", t.dataset.tab === tab));
    els.signinForm.hidden = tab !== "signin";
    els.signupForm.hidden = tab !== "signup";
    const title = document.getElementById("auth-modal-title");
    if (title) title.textContent = tab === "signin" ? "Welcome back" : "Create your account";
  }

  if (els.authTabs && els.authTabs.length > 0) {
    els.authTabs.forEach((tab) => {
      tab.addEventListener("click", () => switchAuthTab(tab.dataset.tab));
    });
  }

  if (els.authModalClose) {
    els.authModalClose.addEventListener("click", closeAuthModal);
  }
  
  if (els.authModal) {
    els.authModal.addEventListener("click", (e) => { if (e.target === els.authModal) closeAuthModal(); });
  }

  if (els.signinBtn) {
    els.signinBtn.addEventListener("click", () => {
      if (state.user) openAccountDrawer();
      else openAuthModal("signin");
    });
  }

  if (els.signinForm) {
    els.signinForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    els.signinError.hidden = true;
    els.signinSubmit.disabled = true;
    els.signinSubmit.textContent = "Signing in…";

    const { data, error } = await signIn(
      els.signinEmail.value.trim(),
      els.signinPassword.value
    );

    els.signinSubmit.disabled = false;
    els.signinSubmit.textContent = "Sign In";

    if (error) {
      els.signinError.textContent = error.message;
      els.signinError.hidden = false;
      return;
    }

    closeAuthModal();
    await handleUserSignedIn(data.user);
    showToast(`Welcome back, ${state.profile?.full_name || data.user.email}!`);
    });
  }

  if (els.signupForm) {
    els.signupForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      els.signupError.hidden = true;
      els.signupSubmit.disabled = true;
      els.signupSubmit.textContent = "Creating account…";

      const { data, error } = await signUp(
        els.signupEmail.value.trim(),
        els.signupPassword.value,
        els.signupName.value.trim()
      );

      els.signupSubmit.disabled = false;
      els.signupSubmit.textContent = "Create Account";

      if (error) {
        els.signupError.textContent = error.message;
        els.signupError.hidden = false;
        return;
      }

      closeAuthModal();
      if (data.user && !data.session) {
        showToast("Check your email to confirm your account!");
      } else if (data.user) {
        await handleUserSignedIn(data.user);
        showToast(`Welcome to PartVault, ${els.signupName.value.trim()}!`);
      }
    });
  }

  if (els.signoutBtn) {
    els.signoutBtn.addEventListener("click", async () => {
      await signOut();
      state.user = null;
      state.profile = null;
      // Reset to empty guest state — do NOT load from localStorage
      // (it may contain a previous user's merged cart)
      state.cart = [];
      state.wishlist = [];
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(WISHLIST_KEY);
      updateCartUI();
      renderGrid();
      updateSigninBtn();
      closeAccountDrawer();
      showToast("Signed out");
    });
  }

  // ── Account drawer ────────────────────────────────────────────────────────
  function openAccountDrawer() {
    if (!els.accountOverlay || !els.accountDrawer) return;
    renderAccountBody();
    els.accountOverlay.hidden = false;
    els.accountDrawer.classList.add("is-open");
    els.accountDrawer.setAttribute("aria-hidden", "false");
  }

  function closeAccountDrawer() {
    if (!els.accountOverlay || !els.accountDrawer) return;
    els.accountOverlay.hidden = true;
    els.accountDrawer.classList.remove("is-open");
    els.accountDrawer.setAttribute("aria-hidden", "true");
  }

  if (els.accountClose) {
    els.accountClose.addEventListener("click", closeAccountDrawer);
  }
  
  if (els.accountOverlay) {
    els.accountOverlay.addEventListener("click", closeAccountDrawer);
  }

  async function renderAccountBody() {
    if (!state.user) return;
    const name = state.profile?.full_name || state.user.email;
    const { data: addresses } = await getAddresses(state.user.id);
    const { data: orders } = await getOrders(state.user.id);

    let html = `
      <div class="account-section">
        <p class="account-greeting">👋 Hi, <strong>${escapeHtml(name)}</strong></p>
        <p class="account-email">${escapeHtml(state.user.email)}</p>
      </div>
      <div class="account-section">
        <div class="account-section-head">
          <strong>Addresses</strong>
          <button type="button" class="btn-text" id="add-address-btn">+ Add</button>
        </div>`;

    if (addresses.length === 0) {
      html += `<p class="account-empty">No saved addresses.</p>`;
    } else {
      addresses.forEach((addr) => {
        html += `
          <div class="address-card ${addr.is_default ? "is-default" : ""}">
            <div class="address-label">${escapeHtml(addr.label)}${addr.is_default ? ' <span class="default-badge">Default</span>' : ""}</div>
            <div>${escapeHtml(addr.full_name)}</div>
            <div>${escapeHtml(addr.line1)}${addr.line2 ? ", " + escapeHtml(addr.line2) : ""}</div>
            <div>${escapeHtml(addr.city)}, ${escapeHtml(addr.province)} ${escapeHtml(addr.zip)}</div>
            <div class="address-actions">
              ${!addr.is_default ? `<button type="button" class="btn-text" data-set-default="${addr.id}">Set default</button>` : ""}
              <button type="button" class="btn-text" style="color:var(--zalora-red)" data-delete-addr="${addr.id}">Delete</button>
            </div>
          </div>`;
      });
    }

    html += `</div><div class="account-section"><strong>Recent Orders</strong>`;

    if (orders.length === 0) {
      html += `<p class="account-empty">No orders yet.</p>`;
    } else {
      orders.slice(0, 5).forEach((order) => {
        const date = new Date(order.created_at).toLocaleDateString("en-PH");
        html += `
          <div class="order-card">
            <div class="order-meta">
              <span class="order-status status-${order.status}">${order.status}</span>
              <span class="order-date">${date}</span>
            </div>
            <div class="order-total">${formatMoney(order.total)}</div>
            <div class="order-items-list">${(order.order_items || []).map((i) => `${escapeHtml(i.product_name)} ×${i.qty}`).join(", ")}</div>
          </div>`;
      });
    }

    html += `</div>`;
    els.accountBody.innerHTML = html;

    // Add address form
    const addBtn = document.getElementById("add-address-btn");
    if (addBtn) {
      addBtn.addEventListener("click", () => showAddressForm(null));
    }

    els.accountBody.querySelectorAll("[data-set-default]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await setDefaultAddress(state.user.id, btn.getAttribute("data-set-default"));
        renderAccountBody();
      });
    });

    els.accountBody.querySelectorAll("[data-delete-addr]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await deleteAddress(btn.getAttribute("data-delete-addr"));
        renderAccountBody();
        showToast("Address deleted");
      });
    });
  }

  function showAddressForm(existing) {
    const a = existing || {};
    els.accountBody.innerHTML = `
      <button type="button" class="btn-text" id="addr-back-btn" style="margin-bottom:1rem">← Back</button>
      <form id="address-form" novalidate>
        <h3 style="margin:0 0 1rem">${existing ? "Edit Address" : "New Address"}</h3>
        <label class="auth-field">Label <input type="text" name="label" value="${escapeHtml(a.label || "Home")}" required /></label>
        <label class="auth-field">Full Name <input type="text" name="full_name" value="${escapeHtml(a.full_name || "")}" required /></label>
        <label class="auth-field">Phone <input type="tel" name="phone" value="${escapeHtml(a.phone || "")}" /></label>
        <label class="auth-field">Address Line 1 <input type="text" name="line1" value="${escapeHtml(a.line1 || "")}" required /></label>
        <label class="auth-field">Address Line 2 <input type="text" name="line2" value="${escapeHtml(a.line2 || "")}" /></label>
        <label class="auth-field">City <input type="text" name="city" value="${escapeHtml(a.city || "")}" required /></label>
        <label class="auth-field">Province <input type="text" name="province" value="${escapeHtml(a.province || "")}" required /></label>
        <label class="auth-field">ZIP Code <input type="text" name="zip" value="${escapeHtml(a.zip || "")}" required /></label>
        <label class="auth-field" style="flex-direction:row;align-items:center;gap:0.5rem">
          <input type="checkbox" name="is_default" ${a.is_default ? "checked" : ""} /> Set as default
        </label>
        <button type="submit" class="btn-primary full" style="margin-top:1rem">Save Address</button>
      </form>`;

    document.getElementById("addr-back-btn").addEventListener("click", renderAccountBody);

    document.getElementById("address-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        label: fd.get("label"),
        full_name: fd.get("full_name"),
        phone: fd.get("phone"),
        line1: fd.get("line1"),
        line2: fd.get("line2"),
        city: fd.get("city"),
        province: fd.get("province"),
        zip: fd.get("zip"),
        is_default: fd.get("is_default") === "on",
      };

      if (existing) {
        await updateAddress(existing.id, payload);
      } else {
        await addAddress(state.user.id, payload);
      }

      if (payload.is_default) {
        // The DB trigger handles clearing others, but let's be safe
        const { data: addrs } = await getAddresses(state.user.id);
        const saved = addrs.find((x) => x.label === payload.label && x.line1 === payload.line1);
        if (saved) await setDefaultAddress(state.user.id, saved.id);
      }

      showToast("Address saved");
      renderAccountBody();
    });
  }

  // ── Checkout flow ─────────────────────────────────────────────────────────
  async function openCheckoutFlow() {
    closeCart();
    const { data: addresses } = await getAddresses(state.user.id);

    if (addresses.length === 0) {
      showToast("Please add a delivery address first");
      openAccountDrawer();
      setTimeout(() => {
        const addBtn = document.getElementById("add-address-btn");
        if (addBtn) addBtn.click();
      }, 300);
      return;
    }

    // Show address picker in a modal
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.style.zIndex = "250";

    const defaultAddr = addresses.find((a) => a.is_default) || addresses[0];
    let selectedId = defaultAddr.id;

    overlay.innerHTML = `
      <div class="modal" style="max-width:480px">
        <button type="button" class="modal-close" id="checkout-modal-close">&times;</button>
        <h2 style="margin:0 0 1rem">Confirm Order</h2>
        <p style="font-weight:600;font-size:0.875rem;margin:0 0 0.5rem">Deliver to:</p>
        <div id="checkout-addr-list">
          ${addresses.map((a) => `
            <label class="checkout-addr-option ${a.id === selectedId ? "is-selected" : ""}">
              <input type="radio" name="checkout_addr" value="${a.id}" ${a.id === selectedId ? "checked" : ""} />
              <div>
                <strong>${escapeHtml(a.label)}</strong> — ${escapeHtml(a.full_name)}<br/>
                ${escapeHtml(a.line1)}, ${escapeHtml(a.city)}, ${escapeHtml(a.province)} ${escapeHtml(a.zip)}
              </div>
            </label>`).join("")}
        </div>
        <div class="subtotal-row" style="margin-top:1rem">
          <span>Total</span>
          <strong style="color:var(--zalora-red)">${formatMoney(cartSubtotal())}</strong>
        </div>
        <button type="button" class="btn-primary full" id="confirm-order-btn" style="margin-top:1rem">Place Order</button>
      </div>`;

    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";

    overlay.querySelectorAll('input[name="checkout_addr"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        selectedId = radio.value;
        overlay.querySelectorAll(".checkout-addr-option").forEach((el) => {
          el.classList.toggle("is-selected", el.querySelector("input").value === selectedId);
        });
      });
    });

    document.getElementById("checkout-modal-close").addEventListener("click", () => {
      overlay.remove();
      document.body.style.overflow = "";
    });

    document.getElementById("confirm-order-btn").addEventListener("click", async () => {
      const btn = document.getElementById("confirm-order-btn");
      btn.disabled = true;
      btn.textContent = "Placing order…";

      const { data: order, error } = await placeOrder(
        state.user.id,
        selectedId,
        state.cart,
        PARTVAULT_PRODUCTS,
        cartSubtotal()
      );

      if (error) {
        btn.disabled = false;
        btn.textContent = "Place Order";
        showToast("Order failed. Please try again.");
        return;
      }

      // Clear cart
      state.cart = [];
      saveCart();
      updateCartUI();
      overlay.remove();
      document.body.style.overflow = "";
      showToast(`Order placed! Total: ${formatMoney(cartSubtotal() || order ? 0 : 0)}`);
      showToast("Order placed successfully! 🎉");
    });
  }

  // ── Auth state management ─────────────────────────────────────────────────
  async function handleUserSignedIn(user) {
    state.user = user;

    // Load profile
    const { data: profile } = await getProfile(user.id);
    state.profile = profile;

    // Merge any guest (localStorage) cart into this user's DB cart, then load from DB
    const guestCart = loadCart(); // reads from shared localStorage
    if (guestCart.length > 0) {
      await saveCartToDB(user.id, guestCart);
      // Clear guest cart so it doesn't bleed into the next guest session
      localStorage.removeItem(STORAGE_KEY);
    }
    state.cart = await loadCartFromDB(user.id);

    // Load this user's wishlist from DB (ignore localStorage wishlist for logged-in users)
    state.wishlist = await loadWishlistFromDB(user.id);

    updateCartUI();
    renderGrid();
    updateSigninBtn();
  }

  function updateSigninBtn() {
    if (!els.signinBtn) return;
    if (state.user) {
      const name = state.profile?.full_name || state.user.email;
      const initials = name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
      els.signinBtn.textContent = initials;
      els.signinBtn.title = name;
      els.signinBtn.classList.add("is-signed-in");
    } else {
      els.signinBtn.textContent = "Sign in";
      els.signinBtn.title = "";
      els.signinBtn.classList.remove("is-signed-in");
    }
  }

  // Listen for auth state changes (e.g. email confirmation in another tab)
  if (supabase) {
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session?.user && !state.user) {
        await handleUserSignedIn(session.user);
      } else if (event === "SIGNED_OUT") {
        state.user = null;
        state.profile = null;
        updateSigninBtn();
      }
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  (async function init() {
    renderFilters();
    syncNavActive();
    bindNav();
    updateCartUI();
    renderGrid();

    // Restore session if user was previously signed in
    const session = await getSession();
    if (session?.user) {
      await handleUserSignedIn(session.user);
    }
    updateSigninBtn();
  })();

})();
