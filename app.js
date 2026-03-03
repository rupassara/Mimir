import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, getDocs, doc, writeBatch, setDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyB_-91cPMJeAI5z_ntghG-nl5v1IWJ2qT8",
    authDomain: "mimir-9f5a1.firebaseapp.com",
    projectId: "mimir-9f5a1",
    storageBucket: "mimir-9f5a1.firebasestorage.app",
    messagingSenderId: "83651337310",
    appId: "1:83651337310:web:818dea8c297a763725a8cf",
    measurementId: "G-3GL3WMLSFC",
    databaseURL: "https://mimir-9f5a1-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ==========================================
// State Management
// ==========================================
let books = [];
let filteredBooks = [];
let currentPage = 1;
let currentTags = [];
let isEditing = false;
let PAGE_SIZE = 24;

// Load data from LocalStorage or data.json
// Load data from Firebase Firestore
async function initData() {
    try {
        const querySnapshot = await getDocs(collection(db, "books"));
        if (!querySnapshot.empty) {
            books = [];
            querySnapshot.forEach((doc) => {
                books.push(doc.data());
            });
        } else {
            // Fetch initial data if database is empty
            try {
                const response = await fetch('data.json');
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                books = await response.json();
                await saveData();
            } catch (error) {
                console.error("Could not load initial mock data:", error);
                books = [];
            }
        }
    } catch (error) {
        console.error("Firebase connection error:", error);
        books = [];
        showToast("Failed to connect to Firebase.");
    }

    // Filter out potential nulls
    books = books.filter(b => b !== null && b !== undefined);

    // Reverse to show newest first by default
    filteredBooks = [...books].reverse();
}

async function saveData() {
    const cleanBooks = books.filter(b => b !== null && b !== undefined);
    try {
        const batch = writeBatch(db);
        cleanBooks.forEach(book => {
            // Use the book ID as the document ID for absolute consistency
            const docRef = doc(db, "books", String(book.id));
            batch.set(docRef, book);
        });
        await batch.commit();
    } catch (e) {
        console.error("Failed to save to Firebase Firestore:", e);
        showToast("Error saving to cloud database.");
    }
}

// ==========================================
// DOM Elements
// ==========================================
// Tabs & Views
const tabBtns = document.querySelectorAll('.tab-btn');
const viewSections = document.querySelectorAll('.view-section');

// Search & Filter
const globalSearch = document.getElementById('global-search');
const filterCategory = document.getElementById('filter-category');
const filterLanguage = document.getElementById('filter-language');
const bookStats = document.getElementById('book-stats');
const booksGrid = document.getElementById('books-grid');
const exportCsvBtn = document.getElementById('export-csv');

// Pagination
const prevPageBtn = document.getElementById('prev-page');
const nextPageBtn = document.getElementById('next-page');
const pageInfo = document.getElementById('page-info');

// Form & Edit State
const addBookForm = document.getElementById('add-book-form');
const editBookId = document.getElementById('edit-book-id');
const formTitle = document.getElementById('form-title');
const formSubtitle = document.getElementById('form-subtitle');
const formSubmitBtn = document.getElementById('form-submit-btn');
const formCancelBtn = document.getElementById('form-cancel-btn');
const toastInfo = document.getElementById('toast');

// Tags Input
const tagsContainer = document.getElementById('tags-input-container');
const tagsWrapper = document.getElementById('tags-wrapper');
const tagsInput = document.getElementById('book-tags-input');

// Theme & View Settings
const htmlEl = document.documentElement;

const btnListView = document.getElementById('btn-list-view');
const btnGridView = document.getElementById('btn-grid-view');

// Import / Export
const importCsvBtn = document.getElementById('import-csv-btn');
const importCsvFile = document.getElementById('import-csv-file');

// Sort
const sortBySelect = document.getElementById('sort-by');

