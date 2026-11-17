const SUPABASE_URL = "https://cvlotelnirlwhwcehgqt.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_dPKqtLiX2sEfFmIFAENI9w_TPgbDsEG";
const OFFLINE_DB_NAME = "booknest-offline-library";
const OFFLINE_DB_VERSION = 1;

const firebaseConfig = {
    apiKey: "AIzaSyCtio62AMi99zX_orxSU6dud4W7edspolg",
    authDomain: "booknest-5e450.firebaseapp.com",
    projectId: "booknest-5e450",
    storageBucket: "booknest-5e450.firebasestorage.app",
    messagingSenderId: "711986408257",
    appId: "1:711986408257:web:6984cd1bea232aef480fc0",
    measurementId: "G-QS890373JX"
};

const authStatus = document.getElementById("authStatus");
const downloadsApp = document.getElementById("downloadsApp");
const downloadsEmail = document.getElementById("downloadsEmail");
const downloadForm = document.getElementById("downloadForm");
const downloadButton = document.getElementById("downloadButton");
const downloadMessage = document.getElementById("downloadMessage");
const downloadResults = document.getElementById("downloadResults");
const offlineLibraryMessage = document.getElementById("offlineLibraryMessage");
const offlineBooks = document.getElementById("offlineBooks");
const offlineReaderPanel = document.getElementById("offlineReaderPanel");
const offlineReaderTitle = document.getElementById("offlineReaderTitle");
const offlineReader = document.getElementById("offlineReaderCanvas");
const pdfReaderMessage = document.getElementById("pdfReaderMessage");
const currentPdfPageLabel = document.getElementById("currentPdfPage");
const totalPdfPagesLabel = document.getElementById("totalPdfPages");
const previousPdfPageButton = document.getElementById("previousPdfPage");
const nextPdfPageButton = document.getElementById("nextPdfPage");
const listenToPdfPageButton = document.getElementById("listenToPdfPage");
const pdfZoom = document.getElementById("pdfZoom");
const audioReaderPanel = document.getElementById("audioReaderPanel");
const audioReaderTitle = document.getElementById("audioReaderTitle");
const audioReaderStatus = document.getElementById("audioReaderStatus");
const audioVoiceSelect = document.getElementById("audioVoiceSelect");
const audioRate = document.getElementById("audioRate");
const audioRateValue = document.getElementById("audioRateValue");
const startAudioReadingButton = document.getElementById("startAudioReading");
const pauseAudioReadingButton = document.getElementById("pauseAudioReading");
const resumeAudioReadingButton = document.getElementById("resumeAudioReading");
const stopAudioReadingButton = document.getElementById("stopAudioReading");

if (localStorage.getItem("bookNestTheme") === "dark") {
    document.body.classList.add("dark");
}

let firebaseAuth = null;
let currentUser = null;
let currentPdfLoadingTask = null;
let currentPdfDocument = null;
let currentPdfRenderTask = null;
let currentPdfPageNumber = 1;
let currentPdfWorkerUrl = null;
let currentAudioBook = null;
let currentAudioPageTexts = [];
let speechChunks = [];
let speechChunkIndex = 0;
let pdfjsLibraryPromise = null;
const supportsSpeech = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
try {
    const firebaseApp = window.firebase.apps.length
        ? window.firebase.app()
        : window.firebase.initializeApp(firebaseConfig);
    firebaseAuth = firebaseApp.auth();
} catch (error) {
    console.error("BookNest Firebase Auth initialization failed:", error);
    authStatus.textContent = "Could not connect to BookNest sign-in. Please return and try again.";
    authStatus.classList.add("error");
}

