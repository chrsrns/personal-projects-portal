const { isAllowedUrl } = require("./urlUtils");

////////////////////////////////////////////////////////
// WebSocket Connection Helpers
////////////////////////////////////////////////////////

const handleResumeChange = (event) => {
  console.log(`Resume ${event.resume_id} changed:`, event.action);
  const { apiBaseUrl, resumeId } = getConfig();

  // Check if action is valid
  // For the purposes of this function, we only care about the 'updated' property
  if (event.action === null || typeof event.action !== 'object' || !('updated' in event.action)) {
    return;
  }

  console.log('Update type:', event.action.updated);
  switch (event.action.updated) {
    case 'projects':
      refreshPortfolioProjects(apiBaseUrl, resumeId);
      break;
    default:
      console.log('Unknown update type:', event.action.updated);
  }

};

const handleWebSocketMessage = (event) => {
  try {
    const message = JSON.parse(event.data);

    switch (message.type) {
      case 'resume.changed':
        handleResumeChange(message);
        break;
      case 'error':
        console.error('WebSocket error:', message.message);
        break;
      default:
        console.log('Unknown message type:', message);
    }
  } catch (error) {
    console.error('Failed to parse WebSocket message:', error);
  }
};

const createWebSocketConnection = (apiBaseUrl, resumeId, authToken = null) => {
  // Determine protocol (wss for HTTPS, ws for HTTP)
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  let wsHostPath;
  if (/^https?:\/\//.test(apiBaseUrl)) {
    // Absolute URL: strip protocol and trailing slashes
    wsHostPath = apiBaseUrl
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');
  } else {
    // Relative URL: prepend current host and strip trailing slashes
    const base = apiBaseUrl.replace(/\/+$/, '');
    wsHostPath = `${window.location.host}${base}`;
  }

  const wsUrl = `${protocol}//${wsHostPath}/ws`;

  const ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    console.log('WebSocket connected');
    // Send initial subscribe message
    const subscribeMessage = {
      type: 'subscribe',
      resume_id: resumeId,
    };
    if (authToken) {
      subscribeMessage.token = authToken;
    }
    ws.send(JSON.stringify(subscribeMessage));
  });

  return ws;
};

const createWebSocketWithReconnect = (apiBaseUrl, resumeId, authToken = null) => {
  let ws = null;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;
  const reconnectDelay = 1000;

  const connect = () => {
    ws = createWebSocketConnection(apiBaseUrl, resumeId, authToken);

    ws.addEventListener('message', handleWebSocketMessage);

    ws.addEventListener('close', (event) => {
      console.log('WebSocket closed:', event.code, event.reason);

      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        console.log(`Reconnecting... Attempt ${reconnectAttempts}/${maxReconnectAttempts}`);
        setTimeout(connect, reconnectDelay * reconnectAttempts);
      }
    });

    ws.addEventListener('error', (error) => {
      console.error('WebSocket error:', error);
    });
  };

  connect();
  return ws;
};

////////////////////////////////////////////////////////
// API Access Helpers
////////////////////////////////////////////////////////

const getConfig = () => {
  const cfg = window.__CONFIG__ || {};
  return {
    apiBaseUrl: typeof cfg.API_BASE_URL === "string" ? cfg.API_BASE_URL : "/api",
    resumeId:
      typeof cfg.RESUME_ID === "number"
        ? cfg.RESUME_ID
        : Number.parseInt(String(cfg.RESUME_ID || "1"), 10),
  };
};

const buildUrl = (apiBaseUrl, path) => {
  const base = apiBaseUrl.endsWith("/") ? apiBaseUrl.slice(0, -1) : apiBaseUrl;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
};

const fetchBody = async (apiBaseUrl, path) => {
  const url = buildUrl(apiBaseUrl, path);
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      if (data && typeof data.body === "string") msg = data.body;
    } catch {
      // ignore
    }
    throw new Error(`${res.status}: ${msg}`);
  }

  const data = await res.json();
  return data.body;
};

////////////////////////////////////////////////////////
// DOM Manipulation Helpers
////////////////////////////////////////////////////////

const sortByDisplayOrder = (a, b) => {
  const ao = a && a.display_order != null ? a.display_order : Number.MAX_SAFE_INTEGER;
  const bo = b && b.display_order != null ? b.display_order : Number.MAX_SAFE_INTEGER;
  if (ao !== bo) return ao - bo;
  const aid = a && a.id != null ? a.id : 0;
  const bid = b && b.id != null ? b.id : 0;
  return aid - bid;
};

