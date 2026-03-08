import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, getDocs, doc, writeBatch, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut, updatePassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

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
const auth = getAuth(app);
const provider = null;

// Secondary app to prevent admin logout when creating users
const secondaryApp = initializeApp(firebaseConfig, "Secondary");
const secondaryAuth = getAuth(secondaryApp);

// ==========================================
// State Management
// ==========================================
let books = [];
let filteredBooks = [];
let currentPage = 1;
let currentTags = [];
let isEditing = false;
let currentUser = null;
let PAGE_SIZE = 24;
let viewMode = 'both'; // both, eng, sin
let lendings = [];
let lendingSelectedBooks = []; // Temporary storage for lending form

// Load data from LocalStorage or data.json
// Load data from Firebase Firestore
async function initData() {
    try {
        const querySnapshot = await getDocs(collection(db, "books"));
        if (!querySnapshot.empty) {
            books = [];
            querySnapshot.forEach((doc) => {
                const data = doc.data();
                // Crucial: document ID must be used as the internal 'id' if 'id' field is missing or inconsistent
                if (!data.id) data.id = doc.id;
                // Ensure ID is treated consistently (some might be strings, others ints)
                // However, the app uses parseInt(id, 10) in some places. 
                // Let's keep the existing format but ensure it exists.
                books.push(data);
            });
        } else {
            // Database is empty
            books = [];
        }
    } catch (error) {
        console.error("Firebase connection error:", error);
        books = [];
        showToast("Failed to connect to Firebase.");
    }

    // Filter out potential nulls
    books = (books || []).filter(b => b !== null && b !== undefined);

    // Reverse to show newest first by default
    filteredBooks = [...books].reverse();

    await initLendings();
}

async function initLendings() {
    try {
        const querySnapshot = await getDocs(collection(db, "lendings"));
        lendings = [];
        querySnapshot.forEach((doc) => {
            lendings.push({ ...doc.data(), docId: doc.id });
        });
    } catch (error) {
        console.error("Error loading lendings:", error);
    }
}

async function saveLending(lendingRecord) {
    if (!currentUser) return;
    try {
        const docRef = doc(collection(db, "lendings"));
        const record = { ...lendingRecord, id: docRef.id, createdAt: new Date().toISOString() };
        await setDoc(docRef, record);
        lendings.push(record);
        showToast("Lending record saved!");
        return true;
    } catch (error) {
        console.error("Error saving lending:", error);
        showToast("Failed to save lending record.");
        return false;
    }
}

async function markReturned(lendId, bookId = null) {
    if (!currentUser) return;
    try {
        const lending = lendings.find(l => l.id === lendId);
        if (!lending) return;

        if (bookId) {
            // Mark individual book as returned
            const book = lending.books.find(b => b.id === bookId);
            if (book) {
                book.returned = true;
                book.returnDate = new Date().toISOString().split('T')[0];
            }

            // Check if all books are now returned
            const allReturned = lending.books.every(b => b.returned);
            if (allReturned) {
                lending.status = 'returned';
                lending.returnDate = new Date().toISOString().split('T')[0];
            }
        } else {
            // Mark entire record as returned
            lending.status = 'returned';
            lending.returnDate = new Date().toISOString().split('T')[0];
            lending.books.forEach(b => {
                b.returned = true;
                if (!b.returnDate) b.returnDate = new Date().toISOString().split('T')[0];
            });
        }

        await setDoc(doc(db, "lendings", lendId), lending);
        showToast(bookId ? "Book marked as returned." : "All books marked as returned.");

        // Refresh everything
        renderLendingPage();
        renderStats();
        renderBooks();
    } catch (error) {
        console.error("Error updating lending:", error);
        showToast("Error updating record. " + error.message);
    }
}

window.markReturned = async function (lendId, bookId = null) {
    if (!currentUser) return showToast("Login required to mark as returned.");
    await markReturned(lendId, bookId);
};

async function deleteLendingRecord(lendId) {
    if (!currentUser) return;
    if (!confirm("Are you sure you want to delete this lending record permanently?")) return;

    try {
        await deleteDoc(doc(db, "lendings", lendId));
        lendings = lendings.filter(l => l.id !== lendId);
        showToast("Lending record deleted.");
        renderLendingPage();
        renderStats();
        renderBooks();
    } catch (error) {
        console.error("Error deleting lending:", error);
        showToast("Failed to delete record.");
    }
}
window.deleteLendingRecord = deleteLendingRecord;

async function clearLendingHistory() {
    if (!currentUser) return;
    const history = lendings.filter(l => l.status === 'returned');
    if (history.length === 0) return showToast("No history to clear.");

    if (!confirm(`Are you sure you want to delete all ${history.length} returned records permanently?`)) return;

    try {
        const BATCH_SIZE = 400;
        for (let i = 0; i < history.length; i += BATCH_SIZE) {
            const batch = writeBatch(db);
            const chunk = history.slice(i, i + BATCH_SIZE);
            chunk.forEach(l => {
                batch.delete(doc(db, "lendings", l.id));
            });
            await batch.commit();
        }

        lendings = lendings.filter(l => l.status !== 'returned');
        showToast("Lending history cleared.");
        renderLendingPage();
        renderStats();
    } catch (error) {
        console.error("Error clearing history:", error);
        showToast("Failed to clear history.");
    }
}
window.clearLendingHistory = clearLendingHistory;

async function saveData() {
    const cleanBooks = books.filter(b => b !== null && b !== undefined);
    try {
        const BATCH_SIZE = 400;
        for (let i = 0; i < cleanBooks.length; i += BATCH_SIZE) {
            const batch = writeBatch(db);
            const chunk = cleanBooks.slice(i, i + BATCH_SIZE);
            chunk.forEach(book => {
                // Use the book ID as the document ID for absolute consistency
                const docRef = doc(db, "books", String(book.id));
                batch.set(docRef, book);
            });
            await batch.commit();
        }
        return true;
    } catch (e) {
        console.error("Failed to save to Firebase Firestore:", e);
        showToast("Error saving to cloud database.");
        return false;
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
// Authentication Handlers
// ==========================================

// Map username to internal Firebase email format
function getMimirEmail(username) {
    return `${username.toLowerCase().trim()}@mimir.local`;
}

async function signIn(username, password) {
    try {
        const email = getMimirEmail(username);

        // On-demand seeding for admin if it doesn't exist
        if (username === 'admin' && password === 'admin123') {
            try {
                await signInWithEmailAndPassword(auth, email, password);
            } catch (err) {
                if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential' || err.code === 'auth/invalid-login-credentials') {
                    console.log("Seeding admin account on-demand...");
                    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                    await setDoc(doc(db, "users", userCredential.user.uid), {
                        username: 'admin',
                        role: 'admin',
                        createdAt: new Date().toISOString()
                    });
                    console.log("Admin account seeded successfully.");
                    // Sign in again after creation
                    await signInWithEmailAndPassword(auth, email, password);
                } else {
                    throw err;
                }
            }
        } else {
            await signInWithEmailAndPassword(auth, email, password);
        }

        showToast("Logged in successfully!");
        return true;
    } catch (error) {
        console.error("Login Error Details:", error.code, error.message);
        let msg = "Login failed";
        if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential' || error.code === 'auth/invalid-login-credentials') {
            msg = "Invalid username or password";
        } else if (error.code === 'auth/too-many-requests') {
            msg = "Too many failed attempts. Try again later";
        }
        showToast(`${msg} (${error.code || 'unknown'})`);
        return false;
    }
}

// DEPRECATED: initAdminAccount functionality moved into signIn for security

async function logout() {
    try {
        await signOut(auth);
        showToast("Logged out.");
    } catch (error) {
        console.error("Logout failed:", error);
    }
}

