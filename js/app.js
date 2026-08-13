const ALLOWED_SCHEMES = Object.freeze(["http:", "https:"]);

const isAllowedUrl = (url) => {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (trimmed === "") return null;

  try {
    const parsed = new URL(trimmed);
    if (!ALLOWED_SCHEMES.includes(parsed.protocol)) return null;
    return parsed.href;
  } catch {
    return null;
  }
};

////////////////////////////////////////////////////////
// WebSocket Connection Helpers
////////////////////////////////////////////////////////

const handleResumeChange = (event) => {
  console.log(`Resume ${event.resume_id} changed:`, event.action);
  const { apiBaseUrl, resumeId } = getConfig();

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
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  let wsHostPath;
  if (/^https?:\/\//.test(apiBaseUrl)) {
    wsHostPath = apiBaseUrl
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');
  } else {
    const base = apiBaseUrl.replace(/\/+$/, '');
    wsHostPath = `${window.location.host}${base}`;
  }

  const wsUrl = `${protocol}//${wsHostPath}/ws`;
  const ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    console.log('WebSocket connected');
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

const projectCellsById = new Map();
let expandedProjectId = null;
let tapHintShown = false;

const isReducedMotion = () =>
  window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const HAND_SVG = `<?xml version="1.0" ?><!-- Uploaded to: SVG Repo, www.svgrepo.com, Generator: SVG Repo Mixer Tools --><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="w-full h-auto"><path d="M20 21V19C20 16.7909 18.2091 15 16 15H15C14.4477 15 14 14.5523 14 14V9C14 7.89543 13.1046 7 12 7V7C10.8954 7 10 7.89543 10 9V18L7.6 14.8C7.22229 14.2964 6.62951 14 6 14H5.56619C4.70121 14 4 14.7012 4 15.5662V15.5662C4 15.8501 4.07715 16.1286 4.22319 16.372L7 21" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/><path d="M12 4V3" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/><path d="M18 10L19 10" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/><path d="M5 10L6 10" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/><path d="M7.34334 5.34309L6.63623 4.63599" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/><path d="M16.6567 5.34309L17.3638 4.63599" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>`;

const showTapHint = (cell) => {
  if (tapHintShown || cell == null) return;
  if (isReducedMotion()) return;

  tapHintShown = true;

  const overlay = el("div", { class: "tap-hint" }, [
    el("div", { class: "tap-hint__hand", html: HAND_SVG }),
  ]);
  cell.appendChild(overlay);

  const removeHint = () => {
    if (overlay.parentNode) overlay.remove();
    cell.removeEventListener("click", removeHint);
  };

  overlay.addEventListener("animationend", removeHint);
  cell.addEventListener("click", removeHint);
};

const syncProjectVideo = (data, shouldPlay = false) => {
  if (!data.video) return;
  const canPlay = data.video.readyState >= 3;
  if (canPlay) {
    data.video.classList.remove("hidden");
    if (data.img) data.img.classList.add("hidden");
    if (data.overlay) {
      data.overlay.classList.remove("opacity-100");
      data.overlay.classList.add("opacity-0");
    }
    if (shouldPlay && !isReducedMotion()) {
      data.video.play();
    }
  } else {
    data.video.classList.add("hidden");
    if (data.img) data.img.classList.remove("hidden");
    if (data.overlay) {
      data.overlay.classList.remove("opacity-0");
      data.overlay.classList.add("opacity-100");
    }
  }
};

const createRow = (cells) => {
  const row = el("div", { class: "row" });
  for (const cell of cells) {
    row.appendChild(cell);
  }
  return row;
};

const collapseCard = (id, scrollToCell = false) => {
  if (id == null) return;
  const data = projectCellsById.get(String(id));
  if (!data) return;

  const finishCollapse = (event) => {
    if (event && event.propertyName && event.propertyName !== "grid-template-rows") return;
    data.cell.classList.remove("collapsing");
    data.cell.removeEventListener("transitionend", finishCollapse);
    if (scrollToCell) {
      const scrollReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      data.cell.scrollIntoView({ behavior: scrollReduced ? "auto" : "smooth", block: "start" });
    }
    if (expandedProjectId === id) expandedProjectId = null;
  };

  if (!data.cell.classList.contains("expanded")) {
    finishCollapse();
    return;
  }

  data.cell.setAttribute("aria-expanded", "false");
  data.cell.classList.add("collapsing");
  data.row.classList.remove("expanded-1", "expanded-2", "expanded-3");

  if (data.titleEl) data.titleEl.classList.remove("mb-6");
  if (data.techWrap) data.techWrap.classList.remove("mt-6");

  if (data.video) {
    data.video.pause();
    data.video.classList.add("hidden");
  }
  if (data.img) data.img.classList.remove("hidden");
  if (data.overlay) {
    data.overlay.classList.remove("opacity-100");
    data.overlay.classList.add("opacity-0");
  }

  data.cell.classList.remove("expanded");

  if (isReducedMotion()) {
    finishCollapse();
    return;
  }

  data.cell.addEventListener("transitionend", finishCollapse);
};

const expandCard = (id) => {
  const targetId = String(id);
  if (expandedProjectId === targetId) return;

  collapseCard(expandedProjectId);

  const data = projectCellsById.get(targetId);
  if (!data) return;

  const index = Array.from(data.row.children).indexOf(data.cell);
  const col = index + 1;

  data.cell.setAttribute("aria-expanded", "true");
  data.cell.classList.add("expanded");
  data.row.classList.add(`expanded-${col}`);

  if (data.titleEl) data.titleEl.classList.add("mb-6");
  if (data.techWrap) data.techWrap.classList.add("mt-6");

  if (data.safeVideoUrl && data.video) {
    if (!data.video.src) data.video.src = data.safeVideoUrl;
    syncProjectVideo(data, true);
  }

  const scrollReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  data.cell.scrollIntoView({ behavior: scrollReduced ? "auto" : "smooth", block: "start" });

  expandedProjectId = targetId;
};

const buildTextContent = (p, keyPointsByProjectId, techByProjectId, options = {}) => {
  const { titleAsLink = false, includeButtons = false, titleClass = "text-lg font-medium text-gray-900" } = options;

  const safeProjectLink = isAllowedUrl(p.project_link);
  const safeSourceLink = isAllowedUrl(p.source_code_link);
  const noPreview = !safeProjectLink;

  const container = el("div", { class: "flex flex-col min-h-0" });

  const titleHeading = el("h3", { class: titleClass, text: p.project_name || "" });
  const titleChildren = [titleHeading];

  if (noPreview) {
    titleChildren.push(
      el("span", {
        class: "inline-flex items-center justify-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-yellow-700",
      }, [
        el("p", { class: "whitespace-nowrap text-sm shrink-0", text: "Preview not available" })
      ])
    );
  }

  const titleEl = safeProjectLink && titleAsLink
    ? el("a", { class: "flex flex-wrap gap-2 shrink-0 mt-3", href: safeProjectLink })
    : el("div", { class: "flex flex-wrap gap-2 shrink-0 mt-3" });
  titleEl.addEventListener("click", (event) => {
    if (titleAsLink) event.stopPropagation();
  });
  for (const child of titleChildren) {
    titleEl.appendChild(child);
  }
  container.appendChild(titleEl);

  if (p.description) {
    const paragraphs = p.description.split('\n').filter(line => line.trim() !== '');
    for (const paragraph of paragraphs) {
      container.appendChild(el("p", { class: "text-sm/relaxed text-gray-500 shrink-0", text: paragraph }));
    }
  }

  const points = (keyPointsByProjectId && keyPointsByProjectId[p.id]) || [];
  for (const point of points.slice().sort(sortByDisplayOrder)) {
    if (point.key_point) {
      container.appendChild(el("p", { class: "text-sm/relaxed text-gray-500 shrink-0", text: point.key_point }));
    }
  }

  const techWrap = el("div", { class: "flex flex-wrap gap-2 shrink-0" });
  const techs = (techByProjectId && techByProjectId[p.id]) || [];
  for (const t of techs.slice().sort(sortByDisplayOrder)) {
    const techP = el("p", { class: "whitespace-nowrap text-sm shrink-0", text: t.technology_name || "" });
    techWrap.appendChild(
      el("span", {
        class: "inline-flex items-center justify-center rounded-full bg-purple-100 px-2.5 py-0.5 text-purple-700",
      }, [techP])
    );
  }
  container.appendChild(techWrap);

  if (includeButtons) {
    const projectBtn = el("button", {
      type: "button",
      text: safeProjectLink ? "Live Demo" : "No project link",
      class: "text-sm lg:text-base rounded-md px-4 py-2 font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed self-start",
      disabled: safeProjectLink ? undefined : "",
    });
    projectBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      if (safeProjectLink) window.open(safeProjectLink, "_blank");
    });

    const sourceBtn = el("button", {
      type: "button",
      text: safeSourceLink ? "View Code" : "No source code link",
      class: "text-sm lg:text-base rounded-md px-4 py-2 font-medium text-white bg-gray-700 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed self-start",
      disabled: safeSourceLink ? undefined : "",
    });
    sourceBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      if (safeSourceLink) window.open(safeSourceLink, "_blank");
    });

    const buttonWrap = el("div", { class: "flex gap-4 mt-auto self-start" }, [projectBtn, sourceBtn]);

    return { container, titleEl, techWrap, projectBtn, sourceBtn, buttonWrap };
  }

  return { container, titleEl, techWrap };
};

