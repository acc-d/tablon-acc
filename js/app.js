import supabase from "./supabase.js";

const EVENT_CODE_KEY = "rally-board:event-code";
const NEW_CONTENT_HOURS = 24;
let activeEvent = null;
let cacheKey = "rally-board:pending";
const VAPID_PUBLIC_KEY = "BCfri1kmtyIK-0NokFCEmrakvdO8p_RIUNqmloX9eAKkPtL90Q5gkdPNYSWwoFJH6M8H6H42R3HQuaF8FvdpkNE";

const accessScreen = document.querySelector("#access-screen");
const accessForm = document.querySelector("#access-form");
const eventCodeInput = document.querySelector("#event-code");
const accessButton = document.querySelector("#access-button");
const accessMessage = document.querySelector("#access-message");
const changeEventButton = document.querySelector("#change-event-button");

const eventName = document.querySelector("#event-name");
const eventDetails = document.querySelector("#event-details");
const statusElement = document.querySelector("#status");
const refreshButton = document.querySelector("#refresh-button");
const installButton = document.querySelector("#install-button");
const notificationsButton = document.querySelector("#notifications-button");
const updateBanner = document.querySelector("#update-banner");
const updateButton = document.querySelector("#update-button");
const offlineNotice = document.querySelector("#offline-notice");

const tabs = [...document.querySelectorAll(".tab")];
const announcementsView = document.querySelector("#announcements-view");
const documentsView = document.querySelector("#documents-view");

const announcementsList = document.querySelector("#announcements-list");
const foldersList = document.querySelector("#folders-list");

const announcementTemplate =
  document.querySelector("#announcement-template");
const folderTemplate =
  document.querySelector("#folder-template");
const documentTemplate =
  document.querySelector("#document-template");

let deferredInstallPrompt = null;
let waitingServiceWorker = null;

function formatDate(dateValue) {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(dateValue));
}

function formatEventDates(startDate, endDate) {
  if (!startDate) {
    return "";
  }

  const formatter = new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });

  const start = formatter.format(
    new Date(`${startDate}T12:00:00`)
  );

  if (!endDate || endDate === startDate) {
    return start;
  }

  const end = formatter.format(
    new Date(`${endDate}T12:00:00`)
  );

  return `${start} – ${end}`;
}

function isNew(dateValue) {
  const createdAt = new Date(dateValue).getTime();
  const limit = NEW_CONTENT_HOURS * 60 * 60 * 1000;

  return Date.now() - createdAt <= limit;
}

function setStatus(message = "", kind = "") {
  statusElement.textContent = message;
  statusElement.className = "status";

  if (kind) {
    statusElement.classList.add(`status--${kind}`);
  }

  statusElement.hidden = !message;
}


function normalizeEventCode(value) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function showAccessScreen(message = "") {
  accessScreen.hidden = false;
  accessMessage.textContent = message;
  eventCodeInput.focus();
}

async function enterEvent(code) {
  const normalizedCode = normalizeEventCode(code);

  if (!normalizedCode) {
    accessMessage.textContent = "Introduce un código.";
    return;
  }

  accessButton.disabled = true;
  accessButton.textContent = "Comprobando…";
  accessMessage.textContent = "";

  localStorage.setItem(EVENT_CODE_KEY, normalizedCode);

  try {
    await loadPublicBoard();
  } finally {
    accessButton.disabled = false;
    accessButton.textContent = "Entrar";
  }

  if (!activeEvent) {
    showAccessScreen("Código incorrecto. Revísalo e inténtalo otra vez.");
  }
}

function showView(viewName) {
  const showAnnouncements = viewName === "announcements";

  announcementsView.hidden = !showAnnouncements;
  documentsView.hidden = showAnnouncements;

  accessForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await enterEvent(eventCodeInput.value);
});

changeEventButton.addEventListener("click", async () => {
  const confirmed = window.confirm(
    "¿Quieres salir de este rally e introducir otro código?"
  );

  if (!confirmed) {
    return;
  }

  localStorage.removeItem(EVENT_CODE_KEY);
  activeEvent = null;
  eventCodeInput.value = "";
  showAccessScreen();
});

for (const tab of tabs) {
    const isActive = tab.dataset.view === viewName;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  }
}

function renderAnnouncements(posts) {
  announcementsList.replaceChildren();

  if (!posts.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent =
      "Todavía no se ha publicado ningún comunicado.";
    announcementsList.appendChild(empty);
    return;
  }

  for (const post of posts) {
    const fragment =
      announcementTemplate.content.cloneNode(true);

    fragment.querySelector(
      ".announcement-card__date"
    ).textContent = formatDate(post.created_at);

    fragment.querySelector(
      ".announcement-card__title"
    ).textContent = post.title;

    const textElement = fragment.querySelector(
      ".announcement-card__text"
    );

    if (post.content) {
      textElement.textContent = post.content;
    } else {
      textElement.remove();
    }

    const badge = fragment.querySelector(".new-badge");
    badge.hidden = !isNew(post.created_at);

    announcementsList.appendChild(fragment);
  }
}