// Initialization & Events
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    // Clear session cache for fresh data on every load
    sessionStorage.clear();
    if ('caches' in window) {
        caches.keys().then(names => names.forEach(name => caches.delete(name)));
    }

    // Dark mode auto-detect on first visit
    if (!localStorage.getItem('mimirSettings') && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }

    await initData();
    populateFilterDropdowns();
    renderBooks();

    // Auth Events
    const showLoginBtn = document.getElementById('show-login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    if (showLoginBtn) showLoginBtn.addEventListener('click', () => toggleLoginModal(true));
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    // Auth State Observer
    onAuthStateChanged(auth, async (user) => {
        currentUser = user;
        const userInfo = document.getElementById('user-info');
        const showLoginBtn = document.getElementById('show-login-btn');
        const userDisplayName = document.getElementById('user-display-name');

        if (user) {
            document.body.classList.add('logged-in');
            if (userInfo) userInfo.classList.remove('hidden');
            if (showLoginBtn) showLoginBtn.classList.add('hidden');

            // Get user data for role/username
            try {
                const userDoc = await getDocs(collection(db, "users"));
                const userData = userDoc.docs.find(d => d.id === user.uid)?.data();
                if (userData) {
                    userDisplayName.textContent = userData.username;
                    if (userData.role === 'admin') {
                        document.body.classList.add('is-admin');
                    }
                } else {
                    userDisplayName.textContent = (user.email || 'User').split('@')[0];
                }

                // CRITICAL: Reload all data from cloud when auth state confirms user
                await initData();
                populateFilterDropdowns();
                renderBooks();
                await initLendings();
                if (document.getElementById('view-lending').style.display !== 'none') {
                    renderLendingPage();
                }
            } catch (e) {
                userDisplayName.textContent = (user.email || 'User').split('@')[0];
            }
        } else {
            document.body.classList.remove('logged-in');
            document.body.classList.remove('is-admin');
            if (userInfo) userInfo.classList.add('hidden');
            if (showLoginBtn) showLoginBtn.classList.remove('hidden');

            // Redirect away from auth-required tabs if logged out
            const activeTab = document.querySelector('.tab-btn.active');
            if (activeTab && activeTab.classList.contains('auth-required')) {
                const homeTab = document.querySelector('.tab-btn[data-target="view-books"]');
                if (homeTab) homeTab.click();
            }
        }
    });

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
                    renderTagsDirectory();
                } else if (s.id === 'view-settings') {
                    // Show/Hide User Management button for Admin ONLY
                    const userMgmtBtn = document.getElementById('btn-show-user-mgmt');
                    if (userMgmtBtn) {
                        const isAdmin = document.body.classList.contains('is-admin');
                        userMgmtBtn.style.display = isAdmin ? 'inline-flex' : 'none';
                    }
                } else if (s.id === 'view-add-edit') {
                    // Ensure form is reset when navigating to add/edit tab
                    resetForm();
                } else if (s.id === 'view-people') {
                    renderPeopleList();
                } else if (s.id === 'view-lending') {
                    renderLendingPage();
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
        localStorage.setItem('mimir_view', 'list');
    });

    btnGridView.addEventListener('click', () => {
        booksGrid.classList.remove('books-list');
        booksGrid.classList.add('books-grid');
        btnListView.classList.remove('active');
        btnGridView.classList.add('active');
        localStorage.setItem('mimir_view', 'grid');
    });

    // Filtering & Searching (debounced for search, direct for dropdowns)
    let searchDebounceTimer;
    globalSearch.addEventListener('input', () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(applyFilters, 300);
    });
    filterCategory.addEventListener('change', applyFilters);
    filterLanguage.addEventListener('change', applyFilters);
    sortBySelect.addEventListener('change', applyFilters);

    // Scroll to Top
    const scrollToTopBtn = document.getElementById('scroll-to-top-btn');
    if (scrollToTopBtn) {
        window.addEventListener('scroll', () => {
            if (window.scrollY > 300) {
                scrollToTopBtn.style.display = 'flex';
            } else {
                scrollToTopBtn.style.display = 'none';
            }
        });
    }

    // Pull to Refresh (Mobile)
    let touchStartY = 0;
    window.addEventListener('touchstart', (e) => touchStartY = e.touches[0].clientY, { passive: true });
    window.addEventListener('touchend', (e) => {
        const touchEndY = e.changedTouches[0].clientY;
        if (window.scrollY === 0 && touchEndY > touchStartY + 100) {
            showToast("Refreshing data...");
            initData().then(() => renderPage());
        }
    }, { passive: true });


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

    const deleteBookBtn = document.getElementById('delete-book-btn');
    if (deleteBookBtn) deleteBookBtn.addEventListener('click', deleteBook);

    addBookForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const bookData = {
            name: document.getElementById('book-name').value.trim(),
            sinhalaName: document.getElementById('book-sinhala-name').value.trim(),
            author: document.getElementById('book-author').value.trim(),
            authorSinhala: document.getElementById('book-author-sinhala').value.trim(),
            translator: document.getElementById('book-translator').value.trim(),
            translatorSinhala: document.getElementById('book-translator-sinhala').value.trim(),
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
            logActivity('edit', `Edited book "${bookData.name}" (ID: ${id})`);
        } else {
            // Duplicate detection
            const duplicate = books.find(b =>
                b.name.toLowerCase() === bookData.name.toLowerCase() &&
                (b.author || '').toLowerCase() === (bookData.author || '').toLowerCase()
            );
            if (duplicate && !confirm(`⚠️ A book with the same title and author already exists (ID: ${duplicate.id}).\n\nDo you still want to add this?`)) {
                return;
            }
            bookData.id = generateId();
            books.push(bookData);
            showToast(`"${bookData.name}" added successfully!`);
            logActivity('add', `Added book "${bookData.name}" (ID: ${bookData.id})`);
        }

        saveData();
        resetForm();

        // Go back to view tab automatically
        tabBtns[0].click();
    });

    // Initialize Autocomplete for Book Form
    setupAutocomplete('book-name', 'name', 'autocomplete-bookname');
    setupAutocomplete('book-author', 'author', 'autocomplete-author');
    setupAutocomplete('book-author-sinhala', 'authorSinhala', 'autocomplete-author-sinhala');
    setupAutocomplete('book-translator', 'translator', 'autocomplete-translator');
    setupAutocomplete('book-translator-sinhala', 'translatorSinhala', 'autocomplete-translator-sinhala');
    setupAutocomplete('book-tags-input', 'tags', 'autocomplete-tags', (val) => {
        addTag(val);
        tagsInput.value = '';
    });

    // Language Toggle logic
    const langBtns = document.querySelectorAll('.lang-btn');
    langBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            langBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            viewMode = btn.dataset.lang;
            renderPage(); // Refresh current view with new mode
        });
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

    // Lending Form
    const lendingForm = document.getElementById('add-lending-form');
    if (lendingForm) {
        lendingForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (lendingSelectedBooks.length === 0) return showToast("Select at least one book.");

            const record = {
                borrower: document.getElementById('lendee-name').value.trim(),
                lendDate: document.getElementById('lend-date').value,
                books: lendingSelectedBooks.map(b => ({ id: b.id, name: b.name })),
                status: 'lent'
            };

            const success = await saveLending(record);
            if (success) {
                resetLendingForm();
                renderLendingPage();
                renderBooks();
                renderLendingSummaryStats();
            }
        });
    }

    const lendingSearchInput = document.getElementById('lending-book-search');
    if (lendingSearchInput) {
        lendingSearchInput.addEventListener('input', (e) => updateLendingAutocomplete(e.target.value));
    }

    // Initialize Settings UI and Themes
    initSettings();
    initTheme();
    renderSettingsPage();
});

// ==========================================
// Core Functions
// ==========================================

function initTheme() {
    const savedTheme = localStorage.getItem('mimir_theme') || 'light';
    setTheme(savedTheme);

    const savedView = localStorage.getItem('mimir_view') || 'list';
    if (savedView === 'grid') {
        btnGridView.click();
    } else {
        btnListView.click();
    }
}