const createProjectCard = (p, keyPointsByProjectId, techByProjectId) => {
  const safeProjectLink = isAllowedUrl(p.project_link);
  const safeSourceLink = isAllowedUrl(p.source_code_link);
  const safeImageUrl = isAllowedUrl(p.image_url);
  const safeVideoUrl = isAllowedUrl(p.video_url);

  const cell = el("article", {
    class: "cell rounded-lg glow-on-hover shadow-xl transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 hover:-translate-y-1 hover:scale-[1.01] hover:shadow-2xl motion-reduce:transition-none",
    tabindex: "0",
    role: "button",
    "aria-expanded": "false",
    "data-project-id": String(p.id),
  });

  // Collapsed view
  const collapsed = el("div", { class: "collapsed p-4 flex flex-col" });

  const collapsedImgWrapper = el("div", { class: "w-full aspect-square rounded-xl overflow-hidden shadow-xl" });
  const collapsedImg = el("img", {
    alt: "",
    src: safeImageUrl || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Crect width='400' height='400' fill='%23e5e7eb'/%3E%3C/svg%3E",
    class: "h-full w-full object-contain object-center",
  });
  collapsedImgWrapper.appendChild(collapsedImg);
  collapsed.appendChild(collapsedImgWrapper);

  const collapsedContent = buildTextContent(p, keyPointsByProjectId, techByProjectId, {
    titleAsLink: false,
    includeButtons: false,
    titleClass: "text-lg font-medium text-gray-900",
  });
  collapsed.appendChild(collapsedContent.container);

  const chevron = el("div", { class: "mt-auto flex justify-end" }, [
    el("svg", {
      class: "w-6 h-6 text-gray-400 pointer-events-none",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }, [
      el("polyline", { points: "6 9 12 15 18 9" }),
    ]),
  ]);
  collapsed.appendChild(chevron);

  // Expanded view
  const expanded = el("div", { class: "expanded h-full flex flex-col lg:flex-row" });

  const mediaWrapper = el("div", { class: "relative aspect-square flex items-center justify-center h-1/2 lg:h-full lg:w-1/2" });

  const img = el("img", {
    alt: "",
    src: safeImageUrl || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Crect width='400' height='400' fill='%23e5e7eb'/%3E%3C/svg%3E",
    class: "h-full w-full rounded-xl object-contain object-center shadow-xl",
  });
  mediaWrapper.appendChild(img);

  const video = el("video", {
    class: "hidden h-full w-full object-contain",
    muted: true,
    controls: true,
    loop: true,
    playsinline: true,
  });
  mediaWrapper.appendChild(video);
  video.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  const overlay = safeVideoUrl
    ? el("div", {
        class: "absolute inset-0 z-10 bg-gray-900/60 flex items-center justify-center opacity-0 transition-opacity duration-300 motion-reduce:transition-none motion-reduce:duration-0 pointer-events-none",
      }, [
        el("div", { class: "h-8 w-8 animate-spin rounded-full border-4 border-t-transparent border-white" })
      ])
    : null;
  if (overlay) mediaWrapper.appendChild(overlay);

  video.addEventListener("canplay", () => {
    const data = projectCellsById.get(cell.getAttribute("data-project-id"));
    if (!data || data.cell.getAttribute("aria-expanded") !== "true") return;
    syncProjectVideo(data, true);
  });

  video.addEventListener("error", () => {
    const data = projectCellsById.get(cell.getAttribute("data-project-id"));
    if (!data || data.cell.getAttribute("aria-expanded") !== "true") return;
    data.video.classList.add("hidden");
    if (data.img) data.img.classList.remove("hidden");
    if (data.overlay) {
      data.overlay.classList.remove("opacity-100");
      data.overlay.classList.add("opacity-0");
    }
  });

  const contentDiv = el("div", { class: "p-4 h-1/2 lg:h-full lg:w-1/2 overflow-y-auto flex flex-col min-h-0 lg:p-8" });
  const expandedContent = buildTextContent(p, keyPointsByProjectId, techByProjectId, {
    titleAsLink: true,
    includeButtons: true,
    titleClass: "text-2xl font-medium text-gray-900 shrink-0",
  });
  contentDiv.appendChild(expandedContent.container);
  if (expandedContent.buttonWrap) contentDiv.appendChild(expandedContent.buttonWrap);

  const { titleEl, buttonWrap, projectBtn, sourceBtn, techWrap } = expandedContent;

  expanded.appendChild(mediaWrapper);
  expanded.appendChild(contentDiv);

  cell.appendChild(collapsed);
  cell.appendChild(expanded);

  const cellData = {
    cell,
    row: null,
    collapsed,
    expanded,
    img,
    video,
    overlay,
    mediaWrapper,
    contentDiv,
    titleEl,
    techWrap,
    buttonWrap,
    projectBtn,
    sourceBtn,
    safeProjectLink,
    safeSourceLink,
    safeVideoUrl,
  };
  projectCellsById.set(String(p.id), cellData);

  cell.addEventListener("click", () => {
    const cellId = String(p.id);
    if (expandedProjectId === cellId) collapseCard(cellId, true);
    else expandCard(cellId);
  });

  cell.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault && event.preventDefault();
      const cellId = String(p.id);
      if (expandedProjectId === cellId) collapseCard(cellId, true);
      else expandCard(cellId);
    }
  });

  return { cell, img, video, overlay, mediaWrapper, contentDiv, titleEl, buttonWrap, projectBtn, sourceBtn, safeVideoUrl };
};

