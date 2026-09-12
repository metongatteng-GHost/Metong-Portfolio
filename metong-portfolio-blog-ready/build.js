#!/usr/bin/env node
/**
 * Blog builder for metongatteng.com (or your Netlify subdomain).
 *
 * WHAT THIS DOES
 *   Reads every file in content/posts/*.html and generates:
 *     - posts/<slug>.html   one real, standalone, SEO-tagged page per post
 *     - blog.html           the post list, rebuilt with real <a> links (crawlable, no JS needed)
 *     - sitemap.xml         every URL on the site, for Google/Bing
 *     - robots.txt          points crawlers at the sitemap
 *
 * HOW TO PUBLISH A NEW POST
 *   1. Copy any file in content/posts/ as a template.
 *   2. Fill in the frontmatter (between the --- lines) and write your body as plain HTML.
 *   3. Run:  node build.js
 *   4. Commit + push. Netlify rebuilds and deploys automatically (see netlify.toml).
 *
 * ONE-TIME SETUP
 *   Update SITE_URL below once you know your live domain, then rebuild.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// CONFIG — update SITE_URL once you have a custom domain on Netlify
// ---------------------------------------------------------------------------
const SITE_URL = 'https://metongatteng.netlify.app'; // <-- change me, no trailing slash
const SITE_NAME = 'Metong Atteng';
const AUTHOR_NAME = 'Metong Atteng';
const AUTHOR_TITLE = 'Planning, Scheduling & Cost Controls Engineer';
const DEFAULT_OG_IMAGE = '/assets/headshot.jpg';

const ROOT = __dirname;
const CONTENT_DIR = path.join(ROOT, 'content', 'posts');
const POSTS_OUT_DIR = path.join(ROOT, 'posts');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtDate(d) {
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Minimal, dependency-free Markdown → HTML converter.
// Handles what the CMS's markdown editor produces: paragraphs, ## / ### headings,
// **bold**, *italic*, [links](url), ![images](url), and "- " lists.
// Raw HTML lines (e.g. pasted <p> tags from the old workflow) pass through untouched.
function inlineMd(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\*)([^*]+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

function markdownToHTML(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inList = false;
  let paraBuf = [];

  const flushPara = () => {
    if (paraBuf.length) {
      out.push(`<p>${inlineMd(paraBuf.join(' ').trim())}</p>`);
      paraBuf = [];
    }
  };
  const closeList = () => {
    if (inList) { out.push('</ul>'); inList = false; }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') { flushPara(); closeList(); continue; }

    if (/^<\/?[a-zA-Z][^>]*>/.test(line)) { // raw HTML line — pass through as-is
      flushPara(); closeList();
      out.push(raw);
      continue;
    }
    let m;
    if ((m = line.match(/^(#{2,4})\s+(.*)$/))) {
      flushPara(); closeList();
      const level = m[1].length + 1; // "##" -> h3, keeps h1 reserved for the post title
      out.push(`<h${level}>${inlineMd(m[2])}</h${level}>`);
      continue;
    }
    if ((m = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/))) {
      flushPara(); closeList();
      out.push(`<img src="${m[2]}" alt="${esc(m[1])}">`);
      continue;
    }
    if ((m = line.match(/^[-*]\s+(.*)$/))) {
      flushPara();
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inlineMd(m[1])}</li>`);
      continue;
    }
    closeList();
    paraBuf.push(line);
  }
  flushPara();
  closeList();
  return out.join('\n');
}

function stripQuotes(v) {
  const m = v.match(/^(["'])(.*)\1$/);
  return m ? m[2] : v;
}

function parsePost(raw, filename) {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!m) throw new Error(`No frontmatter block found in ${filename}. Expected a --- ... --- header.`);
  const [, fmBlock, body] = m;
  const meta = {};
  fmBlock.split('\n').forEach((line) => {
    const mm = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (mm) meta[mm[1].trim()] = stripQuotes(mm[2].trim());
  });
  ['title', 'slug', 'date', 'tag', 'excerpt'].forEach((k) => {
    if (!meta[k]) throw new Error(`"${k}" is missing from the frontmatter in ${filename}`);
  });
  if (!/^[a-z0-9-]+$/.test(meta.slug)) {
    throw new Error(`Slug "${meta.slug}" in ${filename} must be lowercase letters, numbers and hyphens only.`);
  }
  meta.cover = meta.cover || DEFAULT_OG_IMAGE;
  meta.date = meta.date.slice(0, 10); // tolerate full ISO datetimes from the CMS's date picker
  const bodyTrimmed = body.trim();
  meta.body = markdownToHTML(bodyTrimmed);
  const wordCount = bodyTrimmed.split(/\s+/).filter(Boolean).length;
  meta.readMins = Math.max(1, Math.round(wordCount / 200));
  return meta;
}

function loadPosts() {
  if (!fs.existsSync(CONTENT_DIR)) {
    console.error(`Missing folder: ${CONTENT_DIR}`);
    process.exit(1);
  }
  const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md') || f.endsWith('.html'));
  if (files.length === 0) {
    console.warn('No posts found in content/posts/ — nothing to build.');
  }
  const posts = files.map((f) => parsePost(fs.readFileSync(path.join(CONTENT_DIR, f), 'utf8'), f));

  const seen = new Set();
  posts.forEach((p) => {
    if (seen.has(p.slug)) throw new Error(`Duplicate slug "${p.slug}" — slugs must be unique.`);
    seen.add(p.slug);
  });

  posts.sort((a, b) => new Date(b.date) - new Date(a.date));
  return posts;
}

// ---------------------------------------------------------------------------
// Shared design system — same tokens/markup as the rest of the site
// ---------------------------------------------------------------------------
const SHARED_CSS = `
:root{
  --bg:#eaeef1; --bg-panel:#ffffff; --bg-panel-2:#f2f5f7;
  --line:rgba(20,40,55,0.12); --accent:#e8890f; --accent-dim:rgba(232,137,15,0.14);
  --accent-2:#0d8c78; --accent-2-dim:rgba(13,140,120,0.12);
  --text:#12222e; --text-muted:#5c6b76;
  --font-display:'Big Shoulders Display', sans-serif;
  --font-body:'IBM Plex Sans', sans-serif;
  --font-mono:'IBM Plex Mono', monospace;
}
*{box-sizing:border-box;}
html{scroll-behavior:smooth;}
body{ margin:0; background:
    radial-gradient(ellipse 900px 500px at 12% -8%, rgba(232,137,15,0.06), transparent 60%),
    radial-gradient(ellipse 800px 600px at 88% 8%, rgba(13,140,120,0.06), transparent 55%),
    var(--bg);
  color:var(--text); font-family:var(--font-body); -webkit-font-smoothing:antialiased; }
a{color:inherit;} img{max-width:100%; display:block; border-radius:2px;}
::selection{background:var(--accent-dim); color:var(--accent);}
:focus-visible{outline:2px solid var(--accent); outline-offset:3px;}
.wrap{max-width:900px; margin:0 auto; padding:0 28px;}
header.nav{ position:fixed; top:0; left:0; right:0; z-index:50; background:rgba(234,238,241,0.85); backdrop-filter:blur(8px); border-bottom:1px solid var(--line); }
.nav-inner{ max-width:900px; margin:0 auto; padding:14px 28px; display:flex; align-items:center; justify-content:space-between; gap:16px; }
.nav-id{ display:flex; align-items:center; gap:10px; font-family:var(--font-mono); font-size:13px; color:var(--text-muted); text-decoration:none; margin-right:auto; }
.nav-id .tag{ border:1px solid var(--accent-2); color:var(--accent-2); padding:3px 7px; font-weight:600; letter-spacing:0.03em; }
.blog-link{ font-family:var(--font-mono); font-size:13px; color:var(--text); text-decoration:none; border:1px solid var(--line); padding:9px 16px; white-space:nowrap; }
.blog-link:hover{ border-color:var(--accent); color:var(--accent); }
.hero{ padding:150px 0 40px; }
.eyebrow{ font-family:var(--font-mono); font-size:13px; letter-spacing:0.14em; color:var(--accent); text-transform:uppercase; margin:0 0 18px; display:flex; align-items:center; gap:10px; }
.eyebrow::before{ content:''; width:26px; height:1px; background:var(--accent); display:inline-block; }
h1.headline{ font-family:var(--font-display); font-weight:900; font-size:clamp(2.2rem,5vw,3.4rem); line-height:1; margin:0 0 16px; }
.hero p.sub{ color:var(--text-muted); max-width:60ch; line-height:1.6; font-size:1.05rem; margin:0; }
.post-list{ display:flex; flex-direction:column; gap:1px; background:var(--line); border:1px solid var(--line); margin-bottom:80px; }
.post-card{ display:block; background:var(--bg-panel); padding:28px; text-decoration:none; color:inherit; transition:background .15s ease; }
.post-card:hover{ background:var(--bg-panel-2); }
.post-date{ font-family:var(--font-mono); font-size:12px; color:var(--text-muted); }
.post-title{ font-family:var(--font-display); font-weight:800; font-size:1.4rem; margin:8px 0 8px; }
.post-excerpt{ color:#33434e; line-height:1.6; margin:0 0 14px; font-size:.98rem; }
.post-meta-row{ display:flex; gap:18px; align-items:center; font-family:var(--font-mono); font-size:12px; color:var(--text-muted); }
.tag-pill{ border:1px solid var(--accent-2); color:var(--accent-2); padding:3px 8px; }
.back-link{ font-family:var(--font-mono); font-size:13px; color:var(--text-muted); text-decoration:none; display:inline-block; margin-bottom:28px; }
.back-link:hover{ color:var(--accent); }
.article-body{ line-height:1.8; font-size:1.03rem; color:#243441; margin-top:36px; }
.article-body p{ margin:0 0 20px; }
.article-body h3{ font-family:var(--font-display); font-size:1.3rem; margin:32px 0 12px; }
.article-body img{ margin:24px 0; }
.article-body code{ background:var(--bg-panel-2); padding:2px 6px; font-family:var(--font-mono); font-size:0.92em; }
.engage-row{ display:flex; align-items:center; gap:16px; margin:40px 0; padding:20px 0; border-top:1px solid var(--line); border-bottom:1px solid var(--line); flex-wrap:wrap; }
.like-btn{ display:flex; align-items:center; gap:8px; font-family:var(--font-mono); font-size:13.5px; border:1px solid var(--line); background:var(--bg-panel); padding:10px 16px; cursor:pointer; color:var(--text); transition:border-color .15s ease, color .15s ease; }
.like-btn:hover{ border-color:var(--accent); color:var(--accent); }
.like-btn.liked{ border-color:var(--accent); color:var(--accent); background:var(--accent-dim); }
.like-note{ font-family:var(--font-mono); font-size:11.5px; color:var(--text-muted); }
.share-row{ display:flex; gap:10px; flex-wrap:wrap; }
.share-btn{ font-family:var(--font-mono); font-size:12.5px; border:1px solid var(--line); padding:9px 14px; text-decoration:none; color:var(--text); }
.share-btn:hover{ border-color:var(--accent); color:var(--accent); }
.comments-section{ margin-top:20px; }
.comments-heading{ font-family:var(--font-display); font-weight:800; font-size:1.2rem; margin:0 0 16px; }
.giscus-note{ font-family:var(--font-mono); font-size:12px; color:var(--text-muted); border:1px dashed var(--line); padding:14px; margin-bottom:16px; }
footer{ padding:36px 0 60px; text-align:center; font-family:var(--font-mono); font-size:12px; color:var(--text-muted); }
`;

function sharedHead(title, description) {
  return `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' fill='%23eaeef1'/%3E%3Crect x='5' y='5' width='54' height='54' fill='none' stroke='%23e8890f' stroke-width='4'/%3E%3Ctext x='32' y='41' font-family='monospace,Arial' font-size='22' font-weight='700' fill='%2312222e' text-anchor='middle'%3EMA%3C/text%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;800;900&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${SHARED_CSS}</style>`;
}

function headerNav(blogHref) {
  return `<header class="nav">
  <div class="nav-inner">
    <a href="${blogHref}index.html#top" class="nav-id"><span class="tag">MA</span> METONG ATTENG</a>
    <a href="${blogHref}index.html#engage" class="blog-link">Portfolio →</a>
  </div>
</header>`;
}

function footer() {
  return `<footer>© <span id="year"></span> ${AUTHOR_NAME} — ${AUTHOR_TITLE}, Nigeria.</footer>
<script>document.getElementById('year').textContent = new Date().getFullYear();</script>`;
}

// ---------------------------------------------------------------------------
// Post page template
// ---------------------------------------------------------------------------
function postPageHTML(post) {
  const url = `${SITE_URL}/posts/${post.slug}.html`;
  const img = post.cover.startsWith('http') ? post.cover : `${SITE_URL}${post.cover}`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.excerpt,
    image: [img],
    datePublished: post.date,
    dateModified: post.date,
    author: { '@type': 'Person', name: AUTHOR_NAME, url: `${SITE_URL}/index.html` },
    publisher: { '@type': 'Person', name: AUTHOR_NAME },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(post.title)} — ${SITE_NAME}</title>
<meta name="description" content="${esc(post.excerpt)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow">
<meta name="author" content="${AUTHOR_NAME}">

<meta property="og:type" content="article">
<meta property="og:title" content="${esc(post.title)}">
<meta property="og:description" content="${esc(post.excerpt)}">
<meta property="og:image" content="${img}">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="article:published_time" content="${post.date}">
<meta property="article:author" content="${AUTHOR_NAME}">
<meta property="article:tag" content="${esc(post.tag)}">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(post.title)}">
<meta name="twitter:description" content="${esc(post.excerpt)}">
<meta name="twitter:image" content="${img}">

<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
${sharedHead(post.title, post.excerpt)}
</head>
<body>
${headerNav('../')}

<div class="wrap hero" style="padding-bottom:0;">
  <a href="../blog.html" class="back-link">← Back to all posts</a>
  <p class="eyebrow">${esc(post.tag)}</p>
  <h1 class="headline" style="font-size:clamp(1.8rem,4vw,2.6rem);">${esc(post.title)}</h1>
  <p class="post-date">${fmtDate(post.date)} · ${post.readMins} min read</p>
</div>

<div class="wrap">
  <article class="article-body">
    ${post.body}
  </article>

  <div class="engage-row">
    <button class="like-btn" id="likeBtn"><span id="likeIcon">🤍</span> <span id="likeLabel">Like</span> <span id="likeCount">0</span></button>
    <span class="like-note">Likes are saved to your own browser, not shared publicly across visitors.</span>
  </div>

  <div class="share-row">
    <a class="share-btn" target="_blank" rel="noopener" href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}">Share on LinkedIn</a>
    <a class="share-btn" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(post.title)}">Share on X</a>
    <a class="share-btn" href="mailto:?subject=${encodeURIComponent(post.title)}&body=${encodeURIComponent(url)}">Share by email</a>
  </div>

  <div class="comments-section">
    <h3 class="comments-heading">Comments</h3>
    <div class="giscus-note">Comments run on Giscus. To activate: enable Discussions on your GitHub repo, install the giscus app, then paste your repo/category IDs into the script below.</div>
    <div id="giscusThread">
      <!-- <script src="https://giscus.app/client.js" data-repo="yourname/yourrepo" data-repo-id="..." data-category="Comments" data-category-id="..." data-mapping="pathname" data-reactions-enabled="1" data-theme="light" crossorigin="anonymous" async></script> -->
    </div>
  </div>
</div>

${footer()}

<script>
(function(){
  const key = 'like_${post.slug}';
  const btn = document.getElementById('likeBtn');
  const label = document.getElementById('likeLabel');
  const countEl = document.getElementById('likeCount');
  let liked = localStorage.getItem(key) === '1';
  let count = parseInt(localStorage.getItem(key+'_count') || '0', 10);
  function render(){
    btn.classList.toggle('liked', liked);
    document.getElementById('likeIcon').textContent = liked ? '❤️' : '🤍';
    label.textContent = liked ? 'Liked' : 'Like';
    countEl.textContent = count;
  }
  render();
  btn.onclick = function(){
    liked = !liked;
    count = count + (liked ? 1 : -1);
    localStorage.setItem(key, liked ? '1' : '0');
    localStorage.setItem(key+'_count', String(count));
    render();
  };
})();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Blog list page (statically rendered — crawlable without JS)
// ---------------------------------------------------------------------------
function blogListHTML(posts) {
  const url = `${SITE_URL}/blog.html`;
  const cards = posts.map((p) => `      <a class="post-card" href="posts/${p.slug}.html">
        <span class="post-date">${fmtDate(p.date)}</span>
        <h2 class="post-title">${esc(p.title)}</h2>
        <p class="post-excerpt">${esc(p.excerpt)}</p>
        <div class="post-meta-row"><span class="tag-pill">${esc(p.tag)}</span><span>${p.readMins} min read</span></div>
      </a>`).join('\n');

  const itemListLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: `${SITE_NAME} — Blog`,
    url,
    blogPost: posts.map((p) => ({
      '@type': 'BlogPosting',
      headline: p.title,
      url: `${SITE_URL}/posts/${p.slug}.html`,
      datePublished: p.date,
    })),
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Blog — ${SITE_NAME}</title>
<meta name="description" content="Notes on planning, scheduling, cost control and EVM from ${AUTHOR_NAME}.">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow">
<meta property="og:type" content="website">
<meta property="og:title" content="Blog — ${SITE_NAME}">
<meta property="og:description" content="Notes on planning, scheduling, cost control and EVM from ${AUTHOR_NAME}.">
<meta property="og:image" content="${SITE_URL}${DEFAULT_OG_IMAGE}">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(itemListLd)}</script>
${sharedHead('Blog', 'Notes on planning, scheduling, cost control and EVM.')}
</head>
<body>
${headerNav('')}

<div class="wrap hero">
  <p class="eyebrow">Notes from the field</p>
  <h1 class="headline">Blog</h1>
  <p class="sub">Writing on scheduling, cost control, EVM and the day-to-day of running project controls on live EPC and solar builds.</p>
</div>

<div class="wrap">
  <div class="post-list">
${cards || '      <p style="padding:28px;">No posts yet — add one to content/posts/ and rebuild.</p>'}
  </div>
</div>

${footer()}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// sitemap.xml + robots.txt
// ---------------------------------------------------------------------------
function sitemapXML(posts) {
  const staticUrls = [
    { loc: `${SITE_URL}/index.html`, priority: '1.0' },
    { loc: `${SITE_URL}/blog.html`, priority: '0.8' },
  ];
  const postUrls = posts.map((p) => ({
    loc: `${SITE_URL}/posts/${p.slug}.html`,
    lastmod: new Date(p.date).toISOString().slice(0, 10),
    priority: '0.7',
  }));
  const all = [...staticUrls, ...postUrls];
  const body = all
    .map((u) => `  <url>\n    <loc>${u.loc}</loc>\n${u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : ''}    <priority>${u.priority}</priority>\n  </url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function robotsTXT() {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
function build() {
  const posts = loadPosts();

  fs.mkdirSync(POSTS_OUT_DIR, { recursive: true });
  // clear stale generated post pages so removed/renamed posts don't linger
  fs.readdirSync(POSTS_OUT_DIR).forEach((f) => fs.unlinkSync(path.join(POSTS_OUT_DIR, f)));

  posts.forEach((p) => {
    fs.writeFileSync(path.join(POSTS_OUT_DIR, `${p.slug}.html`), postPageHTML(p));
    console.log(`  ✓ posts/${p.slug}.html`);
  });

  fs.writeFileSync(path.join(ROOT, 'blog.html'), blogListHTML(posts));
  console.log('  ✓ blog.html (list rebuilt)');

  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemapXML(posts));
  console.log('  ✓ sitemap.xml');

  fs.writeFileSync(path.join(ROOT, 'robots.txt'), robotsTXT());
  console.log('  ✓ robots.txt');

  console.log(`\nBuilt ${posts.length} post(s). SITE_URL is currently: ${SITE_URL}`);
  console.log('If that is not your real domain yet, update it at the top of build.js and rebuild.');
}

build();
