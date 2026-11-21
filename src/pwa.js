// Register only production builds; localhost development remains uncached.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  const status = document.querySelector("[data-pwa-status]");
  const show = message => {
    status.textContent = message;
    status.hidden = false;
  };
  const start = async () => {
    try {
      const registration = await navigator.serviceWorker.register(
        `${import.meta.env.BASE_URL}sw.js`,
        { scope: import.meta.env.BASE_URL, updateViaCache: "none" },
      );
      const waiting = () => show("Update ready. Close all Drunk Drawing windows, then reopen to update.");
      const watch = worker => {
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) waiting();
          if (worker.state === "activated") show("Ready for offline play.");
          if (worker.state === "redundant" && !navigator.serviceWorker.controller) {
            show("Offline setup failed. Reconnect and reopen to retry.");
          }
        });
      };
      if (registration.waiting) waiting();
      else if (registration.active) show("Ready for offline play.");
      else show("Downloading for offline play…");
      watch(registration.installing);
      registration.addEventListener("updatefound", () => watch(registration.installing));
      const check = () => {
        if (!document.hidden && navigator.onLine) registration.update().catch(() => {});
      };
      document.addEventListener("visibilitychange", check);
      window.addEventListener("online", check);
      setInterval(check, 60 * 60 * 1000);
      check();
    } catch (error) {
      show("Offline setup unavailable. Reconnect and reopen to retry.");
      console.warn("Service worker registration failed", error);
    }
  };
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}