const clearEl = (el) => {
  for (const child of Array.from(el.children)) {
    if (!child.id || !child.classList.contains("overlay-placeholder")) {
      el.removeChild(child);
    } else if (child.classList.contains("overlay-placeholder")) {
      child.classList.remove('opacity-100');
      child.classList.add('opacity-0');

      child.addEventListener('transitionend', () => {
        child.classList.add('hidden');
      }, { once: true });
    }
  }
};

const reAddSectionPlaceholder = (sectionEl) => {
  for (const child of Array.from(sectionEl.children)) {
    if (child.classList.contains("overlay-placeholder")) {
      child.classList.add('opacity-100');
      child.classList.remove('opacity-0');
      child.classList.remove('hidden');
    }
  }
}

const el = (tag, attrs = {}, children = []) => {
  const svgTags = new Set([
    "svg",
    "path",
    "g",
    "circle",
    "rect",
    "line",
    "polyline",
    "polygon",
    "ellipse",
    "defs",
    "linearGradient",
    "stop",
  ]);

  const node = svgTags.has(tag)
    ? document.createElementNS("http://www.w3.org/2000/svg", tag)
    : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") {
      if (node instanceof SVGElement) node.setAttribute("class", v);
      else node.className = v;
    }
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, String(v));
  }
  for (const child of children) {
    if (child == null) continue;
    node.appendChild(child);
  }
  return node;
};

////////////////////////////////////////////////////////
// Section Rendering
////////////////////////////////////////////////////////

const projectCardsById = new Map();
let expandedProjectId = null;

const resetGridTemplateRows = (grid) => {
  if (!grid) return;
  grid.style.gridTemplateRows = "";
};

const updateGridTemplateRows = (card) => {
  const grid = card && card.parentNode;
  if (!grid) return;

  const cards = Array.from(grid.children).filter((c) => !c.classList.contains("overlay-placeholder"));
  const expandedIndex = cards.indexOf(card);
  if (expandedIndex === -1) return;

  const rows = cards.map((_, i) => (i === expandedIndex ? "1fr" : "auto"));
  grid.style.gridTemplateRows = rows.join(" ");
};

const collapseCard = (id) => {
  if (id == null) return;
  const data = projectCardsById.get(String(id));
  if (!data) return;

  data.card.setAttribute("aria-expanded", "false");
  data.card.classList.remove("col-span-full", "h-[calc(100dvh-4rem)]", "lg:flex-row", "overflow-hidden", "shadow-2xl");
  data.card.classList.add("shadow-xl");
  data.article.classList.remove("h-full", "w-full", "flex", "flex-col", "lg:flex-row");
  data.mediaWrapper.classList.remove("h-1/2", "lg:h-full", "lg:w-1/2");
  data.contentDiv.classList.remove("h-1/2", "lg:h-full", "lg:w-1/2", "overflow-y-auto");

  if (data.safeProjectLink) {
    data.titleLink.replaceWith(data.titleContainer);
    data.titleChildren.forEach((child) => data.titleContainer.appendChild(child));
  }

  if (data.safeVideoUrl) {
    data.video.pause();
    data.video.src = "";
    data.video.classList.add("hidden");
    data.img.classList.remove("hidden");
    data.spinner.classList.add("hidden");
  }

  resetGridTemplateRows(data.card.parentNode);
  expandedProjectId = null;
};

const expandCard = (id) => {
  const targetId = String(id);
  if (expandedProjectId === targetId) return;

  collapseCard(expandedProjectId);

  const data = projectCardsById.get(targetId);
  if (!data) return;

  data.card.setAttribute("aria-expanded", "true");
  data.card.classList.remove("shadow-xl");
  data.card.classList.add("col-span-full", "h-[calc(100dvh-4rem)]", "lg:flex-row", "overflow-hidden", "shadow-2xl");
  data.article.classList.add("h-full", "w-full", "flex", "flex-col", "lg:flex-row");
  data.mediaWrapper.classList.add("h-1/2", "lg:h-full", "lg:w-1/2");
  data.contentDiv.classList.add("h-1/2", "lg:h-full", "lg:w-1/2", "overflow-y-auto");

  if (data.safeProjectLink) {
    data.titleLink.href = data.safeProjectLink;
    data.titleChildren.forEach((child) => data.titleLink.appendChild(child));
    data.titleContainer.replaceWith(data.titleLink);
  }

  if (data.safeVideoUrl) {
    data.video.src = data.safeVideoUrl;
    data.spinner.classList.remove("hidden");
    data.video.classList.add("hidden");
    data.img.classList.remove("hidden");
    if (data.overlay) {
      data.overlay.classList.remove("opacity-0");
      data.overlay.classList.add("opacity-100");
    }
    const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced) data.video.play();
  }

  updateGridTemplateRows(data.card);

  const scrollReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  data.scrollAnchor.scrollIntoView({ behavior: scrollReduced ? "auto" : "smooth", block: "start" });

  expandedProjectId = targetId;
};