const renderProjects = (projects, keyPointsByProjectId, techByProjectId) => {
  const container = document.querySelector('.rows');
  if (!container) return;

  projectCellsById.clear();
  expandedProjectId = null;

  const sortedProjects = (projects || []).slice().sort(sortByDisplayOrder);

  const preloadImages = async () => {
    const imageData = sortedProjects.map(p => createProjectCard(p, keyPointsByProjectId, techByProjectId));

    const preloadPromises = imageData.map(({ img }) => {
      return new Promise((resolve) => {
        if (img.complete) {
          resolve();
        } else {
          img.onload = resolve;
          img.onerror = resolve;
          img.src = img.src;
        }
      });
    });

    await Promise.all(preloadPromises);
    clearEl(container);

    for (let i = 0; i < imageData.length; i += 3) {
      const group = imageData.slice(i, i + 3);
      const row = createRow(group.map(d => d.cell));
      for (const d of group) {
        d.row = row;
        projectCellsById.get(String(d.cell.getAttribute("data-project-id"))).row = row;
      }
      container.appendChild(row);
    }

    if (imageData[0] && !document.querySelector(".cell.expanded")) {
      showTapHint(imageData[0].cell);
    }
  };

  preloadImages();
};

////////////////////////////////////////////////////////
// Data Fetching Functions
////////////////////////////////////////////////////////

