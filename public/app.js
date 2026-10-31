const CATEGORIES = {
  productivity: "效率",
  developer: "开发",
  finance: "金融",
  fun: "娱乐",
  system: "系统",
  other: "其他",
};

const pluginGrid = document.querySelector("#plugins");
const count = document.querySelector("#count");
const status = document.querySelector("#status");
const searchForm = document.querySelector("#search-form");
const searchInput = document.querySelector("#search");
const categoryFilter = document.querySelector("#category");
const sortFilter = document.querySelector("#sort");
const featuredFilter = document.querySelector("#featured");
const uploadForm = document.querySelector("#upload-form");
const uploadStatus = document.querySelector("#upload-status");
const uploadPanel = document.querySelector("#upload-panel");
const myPanel = document.querySelector("#my-panel");
const myList = document.querySelector("#my-list");
const myStatus = document.querySelector("#my-status");
const adminPanel = document.querySelector("#admin-panel");
const adminList = document.querySelector("#admin-list");
const adminStatus = document.querySelector("#admin-status");
const loginForm = document.querySelector("#login-form");
const authStatus = document.querySelector("#auth-status");
const accountGuest = document.querySelector("#account-guest");
const accountUser = document.querySelector("#account-user");
const accountName = document.querySelector("#account-name");
const reviewDialog = document.querySelector("#review-dialog");
const reviewForm = document.querySelector("#review-form");
const reviewStatus = document.querySelector("#review-status");
const reviewPluginName = document.querySelector("#review-plugin-name");
const reviewRating = document.querySelector("#review-rating");
const reviewBody = document.querySelector("#review-body");
const reviewsDialog = document.querySelector("#reviews-dialog");
const reviewsPluginName = document.querySelector("#reviews-plugin-name");
const reviewsList = document.querySelector("#reviews-list");

const STATUS_LABELS = {
  pending: "待审核",
  published: "已上架",
  rejected: "已拒绝",
  suspended: "已暂停",
};