const createProjectCard = (p, keyPointsByProjectId, techByProjectId) => {
  const safeProjectLink = isAllowedUrl(p.project_link);
  const safeSourceLink = isAllowedUrl(p.source_code_link);
  const safeImageUrl = isAllowedUrl(p.image_url);
  const safeVideoUrl = isAllowedUrl(p.video_url);

  const noPreview = !safeProjectLink;

  // Create project card structure
  const card = el("div", {
    class: "rounded-lg glow-on-hover shadow-xl transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 motion-reduce:transition-none",
    tabindex: "0",
    role: "button",
    "aria-expanded": "false",
    "data-project-id": String(p.id)
  });

  const article = el("article", { class: "group" });

  // Media wrapper contains image and optional video; no link while collapsed
  const mediaWrapper = el("div", { class: "relative aspect-square flex items-center justify-center" });
  const img = el("img", {
    alt: "",
    src: safeImageUrl || "/img/placeholder.png",
    class: "h-full w-full rounded-xl object-contain object-center shadow-xl transition"
  });
  mediaWrapper.appendChild(img);

  const spinner = el("div", {
    class: "absolute inset-0 hidden items-center justify-center text-sm text-gray-500"
  }, [
    el("span", { text: "Loading video…" })
  ]);
  mediaWrapper.appendChild(spinner);

  const video = el("video", {
    class: "hidden h-full w-full object-contain",
    muted: true,
    controls: true,
    loop: true,
    playsinline: true,
    autoplay: true,
  });
  mediaWrapper.appendChild(video);
  video.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  const overlay = safeVideoUrl
    ? el("div", {
        class: "absolute inset-0 z-10 bg-gray-900/60 flex items-center justify-center opacity-0 transition-opacity duration-300 pointer-events-none"
      }, [
        el("div", { class: "h-8 w-8 animate-spin rounded-full border-4 border-t-transparent border-white" })
      ])
    : null;
  if (overlay) mediaWrapper.appendChild(overlay);

  const isReducedMotion = () =>
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  video.addEventListener("canplay", () => {
    video.classList.remove("hidden");
    img.classList.add("hidden");
    spinner.classList.add("hidden");
    if (overlay) {
      overlay.classList.remove("opacity-100");
      overlay.classList.add("opacity-0");
    }
    if (isReducedMotion()) {
      video.pause();
    } else {
      video.play();
    }
  });

  video.addEventListener("error", () => {
    spinner.classList.add("hidden");
    video.classList.add("hidden");
    img.classList.remove("hidden");
    if (overlay) {
      overlay.classList.remove("opacity-100");
      overlay.classList.add("opacity-0");
    }
  });

  // Content container
  const contentDiv = el("div", { class: "p-4" });

  // Title with optional "Preview not available" badge
  const titleChildren = [
    el("h3", {
      class: "text-lg font-medium text-gray-900",
      text: p.project_name || ""
    })
  ];

  if (noPreview) {
    titleChildren.push(
      el("span", {
        class: "inline-flex items-center justify-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-yellow-700"
      }, [
        el("p", { class: "whitespace-nowrap text-sm", text: "Preview not available" })
      ])
    );
  }

  const titleContainer = el("div", { class: "flex flex-wrap gap-2" }, titleChildren);
  contentDiv.appendChild(titleContainer);

  // The expanded title link is created detached; children are moved in on expand
  const titleLink = el("a", { class: "flex flex-wrap gap-2" });
  titleLink.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  // Description paragraphs
  const points = (keyPointsByProjectId && keyPointsByProjectId[p.id]) || [];

  // Add project description if available
  if (p.description) {
    const paragraphs = p.description.split('\n').filter(line => line.trim() !== '');
    for (const paragraph of paragraphs) {
      contentDiv.appendChild(
        el("p", { class: "my-2 text-sm/relaxed text-gray-500", text: paragraph })
      );
    }
  }

  // Add key points as separate paragraphs
  for (const point of points.slice().sort(sortByDisplayOrder)) {
    if (point.key_point) {
      contentDiv.appendChild(
        el("p", { class: "my-2 text-sm/relaxed text-gray-500", text: point.key_point })
      );
    }
  }

  // Technology tags
  const techWrap = el("div", { class: "flex flex-wrap gap-2" });
  const techs = (techByProjectId && techByProjectId[p.id]) || [];
  for (const t of techs.slice().sort(sortByDisplayOrder)) {
    techWrap.appendChild(
      el("span", {
        class: "inline-flex items-center justify-center rounded-full bg-purple-100 px-2.5 py-0.5 text-purple-700"
      }, [
        el("p", { class: "whitespace-nowrap text-sm", text: t.technology_name || "" })
      ])
    );
  }

  contentDiv.appendChild(techWrap);
  article.appendChild(mediaWrapper);
  article.appendChild(contentDiv);

  const scrollAnchor = el("div", {
    class: "h-0 w-full scroll-mt-8",
    "aria-hidden": "true"
  });
  card.appendChild(scrollAnchor);
  card.appendChild(article);

  const cardData = { card, article, mediaWrapper, img, video, spinner, overlay, scrollAnchor, contentDiv, titleContainer, titleLink, titleChildren, safeProjectLink, safeVideoUrl };
  projectCardsById.set(String(p.id), cardData);

  card.addEventListener("click", () => {
    const id = String(p.id);
    if (expandedProjectId === id) collapseCard(id);
    else expandCard(id);
  });

  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault && event.preventDefault();
      const id = String(p.id);
      if (expandedProjectId === id) collapseCard(id);
      else expandCard(id);
    }
  });

  return { card, img, video, spinner, overlay, mediaWrapper, titleLink, contentDiv, scrollAnchor, safeVideoUrl };
};