async function loadPdfJs() {
    const pdfjsUrl = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/pdf.mjs";
    const workerUrl = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/pdf.worker.mjs";
    if (!pdfjsLibraryPromise) {
        pdfjsLibraryPromise = import(pdfjsUrl).catch(error => {
            pdfjsLibraryPromise = null;
            throw error;
        });
    }
    const pdfjsLib = await pdfjsLibraryPromise;
    if (!currentPdfWorkerUrl) {
        let workerResponse = await caches.match(workerUrl);
        if (!workerResponse) {
            workerResponse = await fetch(workerUrl);
            if (!workerResponse.ok) throw new Error("The offline PDF reader could not load.");
            const cache = await caches.open("booknest-shell-v10");
            await cache.put(workerUrl, workerResponse.clone());
        }
        const workerCode = await workerResponse.text();
        currentPdfWorkerUrl = URL.createObjectURL(new Blob([workerCode], { type: "text/javascript" }));
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = currentPdfWorkerUrl;
    return pdfjsLib;
}
async function extractPdfText(blob) {
    const pdfjsLib = await loadPdfJs();
    const loadingTask = pdfjsLib.getDocument({
        data: await blob.arrayBuffer(),
        isEvalSupported: false
    });
    const pdf = await loadingTask.promise;
    const pageTexts = [];
    try {
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
            const page = await pdf.getPage(pageNumber);
            const content = await page.getTextContent();
            const pageText = content.items
                .map(item => item.str || "")
                .join(" ")
                .replace(/\s+/g, " ")
                .trim();
            if (pageText) pageTexts.push(pageText);
        }
    } finally {
        await loadingTask.destroy();
    }
    return pageTexts.join("\n\n").trim();
}

async function extractPdfPages(blob) {
    const pdfjsLib = await loadPdfJs();
    const loadingTask = pdfjsLib.getDocument({
        data: await blob.arrayBuffer(),
        isEvalSupported: false,
        useSystemFonts: true
    });
    const pdf = await loadingTask.promise;
    const pageTexts = [];
    try {
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
            const page = await pdf.getPage(pageNumber);
            const content = await page.getTextContent();
            pageTexts.push(content.items
                .map(item => item.str || "")
                .join(" ")
                .replace(/\s+/g, " ")
                .trim());
        }
    } finally {
        await loadingTask.destroy();
    }
    return pageTexts;
}
function openOfflineDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains("books")) {
                const books = db.createObjectStore("books", { keyPath: "id" });
                books.createIndex("userId", "userId", { unique: false });
            }
            if (!db.objectStoreNames.contains("files")) {
                db.createObjectStore("files", { keyPath: "id" });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Offline storage is unavailable."));
    });
}

function idbRequest(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Offline storage request failed."));
    });
}

function saveOfflineBook(record, blob) {
    return openOfflineDatabase().then(db => new Promise((resolve, reject) => {
        const transaction = db.transaction(["books", "files"], "readwrite");
        transaction.objectStore("books").put(record);
        transaction.objectStore("files").put({ id: record.id, blob });
        transaction.oncomplete = () => {
            db.close();
            resolve();
        };
        transaction.onerror = () => {
            const error = transaction.error || new Error("Could not save this book for offline reading.");
            db.close();
            reject(error);
        };
        transaction.onabort = () => {
            const error = transaction.error || new Error("Offline storage is full or unavailable.");
            db.close();
            reject(error);
        };
    }));
}

async function getSavedBooks() {
    const db = await openOfflineDatabase();
    try {
        const transaction = db.transaction("books", "readonly");
        const request = transaction.objectStore("books").index("userId").getAll(currentUser.uid);
        return await idbRequest(request);
    } finally {
        db.close();
    }
}

async function renderCurrentPdfPage() {
    if (!currentPdfDocument) return;
    if (currentPdfRenderTask) {
        try { currentPdfRenderTask.cancel(); } catch { }
        currentPdfRenderTask = null;
    }
    try {
        const page = await currentPdfDocument.getPage(currentPdfPageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(280, offlineReader.parentElement.clientWidth - 36);
        const fitScale = Math.min(1.35, availableWidth / baseViewport.width);
        const viewport = page.getViewport({ scale: fitScale * Number(pdfZoom.value || 1) });
        const pixelRatio = window.devicePixelRatio || 1;
        const context = offlineReader.getContext("2d", { alpha: false });
        offlineReader.width = Math.ceil(viewport.width * pixelRatio);
        offlineReader.height = Math.ceil(viewport.height * pixelRatio);
        offlineReader.style.width = `${Math.ceil(viewport.width)}px`;
        offlineReader.style.height = `${Math.ceil(viewport.height)}px`;
        offlineReader.setAttribute("aria-label", `Page ${currentPdfPageNumber} of ${currentPdfDocument.numPages}`);
        currentPdfRenderTask = page.render({
            canvasContext: context,
            viewport,
            transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0]
        });
        await currentPdfRenderTask.promise;
        pdfReaderMessage.textContent = "";
        currentPdfPageLabel.textContent = String(currentPdfPageNumber);
        totalPdfPagesLabel.textContent = String(currentPdfDocument.numPages);
        previousPdfPageButton.disabled = currentPdfPageNumber <= 1;
        nextPdfPageButton.disabled = currentPdfPageNumber >= currentPdfDocument.numPages;
    } catch (error) {
        if (error?.name !== "RenderingCancelledException") {
            console.error("BookNest could not render this PDF page:", error);
            pdfReaderMessage.textContent = "This PDF page could not be displayed in the offline reader.";
        }
    } finally {
        currentPdfRenderTask = null;
    }
}