function setTheme(theme) {
    htmlEl.setAttribute('data-theme', theme);
    localStorage.setItem('mimir_theme', theme);
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
    } else if (sortVal === 'idAsc') {
        baseBooks.sort((a, b) => a.id - b.id);
    } else if (sortVal === 'idDesc') {
        baseBooks.sort((a, b) => b.id - a.id);
    } else if (sortVal === 'titleAsc') {
        baseBooks.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortVal === 'titleDesc') {
        baseBooks.sort((a, b) => b.name.localeCompare(a.name));
    } else if (sortVal === 'authorAsc') {
        baseBooks.sort((a, b) => a.author.localeCompare(b.author));
    }

    const queryNumeric = !isNaN(query) && query !== "" ? parseInt(query, 10) : null;

    filteredBooks = baseBooks.filter(b => {
        // Dropdown filters
        if (cat && b.category !== cat) return false;
        if (lang && b.language !== lang) return false;

        // Text Search
        if (query) {
            // Prioritize Book ID (but don't return true yet, just include it)
            if (queryNumeric !== null && b.id === queryNumeric) return true;

            const tagsStr = (b.tags || []).join(' ');
            const searchable = `${b.name} ${b.sinhalaName || ''} ${b.author} ${b.translator} ${b.category} ${b.language} ${tagsStr}`.toLowerCase();
            return searchable.includes(query);
        }

        return true;
    });

    // Final sorting to put exact ID match at the top if searching by number
    if (queryNumeric !== null) {
        filteredBooks.sort((a, b) => {
            if (a.id === queryNumeric) return -1;
            if (b.id === queryNumeric) return 1;
            return 0; // maintain relative order for others
        });
    }

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
            `<div class="book-tags">${book.tags.map(t => `<span class="book-tag-chip clickable" onclick="filterByTag('${t.replace(/'/g, "\\'")}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>${escapeHTML(t)}</span>`).join('')}</div>`
            : '';

        const isSin = viewMode === 'sin';
        const isEng = viewMode === 'eng';

        // Title Rendering
        let titleDisplay = `<div class="book-title">${escapeHTML(book.name)}</div>`;
        if (isSin && book.sinhalaName) {
            titleDisplay = `<div class="book-title" lang="si">${escapeHTML(book.sinhalaName)}</div>`;
        } else if (!isEng && book.sinhalaName) {
            titleDisplay = `<div class="book-title">${escapeHTML(book.name)}</div>
                            <div class="book-sinhala-title" lang="si">${escapeHTML(book.sinhalaName)}</div>`;
        }

        // Author Rendering
        let authorDisplay = `<div class="clickable-name" onclick="searchByCreator('${book.author.replace(/'/g, "\\'")}')">${escapeHTML(book.author)}</div>`;
        if (isSin && book.authorSinhala) {
            authorDisplay = `<div class="clickable-name" lang="si" onclick="searchByCreator('${book.author.replace(/'/g, "\\'")}')">${escapeHTML(book.authorSinhala)}</div>`;
        } else if (!isEng && book.authorSinhala) {
            authorDisplay = `<div class="clickable-name" onclick="searchByCreator('${book.author.replace(/'/g, "\\'")}')">${escapeHTML(book.author)}</div>
                             <div class="sinhala-meta" lang="si">(${escapeHTML(book.authorSinhala)})</div>`;
        }

        // Translator Rendering
        let translatorHtml = '';
        if (book.translator || book.translatorSinhala) {
            let transDisplay = '';
            if (isSin && book.translatorSinhala) {
                transDisplay = `<div class="clickable-name" lang="si" onclick="searchByCreator('${book.translator.replace(/'/g, "\\'")}')">${escapeHTML(book.translatorSinhala)}</div>`;
            } else if (!isEng && book.translatorSinhala) {
                transDisplay = `<div class="clickable-name" onclick="searchByCreator('${book.translator.replace(/'/g, "\\'")}')">${escapeHTML(book.translator)}</div>
                                 <div class="sinhala-meta" lang="si">(${escapeHTML(book.translatorSinhala)})</div>`;
            } else {
                transDisplay = `<div class="clickable-name" onclick="searchByCreator('${book.translator.replace(/'/g, "\\'")}')">${escapeHTML(book.translator)}</div>`;
            }
            translatorHtml = `<div class="book-translator-row"><div class="meta-item"><div class="translator-label">Translated by</div> ${transDisplay}</div></div>`;
        } else {
            translatorHtml = '<div class="book-translator-row book-translator-empty"></div>';
        }

        const isLent = lendings.some(l => l.status === 'lent' && l.books.some(lb => lb.id === book.id));
        const lentBadge = isLent ? `<span class="lent-symbol" title="Currently Lent Out">🔒</span>` : '';

        return `
            <div class="book-card" data-id="${book.id}" data-category="${escapeHTML(book.category)}">
                <div class="book-id">
                    ${String(book.id).padStart(4, '0')}
                    ${lentBadge}
                </div>
                <div class="book-main">
                    ${titleDisplay}
                </div>
                <div class="book-author">${authorDisplay}</div>
                ${translatorHtml}
                <div class="book-meta">
                    <div class="meta-item" style="gap: 0.75rem;">
                        <span class="tag clickable" onclick="filterByCategory('${book.category.replace(/'/g, "\\'")}')">${escapeHTML(book.category)}</span>
                        <span class="tag" style="background: transparent; border: 1px solid var(--border-color);">${escapeHTML(book.language)}</span>
                    </div>
                </div>
                ${isEng ? '' : tagsHtml}
                <button class="edit-book-btn" data-id="${book.id}" title="Edit Book">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
            </div>
        `;
    }).join('');

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
function setupAutocomplete(inputId, dataField, listId, onSelect = null) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);
    if (!input || !list) return;

    const handleInput = () => {
        const val = input.value.trim().toLowerCase();

        if (!val) {
            list.style.display = 'none';
            return;
        }

        // Extract unique values for the field, handle arrays (like tags)
        let allVals = [];
        books.forEach(b => {
            const fieldVal = b[dataField];
            if (Array.isArray(fieldVal)) {
                allVals.push(...fieldVal);
            } else if (fieldVal) {
                allVals.push(fieldVal);
            }
        });

        const uniqueVals = [...new Set(allVals)];
        const matches = uniqueVals.filter(v => v.toLowerCase().includes(val)).slice(0, 5); // Limit 5

        if (matches.length > 0) {
            list.innerHTML = matches.map(m => `<li>${escapeHTML(m)}</li>`).join('');
            list.style.display = 'block';

            // Add click handlers
            list.querySelectorAll('li').forEach(li => {
                li.addEventListener('mousedown', (e) => {
                    // Use mousedown to trigger before blur
                    e.preventDefault();
                    const selectedValue = li.textContent;
                    if (onSelect) {
                        onSelect(selectedValue);
                    } else {
                        input.value = selectedValue;
                    }
                    list.style.display = 'none';
                });
            });
        } else {
            list.style.display = 'none';
        }
    };

    input.addEventListener('input', handleInput);

    input.addEventListener('focus', () => {
        if (input.value.trim()) handleInput();
    });

    // Close list when clicking outside or blur
    input.addEventListener('blur', () => {
        // Delay to allow mousedown on list items to fire
        setTimeout(() => {
            list.style.display = 'none';
        }, 200);
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

    // Show delete button if enabled and logged in
    const deleteBtn = document.getElementById('delete-book-btn');
    if (deleteBtn) {
        if (currentSettings.enableDelete && currentUser) {
            deleteBtn.classList.remove('hidden');
        } else {
            deleteBtn.classList.add('hidden');
        }
    }

    // Populate fields
    document.getElementById('book-name').value = book.name || '';
    document.getElementById('book-sinhala-name').value = book.sinhalaName || '';
    document.getElementById('book-author').value = book.author || '';
    document.getElementById('book-author-sinhala').value = book.authorSinhala || '';
    document.getElementById('book-translator').value = book.translator || '';
    document.getElementById('book-translator-sinhala').value = book.translatorSinhala || '';
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

    // Hide delete button
    const deleteBtn = document.getElementById('delete-book-btn');
    if (deleteBtn) deleteBtn.classList.add('hidden');
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

    // Switch to books tab
    const booksTab = document.querySelector('.tab-btn[data-target="view-books"]');
    if (booksTab) booksTab.click();

    // Set search and trigger filter
    const globalSearch = document.getElementById('global-search');
    if (globalSearch) {
        globalSearch.value = name;
        applyFilters();
    }

    // Scroll to top of catalog
    const controls = document.querySelector('.catalog-controls');
    if (controls) controls.scrollIntoView({ behavior: 'smooth' });
};

// ==========================================
// CSV Export Logic
// ==========================================
function exportToCsv() {
    if (filteredBooks.length === 0) {
        showToast("No data to export!");
        return;
    }

    const headers = ["ID", "Name", "Sinhala Name", "Author", "Author Sinhala Name", "Translator", "Translator Sinhala Name", "Language", "Category", "Tags"];

    const escapeCsv = (val) => {
        if (!val) return '""';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
    };

    const rows = filteredBooks.map(book => {
        return [
            book.id,
            escapeCsv(book.name),
            escapeCsv(book.sinhalaName || ''),
            escapeCsv(book.author),
            escapeCsv(book.authorSinhala || ''),
            escapeCsv(book.translator || ''),
            escapeCsv(book.translatorSinhala || ''),
            escapeCsv(book.language),
            escapeCsv(book.category),
            escapeCsv((book.tags || []).join(', '))
        ].join(',');
    });

    const csvContent = "\uFEFF" + [
        headers.join(','),
        ...rows
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "mimir_library_export.csv");
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
    reader.onload = async (event) => {
        const text = event.target.result;
        await parseCsvData(text);
        // Reset the file input so the same file can be imported again if needed
        importCsvFile.value = '';
    };
    reader.onerror = () => {
        showToast("Error reading the file.");
    };
    reader.readAsText(file);
}

async function parseCsvData(csvText) {
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
                authorSinhala: (bookRecord['author sinhala name'] || bookRecord['author_sinhala_name'] || bookRecord['authorsinhalaname'] || '').trim(),
                translator: translatorName,
                translatorSinhala: (bookRecord['translator sinhala name'] || bookRecord['translator_sinhala_name'] || bookRecord['translatorsinhalaname'] || '').trim(),
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

        if (!confirm(`You are about to import ${newBooks.length} books. This will REPLACE your existing book database.\n\nDo you want to proceed?`)) {
            showToast("Import cancelled.");
            return;
        }

        books = newBooks;
        const success = await saveData();
        if (!success) {
            showToast("Failed to save imported books to the cloud. They will not persist after refresh.");
            // Revert the books array if we want, but keeping them in UI might at least let them see what they imported.
        }

        populateFilterDropdowns();
        renderBooks();

        if (success) {
            showToast(`Successfully imported ${books.length} books!`);
            logActivity('import', `Imported ${books.length} books from CSV`);
        }

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

    // Total Translators
    const translators = new Set(books.map(b => b.translator).filter(b => b));
    const totalTranslators = translators.size;

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
    const translatorEl = document.getElementById('stat-total-translators');
    if (translatorEl) translatorEl.textContent = totalTranslators;
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

    // Top 20 leaderboards
    renderLeaderboard('stat-authors-list', 'author', 20);
    renderLeaderboard('stat-translators-list', 'translator', 20);

    // Lending Stats
    renderLendingSummaryStats();
}

function renderTagsDirectory() {
    const container = document.getElementById('tags-directory-container');
    if (!container) return;

    const tagCounts = {};
    books.forEach(b => {
        (b.tags || []).forEach(t => {
            tagCounts[t] = (tagCounts[t] || 0) + 1;
        });
    });

    const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);

    if (sortedTags.length === 0) {
        container.innerHTML = '<p class="empty-state">No tags found.</p>';
        return;
    }

    container.innerHTML = `
        <div class="tags-directory-list" style="display: flex; flex-wrap: wrap; gap: 0.75rem;">
            ${sortedTags.map(([tag, count]) => `
                <span class="book-tag-chip clickable" onclick="filterByTag('${tag.replace(/'/g, "\\'")}')" style="padding: 0.5rem 1rem; font-size: 0.85rem;">
                    ${escapeHTML(tag)} <span style="opacity: 0.6; margin-left: 0.4rem; font-size: 0.7rem;">${count}</span>
                </span>
            `).join('')}
        </div>
    `;
}

