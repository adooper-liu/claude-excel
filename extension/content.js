(function () {
  const href = location.href;
  if (/^https?:\/\/(127\.0\.0\.1|localhost):(3000|8765|8766)\b/i.test(href)) return;
  if (typeof ceInstallPagePicker !== "function") return;
  try {
    ceInstallPagePicker({ via: "extension", collapsed: true });
  } catch (e) {
    /* ignore */
  }
})();
