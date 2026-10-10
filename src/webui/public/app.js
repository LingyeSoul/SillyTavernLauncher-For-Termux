/* SillyTavernLauncher WebUI 前端 — 零依赖单页应用。
 * 与后端契约：REST (/api/*) + SSE (/api/events，事件 log/busy)。
 * Token：非回环监听时由 URL ?token= 携带，存 localStorage。 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const state = { status: null, token: localStorage.getItem("stl_webui_token") ?? "" };

  const urlToken = new URLSearchParams(location.search).get("token");
  if (urlToken) {
    state.token = urlToken;
    localStorage.setItem("stl_webui_token", urlToken);
    history.replaceState(null, "", "/");
  }

  // ---------- API ----------

  async function api(path, options = {}) {
    const opts = { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } };
    if (state.token) opts.headers["Authorization"] = `Bearer ${state.token}`;
    const response = await fetch(path, opts);
    let payload = {};
    try { payload = await response.json(); } catch { /* empty */ }
    if (!response.ok && response.status !== 202) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    return payload;
  }
  const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body || {}) });

  function toast(message, kind = "") {
    const el = $("toast");
    el.textContent = message;
    el.className = `toast ${kind}`;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.add("hidden"), 2600);
  }

  // ---------- EULA ----------

  function showAgreement(data) {
    $("agreement-content").textContent = data.content || "（无法加载协议内容）";
    $("agreement-version").textContent = `版本日期: ${data.date || "未知"} · 来源: ${data.source}`;
    $("agreement-overlay").classList.remove("hidden");
    $("agreement-18").onchange = (e) => { $("agreement-accept").disabled = !e.target.checked; };
    $("agreement-accept").onclick = async () => {
      try {
        await post("/api/agreement/accept", { accepted: true });
        $("agreement-overlay").classList.add("hidden");
        await refresh();
      } catch (error) { toast(String(error.message || error), "err"); }
    };
  }

  // ---------- 状态渲染 ----------

  let stUrlCache = "";

  async function refresh() {
    try {
      const data = await api("/api/status");
      if (data.agreement_required) {
        const agreement = await api("/api/agreement");
        showAgreement(agreement);
        return;
      }
      $("agreement-overlay").classList.add("hidden");
      state.status = data;
      render(data);
    } catch (error) {
      toast(`状态获取失败: ${error.message || error}`, "err");
    }
  }

  function render(data) {
    $("hdr-version").textContent = `v${data.launcher_version}`;
    const running = data.running && data.running.running;
    const pill = $("hdr-status");
    pill.textContent = !data.installed ? "未安装" : running ? "运行中" : "已停止";
    pill.className = `status-pill ${data.installed ? (running ? "run" : "down") : ""}`;

    $("st-state").textContent = !data.installed ? "未安装" : running ? `运行中 (pid ${data.running.pid ?? "?"})` : "已停止";
    $("st-version").textContent = data.st && data.st.version ? `v${data.st.version}` : "—";
    $("st-commit").textContent = data.st && data.st.commit ? `${data.st.branch || "?"} / ${data.st.commit.slice(0, 7)}` : "—";

    const port = data.st_config ? data.st_config.port : 8000;
    const listen = data.st_config ? data.st_config.listen : false;
    if (data.installed) {
      const ip = listen ? data.local_ip : "127.0.0.1";
      stUrlCache = `http://${ip}:${port}`;
      $("st-url").textContent = stUrlCache;
    } else {
      stUrlCache = "";
      $("st-url").textContent = "—";
    }

    $("btn-start").disabled = running || !data.installed || (data.busy || []).length > 0;
    $("btn-stop").disabled = !running;
    $("btn-install").style.display = data.installed ? "none" : "";
    $("btn-update-st").disabled = !data.installed || (data.busy || []).length > 0;

    $("local-ip").textContent = `${data.local_ip}`;
    $("st-port").textContent = String(port);
    const envOk = data.env && data.env.ok;
    $("env-check").textContent = envOk ? "✓ git / node / npm" : `✗ 缺少 ${(data.env && data.env.missing || []).join(", ")}`;
    $("autostart-toggle").checked = !!data.autostart;

    const update = data.update;
    if (update && !update.has_error && update.has_update) {
      $("update-banner").classList.remove("hidden");
      const dev = update.is_dev_version ? " [开发版]" : "";
      $("update-text").textContent = `v${update.current_version} → v${update.latest_version}${dev}`;
    } else {
      $("update-banner").classList.add("hidden");
    }

    if (currentView === "sync") void refreshSync();
    if (currentView === "config") void renderConfig(data);
  }

  // ---------- 日志 ----------

  function appendLog(line) {
    const consoleEl = $("log-console");
    const div = document.createElement("div");
    div.className = "log-line";
    const time = document.createElement("span");
    time.className = "time";
    time.textContent = new Date(line.time).toLocaleTimeString("zh-CN", { hour12: false });
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = `[${line.source}]`;
    div.append(time, tag, document.createTextNode(line.text));
    consoleEl.appendChild(div);
    while (consoleEl.childElementCount > 2000) consoleEl.removeChild(consoleEl.firstChild);
    if ($("log-autoscroll").checked) consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  async function backfillLogs() {
    const data = await api("/api/logs");
    $("log-console").textContent = "";
    (data.lines || []).forEach(appendLog);
  }

  function connectEvents() {
    const base = state.token ? `/api/events?token=${encodeURIComponent(state.token)}` : "/api/events";
    const source = new EventSource(base);
    source.addEventListener("log", (e) => appendLog(JSON.parse(e.data)));
    source.addEventListener("busy", (e) => {
      const data = JSON.parse(e.data);
      if (data.busy && data.busy.length) toast(`任务进行中: ${data.busy.join(", ")}`);
    });
    source.onerror = () => { source.close(); setTimeout(connectEvents, 3000); };
  }

  // ---------- 同步 ----------

  async function refreshSync() {
    try {
      const data = await api("/api/sync/status");
      const status = data.status;
      $("sync-state").textContent = status.running ? "· 运行中" : "· 已停止";
      $("sync-url").textContent = status.running ? status.share_url : "（未运行）";
      $("btn-sync-start").disabled = status.running;
      $("btn-sync-stop").disabled = !status.running;

      const saved = data.saved_servers || [];
      $("sync-saved").innerHTML = "";
      if (!saved.length) {
        $("sync-saved").textContent = "无";
      } else {
        saved.forEach((redacted, index) => {
          const item = document.createElement("div");
          item.className = "list-item";
          const label = document.createElement("span");
          label.className = "mono";
          label.textContent = redacted;
          const btn = document.createElement("button");
          btn.className = "btn";
          btn.textContent = "删除";
          btn.onclick = async () => {
            try {
              await post("/api/sync/servers", { action: "remove", index });
              refreshSync();
            } catch (error) { toast(error.message || String(error), "err"); }
          };
          item.append(label, btn);
          $("sync-saved").appendChild(item);
        });
      }
    } catch (error) {
      toast(`同步状态获取失败: ${error.message || error}`, "err");
    }
  }

  // ---------- 配置 ----------

  function renderConfig(data) {
    if (!data.st_config) return;
    const cfg = data.st_config;
    if (document.activeElement !== $("cfg-port")) $("cfg-port").value = String(cfg.port);
    $("cfg-listen").checked = cfg.listen;
    if (document.activeElement !== $("cfg-whitelist")) {
      $("cfg-whitelist").value = (cfg.whitelistIps || []).join("\n");
      $("cfg-whitelist-count").textContent = `${(cfg.whitelistIps || []).length} 条`;
    }
  }

  async function renderMirrors() {
    try {
      const data = await api("/api/mirrors");
      const wrap = $("mirror-list");
      wrap.innerHTML = "";
      for (const [key, display] of data.mirrors) {
        const btn = document.createElement("button");
        btn.className = "btn" + (key === data.current ? " primary" : "");
        btn.textContent = display;
        btn.onclick = async () => {
          try {
            await post("/api/config/mirror", { mirror: key });
            toast(`镜像已切换: ${display}`, "ok");
            renderMirrors();
          } catch (error) { toast(error.message || String(error), "err"); }
        };
        wrap.appendChild(btn);
      }
    } catch { /* 忽略 */ }
  }

  // ---------- 版本管理 ----------

  async function renderVersions() {
    try {
      const data = await api("/api/versions");
      $("ver-current").textContent = `当前: ${data.current && data.current.version ? "v" + data.current.version : "未知"}`;
      const list = $("version-list");
      list.innerHTML = "";
      if (!data.items || !data.items.length) {
        list.innerHTML = '<div class="muted">暂无版本标签，点击"更新标签"获取</div>';
        return;
      }
      for (const item of data.items) {
        const row = document.createElement("div");
        row.className = "list-item";
        const label = document.createElement("div");
        label.innerHTML = `<div>v${item.version}${item.isLatest ? ' <span class="muted">[最新]</span>' : ""}</div><div class="meta">${item.commit.slice(0, 7)} · ${item.date.slice(0, 10)}</div>`;
        const btn = document.createElement("button");
        btn.className = "btn";
        btn.textContent = "切换";
        btn.onclick = async () => {
          if (!confirm(`切换到 v${item.version}？将自动重装依赖`)) return;
          btn.disabled = true;
          try {
            const result = await post("/api/versions/switch", { version: item.version, installDeps: true, force: true });
            toast(result.message || "已切换", "ok");
          } catch (error) { toast(error.message || String(error), "err"); }
          btn.disabled = false;
        };
        row.append(label, btn);
        list.appendChild(row);
      }
    } catch (error) {
      toast(error.message || String(error), "err");
    }
  }

  // ---------- 迁移 ----------

  async function renderMigrate() {
    $("migrate-list").innerHTML = '<div class="muted">扫描中…</div>';
    try {
      const data = await api("/api/migrate/scan");
      const list = $("migrate-list");
      list.innerHTML = "";
      if (!data.installations || !data.installations.length) {
        list.innerHTML = '<div class="muted">未找到其他 SillyTavern 安装</div>';
        return;
      }
      for (const install of data.installations) {
        const row = document.createElement("div");
        row.className = "list-item";
        const label = document.createElement("div");
        const sizeMb = (install.size / 1024 / 1024).toFixed(1);
        label.innerHTML = `<div class="mono" style="font-size:12px">${install.path}</div><div class="meta">v${install.version} · ${sizeMb} MB · ${install.hasGit ? "Git" : "手动"}</div>`;
        const btn = document.createElement("button");
        btn.className = "btn";
        btn.textContent = "迁移";
        btn.onclick = async () => {
          if (!confirm(`移动整个安装到本地？\n源: ${install.path}`)) return;
          btn.disabled = true;
          try {
            const result = await post("/api/migrate", { sourcePath: install.path, mode: "move" });
            toast(result.message || "迁移完成", result.success ? "ok" : "err");
          } catch (error) { toast(error.message || String(error), "err"); }
          btn.disabled = false;
        };
        row.append(label, btn);
        list.appendChild(row);
      }
    } catch (error) {
      $("migrate-list").innerHTML = `<div class="muted">扫描失败: ${error.message || error}</div>`;
    }
  }

  // ---------- 视图切换 ----------

  let currentView = "home";

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentView = tab.dataset.view;
      document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
      $(`view-${currentView}`).classList.remove("hidden");
      if (currentView === "sync") void refreshSync();
      if (currentView === "config") { void refresh(); void renderMirrors(); }
      if (currentView === "more") void renderVersions();
    };
  });

  // ---------- 事件绑定 ----------

  const guard = (fn) => async (...args) => {
    try { await fn(...args); } catch (error) { toast(error.message || String(error), "err"); }
  };

  $("btn-start").onclick = guard(async () => {
    const result = await post("/api/st/start");
    toast(result.message || "已启动", "ok");
    setTimeout(refresh, 800);
  });
  $("btn-stop").onclick = guard(async () => {
    const result = await post("/api/st/stop");
    toast(result.message || "已停止", "ok");
    setTimeout(refresh, 500);
  });
  $("btn-restart").onclick = guard(async () => {
    const result = await post("/api/st/restart");
    toast(result.message || "已重启", "ok");
    setTimeout(refresh, 800);
  });
  $("btn-install").onclick = guard(async () => {
    if (!confirm("安装 SillyTavern？\n确认本人已年满18周岁，或已取得监护人同意。")) return;
    await post("/api/st/install", { confirm18: true });
    toast("安装已开始，请在日志页查看进度", "ok");
  });
  $("btn-update-st").onclick = guard(async () => {
    await post("/api/st/update");
    toast("更新已开始，请在日志页查看进度", "ok");
  });
  $("btn-update-launcher").onclick = guard(async () => {
    if (!confirm("更新启动器并重启 WEBUI？")) return;
    await post("/api/launcher/update");
    toast("更新中…", "ok");
  });
  $("autostart-toggle").onchange = guard(async (e) => {
    await post("/api/config/autostart", { enabled: e.target.checked });
    toast(e.target.checked ? "已启用一键启动" : "已禁用一键启动", "ok");
  });

  $("btn-sync-start").onclick = guard(async () => {
    const result = await post("/api/sync/server/start", {});
    toast(result.message || "已启动", result.success ? "ok" : "err");
    refreshSync();
  });
  $("btn-sync-stop").onclick = guard(async () => {
    const result = await post("/api/sync/server/stop");
    toast(result.message || "已停止", "ok");
    refreshSync();
  });
  $("btn-sync-copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("sync-url").textContent);
      toast("已复制", "ok");
    } catch { toast("复制失败，请长按手动复制", "err"); }
  };
  $("btn-sync-rotate").onclick = guard(async () => {
    if (!confirm("轮换后旧分享地址立即失效，确认？")) return;
    const result = await post("/api/sync/rotate-token");
    toast(`新地址: ${result.share_url}`, "ok");
    refreshSync();
  });
  $("btn-sync-from").onclick = guard(async () => {
    const serverUrl = $("sync-from-url").value.trim();
    if (!serverUrl) { toast("请输入分享地址", "err"); return; }
    await post("/api/sync/from", {
      serverUrl,
      method: $("sync-method").value,
      backup: $("sync-backup").checked,
    });
    toast("同步已开始，请在日志页查看进度", "ok");
  });

  $("btn-cfg-port").onclick = guard(async () => {
    const port = Number($("cfg-port").value);
    if (!(port >= 1 && port <= 65535)) { toast("端口号必须在 1-65535 范围内", "err"); return; }
    await post("/api/st-config", { action: "port", port });
    toast("端口已保存，重启 ST 后生效", "ok");
  });
  $("cfg-listen").onchange = guard(async (e) => {
    await post("/api/st-config", { action: "listen", enabled: e.target.checked });
    toast(`局域网监听已${e.target.checked ? "启用" : "禁用"}，重启 ST 后生效`, "ok");
  });
  $("btn-cfg-subnet").onclick = guard(async () => {
    await post("/api/st-config", { action: "auto_subnet" });
    toast("已自动添加当前网段", "ok");
    refresh();
  });
  $("btn-cfg-whitelist").onclick = guard(async () => {
    const ips = $("cfg-whitelist").value.split("\n").map((s) => s.trim()).filter(Boolean);
    await post("/api/st-config", { action: "whitelist", ips });
    toast(`白名单已保存（${ips.length} 条）`, "ok");
    refresh();
  });

  $("btn-fetch-tags").onclick = guard(async () => {
    const result = await post("/api/versions/fetch-tags");
    toast(result.message || "已更新", "ok");
    renderVersions();
  });
  $("btn-migrate-scan").onclick = () => renderMigrate();
  $("btn-repair").onclick = guard(async () => {
    if (!confirm("删除 node_modules 并重装依赖？")) return;
    await post("/api/st/repair");
    toast("修复已开始，请在日志页查看进度", "ok");
  });
  $("btn-restart-webui").onclick = guard(async () => {
    if (!confirm("重启启动器进程？")) return;
    await post("/api/launcher/restart");
    toast("重启中…页面将在几秒后恢复", "ok");
    setTimeout(() => location.reload(), 4000);
  });

  $("st-url").onclick = () => { if (stUrlCache) window.open(stUrlCache, "_blank"); };

  // ---------- 启动 ----------

  backfillLogs().catch(() => {});
  connectEvents();
  refresh();
  setInterval(refresh, 5000);
})();