function getItemUrl(post) {
  if (post.type === "document") {
    return post.document_url || post.url || "";
  }

  if (post.type === "link") {
    return post.url || "";
  }

  return "";
}

function createDocumentItem(post) {
  const fragment =
    documentTemplate.content.cloneNode(true);

  const link = fragment.querySelector(".document-item");
  const icon = fragment.querySelector(".document-item__icon");
  const title = fragment.querySelector(".document-item__title");
  const description = fragment.querySelector(
    ".document-item__description"
  );
  const date = fragment.querySelector(".document-item__date");
  const badge = fragment.querySelector(".new-badge");

  link.href = getItemUrl(post);
  icon.textContent = post.type === "link" ? "🔗" : "📄";
  title.textContent = post.title;
  date.textContent = formatDate(post.created_at);
  badge.hidden = !isNew(post.created_at);

  if (post.content) {
    description.textContent = post.content;
  } else {
    description.remove();
  }

  return fragment;
}

function renderFolders(categories, posts) {
  foldersList.replaceChildren();

  if (!categories.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No hay categorías disponibles.";
    foldersList.appendChild(empty);
    return;
  }

  for (const category of categories) {
    const categoryPosts = posts.filter(
      (post) => Number(post.category_id) === Number(category.id)
    );

    const fragment = folderTemplate.content.cloneNode(true);
    const folder = fragment.querySelector(".folder");
    const header = fragment.querySelector(".folder__header");
    const title = fragment.querySelector(".folder__title");
    const count = fragment.querySelector(".folder__count");
    const items = fragment.querySelector(".folder__items");

    title.textContent = category.name;
    count.textContent =
      `${categoryPosts.length} ${
        categoryPosts.length === 1 ? "elemento" : "elementos"
      }`;

    if (!categoryPosts.length) {
      const empty = document.createElement("p");
      empty.className = "folder__empty";
      empty.textContent =
        "Todavía no hay contenido en esta carpeta.";
      items.appendChild(empty);
    } else {
      for (const post of categoryPosts) {
        const url = getItemUrl(post);

        if (!url) {
          continue;
        }

        items.appendChild(createDocumentItem(post));
      }
    }

    header.addEventListener("click", () => {
      const expanded =
        header.getAttribute("aria-expanded") === "true";

      header.setAttribute("aria-expanded", String(!expanded));
      items.hidden = expanded;
      folder.classList.toggle("is-open", !expanded);
    });

    foldersList.appendChild(fragment);
  }
}

function renderBoardData(payload) {
  const { event, posts = [], categories = [] } = payload;

  eventName.textContent = event.name;

  const dateText = formatEventDates(
    event.start_date,
    event.end_date
  );

  eventDetails.textContent = [
    event.location,
    dateText
  ].filter(Boolean).join(" · ");

  document.title = `${event.name} | Rally Board`;

  const announcements = posts.filter(
    (post) => post.type === "news" || !post.type
  );

  const documents = posts.filter(
    (post) =>
      post.type === "document" ||
      post.type === "link"
  );

  renderAnnouncements(announcements);
  renderFolders(categories, documents);
}

function saveLastBoard(payload) {
  try {
    localStorage.setItem(
      cacheKey,
      JSON.stringify({
        savedAt: Date.now(),
        payload
      })
    );
  } catch (error) {
    console.warn("No se pudo guardar la copia local:", error);
  }
}

function loadLastBoard() {
  try {
    const rawValue = localStorage.getItem(cacheKey);

    if (!rawValue) {
      return null;
    }

    return JSON.parse(rawValue)?.payload ?? null;
  } catch (error) {
    console.warn("No se pudo leer la copia local:", error);
    return null;
  }
}