// ==========================================
// Initialization & Events
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    await initData();
    populateFilterDropdowns();
    renderBooks();

    // Tab Switching
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;

            tabBtns.forEach(t => t.classList.remove('active'));
            btn.classList.add('active');

            viewSections.forEach(s => {
                s.style.display = s.id === targetId ? 'block' : 'none';
                if (s.id === 'view-books') {
                    renderBooks();
                } else if (s.id === 'view-stats') {
                    renderStats();
                }
            });
        });
    });

    // View Toggles
    btnListView.addEventListener('click', () => {
        booksGrid.classList.remove('books-grid');
        booksGrid.classList.add('books-list');
        btnGridView.classList.remove('active');
        btnListView.classList.add('active');
        localStorage.setItem('aurora_view', 'list');
    });

    btnGridView.addEventListener('click', () => {
        booksGrid.classList.remove('books-list');
        booksGrid.classList.add('books-grid');
        btnListView.classList.remove('active');
        btnGridView.classList.add('active');
        localStorage.setItem('aurora_view', 'grid');
    });

    // Filtering & Searching
    globalSearch.addEventListener('input', applyFilters);
    filterCategory.addEventListener('change', applyFilters);
    filterLanguage.addEventListener('change', applyFilters);
    sortBySelect.addEventListener('change', applyFilters);

    // Pagination
    prevPageBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderPage();
        }
    });

    nextPageBtn.addEventListener('click', () => {
        const maxPage = Math.ceil(filteredBooks.length / PAGE_SIZE);
        if (currentPage < maxPage) {
            currentPage++;
            renderPage();
        }
    });

    // Grid Delegate clicks for Edit
    booksGrid.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.edit-book-btn');
        if (editBtn) {
            const id = parseInt(editBtn.dataset.id, 10);
            startEditMode(id);
        }
    });

    // Form Interactions
    formCancelBtn.addEventListener('click', () => {
        resetForm();
    });

    addBookForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const bookData = {
            name: document.getElementById('book-name').value.trim(),
            sinhalaName: document.getElementById('book-sinhala-name').value.trim(),
            author: document.getElementById('book-author').value.trim(),
            translator: document.getElementById('book-translator').value.trim(),
            language: document.getElementById('book-language').value,
            category: document.getElementById('book-category').value,
            tags: [...currentTags]
        };

        if (isEditing) {
            const id = parseInt(editBookId.value, 10);
            const index = books.findIndex(b => b.id === id);
            if (index !== -1) {
                books[index] = { ...books[index], ...bookData };
            }
            showToast(`"${bookData.name}" updated successfully!`);
        } else {
            bookData.id = generateId();
            books.push(bookData);
            showToast(`"${bookData.name}" added successfully!`);
        }

        saveData();
        resetForm();

        // Update data dependencies
        populateFilterDropdowns();

        // Go back to view tab automatically
        tabBtns[0].click();
    });

    // Tags Input Logic
    tagsContainer.addEventListener('click', () => tagsInput.focus());

    tagsInput.addEventListener('focus', () => tagsContainer.classList.add('focused'));
    tagsInput.addEventListener('blur', () => {
        tagsContainer.classList.remove('focused');
        addTag(tagsInput.value);
    });

    tagsInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            addTag(tagsInput.value);
        } else if (e.key === 'Backspace' && tagsInput.value === '' && currentTags.length > 0) {
            removeTag(currentTags.length - 1);
        }
    });

    // CSV Import / Export
    exportCsvBtn.addEventListener('click', exportToCsv);
    importCsvBtn.addEventListener('click', () => importCsvFile.click());
    importCsvFile.addEventListener('change', handleCsvImport);

    // Setup Autocomplete
    setupAutocomplete('book-name', 'name', 'autocomplete-bookname');
    setupAutocomplete('book-author', 'author', 'autocomplete-author');
    setupAutocomplete('book-translator', 'translator', 'autocomplete-translator');

    // Close autocompletes when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.autocomplete')) {
            document.querySelectorAll('.autocomplete-list').forEach(list => list.style.display = 'none');
        }
    });

    // Initialize Theme and View settings now that listeners are attached
    initTheme();
});

// ==========================================
// Core Functions
// ==========================================

function initTheme() {
    const savedTheme = localStorage.getItem('aurora_theme') || 'light';
    setTheme(savedTheme);
    themeSelector.value = savedTheme;

    const savedView = localStorage.getItem('aurora_view') || 'list';
    if (savedView === 'grid') {
        btnGridView.click();
    } else {
        btnListView.click();
    }
}

function setTheme(theme) {
    htmlEl.setAttribute('data-theme', theme);
    localStorage.setItem('aurora_theme', theme);
}

function generateId() {
    if (books.length === 0) return 1;
    const maxId = Math.max(...books.map(b => b.id));
    return maxId + 1;
}

function populateFilterDropdowns() {
    const categories = [...new Set(books.map(b => b.category))].sort();
    const languages = [...new Set(books.map(b => b.language))].sort();

    // Preserve current selection if possible
    const currentCat = filterCategory.value;
    const currentLang = filterLanguage.value;

    filterCategory.innerHTML = '<option value="">All Categories</option>' +
        categories.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');

    filterLanguage.innerHTML = '<option value="">All Languages</option>' +
        languages.map(l => `<option value="${escapeHTML(l)}">${escapeHTML(l)}</option>`).join('');

    if (categories.includes(currentCat)) filterCategory.value = currentCat;
    if (languages.includes(currentLang)) filterLanguage.value = currentLang;
}

function applyFilters() {
    const query = globalSearch.value.toLowerCase().trim();
    const cat = filterCategory.value;
    const lang = filterLanguage.value;
    const sortVal = sortBySelect.value;

    let baseBooks = [...books];

    // Sorting Logic
    if (sortVal === 'newest') {
        baseBooks.sort((a, b) => b.id - a.id);
    } else if (sortVal === 'oldest') {
        baseBooks.sort((a, b) => a.id - b.id);
    } else if (sortVal === 'titleAsc') {
        baseBooks.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortVal === 'titleDesc') {
        baseBooks.sort((a, b) => b.name.localeCompare(a.name));
    } else if (sortVal === 'authorAsc') {
        baseBooks.sort((a, b) => a.author.localeCompare(b.author));
    }

    filteredBooks = baseBooks.filter(b => {
        // Dropdown filters
        if (cat && b.category !== cat) return false;
        if (lang && b.language !== lang) return false;

        // Text Search (supports Sinhala Unicode)
        if (query) {
            const tagsStr = (b.tags || []).join(' ');
            const searchable = `${b.name} ${b.sinhalaName || ''} ${b.author} ${b.translator} ${b.category} ${b.language} ${tagsStr}`.toLowerCase();
            return searchable.includes(query);
        }

        return true;
    });

    currentPage = 1;
    renderPage();
}

