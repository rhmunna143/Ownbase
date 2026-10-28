// Ownbase Documentation & Website Interactive Client Scripts

document.addEventListener('DOMContentLoaded', () => {
  // 1. Mobile Menu Toggle
  const menuToggle = document.querySelector('.menu-toggle');
  const navLinks = document.querySelector('.nav-links');

  if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', () => {
      navLinks.classList.toggle('open');
      menuToggle.setAttribute(
        'aria-expanded',
        navLinks.classList.contains('open') ? 'true' : 'false'
      );
    });
  }

  // 2. Code Snippet Copy Buttons
  const copyButtons = document.querySelectorAll('.copy-btn');
  copyButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const codeBlock = btn.closest('.code-box')?.querySelector('pre code') || btn.closest('.code-box')?.querySelector('pre');
      if (!codeBlock) return;

      const codeText = codeBlock.innerText.trim();
      try {
        await navigator.clipboard.writeText(codeText);
        const originalText = btn.innerText;
        btn.innerText = 'Copied!';
        btn.style.color = '#10b981';
        setTimeout(() => {
          btn.innerText = originalText;
          btn.style.color = '';
        }, 2000);
      } catch (err) {
        console.error('Failed to copy code to clipboard:', err);
      }
    });
  });

  // 3. Docs Sidebar Active Section Highlighter
  const sections = document.querySelectorAll('.docs-body section[id]');
  const navAnchors = document.querySelectorAll('.sidebar-menu a');

  if (sections.length > 0 && navAnchors.length > 0) {
    const observerOptions = {
      root: null,
      rootMargin: '-20% 0px -70% 0px',
      threshold: 0,
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute('id');
          navAnchors.forEach((a) => {
            if (a.getAttribute('href') === `#${id}`) {
              a.classList.add('active');
            } else {
              a.classList.remove('active');
            }
          });
        }
      });
    }, observerOptions);

    sections.forEach((section) => observer.observe(section));
  }
});

