// ─── State ────────────────────────────────────────────────────────────────────
// Application state: holds live images shown in the gallery, generation
// history persisted to sessionStorage, and a flag indicating whether
// a generation operation is in progress.
const state = {
  images: [],        // { id, url, prompt, model, timestamp }
  history: [],       // same structure, persisted in sessionStorage
  generating: false,
};

// ─── DOM Refs ─────────────────────────────────────────────────────────────────
// Cache frequently-used DOM elements to avoid querying the document
// repeatedly. These references are used throughout the UI update logic.
const promptEl        = document.querySelector('textarea');
const modelSelect     = document.querySelectorAll('select')[0];
const countSelect     = document.querySelectorAll('select')[1];
const ratioSelect     = document.querySelectorAll('select')[2];
const generateBtn     = document.querySelector('button[class*="Generate"], button span');
const generateBtnEl   = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Generate'));
const gallerySection  = document.querySelector('.lg\\:col-span-8');
const imageCountBadge = gallerySection.querySelector('span.bg-gray-800');
const clearAllBtn     = gallerySection.querySelector('button');
const galleryBox      = gallerySection.querySelector('.min-h-\\[450px\\]');
const historyBtn      = [...document.querySelectorAll('button')].find(b => b.textContent.includes('History'));
const diceBtn         = document.querySelector('#dice-btn');
// Theme toggle button (header)
const themeToggleBtn  = document.getElementById('theme-toggle');

function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.classList.add('light');
    try {
      if (themeToggleBtn) themeToggleBtn.querySelector('i')?.setAttribute('data-lucide', 'sun');
    } catch (_) {}
  } else {
    document.documentElement.classList.remove('light');
    try {
      if (themeToggleBtn) themeToggleBtn.querySelector('i')?.setAttribute('data-lucide', 'moon');
    } catch (_) {}
  }
  try { lucide.createIcons(); } catch (_) {}
  try { localStorage.setItem('theme', theme); } catch (_) {}
}

if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    const current = document.documentElement.classList.contains('light') ? 'light' : 'dark';
    const next = current === 'light' ? 'dark' : 'light';
    applyTheme(next);
  });
}

// ─── Aspect Ratio → dimensions ────────────────────────────────────────────────
// Map human-readable aspect ratios to concrete pixel dimensions used when
// requesting or sizing images (used for Unsplash source URLs and layout).
const RATIO_MAP = {
  '1:1':  { w: 1024, h: 1024 },
  '16:9': { w: 1280, h: 720  },
  '9:16': { w: 720,  h: 1280 },
  '4:3':  { w: 1024, h: 768  },
};

// ─── Model → Pollinations style hint ──────────────────────────────────────────
// Hints used to append model/style keywords to the prompt when building
// remote image queries. Kept for compatibility with older polling logic.
const MODEL_HINTS = {
  flux:       'flux',
  sdxl:       'stable-diffusion',
  dalle3:     'dalle',
  midjourney: 'midjourney',
  realistic:  'realistic-vision',
  anime:      'anime',
};

