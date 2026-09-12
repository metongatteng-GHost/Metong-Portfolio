# Publishing posts — the easy way (admin page)

Once the one-time setup below is done, publishing is:

1. Go to `yoursite.com/admin`
2. Log in
3. Click **New Post**, fill in title / date / tag / excerpt, paste your write-up into the body field
4. Click **Publish**

That's it. Netlify rebuilds automatically (usually under a minute) and the post is live at
`yoursite.com/posts/your-slug.html`, already carrying its own SEO tags and a proper LinkedIn/X preview card.

---

## One-time setup (you'll need to do this part yourself — I don't have access to your accounts)

**1. Make sure the site is deployed via Git, not drag-and-drop.**
If you haven't already: push this project to a GitHub repo, then in Netlify choose
*Add new site → Import an existing project* and connect that repo. (If it's already deployed this way, skip to step 2.)

**2. Turn on Netlify Identity.**
Netlify dashboard → your site → **Site configuration → Identity → Enable Identity**.

**3. Turn on Git Gateway.**
Same Identity page → **Services → Git Gateway → Enable Git Gateway**.
This is what lets the admin page commit new posts to your repo without you managing a GitHub token.

**4. Restrict signups and invite yourself.**
Identity → **Registration → Invite only** (so strangers can't create accounts on your site).
Then **Identity → Invite users** → enter your own email.

**5. Accept the invite.**
You'll get an email — click it, it'll drop you on your site to set a password.

**6. Check the branch name.**
Open `admin/config.yml` and confirm `branch: main` matches your repo's actual default branch (some repos use `master`). Fix and push if it doesn't match.

**7. Go to `yoursite.com/admin` and log in.**
You're set — publish your first real post.

---

## Before any of this: set your real domain

Open `build.js`, change `SITE_URL` at the top to your actual domain (or `xxxx.netlify.app` if no custom domain yet), commit and push.

## Getting Google to index a new post fast

A sitemap (auto-generated on every build) helps Google *find* a page, it doesn't make indexing instant. For that:
1. Add the site to [Google Search Console](https://search.google.com/search-console) and verify ownership.
2. Submit `sitemap.xml` there once.
3. After publishing a post, paste its URL into Search Console's **URL Inspection** tool and click **Request Indexing** — this is what actually gets you indexed in hours instead of days.

## Sharing on LinkedIn / X / WhatsApp

Share the real post URL — each one carries its own `og:title`, `og:description`, and `og:image`, so the preview card shows your actual title, excerpt, and cover image. If LinkedIn ever shows a stale preview for a link you've shared before, run it through [LinkedIn's Post Inspector](https://www.linkedin.com/post-inspector/) once to force a re-scrape.

## Still works the old way too

If you'd rather write in a text editor than the admin UI: add a `.md` file to `content/posts/` by hand (same frontmatter format), run `node build.js`, and push. Nothing about that workflow changed — the CMS just gives you the same thing through a browser instead of git.
