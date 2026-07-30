window.MB = window.MB || {};

MB.Nav = {
  pages: [
    { href: "/", label: "פאנל ראשי", match: (p) => p === "/" || p === "/index.html" },
    { href: "/music", label: "מוזיקה", match: (p) => p.startsWith("/music") },
    { href: "/samples", label: "סמפלים", match: (p) => p.startsWith("/samples") },
    { href: "/loops", label: "לופים", match: (p) => p.startsWith("/loops") },
    { href: "/search", label: "חיפוש AI", match: (p) => p.startsWith("/search") },
    { href: "/match", label: "התאמת טראק", match: (p) => p.startsWith("/match") },
    { href: "/cubase", label: "Cubase", match: (p) => p.startsWith("/cubase") },
  ],

  render(activePath) {
    const nav = document.getElementById("panel-nav");
    if (!nav) return;
    const path = activePath || window.location.pathname;
    nav.innerHTML = this.pages
      .map((p) => {
        const active = p.match(path);
        return `<a href="${p.href}"${active ? ' class="active"' : ""}>${p.label}</a>`;
      })
      .join("");
  },
};
