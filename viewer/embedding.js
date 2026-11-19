const query = new URLSearchParams(location.search);
export const embedded = parent !== window && query.has("embedded");
export const initiallyExploded = embedded && query.get("exploded") === "1";
let active = !embedded;

if (embedded) {
  document.documentElement.classList.add("embedded");
  // Only the same-origin parent may suspend or resume this view.
  window.addEventListener("message", ({ source, origin, data }) => {
    if (source === parent && origin === location.origin &&
        data?.type === "review-view-activity" && typeof data.active === "boolean") {
      active = data.active;
    }
  });
}
export const viewActive = () => active;