// ==========================================
// People Manager
// ==========================================
let currentPeopleField = 'author';
let allPeople = [];

window.showPeopleList = function (field) {
    currentPeopleField = field;
    window.isShowingMergeSuggestions = false;
    document.getElementById('show-authors-btn').className = field === 'author' ? 'btn btn-primary' : 'btn btn-secondary';
    document.getElementById('show-translators-btn').className = field === 'translator' ? 'btn btn-primary' : 'btn btn-secondary';
    renderPeopleList();
};

window.findMergeSuggestions = function () {
    window.isShowingMergeSuggestions = true;
    renderPeopleList();
};

window.filterPeopleList = function () {
    window.isShowingMergeSuggestions = false;
    renderPeopleList();
};

function renderPeopleList(silent = false) {
    const container = document.getElementById('people-list-container');
    const searchQuery = (document.getElementById('people-search').value || '').toLowerCase().trim();

    // Gather unique people with counts and Sinhala names
    const peopleMap = {};
    books.forEach(book => {
        const name = (book[currentPeopleField] || '').trim();
        if (!name) return;
        if (!peopleMap[name]) {
            peopleMap[name] = { name, count: 0, sinhalaName: book[`${currentPeopleField}Sinhala`] || '' };
        }
        peopleMap[name].count++;
    });

    let sortedPeople = Object.values(peopleMap);

    const sortValue = document.getElementById('people-sort') ? document.getElementById('people-sort').value : 'nameAsc';
    if (sortValue === 'nameAsc') {
        sortedPeople.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortValue === 'nameDesc') {
        sortedPeople.sort((a, b) => b.name.localeCompare(a.name));
    } else if (sortValue === 'countDesc') {
        sortedPeople.sort((a, b) => b.count - a.count);
    } else if (sortValue === 'sinAsc') {
        sortedPeople.sort((a, b) => a.sinhalaName.localeCompare(b.sinhalaName));
    }

    allPeople = sortedPeople;

    // If we're showing suggestions, filter the list to only near-duplicates
    if (window.isShowingMergeSuggestions) {
        const groups = {};
        allPeople.forEach(p => {
            const simplified = p.name.toLowerCase().replace(/[\s\.]/g, '');
            if (!groups[simplified]) groups[simplified] = [];
            groups[simplified].push(p);
        });
        const suggestionNames = new Set(Object.values(groups).filter(g => g.length > 1).flatMap(g => g.map(p => p.name)));
        allPeople = allPeople.filter(p => suggestionNames.has(p.name));

        if (!silent) {
            if (allPeople.length === 0) {
                showToast("No obvious near-duplicates found.");
                window.isShowingMergeSuggestions = false;
            } else {
                showToast(`Found ${allPeople.length} possible duplicates.`);
            }
        } else if (allPeople.length === 0) {
            window.isShowingMergeSuggestions = false;
        }
    }

    const filtered = searchQuery ? allPeople.filter(p => p.name.toLowerCase().includes(searchQuery) || p.sinhalaName.toLowerCase().includes(searchQuery)) : allPeople;

    if (filtered.length === 0) {
        container.innerHTML = `<p style="color:var(--text-secondary);">No ${currentPeopleField}s found.</p>`;
        return;
    }

    container.innerHTML = `
        <!-- Merge toolbar — shown when checkboxes are selected -->
        <div id="merge-toolbar" style="display:none; position:sticky; top:0; z-index:10; background:var(--surface-color); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:0.75rem 1rem; margin-bottom:1rem; flex-wrap:wrap; gap:0.75rem; align-items:flex-end; box-shadow:var(--shadow-md);">
            <div style="flex:none; align-self:center;">
                <span id="merge-selection-label" style="font-size:0.85rem; color:var(--text-secondary);">0 selected</span>
            </div>
            <div style="flex:1; min-width:200px; display:flex; flex-direction:column; gap:0.25rem;">
                <label style="font-size:0.75rem; color:var(--text-secondary); font-weight:600;">Merged English Name</label>
                <input type="text" id="merge-correct-name" placeholder="Type the CORRECT name..."
                    style="padding:0.4rem 0.75rem; border:1px solid var(--border-color); border-radius:var(--radius-md); background:var(--surface-color); color:var(--text-primary); font-size:0.9rem;" />
            </div>
            <div style="flex:1; min-width:200px; display:flex; flex-direction:column; gap:0.25rem;">
                <label style="font-size:0.75rem; color:var(--text-secondary); font-weight:600;">Merged Sinhala Name</label>
                <input type="text" id="merge-correct-sinhala" placeholder="Type the CORRECT Sinhala name..." lang="si"
                    style="padding:0.4rem 0.75rem; border:1px solid var(--border-color); border-radius:var(--radius-md); background:var(--surface-color); color:var(--text-primary); font-size:0.9rem;" />
            </div>
            <div style="display:flex; gap:0.5rem; align-self:flex-end;">
                <button class="btn btn-primary" style="background:#e05252; padding:0.4rem 1rem; font-size:0.85rem;" onclick="confirmCheckboxMerge()">✓ Merge Selected</button>
                <button class="btn btn-secondary" style="padding:0.4rem 0.8rem; font-size:0.85rem;" onclick="clearPeopleSelection()">✕ Clear</button>
            </div>
        </div>

        <div style="margin-bottom: 0.5rem; font-size: 0.8rem; color: var(--text-secondary);">
            ☑ Check rows to select duplicates, then type the correct names and click <strong>Merge Selected</strong>.
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
                        <input class="people-name-input" id="person-name-${i}" value="${escapeHTML(p.name)}" type="text" placeholder="English Name" />
                    </td>
                    <td>
                        <input class="people-name-input" id="person-sinhala-name-${i}" value="${escapeHTML(p.sinhalaName)}" type="text" lang="si" placeholder="සිංහල නම" />
                    </td>
                    <td style="text-align:center;"><strong>${p.count}</strong></td>
                    <td>
                        <button class="btn btn-primary" style="padding:0.3rem 0.6rem; font-size:0.8rem;" onclick="savePersonRow(${i}, '${p.name.replace(/'/g, "\\'")}')">Save</button>
                    </td>
                </tr>`).join('')}
            </tbody>
        </table>
    `;
}

window.savePersonRow = async function (index, originalName) {
    // Find Sinhala name field key
    const sinhalaKey = `${currentPeopleField}Sinhala`;
    const newName = document.getElementById(`person-name-${index}`).value.trim();
    const newSinhalaName = document.getElementById(`person-sinhala-name-${index}`).value.trim();

    if (!newName) {
        showToast("English name cannot be empty.");
        return;
    }

    let updated = 0;
    books.forEach(book => {
        if ((book[currentPeopleField] || '').trim() === originalName) {
            book[currentPeopleField] = newName;
            book[sinhalaKey] = newSinhalaName;
            updated++;
        }
    });

    if (updated > 0) {
        await saveData();
        showToast(`✅ Updated ${updated} book(s) to "${newName}".`);
        renderPeopleList();
        renderBooks(); // Assuming renderBooks() is the correct function to refresh the main book list
    } else {
        showToast('No books found for that person to update.');
    }
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
    renderPeopleList(true);
    applyFilters();
};

// ==========================================
// Browse by Tag / Category Links
// ==========================================
window.filterByTag = function (tag) {
    if (!globalSearch) return;
    globalSearch.value = tag;
    // Switch to collection view if not already there
    const collectionTab = document.querySelector('.tab-btn[data-target="view-books"]');
    if (collectionTab) collectionTab.click();
    applyFilters();
    showToast(`Filtering by tag: ${tag}`);
};

window.filterByCategory = function (category) {
    if (!filterCategory) return;
    filterCategory.value = category;
    // Clear search to focus on category
    if (globalSearch) globalSearch.value = '';
    // Switch to collection view if not already there
    const collectionTab = document.querySelector('.tab-btn[data-target="view-books"]');
    if (collectionTab) collectionTab.click();
    applyFilters();
    showToast(`Filtering by category: ${category}`);
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
    const correctSinhala = (document.getElementById('merge-correct-sinhala').value || '').trim();

    if (!correctName) {
        showToast('Please type the correct English name to merge into.');
        return;
    }

    const selectedNames = [...document.querySelectorAll('.person-cb:checked')].map(cb => cb.dataset.name);
    if (selectedNames.length === 0) {
        showToast('No rows selected.');
        return;
    }

    const sinhalaKey = `${currentPeopleField}Sinhala`;
    let totalMerged = 0;

    books.forEach(book => {
        if (selectedNames.includes((book[currentPeopleField] || '').trim())) {
            book[currentPeopleField] = correctName;
            book[sinhalaKey] = correctSinhala;
            totalMerged++;
        }
    });

    if (totalMerged === 0) {
        showToast('Nothing to merge.');
        return;
    }

    await saveData();
    showToast(`✅ Merged ${totalMerged} book(s) → "${correctName}".`);
    renderPeopleList(true);
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
        <div class="stat-leaderboard-row" style="cursor:pointer;" onclick="searchByCreator('${name.replace(/'/g, "\\'")}')" title="Click to filter by ${escapeHTML(name)}">
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
    { id: 'light', name: '☀️ Mimir Light', bg: '#fcfaf8', surface: '#ffffff', accent: '#8a5a44' },
    { id: 'dark', name: '🌙 Midnight Dark', bg: '#1a1817', surface: '#242120', accent: '#c28b72' },
    { id: 'sepia', name: '📜 Antique Sepia', bg: '#f4ecd8', surface: '#e9dec1', accent: '#a65d3b' },
    { id: 'nord', name: '❄️ Nordic Frost', bg: '#2e3440', surface: '#3b4252', accent: '#88c0d0' },
    { id: 'forest', name: '🌿 Emerald Forest', bg: '#1b2b1f', surface: '#243328', accent: '#56a85f' },
    { id: 'ocean', name: '🌊 Deep Ocean', bg: '#0d1b2a', surface: '#152233', accent: '#4d9de0' },
    { id: 'crimson', name: '🔴 Velvet Crimson', bg: '#1c0f12', surface: '#2b1519', accent: '#c0384a' },
    { id: 'purple', name: '🟣 Purple Night', bg: '#130d1f', surface: '#1e1430', accent: '#9d62d9' },
    { id: 'rosegold', name: '🌸 Sakura Blossom', bg: '#fff5f7', surface: '#ffffff', accent: '#c96b7e' },
    { id: 'cyber', name: '🎮 Cyberpunk', bg: '#000000', surface: '#121212', accent: '#f72585' },
    { id: 'oasis', name: '🏝️ Desert Oasis', bg: '#e9edc9', surface: '#fefae0', accent: '#2a9d8f' },
    { id: 'solarized', name: '🌅 Solarized', bg: '#002b36', surface: '#073642', accent: '#268bd2' },
    { id: 'dracula', name: '🧛 Dracula', bg: '#282a36', surface: '#363948', accent: '#ff79c6' },
    { id: 'tokyo', name: '🗼 Tokyo Night', bg: '#1a1b2e', surface: '#24253d', accent: '#7aa2f7' },
    { id: 'lavender', name: '🪻 Lavender Mist', bg: '#f8f8ff', surface: '#ffffff', accent: '#9370db' },
    { id: 'copper', name: '🧱 Copper Slate', bg: '#1c1c1c', surface: '#262626', accent: '#b87333' },
    { id: 'teal-dark', name: '🐋 Deep Teal', bg: '#001219', surface: '#002129', accent: '#94d2bd' },
    { id: 'ruby', name: '🍷 Royal Ruby', bg: '#1a0500', surface: '#2a0800', accent: '#d00000' },
    { id: 'slate-blue', name: '🏔️ Slate Blue', bg: '#1e293b', surface: '#334155', accent: '#38bdf8' },
    { id: 'gold-knight', name: '🏆 Golden Knight', bg: '#1a1817', surface: '#242120', accent: '#d4af37' },
    { id: 'mint-fresh', name: '🍃 Mint Fresh', bg: '#f0fff4', surface: '#ffffff', accent: '#3eb489' },
    { id: 'coffee-break', name: '☕ Coffee Break', bg: '#302b27', surface: '#3d3632', accent: '#a67c52' },
    { id: 'void', name: '🌌 Eternal Void', bg: '#050505', surface: '#111111', accent: '#6366f1' },
    { id: 'neon', name: '⚡ Neon Cyber', bg: '#0d0221', surface: '#1a0633', accent: '#00ff41' },
];

const FONTS = [
    // DEPRECATED: themes array merged into THEMES constant at line ~1500
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
    { family: 'Josefin Sans', name: 'Josefin Sans', preview: 'Aa' },
    { family: 'Quicksand', name: 'Quicksand', preview: 'Aa' },
    { family: 'Cabin', name: 'Cabin', preview: 'Aa' },
    { family: 'Raleway', name: 'Raleway', preview: 'Aa' },
    { family: 'Montserrat', name: 'Montserrat', preview: 'Aa' },
    { family: 'Noto Sans Sinhala', name: 'Noto Sinhala', preview: 'අ ශ් ම' },
];

let currentSettings = {
    theme: 'light',
    font: 'Inter',
    categoryColors: false,
    enableDelete: false
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
    loadGoogleFont(currentSettings.font);
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

    // Populate default theme select
    const defaultThemeSelect = document.getElementById('default-theme-select');
    if (defaultThemeSelect) {
        defaultThemeSelect.innerHTML = THEMES.map(t =>
            `<option value="${t.id}" ${t.id === (currentSettings.defaultTheme || 'light') ? 'selected' : ''}>${t.name}</option>`
        ).join('');
    }
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

function initSettings() {
    const saved = localStorage.getItem('mimir_settings');
    if (saved) {
        currentSettings = JSON.parse(saved);
    }
    // Sync with individual storage items to be robust
    const theme = localStorage.getItem('mimir_theme');
    if (theme) currentSettings.theme = theme;
}

function renderSettingsPage() {
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

    // Settings listeners (Search, Deletion, etc.)
    const toggle = document.getElementById('enable-delete-toggle');
    if (toggle) {
        toggle.checked = currentSettings.enableDelete;
        document.getElementById('enable-delete-label').textContent = currentSettings.enableDelete ? "Enabled" : "Disabled";
    }

    // Sync sliders for font sizes
    const types = ['id', 'title', 'sinhala', 'author', 'authorSin', 'translator', 'translatorSin'];
    types.forEach(type => {
        const key = FONT_SIZE_KEY_MAP[type];
        const val = currentSettings[key] || DEFAULT_FONT_SIZES[key];
        const slider = document.getElementById(`slider-${type}-size`);
        const label = document.getElementById(`lbl-${type}-size`);
        if (slider) slider.value = val;
        if (label) label.textContent = `${val}px`;
    });
}

// Settings Event Listeners
document.querySelectorAll('.tab-btn[data-target="view-settings"]').forEach(btn => {
    btn.addEventListener('click', () => renderSettingsPage());
});

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
    authorSinSize: 14,
    translatorSize: 13,
    translatorSinSize: 13,
};

const FONT_SIZE_PROPS = {
    idSize: '--user-id-size',
    titleSize: '--user-title-size',
    sinhalaSize: '--user-sinhala-size',
    authorSize: '--user-author-size',
    authorSinSize: '--user-author-sin-size',
    translatorSize: '--user-translator-size',
    translatorSinSize: '--user-translator-sin-size',
};

const FONT_SIZE_KEY_MAP = {
    id: 'idSize',
    title: 'titleSize',
    sinhala: 'sinhalaSize',
    author: 'authorSize',
    authorSin: 'authorSinSize',
    translator: 'translatorSize',
    translatorSin: 'translatorSinSize',
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

// --- Library Management ---

window.toggleEnableDelete = function (enabled) {
    if (enabled && !currentUser) {
        showToast("Access Denied: Please login to enable deletion.");
        document.getElementById('enable-delete-toggle').checked = false;
        return;
    }
    currentSettings.enableDelete = enabled;
    saveSettings();
    document.getElementById('enable-delete-label').textContent = enabled ? "Enabled" : "Disabled";
    showToast(`Book deletion ${enabled ? 'enabled' : 'disabled'}.`);

    // If currently editing, update the delete button visibility
    const deleteBtn = document.getElementById('delete-book-btn');
    if (deleteBtn) {
        if (isEditing && enabled && currentUser) {
            deleteBtn.classList.remove('hidden');
        } else {
            deleteBtn.classList.add('hidden');
        }
    }
}

async function deleteBook() {
    const id = parseInt(document.getElementById('edit-book-id').value, 10);
    const book = books.find(b => b.id === id);

    if (!book) return;
    if (!currentUser) return showToast("Login required to delete.");
    if (!currentSettings.enableDelete) return showToast("Deletion is disabled in settings.");

    if (confirm(`Are you sure you want to delete "${book.name || 'this book'}" permanently?`)) {
        try {
            await deleteDoc(doc(db, "books", String(id)));
            books = books.filter(b => b.id !== id);
            showToast("Book deleted successfully.");
            resetForm();
            populateFilterDropdowns();
            renderBooks();
            tabBtns[0].click();
        } catch (error) {
            console.error("Error deleting book:", error);
            showToast("Failed to delete book.");
        }
    }
}

window.flushAllBooks = async function () {
    if (!currentUser) return showToast('Login required.');
    if (!document.body.classList.contains('is-admin')) return showToast('Admin access required.');

    if (!confirm('⚠️ WARNING: This will permanently delete ALL books from the collection.\n\nLending records will NOT be affected.\n\nAre you sure?')) return;
    if (!confirm('🔴 FINAL CONFIRMATION: This action CANNOT be undone.\n\nType OK to proceed.')) return;

    try {
        showToast('Flushing all books...');
        const querySnapshot = await getDocs(collection(db, "books"));
        const batchSize = 500;
        const docs = querySnapshot.docs;

        for (let i = 0; i < docs.length; i += batchSize) {
            const batch = writeBatch(db);
            docs.slice(i, i + batchSize).forEach(d => batch.delete(d.ref));
            await batch.commit();
        }

        books = [];
        filteredBooks = [];
        currentPage = 1;
        populateFilterDropdowns();
        renderBooks();
        showToast(`✅ All ${docs.length} books have been deleted.`);
    } catch (error) {
        console.error('Error flushing books:', error);
        showToast('Failed to flush books: ' + error.message);
    }
};

// --- Lending Logic ---

window.resetLendingForm = function () {
    const form = document.getElementById('add-lending-form');
    if (form) form.reset();
    lendingSelectedBooks = [];
    renderLendingBooks();
}

window.updateLendingAutocomplete = function (query) {
    const resultsContainer = document.getElementById('lending-search-results');
    if (!query || !query.trim()) {
        resultsContainer.style.display = 'none';
        return;
    }

    const q = query.toLowerCase().trim();
    const matched = books.filter(b => {
        const idStr = String(b.id || '').toLowerCase();
        const nameStr = (b.name || '').toLowerCase();

        const idMatch = idStr.includes(q);
        const nameMatch = nameStr.includes(q);

        const isAlreadySelected = lendingSelectedBooks.some(s => String(s.id) === String(b.id));
        const isLent = lendings.some(l => l.status === 'lent' && l.books.some(lb => String(lb.id) === String(b.id)));

        return (idMatch || nameMatch) && !isAlreadySelected && !isLent;
    }).slice(0, 10);

    if (matched.length === 0) {
        resultsContainer.style.display = 'none';
        return;
    }

    resultsContainer.innerHTML = matched.map(b => `
        <li onclick="addLendingBook('${b.id}')">
            <strong>#${b.id}</strong> - ${escapeHTML(b.name)}
        </li>
    `).join('');
    resultsContainer.style.display = 'block';
}

window.addLendingBook = function (id) {
    const book = books.find(b => String(b.id) === String(id));
    if (book) {
        lendingSelectedBooks.push(book);
        renderLendingBooks();
        document.getElementById('lending-book-search').value = '';
        document.getElementById('lending-search-results').style.display = 'none';
    }
}

window.removeLendingBook = function (index) {
    lendingSelectedBooks.splice(index, 1);
    renderLendingBooks();
}

function renderLendingBooks() {
    const wrapper = document.getElementById('lending-books-wrapper');
    const input = document.getElementById('lending-book-search');

    // Remove old chips
    wrapper.querySelectorAll('.tag-chip').forEach(c => c.remove());

    // Add new chips
    lendingSelectedBooks.forEach((book, index) => {
        const span = document.createElement('span');
        span.className = 'tag-chip';
        span.innerHTML = `
            #${book.id}
            <button type="button" class="tag-remove" onclick="removeLendingBook(${index})">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        `;
        wrapper.insertBefore(span, input);
    });
}

window.filterLendingByBorrower = function (name) {
    const searchInput = document.getElementById('lending-search');
    if (searchInput) {
        searchInput.value = name;
        renderLendingPage();
    }
}

function renderLendingPage() {
    const activeContainer = document.getElementById('active-lendings-table-container');
    const historyContainer = document.getElementById('returned-lendings-table-container');
    const searchInput = document.getElementById('lending-search');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

    let active = lendings.filter(l => l.status === 'lent').sort((a, b) => new Date(b.lendDate) - new Date(a.lendDate));
    let history = lendings.filter(l => l.status === 'returned').sort((a, b) => new Date(b.returnDate) - new Date(a.returnDate));

    if (query) {
        active = active.filter(l => l.borrower.toLowerCase().includes(query));
        history = history.filter(l => l.borrower.toLowerCase().includes(query));
    }

    activeContainer.innerHTML = renderLendingTable(active, true);
    historyContainer.innerHTML = renderLendingTable(history, false);
}

function renderLendingTable(data, isActive) {
    if (data.length === 0) return `<p class="empty-state">No records found.</p>`;

    return `
        <table class="lending-table">
            <thead>
                <tr>
                    <th>Borrower</th>
                    <th>Books</th>
                    <th>Date</th>
                    ${isActive ? '<th>Wait Time</th>' : '<th>Returned</th>'}
                    ${isActive ? '<th>Action</th>' : ''}
                </tr>
            </thead>
            <tbody>
                ${data.map(l => {
        const days = isActive ? Math.floor((new Date() - new Date(l.lendDate)) / (1000 * 60 * 60 * 24)) : 0;
        const dayClass = days > 30 ? 'days-high' : days > 14 ? 'days-med' : 'days-low';

        return `
                    <tr>
                        <td style="font-weight:600; cursor:pointer;" onclick="filterLendingByBorrower('${escapeHTML(l.borrower).replace(/'/g, "\\'")}')" title="Click to see all history for ${escapeHTML(l.borrower)}">${escapeHTML(l.borrower)}</td>
                        <td>
                            <div class="lending-books-list">
                                ${l.books.map(b => `
                                    <div class="lending-book-item ${b.returned ? 'returned' : ''}">
                                        <div style="display:flex; align-items:center; gap:0.5rem; justify-content:space-between; width:100%;">
                                            <span><span class="lending-book-id">#${b.id}</span> ${escapeHTML(b.name)}</span>
                                            <div style="display:flex; align-items:center; gap:0.5rem;">
                                                ${(() => {
                if (b.returned && b.returnDate) {
                    return `<span style="font-size:0.7rem; color:var(--text-secondary); white-space:nowrap;">returned ${b.returnDate}</span>`;
                } else if (isActive && !b.returned) {
                    const bookDays = Math.floor((new Date() - new Date(l.lendDate)) / (1000 * 60 * 60 * 24));
                    const bookDayClass = bookDays > 30 ? 'days-high' : bookDays > 14 ? 'days-med' : 'days-low';
                    return `<span class="days-count ${bookDayClass}" style="font-size:0.7rem; padding:0.15rem 0.4rem;">${bookDays}d</span>`;
                }
                return '';
            })()}
                                                ${(isActive && !b.returned) ? `<button class="btn-icon-tiny" title="Return this book" onclick="markReturned('${l.id}', ${b.id})">↩️</button>` : ''}
                                            </div>
                                        </div>
                                    </div>`).join('')}
                            </div>
                        </td>
                        <td style="font-size:0.85rem;">${l.lendDate}</td>
                        <td>
                            ${isActive ? `<span class="days-count ${dayClass}">${days} days</span>` : `<span style="font-size:0.85rem;">${l.returnDate}</span>`}
                        </td>
                        <td>
                            <div style="display:flex; gap:0.5rem;">
                                ${isActive ? `<button class="btn btn-secondary btn-return auth-required" onclick="markReturned('${l.id}')">Return All</button>` : ''}
                                <button class="btn btn-icon auth-required" title="Delete record" onclick="deleteLendingRecord('${l.id}')">
                                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                                </button>
                            </div>
                        </td>
                    </tr>
                `}).join('')}
            </tbody>
        </table>
    `;
}

function renderLendingSummaryStats() {
    const container = document.getElementById('stat-lending-summary');
    if (!container) return;

    const activeLendings = lendings.filter(l => l.status === 'lent');
    const totalLentBooks = activeLendings.reduce((sum, l) => sum + l.books.length, 0);

    // Borrower Stats
    const borrowerCounts = {};
    activeLendings.forEach(l => {
        borrowerCounts[l.borrower] = (borrowerCounts[l.borrower] || 0) + l.books.length;
    });

    const topBorrowers = Object.entries(borrowerCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    const today = new Date();

    container.innerHTML = `
        <div class="stat-card" style="background:var(--accent-light); padding:1rem; border-radius:8px; text-align:center;">
            <div style="font-size:0.9rem; color:var(--accent-primary); font-weight:600;">Currently Lent</div>
            <div style="font-size:2rem; font-weight:700; color:var(--accent-primary); margin:0.5rem 0;">${totalLentBooks}</div>
            <div style="font-size:0.8rem; color:var(--text-secondary);">Total books out of library</div>
        </div>
        <div style="flex:2;">
            <h4 style="margin:0 0 1rem 0; font-size:0.9rem; color:var(--text-secondary);">Active Borrowers & Duration</h4>
            <div class="stat-leaderboard" style="max-height: 300px; overflow-y: auto;">
                ${topBorrowers.map(([name, count]) => {
        const borrowerLending = activeLendings.find(l => l.borrower === name);
        const lendDate = borrowerLending ? new Date(borrowerLending.lendDate) : today;
        const diffDays = Math.floor((today - lendDate) / (1000 * 60 * 60 * 24));

        return `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:0.6rem 0; border-bottom:1px solid var(--border-color); font-size:14px;">
                        <div>
                            <span style="font-weight:600;">${escapeHTML(name)}</span>
                            <div style="font-size:0.75rem; color:var(--text-secondary);">${diffDays} days since lend date</div>
                        </div>
                        <span style="font-weight:700; color:var(--accent-primary);">${count} Books</span>
                    </div>`;
    }).join('')}
                ${topBorrowers.length === 0 ? '<p style="color:var(--text-secondary); font-size:0.85rem;">No active borrowers.</p>' : ''}
            </div>
        </div>
    `;
}

// --- Lending CSV Export / Import ---

window.exportLendingCsv = function () {
    if (lendings.length === 0) return showToast('No lending records to export.');

    const escapeCsv = (val) => {
        if (!val) return '';
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };

    const headers = ['LendingID', 'Borrower', 'LendDate', 'Status', 'ReturnDate', 'BookID', 'BookName', 'BookReturned', 'BookReturnDate'];
    const rows = [headers.join(',')];

    lendings.forEach(l => {
        l.books.forEach(b => {
            rows.push([
                escapeCsv(l.id),
                escapeCsv(l.borrower),
                escapeCsv(l.lendDate),
                escapeCsv(l.status),
                escapeCsv(l.returnDate || ''),
                escapeCsv(b.id),
                escapeCsv(b.name),
                b.returned ? 'true' : 'false',
                escapeCsv(b.returnDate || '')
            ].join(','));
        });
    });

    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mimir_lendings_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${lendings.length} lending records.`);
};