async function closeCurrentPdf() {
    if (currentPdfRenderTask) {
        try { currentPdfRenderTask.cancel(); } catch { }
        currentPdfRenderTask = null;
    }
    if (currentPdfLoadingTask) {
        try { await currentPdfLoadingTask.destroy(); } catch { }
        currentPdfLoadingTask = null;
    }
    currentPdfDocument = null;
    offlineReader.width = 0;
    offlineReader.height = 0;
}

async function openSavedBook(book) {
    const db = await openOfflineDatabase();
    let file;
    try {
        const transaction = db.transaction("files", "readonly");
        file = await idbRequest(transaction.objectStore("files").get(book.id));
    } finally {
        db.close();
    }
    if (!file?.blob) {
        offlineLibraryMessage.textContent = "This saved PDF is unavailable in this browser.";
        offlineLibraryMessage.classList.add("error");
        return;
    }
    try {
        currentAudioBook = book;
        if (!Array.isArray(book.pageTexts)) {
            try {
                book.pageTexts = await extractPdfPages(file.blob);
                book.textContent = book.pageTexts.filter(Boolean).join("\n\n");
                const updateDb = await openOfflineDatabase();
                try {
                    const transaction = updateDb.transaction("books", "readwrite");
                    transaction.objectStore("books").put(book);
                    await new Promise((resolve, reject) => {
                        transaction.oncomplete = resolve;
                        transaction.onerror = () => reject(transaction.error);
                        transaction.onabort = () => reject(transaction.error);
                    });
                } finally {
                    updateDb.close();
                }
            } catch (audioError) {
                console.warn("BookNest could not prepare page audio for this saved PDF:", audioError);
            }
        }
        currentAudioPageTexts = Array.isArray(book.pageTexts) ? book.pageTexts : [];
        audioReaderTitle.textContent = `Listen to ${book.title}`;
        audioReaderPanel.hidden = false;
        await closeCurrentPdf();
        offlineReaderTitle.textContent = book.title;
        offlineReaderPanel.hidden = false;
        offlineReaderPanel.scrollIntoView({ behavior: "smooth", block: "start" });
        pdfReaderMessage.textContent = "Opening saved book…";
        const pdfjsLib = await loadPdfJs();
        currentPdfLoadingTask = pdfjsLib.getDocument({
            data: await file.blob.arrayBuffer(),
            isEvalSupported: false,
            useSystemFonts: true
        });
        currentPdfDocument = await currentPdfLoadingTask.promise;
        currentPdfPageNumber = 1;
        totalPdfPagesLabel.textContent = String(currentPdfDocument.numPages);
        await renderCurrentPdfPage();
    } catch (error) {
        console.error("BookNest could not open this offline PDF:", error);
        pdfReaderMessage.textContent = "The in-page reader could not open this PDF. Try saving it again while online.";
    }
}
async function renderOfflineLibrary() {
    if (!currentUser) return;
    try {
        const savedBooks = await getSavedBooks();
        offlineBooks.replaceChildren();
        savedBooks.sort((a, b) => b.savedAt - a.savedAt);
        if (!savedBooks.length) {
            offlineLibraryMessage.textContent = "No books saved for offline reading in this browser yet.";
            offlineLibraryMessage.classList.remove("error");
            return;
        }
        offlineLibraryMessage.textContent = "These PDFs are stored in BookNest on this browser and can be read without internet.";
        offlineLibraryMessage.classList.remove("error");
        savedBooks.forEach(book => {
            const item = document.createElement("article");
            item.className = "download-item";
            const details = document.createElement("div");
            const title = document.createElement("h3");
            title.textContent = book.title;
            const date = document.createElement("p");
            date.className = "offline-book-meta";
            date.textContent = `Saved ${new Date(book.savedAt).toLocaleDateString()}`;
            details.append(title, date);
            const readButton = document.createElement("button");
            readButton.type = "button";
            readButton.className = "btn primary";
            readButton.textContent = "Read offline";
            readButton.addEventListener("click", () => openSavedBook(book));
            const listenButton = document.createElement("button");
            listenButton.type = "button";
            listenButton.className = "btn secondary";
            listenButton.textContent = "Listen offline";
            listenButton.disabled = !book.textContent || !supportsSpeech;
            listenButton.title = !supportsSpeech
                ? "Audio reading is unavailable in this browser."
                : !book.textContent
                    ? "Connect to the internet and save this book again to prepare its audio text."
                    : "Read this saved book aloud.";
            listenButton.addEventListener("click", () => startListeningToBook(book));
            item.append(details, readButton, listenButton);
            offlineBooks.appendChild(item);
        });
    } catch (error) {
        console.error("BookNest offline library could not load:", error);
        offlineLibraryMessage.textContent = "BookNest could not open offline storage in this browser.";
        offlineLibraryMessage.classList.add("error");
    }
}

