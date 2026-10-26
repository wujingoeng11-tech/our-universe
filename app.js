(() => {
  "use strict";

  const SETTINGS_KEY = "our-universe.settings.v1";
  const GAME_BEST_KEY = "our-universe.game-best.v1";
  const PHOTO_DB_NAME = "our-universe-photos";
  const PHOTO_STORE = "memories";
  const MAX_PHOTOS = 30;
  const ACCESS_HASH = "52d2e018eb38625729637ff39082f74cc424a934e5cfde75b2993d884c94f649";
  const SHARE_HASH_KEY = "universe";
  const SHARE_ITERATIONS = 180000;
  const SHARE_PHOTO_LIMIT = 6;
  const SHARE_MAX_BYTES = 900000;
  const PASTE_API_BASE = "https://api.pastes.dev";

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const pad = (value, length = 2) => String(Math.max(0, value)).padStart(length, "0");

  const momentPrompts = [
    ["第一次心动", "THE FIRST HEARTBEAT"],
    ["一起看过的晚霞", "SUNSET TOGETHER"],
    ["随手拍的她", "MY FAVORITE VIEW"],
    ["一起吃过的饭", "A TASTE OF US"],
    ["旅行的风", "WHERE WE HAVE BEEN"],
    ["平凡的一天", "ORDINARY, BUT OURS"],
    ["偷偷收藏的瞬间", "A SECRET MOMENT"],
    ["下一颗星等你", "ADD A MEMORY"],
  ];

  const affirmations = [
    "今天也比昨天，多喜欢你一点点。",
    "如果心动有声音，大概全世界都听见了。",
    "你出现以后，普通日子也开始闪闪发光。",
    "我喜欢的风景很多，但最喜欢的还是你。",
    "所有让我期待明天的小事里，都有你。",
    "在遇见你之前，我不知道原来偏爱是本能。",
    "我不太会说浪漫的话，但我一直很认真地喜欢你。",
    "世界偶尔很吵，而你的名字让人心安。",
    "想和你把日子过成一封很长很长的情书。",
    "宇宙这么大，我最想抵达的地方还是你身边。",
  ];

  const placeholderIcon = `
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 27S4 19.7 4 11.7C4 7.6 6.8 5 10.3 5c2.2 0 4.1 1.2 5.7 3.2C17.6 6.2 19.5 5 21.7 5 25.2 5 28 7.6 28 11.7 28 19.7 16 27 16 27Z"/>
      <path d="M16 11v9M11.5 15.5h9"/>
    </svg>`;

  function localDateTime(date) {
    const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return adjusted.toISOString().slice(0, 16);
  }

  function createDefaultSettings() {
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + 14);
    nextDate.setHours(19, 0, 0, 0);

    return {
      myName: "我",
      herName: "你",
      startDate: "2024-05-20",
      nextDate: localDateTime(nextDate),
      nextTitle: "去见你",
      heroIntro: "星星负责浪漫，银河负责辽阔，而我负责一直、一直偏爱你。",
      letterBody:
        "我想把世界上所有美好的词都送给你，可后来发现，“你”这个字本身，就已经胜过万语千言。\n\n谢谢你愿意走进我的生活，让那些原本普通的日子，有了值得纪念的意义。未来的路还很长，我想陪你看日出、看晚霞、看星星，也陪你度过每一个不必发光的日子。\n\n宇宙很大，而我最确定的事，是站在你身边。",
    };
  }

  function loadSettings() {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        return { ...createDefaultSettings(), ...JSON.parse(stored) };
      }
      const defaults = createDefaultSettings();
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(defaults));
      return defaults;
    } catch {
      return createDefaultSettings();
    }
  }

  let settings = loadSettings();
  let photos = [];
  let previewPlaceholders = false;
  let currentPhotoId = null;
  let toastTimer = null;
  let accessPassword = "";
  let activeSharePayload = null;

  function cleanName(name, fallback) {
    const clean = String(name || "").trim();
    return clean || fallback;
  }

  function firstName(name) {
    return [...name][0] || "";
  }

  function formatDateChinese(date) {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(date)
      .replaceAll("/", " / ");
  }

  function formatDateShort(date) {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }

  function safeDate(value, fallback) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date;
  }

  function bytesToBase64Url(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  }

  function base64UrlToBytes(value) {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  async function sha256Hex(value) {
    if (!window.crypto?.subtle) {
      return value === "our-universe:191029" ? ACCESS_HASH : "";
    }
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    );
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  async function deriveShareKey(password, salt) {
    if (!window.crypto?.subtle) {
      throw new Error("当前浏览器不支持加密分享，请使用新版浏览器。");
    }
    const sourceKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: SHARE_ITERATIONS,
        hash: "SHA-256",
      },
      sourceKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  async function encryptSharePayload(payload, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveShareKey(password, salt);
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify(payload)),
    );
    const wrapper = {
      v: 1,
      salt: bytesToBase64Url(salt),
      iv: bytesToBase64Url(iv),
      data: bytesToBase64Url(new Uint8Array(encrypted)),
    };
    return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(wrapper)));
  }

  async function decryptSharePayload(token, password) {
    const wrapper = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(token)),
    );
    if (wrapper.v !== 1 || !wrapper.salt || !wrapper.iv || !wrapper.data) {
      throw new Error("分享链接格式不正确。");
    }
    const salt = base64UrlToBytes(wrapper.salt);
    const iv = base64UrlToBytes(wrapper.iv);
    const encrypted = base64UrlToBytes(wrapper.data);
    const key = await deriveShareKey(password, salt);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      encrypted,
    );
    return JSON.parse(new TextDecoder().decode(decrypted));
  }

  async function uploadEncryptedShare(token) {
    const response = await fetch(`${PASTE_API_BASE}/post`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Accept: "application/json",
      },
      body: token,
    });
    if (!response.ok) {
      throw new Error(`Short link service returned ${response.status}.`);
    }
    const result = await response.json();
    if (!result.key) {
      throw new Error("Short link service did not return a key.");
    }
    return result.key;
  }

  async function downloadEncryptedShare(key) {
    if (!/^[A-Za-z0-9]+$/.test(key)) {
      throw new Error("专属链接编号不正确。");
    }
    const response = await fetch(`${PASTE_API_BASE}/${key}`);
    if (!response.ok) {
      throw new Error("短链接对应的内容暂时无法读取，请稍后再试。");
    }
    return (await response.text()).trim();
  }

  function getShareToken() {
    const parameters = new URLSearchParams(location.hash.replace(/^#/, ""));
    return parameters.get(SHARE_HASH_KEY);
  }

  function loadImageSource(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not load image"));
      image.src = source;
    });
  }

  async function compressPhotoForShare(source, maxSide = 850, quality = 0.62) {
    const image = await loadImageSource(source);
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    context.fillStyle = "#101426";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", quality);
  }

  async function prepareSharePhotos() {
    const candidates = photos.slice(0, SHARE_PHOTO_LIMIT);
    const prepared = [];
    for (const photo of candidates) {
      try {
        const image = await compressPhotoForShare(photo.image);
        prepared.push({
          id: photo.id,
          image,
          caption: photo.caption,
          createdAt: photo.createdAt,
        });
      } catch {
        // A photo that cannot be converted should not block the private link.
      }
    }

    while (
      prepared.length &&
      new TextEncoder().encode(JSON.stringify(prepared)).byteLength > SHARE_MAX_BYTES
    ) {
      prepared.pop();
    }
    return prepared;
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      const temporary = document.createElement("textarea");
      temporary.value = value;
      temporary.style.position = "fixed";
      temporary.style.opacity = "0";
      document.body.append(temporary);
      temporary.select();
      const copied = document.execCommand("copy");
      temporary.remove();
      return copied;
    }
  }

  function readSettingsForm() {
    return {
      myName: $("#myNameInput").value,
      herName: $("#herNameInput").value,
      startDate: $("#startDateInput").value || "2024-05-20",
      nextDate: $("#nextDateInput").value || createDefaultSettings().nextDate,
      nextTitle: $("#nextTitleInput").value.trim() || "去见你",
      heroIntro:
        $("#heroIntroInput").value.trim() ||
        "星星负责浪漫，银河负责辽阔，而我负责一直、一直偏爱你。",
      letterBody: $("#letterInput").value.trim() || createDefaultSettings().letterBody,
    };
  }

  function applySettings(nextSettings) {
    settings = {
      ...createDefaultSettings(),
      ...nextSettings,
    };
    settings.myName = cleanName(settings.myName, "我");
    settings.herName = cleanName(settings.herName, "你");

    const pairLabel = `${settings.herName} × ${settings.myName}`;
    const initials =
      settings.herName === "你" && settings.myName === "我"
        ? "你 × 我"
        : `${firstName(settings.herName)} × ${firstName(settings.myName)}`;

    $$("[data-bind='pairLabel']").forEach((element) => {
      element.textContent = pairLabel;
    });
    $("[data-bind='initials']").textContent = initials;
    $("[data-bind='heroIntro']").textContent = settings.heroIntro;
    $("[data-bind='letterTo']").textContent = `亲爱的${settings.herName}：`;
    $("[data-bind='letterFrom']").textContent = settings.myName;
    $("[data-bind='letterBody']").textContent = settings.letterBody;
    $("[data-bind='todayDate']").textContent = formatDateChinese(new Date());
    $("[data-bind='nextEventTitle']").textContent = settings.nextTitle;
    $("title").textContent = `${settings.herName} × ${settings.myName} · 我们的宇宙`;
    $("#footerYear").textContent = new Date().getFullYear();

    updateTime();
    fillSettingsForm();
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // The site remains fully usable when storage is unavailable.
    }
  }

  function updateTime() {
    const now = new Date();
    const start = safeDate(`${settings.startDate}T00:00:00`, now);
    const elapsed = Math.max(0, now.getTime() - start.getTime());
    const days = Math.floor(elapsed / 86400000) + 1;

    $("[data-bind='daysTogether']").textContent = pad(days, 4);
    $("[data-bind='moons']").textContent = Math.floor(days / 29.53).toLocaleString("zh-CN");

    const target = safeDate(settings.nextDate, now);
    const remaining = Math.max(0, target.getTime() - now.getTime());
    const totalSeconds = Math.floor(remaining / 1000);
    const countdownDays = Math.floor(totalSeconds / 86400);
    const countdownHours = Math.floor((totalSeconds % 86400) / 3600);
    const countdownMinutes = Math.floor((totalSeconds % 3600) / 60);
    const countdownSeconds = totalSeconds % 60;

    $("[data-bind='countdownDays']").textContent = pad(countdownDays);
    $("[data-bind='countdownHours']").textContent = pad(countdownHours);
    $("[data-bind='countdownMinutes']").textContent = pad(countdownMinutes);
    $("[data-bind='countdownSeconds']").textContent = pad(countdownSeconds);

    const label = $("[data-bind='nextEventLabel']");
    label.textContent =
      remaining > 0
        ? `NEXT DATE · ${formatDateShort(target)}`
        : "ARRIVED · 约定日已经抵达";
  }

  function showToast(message) {
    const toast = $("#toast");
    $("p", toast).textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2400);
  }

  function setDailyAffirmation(random = false) {
    const dayIndex = Math.floor(Date.now() / 86400000) % affirmations.length;
    let index = random ? Math.floor(Math.random() * affirmations.length) : dayIndex;
    if (random && affirmations[index] === $("#dailyAffirmation").textContent) {
      index = (index + 1) % affirmations.length;
    }
    $("#dailyAffirmation").textContent = affirmations[index];
  }

  function fillSettingsForm() {
    $("#myNameInput").value = settings.myName;
    $("#herNameInput").value = settings.herName;
    $("#startDateInput").value = settings.startDate;
    $("#nextDateInput").value = settings.nextDate;
    $("#nextTitleInput").value = settings.nextTitle;
    $("#heroIntroInput").value = settings.heroIntro;
    $("#letterInput").value = settings.letterBody;
  }

  function openSettings() {
    const dialog = $("#settingsDialog");
    fillSettingsForm();
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
  }

  function closeSettings() {
    const dialog = $("#settingsDialog");
    if (typeof dialog.close === "function") {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
    }
  }

  async function generatePrivateShareLink() {
    const button = $("#generateShareLink");
    const resultBox = $("#shareResult");
    const output = $("#shareLinkOutput");
    const originalLabel = button.innerHTML;

    try {
      button.disabled = true;
      button.textContent = "正在把我们的宇宙装进链接…";
      const nextSettings = readSettingsForm();
      applySettings(nextSettings);
      saveSettings();

      let sharePhotos = $("#includePhotosInput").checked
        ? await prepareSharePhotos()
        : [];
      const shareSettings = {
        myName: settings.myName,
        herName: settings.herName,
        startDate: settings.startDate,
        nextDate: settings.nextDate,
        nextTitle: settings.nextTitle,
        heroIntro: settings.heroIntro,
        letterBody: settings.letterBody,
      };
      let pasteKey = "";

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const payload = {
          v: 1,
          createdAt: new Date().toISOString(),
          settings: shareSettings,
          photos: sharePhotos,
        };
        const token = await encryptSharePayload(payload, accessPassword);
        try {
          pasteKey = await uploadEncryptedShare(token);
          break;
        } catch {
          if (!sharePhotos.length) {
            throw new Error("短链接服务暂时不可用，请稍后再试。");
          }
          sharePhotos = sharePhotos.slice(0, Math.floor(sharePhotos.length / 2));
        }
      }

      if (!pasteKey) {
        throw new Error("照片数量过多，暂时无法生成短链接。");
      }

      const shareUrl = new URL(location.href);
      shareUrl.hash = `${SHARE_HASH_KEY}=paste:${pasteKey}`;

      output.value = shareUrl.href;
      resultBox.hidden = false;
      const copied = await copyText(shareUrl.href);
      showToast(
        copied
          ? `短链接已复制，包含 ${sharePhotos.length} 张照片`
          : "专属链接已生成，请在下方手动复制",
      );
    } catch (error) {
      output.value = "";
      resultBox.hidden = true;
      showToast(error.message || "生成专属链接失败，请稍后再试");
    } finally {
      button.disabled = false;
      button.innerHTML = originalLabel;
    }
  }

  async function initAccessGate() {
    const form = $("#accessForm");
    const input = $("#accessPassword");
    const button = $("button[type='submit']", form);
    const error = $("#gateError");
    const gate = $("#accessGate");

    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 6);
      form.classList.remove("is-wrong");
      error.textContent = "";
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = input.value.trim();
      if (password.length !== 6) {
        form.classList.add("is-wrong");
        error.textContent = "请输入完整的 6 位暗号。";
        input.focus();
        return;
      }

      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      error.textContent = "正在确认你是不是我们的人…";
      try {
        const hash = await sha256Hex(`our-universe:${password}`);
        if (hash !== ACCESS_HASH) {
          throw new Error("暗号不对，再想想属于我们的数字。");
        }

        accessPassword = password;
        let shareToken = getShareToken();
        if (shareToken) {
          if (shareToken.startsWith("paste:")) {
            error.textContent = "正在从银河里取回她收到的内容…";
            shareToken = await downloadEncryptedShare(shareToken.slice(6));
          }
          let payload;
          try {
            payload = await decryptSharePayload(shareToken, password);
          } catch {
            throw new Error("这条专属链接无法解开，可能没有复制完整。");
          }
          if (!payload?.settings) {
            throw new Error("这条专属链接里没有可读取的内容。");
          }
          activeSharePayload = payload;
          applySettings(payload.settings);
          saveSettings();
          photos = Array.isArray(payload.photos) ? payload.photos : [];
          renderGallery();
        } else {
          activeSharePayload = null;
        }

        $("#deletePhoto").hidden = Boolean(activeSharePayload);
        gate.classList.add("is-unlocked");
        gate.setAttribute("aria-hidden", "true");
        document.body.classList.remove("auth-locked");
        document.body.classList.add("site-unlocked");
        input.setAttribute("aria-invalid", "false");
        window.dispatchEvent(new Event("resize"));
        setTimeout(() => {
          $(".hero-copy .button-primary")?.focus({ preventScroll: true });
        }, 900);
      } catch (caughtError) {
        form.classList.remove("is-wrong");
        void form.offsetWidth;
        form.classList.add("is-wrong");
        error.textContent = caughtError.message || "暗号验证失败，请再试一次。";
        input.setAttribute("aria-invalid", "true");
        input.select();
      } finally {
        button.disabled = false;
        button.removeAttribute("aria-busy");
      }
    });
  }

  function bindSettings() {
    $$("[data-open-settings]").forEach((button) => {
      button.addEventListener("click", openSettings);
    });

    $("#dialogClose").addEventListener("click", closeSettings);
    $("#settingsDialog").addEventListener("click", (event) => {
      if (event.target === event.currentTarget) {
        closeSettings();
      }
    });

    $("#settingsForm").addEventListener("submit", (event) => {
      event.preventDefault();
      applySettings(readSettingsForm());
      saveSettings();
      closeSettings();
      showToast("宇宙参数已更新，只属于你们");
    });

    $("#resetSettings").addEventListener("click", () => {
      settings = createDefaultSettings();
      fillSettingsForm();
      showToast("已经准备好一张新的宇宙画布");
    });

    $("#generateShareLink").addEventListener("click", generatePrivateShareLink);
    $("#copyShareLink").addEventListener("click", async () => {
      const value = $("#shareLinkOutput").value;
      if (!value) return;
      const copied = await copyText(value);
      showToast(copied ? "专属链接已再次复制" : "请长按或手动复制下方链接");
    });
  }

  function openPhotoDB() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB is unavailable"));
        return;
      }

      const request = indexedDB.open(PHOTO_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(PHOTO_STORE)) {
          const store = db.createObjectStore(PHOTO_STORE, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function readPhotos() {
    try {
      const db = await openPhotoDB();
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(PHOTO_STORE, "readonly");
        const request = transaction.objectStore(PHOTO_STORE).getAll();
        request.onsuccess = () => {
          const result = request.result.sort((a, b) => b.createdAt - a.createdAt);
          resolve(result);
        };
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => db.close();
      });
    } catch {
      return [];
    }
  }

  async function storePhoto(photo) {
    const db = await openPhotoDB();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(PHOTO_STORE, "readwrite");
      transaction.objectStore(PHOTO_STORE).put(photo);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }

  async function removeStoredPhoto(id) {
    const db = await openPhotoDB();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(PHOTO_STORE, "readwrite");
      transaction.objectStore(PHOTO_STORE).delete(id);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not load image"));
      };
      image.src = url;
    });
  }

  async function compressPhoto(file) {
    const image = await loadImage(file);
    const maxSide = 1800;
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.fillStyle = "#101426";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/webp", 0.82);
  }

  function createUniqueId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `photo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  async function handlePhotoFiles(fileList) {
    const files = [...fileList].filter((file) => file.type.startsWith("image/"));
    if (!files.length) {
      showToast("请选择图片文件");
      return;
    }

    const available = Math.max(0, MAX_PHOTOS - photos.length);
    if (!available) {
      showToast(`最多可以收藏 ${MAX_PHOTOS} 张照片`);
      return;
    }

    const accepted = files.slice(0, available);
    showToast(
      accepted.length > 1
        ? `正在把 ${accepted.length} 颗记忆放进星系…`
        : "正在把这一刻放进星系…",
    );

    for (const [index, file] of accepted.entries()) {
      try {
        const image = await compressPhoto(file);
        const createdAt = Date.now() + index;
        await storePhoto({
          id: createUniqueId(),
          image,
          caption: `我们的第 ${photos.length + index + 1} 颗记忆`,
          createdAt,
        });
      } catch {
        showToast(`有一张图片没能放进星系：${file.name}`);
      }
    }

    photos = await readPhotos();
    renderGallery();
    showToast("照片已经安全地留在这台设备上");
  }

  function createPlaceholder(index) {
    const [title, subtitle] = momentPrompts[index % momentPrompts.length];
    return `
      <button class="photo-item palette-${index % 6} placeholder-tile" type="button"
        data-add-placeholder="${index}" aria-label="添加照片：${title}">
        <span class="placeholder-photo">
          ${placeholderIcon}
          <strong>${title}</strong>
          <span>${subtitle}</span>
        </span>
      </button>`;
  }

  function createPhotoCard(photo) {
    const date = new Date(photo.createdAt);
    return `
      <button class="photo-item" type="button" data-photo-id="${photo.id}"
        aria-label="查看照片：${photo.caption}">
        <img src="${photo.image}" alt="${photo.caption}" loading="lazy" />
        <span class="photo-meta">
          <strong>${escapeHTML(photo.caption)}</strong>
          <small>${formatDateShort(date)}</small>
        </span>
      </button>`;
  }

  function escapeHTML(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function renderGallery() {
    const wall = $("#photoWall");
    $("#photoCount").textContent = photos.length;

    if (!photos.length) {
      wall.innerHTML = momentPrompts.slice(0, 6).map((_, index) => createPlaceholder(index)).join("");
    } else {
      const photoCards = photos.map(createPhotoCard).join("");
      const emptySlots = previewPlaceholders
        ? momentPrompts
            .slice(0, Math.min(6, Math.max(2, 8 - photos.length)))
            .map((_, index) => createPlaceholder(index + photos.length))
            .join("")
        : "";
      wall.innerHTML = photoCards + emptySlots;
    }

    if (!photos.length) {
      previewPlaceholders = false;
    }

    $("#samplePhotosButton").textContent = previewPlaceholders
      ? "收起占位星位"
      : photos.length
        ? "铺满星座位置"
        : "这是照片将出现的位置";

    $$("[data-add-placeholder]", wall).forEach((tile) => {
      tile.addEventListener("click", () => $("#photoInput").click());
    });
    $$("[data-photo-id]", wall).forEach((tile) => {
      tile.addEventListener("click", () => openLightbox(tile.dataset.photoId));
    });
  }

  function openLightbox(id) {
    const photo = photos.find((item) => item.id === id);
    if (!photo) return;
    currentPhotoId = id;
    $("#lightboxImage").src = photo.image;
    $("#lightboxImage").alt = photo.caption;
    $("#lightboxCaption").textContent = photo.caption;
    $("#lightboxDate").textContent = formatDateChinese(new Date(photo.createdAt));
    $("#lightbox").hidden = false;
    document.body.classList.add("modal-open");
    $("#lightboxClose").focus();
  }

  function closeLightbox() {
    $("#lightbox").hidden = true;
    currentPhotoId = null;
    document.body.classList.remove("modal-open");
  }

  function bindGallery() {
    $("#addPhotoButton").addEventListener("click", () => $("#photoInput").click());
    $("#photoInput").addEventListener("change", (event) => {
      handlePhotoFiles(event.target.files);
      event.target.value = "";
    });

    $("#samplePhotosButton").addEventListener("click", () => {
      if (!photos.length) {
        showToast("上传照片后，这里会形成你们的专属星轨");
        $("#photoInput").click();
        return;
      }
      previewPlaceholders = !previewPlaceholders;
      renderGallery();
    });

    const wall = $("#photoWall");
    let dragDepth = 0;
    wall.addEventListener("dragenter", (event) => {
      event.preventDefault();
      dragDepth += 1;
      wall.classList.add("is-dragover");
      $("#dropCue").classList.add("is-visible");
    });
    wall.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    });
    wall.addEventListener("dragleave", () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) {
        wall.classList.remove("is-dragover");
        $("#dropCue").classList.remove("is-visible");
      }
    });
    wall.addEventListener("drop", (event) => {
      event.preventDefault();
      dragDepth = 0;
      wall.classList.remove("is-dragover");
      $("#dropCue").classList.remove("is-visible");
      handlePhotoFiles(event.dataTransfer.files);
    });

    $("#lightboxClose").addEventListener("click", closeLightbox);
    $("#lightbox").addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closeLightbox();
    });

    $("#deletePhoto").addEventListener("click", async () => {
      if (!currentPhotoId) return;
      try {
        await removeStoredPhoto(currentPhotoId);
        photos = await readPhotos();
        closeLightbox();
        renderGallery();
        showToast("这张记忆已从本地照片墙移除");
      } catch {
        showToast("删除失败，请稍后再试");
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !$("#lightbox").hidden) closeLightbox();
    });
  }

  function bindInterface() {
    const header = $("#siteHeader");
    const menuTrigger = $("#menuTrigger");
    const mobileNav = $("#mobileNav");

    const updateHeader = () => header.classList.toggle("is-scrolled", window.scrollY > 24);
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });

    menuTrigger.addEventListener("click", () => {
      const isOpen = mobileNav.classList.toggle("is-open");
      menuTrigger.classList.toggle("is-open", isOpen);
      menuTrigger.setAttribute("aria-expanded", String(isOpen));
      document.body.classList.toggle("modal-open", isOpen);
    });

    $$("a", mobileNav).forEach((link) => {
      link.addEventListener("click", () => {
        mobileNav.classList.remove("is-open");
        menuTrigger.classList.remove("is-open");
        menuTrigger.setAttribute("aria-expanded", "false");
        document.body.classList.remove("modal-open");
      });
    });

    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    $$(".reveal").forEach((element) => revealObserver.observe(element));

    const navLinks = $$(".desktop-nav a");
    const navSections = navLinks
      .map((link) => $(link.getAttribute("href")))
      .filter(Boolean);
    const navObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          navLinks.forEach((link) => {
            link.classList.toggle("is-active", link.getAttribute("href") === `#${entry.target.id}`);
          });
        });
      },
      { threshold: 0.2, rootMargin: "-25% 0px -55% 0px" },
    );
    navSections.forEach((section) => navObserver.observe(section));

    $("#newAffirmation").addEventListener("click", () => setDailyAffirmation(true));

    $("#replayLetter").addEventListener("click", () => {
      const card = $("#letterCard");
      card.classList.remove("is-replaying");
      void card.offsetWidth;
      card.classList.add("is-replaying");
      setTimeout(() => card.classList.remove("is-replaying"), 800);
      $("#letterCard").scrollIntoView({ behavior: "smooth", block: "center" });
    });

    const updateToday = () => {
      $("[data-bind='todayDate']").textContent = formatDateChinese(new Date());
      $("#footerYear").textContent = new Date().getFullYear();
    };
    updateToday();
    setDailyAffirmation();
    setInterval(updateTime, 1000);
    setInterval(updateToday, 60000);
  }

  function bindCursor() {
    if (!window.matchMedia("(pointer: fine)").matches) return;

    const dot = $("#cursorDot");
    const ring = $("#cursorRing");
    let mouseX = -100;
    let mouseY = -100;
    let ringX = -100;
    let ringY = -100;

    window.addEventListener("mousemove", (event) => {
      mouseX = event.clientX;
      mouseY = event.clientY;
      dot.style.transform = `translate(${mouseX}px, ${mouseY}px) translate(-50%, -50%)`;
      document.body.classList.add("has-custom-cursor");
    });

    const animateRing = () => {
      ringX += (mouseX - ringX) * 0.16;
      ringY += (mouseY - ringY) * 0.16;
      ring.style.transform = `translate(${ringX}px, ${ringY}px) translate(-50%, -50%)`;
      requestAnimationFrame(animateRing);
    };
    animateRing();

    document.addEventListener("mouseover", (event) => {
      const interactive = event.target.closest("a, button, .photo-item, input, textarea");
      document.body.classList.toggle("cursor-hover", Boolean(interactive));
    });

    document.addEventListener("mouseleave", () => {
      document.body.classList.remove("has-custom-cursor");
    });
  }

  function initStarfield() {
    const canvas = $("#starfield");
    const context = canvas.getContext("2d");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let stars = [];
    let shootingStars = [];
    let pointerX = 0;
    let pointerY = 0;
    let lastShootingStar = 0;
    let dpr = 1;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.min(190, Math.max(90, Math.floor((width * height) / 9000)));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: Math.random() * 1.25 + 0.2,
        alpha: Math.random() * 0.65 + 0.12,
        speed: Math.random() * 0.025 + 0.004,
        phase: Math.random() * Math.PI * 2,
        hue: Math.random() > 0.82 ? "rose" : "white",
      }));
    }

    window.addEventListener("resize", resize);
    window.addEventListener(
      "mousemove",
      (event) => {
        pointerX = (event.clientX / width - 0.5) * 12;
        pointerY = (event.clientY / height - 0.5) * 12;
      },
      { passive: true },
    );

    function draw(timestamp) {
      context.clearRect(0, 0, width, height);

      stars.forEach((star) => {
        const twinkle = star.alpha + Math.sin(timestamp * 0.001 + star.phase) * 0.15;
        context.beginPath();
        context.fillStyle =
          star.hue === "rose"
            ? `rgba(255, 189, 199, ${Math.max(0.06, twinkle)})`
            : `rgba(225, 226, 244, ${Math.max(0.06, twinkle)})`;
        context.arc(star.x + pointerX * star.radius * 0.4, star.y + pointerY * star.radius * 0.3, star.radius, 0, Math.PI * 2);
        context.fill();

        if (!reducedMotion) {
          star.y -= star.speed;
          if (star.y < -4) star.y = height + 4;
        }
      });

      if (!reducedMotion && timestamp - lastShootingStar > 7000 + Math.random() * 9000) {
        lastShootingStar = timestamp;
        shootingStars.push({
          x: Math.random() * width * 0.75 + width * 0.15,
          y: Math.random() * height * 0.32,
          vx: 3.3 + Math.random() * 2,
          vy: 1.25 + Math.random(),
          alpha: 1,
        });
      }

      shootingStars.forEach((shootingStar) => {
        const tailX = shootingStar.x - shootingStar.vx * 22;
        const tailY = shootingStar.y - shootingStar.vy * 22;
        const gradient = context.createLinearGradient(tailX, tailY, shootingStar.x, shootingStar.y);
        gradient.addColorStop(0, "rgba(232,166,180,0)");
        gradient.addColorStop(1, `rgba(255,225,219,${shootingStar.alpha})`);
        context.beginPath();
        context.strokeStyle = gradient;
        context.lineWidth = 1;
        context.moveTo(tailX, tailY);
        context.lineTo(shootingStar.x, shootingStar.y);
        context.stroke();
        shootingStar.x += shootingStar.vx;
        shootingStar.y += shootingStar.vy;
        shootingStar.alpha -= 0.008;
      });
      shootingStars = shootingStars.filter(
        (shootingStar) => shootingStar.alpha > 0 && shootingStar.y < height,
      );

      requestAnimationFrame(draw);
    }

    resize();
    requestAnimationFrame(draw);
  }

  function initLoveGame() {
    const canvas = $("#loveGame");
    const context = canvas.getContext("2d");
    const overlay = $("#gameOverlay");
    const overlayTitle = $("#overlayTitle");
    const overlayText = $("#overlayText");
    const overlayButton = $("#overlayButton");
    const startButtons = [$("#gameStart"), overlayButton];

    let width = 760;
    let height = 600;
    let dpr = 1;
    let objects = [];
    let particles = [];
    let running = false;
    let score = 0;
    let timeLeft = 30;
    let lastTime = performance.now();
    let spawnAccumulator = 0;
    let audioContext = null;
    let gameBest = Number(localStorage.getItem(GAME_BEST_KEY) || 0);

    $("#gameBest").textContent = gameBest;

    function resizeGame() {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(280, rect.width);
      height = Math.max(280, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function emitSound(frequency, duration = 0.12) {
      try {
        audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(
          frequency * 1.35,
          audioContext.currentTime + duration,
        );
        gain.gain.setValueAtTime(0.035, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start();
        oscillator.stop(audioContext.currentTime + duration);
      } catch {
        // Sound is a progressive enhancement.
      }
    }

    function addObject(forceType) {
      const type = forceType || (Math.random() > 0.72 ? "heart" : "star");
      const margin = 42;
      objects.push({
        x: margin + Math.random() * Math.max(20, width - margin * 2),
        y: height + 35 + Math.random() * 80,
        radius: type === "heart" ? 22 + Math.random() * 7 : 14 + Math.random() * 5,
        type,
        speed: 27 + Math.random() * 31,
        drift: Math.random() * 0.7 + 0.3,
        phase: Math.random() * Math.PI * 2,
        rotation: Math.random() * Math.PI,
        alpha: 0.72 + Math.random() * 0.28,
      });
    }

    function resetGame() {
      objects = Array.from({ length: 7 }, (_, index) => {
        addObject();
        const object = objects.pop();
        object.y = height * (0.16 + Math.random() * 0.72);
        object.phase += index;
        return object;
      });
      particles = [];
      score = 0;
      timeLeft = 30;
      spawnAccumulator = 0;
      $("#gameScore").textContent = score;
      $("#gameTime").textContent = Math.ceil(timeLeft);
    }

    function startGame() {
      resizeGame();
      resetGame();
      running = true;
      overlay.classList.add("is-hidden");
      startButtons[0].querySelector("span").textContent = "重新开始";
      emitSound(440, 0.18);
    }

    function finishGame(won) {
      if (!running) return;
      running = false;
      if (score > gameBest) {
        gameBest = score;
        $("#gameBest").textContent = gameBest;
        localStorage.setItem(GAME_BEST_KEY, String(gameBest));
      }
      overlayTitle.innerHTML = won
        ? "你就是我的<br />整片银河"
        : "心动还没有集满<br />要不要再来一次";
      overlayText.textContent = won
        ? `收集了 ${score} 点心动 · 最高纪录 ${gameBest}`
        : `本次收集 ${score} 点心动 · 最高纪录 ${gameBest}`;
      overlayButton.textContent = won ? "再点亮一次" : "继续收集";
      overlay.classList.remove("is-hidden");
      if (won) {
        emitSound(660, 0.25);
        setTimeout(() => emitSound(880, 0.3), 150);
        showToast("今晚的银河，被你点亮了");
      }
    }

    function drawHeart(x, y, radius, rotation, alpha) {
      context.save();
      context.translate(x, y);
      context.rotate(rotation);
      context.scale(radius / 24, radius / 24);
      const gradient = context.createLinearGradient(-20, -18, 20, 22);
      gradient.addColorStop(0, `rgba(255, 219, 216, ${alpha})`);
      gradient.addColorStop(1, `rgba(216, 111, 144, ${alpha})`);
      context.beginPath();
      context.moveTo(0, 20);
      context.bezierCurveTo(-3, 16, -21, 5, -21, -7);
      context.bezierCurveTo(-21, -17, -8, -21, 0, -10);
      context.bezierCurveTo(8, -21, 21, -17, 21, -7);
      context.bezierCurveTo(21, 5, 3, 16, 0, 20);
      context.closePath();
      context.fillStyle = gradient;
      context.shadowColor = "rgba(255, 177, 191, 0.58)";
      context.shadowBlur = 18;
      context.fill();
      context.restore();
    }

    function drawStar(x, y, radius, rotation, alpha) {
      context.save();
      context.translate(x, y);
      context.rotate(rotation);
      context.beginPath();
      for (let point = 0; point < 8; point += 1) {
        const angle = (Math.PI * 2 * point) / 8 - Math.PI / 2;
        const currentRadius = point % 2 === 0 ? radius : radius * 0.3;
        const px = Math.cos(angle) * currentRadius;
        const py = Math.sin(angle) * currentRadius;
        if (point === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.closePath();
      context.fillStyle = `rgba(255, 239, 205, ${alpha})`;
      context.shadowColor = "rgba(255, 226, 177, 0.7)";
      context.shadowBlur = 17;
      context.fill();
      context.restore();
    }

    function burst(x, y, type) {
      const count = type === "heart" ? 13 : 9;
      for (let index = 0; index < count; index += 1) {
        const angle = (Math.PI * 2 * index) / count + Math.random() * 0.4;
        const speed = 25 + Math.random() * 80;
        particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1,
          type,
        });
      }
    }

    function collectAt(event) {
      if (!running) return;
      const rect = canvas.getBoundingClientRect();
      const pointX = event.clientX - rect.left;
      const pointY = event.clientY - rect.top;
      let targetIndex = -1;
      let shortest = 45;

      objects.forEach((object, index) => {
        const distance = Math.hypot(pointX - object.x, pointY - object.y);
        if (distance < object.radius + 20 && distance < shortest) {
          shortest = distance;
          targetIndex = index;
        }
      });

      if (targetIndex >= 0) {
        const [object] = objects.splice(targetIndex, 1);
        score += object.type === "heart" ? 2 : 1;
        score = Math.min(score, 12);
        $("#gameScore").textContent = score;
        burst(object.x, object.y, object.type);
        emitSound(object.type === "heart" ? 560 : 760, 0.11);
        if (score >= 12) finishGame(true);
      }
    }

    function drawBackground(time) {
      const gradient = context.createRadialGradient(
        width * 0.72,
        height * 0.22,
        0,
        width * 0.5,
        height * 0.5,
        width * 0.7,
      );
      gradient.addColorStop(0, "rgba(91, 72, 130, 0.21)");
      gradient.addColorStop(0.55, "rgba(18, 24, 55, 0.08)");
      gradient.addColorStop(1, "rgba(5, 8, 22, 0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);

      context.save();
      for (let index = 0; index < 24; index += 1) {
        const x = ((index * 97.31) % width) + Math.sin(time * 0.00018 + index) * 8;
        const y = ((index * 163.77) % height) + Math.cos(time * 0.00022 + index) * 6;
        const alpha = 0.08 + ((index * 7) % 11) / 50;
        context.fillStyle = `rgba(238, 231, 240, ${alpha})`;
        context.beginPath();
        context.arc(x, y, index % 7 === 0 ? 1.2 : 0.65, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
    }

    function gameLoop(time) {
      const delta = Math.min(0.045, (time - lastTime) / 1000 || 0);
      lastTime = time;
      context.clearRect(0, 0, width, height);
      drawBackground(time);

      if (running) {
        timeLeft = Math.max(0, timeLeft - delta);
        $("#gameTime").textContent = Math.ceil(timeLeft);
        spawnAccumulator += delta;
        if (spawnAccumulator > 0.34 && objects.length < 14) {
          spawnAccumulator = 0;
          addObject();
        }
        if (timeLeft <= 0) finishGame(false);
      }

      objects.forEach((object) => {
        if (running) {
          object.y -= object.speed * delta;
          object.x += Math.sin(time * 0.001 + object.phase) * object.drift;
          object.rotation += delta * 0.35;
          if (object.y < -50) {
            object.y = height + 48 + Math.random() * 65;
            object.x = 42 + Math.random() * Math.max(20, width - 84);
          }
        } else {
          object.y += Math.sin(time * 0.0008 + object.phase) * 0.015;
          object.rotation += delta * 0.08;
        }
        if (object.type === "heart") {
          drawHeart(object.x, object.y, object.radius, object.rotation, object.alpha);
        } else {
          drawStar(object.x, object.y, object.radius, object.rotation, object.alpha);
        }
      });

      particles.forEach((particle) => {
        particle.x += particle.vx * delta;
        particle.y += particle.vy * delta;
        particle.vx *= 0.98;
        particle.vy *= 0.98;
        particle.life -= delta * 1.8;
        if (particle.type === "heart") {
          drawHeart(particle.x, particle.y, 3 + particle.life * 4, 0, particle.life);
        } else {
          context.fillStyle = `rgba(255, 231, 193, ${particle.life})`;
          context.beginPath();
          context.arc(particle.x, particle.y, 1.2 + particle.life, 0, Math.PI * 2);
          context.fill();
        }
      });
      particles = particles.filter((particle) => particle.life > 0);

      requestAnimationFrame(gameLoop);
    }

    startButtons.forEach((button) => button.addEventListener("click", startGame));
    canvas.addEventListener("pointerdown", collectAt);
    window.addEventListener("resize", resizeGame);

    resizeGame();
    resetGame();
    requestAnimationFrame(gameLoop);
  }

  function boot() {
    document.body.classList.add("is-loading");
    applySettings(settings);
    bindSettings();
    bindInterface();
    bindGallery();
    bindCursor();
    initAccessGate();
    initStarfield();
    initLoveGame();

    readPhotos().then((storedPhotos) => {
      if (!activeSharePayload) {
        photos = storedPhotos;
        renderGallery();
      }
    });

    const finishLoading = () => {
      setTimeout(() => {
        $("#loader").classList.add("is-hidden");
        document.body.classList.remove("is-loading");
        if (document.body.classList.contains("auth-locked")) {
          $("#accessPassword").focus();
        }
      }, 650);
    };

    if (document.readyState === "complete") finishLoading();
    else window.addEventListener("load", finishLoading, { once: true });
  }

  boot();
})();
