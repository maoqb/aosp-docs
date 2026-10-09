(function () {
  "use strict";

  function applyImageWidths() {
    document.querySelectorAll('.article-entry img[title^="w="]').forEach(function (image) {
      var match = image.getAttribute("title").match(/^w=(\d+)$/);
      if (!match) return;
      image.style.width = Math.min(Number(match[1]), 2400) + "px";
      image.removeAttribute("title");
    });
  }

  applyImageWidths();
})();