const renderProjects = (projects, keyPointsByProjectId, techByProjectId) => {
  const container = document.querySelector('.grid');
  if (!container) return;

  projectCardsById.clear();
  expandedProjectId = null;

  // Preload all images, then render cards
  const preloadImages = async (projects) => {
    const imageData = projects.map(p => createProjectCard(p, keyPointsByProjectId, techByProjectId));

    const preloadPromises = imageData.map(({ img }) => {
      return new Promise((resolve) => {
        if (img.complete) {
          resolve();
        } else {
          img.onload = resolve;
          img.onerror = resolve; // Continue even if image fails to load
          // Start loading the image
          img.src = img.src; // This triggers the load
        }
      });
    });

    // Wait for all images to load (or fail)
    await Promise.all(preloadPromises);
    clearEl(container);

    // Now append all cards to the container
    imageData.forEach(({ card }) => {
      container.appendChild(card);
    });
  };

  // Start the preloading process
  preloadImages((projects || []).slice().sort(sortByDisplayOrder));
};

////////////////////////////////////////////////////////
// Data Fetching Functions
////////////////////////////////////////////////////////

const refreshPortfolioProjects = async (apiBaseUrl, resumeId) => {
  const container = document.querySelector('.grid');
  reAddSectionPlaceholder(container);

  try {
    const projects = await fetchBody(apiBaseUrl, `/resume/${resumeId}/portfolio_projects`);

    // Fetch key points for each project
    const projectKeyPointsPairs = await Promise.all(
      (projects || []).map(async (p) => {
        try {
          const items = await fetchBody(apiBaseUrl, `/resume/${resumeId}/portfolio_projects/${p.id}/key_points`);
          return [p.id, items || []];
        } catch {
          return [p.id, []];
        }
      })
    );

    // Fetch technologies for each project
    const projectTechPairs = await Promise.all(
      (projects || []).map(async (p) => {
        try {
          const items = await fetchBody(apiBaseUrl, `/resume/${resumeId}/portfolio_projects/${p.id}/technologies`);
          return [p.id, items || []];
        } catch {
          return [p.id, []];
        }
      })
    );

    const projectKeyPointsById = Object.fromEntries(projectKeyPointsPairs);
    const projectTechById = Object.fromEntries(projectTechPairs);

    renderProjects(projects, projectKeyPointsById, projectTechById);
  } catch (error) {
    console.error('Failed to refresh portfolio projects:', error);
  }
};

