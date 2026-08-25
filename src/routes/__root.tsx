import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import appCss from "../styles.css?url";

const APP_ASSET_VERSION = "4";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#ff725e" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { title: "Orbit — 個人用プロジェクト管理" },
    ],
    links: [
      { rel: "stylesheet", href: `${appCss}?v=${APP_ASSET_VERSION}` },
      { rel: "manifest", href: "/manifest.webmanifest?v=4" },
      { rel: "icon", href: "/icon.svg?v=2", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/icon-192.png?v=4", type: "image/png" },
    ],
  }),
  component: RootDocument,
});

function RootDocument() {
  return (
    <html lang="ja">
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