// A small pool of static image URLs used as a fallback when prompt-based
// image fetches fail. These are direct image links (Unsplash) and serve
// as a reliable fallback for previews and testing.
const IMAGE_URLS = [
  'https://images.unsplash.com/photo-1443926818681-717d074a57af?q=80&w=580&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
  'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=80&w=580&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1493246507139-91e8fad9978e?q=80&w=580&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1519681393784-d120267933ba?q=80&w=580&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?q=80&w=580&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?q=80&w=580&auto=format&fit=crop'
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
// ─── Helpers ──────────────────────────────────────────────────────────────────
// Small utility functions used across the app (ID generation, history
// persistence, UI helpers).

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

// createFallbackPreview(prompt, model)
// Returns a small SVG data-URL used as a local preview when remote
// image fetching fails (keeps the gallery looking populated).
function createFallbackPreview(prompt, model) {
  const safePrompt = String(prompt || 'Image preview').replace(/[<>&]/g, '');
  const safeModel = String(model || 'model').replace(/[<>&]/g, '');
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#121420" />
          <stop offset="100%" stop-color="#1f2540" />
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" rx="64" fill="url(#bg)"/>
      <circle cx="180" cy="180" r="120" fill="#24304d" opacity="0.65"/>
      <circle cx="860" cy="840" r="160" fill="#2a3356" opacity="0.5"/>
      <text x="80" y="420" fill="#f8fafc" font-family="Arial, Helvetica, sans-serif" font-size="48" font-weight="700">Preview unavailable</text>
      <text x="80" y="490" fill="#cbd5e1" font-family="Arial, Helvetica, sans-serif" font-size="28">${safePrompt.slice(0, 72)}</text>
      <text x="80" y="548" fill="#94a3b8" font-family="Arial, Helvetica, sans-serif" font-size="24">Model: ${safeModel}</text>
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function saveHistory() {
  try {
    sessionStorage.setItem('img_history', JSON.stringify(state.history));
  } catch (_) {}
}

function loadHistory() {
  try {
    const raw = sessionStorage.getItem('img_history');
    if (raw) state.history = JSON.parse(raw);
  } catch (_) {}
}

function updateBadge() {
  imageCountBadge.textContent = `${state.images.length} image${state.images.length !== 1 ? 's' : ''}`;
}

// Ensure accidental whitespace in the prompt is trimmed early so the
// UX is cleaner when users paste or type prompts into the textarea.

// Trim any accidental whitespace placed inside the <textarea> in the HTML
if (promptEl && typeof promptEl.value === 'string') {
  promptEl.value = promptEl.value.trim();
}

// Sample prompts for the dice button (quick presets users can insert)
const SAMPLE_PROMPTS = [
  'A serene mountain landscape at sunrise, ultra-detailed, 8k',
  'Cyberpunk city street at night, neon reflections, cinematic',
  'Fantasy portrait of a warrior queen, intricate armor, dramatic lighting',
  'A cute anime cat cafe, pastel colors, soft lighting',
  'Photorealistic macro shot of a dewdrop on a leaf',
  'Surreal floating islands with waterfalls and glowing trees'
];

if (diceBtn) {
  diceBtn.addEventListener('click', () => {
    if (!promptEl) return;
    const p = SAMPLE_PROMPTS[Math.floor(Math.random() * SAMPLE_PROMPTS.length)];
    promptEl.value = p;
    // showToast('Random prompt inserted');
    promptEl.focus();
  });
}

// ─── Gallery Render ───────────────────────────────────────────────────────────
// renderEmpty()
// Displayed when there are no generated images. Keeps the gallery
// visually helpful and instructs the user how to start.
function renderEmpty() {
  galleryBox.innerHTML = `
    <div class="w-16 h-16 bg-[#1a1d2e] rounded-2xl border border-gray-700 flex items-center justify-center mb-4 shadow-inner text-gray-500">
      <i data-lucide="image" class="w-8 h-8"></i>
    </div>
    <h3 class="text-base font-medium text-gray-300 mb-1">Generated images will appear here</h3>
    <p class="text-xs text-gray-500 max-w-xs">Enter a prompt on the left sidebar and click Generate to begin your creation.</p>
  `;
  // Restore container padding/margins that may have been removed by renderGrid()
  try { gallerySection.style.padding = ''; } catch (_) {}
  galleryBox.style.padding = '';
  galleryBox.style.margin = '';
  galleryBox.style.gridTemplateColumns = '';
  galleryBox.style.gap = '';
  galleryBox.style.alignItems = '';

  galleryBox.classList.add('flex', 'flex-col', 'items-center', 'justify-center', 'text-center');
  galleryBox.classList.remove('grid');
  lucide.createIcons();
}

// renderGrid()
// Render a responsive grid of image cards from `state.images`.
function renderGrid() {
  galleryBox.classList.remove('flex', 'flex-col', 'items-center', 'justify-center', 'text-center');
  galleryBox.classList.add('grid');
  galleryBox.style.gridTemplateColumns = 'repeat(auto-fill, minmax(220px, 1fr))';
  galleryBox.style.gap = '16px';
  galleryBox.style.alignItems = 'start';
    // Remove outer paddings/margins so items sit flush to the container edges
    try { gallerySection.style.padding = '0'; } catch (_) {}
    galleryBox.style.padding = '0';
    galleryBox.style.margin = '0';

  // Build HTML for each card from the `state.images` array. We inject
  // the resulting string into the gallery container and then call
  // `lucide.createIcons()` to replace `data-lucide` placeholders with
  // real SVG icons.
  galleryBox.innerHTML = state.images.map(img => `
    <div class="img-card group relative bg-[#1a1d2e] rounded-xl overflow-hidden border border-gray-700 hover:border-blue-500 transition-all duration-300 shadow-lg" data-id="${img.id}">
      ${img.loading
        ? `<div class="w-full" style="aspect-ratio: ${img.w || 1}/${img.h || 1};">
             <div class="pt-2 w-full h-full flex flex-col items-center justify-center gap-3 bg-[#1a1d2e]">
               <div class="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
               <span class="text-xs text-gray-400">Generating...</span>
             </div>
           </div>`
        : img.error
          ? `<div class="w-full" style="aspect-ratio: ${img.w || 1}/${img.h || 1};">
               <div class="pt-2 w-full h-full flex flex-col items-center justify-center gap-2 bg-[#1a1d2e] p-4 text-center">
                 <span class="text-red-400 text-xs">⚠ Failed to generate</span>
                 <span class="text-gray-500 text-xs">${img.error}</span>
               </div>
             </div>`
          : `<div class="w-full" style="aspect-ratio: ${img.w || 1}/${img.h || 1};"><img src="${img.url}" alt="${img.prompt}" class="w-full h-full object-cover" loading="lazy" /></div>`
      }
          ${!img.loading && !img.error ? `
          <div class="absolute right-3 bottom-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
            <button type="button" onclick="downloadImage('${img.url}', 'image-${img.id}.jpg')"
             class="pointer-events-auto bg-gray-800/80 hover:bg-gray-700 text-white p-3 rounded-full shadow-xl transition flex items-center justify-center" title="Download" aria-label="Download">
              <i data-lucide="download" class="w-5 h-5"></i>
            </button>
          </div>` : ''}
    </div>
  `).join('');
  // Replace icon placeholders with SVGs
  lucide.createIcons();
}

// refreshGallery()
// Update the badge and render the appropriate gallery state.
function refreshGallery() {
  updateBadge();
  if (state.images.length === 0) {
    renderEmpty();
  } else {
    renderGrid();
  }
}

// ─── Copy prompt ──────────────────────────────────────────────────────────────
// `copyPrompt` removed — copy UI was removed from the gallery

// downloadImage(url, filename)
// Attempt to download the image reliably by fetching a blob. Fallback to
// opening a new tab when network/CORS prevents blob download.
window.downloadImage = async function(url, filename) {
  if (!url) {
    showToast('No image available to download');
    return;
  }

  // Try to fetch the image as a blob and download via an object URL.
  // This is more reliable than setting `a.download` on a cross-origin URL.
  try {
    const resp = await fetch(url, { mode: 'cors' });
    if (!resp.ok) throw new Error('Network error');
    const blob = await resp.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename || 'image.jpg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
    showToast('Download started');
  } catch (err) {
    // Fallback: open the image in a new tab so the user can save it manually
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast('Opened image in new tab; use Save As to download');
  }
};

// ─── Toast ────────────────────────────────────────────────────────────────────
// showToast(msg)
// Brief helper to show a transient message in the bottom-right.
function showToast(msg) {
  const toast = document.createElement('div');
  toast.textContent = msg;
  toast.className = 'fixed bottom-6 right-6 z-50 bg-gray-800 text-white text-sm px-4 py-2 rounded-xl border border-gray-700 shadow-xl transition-all duration-300 opacity-0';
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.style.opacity = '1');
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// ─── Generate ─────────────────────────────────────────────────────────────────
// Primary flow for generating images from a prompt. Validates inputs,
// creates placeholder cards, attempts to fetch images (prompt-based via
// Unsplash Source) and updates each card with the resulting URL or a
// local fallback preview on error.
async function generateImages() {
  const prompt = promptEl.value.trim();
  if (!prompt) {
    showToast('⚠ Please enter a prompt first!');
    promptEl.focus();
    return;
  }

  const countVal  = parseInt(countSelect.value) || 1;
  const ratioVal  = ratioSelect.value || '1:1';
  const modelVal  = modelSelect.value !== 'select' ? modelSelect.value : 'flux';
  const dims      = RATIO_MAP[ratioVal] || { w: 1024, h: 1024 };
  const styleHint = MODEL_HINTS[modelVal] || '';

  if (countVal === 0) {
    showToast('⚠ Please select image count!');
    return;
  }

  // Disable button
  state.generating = true;
  generateBtnEl.disabled = true;
  generateBtnEl.innerHTML = `
    <svg class="animate-spin w-5 h-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path>
    </svg>
    Generating...
  `;

  // Create placeholder cards (so the UI updates immediately while
  // network requests run in the background).
  const newImages = Array.from({ length: countVal }, () => ({
    id: uid(),
    url: '',
    prompt,
    model: modelVal,
    w: dims.w,
    h: dims.h,
    ratio: ratioVal,
    timestamp: Date.now(),
    loading: true,
    error: null,
  }));

  state.images = [...state.images, ...newImages];
  refreshGallery();

  // Fetch each image
  const fetches = newImages.map(async (imgObj) => {
    try {
      const seed = Math.floor(Math.random() * 999999);
      // Prefer Unsplash Source to fetch an image matching the user's prompt and requested dims
      const query = encodeURIComponent((styleHint ? `${prompt}, ${styleHint}` : prompt).split('\n')[0]);
      let url = `https://source.unsplash.com/${dims.w}x${dims.h}/?${query}`;

      // Preload to confirm image loads with timeout; if it fails, fall back to static pool with dims
      try {
        await Promise.race([
          new Promise((resolve, reject) => {
            const img = new Image();
            img.onload  = resolve;
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = url;
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout: 30s')), 30000)
          )
        ]);
      } catch (e) {
        const base = IMAGE_URLS[seed % IMAGE_URLS.length];
        const sep = base.includes('?') ? '&' : '?';
        url = `${base}${sep}w=${dims.w}&h=${dims.h}`;
      }

      const idx = state.images.findIndex(i => i.id === imgObj.id);
      if (idx !== -1) {
        state.images[idx] = { ...state.images[idx], url, loading: false };
        state.history.unshift(state.images[idx]);
        saveHistory();
      }
    } catch (err) {
      const idx = state.images.findIndex(i => i.id === imgObj.id);
      if (idx !== -1) {
        state.images[idx] = {
          ...state.images[idx],
          url: createFallbackPreview(imgObj.prompt, imgObj.model),
          loading: false,
          error: null,
          fallback: true,
        };
      }
    }
    refreshGallery();
  });

  await Promise.allSettled(fetches);

  // Re-enable button
  state.generating = false;
  generateBtnEl.disabled = false;
  generateBtnEl.innerHTML = `
    <i data-lucide="wand-2" class="w-5 h-5"></i>
    <span>Generate Image</span>
  `;
  lucide.createIcons();
}

// ─── History Modal ────────────────────────────────────────────────────────────
function showHistoryModal() {
  const existing = document.getElementById('history-modal');
  if (existing) { existing.remove(); return; }

  const modal = document.createElement('div');
  modal.id = 'history-modal';
  modal.className = 'fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-16 px-4';

  const items = state.history.length
    ? state.history.map(img => `
        <div class="flex items-center gap-3 p-2 rounded-xl hover:bg-gray-800 transition cursor-pointer group"
             onclick="loadFromHistory('${img.id}')">
          <img src="${img.url}" alt="" class="w-14 h-14 object-cover rounded-lg border border-gray-700 shrink-0"/>
          <div class="flex-1 min-w-0">
            <p class="text-sm text-gray-200 truncate">${img.prompt}</p>
    // For each placeholder, attempt to fetch a prompt-based image.
    // We use Unsplash Source with the requested dimensions; if the
    // request fails, we fall back to a static pool and then to a
    // local SVG preview.
            <p class="text-xs text-gray-500">${img.model} · ${new Date(img.timestamp).toLocaleTimeString()}</p>
          </div>
        </div>
      `).join('')
    : '<p class="text-sm text-gray-500 text-center py-8">No history yet.</p>';

  modal.innerHTML = `
    <div class="bg-[#121420] border border-gray-700 rounded-2xl w-full max-w-lg shadow-2xl max-h-[70vh] flex flex-col">
      <div class="flex items-center justify-between px-5 py-4 border-b border-gray-800">
        <h3 class="font-semibold text-white">Generation History</h3>
        <div class="flex items-center gap-2">
          <button onclick="clearHistory()"
                  class="text-sm text-red-400 hover:text-white px-3 py-1 rounded-lg hover:bg-gray-700 transition">Clear</button>
          <button onclick="document.getElementById('history-modal').remove()"
                  class="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-700 transition">
            <i data-lucide="x" class="w-5 h-5"></i>
          </button>
        </div>
      </div>
      <div class="overflow-y-auto flex-1 p-4 space-y-1">${items}</div>
    </div>
  `;

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });

  document.body.appendChild(modal);
  lucide.createIcons();
}

// loadFromHistory(id)
// Loads a prompt from history into the prompt textarea so the user can
// regenerate or edit it.

window.loadFromHistory = function(id) {
  const img = state.history.find(i => i.id === id);
  if (img) {
    promptEl.value = img.prompt;
    document.getElementById('history-modal')?.remove();
    showToast('Prompt loaded from history');
  }
};

// clearHistory()
// Clears saved generation history from memory and sessionStorage.
window.clearHistory = function() {
  if (!state.history || state.history.length === 0) {
    showToast('History is already empty');
    return;
  }
  if (!confirm('Clear generation history?')) return;
  state.history = [];
  try { sessionStorage.removeItem('img_history'); } catch (_) {}
  showToast('History cleared');
  document.getElementById('history-modal')?.remove();
};

// clearAll()
// Clears the in-memory gallery after user confirmation.

// ─── Clear All ────────────────────────────────────────────────────────────────
function clearAll() {
  if (state.images.length === 0) return;
  if (!confirm('Clear all generated images?')) return;
  state.images = [];
  refreshGallery();
}

// Event listeners: bind UI controls to app behavior (generate, clear,
// open history, keyboard shortcut for quick submit).

// ─── Event Listeners ──────────────────────────────────────────────────────────
generateBtnEl.addEventListener('click', generateImages);

promptEl.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'Enter') generateImages();
});

clearAllBtn.addEventListener('click', clearAll);
historyBtn.addEventListener('click', showHistoryModal);

// ─── Init ─────────────────────────────────────────────────────────────────────
// Initialize theme from localStorage (default: dark)
try {
  const saved = localStorage.getItem('theme') || 'dark';
  applyTheme(saved);
} catch (_) { applyTheme('dark'); }

loadHistory();
refreshGallery();