function setDownloadMessage(message, isError = false) {
    downloadMessage.textContent = message;
    downloadMessage.classList.toggle("error", isError);
}

function makeOfflineBookId(orderId, book, index) {
    const bookKey = book.id || book.book_id || book.storage_path || book.title || `book-${index + 1}`;
    return `${currentUser.uid}::${orderId}::${bookKey}`;
}

async function cacheBookForOffline(book, orderId, index, button) {
    button.disabled = true;
    button.textContent = "Saving in BookNest…";
    try {
        const response = await fetch(book.download_url);
        if (!response.ok) throw new Error("Could not retrieve the PDF. Check your connection and try again.");
        const blob = await response.blob();
        if (!blob.size) throw new Error("The PDF file was empty and could not be saved.");
        button.textContent = "Preparing audio text…";
        let pageTexts = [];
        try {
            pageTexts = await extractPdfPages(blob);
        } catch (audioError) {
            console.warn("BookNest could not prepare audio text for this PDF:", audioError);
        }
        const textContent = pageTexts.filter(Boolean).join("\n\n");
        const savedAt = Date.now();
        const record = {
            id: makeOfflineBookId(orderId, book, index),
            userId: currentUser.uid,
            title: book.title || "BookNest book",
            orderId,
            textContent,
            pageTexts,
            savedAt
        };
        await saveOfflineBook(record, blob);
        button.textContent = "Saved for offline ✓";
setDownloadMessage(textContent
            ? `“${record.title}” is saved in BookNest and ready to read or listen offline.`
            : `“${record.title}” is saved for offline reading, but this PDF has no readable text for audio assistance.`);
        await renderOfflineLibrary();
    } catch (error) {
        console.error("BookNest offline save failed:", error);
        button.textContent = "Save for offline reading";
        setDownloadMessage(error.message || "Could not save this book for offline reading.", true);
    } finally {
        button.disabled = false;
    }
}

function renderOrderBooks(books, orderId) {
    downloadResults.replaceChildren();
    books.forEach((book, index) => {
        const item = document.createElement("article");
        item.className = "download-item";
        const title = document.createElement("h3");
        title.textContent = book.title || "BookNest book";
        const saveButton = document.createElement("button");
        saveButton.type = "button";
        saveButton.className = "btn primary";
        saveButton.textContent = "Save for offline reading";
        saveButton.addEventListener("click", () => cacheBookForOffline(book, orderId, index, saveButton));
        item.append(title, saveButton);
        downloadResults.appendChild(item);
    });
}

function splitSpeechText(text, maxLength = 850) {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    const chunks = [];
    let start = 0;
    while (start < normalized.length) {
        let end = Math.min(start + maxLength, normalized.length);
        if (end < normalized.length) {
            const lastSpace = normalized.lastIndexOf(" ", end);
            if (lastSpace > start + 200) end = lastSpace;
        }
        const chunk = normalized.slice(start, end).trim();
        if (chunk) chunks.push(chunk);
        start = end;
    }
    return chunks;
}