window.handleLendingCsvImport = function (e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!currentUser) return showToast('Login required to import.');

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const text = event.target.result;
            const lines = text.split(/\r?\n/).filter(l => l.trim());
            if (lines.length < 2) return showToast('CSV file is empty or invalid.');

            const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
            const idxMap = {};
            headers.forEach((h, i) => idxMap[h] = i);

            const required = ['LendingID', 'Borrower', 'LendDate', 'Status', 'BookID', 'BookName'];
            const missing = required.filter(r => !(r in idxMap));
            if (missing.length > 0) {
                return showToast(`Missing columns: ${missing.join(', ')}`);
            }

            const lendingMap = {};
            for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].match(/("(?:[^"]|"")*"|[^,]*)/g) || [];
                const clean = cols.map(c => c.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));

                const lendId = clean[idxMap['LendingID']];
                if (!lendId) continue;

                if (!lendingMap[lendId]) {
                    lendingMap[lendId] = {
                        id: lendId,
                        borrower: clean[idxMap['Borrower']] || '',
                        lendDate: clean[idxMap['LendDate']] || '',
                        status: clean[idxMap['Status']] || 'lent',
                        returnDate: (idxMap['ReturnDate'] !== undefined ? clean[idxMap['ReturnDate']] : '') || '',
                        books: [],
                        createdAt: new Date().toISOString()
                    };
                }

                lendingMap[lendId].books.push({
                    id: parseInt(clean[idxMap['BookID']], 10) || 0,
                    name: clean[idxMap['BookName']] || '',
                    returned: ((idxMap['BookReturned'] !== undefined ? clean[idxMap['BookReturned']] : '') || '').toLowerCase() === 'true',
                    returnDate: (idxMap['BookReturnDate'] !== undefined ? clean[idxMap['BookReturnDate']] : '') || ''
                });
            }

            const newRecords = Object.values(lendingMap);
            if (newRecords.length === 0) return showToast('No valid lending records found in CSV.');

            const existingIds = new Set(lendings.map(l => l.id));
            const toImport = newRecords.filter(r => !existingIds.has(r.id));
            const skipped = newRecords.length - toImport.length;

            showToast(`Importing ${toImport.length} lending records...`);

            for (const record of toImport) {
                const docRef = doc(db, "lendings", record.id);
                await setDoc(docRef, record);
                lendings.push(record);
            }

            renderLendingPage();
            showToast(`✅ Imported ${toImport.length} records.${skipped > 0 ? ` ${skipped} duplicates skipped.` : ''}`);
        } catch (err) {
            console.error('Lending CSV import error:', err);
            showToast('Failed to import lending CSV: ' + err.message);
        }
    };
    reader.readAsText(file);
    e.target.value = '';
};