function renderPage() {
    const totalItems = filteredBooks.length;

    if (totalItems === 0) {
        booksGrid.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
                <h3>No books found</h3>
                <p>Try adjusting your search or filters.</p>
            </div>
        `;
        bookStats.textContent = 'Showing 0 books';
        updatePaginationInfo(0);
        return;
    }

    const startIndex = (currentPage - 1) * PAGE_SIZE;
    const endIndex = Math.min(startIndex + PAGE_SIZE, totalItems);
    const pageItems = filteredBooks.slice(startIndex, endIndex);

    booksGrid.innerHTML = pageItems.map(book => {
        const tagsHtml = (book.tags || []).length > 0 ?
            `<div class="book-tags">${book.tags.map(t => `<span class="book-tag-chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>${escapeHTML(t)}</span>`).join('')}</div>`
            : '';
        const sinhalaTitleHtml = book.sinhalaName ? `<div class="book-sinhala-title">${escapeHTML(book.sinhalaName)}</div>` : '';

        return `
        <div class="book-card" data-category="${escapeHTML(book.category)}">
            <div class="book-id">${String(book.id).padStart(4, '0')}</div>
            <div class="book-main">
                <h3 class="book-title">${escapeHTML(book.name)}</h3>
                ${sinhalaTitleHtml}
            </div>
            <div class="book-author" onclick="searchByCreator('${book.author.replace(/'/g, "\\'")}')">${escapeHTML(book.author)}</div>
            ${book.translator ? `<div class="book-translator-row"><span class="meta-item"><span class="translator-label">Translated by</span> <span class="clickable-name" onclick="searchByCreator('${book.translator.replace(/'/g, "\\'")}')">${escapeHTML(book.translator)}</span></span></div>` : '<div class="book-translator-row book-translator-empty"></div>'}
            <div class="book-meta">
                <div class="meta-item" style="gap: 0.75rem;">
                    <span class="tag">${escapeHTML(book.category)}</span>
                    <span class="tag" style="background: transparent; border: 1px solid var(--border-color);">${escapeHTML(book.language)}</span>
                </div>
            </div>
            ${tagsHtml}
            <button class="edit-book-btn" data-id="${book.id}" aria-label="Edit book">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
        </div>
    `}).join('');

    bookStats.textContent = `Showing ${startIndex + 1}-${endIndex} of ${totalItems} books`;
    updatePaginationInfo(totalItems);
}

function renderBooks() {
    applyFilters();
}

function updatePaginationInfo(totalItems) {
    const maxPage = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    pageInfo.textContent = `Page ${currentPage} of ${maxPage}`;

    prevPageBtn.disabled = currentPage <= 1;
    nextPageBtn.disabled = currentPage >= maxPage;

    // Render per-page selector if it doesn't already exist
    if (!document.getElementById('per-page-select')) {
        const perPageSelect = document.createElement('select');
        perPageSelect.id = 'per-page-select';
        perPageSelect.className = 'per-page-select';
        perPageSelect.innerHTML = `
            <option value="15">15 / page</option>
            <option value="50">50 / page</option>
            <option value="100">100 / page</option>
            <option value="99999">View All</option>
        `;
        perPageSelect.value = PAGE_SIZE;
        perPageSelect.onchange = (e) => {
            PAGE_SIZE = parseInt(e.target.value, 10);
            currentPage = 1;
            renderPage();
        };
        // Insert before prev button
        prevPageBtn.parentElement.insertBefore(perPageSelect, prevPageBtn);
    } else {
        document.getElementById('per-page-select').value = PAGE_SIZE;
    }
}

// ==========================================
// Autocomplete Implementation
// ==========================================
function setupAutocomplete(inputId, dataField, listId) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);

    input.addEventListener('input', () => {
        const val = input.value.trim().toLowerCase();

        if (!val) {
            list.style.display = 'none';
            return;
        }

        // Extract unique values for the field
        const allVals = [...new Set(books.map(b => b[dataField]).filter(v => v))];
        const matches = allVals.filter(v => v.toLowerCase().includes(val)).slice(0, 5); // Limit 5

        if (matches.length > 0) {
            list.innerHTML = matches.map(m => `<li>${escapeHTML(m)}</li>`).join('');
            list.style.display = 'block';

            // Add click handlers
            list.querySelectorAll('li').forEach(li => {
                li.addEventListener('click', () => {
                    input.value = li.textContent;
                    list.style.display = 'none';
                });
            });
        } else {
            list.style.display = 'none';
        }
    });

    input.addEventListener('focus', () => {
        // Trigger input event to show suggestions if input is not empty
        if (input.value.trim()) {
            input.dispatchEvent(new Event('input'));
        }
    });
}

// ==========================================
// UI Helpers
// ==========================================
function showToast(message) {
    toastInfo.textContent = message;
    toastInfo.classList.add('show');

    setTimeout(() => {
        toastInfo.classList.remove('show');
    }, 3000);
}

// Simple HTML escaper to prevent XSS
function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ==========================================
// Form & Tags Helpers
// ==========================================
function startEditMode(id) {
    const book = books.find(b => b.id === id);
    if (!book) return;

    isEditing = true;
    editBookId.value = id;

    // Switch to Add/Edit tab
    tabBtns[1].click();

    // Update UI elements
    formTitle.textContent = 'Edit Book';
    formSubtitle.textContent = 'Update the details of the selected book.';
    formSubmitBtn.textContent = 'Update Book';
    formCancelBtn.style.display = 'inline-block';

    // Populate fields
    document.getElementById('book-name').value = book.name || '';
    document.getElementById('book-sinhala-name').value = book.sinhalaName || '';
    document.getElementById('book-author').value = book.author || '';
    document.getElementById('book-translator').value = book.translator || '';
    document.getElementById('book-language').value = book.language || '';
    document.getElementById('book-category').value = book.category || '';

    // Populate tags
    currentTags = [...(book.tags || [])];
    renderTags();
}

function resetForm() {
    addBookForm.reset();
    isEditing = false;
    editBookId.value = '';
    document.getElementById('book-sinhala-name').value = '';

    formTitle.textContent = 'Add to Library';
    formSubtitle.textContent = 'Enter the details of the new book. Fields with suggestions will auto-complete as you type.';
    formSubmitBtn.textContent = 'Save Book';

    currentTags = [];
    renderTags();
}

function addTag(tag) {
    const cleanTag = tag.trim().toLowerCase();
    if (cleanTag && !currentTags.includes(cleanTag)) {
        currentTags.push(cleanTag);
        renderTags();
    }
    tagsInput.value = '';
}

function removeTag(index) {
    currentTags.splice(index, 1);
    renderTags();
}

function renderTags() {
    // Remove all existing tag chips except the input
    const chips = tagsWrapper.querySelectorAll('.tag-chip');
    chips.forEach(chip => chip.remove());

    // Insert new tags before the input
    currentTags.forEach((tag, index) => {
        const span = document.createElement('span');
        span.className = 'tag-chip';
        span.innerHTML = `
            ${escapeHTML(tag)}
            <button type="button" class="tag-remove" data-index="${index}" aria-label="Remove tag">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        `;
        tagsWrapper.insertBefore(span, tagsInput);
    });

    // Reattach event listeners to new remove buttons
    tagsWrapper.querySelectorAll('.tag-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // prevent form submission
            e.preventDefault();
            e.stopPropagation();
            removeTag(parseInt(btn.dataset.index, 10));
        });
    });
}

// ==========================================
// Clickable Authors & Translators
// ==========================================
window.searchByCreator = function (name) {
    if (!name) return;
    globalSearch.value = name;
    applyFilters();
    // Scroll to top of catalog
    document.querySelector('.catalog-controls').scrollIntoView({ behavior: 'smooth' });
}

// ==========================================
// CSV Export Logic
// ==========================================
function exportToCsv() {
    if (filteredBooks.length === 0) {
        showToast("No data to export!");
        return;
    }

    const headers = ["ID", "Name", "Sinhala Name", "Author", "Translator", "Language", "Category", "Tags"];

    const rows = filteredBooks.map(book => {
        // Wrapper for handling commas within data
        const escapeCsv = (val) => {
            if (!val) return '""';
            const str = String(val).replace(/"/g, '""');
            return `"${str}"`;
        };

        return [
            book.id,
            escapeCsv(book.name),
            escapeCsv(book.sinhalaName || ''),
            escapeCsv(book.author),
            escapeCsv(book.translator),
            escapeCsv(book.language),
            escapeCsv(book.category),
            escapeCsv((book.tags || []).join(', '))
        ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "aurora_library_export.csv");
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast("Exported to CSV successfully!");
}

// ==========================================
// CSV Import Logic
// ==========================================
function handleCsvImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        const text = event.target.result;
        parseCsvData(text);
        // Reset the file input so the same file can be imported again if needed
        importCsvFile.value = '';
    };
    reader.onerror = () => {
        showToast("Error reading the file.");
    };
    reader.readAsText(file);
}

function parseCsvData(csvText) {
    try {
        const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');
        if (lines.length < 2) {
            showToast("The CSV file appears to be empty or has no data rows.");
            return;
        }

        const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

        const categoryIndex = headers.indexOf('category') !== -1 ? headers.indexOf('category') : headers.indexOf('categoery');

        // Ensure required headers exist
        if (!headers.includes('name') || !headers.includes('author')) {
            showToast("CSV must at least have 'Name' and 'Author' columns.");
            return;
        }

        const newBooks = [];
        let maxId = 0;

        // Simple CSV parser for standard rows (assumes no complex embedded newlines inside strings)
        for (let i = 1; i < lines.length; i++) {
            const rowStr = lines[i];
            // Split by comma, but ignore commas inside quotes
            const rowTokens = [];
            let inQuotes = false;
            let currentToken = '';

            for (let j = 0; j < rowStr.length; j++) {
                const char = rowStr[j];
                if (char === '"') {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    rowTokens.push(currentToken);
                    currentToken = '';
                } else {
                    currentToken += char;
                }
            }
            rowTokens.push(currentToken); // push last token

            const rowData = rowTokens.map(t => t.trim().replace(/^"|"$/g, ''));
            const bookRecord = {};

            headers.forEach((header, index) => {
                bookRecord[header] = rowData[index] || '';
            });

            // Map standard object
            // Clean names to prevent duplicates from leading/trailing spaces
            let authorName = (bookRecord.author || '').trim();
            let translatorName = (bookRecord.translator || '').trim();

            const parsedBook = {
                id: bookRecord.id ? parseInt(bookRecord.id, 10) : 0,
                name: (bookRecord.name || '').trim(),
                sinhalaName: (bookRecord['sinhala name'] || bookRecord['sinhala_name'] || bookRecord['sinhalaname'] || '').trim(),
                author: authorName,
                translator: translatorName,
                language: bookRecord.language || 'Other',
                category: categoryIndex !== -1 ? (rowData[categoryIndex] || 'Other') : 'Other',
                tags: bookRecord.tags ? bookRecord.tags.split(';').map(t => t.trim()).filter(t => t) : []
            };

            if (parsedBook.id > maxId) maxId = parsedBook.id;
            newBooks.push(parsedBook);
        }

        // Assign IDs to entirely new records
        newBooks.forEach(b => {
            if (!b.id) {
                maxId++;
                b.id = maxId;
            }
        });

        books = newBooks;
        saveData();
        populateFilterDropdowns();
        renderBooks();

        showToast(`Successfully imported ${books.length} books!`);

    } catch (error) {
        console.error("CSV Parse Error", error);
        showToast("Failed to parse CSV file.");
    }
}

// ==========================================
// Statistics & Charts
// ==========================================
let categoryChartInstance = null;
let languageChartInstance = null;

function renderStats() {
    const totalBooks = books.length;

    // Total Authors
    const authors = new Set(books.map(b => b.author).filter(b => b));
    const totalAuthors = authors.size;

    // Total Tags
    const allTags = new Set();
    books.forEach(b => {
        if (b.tags && Array.isArray(b.tags)) {
            b.tags.forEach(t => allTags.add(t));
        }
    });
    const totalTags = allTags.size;

    // Update DOM texts
    document.getElementById('stat-total-books').textContent = totalBooks;
    document.getElementById('stat-total-authors').textContent = totalAuthors;
    document.getElementById('stat-total-tags').textContent = totalTags;

    // Chart Data Generation
    const catCounts = {};
    const langCounts = {};

    books.forEach(b => {
        catCounts[b.category] = (catCounts[b.category] || 0) + 1;
        langCounts[b.language] = (langCounts[b.language] || 0) + 1;
    });

    // Theme Colors for charts
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim();
    const surfaceColor = getComputedStyle(document.documentElement).getPropertyValue('--bg-color').trim();
    const accent1 = '#4361ee';
    const accent2 = '#3a0ca3';
    const accent3 = '#7209b7';
    const accent4 = '#f72585';
    const accent5 = '#4cc9f0';
    const palette = [accent1, accent5, accent4, accent3, accent2, '#ffb703', '#fb8500', '#2a9d8f'];

    // Category Chart
    const catCtx = document.getElementById('categoryChart').getContext('2d');
    if (categoryChartInstance) categoryChartInstance.destroy();

    categoryChartInstance = new Chart(catCtx, {
        type: 'pie',
        data: {
            labels: Object.keys(catCounts),
            datasets: [{
                data: Object.values(catCounts),
                backgroundColor: palette,
                borderWidth: 2,
                borderColor: surfaceColor
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { color: textColor, font: { family: 'Inter' } } }
            }
        }
    });

    // Language Chart
    const langCtx = document.getElementById('languageChart').getContext('2d');
    if (languageChartInstance) languageChartInstance.destroy();

    languageChartInstance = new Chart(langCtx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(langCounts),
            datasets: [{
                data: Object.values(langCounts),
                backgroundColor: palette.slice().reverse(),
                borderWidth: 2,
                borderColor: surfaceColor
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { color: textColor, font: { family: 'Inter' } } }
            }
        }
    });

    // Top 15 leaderboards
    renderLeaderboard('stat-authors-list', 'author', 15);
    renderLeaderboard('stat-translators-list', 'translator', 15);
}

// ==========================================
// People Manager
// ==========================================
let currentPeopleField = 'author';
let allPeople = [];

window.showPeopleList = function (field) {
    currentPeopleField = field;
    document.getElementById('show-authors-btn').className = field === 'author' ? 'btn btn-primary' : 'btn btn-secondary';
    document.getElementById('show-translators-btn').className = field === 'translator' ? 'btn btn-primary' : 'btn btn-secondary';
    renderPeopleList();
};

window.filterPeopleList = function () {
    renderPeopleList();
};

function renderPeopleList() {
    const container = document.getElementById('people-list-container');
    const searchQuery = (document.getElementById('people-search').value || '').toLowerCase().trim();

    // Gather unique people with counts and Sinhala names
    const peopleMap = {};
    books.forEach(book => {
        const name = (book[currentPeopleField] || '').trim();
        if (!name) return;
        if (!peopleMap[name]) {
            peopleMap[name] = { name, count: 0, sinhalaName: book[`${currentPeopleField}SinhalaName`] || '' };
        }
        peopleMap[name].count++;
    });

    allPeople = Object.values(peopleMap).sort((a, b) => a.name.localeCompare(b.name));
    const filtered = searchQuery ? allPeople.filter(p => p.name.toLowerCase().includes(searchQuery)) : allPeople;

    if (filtered.length === 0) {
        container.innerHTML = `<p style="color:var(--text-secondary);">No ${currentPeopleField}s found.</p>`;
        return;
    }

    container.innerHTML = `
        <!-- Merge toolbar — shown when checkboxes are selected -->
        <div id="merge-toolbar" style="display:none; background:var(--accent-light); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:0.75rem 1rem; margin-bottom:1rem; flex-wrap:wrap; gap:0.75rem; align-items:center;">
            <span id="merge-selection-label" style="font-size:0.85rem; color:var(--text-secondary); flex:none;">0 selected</span>
            <input type="text" id="merge-correct-name" placeholder="Type the CORRECT name to use for all selected…"
                style="flex:1; min-width:260px; padding:0.4rem 0.75rem; border:1px solid var(--border-color); border-radius:var(--radius-md); background:var(--surface-color); color:var(--text-primary); font-size:0.9rem;" />
            <button class="btn btn-primary" style="background:#e05252; padding:0.4rem 1rem; font-size:0.85rem;" onclick="confirmCheckboxMerge()">✓ Merge Selected</button>
            <button class="btn btn-secondary" style="padding:0.4rem 0.8rem; font-size:0.85rem;" onclick="clearPeopleSelection()">✕ Clear</button>
        </div>

        <div style="margin-bottom: 0.5rem; font-size: 0.8rem; color: var(--text-secondary);">
            ☑ Check rows to select duplicates, then type the correct name and click <strong>Merge Selected</strong>.
        </div>

        <table class="people-table">
            <thead>
                <tr>
                    <th style="width:36px;"><input type="checkbox" id="people-select-all" onchange="toggleAllPeople(this)" title="Select all"></th>
                    <th>Name</th>
                    <th>Sinhala Name</th>
                    <th>Books</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${filtered.map((p, i) => `
                <tr id="person-row-${i}">
                    <td><input type="checkbox" class="person-cb" data-name="${escapeHTML(p.name)}" onchange="updateMergeToolbar()" /></td>
                    <td>
                        <input class="people-name-input" id="person-name-${i}" value="${escapeHTML(p.name)}" type="text" />
                    </td>
                    <td>
                        <input class="people-sinhala-input" id="person-sinhala-${i}" value="${escapeHTML(p.sinhalaName)}" type="text" lang="si" placeholder="සිංහල නම" />
                    </td>
                    <td><span class="tag">${p.count}</span></td>
                    <td>
                        <button class="btn btn-primary" style="padding:0.3rem 0.8rem; font-size:0.8rem;" onclick="savePerson(${i}, '${p.name.replace(/'/g, "\\'")}')">Save</button>
                    </td>
                </tr>`).join('')}
            </tbody>
        </table>
    `;
}

window.savePerson = async function (index, originalName) {
    const newName = document.getElementById(`person-name-${index}`).value.trim();
    const sinhalaName = document.getElementById(`person-sinhala-${index}`).value.trim();

    if (!newName) {
        showToast('Name cannot be empty.');
        return;
    }

    const sinhalaKey = `${currentPeopleField}SinhalaName`;
    let updated = 0;

    books.forEach(book => {
        if ((book[currentPeopleField] || '').trim() === originalName) {
            book[currentPeopleField] = newName;
            book[sinhalaKey] = sinhalaName;
            updated++;
        }
    });

    if (updated === 0) {
        showToast('No books found for that person.');
        return;
    }

    await saveData();
    showToast(`Updated ${updated} book(s) for "${newName}".`);
    renderPeopleList();
    applyFilters();
};

// ==========================================
// People Manager — Merge
// ==========================================
window.showMergePanel = function (index, name) {
    // Hide any other open merge panels first
    document.querySelectorAll('[id^="merge-panel-"]').forEach(el => el.style.display = 'none');
    const panel = document.getElementById(`merge-panel-${index}`);
    if (panel) panel.style.display = 'table-row';
};

window.hideMergePanel = function (index) {
    const panel = document.getElementById(`merge-panel-${index}`);
    if (panel) panel.style.display = 'none';
};

window.confirmMerge = async function (index, sourceName) {
    const targetSelect = document.getElementById(`merge-target-${index}`);
    const targetName = targetSelect ? targetSelect.value : null;

    if (!targetName || targetName === sourceName) {
        showToast('Please select a different target name to merge into.');
        return;
    }

    // Find Sinhala name of target (use the target's sinhalaName if it has one)
    const sinhalaKey = `${currentPeopleField}SinhalaName`;
    const targetBook = books.find(b => (b[currentPeopleField] || '').trim() === targetName);
    const targetSinhala = (targetBook && targetBook[sinhalaKey]) || '';

    let merged = 0;
    books.forEach(book => {
        if ((book[currentPeopleField] || '').trim() === sourceName) {
            book[currentPeopleField] = targetName;
            if (targetSinhala) book[sinhalaKey] = targetSinhala;
            merged++;
        }
    });

    if (merged === 0) {
        showToast('Nothing to merge.');
        return;
    }

    await saveData();
    showToast(`✅ Merged ${merged} book(s) from "${sourceName}" → "${targetName}".`);
    renderPeopleList();
    applyFilters();
};

// ==========================================
// People Manager — Checkbox Merge
// ==========================================
window.updateMergeToolbar = function () {
    const checked = document.querySelectorAll('.person-cb:checked');
    const toolbar = document.getElementById('merge-toolbar');
    const label = document.getElementById('merge-selection-label');
    if (!toolbar) return;
    if (checked.length > 0) {
        toolbar.style.display = 'flex';
        label.textContent = `${checked.length} selected`;
    } else {
        toolbar.style.display = 'none';
    }
};

window.toggleAllPeople = function (masterCb) {
    document.querySelectorAll('.person-cb').forEach(cb => cb.checked = masterCb.checked);
    window.updateMergeToolbar();
};

window.clearPeopleSelection = function () {
    document.querySelectorAll('.person-cb').forEach(cb => cb.checked = false);
    const selectAll = document.getElementById('people-select-all');
    if (selectAll) selectAll.checked = false;
    window.updateMergeToolbar();
};

window.confirmCheckboxMerge = async function () {
    const correctName = (document.getElementById('merge-correct-name').value || '').trim();
    if (!correctName) {
        showToast('Please type the correct name to merge into.');
        return;
    }

    const selectedNames = [...document.querySelectorAll('.person-cb:checked')].map(cb => cb.dataset.name);
    if (selectedNames.length === 0) {
        showToast('No rows selected.');
        return;
    }

    const sinhalaKey = `${currentPeopleField}SinhalaName`;
    let totalMerged = 0;

    books.forEach(book => {
        if (selectedNames.includes((book[currentPeopleField] || '').trim())) {
            book[currentPeopleField] = correctName;
            totalMerged++;
        }
    });

    if (totalMerged === 0) {
        showToast('Nothing to merge.');
        return;
    }

    await saveData();
    showToast(`✅ Merged ${totalMerged} book(s) → "${correctName}".`);
    renderPeopleList();
    applyFilters();
};

// ==========================================
// Stats Leaderboards
// ==========================================
function renderLeaderboard(containerId, field, topN = 15) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const counts = {};
    books.forEach(book => {
        const name = (book[field] || '').trim();
        if (name) counts[name] = (counts[name] || 0) + 1;
    });

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, topN);
    if (sorted.length === 0) { container.innerHTML = '<p style="color:var(--text-secondary)">No data.</p>'; return; }

    const max = sorted[0][1];
    container.innerHTML = sorted.map(([name, count], i) => `
        <div class="stat-leaderboard-row">
            <span class="stat-leaderboard-rank">${i + 1}.</span>
            <span class="stat-leaderboard-name" title="${escapeHTML(name)}">${escapeHTML(name)}</span>
            <div class="stat-leaderboard-bar-wrap">
                <div class="stat-leaderboard-bar" style="width:${Math.round((count / max) * 100)}%"></div>
            </div>
            <span class="stat-leaderboard-count">${count}</span>
        </div>
    `).join('');
}

// ==========================================
// Settings Manager
// ==========================================
const THEMES = [
    { id: 'light', name: '☀️ Light', bg: '#fcfaf8', surface: '#ffffff', accent: '#8a5a44' },
    { id: 'dark', name: '🌙 Dark', bg: '#1a1817', surface: '#242120', accent: '#c28b72' },
    { id: 'sepia', name: '📜 Sepia', bg: '#f4ecd8', surface: '#e9dec1', accent: '#a65d3b' },
    { id: 'nord', name: '❄️ Nord', bg: '#2e3440', surface: '#3b4252', accent: '#88c0d0' },
    { id: 'forest', name: '🌿 Forest', bg: '#1b2b1f', surface: '#243328', accent: '#56a85f' },
    { id: 'ocean', name: '🌊 Ocean', bg: '#0d1b2a', surface: '#152233', accent: '#4d9de0' },
    { id: 'crimson', name: '🔴 Crimson', bg: '#1c0f12', surface: '#2b1519', accent: '#c0384a' },
    { id: 'purple', name: '🟣 Purple Night', bg: '#130d1f', surface: '#1e1430', accent: '#9d62d9' },
    { id: 'contrast', name: '👁️ High Contrast', bg: '#f8f8f8', surface: '#ffffff', accent: '#0056d6' },
    { id: 'rosegold', name: '🌸 Rose Gold', bg: '#fff5f7', surface: '#ffffff', accent: '#c96b7e' },
    { id: 'solarized', name: '🌅 Solarized Dark', bg: '#002b36', surface: '#073642', accent: '#268bd2' },
    { id: 'dracula', name: '🧛 Dracula', bg: '#282a36', surface: '#363948', accent: '#ff79c6' },
    { id: 'tokyo', name: '🗼 Tokyo Night', bg: '#1a1b2e', surface: '#24253d', accent: '#7aa2f7' },
    { id: 'catppuccin', name: '🍵 Catppuccin', bg: '#1e1e2e', surface: '#292938', accent: '#cba6f7' },
    { id: 'mint', name: '🍃 Mint', bg: '#f0faf4', surface: '#ffffff', accent: '#2e8b5a' },
];

const FONTS = [
    { family: 'Inter', name: 'Inter', preview: 'Aa' },
    { family: 'Roboto', name: 'Roboto', preview: 'Aa' },
    { family: 'Lato', name: 'Lato', preview: 'Aa' },
    { family: 'Open Sans', name: 'Open Sans', preview: 'Aa' },
    { family: 'Poppins', name: 'Poppins', preview: 'Aa' },
    { family: 'Outfit', name: 'Outfit', preview: 'Aa' },
    { family: 'Nunito', name: 'Nunito', preview: 'Aa' },
    { family: 'Merriweather', name: 'Merriweather', preview: 'Ag' },
    { family: 'Source Serif 4', name: 'Source Serif', preview: 'Ag' },
    { family: 'Playfair Display', name: 'Playfair', preview: 'Ag' },
    { family: 'Crimson Pro', name: 'Crimson Pro', preview: 'Ag' },
    { family: 'IBM Plex Sans', name: 'IBM Plex Sans', preview: 'Aa' },
    { family: 'DM Sans', name: 'DM Sans', preview: 'Aa' },
    { family: 'Work Sans', name: 'Work Sans', preview: 'Aa' },
    { family: 'Noto Sans Sinhala', name: 'Noto Sinhala', preview: 'අ ශ් ම' },
];

let currentSettings = {
    theme: 'light',
    font: 'Inter',
    categoryColors: false
};

function loadSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem('mimirSettings') || '{}');
        currentSettings = { ...currentSettings, ...saved };
    } catch (e) { /* ignore */ }
}

function saveSettings() {
    localStorage.setItem('mimirSettings', JSON.stringify(currentSettings));
}

function applySettings() {
    document.documentElement.setAttribute('data-theme', currentSettings.theme);
    document.body.style.setProperty('--font-body', `'${currentSettings.font}', sans-serif`);
    if (currentSettings.categoryColors) {
        document.body.classList.add('category-colors-on');
    } else {
        document.body.classList.remove('category-colors-on');
    }
    // Apply saved font sizes
    const propMap = {
        idSize: '--user-id-size',
        titleSize: '--user-title-size',
        sinhalaSize: '--user-sinhala-size',
        authorSize: '--user-author-size',
        translatorSize: '--user-translator-size',
    };
    const defaults = { idSize: 15, titleSize: 18, sinhalaSize: 17, authorSize: 14, translatorSize: 13 };
    Object.entries(propMap).forEach(([key, prop]) => {
        const val = currentSettings[key] || defaults[key];
        document.documentElement.style.setProperty(prop, `${val}px`);
    });
}

window.setTheme = function (themeId) {
    currentSettings.theme = themeId;
    saveSettings();
    applySettings();
    // Update active swatch
    document.querySelectorAll('.theme-swatch').forEach(el => {
        el.classList.toggle('active', el.dataset.theme === themeId);
    });
};

window.setFont = function (fontFamily) {
    currentSettings.font = fontFamily;
    saveSettings();
    // Load font from Google Fonts lazily
    loadGoogleFont(fontFamily);
    document.body.style.setProperty('--font-body', `'${fontFamily}', sans-serif`);
    // Update active font card
    document.querySelectorAll('.font-card').forEach(el => {
        el.classList.toggle('active', el.dataset.font === fontFamily);
    });
};

window.toggleCategoryColors = function (on) {
    currentSettings.categoryColors = on;
    saveSettings();
    applySettings();
    document.getElementById('cat-colors-label').textContent = on ? 'On' : 'Off';
};

function loadGoogleFont(family) {
    const id = `gf-${family.replace(/\s+/g, '-')}`;
    if (document.getElementById(id)) return; // already loaded
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    const encoded = encodeURIComponent(family + ':wght@300;400;500;600;700');
    link.href = `https://fonts.googleapis.com/css2?family=${encoded}&display=swap`;
    document.head.appendChild(link);
}