function refreshAudioVoices() {
    if (!supportsSpeech) return;
    const selectedValue = audioVoiceSelect.value;
    const voices = window.speechSynthesis.getVoices();
    audioVoiceSelect.replaceChildren(new Option("Default browser voice", ""));
    voices.forEach((voice, index) => {
        const option = new Option(`${voice.name} (${voice.lang})`, String(index));
        audioVoiceSelect.appendChild(option);
    });
    if ([...audioVoiceSelect.options].some(option => option.value === selectedValue)) {
        audioVoiceSelect.value = selectedValue;
    }
}

function setAudioPlaybackControls(isActive) {
    pauseAudioReadingButton.disabled = !isActive;
    resumeAudioReadingButton.disabled = !isActive;
    stopAudioReadingButton.disabled = !isActive;
}

function speakNextChunk() {
    if (!supportsSpeech || speechChunkIndex >= speechChunks.length) {
        audioReaderStatus.textContent = "Finished reading this page.";
        setAudioPlaybackControls(false);
        return;
    }
    const utterance = new SpeechSynthesisUtterance(speechChunks[speechChunkIndex]);
    utterance.rate = Number(audioRate.value) || 1;
    const voiceIndex = Number(audioVoiceSelect.value);
    const voices = window.speechSynthesis.getVoices();
    if (audioVoiceSelect.value && voices[voiceIndex]) utterance.voice = voices[voiceIndex];
    utterance.onend = () => {
        speechChunkIndex++;
        speakNextChunk();
    };
    utterance.onerror = event => {
        if (event.error === "canceled" || event.error === "interrupted") return;
        audioReaderStatus.textContent = "Audio reading stopped. Try another browser voice or press Listen again.";
        setAudioPlaybackControls(false);
    };
    window.speechSynthesis.speak(utterance);
    audioReaderStatus.textContent = `Reading page ${currentPdfPageNumber}, section ${speechChunkIndex + 1} of ${speechChunks.length}.`;
}

function startAudioPlayback(pageText = null) {
    const selectedPageText = pageText ?? currentAudioPageTexts[currentPdfPageNumber - 1] ?? currentAudioBook?.textContent;
    if (!selectedPageText) {
        audioReaderStatus.textContent = "This PDF has no selectable text to read aloud.";
        return;
    }
    if (!supportsSpeech) {
        audioReaderStatus.textContent = "This browser does not support spoken audio reading.";
        return;
    }
    window.speechSynthesis.cancel();
    speechChunks = splitSpeechText(selectedPageText);
    speechChunkIndex = 0;
    if (!speechChunks.length) {
        audioReaderStatus.textContent = "No readable text was found in this PDF.";
        return;
    }
    setAudioPlaybackControls(true);
    audioReaderStatus.textContent = `Starting page ${currentPdfPageNumber}…`;
    speakNextChunk();
}

function startListeningToBook(book) {
    if (!book.textContent) {
        audioReaderStatus.textContent = "This saved PDF has no extracted text. Connect to the internet and save it again to prepare audio reading.";
        audioReaderPanel.hidden = false;
        audioReaderPanel.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
    }
    currentAudioBook = book;
    currentAudioPageTexts = Array.isArray(book.pageTexts) ? book.pageTexts : [];
    audioReaderTitle.textContent = `Listen to ${book.title}`;
    audioReaderPanel.hidden = false;
    audioReaderPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    if (!supportsSpeech) {
        audioReaderStatus.textContent = "This browser does not support spoken audio reading.";
        return;
    }
    const voices = window.speechSynthesis.getVoices();
    audioReaderStatus.textContent = voices.length
        ? "Choose a voice and press Listen. Offline playback depends on the selected voice being available offline."
        : "Choose Listen to use the browser’s default voice. Offline playback depends on an installed offline voice.";
    startAudioPlayback();
}