const state = {
  token: sessionStorage.getItem("vela-market-token") || "",
  user: null,
  query: "",
  category: "",
  featured: false,
  sort: "recent",
  reviewTarget: null,
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setText(node, text, tone = "") {
  node.textContent = text;
  node.dataset.tone = tone;
}

function categoryName(value) {
  return CATEGORIES[value] || value;
}

function categoryOptions(selected) {
  const select = document.createElement("select");
  for (const [value, label] of Object.entries(CATEGORIES)) {
    const option = element("option", "", label);
    option.value = value;
    option.selected = value === selected;
    select.append(option);
  }
  return select;
}

function fillCategorySelect(select) {
  for (const [value, label] of Object.entries(CATEGORIES)) {
    const option = element("option", "", label);
    option.value = value;
    select.append(option);
  }
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { ...options, headers });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function ratingText(plugin) {
  if (!plugin.ratingCount) return "暂无评分";
  return `★ ${plugin.rating.toFixed(1)} (${plugin.ratingCount})`;
}

function saveAuth(data) {
  state.token = data.token;
  state.user = data.user;
  sessionStorage.setItem("vela-market-token", data.token);
  renderAuth();
}

function clearAuth() {
  state.token = "";
  state.user = null;
  sessionStorage.removeItem("vela-market-token");
  renderAuth();
}

function renderAuth() {
  const signedIn = Boolean(state.user);
  accountGuest.hidden = signedIn;
  accountUser.hidden = !signedIn;
  uploadPanel.hidden = !signedIn;
  myPanel.hidden = !signedIn || state.user.role !== "publisher";
  adminPanel.hidden = !signedIn || state.user.role !== "admin";
  if (state.user) {
    accountName.textContent = `${state.user.username} · ${state.user.role}`;
  }
}

function renderPlugins(items) {
  pluginGrid.replaceChildren();
  count.textContent = `${items.length} 个插件`;
  if (items.length === 0) {
    pluginGrid.append(element("p", "empty", "没有找到插件。"));
    return;
  }
  for (const plugin of items) {
    const card = element("article", "card");
    const head = element("div", "card-head");
    head.append(element("span", "icon", plugin.icon || "▣"));
    const title = element("div", "title-line");
    title.append(element("h3", "", plugin.name));
    title.append(element("span", "version", `v${plugin.latestVersion}`));
    if (plugin.featured) title.append(element("span", "featured", "精选"));
    head.append(title);
    card.append(head);

    const byline = element("div", "byline");
    byline.append(element("span", "", plugin.publisherName || plugin.author || "未知发布者"));
    byline.append(element("span", "", categoryName(plugin.category)));
    byline.append(element("span", "rating", ratingText(plugin)));
    card.append(byline);

    card.append(element("p", "description", plugin.description || "暂无描述"));

    const meta = element("div", "meta");
    meta.append(element("span", "", `${plugin.downloads} 次下载`));
    meta.append(element("span", "", formatBytes(plugin.size)));
    card.append(meta);

    if (plugin.tags.length) {
      const tags = element("div", "tags");
      for (const tag of plugin.tags) tags.append(element("span", "tag", tag));
      card.append(tags);
    }

    const actions = element("div", "actions");
    const download = element("a", "download", "下载 .vpk");
    download.href = `/api/plugins/${encodeURIComponent(plugin.id)}/download?version=latest`;
    download.setAttribute("download", `${plugin.id}-${plugin.latestVersion}.vpk`);
    actions.append(download);
    if (plugin.ratingCount > 0) {
      const reviews = element("button", "", `评论 ${plugin.ratingCount}`);
      reviews.type = "button";
      reviews.addEventListener("click", () => void openReviews(plugin));
      actions.append(reviews);
    }
    if (state.user) {
      const review = element("button", "", "评价");
      review.type = "button";
      review.addEventListener("click", () => openReview(plugin));
      actions.append(review);
    }
    card.append(actions);
    pluginGrid.append(card);
  }
}

async function loadPlugins() {
  setText(status, "加载中…");
  try {
    const params = new URLSearchParams({ pageSize: "100", sort: state.sort });
    if (state.query) params.set("q", state.query);
    if (state.category) params.set("category", state.category);
    if (state.featured) params.set("featured", "true");
    const data = await api(`/api/plugins?${params}`);
    renderPlugins(data.items);
    setText(status, "");
  } catch (error) {
    setText(status, `加载失败：${error instanceof Error ? error.message : String(error)}`, "danger");
  }
}

function renderMy(items) {
  myList.replaceChildren();
  if (items.length === 0) {
    myList.append(element("p", "empty", "还没有发布插件。"));
    return;
  }
  for (const plugin of items) {
    const card = element("article", "admin-card");
    card.append(element("h3", "", `${plugin.name} v${plugin.latestVersion}`));
    const meta = element("div", "byline");
    meta.append(element("span", "", categoryName(plugin.category)));
    meta.append(element("span", `status-pill status-${plugin.status}`, STATUS_LABELS[plugin.status] || plugin.status));
    card.append(meta);
    if (plugin.reviewNote) card.append(element("p", "status", plugin.reviewNote));
    myList.append(card);
  }
}

async function loadMy() {
  if (!state.user || state.user.role !== "publisher") return;
  try {
    const data = await api("/api/me/plugins");
    renderMy(data.items);
  } catch (error) {
    setText(myStatus, `加载失败：${error instanceof Error ? error.message : String(error)}`, "danger");
  }
}

function renderAdmin(items) {
  adminList.replaceChildren();
  if (items.length === 0) {
    adminList.append(element("p", "empty", "没有待审核插件。"));
    return;
  }
  for (const plugin of items) {
    const card = element("article", "admin-card");
    card.append(element("h3", "", `${plugin.name} v${plugin.latestVersion}`));
    card.append(element("p", "muted", `${plugin.publisherName} · ${categoryName(plugin.category)}`));
    card.append(element("p", "description", plugin.description || "暂无描述"));
    const category = categoryOptions(plugin.category);
    const featured = element("label", "check");
    const featuredInput = element("input");
    featuredInput.type = "checkbox";
    featuredInput.checked = plugin.featured;
    featured.append(featuredInput, document.createTextNode(" 精选"));
    const actions = element("div", "actions");
    const approve = element("button", "primary", "批准上架");
    approve.type = "button";
    const reject = element("button", "", "拒绝");
    reject.type = "button";
    const review = async (nextStatus) => {
      try {
        await api(`/api/admin/plugins/${encodeURIComponent(plugin.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: category.value, featured: featuredInput.checked }),
        });
        await api(`/api/admin/plugins/${encodeURIComponent(plugin.id)}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        });
        setText(adminStatus, `已处理 ${plugin.name}`, "success");
        await loadAdmin();
        await loadPlugins();
      } catch (error) {
        setText(adminStatus, `处理失败：${error instanceof Error ? error.message : String(error)}`, "danger");
      }
    };
    approve.addEventListener("click", () => void review("published"));
    reject.addEventListener("click", () => void review("rejected"));
    actions.append(approve, reject);
    card.append(category, featured, actions);
    adminList.append(card);
  }
}

async function loadAdmin() {
  if (!state.user || state.user.role !== "admin") return;
  try {
    const data = await api("/api/admin/plugins?status=pending&pageSize=100");
    renderAdmin(data.items);
  } catch (error) {
    setText(adminStatus, `审核列表加载失败：${error instanceof Error ? error.message : String(error)}`, "danger");
  }
}