const refreshPortfolioProjects = async (apiBaseUrl, resumeId) => {
  const container = document.querySelector('.rows');
  reAddSectionPlaceholder(container);

  try {
    const projects = await fetchBody(apiBaseUrl, `/resume/${resumeId}/portfolio_projects`);

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
    const card = el("article", { class: "rounded-lg glow-on-hover shadow-xl" });
    const collapsed = el("div", { class: "collapsed p-4 flex flex-col" });

    const imgWrapper = el("div", { class: "w-full aspect-square rounded-xl overflow-hidden shadow-xl bg-neutral-200 animate-pulse" });
    collapsed.appendChild(imgWrapper);

    const contentDiv = el("div", { class: "flex flex-col min-h-0" });

    const titleSkeleton = el("h3", { class: "text-lg" }, [
      el("div", { class: "h-[1.5em] flex items-center" }, [
        el("div", { class: "h-[1em] w-[16em] bg-neutral-200 rounded animate-pulse" })
      ])
    ]);
    const titleWrapper = el("div", { class: "flex flex-wrap gap-2 shrink-0 mt-3" }, [titleSkeleton]);

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

    const techSkeleton = el("div", { class: "flex flex-wrap gap-2 shrink-0" });
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

    contentDiv.appendChild(titleWrapper);
    contentDiv.appendChild(descSkeleton1);
    contentDiv.appendChild(descSkeleton2);
    contentDiv.appendChild(techSkeleton);

    collapsed.appendChild(contentDiv);
    card.appendChild(collapsed);
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

  websocket = createWebSocketWithReconnect(apiBaseUrl, resumeId);
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", onReady);
} else {
  void onReady();
}

document.addEventListener("click", (event) => {
  const rows = document.querySelector(".rows");
  if (rows && !rows.contains(event.target)) {
    collapseCard(expandedProjectId, true);
  }
});

document.addEventListener("visibilitychange", () => {
  const data = projectCellsById.get(expandedProjectId);
  if (!data || !data.safeVideoUrl) return;

  if (document.hidden) {
    data.video.pause();
  } else {
    data.video.play();
  }
});

if (typeof module !== "undefined" && module.exports) {
  module.exports = { renderProjects, createProjectCard };
}