// --- New Auth UI & User Management ---

window.toggleLoginModal = function (show) {
    const modal = document.getElementById('login-modal');
    if (modal) modal.style.display = show ? 'flex' : 'none';
}

window.handleLoginSubmit = async function (e) {
    e.preventDefault();
    const user = document.getElementById('login-username').value;
    const pass = document.getElementById('login-password').value;
    const success = await signIn(user, pass);
    if (success) {
        toggleLoginModal(false);
        document.getElementById('login-form').reset();
    }
}

window.toggleUserMgmtModal = async function (show) {
    const modal = document.getElementById('user-mgmt-modal');
    if (modal) modal.style.display = show ? 'flex' : 'none';
    if (show) {
        showUserTab('list');
        await refreshUserList();
    }
}

window.showUserTab = function (tab) {
    const listTab = document.getElementById('user-list-view');
    const createTab = document.getElementById('user-create-view');
    const listBtn = document.getElementById('user-tab-list');
    const createBtn = document.getElementById('user-tab-create');

    if (tab === 'list') {
        listTab.style.display = 'block';
        createTab.style.display = 'none';
        listBtn.classList.add('active');
        createBtn.classList.remove('active');
    } else {
        listTab.style.display = 'none';
        createTab.style.display = 'block';
        listBtn.classList.remove('active');
        createBtn.classList.add('active');
    }
}

