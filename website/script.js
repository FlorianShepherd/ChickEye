/* ============================
   Lightbox
   ============================ */
const galleryImages = [
  'images/chicken_00221.jpg',
  'images/chicken_00198.jpg',
  'images/chicken_00100.jpg',
  'images/chicken_00050.jpg',
  'images/chicken_00010.jpg',
];

let currentImageIndex = 0;

function openLightbox(index) {
  currentImageIndex = index;
  document.getElementById('lightboxImg').src = galleryImages[index];
  document.getElementById('lightbox').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
  document.body.style.overflow = '';
}

function prevImage(e) {
  e.stopPropagation();
  currentImageIndex = (currentImageIndex - 1 + galleryImages.length) % galleryImages.length;
  document.getElementById('lightboxImg').src = galleryImages[currentImageIndex];
}

function nextImage(e) {
  e.stopPropagation();
  currentImageIndex = (currentImageIndex + 1) % galleryImages.length;
  document.getElementById('lightboxImg').src = galleryImages[currentImageIndex];
}

document.addEventListener('keydown', function(e) {
  const lb = document.getElementById('lightbox');
  if (!lb.classList.contains('open')) return;

  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') {
    currentImageIndex = (currentImageIndex - 1 + galleryImages.length) % galleryImages.length;
    document.getElementById('lightboxImg').src = galleryImages[currentImageIndex];
  }
  if (e.key === 'ArrowRight') {
    currentImageIndex = (currentImageIndex + 1) % galleryImages.length;
    document.getElementById('lightboxImg').src = galleryImages[currentImageIndex];
  }
});

/* ============================
   Mobile Navigation Toggle
   ============================ */
document.getElementById('navToggle').addEventListener('click', function() {
  document.getElementById('navLinks').classList.toggle('open');
});

document.getElementById('navLinks').querySelectorAll('a').forEach(function(link) {
  link.addEventListener('click', function() {
    document.getElementById('navLinks').classList.remove('open');
  });
});

/* ============================
   Hosting Option Tabs
   ============================ */
function showOption(card, id) {
  document.querySelectorAll('.hosting-content').forEach(function(el) {
    el.classList.add('hidden');
  });
  document.querySelectorAll('.hosting-card').forEach(function(el) {
    el.classList.remove('active');
  });
  document.getElementById('opt-' + id).classList.remove('hidden');
  card.classList.add('active');
}

/* ============================
   Copy Code Buttons
   ============================ */
function copyCode(btn) {
  var wrapper = btn.closest('.code-block-wrapper');
  var codeEl = wrapper.querySelector('code');
  var text = codeEl ? codeEl.innerText : '';

  if (navigator.clipboard && text) {
    navigator.clipboard.writeText(text).then(function() {
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(function() {
        btn.textContent = 'Copy';
        btn.classList.remove('copied');
      }, 2000);
    });
  }
}

/* ============================
   Active Nav Link on Scroll
   ============================ */
var sections = document.querySelectorAll('section[id]');
var navLinksList = document.querySelectorAll('.nav-links a');

var sectionObserver = new IntersectionObserver(function(entries) {
  entries.forEach(function(entry) {
    if (entry.isIntersecting) {
      var id = entry.target.id;
      navLinksList.forEach(function(link) {
        link.classList.toggle('active', link.getAttribute('href') === '#' + id);
      });
    }
  });
}, { rootMargin: '-25% 0px -65% 0px' });

sections.forEach(function(section) {
  sectionObserver.observe(section);
});
