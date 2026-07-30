window.MB = window.MB || {};

MB.esc = function esc(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
};

MB.basename = function basename(p) {
  return String(p).split(/[\\/]/).pop();
};
