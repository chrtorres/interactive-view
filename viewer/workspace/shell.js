const list = document.querySelector('[role="tablist"]');
const panels = document.querySelector("#panels");
const status = document.querySelector("#status");
let active;

function report(view) {
  view.frame?.contentWindow?.postMessage({
    type: "review-view-activity",
    active: view === active,
  }, location.origin);
}

function mount(views, initial) {
  function show(id, addHistory = false) {
    const next = views.get(id) || views.get(initial);
    active = next;
    for (const view of views.values()) {
      const selected = view === active;
      view.tab.setAttribute("aria-selected", String(selected));
      view.tab.tabIndex = selected ? 0 : -1;
      // Keep the canvas sized and block focus so switching preserves its layout.
      view.panel.hidden = !selected;
      view.panel.inert = !selected;
      report(view);
    }
    if (!next.frame) {
      const frame = document.createElement("iframe");
      frame.title = next.tab.textContent;
      const src = new URL(`./views/${next.id}/index.html`, location.href);
      src.searchParams.set("embedded", "1");
      if (next.exploded) src.searchParams.set("exploded", "1");
      frame.src = src;
      frame.addEventListener("load", () => report(next));
      next.frame = frame;
      next.panel.append(frame);
    }
    if (addHistory && location.hash !== "#" + next.id) {
      history.pushState(null, "", "#" + next.id);
    }
  }

  function route() {
    const previous = active;
    show(location.hash.slice(1));
    if (previous && previous !== active &&
      (previous.panel.contains(document.activeElement) || previous.tab === document.activeElement)) {
      active.tab.focus();
    }
  }

  const ordered = [...views.values()];
  for (const [index, { tab, id }] of ordered.entries()) {
    tab.addEventListener("click", () => show(id, true));
    tab.addEventListener("keydown", event => {
      const indices = {
        ArrowLeft: (index + ordered.length - 1) % ordered.length,
        ArrowRight: (index + 1) % ordered.length,
        Home: 0,
        End: ordered.length - 1,
      };
      if (!Object.hasOwn(indices, event.key)) return;
      event.preventDefault();
      const next = ordered[indices[event.key]];
      show(next.id, true);
      next.tab.focus();
    });
  }
  window.addEventListener("hashchange", route);
  route();
}

try {
  const response = await fetch("./workspace.json");
  if (!response.ok) throw new Error("Workspace manifest is unavailable");
  const config = await response.json();
  if (!Array.isArray(config.views) || config.views.length < 2 ||
      new Set(config.views.map(view => view.id)).size !== config.views.length ||
      !config.views.some(view => view.id === config.default) ||
      config.views.some(view => typeof view.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(view.id) ||
        typeof view.label !== "string" || !view.label.trim())) throw new Error("Invalid workspace manifest");
  document.title = document.querySelector("#title").textContent = config.title;
  const views = new Map();
  for (const { id, label, exploded } of config.views) {
    const tab = document.createElement("button");
    const panel = document.createElement("section");
    tab.type = "button";
    tab.id = "tab-" + id;
    tab.textContent = label;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", "panel-" + id);
    panel.id = "panel-" + id;
    panel.hidden = true;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    list.append(tab);
    panels.append(panel);
    views.set(id, { id, tab, panel, exploded, frame: null });
  }
  status.hidden = true;
  list.hidden = false;
  mount(views, config.default);
} catch (error) {
  status.textContent = "Could not load the review workspace.";
  console.error(error);
}