async function openReviews(plugin) {
  try {
    const detail = await api(`/api/plugins/${encodeURIComponent(plugin.id)}`);
    reviewsPluginName.textContent = plugin.name;
    reviewsList.replaceChildren();
    if (!detail.reviews.length) {
      reviewsList.append(element("p", "empty", "还没有评论。"));
    } else {
      for (const review of detail.reviews) {
        const item = element("article", "review-item");
        item.append(element("div", "review-head", `${review.username} · ${"★".repeat(review.rating)}`));
        item.append(element("p", "", review.body));
        reviewsList.append(item);
      }
    }
    reviewsDialog.showModal();
  } catch (error) {
    setText(status, `评论加载失败：${error instanceof Error ? error.message : String(error)}`, "danger");
  }
}

function openReview(plugin) {
  state.reviewTarget = plugin;
  reviewPluginName.textContent = plugin.name;
  reviewBody.value = "";
  reviewRating.value = "5";
  setText(reviewStatus, "");
  reviewDialog.showModal();
  reviewBody.focus();
}

async function submitReview() {
  if (!state.reviewTarget) return;
  try {
    await api(`/api/plugins/${encodeURIComponent(state.reviewTarget.id)}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: Number(reviewRating.value), body: reviewBody.value.trim() }),
    });
    reviewDialog.close();
    await loadPlugins();
  } catch (error) {
    setText(reviewStatus, `提交失败：${error instanceof Error ? error.message : String(error)}`, "danger");
  }
}

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.query = searchInput.value.trim();
  state.category = categoryFilter.value;
  state.featured = featuredFilter.checked;
  state.sort = sortFilter.value;
  void loadPlugins();
});

categoryFilter.addEventListener("change", () => {
  state.category = categoryFilter.value;
  void loadPlugins();
});
sortFilter.addEventListener("change", () => {
  state.sort = sortFilter.value;
  void loadPlugins();
});
featuredFilter.addEventListener("change", () => {
  state.featured = featuredFilter.checked;
  void loadPlugins();
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setText(authStatus, "登录中…");
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: document.querySelector("#login-username").value,
        password: document.querySelector("#login-password").value,
      }),
    });
    saveAuth(data);
    loginForm.reset();
    setText(authStatus, "");
    await loadPlugins();
    await loadAdmin();
    await loadMy();
  } catch (error) {
    setText(authStatus, `登录失败：${error instanceof Error ? error.message : String(error)}`, "danger");
  }
});

document.querySelector("#register-button").addEventListener("click", async () => {
  setText(authStatus, "注册中…");
  try {
    const data = await api("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: document.querySelector("#login-username").value,
        password: document.querySelector("#login-password").value,
      }),
    });
    saveAuth(data);
    loginForm.reset();
    setText(authStatus, "");
    await loadPlugins();
    await loadMy();
  } catch (error) {
    setText(authStatus, `注册失败：${error instanceof Error ? error.message : String(error)}`, "danger");
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    // Clear the local session even if the server session already expired.
  }
  clearAuth();
  await loadPlugins();
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.user) return;
  const file = document.querySelector("#file").files[0];
  if (!file) return;
  setText(uploadStatus, "上传中…");
  const body = new FormData();
  body.set("file", file, file.name);
  body.set("description", document.querySelector("#description").value);
  body.set("category", document.querySelector("#upload-category").value);
  body.set("tags", document.querySelector("#tags").value);
  try {
    const result = await api("/api/plugins", { method: "POST", body });
    const message =
      result.status === "published"
        ? `已上架 ${result.name} v${result.latestVersion}`
        : `已提交审核 ${result.name} v${result.latestVersion}`;
    setText(uploadStatus, message, "success");
    uploadForm.reset();
    await loadPlugins();
    await loadAdmin();
    await loadMy();
  } catch (error) {
    setText(uploadStatus, `上传失败：${error instanceof Error ? error.message : String(error)}`, "danger");
  }
});

reviewForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitReview();
});
document.querySelector("#review-cancel").addEventListener("click", () => reviewDialog.close());
document.querySelector("#reviews-close").addEventListener("click", () => reviewsDialog.close());

async function init() {
  fillCategorySelect(categoryFilter);
  fillCategorySelect(document.querySelector("#upload-category"));
  if (state.token) {
    try {
      const data = await api("/api/auth/me");
      state.user = data.user;
    } catch {
      clearAuth();
    }
  }
  renderAuth();
  await loadPlugins();
  await loadAdmin();
  await loadMy();
}

void init();
