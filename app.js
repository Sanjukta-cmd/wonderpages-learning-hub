(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var db = null, activeBook = null, pdfDoc = null, currentPage = 1, zoom = 1, mode = "pencil";
  var strokes = [], activeStroke = null, renderTask = null, renderSequence = 0, toastTimer = null;
  var dbName = "little-math-explorers-workbook-v1";

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  function toast(message) {
    var el = $("toast");
    el.textContent = message;
    el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3800);
  }

  function setSaveText(text, busy) {
    $("saveText").textContent = text;
    var dot = $("saveIndicator").querySelector(".save-dot");
    dot.style.background = busy ? "#d5a033" : "#5aa77b";
  }

  var profiles = [];
  var activeProfile = null;
  var profileStorageKey = "wonderpages-learner-profiles-v1";
  var activeProfileStorageKey = "wonderpages-active-learner-v1";
  var studentNameStorageKey = "wonderpages-certificate-student-name-v1";
  function certificateMetadataKey(hash) { return "wonderpages-certificate-meta-" + hash; }

  function titleFromFilename(name) {
    return (name || "Chapter").replace(/\\.pdf$/i, "").replace(/[_-]+/g, " ").trim() || "Chapter";
  }

  function getCertificateMetadata(hash) {
    try { return JSON.parse(localStorage.getItem(certificateMetadataKey(hash)) || "null") || {}; }
    catch (_) { return {}; }
  }

  function currentStudentName() {
    return ($("studentName") && $("studentName").value.trim()) || localStorage.getItem(studentNameStorageKey) || "";
  }

  function currentChapterTitle() {
    return ($("chapterTitle") && $("chapterTitle").value.trim()) || (activeBook ? titleFromFilename(activeBook.name) : "Chapter");
  }

  function saveCertificateDetails() {
    var student = $("studentName").value.trim();
    var chapter = $("chapterTitle").value.trim();
    try {
      if (student) localStorage.setItem(studentNameStorageKey, student);
      else localStorage.removeItem(studentNameStorageKey);
      if (activeBook) {
        activeBook.studentName = student;
        activeBook.chapterTitle = chapter;
        localStorage.setItem(certificateMetadataKey(activeBook.hash), JSON.stringify({
          studentName: student, chapterTitle: chapter
        }));
      }
    } catch (err) { console.warn("Certificate details could not be saved:", err); }
    refreshCompletionUI();
  }

  function loadProfiles() {
    try {
      var saved = JSON.parse(localStorage.getItem(profileStorageKey) || "[]");
      profiles = Array.isArray(saved) ? saved.filter(function (p) { return p && p.id && p.name; }) : [];
    } catch (_) { profiles = []; }
    if (!profiles.some(function (p) { return p.id === "default"; })) {
      profiles.unshift({ id: "default", name: "Learner" });
    }
    var chosenId = localStorage.getItem(activeProfileStorageKey) || "default";
    activeProfile = profiles.find(function (p) { return p.id === chosenId; }) || profiles[0] || { id: "default", name: "Learner" };
    activeProfile.name = "Learner";
    profiles = [activeProfile];
    localStorage.setItem(profileStorageKey, JSON.stringify(profiles));
    localStorage.setItem(activeProfileStorageKey, activeProfile.id);
  }

  // A single learner is used in this version; profile-switching controls are intentionally omitted.

  function lastBookStorageKey() {
    return !activeProfile || activeProfile.id === "default" ? "lme-last-book" : "wonderpages-last-book-" + activeProfile.id;
  }

  function progressStorageKey(hash) {
    return "wonderpages-progress-" + (activeProfile ? activeProfile.id : "default") + "-" + hash;
  }

  function getProfileProgress(hash) {
    try { return JSON.parse(localStorage.getItem(progressStorageKey(hash)) || "null"); }
    catch (_) { return null; }
  }

  function getCompletedPages(hash) {
    var progress = getProfileProgress(hash);
    return progress && Array.isArray(progress.completedPages) ? progress.completedPages : [];
  }

  function refreshCompletionUI() {
    if (!activeBook || !pdfDoc || !$("starCount")) return;
    var completedPages = getCompletedPages(activeBook.hash);
    var totalPages = pdfDoc.numPages;
    var completedCount = completedPages.length;
    var isPageComplete = completedPages.indexOf(currentPage) !== -1;
    var percent = totalPages ? Math.round(completedCount / totalPages * 100) : 0;
    $("starCount").textContent = completedCount + " / " + totalPages + " stars";
    $("starProgressFill").style.width = percent + "%";
    $("starProgressTrack").setAttribute("aria-valuemax", String(totalPages));
    $("starProgressTrack").setAttribute("aria-valuenow", String(completedCount));
    $("completePageButton").disabled = isPageComplete;
    $("completePageButton").textContent = isPageComplete ? "Star earned for this page ⭐" : "I finished this page! ⭐";
    $("completePageButton").classList.toggle("star-earned", isPageComplete);
    var chapterComplete = completedCount === totalPages && totalPages > 0;
    var certificateButton = $("downloadCertificate");
    var studentName = currentStudentName();
    if (certificateButton) {
      certificateButton.hidden = !chapterComplete;
      certificateButton.disabled = !studentName || !currentChapterTitle();
      certificateButton.title = studentName ? "Download the chapter completion certificate" : "Enter the student's name to enable the certificate";
    }
    if (chapterComplete) {
      $("completionTitle").textContent = "Amazing! You did it! 🎉";
      $("completionMessage").textContent = studentName
        ? "Every page is complete. " + studentName + " earned all " + totalPages + " stars!"
        : "Every page is complete! Enter the student's name to unlock their certificate.";
    } else if (isPageComplete) {
      $("completionTitle").textContent = "Well done, star learner! ⭐";
      $("completionMessage").textContent = "You earned a star for this page. Keep going—you are doing great!";
    } else {
      $("completionTitle").textContent = "Every page is a little victory!";
      $("completionMessage").textContent = "Finish page " + currentPage + " and tap below to celebrate your effort.";
    }
  }

  function completeCurrentPage() {
    if (!activeBook || !pdfDoc) return;
    var progress = getProfileProgress(activeBook.hash) || {};
    var completedPages = Array.isArray(progress.completedPages) ? progress.completedPages.slice() : [];
    if (completedPages.indexOf(currentPage) !== -1) {
      toast("You have already earned the star for this page. Great job! ⭐");
      return;
    }
    completedPages.push(currentPage);
    completedPages.sort(function (a, b) { return a - b; });
    progress.completedPages = completedPages;
    progress.lastPage = currentPage;
    progress.zoom = zoom;
    progress.savedAt = Date.now();
    try {
      localStorage.setItem(progressStorageKey(activeBook.hash), JSON.stringify(progress));
      refreshCompletionUI();
      var learnerName = currentStudentName() || "star learner";
      if (completedPages.length === pdfDoc.numPages) {
        $("star-mascot").classList.add("star-celebrate");
        toast("Amazing, " + learnerName + "! You completed every page and earned all " + pdfDoc.numPages + " stars! ⭐🎉");
      } else {
        $("star-mascot").classList.remove("star-celebrate");
        void $("star-mascot").offsetWidth;
        $("star-mascot").classList.add("star-celebrate");
        toast("Well done, " + learnerName + "! You earned a star for page " + currentPage + "! ⭐ Keep shining!");
      }
    } catch (err) {
      console.error(err);
      toast("The star could not be saved. Please check browser storage and try again.");
    }
  }

  async function downloadChapterCertificate() {
    if (!activeBook || !pdfDoc) return;
    var student = currentStudentName();
    var chapter = currentChapterTitle();
    var completed = getCompletedPages(activeBook.hash);
    if (!student) {
      $("studentName").focus();
      toast("Please enter the student's name first.");
      return;
    }
    if (completed.length !== pdfDoc.numPages) {
      toast("Complete every page and earn all the stars before downloading the certificate.");
      return;
    }
    if (!window.PDFLib || !window.PDFLib.PDFDocument) {
      toast("The certificate maker did not load. Refresh the page and try again.");
      return;
    }

    var button = $("downloadCertificate");
    button.disabled = true;
    button.textContent = "Creating certificate...";
    try {
      var PDFDocument = PDFLib.PDFDocument;
      var StandardFonts = PDFLib.StandardFonts;
      var rgb = PDFLib.rgb;
      var certificate = await PDFDocument.create();
      var page = certificate.addPage([842, 595]);
      var regular = await certificate.embedFont(StandardFonts.Helvetica);
      var bold = await certificate.embedFont(StandardFonts.HelveticaBold);
      var italic = await certificate.embedFont(StandardFonts.HelveticaOblique);
      var navy = rgb(0.09, 0.23, 0.36);
      var gold = rgb(0.73, 0.56, 0.16);
      var muted = rgb(0.34, 0.40, 0.46);
      var cream = rgb(1, 0.99, 0.95);
      var white = rgb(1, 1, 1);

      page.drawRectangle({ x: 0, y: 0, width: 842, height: 595, color: cream });
      page.drawRectangle({ x: 22, y: 22, width: 798, height: 551, borderColor: gold, borderWidth: 3 });
      page.drawRectangle({ x: 32, y: 32, width: 778, height: 531, borderColor: navy, borderWidth: 1 });
      function centered(text, y, size, font, color) {
        var width = font.widthOfTextAtSize(text, size);
        page.drawText(text, { x: Math.max(45, (842 - width) / 2), y: y, size: size, font: font, color: color });
      }

      centered("*     *     *", 515, 22, bold, gold);
      centered("WONDERPAGES LEARNING HUB", 476, 13, bold, navy);
      centered("CERTIFICATE OF COMPLETION", 425, 29, bold, navy);
      centered("This certificate is proudly presented to", 389, 15, italic, muted);

      var nameSize = 34;
      while (nameSize > 21 && bold.widthOfTextAtSize(student, nameSize) > 700) nameSize -= 2;
      centered(student, 337, nameSize, bold, gold);
      page.drawLine({ start: { x: 120, y: 321 }, end: { x: 722, y: 321 }, thickness: 1.5, color: gold });

      centered("for completing the chapter", 283, 15, regular, muted);
      var chapterSize = 23;
      while (chapterSize > 15 && bold.widthOfTextAtSize(chapter, chapterSize) > 700) chapterSize -= 1;
      centered(chapter, 247, chapterSize, bold, navy);
      centered("and earning every star by showing effort, curiosity, and perseverance.", 207, 13, regular, muted);

      page.drawCircle({ x: 421, y: 150, size: 24, color: gold });
      page.drawCircle({ x: 421, y: 150, size: 18, color: cream, borderColor: white, borderWidth: 1.5 });
      page.drawText("*", { x: 414, y: 139, size: 22, font: bold, color: gold });
      centered("ALL CHAPTER PAGES COMPLETED", 113, 10, bold, navy);
      var dateText = "Completed on " + new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
      centered(dateText, 91, 12, regular, muted);
      centered("Keep learning. Keep growing. Keep shining!", 64, 14, italic, navy);

      var bytes = await certificate.save();
      downloadBlob(
        new Blob([bytes], { type: "application/pdf" }),
        safeFilename(student + "-" + chapter + "-Certificate") + ".pdf"
      );
      toast("Congratulations, " + student + "! Your chapter certificate is ready to download.");
    } catch (err) {
      console.error("Certificate creation failed:", err);
      toast("The certificate could not be created. Please refresh and try again.");
    } finally {
      button.disabled = false;
      button.textContent = "Download chapter certificate 🏅";
    }
  }

  function markStorageId(hash, page) {
    return activeProfile && activeProfile.id !== "default"
      ? activeProfile.id + ":" + hash + ":" + page
      : hash + ":" + page;
  }

  function isCurrentProfileMark(mark) {
    if (!activeProfile || activeProfile.id === "default") {
      return !mark.profileId || mark.profileId === "default";
    }
    return mark.profileId === activeProfile.id;
  }

  async function refreshSavedBooks() {
    if (!db) return;
    try {
      var books = await getAllItems("books");
      books.sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
      var select = $("savedBooksSelect");
      var row = $("savedBooksRow");
      var lastHash = localStorage.getItem(lastBookStorageKey());
      select.innerHTML = "";
      books.forEach(function (book) {
        if (!book || !book.hash || !book.data) return;
        var option = document.createElement("option");
        option.value = book.hash;
        option.textContent = (book.name || "Saved workbook").replace(/\\.pdf$/i, "");
        select.appendChild(option);
      });
      row.hidden = select.options.length === 0;
      if (select.options.length) {
        select.value = books.some(function (book) { return book.hash === lastHash; }) ? lastHash : select.options[0].value;
      }
    } catch (err) { console.warn("Saved workbook list:", err); }
  }

  // Multiple learner profiles are not enabled in this single-learner version.

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains("books")) d.createObjectStore("books", { keyPath: "hash" });
        if (!d.objectStoreNames.contains("marks")) d.createObjectStore("marks", { keyPath: "id" });
      };
      req.onsuccess = function () { db = req.result; resolve(db); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function getItem(store, key) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(store, "readonly");
      var req = tx.objectStore(store).get(key);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function putItem(store, value) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value);
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error("Save was interrupted")); };
    });
  }

  function getAllItems(store) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(store, "readonly");
      var req = tx.objectStore(store).getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function sha256(buffer) {
    if (!window.crypto || !crypto.subtle) {
      return Promise.resolve("local-" + buffer.byteLength + "-" + Date.now());
    }
    return crypto.subtle.digest("SHA-256", buffer).then(function (digest) {
      return Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    });
  }

  function safeFilename(name) { return (name || "workbook").replace(/\.pdf$/i, "").replace(/[^a-z0-9_-]+/gi, "-"); }

  async function refreshResumeButton() {
    $("resumeButton").hidden = true;
    try {
      var hash = localStorage.getItem(lastBookStorageKey());
      if (!hash || !db) return;
      var book = await getItem("books", hash);
      if (book && book.data) {
        $("resumeButton").hidden = false;
        $("resumeButton").textContent = "Resume " + (book.name || "last workbook");
      }
    } catch (err) { console.warn("Resume check:", err); }
  }

  async function pickBook(file) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      toast("Please choose a PDF workbook.");
      return;
    }
    if (!window.pdfjsLib) {
      toast("The PDF reader did not load. Check your internet connection and refresh this page.");
      return;
    }
    try {
      toast("Opening your workbook…");
      var data = await file.arrayBuffer();
      var hash = await sha256(data);
      var book = {
        hash: hash, name: file.name, size: file.size, lastModified: file.lastModified || 0,
        data: data, lastPage: 1, zoom: 1, savedAt: Date.now()
      };
      var previous = await getItem("books", hash);
      if (previous) {
        book.lastPage = previous.lastPage || 1;
        book.zoom = previous.zoom || 1;
      }
      await putItem("books", book);
      localStorage.setItem(lastBookStorageKey(), hash);
      await refreshSavedBooks();
      await openBook(book);
    } catch (err) {
      console.error(err);
      toast("This PDF could not be opened. Please download the worksheet again and select it once more.");
    }
  }

  async function openBook(book) {
    if (!book || !book.data) throw new Error("No saved book data");
    if (!window.pdfjsLib) throw new Error("PDF reader unavailable");
    $("welcome").hidden = true;
    $("reader").hidden = false;
    $("loadingCard").hidden = false;
    $("paperHolder").hidden = true;
    $("bookName").textContent = (book.name || "Your worksheet").replace(/\.pdf$/i, "").replace(/[_-]+/g, " ");
    $("bookStatus").textContent = "Preparing " + (book.name || "your workbook") + "…";
    activeBook = book;
    var certificateMeta = getCertificateMetadata(book.hash);
    $("studentName").value = certificateMeta.studentName || localStorage.getItem(studentNameStorageKey) || book.studentName || "";
    $("chapterTitle").value = certificateMeta.chapterTitle || book.chapterTitle || titleFromFilename(book.name);
    var profileProgress = getProfileProgress(book.hash);
    currentPage = Math.max(1, Number(profileProgress && profileProgress.lastPage) || (activeProfile && activeProfile.id !== "default" ? 1 : Number(book.lastPage) || 1));
    zoom = Math.max(0.7, Math.min(2.1, Number(profileProgress && profileProgress.zoom) || (activeProfile && activeProfile.id !== "default" ? 1 : Number(book.zoom) || 1)));
    if (pdfDoc) {
      try { await pdfDoc.destroy(); } catch (_) {}
    }
    pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(book.data.slice(0)) }).promise;
    currentPage = Math.min(currentPage, pdfDoc.numPages);
    $("pageCount").textContent = String(pdfDoc.numPages);
    $("pageNumber").max = String(pdfDoc.numPages);
    $("bookName").textContent = (book.name || "Your worksheet").replace(/\.pdf$/i, "").replace(/[_-]+/g, " ");
    $("bookStatus").textContent = pdfDoc.numPages + " pages · " + (book.name || "PDF workbook");
    await renderPage();
    toast("Worksheet opened. Marks will autosave on this device.");
  }

  async function renderPage() {
    if (!pdfDoc || !activeBook) return;
    var sequence = ++renderSequence;
    if (renderTask && renderTask.cancel) { try { renderTask.cancel(); } catch (_) {} }
    $("loadingCard").hidden = false;
    $("paperHolder").hidden = true;
    try {
      var page = await pdfDoc.getPage(currentPage);
      if (sequence !== renderSequence) return;
      var stage = $("pageStage");
      var availableWidth = Math.max(270, stage.clientWidth - 30);
      var baseViewport = page.getViewport({ scale: 1 });
      var fitScale = availableWidth / baseViewport.width;
      var scale = fitScale * zoom;
      var viewport = page.getViewport({ scale: scale });
      var dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
      var pdfCanvas = $("pdfCanvas"), inkCanvas = $("inkCanvas"), holder = $("paperHolder");
      holder.style.width = viewport.width + "px";
      holder.style.height = viewport.height + "px";
      [pdfCanvas, inkCanvas].forEach(function (canvas) {
        canvas.width = Math.ceil(viewport.width * dpr);
        canvas.height = Math.ceil(viewport.height * dpr);
        canvas.style.width = viewport.width + "px";
        canvas.style.height = viewport.height + "px";
      });
      var ctx = pdfCanvas.getContext("2d", { alpha: false });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, pdfCanvas.width, pdfCanvas.height);
      renderTask = page.render({ canvasContext: ctx, viewport: viewport, transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0] });
      await renderTask.promise;
      if (sequence !== renderSequence) return;
      renderTask = null;
      currentPage = Math.min(Math.max(1, currentPage), pdfDoc.numPages);
      $("pageNumber").value = String(currentPage);
      $("zoomLabel").textContent = zoom === 1 ? "Fit page" : Math.round(zoom * 100) + "%";
      $("loadingCard").hidden = true;
      holder.hidden = false;
      await loadMarksForPage();
      await savePosition();
      refreshCompletionUI();
    } catch (err) {
      if (err && err.name === "RenderingCancelledException") return;
      console.error(err);
      $("loadingCard").hidden = false;
      $("loadingCard").innerHTML = "<p>This page could not be rendered. Try Previous/Next or re-open the PDF.</p>";
    }
  }

  async function savePosition() {
    if (!activeBook || !db) return;
    try {
      var existingProgress = getProfileProgress(activeBook.hash) || {};
      localStorage.setItem(progressStorageKey(activeBook.hash), JSON.stringify({
        lastPage: currentPage, zoom: zoom, savedAt: Date.now(),
        completedPages: Array.isArray(existingProgress.completedPages) ? existingProgress.completedPages : []
      }));
    } catch (err) { console.warn("Could not save learner progress:", err); }
  }

  function redrawInk() {
    var canvas = $("inkCanvas");
    var ctx = canvas.getContext("2d");
    var dpr = canvas.width / Math.max(1, canvas.clientWidth);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var w = canvas.clientWidth, h = canvas.clientHeight;
    strokes.forEach(function (stroke) {
      if (!stroke.points || !stroke.points.length) return;
      ctx.save();
      ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
      ctx.strokeStyle = stroke.color || "#147d72";
      ctx.fillStyle = stroke.color || "#147d72";
      ctx.lineWidth = Math.max(1.5, Number(stroke.width || 0.004) * w);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (stroke.points.length === 1) {
        ctx.beginPath();
        ctx.arc(stroke.points[0].x * w, stroke.points[0].y * h, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x * w, stroke.points[0].y * h);
        for (var i = 1; i < stroke.points.length; i++) ctx.lineTo(stroke.points[i].x * w, stroke.points[i].y * h);
        ctx.stroke();
      }
      ctx.restore();
    });
    ctx.restore();
  }

  async function loadMarksForPage() {
    if (!activeBook || !db) return;
    var item = await getItem("marks", markStorageId(activeBook.hash, currentPage));
    strokes = item && Array.isArray(item.strokes) ? item.strokes : [];
    redrawInk();
    setSaveText(strokes.length ? "Your marks are saved" : "Ready · autosaves on this device", false);
  }

  async function persistMarks() {
    if (!activeBook || !db) return;
    setSaveText("Saving…", true);
    try {
      await putItem("marks", { id: markStorageId(activeBook.hash, currentPage), hash: activeBook.hash, page: currentPage, profileId: activeProfile ? activeProfile.id : "default", strokes: strokes, savedAt: Date.now() });
      await savePosition();
      setSaveText("Saved on this device", false);
    } catch (err) {
      console.error(err);
      setSaveText("Save failed · export backup", true);
      toast("Browser storage could not save this mark. Export a backup or check device storage.");
    }
  }

  function pointFromEvent(e) {
    var rect = $("inkCanvas").getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)) };
  }

  $("inkCanvas").addEventListener("pointerdown", function (e) {
    if (!activeBook || !pdfDoc) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    $("inkCanvas").setPointerCapture(e.pointerId);
    activeStroke = {
      tool: mode, color: $("penColor").value,
      width: mode === "eraser" ? 0.025 : Number($("penSize").value),
      points: [pointFromEvent(e)]
    };
    redrawWithActive();
  });
  $("inkCanvas").addEventListener("pointermove", function (e) {
    if (!activeStroke) return;
    e.preventDefault();
    activeStroke.points.push(pointFromEvent(e));
    redrawWithActive();
  });
  function finishStroke() {
    if (!activeStroke) return;
    strokes.push(activeStroke);
    activeStroke = null;
    redrawInk();
    persistMarks();
  }
  $("inkCanvas").addEventListener("pointerup", finishStroke);
  $("inkCanvas").addEventListener("pointercancel", finishStroke);
  function redrawWithActive() {
    var old = strokes;
    if (activeStroke) strokes = old.concat([activeStroke]);
    redrawInk();
    strokes = old;
  }

  function setMode(newMode) {
    mode = newMode;
    $("pencilTool").classList.toggle("active", mode === "pencil");
    $("eraserTool").classList.toggle("active", mode === "eraser");
    $("pencilTool").setAttribute("aria-pressed", String(mode === "pencil"));
    $("eraserTool").setAttribute("aria-pressed", String(mode === "eraser"));
    $("inkCanvas").style.cursor = mode === "eraser" ? "cell" : "crosshair";
  }

  async function moveToPage(next) {
    if (!pdfDoc) return;
    currentPage = Math.max(1, Math.min(pdfDoc.numPages, Number(next) || 1));
    $("pageStage").scrollTop = 0;
    $("pageStage").scrollLeft = 0;
    await renderPage();
  }

  $("pdfFile").addEventListener("change", function (e) { if (e.target.files && e.target.files[0]) pickBook(e.target.files[0]); e.target.value = ""; });
  $("completePageButton").addEventListener("click", completeCurrentPage);
  $("downloadCertificate").addEventListener("click", downloadChapterCertificate);
  $("studentName").addEventListener("input", saveCertificateDetails);
  $("chapterTitle").addEventListener("input", saveCertificateDetails);
  // Profile-management event handlers are removed in single-learner mode.
  $("openSavedBook").addEventListener("click", async function () {
    try {
      var hash = $("savedBooksSelect").value;
      var book = hash ? await getItem("books", hash) : null;
      if (!book) { toast("Choose a saved workbook first."); return; }
      localStorage.setItem(lastBookStorageKey(), hash);
      await openBook(book);
    } catch (err) { console.error(err); toast("Could not open that saved workbook."); }
  });
  $("resumeButton").addEventListener("click", async function () {
    try {
      var hash = localStorage.getItem(lastBookStorageKey());
      var book = hash ? await getItem("books", hash) : null;
      if (book) await openBook(book); else toast("No saved workbook yet. Choose a saved workbook below.");
    } catch (err) { console.error(err); toast("Could not resume this workbook."); }
  });
  $("changeBook").addEventListener("click", function () { $("pdfFile").click(); });
  $("prevPage").addEventListener("click", function () { moveToPage(currentPage - 1); });
  $("nextPage").addEventListener("click", function () { moveToPage(currentPage + 1); });
  $("pageNumber").addEventListener("change", function () { moveToPage($("pageNumber").value); });
  $("pageNumber").addEventListener("keydown", function (e) { if (e.key === "Enter") moveToPage($("pageNumber").value); });
  document.querySelectorAll(".chapter-chip").forEach(function (btn) { btn.addEventListener("click", function () { moveToPage(Number(btn.dataset.page)); }); });
  $("zoomIn").addEventListener("click", function () { zoom = Math.min(2.1, Math.round((zoom + 0.15) * 100) / 100); renderPage(); });
  $("zoomOut").addEventListener("click", function () { zoom = Math.max(0.7, Math.round((zoom - 0.15) * 100) / 100); renderPage(); });
  $("zoomLabel").addEventListener("click", function () { zoom = 1; renderPage(); });
  $("pencilTool").addEventListener("click", function () { setMode("pencil"); });
  $("eraserTool").addEventListener("click", function () { setMode("eraser"); });
  $("undoStroke").addEventListener("click", function () {
    if (!strokes.length) { toast("There are no marks to undo on this page."); return; }
    strokes.pop(); redrawInk(); persistMarks();
  });
  $("clearPage").addEventListener("click", async function () {
    if (!strokes.length) { toast("This page has no marks to clear."); return; }
    if (!window.confirm("Remove all your drawn marks from this page?")) return;
    strokes = []; redrawInk(); await persistMarks(); toast("Marks cleared from this page.");
  });

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1800);
  }

  $("exportBackup").addEventListener("click", async function () {
    if (!activeBook) return;
    try {
      var all = await getAllItems("marks");
      var relevant = all.filter(function (m) { return m.hash === activeBook.hash && isCurrentProfileMark(m); }).map(function (m) { return { page: m.page, strokes: m.strokes || [] }; });
      var payload = { product: "WonderPages Interactive Worksheet", version: 1, documentHash: activeBook.hash, documentName: activeBook.name, pageCount: pdfDoc.numPages, exportedAt: new Date().toISOString(), annotations: relevant };
      downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), safeFilename(activeBook.name) + "-answers-backup.json");
      toast("Answers backup downloaded.");
    } catch (err) { console.error(err); toast("Could not export the backup."); }
  });

  $("backupFile").addEventListener("change", async function (e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file || !activeBook) { toast("Open the matching workbook first, then import its backup."); return; }
    try {
      var payload = JSON.parse(await file.text());
      if (payload.documentHash !== activeBook.hash) {
        toast("This backup belongs to a different PDF file. Open the original workbook that was used to create it.");
        return;
      }
      for (var i = 0; i < (payload.annotations || []).length; i++) {
        var annotation = payload.annotations[i];
        await putItem("marks", { id: markStorageId(activeBook.hash, annotation.page), hash: activeBook.hash, page: annotation.page, profileId: activeProfile ? activeProfile.id : "default", strokes: annotation.strokes || [], savedAt: Date.now() });
      }
      await loadMarksForPage();
      toast("Backup restored.");
    } catch (err) { console.error(err); toast("This backup file could not be read."); }
  });

  function drawStrokesToCanvas(ctx, list, w, h) {
    list.forEach(function (stroke) {
      if (!stroke.points || !stroke.points.length) return;
      ctx.save();
      ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
      ctx.strokeStyle = stroke.color || "#147d72";
      ctx.fillStyle = stroke.color || "#147d72";
      ctx.lineWidth = Math.max(2, Number(stroke.width || 0.004) * w);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (stroke.points.length === 1) {
        ctx.beginPath(); ctx.arc(stroke.points[0].x * w, stroke.points[0].y * h, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.beginPath(); ctx.moveTo(stroke.points[0].x * w, stroke.points[0].y * h);
        for (var j = 1; j < stroke.points.length; j++) ctx.lineTo(stroke.points[j].x * w, stroke.points[j].y * h);
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  $("downloadMarked").addEventListener("click", async function () {
    if (!activeBook || !pdfDoc) return;
    if (!window.PDFLib || !window.PDFLib.PDFDocument) { toast("PDF export library did not load. Please refresh and try again."); return; }
    var btn = $("downloadMarked");
    btn.disabled = true; btn.textContent = "Preparing marked PDF…";
    try {
      var allMarks = (await getAllItems("marks")).filter(function (m) { return m.hash === activeBook.hash && isCurrentProfileMark(m) && m.strokes && m.strokes.length; });
      var outDoc = await PDFLib.PDFDocument.load(new Uint8Array(activeBook.data.slice(0)));
      for (var i = 0; i < allMarks.length; i++) {
        var mark = allMarks[i];
        var pageIndex = mark.page - 1;
        if (pageIndex < 0 || pageIndex >= outDoc.getPageCount()) continue;
        var page = outDoc.getPage(pageIndex);
        var pw = page.getWidth(), ph = page.getHeight();
        var cw = 1200, ch = Math.round(cw * ph / pw);
        var overlay = document.createElement("canvas");
        overlay.width = cw; overlay.height = ch;
        var octx = overlay.getContext("2d");
        drawStrokesToCanvas(octx, mark.strokes, cw, ch);
        var png = await outDoc.embedPng(overlay.toDataURL("image/png"));
        page.drawImage(png, { x: 0, y: 0, width: pw, height: ph });
      }
      var bytes = await outDoc.save();
      downloadBlob(new Blob([bytes], { type: "application/pdf" }), safeFilename(activeBook.name) + "-marked.pdf");
      toast("Marked workbook exported as a new PDF. Your original remains unchanged.");
    } catch (err) {
      console.error(err);
      toast("Could not export the marked PDF. Try exporting an answers backup instead.");
    } finally {
      btn.disabled = false; btn.textContent = "Download marked PDF";
    }
  });

  document.addEventListener("keydown", function (e) {
    if (!pdfDoc) return;
    var tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.key === "ArrowLeft") moveToPage(currentPage - 1);
    if (e.key === "ArrowRight") moveToPage(currentPage + 1);
    if (e.key === "+" || e.key === "=") { zoom = Math.min(2.1, Math.round((zoom + 0.15) * 100) / 100); renderPage(); }
    if (e.key === "-") { zoom = Math.max(0.7, Math.round((zoom - 0.15) * 100) / 100); renderPage(); }
  });

  window.addEventListener("resize", function () {
    if (window.__lmeResizeTimer) clearTimeout(window.__lmeResizeTimer);
    window.__lmeResizeTimer = setTimeout(function () { if (pdfDoc) renderPage(); }, 180);
  });

  try {
    loadProfiles();
  } catch (err) {
    console.warn("Local learner setup:", err);
    activeProfile = { id: "default", name: "Learner" };
    profiles = [activeProfile];
  }

  openDb().then(function () {
    return refreshResumeButton().then(refreshSavedBooks);
  }).catch(function (err) {
    console.error(err);
    toast("This browser blocked local storage. Try a normal (not private) browser window.");
  });
})();