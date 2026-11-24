/* PPJ tema i embed način — učitati u <head> prije prikaza stranice. Bez vanjskih ovisnosti. */
(function () {
  var root = document.documentElement;
  var params;
  try {
    params = new URLSearchParams(window.location.search);
  } catch (e) {
    params = null;
  }

  function applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') {
      root.setAttribute('data-theme', theme);
      root.style.colorScheme = theme;
    } else {
      root.removeAttribute('data-theme');
      root.style.colorScheme = 'light dark';
    }
  }

  function isEmbedMode() {
    if (params && params.has('embed')) {
      var val = params.get('embed');
      return val !== '0' && val !== 'false';
    }
    try {
      return window.self !== window.top;
    } catch (e) {
      return true;
    }
  }

  var initialTheme = params ? params.get('theme') : null;
  applyTheme(initialTheme);

  var embed = isEmbedMode();
  if (embed) {
    root.setAttribute('data-embed', '1');
    root.classList.add('in-embed');
  } else {
    root.removeAttribute('data-embed');
    root.classList.remove('in-embed');
  }

  window.PPJTheme = {
    getTheme: function () {
      var attr = root.getAttribute('data-theme');
      if (attr === 'light' || attr === 'dark') return attr;
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    },
    setTheme: applyTheme,
    isEmbed: function () {
      return embed;
    }
  };
})();
