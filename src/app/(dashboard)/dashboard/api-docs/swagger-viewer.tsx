"use client";

import { useEffect } from "react";

const SWAGGER_BUNDLE_SRC = "/swagger/swagger-ui-bundle.js";
const SWAGGER_CSS_HREF = "/swagger/swagger-ui.css";

declare global {
  interface Window {
    // The SwaggerUIBundle return value is the system object (the result of
    // Store.getSystem()) — it does NOT expose a destroy() method. That
    // method is only added by the swagger-ui-react wrapper, not by the
    // vanilla bundle. We type the return as unknown and clean up via the
    // DOM container instead.
    SwaggerUIBundle?: ((opts: Record<string, unknown>) => unknown) & {
      presets: { apis: unknown };
    };
  }
}

/**
 * Mounts Swagger UI to the #swagger-ui div. The bundle is loaded from
 * /swagger/swagger-ui-bundle.js (served from public/swagger/, copied there
 * by `pnpm postinstall` from swagger-ui-dist). Spec is loaded lazily from
 * /api-docs/spec.json so the page can render without bloating the HTML.
 *
 * No React-rendered UI inside: Swagger UI owns its DOM tree. We just host
 * the mount point and clean up on unmount.
 */
export function SwaggerViewer() {
  useEffect(() => {
    // Inject the CSS link once. Browsers dedupe, so this is safe across
    // navigations that re-mount the component.
    if (!document.querySelector(`link[href="${SWAGGER_CSS_HREF}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = SWAGGER_CSS_HREF;
      document.head.appendChild(link);
    }

    let cleanup: (() => void) | undefined;
    let cancelled = false;

    // Always resolve once window.SwaggerUIBundle is defined. If a script
    // tag is already in the DOM (StrictMode double-mount, or returning to
    // this page from elsewhere), wait for its load event instead of reading
    // window.SwaggerUIBundle synchronously — the bundle may still be
    // executing.
    function loadBundle(): Promise<void> {
      if (window.SwaggerUIBundle) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(
          `script[src="${SWAGGER_BUNDLE_SRC}"]`,
        );
        const onload = () => resolve();
        const onerror = () =>
          reject(new Error("Failed to load Swagger UI bundle"));
        if (existing) {
          // Tag already in DOM but bundle hasn't finished executing yet.
          // Share its load/error events.
          existing.addEventListener("load", onload, { once: true });
          existing.addEventListener("error", onerror, { once: true });
          return;
        }
        const script = document.createElement("script");
        script.src = SWAGGER_BUNDLE_SRC;
        script.async = true;
        script.addEventListener("load", onload, { once: true });
        script.addEventListener("error", onerror, { once: true });
        document.body.appendChild(script);
      });
    }

    loadBundle()
      .then(() => {
        if (cancelled) return;
        const SwaggerUIBundle = window.SwaggerUIBundle;
        if (!SwaggerUIBundle) {
          console.error(
            "Swagger UI bundle not loaded — check /swagger/swagger-ui-bundle.js",
          );
          return;
        }
        const ui = SwaggerUIBundle({
          url: "/api-docs/spec.json",
          dom_id: "#swagger-ui",
          deepLinking: true,
          // Presets.apis adds request-sniffer behaviors that are standard for
          // an API docs page (Try-it-out works out of the box).
          presets: [SwaggerUIBundle.presets.apis],
        });
        // The SwaggerUIBundle return value is the system object, which has
        // no destroy() method (only the swagger-ui-react wrapper adds one).
        // Clearing the DOM container is enough — the React tree inside is
        // rendered via system.render() and gets garbage-collected when its
        // DOM nodes are removed.
        cleanup = () => {
          const container = document.getElementById("swagger-ui");
          if (container) container.innerHTML = "";
        };
        // Touch ui so tsc doesn't flag it as unused (we keep the handle
        // for future hook-ups like onComplete callbacks).
        void ui;
      })
      .catch((err) => {
        if (!cancelled) console.error(err);
      });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return (
    <div className="swagger-container">
      {/* Swagger UI renders into this div. The container class is also
          a CSS hook for scoping overrides (e.g. fontFamily compatibility
          with the dashboard's Tailwind preflight). */}
      <div id="swagger-ui" />
    </div>
  );
}
