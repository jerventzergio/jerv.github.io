/* =========================================================
   CarsotoCare — Aplikasi Manajemen Car Wash & Perawatan
   Frontend murni + localStorage. Tanpa backend.
   ========================================================= */
(function () {
  "use strict";

  /* ---------------- Konstanta & Storage ---------------- */
  const KEYS = {
    session: "carsotocare_session",
    orders: "carsotocare_orders",
    items: "carsotocare_items",
    services: "carsotocare_services",
  };

  const STATUS = {
    baru:     { label: "Baru",     cls: "st-baru" },
    proses:   { label: "Diproses", cls: "st-proses" },
    selesai:  { label: "Selesai",  cls: "st-selesai" },
    diambil:  { label: "LUNAS",    cls: "st-lunas" },
  };
  const STATUS_FLOW = ["baru", "proses", "selesai", "diambil"];
  const LOW_STOCK_THRESHOLD = 5;

  // Daftar layanan default (seed saat pertama kali dipakai)
  const DEFAULT_SERVICES = [
    { id: "svc-cuci-biasa",   name: "Cuci Biasa",   price: 25000 },
    { id: "svc-cuci-premium", name: "Cuci Premium", price: 40000 },
    { id: "svc-poles-body",   name: "Poles Body",   price: 150000 },
    { id: "svc-detailing",    name: "Detailing",    price: 250000 },
    { id: "svc-salon",        name: "Salon Mobil",  price: 100000 },
    { id: "svc-ganti-oli",    name: "Ganti Oli",    price: 50000 },
    { id: "svc-service",      name: "Service",      price: 75000 },
  ];

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      localStorage.setItem(key, JSON.stringify(value));
    },
    remove(key) {
      localStorage.removeItem(key);
    },
  };

  const db = {
    orders: () => store.get(KEYS.orders, []),
    saveOrders: (v) => store.set(KEYS.orders, v),
    items: () => store.get(KEYS.items, []),
    saveItems: (v) => store.set(KEYS.items, v),
    services: () => {
      let v = store.get(KEYS.services, null);
      if (v === null) {
        v = DEFAULT_SERVICES.map((s) => ({ ...s }));
        store.set(KEYS.services, v);
      }
      return v;
    },
    saveServices: (v) => store.set(KEYS.services, v),
    session: () => store.get(KEYS.session, null),
    saveSession: (v) => store.set(KEYS.session, v),
    clearSession: () => store.remove(KEYS.session),
  };

  /* ---------------- Utilitas ---------------- */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function uid(prefix) {
    return (prefix || "id") + "-" + Date.now().toString(36) + "-" +
      Math.random().toString(36).slice(2, 7);
  }

  function formatIDR(n) {
    const num = Number(n) || 0;
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(num);
  }

  function formatDate(iso) {
    if (!iso) return "-";
    const d = new Date(iso);
    return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function showAlert(el, type, msg) {
    el.className = "alert alert-" + type + " mt-3 mb-0";
    el.textContent = msg;
    el.classList.remove("d-none");
  }
  function hideAlert(el) {
    el.classList.add("d-none");
  }

  /* ---------------- State UI ---------------- */
  let currentUser = null;
  let orderTabStatus = ""; // "" = semua status

  const PAGE_META = {
    dashboard: { title: "Dashboard", subtitle: "Ringkasan aktivitas usaha Anda" },
    orders:    { title: "Pesanan",   subtitle: "Kelola pesanan dan status layanan" },
    items:     { title: "Barang",    subtitle: "Inventori produk dan stok" },
    services:  { title: "Layanan",   subtitle: "Kelola jenis layanan dan harganya" },
    reports:   { title: "Laporan",   subtitle: "Analisis pendapatan dan rekap pesanan" },
  };

  /* ---------------- Modal Konfirmasi ---------------- */
  // Dialog konfirmasi terpadu untuk setiap aksi (lebih realistis daripada confirm()).
  let confirmCallback = null;
  let confirmCheckRequired = false;

  function askConfirm(message, opts = {}) {
    const title = opts.title || "Konfirmasi";
    const yesText = opts.yesText || "Ya, Lanjutkan";
    const yesClass = opts.yesClass || "btn-primary";
    $("#confirmTitle").textContent = title;
    $("#confirmMessage").textContent = message;
    const yesBtn = $("#confirmYes");
    yesBtn.textContent = yesText;
    yesBtn.className = "btn " + yesClass;

    // Checkbox wajib (mis. konfirmasi pembayaran sudah diterima)
    const checkWrap = $("#confirmCheckWrap");
    const checkInput = $("#confirmCheck");
    if (opts.checkbox) {
      $("#confirmCheckLabel").textContent = opts.checkbox;
      checkInput.checked = false;
      confirmCheckRequired = true;
      checkWrap.classList.remove("d-none");
    } else {
      confirmCheckRequired = false;
      checkInput.checked = false;
      checkWrap.classList.add("d-none");
    }

    confirmCallback = typeof opts.onConfirm === "function" ? opts.onConfirm : null;
    bootstrap.Modal.getOrCreateInstance($("#confirmModal")).show();
  }

  function runConfirm() {
    if (confirmCheckRequired && !$("#confirmCheck").checked) {
      // Jangan lanjut sebelum checkbox wajib dicentang
      $("#confirmCheck").classList.add("is-invalid");
      return;
    }
    const cb = confirmCallback;
    confirmCallback = null;
    confirmCheckRequired = false;
    bootstrap.Modal.getOrCreateInstance($("#confirmModal")).hide();
    if (cb) cb();
  }

  /* ---------------- Autentikasi ---------------- */
  // Akun admin tetap (tanpa registrasi).
  const ADMIN = {
    id: "u-admin",
    username: "admin",
    password: "admin123",
    name: "Admin",
    email: "admin@carsotocare.local",
  };

  function initAuth() {
    const session = db.session();
    if (session && session.userId === ADMIN.id) {
      currentUser = ADMIN;
      showApp();
      return;
    }
    showAuth();
  }

  function showAuth() {
    $("#appScreen").classList.add("d-none");
    $("#authScreen").classList.remove("d-none");
  }

  function showApp() {
    $("#authScreen").classList.add("d-none");
    $("#appScreen").classList.remove("d-none");
    $("#userName").textContent = currentUser.name;
    $("#userEmail").textContent = currentUser.email;
    $("#userInitial").textContent = (currentUser.name || "U").charAt(0).toUpperCase();
    navigate("dashboard");
  }

  function handleLogin(e) {
    e.preventDefault();
    hideAlert($("#authAlert"));
    const username = $("#loginUsername").value.trim().toLowerCase();
    const pass = $("#loginPassword").value;
    if (username !== ADMIN.username || pass !== ADMIN.password) {
      showAlert($("#authAlert"), "danger", "Username atau kata sandi salah.");
      return;
    }
    db.saveSession({ userId: ADMIN.id, loginAt: new Date().toISOString() });
    currentUser = ADMIN;
    $("#loginForm").reset();
    showApp();
  }

  function handleLogout() {
    askConfirm("Yakin ingin keluar dari aplikasi?", {
      title: "Keluar",
      yesText: "Ya, Keluar",
      yesClass: "btn-danger",
      onConfirm: () => {
        db.clearSession();
        currentUser = null;
        showAuth();
      },
    });
  }

  /* ---------------- Navigasi ---------------- */
  function navigate(page) {
    if (!PAGE_META[page]) return;
    $$(".page").forEach((p) => p.classList.add("d-none"));
    $("#page-" + page).classList.remove("d-none");
    $$(".sidebar .nav-link").forEach((n) =>
      n.classList.toggle("active", n.dataset.page === page)
    );
    $("#pageTitle").textContent = PAGE_META[page].title;
    $("#pageSubtitle").textContent = PAGE_META[page].subtitle;

    if (page === "dashboard") renderDashboard();
    if (page === "orders") renderOrders();
    if (page === "items") renderItems();
    if (page === "services") renderServices();
    if (page === "reports") renderReports();

    // Tutup sidebar di layar kecil
    $("#sidebar").classList.remove("open");
  }

  /* ---------------- Dashboard ---------------- */
  function updateOrdersDot() {
    const unprocessed = db.orders().filter((o) => o.status === "baru").length;
    $("#ordersNavDot").classList.toggle("d-none", unprocessed === 0);
  }

  function renderDashboard() {
    updateOrdersDot();
    const orders = db.orders();
    const items = db.items();

    const totalRevenue = orders
      .filter((o) => ["selesai", "diambil"].includes(o.status))
      .reduce((s, o) => s + (Number(o.price) || 0), 0);
    const activeCount = orders.filter((o) => ["baru", "proses"].includes(o.status)).length;
    const lowStock = items.filter((i) => (Number(i.stock) || 0) <= LOW_STOCK_THRESHOLD);

    const cards = [
      { cls: "bg-gold",      icon: "bi-receipt",            value: orders.length,          label: "Total Pesanan" },
      { cls: "bg-gold-deep", icon: "bi-cash-stack",         value: formatIDR(totalRevenue), label: "Pendapatan (Selesai)" },
      { cls: "bg-ink",       icon: "bi-hourglass-split",    value: activeCount,            label: "Sedang Diproses" },
      { cls: "bg-alert",     icon: "bi-exclamation-triangle", value: lowStock.length,      label: "Stok Menipis" },
    ];

    $("#statCards").innerHTML = cards
      .map((c) => `
        <div class="col-sm-6 col-xl-3">
          <div class="stat-card ${c.cls}">
            <div class="d-flex justify-content-between align-items-start mb-3">
              <div class="icon"><i class="bi ${c.icon}"></i></div>
            </div>
            <div class="value">${c.value}</div>
            <div class="label">${c.label}</div>
          </div>
        </div>`)
      .join("");

    // Pesanan terbaru
    const recent = [...orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
    if (!recent.length) {
      $("#recentOrders").innerHTML = '<div class="text-muted text-center py-4">Belum ada pesanan.</div>';
    } else {
      $("#recentOrders").innerHTML = `
        <ul class="list-group list-group-flush">
          ${recent.map((o) => `
            <li class="list-group-item d-flex justify-content-between align-items-center px-0">
              <div>
                <div class="fw-semibold">${esc(o.customerName)}</div>
                <div class="text-muted small">${esc(o.plate)} · ${esc(o.serviceType)}</div>
              </div>
              <div class="text-end">
                <span class="status-badge ${STATUS[o.status].cls}">${STATUS[o.status].label}</span>
                <div class="text-muted small">${formatDate(o.createdAt)}</div>
              </div>
            </li>`).join("")}
        </ul>`;
    }

    // Stok menipis
    if (!lowStock.length) {
      $("#lowStock").innerHTML = '<div class="text-muted text-center py-4">Semua stok aman.</div>';
    } else {
      $("#lowStock").innerHTML = `
        <ul class="list-group list-group-flush">
          ${lowStock.slice(0, 6).map((i) => `
            <li class="list-group-item d-flex justify-content-between align-items-center px-0">
              <span>${esc(i.name)}</span>
              <span class="badge ${Number(i.stock) <= 0 ? "bg-danger" : "stock-low"}">${i.stock}</span>
            </li>`).join("")}
        </ul>`;
    }
  }

  /* ---------------- Pesanan ---------------- */
  const ORDER_STATUS_TABS = [
    { key: "",        label: "Semua" },
    { key: "baru",    label: "Belum Diproses" },
    { key: "proses",  label: "Diproses" },
    { key: "selesai", label: "Selesai" },
    { key: "diambil", label: "LUNAS" },
  ];

  function renderOrderTabs() {
    const orders = db.orders();
    const counts = {};
    orders.forEach((o) => { counts[o.status] = (counts[o.status] || 0) + 1; });
    $("#orderStatusTabs").innerHTML = ORDER_STATUS_TABS.map((t) => {
      const count = t.key ? (counts[t.key] || 0) : orders.length;
      return `
        <button type="button" class="order-status-tab${orderTabStatus === t.key ? " active" : ""}" data-status="${t.key}">
          <span>${t.label}</span>
          <span class="tab-count">${count}</span>
        </button>`;
    }).join("");
  }

  // Banner peringatan pesanan yang belum diproses
  function renderOrderAlert() {
    const unprocessed = db.orders().filter((o) => o.status === "baru").length;
    const el = $("#orderAlert");
    if (unprocessed > 0) {
      $("#orderAlertText").textContent =
        "Ada " + unprocessed + " pesanan yang belum diproses. Segera tindak lanjuti.";
      el.classList.remove("d-none");
    } else {
      el.classList.add("d-none");
    }
  }

  function renderOrders() {
    renderOrderTabs();
    renderOrderAlert();
    const q = ($("#orderSearch").value || "").toLowerCase();
    const status = orderTabStatus;
    let orders = db.orders();

    if (q) {
      orders = orders.filter((o) =>
        (o.customerName || "").toLowerCase().includes(q) ||
        (o.plate || "").toLowerCase().includes(q) ||
        (o.code || "").toLowerCase().includes(q));
    }
    if (status) orders = orders.filter((o) => o.status === status);
    orders = [...orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const tbody = $("#ordersTableBody");
    $("#ordersEmpty").classList.toggle("d-none", orders.length > 0);

    if (!orders.length) {
      tbody.innerHTML = "";
      return;
    }

    tbody.innerHTML = orders.map((o) => {
      const idx = STATUS_FLOW.indexOf(o.status);
      const next = STATUS_FLOW[idx + 1];
      return `
        <tr>
          <td class="fw-semibold">${esc(o.code)}</td>
          <td>
            <div>${esc(o.customerName)}</div>
            <div class="text-muted small">${esc(o.phone || "-")}</div>
          </td>
          <td>
            <div>${esc(o.plate)}</div>
            <div class="text-muted small">${esc(o.carType)}</div>
          </td>
          <td>${esc(o.serviceType)}</td>
          <td>${formatIDR(o.price)}</td>
          <td><span class="status-badge ${STATUS[o.status].cls}">${STATUS[o.status].label}</span></td>
          <td>${formatDate(o.createdAt)}</td>
          <td class="text-end text-nowrap">
            <button class="action-btn" title="Struk / QR" data-action="receipt" data-id="${o.id}"><i class="bi bi-qr-code"></i></button>
            <button class="action-btn" title="Edit" data-action="edit" data-id="${o.id}"><i class="bi bi-pencil-square"></i></button>
            ${next ? `<button class="action-btn" title="Tandai ${STATUS[next].label}" data-action="next" data-id="${o.id}"><i class="bi bi-arrow-right-circle"></i></button>` : ""}
            <button class="action-btn danger" title="Hapus" data-action="delete" data-id="${o.id}"><i class="bi bi-trash3"></i></button>
          </td>
        </tr>`;
    }).join("");
  }

  // Baris pilihan barang dalam form pesanan
  function orderItemRowHTML(items, sel) {
    const selectedId = sel ? sel.itemId : "";
    const qty = (sel && sel.qty) ? sel.qty : 1;
    const opts = items.map((i) => {
      const s = i.id === selectedId ? " selected" : "";
      return `<option value="${i.id}" data-name="${esc(i.name)}" data-price="${Number(i.price) || 0}"${s}>${esc(i.name)} (stok: ${Number(i.stock) || 0}) — ${formatIDR(i.price)}</option>`;
    }).join("");
    return `
      <div class="order-item-row d-flex gap-2 align-items-center mb-2">
        <select class="form-select form-select-sm order-item-select">
          <option value="">-- Pilih Barang --</option>
          ${opts}
        </select>
        <input type="number" class="form-control form-control-sm order-item-qty" min="1" value="${qty}" style="max-width:80px" title="Jumlah">
        <button type="button" class="btn btn-sm btn-outline-danger order-item-remove" title="Hapus"><i class="bi bi-x-lg"></i></button>
      </div>`;
  }

  function renderOrderItems(selected) {
    const items = db.items();
    const rows = (selected && selected.length) ? selected : [{}];
    $("#orderItemsList").innerHTML = rows.map((s) => orderItemRowHTML(items, s)).join("");
  }

  function orderItemsFromForm() {
    const items = db.items();
    const out = [];
    $$("#orderItemsList .order-item-row").forEach((row) => {
      const sel = row.querySelector(".order-item-select");
      const qty = Number(row.querySelector(".order-item-qty").value) || 0;
      if (!sel.value || qty < 1) return;
      const it = items.find((x) => x.id === sel.value);
      out.push({ itemId: sel.value, name: it ? it.name : "Barang", qty, price: it ? (Number(it.price) || 0) : 0 });
    });
    return out;
  }

  // Hitung harga otomatis: subtotal barang + biaya service mekanik
  function orderPriceCalc() {
    const items = orderItemsFromForm();
    const subtotal = items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
    const fee = Number($("#orderServiceFee").value) || 0;
    return { subtotal, fee, total: subtotal + fee };
  }

  function recalculateOrderPrice() {
    const { subtotal, fee, total } = orderPriceCalc();
    $("#orderSubtotal").textContent = formatIDR(subtotal);
    $("#orderFeeDisplay").textContent = formatIDR(fee);
    $("#orderTotalDisplay").textContent = formatIDR(total);
  }

  // delta positif = kurangi stok, negatif = kembalikan stok
  function applyStockDelta(deltas) {
    const items = db.items();
    items.forEach((it) => {
      if (deltas[it.id]) {
        it.stock = (Number(it.stock) || 0) - deltas[it.id];
        if (it.stock < 0) it.stock = 0;
      }
    });
    db.saveItems(items);
  }

  function openOrderForm(id) {
    const form = $("#orderForm");
    form.reset();
    $("#orderId").value = "";
    $("#orderModalTitle").textContent = "Pesanan Baru";
    let items = [];
    let serviceName = "";
    let serviceFee = 0;

    if (id) {
      const o = db.orders().find((x) => x.id === id);
      if (o) {
        $("#orderModalTitle").textContent = "Edit Pesanan";
        $("#orderId").value = o.id;
        $("#orderCustomer").value = o.customerName;
        $("#orderPhone").value = o.phone || "";
        $("#orderPlate").value = o.plate;
        $("#orderCarType").value = o.carType;
        serviceName = o.serviceType || "";
        serviceFee = (o.serviceFee != null ? o.serviceFee : 0);
        $("#orderNotes").value = o.notes || "";
        items = o.items || [];
      }
    }

    // Isi dropdown layanan dari data terbaru, lalu pilih sesuai pesanan
    renderServiceOptions(serviceName || undefined);

    if (id) {
      $("#orderServiceFee").value = serviceFee;
    } else {
      // Pesanan baru: default tanpa layanan → biaya service 0
      $("#orderServiceFee").value = 0;
    }

    renderOrderItems(items);
    recalculateOrderPrice();
    bootstrap.Modal.getOrCreateInstance($("#orderModal")).show();
  }

  function saveOrder(e) {
    e.preventDefault();
    const id = $("#orderId").value;
    const customerName = $("#orderCustomer").value.trim();
    const plate = $("#orderPlate").value.trim();
    if (!customerName || !plate) {
      alert("Nama pelanggan dan plat nomor wajib diisi.");
      return;
    }
    const isEdit = !!id;
    askConfirm(
      isEdit ? "Simpan perubahan pada pesanan ini?" : "Simpan pesanan baru ini?",
      {
        title: "Simpan Pesanan",
        yesText: "Ya, Simpan",
        onConfirm: () => persistOrder(id),
      }
    );
  }

  function persistOrder(id) {
    const data = {
      customerName: $("#orderCustomer").value.trim(),
      phone: $("#orderPhone").value.trim(),
      plate: $("#orderPlate").value.trim(),
      carType: $("#orderCarType").value,
      serviceType: $("#orderService").value.trim() || "Tanpa Layanan",
      notes: $("#orderNotes").value.trim(),
    };

    const newItems = orderItemsFromForm();
    const calc = orderPriceCalc();
    data.itemSubtotal = calc.subtotal;
    data.serviceFee = calc.fee;
    data.price = calc.total;
    const orders = db.orders();
    const items = db.items();

    // Hitung selisih stok (edit: kembalikan barang lama, kurangi barang baru)
    const deltas = {};
    if (id) {
      const existing = orders.find((x) => x.id === id);
      if (existing && existing.items) {
        existing.items.forEach((oi) => { deltas[oi.itemId] = (deltas[oi.itemId] || 0) - Number(oi.qty || 0); });
      }
    }
    newItems.forEach((fi) => { deltas[fi.itemId] = (deltas[fi.itemId] || 0) + Number(fi.qty || 0); });

    // Validasi kecukupan stok untuk penambahan bersih
    for (const iid of Object.keys(deltas)) {
      const d = deltas[iid];
      if (d <= 0) continue;
      const it = items.find((x) => x.id === iid);
      if (it && (Number(it.stock) || 0) < d) {
        alert("Stok \"" + it.name + "\" tidak cukup. Sisa stok: " + (Number(it.stock) || 0) + ".");
        return;
      }
    }

    // Terapkan perubahan stok
    applyStockDelta(deltas);

    data.items = newItems;

    if (id) {
      const idx = orders.findIndex((x) => x.id === id);
      if (idx >= 0) {
        orders[idx] = { ...orders[idx], ...data };
      }
    } else {
      orders.push({
        ...data,
        id: uid("o"),
        code: "ORD-" + new Date().getFullYear() + "-" + String(orders.length + 1).padStart(4, "0"),
        status: "baru",
        createdAt: new Date().toISOString(),
      });
    }
    db.saveOrders(orders);
    bootstrap.Modal.getOrCreateInstance($("#orderModal")).hide();
    renderOrders();
    renderItems();
    renderDashboard();
  }

  function advanceOrder(id) {
    const orders = db.orders();
    const order = orders.find((x) => x.id === id);
    if (!order) return;
    const i = STATUS_FLOW.indexOf(order.status);
    if (i < 0 || i >= STATUS_FLOW.length - 1) return;
    const nextStatus = STATUS_FLOW[i + 1];

    // Saat menandai "LUNAS", wajib konfirmasi bahwa pembayaran sudah diterima.
    if (nextStatus === "diambil") {
      askConfirm(
        "Pesanan \"" + (order.code || "") + "\" — Total: " + formatIDR(order.price) +
        ". Konfirmasi pembayaran dari pelanggan sudah diterima?",
        {
          title: "Konfirmasi Pembayaran",
          yesText: "Ya, Sudah Bayar",
          yesClass: "btn-success",
          checkbox: "Pembayaran sudah diterima (LUNAS)",
          onConfirm: () => applyStatusChange(id, nextStatus),
        }
      );
      return;
    }

    askConfirm(
      "Ubah status pesanan \"" + (order.code || "") + "\" menjadi \"" + STATUS[nextStatus].label + "\"?",
      {
        title: "Ubah Status Pesanan",
        yesText: "Ya, " + STATUS[nextStatus].label,
        onConfirm: () => applyStatusChange(id, nextStatus),
      }
    );
  }

  function applyStatusChange(id, nextStatus) {
    const fresh = db.orders();
    const idx = fresh.findIndex((x) => x.id === id);
    if (idx < 0) return;
    fresh[idx].status = nextStatus;
    db.saveOrders(fresh);
    renderOrders();
    renderDashboard();
  }

  function deleteOrder(id) {
    const order = db.orders().find((x) => x.id === id);
    if (!order) return;
    askConfirm(
      "Hapus pesanan \"" + (order.code || "") + "\"? Stok barang yang terpakai akan dikembalikan.",
      {
        title: "Hapus Pesanan",
        yesText: "Ya, Hapus",
        yesClass: "btn-danger",
        onConfirm: () => {
          const orders = db.orders();
          const target = orders.find((x) => x.id === id);
          if (target && target.items && target.items.length) {
            const items = db.items();
            target.items.forEach((oi) => {
              const it = items.find((x) => x.id === oi.itemId);
              if (it) it.stock = (Number(it.stock) || 0) + (Number(oi.qty) || 0);
            });
            db.saveItems(items);
          }
          db.saveOrders(orders.filter((x) => x.id !== id));
          renderOrders();
          renderItems();
          renderDashboard();
        },
      }
    );
  }

  /* ---------------- Struk & QR ---------------- */
  function openReceipt(id) {
    const o = db.orders().find((x) => x.id === id);
    if (!o) return;

    $("#receiptBody").innerHTML = `
      <div class="d-flex justify-content-between"><span>Kode</span><strong>${esc(o.code)}</strong></div>
      <div class="d-flex justify-content-between"><span>Tanggal</span><strong>${formatDate(o.createdAt)}</strong></div>
      <hr class="my-2">
      <div class="d-flex justify-content-between"><span>Pelanggan</span><strong>${esc(o.customerName)}</strong></div>
      <div class="d-flex justify-content-between"><span>Plat</span><strong>${esc(o.plate)}</strong></div>
      <div class="d-flex justify-content-between"><span>Kendaraan</span><strong>${esc(o.carType)}</strong></div>
      <div class="d-flex justify-content-between"><span>Layanan</span><strong>${esc(o.serviceType)}</strong></div>
      ${o.items && o.items.length ? `
      <hr class="my-2">
      <div class="mb-1">Barang Terpakai</div>
      ${o.items.map((it) => {
        const p = Number(it.price) || 0;
        const sub = p * (Number(it.qty) || 0);
        return `<div class="d-flex justify-content-between small text-muted"><span>${esc(it.name)} × ${it.qty}</span><span>${formatIDR(sub)}</span></div>`;
      }).join("")}
      ` : ""}
      <hr class="my-2">
      <div class="d-flex justify-content-between"><span>Subtotal Barang</span><strong>${formatIDR(o.itemSubtotal || 0)}</strong></div>
      <div class="d-flex justify-content-between"><span>Biaya Service Mekanik</span><strong>${formatIDR(o.serviceFee || 0)}</strong></div>
      <div class="d-flex justify-content-between"><span>Total</span><strong>${formatIDR(o.price)}</strong></div>
      <div class="d-flex justify-content-between"><span>Status</span><strong>${STATUS[o.status].label}</strong></div>
    `;

    // QR code
    const qrBox = $("#qrBox");
    qrBox.innerHTML = "";
    const payload = JSON.stringify({
      app: "CarsotoCare",
      code: o.code,
      customer: o.customerName,
      plate: o.plate,
      service: o.serviceType,
      items: (o.items || []).map((it) => it.name + " x" + it.qty),
      price: o.price,
      status: o.status,
      date: o.createdAt,
    });
    try {
      new QRCode(qrBox, { text: payload, width: 150, height: 150, correctLevel: QRCode.CorrectLevel.M });
    } catch (err) {
      qrBox.innerHTML = '<div class="text-muted small">QR tidak dapat dimuat.</div>';
    }

    bootstrap.Modal.getOrCreateInstance($("#receiptModal")).show();
  }

  /* ---------------- Barang ---------------- */
  function renderItems() {
    const q = ($("#itemSearch").value || "").toLowerCase();
    let items = db.items();
    if (q) items = items.filter((i) => (i.name || "").toLowerCase().includes(q));
    items = [...items].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    const tbody = $("#itemsTableBody");
    $("#itemsEmpty").classList.toggle("d-none", items.length > 0);

    if (!items.length) {
      tbody.innerHTML = "";
      return;
    }

    tbody.innerHTML = items.map((i) => {
      const stock = Number(i.stock) || 0;
      const badge = stock <= 0
        ? '<span class="badge bg-danger">Habis</span>'
        : stock <= LOW_STOCK_THRESHOLD
          ? '<span class="badge stock-low">Menipis</span>'
          : '<span class="badge bg-success">Tersedia</span>';
      return `
        <tr>
          <td class="fw-semibold">${esc(i.name)}</td>
          <td>${esc(i.category)}</td>
          <td>${stock}</td>
          <td>${formatIDR(i.cost)}</td>
          <td>${formatIDR(i.price)}</td>
          <td>${badge}</td>
          <td class="text-end text-nowrap">
            <button class="action-btn" title="Edit" data-action="edit" data-id="${i.id}"><i class="bi bi-pencil-square"></i></button>
            <button class="action-btn danger" title="Hapus" data-action="delete" data-id="${i.id}"><i class="bi bi-trash3"></i></button>
          </td>
        </tr>`;
    }).join("");
  }

  function openItemForm(id) {
    const form = $("#itemForm");
    form.reset();
    $("#itemId").value = "";
    $("#itemModalTitle").textContent = "Tambah Barang";

    if (id) {
      const i = db.items().find((x) => x.id === id);
      if (i) {
        $("#itemModalTitle").textContent = "Edit Barang";
        $("#itemId").value = i.id;
        $("#itemName").value = i.name;
        $("#itemCategory").value = i.category;
        $("#itemStock").value = i.stock;
        $("#itemCost").value = i.cost;
        $("#itemPrice").value = i.price;
      }
    }
    bootstrap.Modal.getOrCreateInstance($("#itemModal")).show();
  }

  function saveItem(e) {
    e.preventDefault();
    const id = $("#itemId").value;
    const name = $("#itemName").value.trim();
    if (!name) {
      alert("Nama barang wajib diisi.");
      return;
    }
    const isEdit = !!id;
    askConfirm(
      isEdit ? "Simpan perubahan pada barang ini?" : "Simpan barang baru ini?",
      {
        title: "Simpan Barang",
        yesText: "Ya, Simpan",
        onConfirm: () => persistItem(id),
      }
    );
  }

  function persistItem(id) {
    const data = {
      name: $("#itemName").value.trim(),
      category: $("#itemCategory").value,
      stock: Number($("#itemStock").value) || 0,
      cost: Number($("#itemCost").value) || 0,
      price: Number($("#itemPrice").value) || 0,
    };
    const items = db.items();
    if (id) {
      const idx = items.findIndex((x) => x.id === id);
      if (idx >= 0) items[idx] = { ...items[idx], ...data };
    } else {
      items.push({ ...data, id: uid("i"), createdAt: new Date().toISOString() });
    }
    db.saveItems(items);
    bootstrap.Modal.getOrCreateInstance($("#itemModal")).hide();
    renderItems();
    renderDashboard();
  }

  function deleteItem(id) {
    const item = db.items().find((x) => x.id === id);
    if (!item) return;
    askConfirm(
      "Hapus barang \"" + (item.name || "") + "\"?",
      {
        title: "Hapus Barang",
        yesText: "Ya, Hapus",
        yesClass: "btn-danger",
        onConfirm: () => {
          db.saveItems(db.items().filter((x) => x.id !== id));
          renderItems();
          renderDashboard();
        },
      }
    );
  }

  /* ---------------- Layanan ---------------- */
  // Isi dropdown layanan pada form pesanan dari data terbaru
  function renderServiceOptions(selectedName) {
    const services = db.services();
    const sel = $("#orderService");
    const noneLabel = "Tanpa Layanan";
    const isNone = !selectedName || selectedName === noneLabel;
    // Opsi pertama: tidak memilih layanan (biaya service = 0)
    let options = `<option value=""${isNone ? " selected" : ""}>${noneLabel}</option>`;
    options += services.map((s) =>
      `<option value="${esc(s.name)}"${s.name === selectedName ? " selected" : ""}>${esc(s.name)} — ${formatIDR(s.price)}</option>`
    ).join("");
    // Pertahankan layanan lama yang tidak lagi ada di daftar (saat edit pesanan)
    if (!isNone && !services.some((s) => s.name === selectedName)) {
      options = `<option value="${esc(selectedName)}" selected>${esc(selectedName)}</option>` + options;
    }
    sel.innerHTML = options;
  }

  function renderServices() {
    const q = ($("#serviceSearch").value || "").toLowerCase();
    let services = db.services();
    if (q) services = services.filter((s) => (s.name || "").toLowerCase().includes(q));
    services = [...services].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    const tbody = $("#servicesTableBody");
    $("#servicesEmpty").classList.toggle("d-none", services.length > 0);

    if (!services.length) {
      tbody.innerHTML = "";
      return;
    }

    tbody.innerHTML = services.map((s) => `
      <tr>
        <td class="fw-semibold">${esc(s.name)}</td>
        <td class="text-end">${formatIDR(s.price)}</td>
        <td class="text-end text-nowrap">
          <button class="action-btn" title="Edit" data-action="edit" data-id="${s.id}"><i class="bi bi-pencil-square"></i></button>
          <button class="action-btn danger" title="Hapus" data-action="delete" data-id="${s.id}"><i class="bi bi-trash3"></i></button>
        </td>
      </tr>`).join("");
  }

  function openServiceForm(id) {
    const form = $("#serviceForm");
    form.reset();
    $("#serviceId").value = "";
    $("#serviceModalTitle").textContent = "Tambah Layanan";

    if (id) {
      const s = db.services().find((x) => x.id === id);
      if (s) {
        $("#serviceModalTitle").textContent = "Edit Layanan";
        $("#serviceId").value = s.id;
        $("#serviceName").value = s.name;
        $("#servicePrice").value = s.price;
      }
    }
    bootstrap.Modal.getOrCreateInstance($("#serviceModal")).show();
  }

  function saveService(e) {
    e.preventDefault();
    const id = $("#serviceId").value;
    const name = $("#serviceName").value.trim();
    const price = Number($("#servicePrice").value) || 0;
    if (!name) {
      alert("Nama layanan wajib diisi.");
      return;
    }
    const isEdit = !!id;
    askConfirm(
      isEdit ? "Simpan perubahan pada layanan ini?" : "Simpan layanan baru ini?",
      {
        title: "Simpan Layanan",
        yesText: "Ya, Simpan",
        onConfirm: () => persistService(id, name, price),
      }
    );
  }

  function persistService(id, name, price) {
    const services = db.services();
    if (id) {
      const idx = services.findIndex((x) => x.id === id);
      if (idx >= 0) services[idx] = { ...services[idx], name, price };
    } else {
      services.push({ id: uid("svc"), name, price });
    }
    db.saveServices(services);
    bootstrap.Modal.getOrCreateInstance($("#serviceModal")).hide();
    renderServices();
  }

  function deleteService(id) {
    const svc = db.services().find((x) => x.id === id);
    if (!svc) return;
    askConfirm(
      "Hapus layanan \"" + (svc.name || "") + "\"?",
      {
        title: "Hapus Layanan",
        yesText: "Ya, Hapus",
        yesClass: "btn-danger",
        onConfirm: () => {
          db.saveServices(db.services().filter((x) => x.id !== id));
          renderServices();
        },
      }
    );
  }

  /* ---------------- Laporan ---------------- */
  function reportFiltered() {
    let orders = db.orders();
    const from = $("#reportFrom").value;
    const to = $("#reportTo").value;
    if (from) orders = orders.filter((o) => (o.createdAt || "").slice(0, 10) >= from);
    if (to) orders = orders.filter((o) => (o.createdAt || "").slice(0, 10) <= to);
    return orders;
  }

  function renderReports() {
    const orders = reportFiltered().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const revenue = orders.filter((o) => ["selesai", "diambil"].includes(o.status))
      .reduce((s, o) => s + (Number(o.price) || 0), 0);

    const byService = {};
    orders.forEach((o) => {
      byService[o.serviceType] = (byService[o.serviceType] || 0) + 1;
    });

    $("#reportSummary").innerHTML = `
      <div class="col-md-4">
        <div class="stat-card bg-gold">
          <div class="icon mb-3"><i class="bi bi-receipt"></i></div>
          <div class="value">${orders.length}</div>
          <div class="label">Total Pesanan</div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="stat-card bg-gold-deep">
          <div class="icon mb-3"><i class="bi bi-cash-stack"></i></div>
          <div class="value">${formatIDR(revenue)}</div>
          <div class="label">Pendapatan (Selesai)</div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="stat-card bg-ink">
          <div class="icon mb-3"><i class="bi bi-tags"></i></div>
          <div class="value">${Object.keys(byService).length}</div>
          <div class="label">Jenis Layanan</div>
        </div>
      </div>`;

    const tbody = $("#reportTableBody");
    if (!orders.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Tidak ada data pada rentang tanggal ini.</td></tr>';
      return;
    }
    tbody.innerHTML = orders.map((o) => `
      <tr>
        <td class="fw-semibold">${esc(o.code)}</td>
        <td>${esc(o.customerName)}</td>
        <td>${esc(o.serviceType)}</td>
        <td><span class="status-badge ${STATUS[o.status].cls}">${STATUS[o.status].label}</span></td>
        <td>${formatDate(o.createdAt)}</td>
        <td class="text-end">${formatIDR(o.price)}</td>
      </tr>`).join("");
  }

  function exportPDF() {
    const orders = reportFiltered().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const revenue = orders.filter((o) => ["selesai", "diambil"].includes(o.status))
      .reduce((s, o) => s + (Number(o.price) || 0), 0);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

    doc.setFontSize(16);
    doc.setTextColor(169, 128, 32);
    doc.text("CarsotoCare", 14, 20);
    doc.setFontSize(11);
    doc.setTextColor(30);
    doc.text("Laporan Pesanan", 14, 28);
    doc.setFontSize(9);
    doc.setTextColor(100);
    const range = ($("#reportFrom").value ? "Dari " + formatDate($("#reportFrom").value) : "Semua tanggal") +
      ($("#reportTo").value ? " s/d " + formatDate($("#reportTo").value) : "");
    doc.text("Periode: " + range, 14, 34);
    doc.text("Dibuat: " + new Date().toLocaleString("id-ID"), 14, 39);

    doc.autoTable({
      startY: 44,
      head: [["Kode", "Pelanggan", "Layanan", "Status", "Tanggal", "Harga"]],
      body: orders.map((o) => [
        o.code,
        o.customerName,
        o.serviceType,
        STATUS[o.status].label,
        formatDate(o.createdAt),
        formatIDR(o.price),
      ]),
      styles: { fontSize: 8.5 },
      headStyles: { fillColor: [169, 128, 32] },
    });

    let y = doc.lastAutoTable.finalY + 8;
    doc.setFontSize(10);
    doc.setTextColor(30);
    doc.text("Total Pesanan: " + orders.length, 14, y);
    doc.text("Total Pendapatan (Selesai): " + formatIDR(revenue), 14, y + 6);

    doc.save("laporan-carsotocare.pdf");
  }

  function printReceipt() {
    window.print();
  }

  /* ---------------- Event Binding ---------------- */
  function bindEvents() {
    // Auth
    $("#loginForm").addEventListener("submit", handleLogin);
    $$("[data-toggle-pass]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const input = $("#" + btn.dataset.togglePass);
        input.type = input.type === "password" ? "text" : "password";
      });
    });

    // Logout
    $("#logoutBtn").addEventListener("click", handleLogout);

    // Modal konfirmasi
    $("#confirmYes").addEventListener("click", runConfirm);

    // Navigasi sidebar + tombol "Lihat Semua"
    $$("[data-page]").forEach((el) => {
      el.addEventListener("click", () => navigate(el.dataset.page));
    });

    // Toggle sidebar mobile
    $("#sidebarToggle").addEventListener("click", () => $("#sidebar").classList.toggle("open"));

    // Pesanan
    $("#btnAddOrder").addEventListener("click", () => openOrderForm());
    $("#btnAddOrderItem").addEventListener("click", () => {
      $("#orderItemsList").insertAdjacentHTML("beforeend", orderItemRowHTML(db.items(), {}));
    });
    $("#orderItemsList").addEventListener("click", (e) => {
      const btn = e.target.closest(".order-item-remove");
      if (!btn) return;
      btn.closest(".order-item-row").remove();
      if (!$("#orderItemsList").children.length) {
        $("#orderItemsList").innerHTML = orderItemRowHTML(db.items(), {});
      }
      recalculateOrderPrice();
    });
    $("#orderForm").addEventListener("submit", saveOrder);
    $("#orderSearch").addEventListener("input", renderOrders);
    $("#orderStatusTabs").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-status]");
      if (!btn) return;
      orderTabStatus = btn.dataset.status;
      renderOrders();
    });
    // Harga otomatis: hitung ulang saat barang / qty / biaya service berubah
    $("#orderServiceFee").addEventListener("input", recalculateOrderPrice);
    // Pilih layanan → isi otomatis biaya service dari harga layanan
    $("#orderService").addEventListener("change", (e) => {
      const svc = db.services().find((s) => s.name === e.target.value);
      $("#orderServiceFee").value = svc ? (Number(svc.price) || 0) : 0;
      recalculateOrderPrice();
    });
    $("#orderItemsList").addEventListener("input", (e) => {
      if (e.target.matches(".order-item-select, .order-item-qty")) recalculateOrderPrice();
    });
    $("#ordersTableBody").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const { action, id } = btn.dataset;
      if (action === "edit") openOrderForm(id);
      else if (action === "receipt") openReceipt(id);
      else if (action === "next") advanceOrder(id);
      else if (action === "delete") deleteOrder(id);
    });

    // Barang
    $("#btnAddItem").addEventListener("click", () => openItemForm());
    $("#itemForm").addEventListener("submit", saveItem);
    $("#itemSearch").addEventListener("input", renderItems);
    $("#itemsTableBody").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const { action, id } = btn.dataset;
      if (action === "edit") openItemForm(id);
      else if (action === "delete") deleteItem(id);
    });

    // Layanan
    $("#btnAddService").addEventListener("click", () => openServiceForm());
    $("#serviceForm").addEventListener("submit", saveService);
    $("#serviceSearch").addEventListener("input", renderServices);
    $("#servicesTableBody").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const { action, id } = btn.dataset;
      if (action === "edit") openServiceForm(id);
      else if (action === "delete") deleteService(id);
    });

    // Laporan
    $("#btnApplyReport").addEventListener("click", renderReports);
    $("#btnResetReport").addEventListener("click", () => {
      $("#reportFrom").value = "";
      $("#reportTo").value = "";
      renderReports();
    });
    $("#btnExportPDF").addEventListener("click", exportPDF);

    // Receipt
    $("#btnPrintReceipt").addEventListener("click", printReceipt);
  }

  /* ---------------- Init ---------------- */
  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    initAuth();
  });
})();