////////////////////////////////////////////////////////
// Main Initialization
////////////////////////////////////////////////////////

let websocket = null;

const generateSkeletonPlaceholders = () => {
  const container = document.querySelector('#projectsPlaceholderOverlay');
  if (!container) return;

  clearEl(container);

  for (let i = 0; i < 6; i++) {
    const card = el("div", { class: "rounded-lg glow-on-hover" });
    const article = el("article", { class: "group" });

    // Skeleton image
    const skeletonImage = el("div", {
      class: "bg-neutral-200 w-full aspect-square rounded-xl object-cover shadow-xl animate-pulse"
    });

    // Content container
    const contentDiv = el("div", { class: "p-4" });

    // Skeleton title
    const titleSkeleton = el("h3", { class: "text-lg" }, [
      el("div", { class: "h-[1.5em] flex items-center" }, [
        el("div", { class: "h-[1em] w-[16em] bg-neutral-200 rounded animate-pulse" })
      ])
    ]);

    // Skeleton description paragraphs
    const descSkeleton1 = el("div", { class: "my-2 text-sm/relaxed text-gray-500" }, [
      el("div", { class: "h-[1.5em] flex items-center" }, [
        el("div", { class: "h-[1em] w-full bg-neutral-200 rounded animate-pulse" })
      ]),
      el("div", { class: "h-[1.5em] flex items-center" }, [
        el("div", { class: "h-[1em] w-4/5 bg-neutral-200 rounded animate-pulse" })
      ]),
      el("div", { class: "h-[1.5em] flex items-center" }, [
        el("div", { class: "h-[1em] w-full bg-neutral-200 rounded animate-pulse" })
      ]),
      el("div", { class: "h-[1.5em] flex items-center" }, [
        el("div", { class: "h-[1em] w-3/4 bg-neutral-200 rounded animate-pulse" })
      ])
    ]);

    const descSkeleton2 = el("div", { class: "my-2 text-sm/relaxed text-gray-500" }, [
      el("div", { class: "h-[1.5em] flex items-center" }, [
        el("div", { class: "h-[1em] w-full bg-neutral-200 rounded animate-pulse" })
      ]),
      el("div", { class: "h-[1.5em] flex items-center" }, [
        el("div", { class: "h-[1em] w-3/4 bg-neutral-200 rounded animate-pulse" })
      ])
    ]);

    // Skeleton tech tags
    const techSkeleton = el("div", { class: "flex flex-wrap gap-2" });
    const tagWidths = ["4em", "6em", "4em", "7em", "4em", "5em", "4em"];

    for (const width of tagWidths) {
      techSkeleton.appendChild(
        el("span", { class: "inline-flex items-center justify-center rounded-full bg-neutral-200 animate-pulse px-2.5 py-0.5" }, [
          el("div", { class: "whitespace-nowrap text-sm" }, [
            el("div", { class: `h-[1.5em] w-[${width}] flex items-center` })
          ])
        ])
      );
    }

    // Assemble the skeleton card
    contentDiv.appendChild(titleSkeleton);
    contentDiv.appendChild(descSkeleton1);
    contentDiv.appendChild(descSkeleton2);
    contentDiv.appendChild(techSkeleton);

    article.appendChild(skeletonImage);
    article.appendChild(contentDiv);
    card.appendChild(article);
    container.appendChild(card);
  }
};

const onReady = async () => {
  generateSkeletonPlaceholders();

  const { apiBaseUrl, resumeId } = getConfig();
  if (!Number.isFinite(resumeId)) return;

  try {
    await refreshPortfolioProjects(apiBaseUrl, resumeId);
  } catch (err) {
    console.error(err);
  }

  // Initialize WebSocket for real-time updates
  websocket = createWebSocketWithReconnect(apiBaseUrl, resumeId);
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", onReady);
} else {
  void onReady();
}

document.addEventListener("click", (event) => {
  const grid = document.querySelector(".grid");
  if (grid && !grid.contains(event.target)) {
    collapseCard(expandedProjectId);
  }
});

document.addEventListener("visibilitychange", () => {
  const data = projectCardsById.get(expandedProjectId);
  if (!data || !data.safeVideoUrl) return;

  if (document.hidden) {
    data.video.pause();
  } else {
    data.video.play();
  }
});

window.addEventListener("resize", () => {
  const data = projectCardsById.get(expandedProjectId);
  if (data) updateGridTemplateRows(data.card);
});

module.exports = { renderProjects, createProjectCard };