if (supportsSpeech) {
    refreshAudioVoices();
    window.speechSynthesis.onvoiceschanged = refreshAudioVoices;
    startAudioReadingButton.addEventListener("click", () => startAudioPlayback());
    listenToPdfPageButton.addEventListener("click", () => startAudioPlayback(currentAudioPageTexts[currentPdfPageNumber - 1] || ""));
    offlineReader.addEventListener("click", () => startAudioPlayback(currentAudioPageTexts[currentPdfPageNumber - 1] || ""));
    pauseAudioReadingButton.addEventListener("click", () => window.speechSynthesis.pause());
    resumeAudioReadingButton.addEventListener("click", () => window.speechSynthesis.resume());
    stopAudioReadingButton.addEventListener("click", () => {
        window.speechSynthesis.cancel();
        speechChunks = [];
        speechChunkIndex = 0;
        audioReaderStatus.textContent = "Audio reading stopped.";
        setAudioPlaybackControls(false);
    });
} else {
    audioReaderStatus.textContent = "Spoken audio reading is not supported in this browser.";
    startAudioReadingButton.disabled = true;
    listenToPdfPageButton.disabled = true;
}

audioRate.addEventListener("input", () => {
    audioRateValue.value = `${Number(audioRate.value).toFixed(1)}×`;
    audioRateValue.textContent = audioRateValue.value;
});
if (firebaseAuth) {
    firebaseAuth.onAuthStateChanged(async user => {
        if (!user) {
            window.location.replace("index.html#account");
            return;
        }
        currentUser = user;
        downloadsEmail.textContent = user.email || "your account";
        authStatus.hidden = true;
        downloadsApp.hidden = false;
        await renderOfflineLibrary();
    }, error => {
        console.error("BookNest sign-in check failed:", error);
        authStatus.textContent = "Could not verify your sign-in. Please return and try again.";
        authStatus.classList.add("error");
    });
}

downloadForm.addEventListener("submit", async event => {
    event.preventDefault();
    const orderId = document.getElementById("downloadOrderId").value.trim();
    const customerToken = document.getElementById("downloadToken").value.trim();

    downloadButton.disabled = true;
    downloadButton.textContent = "Checking your order…";
    setDownloadMessage("");
    downloadResults.replaceChildren();

    try {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/customer-download`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "apikey": SUPABASE_PUBLISHABLE_KEY
            },
            body: JSON.stringify({ order_id: orderId, customer_token: customerToken })
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error(result.error || "Unable to retrieve your books.");
        }

        const books = Array.isArray(result.downloads) ? result.downloads : [];
        if (!books.length) {
            setDownloadMessage("No downloadable books were found for this order.");
            return;
        }

        setDownloadMessage("Your purchased books are ready. Save a book in BookNest to read it offline.");
        renderOrderBooks(books, orderId);
    } catch (error) {
        console.error("BookNest download lookup failed:", error);
        setDownloadMessage(error.message || "Download lookup failed. Please try again.", true);
    } finally {
        downloadButton.disabled = false;
        downloadButton.textContent = "Find my books →";
    }
});

document.getElementById("closeOfflineReader").addEventListener("click", async () => {
    offlineReaderPanel.hidden = true;
    await closeCurrentPdf();
});

previousPdfPageButton.addEventListener("click", async () => {
    if (!currentPdfDocument || currentPdfPageNumber <= 1) return;
    if (supportsSpeech) window.speechSynthesis.cancel();
    setAudioPlaybackControls(false);
    currentPdfPageNumber--;
    audioReaderStatus.textContent = `Page ${currentPdfPageNumber} selected. Click the page or “Listen to this page” to hear it.`;
    await renderCurrentPdfPage();
});

nextPdfPageButton.addEventListener("click", async () => {
    if (!currentPdfDocument || currentPdfPageNumber >= currentPdfDocument.numPages) return;
    if (supportsSpeech) window.speechSynthesis.cancel();
    setAudioPlaybackControls(false);
    currentPdfPageNumber++;
    audioReaderStatus.textContent = `Page ${currentPdfPageNumber} selected. Click the page or “Listen to this page” to hear it.`;
    await renderCurrentPdfPage();
});

pdfZoom.addEventListener("input", renderCurrentPdfPage);
window.addEventListener("resize", () => {
    if (currentPdfDocument) renderCurrentPdfPage();
});

document.getElementById("downloadsSignOut").addEventListener("click", async () => {
    if (!firebaseAuth) return;
    try {
        await firebaseAuth.signOut();
        window.location.replace("index.html#account");
    } catch (error) {
        setDownloadMessage(error.message || "Sign-out failed. Please try again.", true);
    }
});
