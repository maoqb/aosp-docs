(function () {
  "use strict";

  var root = document.documentElement;
  var themeButton = document.querySelector("[data-theme-toggle]");
  var authorMenu = document.querySelector("[data-author-menu]");
  var storedTheme = localStorage.getItem("aosp-notes-theme");
  var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;

  function applyTheme(theme) {
    root.setAttribute("data-md-color-scheme", theme === "dark" ? "slate" : "default");
    if (themeButton) {
      themeButton.textContent = theme === "dark" ? "◑" : "◐";
      themeButton.setAttribute("aria-pressed", String(theme === "dark"));
    }
  }

  applyTheme(storedTheme || (prefersDark ? "dark" : "light"));

  if (themeButton) {
    themeButton.addEventListener("click", function () {
      var nextTheme = root.getAttribute("data-md-color-scheme") === "slate" ? "light" : "dark";
      localStorage.setItem("aosp-notes-theme", nextTheme);
      applyTheme(nextTheme);
    });
  }

  var progress = document.querySelector("[data-reading-progress]");
  var backTop = document.querySelector("[data-back-top]");
  var header = document.querySelector("[data-blog-header]");

  function updateScrollState() {
    var top = window.scrollY || document.documentElement.scrollTop;
    var height = document.documentElement.scrollHeight - window.innerHeight;
    if (progress) progress.style.width = (height > 0 ? Math.min(100, top / height * 100) : 0) + "%";
    if (backTop) backTop.classList.toggle("is-visible", top > 420);
    if (header) header.classList.toggle("is-scrolled", top > 32);
  }

  window.addEventListener("scroll", updateScrollState, { passive: true });
  updateScrollState();

  if (backTop) {
    backTop.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  document.querySelectorAll("[data-sidebar-tab]").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll("[data-sidebar-tab]").forEach(function (item) {
        item.classList.toggle("is-active", item === tab);
      });
    });
  });

  var archiveDate = document.querySelector("[data-archive-date]");
  var archivePosts = Array.from(document.querySelectorAll("[data-archive-post]"));
  var archiveTotal = document.querySelector("[data-archive-total]");
  var archiveEmpty = document.querySelector("[data-archive-empty]");

  function filterArchive() {
    var selectedDate = archiveDate ? archiveDate.value : "";
    var visible = 0;
    archivePosts.forEach(function (post) {
      var matches = !selectedDate || post.getAttribute("data-date").slice(0, 7) === selectedDate;
      post.hidden = !matches;
      if (matches) visible += 1;
    });
    if (archiveTotal) archiveTotal.textContent = "显示 " + visible + " 篇文章";
    if (archiveEmpty) archiveEmpty.hidden = visible !== 0;
  }

  if (archiveDate) archiveDate.addEventListener("change", filterArchive);
  filterArchive();

  var searchShell = document.querySelector("[data-blog-search]");
  var searchOpen = document.querySelector("[data-blog-search-open]");
  var searchInput = document.querySelector("[data-blog-search-input]");
  var searchMeta = document.querySelector("[data-blog-search-meta]");
  var searchResults = document.querySelector("[data-blog-search-results]");
  var searchGroups = null;

  function plainText(value) {
    var element = document.createElement("div");
    element.innerHTML = value || "";
    return (element.textContent || "").replace(/\s+/g, " ").trim();
  }

  function groupSearchDocuments(documents) {
    var groups = new Map();
    documents.forEach(function (documentItem) {
      var location = String(documentItem.location || "").split("#", 1)[0];
      if (!location) return;
      var group = groups.get(location);
      if (!group) {
        group = {
          location: location,
          title: plainText(documentItem.title) || location,
          content: "",
        };
        groups.set(location, group);
      }
      group.content += " " + plainText(documentItem.title) + " " + plainText(documentItem.text);
    });
    return Array.from(groups.values());
  }

  function makeSnippet(content, query) {
    var normalized = content.replace(/\s+/g, " ").trim();
    var index = normalized.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
    var start = Math.max(0, index - 64);
    var end = Math.min(normalized.length, Math.max(index + query.length + 88, start + 170));
    return (start ? "…" : "") + normalized.slice(start, end) + (end < normalized.length ? "…" : "");
  }

  function renderSearchResults() {
    if (!searchInput || !searchMeta || !searchResults) return;
    var query = searchInput.value.trim();
    searchResults.replaceChildren();
    if (!query) {
      searchMeta.textContent = "输入任意标题或正文字符串";
      return;
    }
    if (!searchGroups) {
      searchMeta.textContent = "正在载入文章索引…";
      return;
    }

    var terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    var matches = searchGroups.filter(function (group) {
      var haystack = (group.title + " " + group.content).toLocaleLowerCase();
      return terms.every(function (term) { return haystack.includes(term); });
    }).slice(0, 20);

    searchMeta.textContent = matches.length
      ? "找到 " + matches.length + " 篇包含“" + query + "”的文章"
      : "没有包含“" + query + "”的文章";

    var indexUrl = new URL(searchShell.getAttribute("data-search-index-url"), window.location.href);
    var siteRoot = new URL("../", indexUrl);
    matches.forEach(function (match) {
      var item = document.createElement("li");
      var link = document.createElement("a");
      var title = document.createElement("h3");
      var snippet = document.createElement("p");
      link.href = new URL(match.location, siteRoot).href;
      title.textContent = match.title;
      snippet.textContent = makeSnippet(match.content, query);
      link.append(title, snippet);
      item.appendChild(link);
      searchResults.appendChild(item);
    });
  }

  function loadSearchIndex() {
    if (searchGroups) return Promise.resolve(searchGroups);
    var indexUrl = searchShell.getAttribute("data-search-index-url");
    return fetch(indexUrl, { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("Search index request failed: " + response.status);
        return response.json();
      })
      .then(function (index) {
        searchGroups = groupSearchDocuments(index.docs || []);
        renderSearchResults();
        return searchGroups;
      })
      .catch(function () {
        searchMeta.textContent = "搜索索引载入失败，请刷新页面重试";
      });
  }

  function openSearch() {
    if (!searchShell || !searchInput) return;
    if (authorMenu) authorMenu.removeAttribute("open");
    searchShell.classList.add("is-open");
    searchShell.setAttribute("aria-hidden", "false");
    document.body.classList.add("search-open");
    loadSearchIndex();
    window.setTimeout(function () { searchInput.focus(); }, 30);
  }

  function closeSearch() {
    if (!searchShell || !searchInput) return;
    searchShell.classList.remove("is-open");
    searchShell.setAttribute("aria-hidden", "true");
    document.body.classList.remove("search-open");
    searchInput.value = "";
    renderSearchResults();
    if (searchOpen) searchOpen.focus();
  }

  if (searchOpen) searchOpen.addEventListener("click", openSearch);
  document.addEventListener("click", function (event) {
    if (authorMenu && authorMenu.hasAttribute("open") && !authorMenu.contains(event.target)) {
      authorMenu.removeAttribute("open");
    }
  });
  document.querySelectorAll("[data-blog-search-close]").forEach(function (button) {
    button.addEventListener("click", closeSearch);
  });
  if (searchInput) {
    searchInput.addEventListener("input", renderSearchResults);
    searchInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        var first = searchResults.querySelector("a");
        if (first) first.click();
      }
    });
  }
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && searchShell && searchShell.classList.contains("is-open")) closeSearch();
    if (event.key === "Escape" && authorMenu && authorMenu.hasAttribute("open")) {
      authorMenu.removeAttribute("open");
      authorMenu.querySelector("summary").focus();
    }
  });

  requestAnimationFrame(function () {
    document.body.classList.add("page-ready");
  });
})();