function renderSettingsPage() {
    // Theme swatches
    const swatchGrid = document.getElementById('theme-swatch-grid');
    if (swatchGrid) {
        swatchGrid.innerHTML = THEMES.map(t => `
            <div class="theme-swatch${currentSettings.theme === t.id ? ' active' : ''}" data-theme="${t.id}" onclick="setTheme('${t.id}')">
                <div class="theme-swatch-preview" style="background:${t.bg};">
                    <div class="swatch-dot" style="background:${t.accent};"></div>
                    <div class="swatch-dot" style="background:${t.surface}; border:1px solid ${t.accent}44;"></div>
                </div>
                <div class="theme-swatch-name" style="background:${t.surface}; color:${t.accent};">${t.name}</div>
            </div>
        `).join('');
    }

    // Font cards
    const fontGrid = document.getElementById('font-card-grid');
    if (fontGrid) {
        fontGrid.innerHTML = FONTS.map(f => {
            loadGoogleFont(f.family);
            return `
            <div class="font-card${currentSettings.font === f.family ? ' active' : ''}" data-font="${f.family}" onclick="setFont('${f.family}')">
                <div class="font-card-preview" style="font-family:'${f.family}', sans-serif;">${f.preview}</div>
                <div class="font-card-name">${f.name}</div>
            </div>`;
        }).join('');
    }

    // Category colors toggle
    const toggle = document.getElementById('category-colors-toggle');
    if (toggle) {
        toggle.checked = currentSettings.categoryColors;
        document.getElementById('cat-colors-label').textContent = currentSettings.categoryColors ? 'On' : 'Off';
    }

    // Font size sliders
    const SLIDER_MAP = [
        { key: 'idSize', sliderId: 'slider-id-size', labelId: 'lbl-id-size', prop: '--user-id-size' },
        { key: 'titleSize', sliderId: 'slider-title-size', labelId: 'lbl-title-size', prop: '--user-title-size' },
        { key: 'sinhalaSize', sliderId: 'slider-sinhala-size', labelId: 'lbl-sinhala-size', prop: '--user-sinhala-size' },
        { key: 'authorSize', sliderId: 'slider-author-size', labelId: 'lbl-author-size', prop: '--user-author-size' },
        { key: 'translatorSize', sliderId: 'slider-translator-size', labelId: 'lbl-translator-size', prop: '--user-translator-size' },
    ];
    SLIDER_MAP.forEach(({ key, sliderId, labelId }) => {
        const slider = document.getElementById(sliderId);
        const label = document.getElementById(labelId);
        if (!slider || !label) return;
        const val = currentSettings[key] || DEFAULT_FONT_SIZES[key];
        slider.value = val;
        label.textContent = `${val}px`;
    });
}