async function loadPublicBoard() {
  setStatus("Cargando información…");
  refreshButton.disabled = true;

  try {
    const storedCode = localStorage.getItem(EVENT_CODE_KEY);

    if (!storedCode) {
      throw new Error("Introduce el código del rally.");
    }

    const normalizedCode = storedCode.trim().toUpperCase();

    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id, slug, access_code, name, location, start_date, end_date")
      .eq("access_code", normalizedCode)
      .single();

    if (eventError) {
      localStorage.removeItem(EVENT_CODE_KEY);
      throw new Error("El código no existe o no está activo.");
    }

    activeEvent = event;
    cacheKey = `rally-board:${event.slug}`;
    accessScreen.hidden = true;

    const [
      { data: posts, error: postsError },
      { data: categories, error: categoriesError }
    ] = await Promise.all([
      supabase
        .from("posts")
        .select(
          "id, title, content, type, category_id, url, document_url, created_at"
        )
        .eq("event_id", event.id)
        .order("created_at", { ascending: false }),

      supabase
        .from("categories")
        .select("id, name, sort_order")
        .order("sort_order", { ascending: true })
    ]);

    if (postsError) {
      throw postsError;
    }

    if (categoriesError) {
      throw categoriesError;
    }

    const payload = {
      event,
      posts: posts ?? [],
      categories: categories ?? []
    };

    renderBoardData(payload);
    saveLastBoard(payload);
    setStatus("");
  } catch (error) {
    console.error(error);

    const cachedPayload = loadLastBoard();

    if (cachedPayload) {
      renderBoardData(cachedPayload);
      setStatus(
        "No se pudo actualizar. Se muestra la última información guardada.",
        "warning"
      );
    } else {
      eventName.textContent = "No se pudo cargar el rally";
      eventDetails.textContent = "";

      setStatus(
        `No se pudo cargar la información: ${error.message}`,
        "error"
      );
    }
  } finally {
    refreshButton.disabled = false;
  }
}


function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(
    (character) => character.charCodeAt(0)
  ));
}

function updateNotificationButton() {
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    notificationsButton.textContent = "Avisos no compatibles";
    notificationsButton.disabled = true;
    return;
  }

  if (Notification.permission === "granted") {
    notificationsButton.textContent = "Avisos activados";
    notificationsButton.disabled = true;
    return;
  }

  if (Notification.permission === "denied") {
    notificationsButton.textContent = "Avisos bloqueados";
    notificationsButton.disabled = true;
    return;
  }

  notificationsButton.textContent = "Activar avisos";
  notificationsButton.disabled = false;
}

async function enablePushNotifications() {
  notificationsButton.disabled = true;
  notificationsButton.textContent = "Activando…";

  try {
    const permission = await Notification.requestPermission();

    if (permission !== "granted") {
      updateNotificationButton();
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription =
      await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey:
          urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }

    const subscriptionData = subscription.toJSON();

    const { error } = await supabase
      .from("push_subscriptions")
      .insert({
        event_slug: activeEvent.slug,
        endpoint: subscriptionData.endpoint,
        p256dh: subscriptionData.keys?.p256dh,
        auth: subscriptionData.keys?.auth,
        user_agent: navigator.userAgent
      });

    if (error && error.code !== "23505") {
      throw error;
    }

    updateNotificationButton();
  } catch (error) {
    console.error("No se pudieron activar los avisos:", error);
    notificationsButton.textContent = "Reintentar avisos";
    notificationsButton.disabled = false;
    alert(`No se pudieron activar los avisos: ${error.message}`);
  }
}

function updateConnectionStatus() {
  offlineNotice.hidden = navigator.onLine;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    const registration =
      await navigator.serviceWorker.register("./service-worker.js");

    if (registration.waiting) {
      waitingServiceWorker = registration.waiting;
      updateBanner.hidden = false;
    }

    registration.addEventListener("updatefound", () => {
      const installingWorker = registration.installing;

      if (!installingWorker) {
        return;
      }

      installingWorker.addEventListener("statechange", () => {
        if (
          installingWorker.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          waitingServiceWorker = installingWorker;
          updateBanner.hidden = false;
        }
      });
    });

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => {
        window.location.reload();
      }
    );
  } catch (error) {
    console.error("No se pudo registrar la PWA:", error);
  }
}

for (const tab of tabs) {
  tab.addEventListener("click", () => {
    showView(tab.dataset.view);
  });
}

refreshButton.addEventListener("click", loadPublicBoard);

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.hidden = false;
});

notificationsButton.addEventListener("click", enablePushNotifications);

installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) {
    return;
  }

  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;

  deferredInstallPrompt = null;
  installButton.hidden = true;
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  installButton.hidden = true;
});

updateButton.addEventListener("click", () => {
  if (!waitingServiceWorker) {
    window.location.reload();
    return;
  }

  waitingServiceWorker.postMessage({
    type: "SKIP_WAITING"
  });
});

window.addEventListener("online", () => {
  updateConnectionStatus();
  loadPublicBoard();
});

window.addEventListener("offline", updateConnectionStatus);

showView("announcements");
updateConnectionStatus();
updateNotificationButton();
registerServiceWorker();

const savedEventCode = localStorage.getItem(EVENT_CODE_KEY);

if (savedEventCode) {
  eventCodeInput.value = savedEventCode;
  loadPublicBoard();
} else {
  showAccessScreen();
}
