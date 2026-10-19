/* Portal de Agentes — cargador del tema/diseño activo.
   Lee el tema activo de Supabase (tabla portal_temas) y lo aplica.
   Usa caché en localStorage para no parpadear en cada carga. */
(function () {
  var U = "https://ildviocjmqcyfknzlyrm.supabase.co",
      K = "sb_publishable_b6X_FUcoooXAvUWI6UXT-g_Zu4ZHi0g";
  var LS_ID = "portal_tema_id", LS_CSS = "portal_tema_css";

  function aplicar(css) {
    var st = document.getElementById("tema-activo");
    if (!st) {
      st = document.createElement("style");
      st.id = "tema-activo";
      document.head.appendChild(st);
    }
    st.textContent = css;
  }

  try {
    var cacheCss = localStorage.getItem(LS_CSS);
    if (cacheCss) aplicar(cacheCss);
  } catch (e) {}

  fetch(U + "/rest/v1/portal_temas?select=id,css&activo=eq.true&limit=1",
    { headers: { apikey: K, Authorization: "Bearer " + K } })
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function (rows) {
      if (!rows.length) return;
      var t = rows[0], cachedId = null;
      try { cachedId = localStorage.getItem(LS_ID); } catch (e) {}
      if (t.id !== cachedId) {
        aplicar(t.css);
        try {
          localStorage.setItem(LS_ID, t.id);
          localStorage.setItem(LS_CSS, t.css);
        } catch (e) {}
      }
    })
    .catch(function () { /* sin conexión: queda el CSS por defecto */ });
})();