function initSettings() {
    loadSettings();
    applySettings();
    document.querySelectorAll('.tab-btn[data-target="view-settings"]').forEach(btn => {
        btn.addEventListener('click', () => renderSettingsPage());
    });
}

// Call settings init on startup
initSettings();

// ==========================================
// Font Size Adjuster
// ==========================================
const DEFAULT_FONT_SIZES = {
    idSize: 15,
    titleSize: 18,
    sinhalaSize: 17,
    authorSize: 14,
    translatorSize: 13,
};

const FONT_SIZE_PROPS = {
    idSize: '--user-id-size',
    titleSize: '--user-title-size',
    sinhalaSize: '--user-sinhala-size',
    authorSize: '--user-author-size',
    translatorSize: '--user-translator-size',
};

const FONT_SIZE_KEY_MAP = {
    id: 'idSize',
    title: 'titleSize',
    sinhala: 'sinhalaSize',
    author: 'authorSize',
    translator: 'translatorSize',
};

window.updateFontSize = function (type, pxVal) {
    const key = FONT_SIZE_KEY_MAP[type];
    const prop = FONT_SIZE_PROPS[key];
    const px = parseInt(pxVal, 10);
    document.documentElement.style.setProperty(prop, `${px}px`);
    currentSettings[key] = px;
    saveSettings();
    // Update label
    const label = document.getElementById(`lbl-${type}-size`);
    if (label) label.textContent = `${px}px`;
};