async function refreshUserList() {
    const container = document.getElementById('users-table-container');
    container.innerHTML = '<p class="loading">Loading users...</p>';

    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        const usersList = [];
        querySnapshot.forEach(doc => usersList.push({ id: doc.id, ...doc.data() }));

        if (usersList.length === 0) {
            container.innerHTML = '<p>No users found.</p>';
            return;
        }

        container.innerHTML = `
            <table class="user-mgmt-table">
                <thead>
                    <tr>
                        <th>Username</th>
                        <th>Role</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${usersList.map(u => `
                        <tr>
                            <td><strong>${escapeHTML(u.username)}</strong></td>
                            <td><span class="role-badge role-${u.role}">${u.role}</span></td>
                            <td>
                                ${u.username !== 'admin' ? `
                                    <button class="btn btn-secondary" style="font-size:0.75rem; padding:0.25rem 0.5rem;" onclick="promptResetPassword('${u.id}', '${u.username}')">Reset Pass</button>
                                ` : '<span style="color:var(--text-secondary); font-size:0.8rem;">Root</span>'}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (e) {
        console.error("Failed to fetch users:", e);
        container.innerHTML = '<p class="error">Error loading users.</p>';
    }
}

window.promptResetPassword = async function (uid, username) {
    if (!confirm(`Are you sure you want to send a password reset email to ${username}?`)) return;

    try {
        const email = getMimirEmail(username);
        await sendPasswordResetEmail(auth, email);
        showToast(`Password reset email sent to ${email}. Note: If this is a @mimir.local address, the user cannot receive it.`);
    } catch (e) {
        console.error("Failed to send reset email:", e);
        showToast("Error sending reset email: " + e.message);
    }
}

window.handleCreateUser = async function (e) {
    e.preventDefault();
    const user = document.getElementById('new-username').value.trim();
    const pass = document.getElementById('new-password').value;
    const role = document.getElementById('new-role').value;

    if (!user || pass.length < 6) return showToast("Invalid username or short password.");

    try {
        showToast("Creating user...");
        const email = getMimirEmail(user);

        // Use secondaryAuth so the admin does not get logged out
        const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, pass);

        await setDoc(doc(db, "users", userCredential.user.uid), {
            username: user,
            role: role,
            createdAt: new Date().toISOString()
        });

        await signOut(secondaryAuth);

        showToast("User created successfully!");
        toggleUserMgmtModal(false);
        await refreshUserList();
    } catch (e) {
        console.error("Failed to create user:", e);
        showToast("Failed to create user: " + e.message);
    }
}

