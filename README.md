# mellow

A responsive, grayscale social app portfolio demo built with plain HTML, CSS, and JavaScript. No build step or package installation is required.

## Run locally

Open `index.html` in a modern browser, or serve this folder with any static web server. The browser's secure-context requirements mean a local server is recommended for account sign-in and image uploads.

## Publish as a static site

Upload the contents of this folder to a static host such as GitHub Pages, Netlify, or Cloudflare Pages. Set the publish/output directory to the folder containing `index.html`. There is no build command.

After deployment, test account creation, sign-in, a photo post, a story upload, and direct/group chats on the HTTPS site.

## Demo sign-in

Create an account with a 3–20 character username or an email address, plus a 6–72 character password. Use the same username or email to sign in. Log out from your profile. Password verification uses browser Web Crypto, so use HTTPS or localhost if the browser blocks it for a local file.

## Important demo limitations

- Accounts, posts, stories, profile photos, and chats are stored in the visitor's browser. They do not sync between devices or appear for other visitors.
- This is a front-end demonstration, not a secure public social network. Do not use a real password or upload private images.
- Clearing the browser's site data removes the demo content. Browser storage has limited capacity.
- Stories expire after 24 hours.

A real multi-user service requires a backend for authentication, shared data, image storage, and appropriate privacy and abuse protections.
