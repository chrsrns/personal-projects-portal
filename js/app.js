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
  // Sanitize apiBaseUrl: remove protocol prefix and trailing slashes
  const sanitizedUrl = apiBaseUrl
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');

  // Determine protocol (wss for HTTPS, ws for HTTP)
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${sanitizedUrl}/ws`;

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

const renderProjects = (projects, keyPointsByProjectId, techByProjectId) => {
  const container = document.querySelector('.grid');
  if (!container) return;

  const renderProjectCard = (p) => {
    const href = p.project_link || p.source_code_link || "#";
    const noPreview = !p.project_link || String(p.project_link).trim() === "";

    // Create project card structure
    const card = el("div", { class: "rounded-lg glow-on-hover" });

    const article = el("article", { class: "group" });

    // Image container with link
    const imageLink = el("a", { href });
    const img = el("img", {
      alt: "",
      src: p.image_url || "/img/placeholder.png",
      class: "h-full w-full rounded-xl object-cover shadow-xl transition"
    });
    imageLink.appendChild(img);

    // Content container
    const contentDiv = el("div", { class: "p-4" });

    // Title with optional "Preview not available" badge
    const titleLink = el("a", { href });
    const titleChildren = [el("h3", {
      class: "text-lg font-medium text-gray-900",
      text: p.project_name || ""
    })];

    if (noPreview) {
      titleChildren.push(
        el("span", {
          class: "inline-flex items-center justify-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-yellow-700"
        }, [
          el("p", { class: "whitespace-nowrap text-sm", text: "Preview not available" })
        ])
      );
    }

    // Wrap title and badge in a div if badge exists
    const titleContent = noPreview
      ? el("div", { class: "flex flex-wrap gap-2" }, titleChildren)
      : titleChildren[0];

    titleLink.appendChild(titleContent);
    contentDiv.appendChild(titleLink);

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
    article.appendChild(imageLink);
    article.appendChild(contentDiv);
    card.appendChild(article);

    return { card, img };
  };

  // Preload all images, then render cards
  const preloadImages = async (projects) => {
    const imageData = projects.map(p => renderProjectCard(p));

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