// ==========================================
// Tag Management
// ==========================================
window.toggleTagMgmtModal = function (show) {
    const modal = document.getElementById('tag-mgmt-modal');
    if (modal) modal.style.display = show ? 'flex' : 'none';
}

window.openTagMgmtModal = function () {
    toggleTagMgmtModal(true);
    renderTagList();
}

function renderTagList() {
    const container = document.getElementById('tags-table-container');
    if (!container) return;

    const tagCounts = {};
    books.forEach(b => {
        (b.tags || []).forEach(t => {
            const tag = t.trim();
            if (tag) {
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            }
        });
    });

    const sortedTags = Object.entries(tagCounts).sort((a, b) => a[0].localeCompare(b[0]));

    if (sortedTags.length === 0) {
        container.innerHTML = '<p class="empty-state">No tags found.</p>';
        return;
    }

    container.innerHTML = `
        <div style="width: 100%; overflow-x: auto;">
            <table class="user-mgmt-table" style="width: 100%; text-align: left;">
                <thead>
                    <tr>
                        <th>Tag Name</th>
                        <th>Count</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${sortedTags.map(([tag, count]) => `
                        <tr>
                            <td><span class="book-tag-chip" style="margin:0;">${escapeHTML(tag)}</span></td>
                            <td>${count}</td>
                            <td style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                                <button class="btn btn-secondary" style="font-size:0.75rem; padding:0.4rem 0.6rem;" onclick="renameTag('${tag.replace(/'/g, "\\'")}')">Rename</button>
                                <button class="btn btn-danger" style="font-size:0.75rem; padding:0.4rem 0.6rem;" onclick="deleteTag('${tag.replace(/'/g, "\\'")}')">Delete</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

window.renameTag = async function (oldTag) {
    const newTag = prompt(`Enter new name for tag "${oldTag}":`, oldTag);
    if (!newTag || newTag.trim() === '' || newTag === oldTag) return;

    const finalTag = newTag.trim();
    let updatedBooksCount = 0;

    books.forEach(b => {
        if (b.tags && b.tags.includes(oldTag)) {
            // Replace the old tag with the new one
            b.tags = b.tags.map(t => t === oldTag ? finalTag : t);
            // Remove duplicates just in case the new tag already existed
            b.tags = [...new Set(b.tags)];
            updatedBooksCount++;
        }
    });

    if (updatedBooksCount > 0) {
        showToast(`Renaming tag in ${updatedBooksCount} books...`);
        await saveData();
        showToast("Tag renamed successfully.");
        renderTagList();
        applyFilters(); // Re-render books in UI
        updateFilterDropdowns(); // Update tag suggestions if any
    }
}

window.deleteTag = async function (tag) {
    if (!confirm(`Are you sure you want to delete the tag "${tag}" from all books?`)) return;

    let updatedBooksCount = 0;

    books.forEach(b => {
        if (b.tags && b.tags.includes(tag)) {
            b.tags = b.tags.filter(t => t !== tag);
            updatedBooksCount++;
        }
    });

    if (updatedBooksCount > 0) {
        showToast(`Deleting tag from ${updatedBooksCount} books...`);
        await saveData();
        showToast("Tag deleted successfully.");
        renderTagList();
        applyFilters();
        updateFilterDropdowns();
    }
}

// ==========================================
// Category Management
// ==========================================
window.toggleCategoryMgmtModal = function (show) {
    const modal = document.getElementById('category-mgmt-modal');
    if (modal) modal.style.display = show ? 'flex' : 'none';
};

window.openCategoryMgmtModal = function () {
    toggleCategoryMgmtModal(true);
    renderCategoryList();
};

function renderCategoryList() {
    const container = document.getElementById('categories-table-container');
    if (!container) return;

    const catCounts = {};
    books.forEach(b => {
        const cat = (b.category || '').trim();
        if (cat) catCounts[cat] = (catCounts[cat] || 0) + 1;
    });

    const sortedCats = Object.entries(catCounts).sort((a, b) => a[0].localeCompare(b[0]));

    if (sortedCats.length === 0) {
        container.innerHTML = '<p class="empty-state">No categories found.</p>';
        return;
    }

    container.innerHTML = `
        <div style="margin-bottom:1rem;">
            <div style="display:flex; gap:0.5rem;">
                <input type="text" id="new-category-input" placeholder="New category name..." style="flex:1; padding:0.5rem 0.75rem; border:1px solid var(--border-color); border-radius:var(--radius-md); background:var(--surface-color); color:var(--text-primary);">
                <button class="btn btn-primary" onclick="addNewCategory()" style="font-size:0.85rem;">Add</button>
            </div>
        </div>
        <div style="width: 100%; overflow-x: auto;">
            <table class="user-mgmt-table" style="width: 100%; text-align: left;">
                <thead>
                    <tr>
                        <th>Category Name</th>
                        <th>Books</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${sortedCats.map(([cat, count]) => `
                        <tr>
                            <td><strong>${escapeHTML(cat)}</strong></td>
                            <td>${count}</td>
                            <td style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                                <button class="btn btn-secondary" style="font-size:0.75rem; padding:0.4rem 0.6rem;" onclick="renameCategory('${cat.replace(/'/g, "\\'")}')">Rename</button>
                                <button class="btn btn-danger" style="font-size:0.75rem; padding:0.4rem 0.6rem;" onclick="deleteCategory('${cat.replace(/'/g, "\\'")}')">Delete</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

window.addNewCategory = function () {
    const input = document.getElementById('new-category-input');
    const name = (input.value || '').trim();
    if (!name) return showToast('Category name cannot be empty.');

    // Check if already exists
    const exists = books.some(b => (b.category || '').toLowerCase() === name.toLowerCase());
    if (exists) return showToast('Category already exists in the library.');

    // Add to the select dropdown in the form
    const select = document.getElementById('book-category');
    if (select) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
    }

    input.value = '';
    showToast(`Category "${name}" added to the dropdown.`);
    renderCategoryList();
};

window.renameCategory = async function (oldCat) {
    const newCat = prompt(`Enter new name for category "${oldCat}":`, oldCat);
    if (!newCat || newCat.trim() === '' || newCat === oldCat) return;

    const finalCat = newCat.trim();
    let updated = 0;

    books.forEach(b => {
        if ((b.category || '') === oldCat) {
            b.category = finalCat;
            updated++;
        }
    });

    if (updated > 0) {
        showToast(`Renaming category in ${updated} books...`);
        await saveData();
        showToast('Category renamed successfully.');
        renderCategoryList();
        populateFilterDropdowns();
        applyFilters();
    }
};

window.deleteCategory = async function (cat) {
    const replacement = prompt(`Delete category "${cat}"?\n\nEnter a replacement category for the ${books.filter(b => b.category === cat).length} affected books (or leave blank to set to "Uncategorized"):`);
    if (replacement === null) return; // cancelled

    const newCat = replacement.trim() || 'Uncategorized';
    let updated = 0;

    books.forEach(b => {
        if ((b.category || '') === cat) {
            b.category = newCat;
            updated++;
        }
    });

    if (updated > 0) {
        await saveData();
        showToast(`Moved ${updated} books from "${cat}" to "${newCat}".`);
        renderCategoryList();
        populateFilterDropdowns();
        applyFilters();
    }
};

// ==========================================
// Compact View
// ==========================================
window.setViewMode = function (mode) {
    const grid = document.getElementById('books-grid');
    grid.classList.remove('books-grid', 'books-list', 'books-compact');

    document.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.remove('active'));

    if (mode === 'grid') {
        grid.classList.add('books-grid');
    } else if (mode === 'list') {
        grid.classList.add('books-list');
    } else if (mode === 'compact') {
        grid.classList.add('books-compact');
    }

    const activeBtn = document.getElementById(`btn-${mode}-view`);
    if (activeBtn) activeBtn.classList.add('active');

    localStorage.setItem('mimir_view', mode);
};

// ==========================================
// Default Theme Selection
// ==========================================
window.setDefaultTheme = function (themeId) {
    currentSettings.defaultTheme = themeId;
    saveSettings();
    showToast(`Default theme set to "${THEMES.find(t => t.id === themeId)?.name || themeId}".`);
};

window.resetToDefaultTheme = function () {
    const defaultThemeId = currentSettings.defaultTheme || 'light';
    setTheme(defaultThemeId);
    setFont('Inter');
    showToast('Theme reset to default.');
};

// ==========================================
// Activity Log
// ==========================================
window.logActivity = function (action, details) {
    let logs = [];
    try {
        logs = JSON.paste(localStorage.getItem('mimir_activity_logs') || '[]');
    } catch (e) { }

    logs.unshift({
        timestamp: new Date().toISOString(),
        action,
        details
    });

    if (logs.length > 500) logs = logs.slice(0, 500); // Keep last 500
    localStorage.setItem('mimir_activity_logs', JSON.stringify(logs));
};

// ==========================================
// Print Catalog
// ==========================================
window.printCatalog = function () {
    // We will use native print. CSS media print queries will format it.
    showToast("Opening print dialog...");
    window.print();
};


