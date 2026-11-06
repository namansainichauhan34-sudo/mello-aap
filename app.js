const photos = {
  lake: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1100&q=85",
  coffee: "https://images.unsplash.com/photo-1445116572660-236099ec97a0?auto=format&fit=crop&w=1100&q=85",
  picnic: "https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=1100&q=85",
  coast: "https://images.unsplash.com/photo-1473116763249-2faaef81ccda?auto=format&fit=crop&w=1100&q=85",
  flowers: "https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&fit=crop&w=1100&q=85",
  friends: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=1100&q=85",
  baker: "https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=900&q=85",
  cat: "https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?auto=format&fit=crop&w=900&q=85",
  city: "https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=900&q=85"
};

const people = [
  { name: "Sofia Chen", handle: "sofiasunday", color: "rose", location: "Golden hour at the lake", image: photos.lake },
  { name: "Theo Martin", handle: "theo.makes", color: "blue", location: "Sunday coffee ritual", image: photos.coffee },
  { name: "Ava Brooks", handle: "avabloom", color: "lilac", location: "A little picnic in the sun", image: photos.picnic },
  { name: "Noah Williams", handle: "noahoutside", color: "green", location: "Somewhere by the sea", image: photos.coast },
  { name: "Mia Alvarez", handle: "miainbloom", color: "gold", location: "Found these little beauties", image: photos.flowers }
];

const defaultPosts = [
  { id: "p1", person: 0, image: photos.lake, location: "Lake Como, Italy", time: "2 hours ago", caption: "A little pause, a lot of blue, and absolutely nowhere else I need to be ☁️", likes: 248, liked: false, saved: false, comments: [{ name: "theo.makes", text: "Adding this to our someday list ✨" }, { name: "miainbloom", text: "the light is unreal!" }] },
  { id: "p2", person: 1, image: photos.coffee, location: "Little Day Café", time: "4 hours ago", caption: "Slow mornings, good coffee, and my favourite corner table. The usual, in the best way ☕", likes: 126, liked: true, saved: false, comments: [{ name: "sofiasunday", text: "save me a seat next time!" }] },
  { id: "p3", person: 2, image: photos.picnic, location: "Meadow Park", time: "Yesterday", caption: "Turns out the best plans are the ones that start with “let’s just bring a blanket” 🌿", likes: 392, liked: false, saved: true, comments: [] }
];

const defaultConversations = [
  { id: "sofia", name: "Sofia Chen", color: "rose", last: "Send me all the photos please 🌷", time: "now", messages: [{ text: "Hey Jamie! Did you make it to the lake this weekend?", mine: false, time: "10:18" }, { text: "I did! The weather was so dreamy ☀️", mine: true, time: "10:21" }, { text: "Oh I need to see the photos!", mine: false, time: "10:22" }, { text: "Send me all the photos please 🌷", mine: false, time: "10:23" }] },
  { id: "theo", name: "Theo Martin", color: "blue", last: "That sounds like a plan!", time: "1h", messages: [{ text: "Want to check out that new little café on Saturday?", mine: false, time: "09:12" }, { text: "The one on Maple Street? Absolutely", mine: true, time: "09:16" }, { text: "That sounds like a plan!", mine: false, time: "09:19" }] },
  { id: "ava", name: "Ava Brooks", color: "lilac", last: "Loved your last post!", time: "3h", messages: [{ text: "Loved your last post! We need another picnic day soon 💛", mine: false, time: "Yesterday" }] },
  { id: "noah", name: "Noah Williams", color: "green", last: "See you there 🌊", time: "1d", messages: [{ text: "I found a quiet beach spot for next weekend.", mine: false, time: "Mon" }, { text: "Already packing my camera", mine: true, time: "Mon" }, { text: "See you there 🌊", mine: false, time: "Mon" }] }
];

function readStorage(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch (error) {
    console.warn(`Could not read ${key} from local storage.`, error);
    return fallback;
  }
}

let posts = readStorage("mellow-posts", defaultPosts);
let conversations = readStorage("mellow-conversations", defaultConversations);
let currentView = "home";
let currentChat = "sofia";
let searchQuery = "";
let selectedImage = "";
let toastTimer;
let authMode = "login";
let currentUser = readSessionUser();

if (currentUser && typeof currentUser.handle === "string" && typeof currentUser.name === "string") {
  people[5] = { name: currentUser.name, handle: currentUser.handle, color: "you" };
} else {
  currentUser = null;
}
let followed = loadFollowedForCurrentUser();

const main = document.querySelector("#mainContent");
const authScreen = document.querySelector("#authScreen");
const composer = document.querySelector("#composerDialog");
const imageInput = document.querySelector("#imageInput");
const imagePreview = document.querySelector("#imagePreview");
const uploadZone = document.querySelector("#uploadZone");
const postCaption = document.querySelector("#postCaption");

function saveStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Could not save ${key} to local storage.`, error);
    showToast("Couldn't save that change on this device.");
  }
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function getAccounts() {
  const accounts = readStorage("mellow-accounts", []);
  return Array.isArray(accounts) ? accounts : [];
}

function readSessionUser() {
  try {
    const stored = sessionStorage.getItem("mellow-active-user");
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.warn("Could not read the active demo session.", error);
    sessionStorage.removeItem("mellow-active-user");
    return null;
  }
}

function setCurrentUser(account) {
  currentUser = { name: account.name, handle: account.handle };
  people[5] = { ...currentUser, color: "you" };
  sessionStorage.setItem("mellow-active-user", JSON.stringify(currentUser));
  followed = loadFollowedForCurrentUser();
}

function followedStorageKey() {
  return `mellow-followed:${currentUser.handle}`;
}

function loadFollowedForCurrentUser() {
  if (!currentUser) return [];
  const key = followedStorageKey();
  const stored = readStorage(key, null);
  if (Array.isArray(stored)) return stored;

  const legacy = readStorage("mellow-followed", []);
  if (Array.isArray(legacy) && !localStorage.getItem("mellow-followed-migrated")) {
    saveStorage(key, legacy);
    localStorage.setItem("mellow-followed-migrated", "true");
    return legacy;
  }
  return [];
}

function renderAuth() {
  document.body.classList.add("auth-mode");
  authScreen.hidden = false;
  const hasAccounts = getAccounts().length > 0;
  if (!hasAccounts) authMode = "signup";
  authScreen.innerHTML = `<section class="auth-card" aria-labelledby="authTitle">
    <a class="auth-brand" href="#" aria-label="mellow home"><span class="brand-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 17.4c2.4-5.8 5-8.7 8-8.7 2.4 0 3.8 2.8 5.2 6.1s2.7 5.4 4.8 5.4c1.2 0 2.4-.8 3.8-2.5"/><path d="M6 22.1h20"/></svg></span><span>mellow<span class="brand-dot">.</span></span></a>
    <span class="eyebrow">${authMode === "signup" ? "YOUR OWN LITTLE CORNER" : "WELCOME BACK"}</span>
    <h1 id="authTitle">${authMode === "signup" ? "Make yourself at home." : "Good to see you again."}</h1>
    <p class="auth-intro">${authMode === "signup" ? "Pick a username and a 3-digit PIN to start your local demo." : "Sign in with the username and PIN you chose on this device."}</p>
    <form class="auth-form" id="authForm" novalidate>
      ${authMode === "signup" ? `<label for="authName">Your name</label><input id="authName" name="name" autocomplete="name" maxlength="40" placeholder="Jamie Parker" required>` : ""}
      <label for="authUsername">Username</label><div class="username-field"><span>@</span><input id="authUsername" name="username" autocomplete="username" minlength="3" maxlength="20" pattern="[A-Za-z0-9._]+" placeholder="yourname" required></div>
      <label for="authPin">3-digit PIN</label><input id="authPin" name="pin" inputmode="numeric" autocomplete="${authMode === "signup" ? "new-password" : "current-password"}" pattern="[0-9]{3}" maxlength="3" placeholder="•••" type="password" required>
      <p class="auth-error" id="authError" role="alert" hidden></p>
      <button class="auth-submit" type="submit">${authMode === "signup" ? "Create account" : "Log in"} <span>→</span></button>
    </form>
    <p class="auth-switch">${authMode === "signup" ? `Already have an account? <button type="button" data-auth-mode="login">Log in</button>` : `New around here? <button type="button" data-auth-mode="signup">Create an account</button>`}</p>
    <p class="auth-notice"><strong>Local demo only.</strong> Your account stays in this browser; this static site has no server. A 3-digit PIN is not safe for public accounts.</p>
  </section>`;
}

async function hashPin(pin, salt) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" }, key, 256);
  return Array.from(new Uint8Array(bits), byte => byte.toString(16).padStart(2, "0")).join("");
}

function decodeSalt(value) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

function encodeSalt(value) {
  return btoa(String.fromCharCode(...value));
}

function avatar(name, color, extraClass = "") {
  const initial = name.split(" ").map(part => part[0]).slice(0, 2).join("");
  return `<span class="avatar avatar-${escapeHTML(color)} ${extraClass}" aria-label="${escapeHTML(name)}">${escapeHTML(initial)}</span>`;
}

function showToast(message) {
  const region = document.querySelector("#toastRegion");
  region.replaceChildren();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  region.append(toast);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.remove(), 2600);
}

function storyMarkup() {
  const stories = [
    { name: "Your story", color: "you", add: true },
    ...people.map((person, index) => ({ ...person, color: person.color, index }))
  ];
  return `<section class="stories-section" aria-label="Stories">
    <div class="section-heading"><h2>Little updates</h2><button class="see-all" type="button" data-toast="You're all caught up on stories ✨">See all</button></div>
    <div class="stories-row">${stories.map(story => `<button class="story" type="button" ${story.add ? 'data-own-story="true"' : `data-story="${story.index}"`} aria-label="${story.add ? "Add to your story" : `View ${escapeHTML(story.name)}'s story`}">
      <span class="story-ring${story.add ? " seen" : ""}">${avatar(story.add ? "Jamie Parker" : story.name, story.color)}${story.add ? '<span class="story-plus">+</span>' : ""}</span><span class="story-name">${escapeHTML(story.add ? "Your story" : story.name.split(" ")[0])}</span>
    </button>`).join("")}</div>
  </section>`;
}

function postMarkup(post) {
  const person = people[post.person] || { name: "Jamie Parker", handle: "jamieparks", color: "you" };
  const commentList = post.comments.map(comment => `<div><strong>${escapeHTML(comment.name)}</strong>${escapeHTML(comment.text)}</div>`).join("");
  return `<article class="post-card" data-post-id="${escapeHTML(post.id)}">
    <header class="post-header">${avatar(person.name, person.color)}<div class="post-user"><strong>${escapeHTML(person.handle)}</strong><span>${escapeHTML(post.location || "A little moment")}</span></div><span class="post-menu" aria-hidden="true">···</span></header>
    <div class="post-image-wrap"><img class="post-image" src="${escapeHTML(post.image)}" alt="${escapeHTML(post.caption || "A photo shared by " + person.name)}" loading="lazy"></div>
    <div class="post-actions">
      <button class="post-action like-button${post.liked ? " liked" : ""}" type="button" aria-label="${post.liked ? "Unlike" : "Like"} post"><svg viewBox="0 0 24 24"><path d="M20.8 8.7c0 4.2-8.8 10-8.8 10s-8.8-5.8-8.8-10A4.7 4.7 0 0 1 12 6.2a4.7 4.7 0 0 1 8.8 2.5Z"/></svg><span>${post.likes + (post.liked ? 1 : 0)}</span></button>
      <button class="post-action comment-focus" type="button" aria-label="Write a comment"><svg viewBox="0 0 24 24"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5 8 8 0 0 1-3.5-.8L4 20l1.5-4A7.4 7.4 0 0 1 4 11.5 7.5 7.5 0 0 1 11.5 4H12a7.5 7.5 0 0 1 8 7.5Z"/></svg><span>${post.comments.length || ""}</span></button>
      <button class="post-action" type="button" data-share="${escapeHTML(post.id)}" aria-label="Share post"><svg viewBox="0 0 24 24"><path d="m21 3-7.5 18-3.7-7.8L2 9.5 21 3Z"/><path d="M9.8 13.2 21 3"/></svg></button>
      <button class="post-action post-save${post.saved ? " saved" : ""}" type="button" aria-label="${post.saved ? "Remove from saved" : "Save post"}"><svg viewBox="0 0 24 24"><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4z"/></svg></button>
    </div>
    <div class="post-caption"><strong>${escapeHTML(person.handle)}</strong>${escapeHTML(post.caption)}</div>
    ${post.comments.length ? `<div class="comment-list">${commentList}</div>` : `<div class="post-comments">Be the first to say something kind</div>`}
    <form class="comment-form"><input name="comment" maxlength="180" placeholder="Add a comment…" aria-label="Add a comment"><button type="submit">Post</button></form>
  </article>`;
}

function suggestionsMarkup() {
  return `<aside class="right-column" aria-label="Your profile and suggestions">
    <div class="your-profile">${avatar("Jamie Parker", "you")}<div class="profile-copy"><strong>Jamie Parker</strong><small>@jamieparks</small></div><button class="switch-button" type="button" data-toast="You're already in your happy place 🙂">Switch</button></div>
    <section class="right-section"><div class="section-heading"><h2 class="right-heading">People to know</h2><button class="see-all" data-view="explore" type="button">See all</button></div>
      ${people.slice(1, 5).map((person, index) => `<div class="friend-row">${avatar(person.name, person.color)}<div class="friend-copy"><strong>${escapeHTML(person.handle)}</strong><small>${index % 2 ? "Followed by sofiasunday" : "A little like you"}</small></div><button class="follow-button${followed.includes(person.handle) ? " following" : ""}" type="button" data-follow="${escapeHTML(person.handle)}">${followed.includes(person.handle) ? "Following" : "Follow"}</button></div>`).join("")}
    </section>
    <div class="footer-links"><a href="#" data-toast="Thanks for being here.">About</a><a href="#" data-toast="Mellow is your space.">Community</a><a href="#" data-toast="Your privacy matters.">Privacy</a><a href="#" data-toast="Be kind to one another 💛">Guidelines</a><a href="#" data-toast="Made for little moments.">About us</a></div>
    <div class="footer-copy">© 2025 MELLOW SOCIAL</div>
  </aside>`;
}

function renderHome() {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visiblePosts = posts.filter(post => {
    const person = people[post.person] || { name: "Jamie Parker", handle: "jamieparks" };
    return !normalizedQuery || `${person.name} ${person.handle} ${post.caption} ${post.location || ""}`.toLowerCase().includes(normalizedQuery);
  });
  main.innerHTML = `<div class="content-grid"><section class="feed-column">${storyMarkup()}<div class="feed-posts">${visiblePosts.length ? visiblePosts.map(postMarkup).join("") : `<div class="empty-state"><strong>No moments found just yet.</strong><p>Try a different search, or share a little moment of your own.</p></div>`}</div></section>${suggestionsMarkup()}</div>`;
}

function renderMessages() {
  const conversation = conversations.find(item => item.id === currentChat) || conversations[0];
  if (!conversation) {
    main.innerHTML = `<div class="empty-state"><strong>No conversations yet.</strong><p>Say hello to someone new from Explore.</p></div>`;
    return;
  }
  main.innerHTML = `<section class="messages-page" aria-label="Direct messages">
    <div class="conversation-list"><div class="messages-heading"><h1>Messages</h1><button type="button" data-toast="Start a conversation by exploring people ✨">＋ New</button></div>
      ${conversations.map(item => `<button class="conversation-item${item.id === conversation.id ? " active" : ""}" type="button" data-chat="${escapeHTML(item.id)}">${avatar(item.name, item.color)}<span class="conversation-info"><strong>${escapeHTML(item.name)}</strong><span>${escapeHTML(item.messages[item.messages.length - 1]?.text || "")}</span></span><span class="conversation-time">${escapeHTML(item.time)}</span></button>`).join("")}
    </div>
    <div class="chat-panel"><header class="chat-header">${avatar(conversation.name, conversation.color)}<div class="chat-name"><strong>${escapeHTML(conversation.name)}</strong><span>● Active now</span></div><div class="chat-tools"><button type="button" aria-label="Voice call" data-toast="Voice calls are coming soon!"><svg viewBox="0 0 24 24"><path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 3a15 15 0 0 1-7-7l3-2z"/></svg></button><button type="button" aria-label="Video call" data-toast="Video calls are coming soon!"><svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg></button></div></header>
      <div class="chat-messages" id="chatMessages"><span class="chat-day">TODAY</span>${conversation.messages.map(message => `<div class="message-bubble${message.mine ? " mine" : ""}">${escapeHTML(message.text)}</div><span class="message-time${message.mine ? " mine" : ""}">${escapeHTML(message.time)}</span>`).join("")}</div>
      <form class="chat-compose" id="chatForm"><input name="message" maxlength="500" autocomplete="off" placeholder="Write a little message…" aria-label="Write a message"><button type="submit" aria-label="Send message"><svg viewBox="0 0 24 24"><path d="m21 3-7.5 18-3.7-7.8L2 9.5 21 3Z"/><path d="M9.8 13.2 21 3"/></svg></button></form>
    </div>
  </section>`;
  const messageBox = document.querySelector("#chatMessages");
  messageBox.scrollTop = messageBox.scrollHeight;
}

function renderExplore() {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const images = [...posts.map(post => post.image), ...Object.values(photos)];
  const filtered = normalizedQuery ? images.filter((_, index) => {
    const source = index < posts.length ? posts[index] : { caption: "", location: "" };
    return `${source.caption || ""} ${source.location || ""}`.toLowerCase().includes(normalizedQuery);
  }) : images;
  main.innerHTML = `<h1 class="page-title">Find your kind of people</h1><p class="page-subtitle">A few corners of the world you might like.</p>${filtered.length ? `<div class="explore-grid">${filtered.map(image => `<button type="button" data-toast="A little moment worth remembering ✨"><img src="${escapeHTML(image)}" alt="A moment from the Mellow community" loading="lazy"></button>`).join("")}</div>` : `<div class="empty-state"><strong>No moments found.</strong><p>Try searching for something else.</p></div>`}`;
}

function renderSaved() {
  const saved = posts.filter(post => post.saved);
  main.innerHTML = `<h1 class="page-title">Saved moments</h1><p class="page-subtitle">A little collection of things you want to remember.</p>${saved.length ? `<div class="profile-post-grid">${saved.map(post => `<button type="button" data-toast="${escapeHTML(post.caption)}"><img src="${escapeHTML(post.image)}" alt="${escapeHTML(post.caption)}" loading="lazy"></button>`).join("")}</div>` : `<div class="empty-state saved-empty"><strong>Your little collection is waiting.</strong><p>Save a post you love and it will find a cozy spot here.</p></div>`}`;
}

function renderProfile() {
  const ownPosts = posts.filter(post => post.person === 5);
  const followChoices = people.slice(0, 5);
  main.innerHTML = `<section class="profile-page"><div class="profile-hero">${avatar(currentUser.name, "you")}<div><h1 class="page-title">${escapeHTML(currentUser.name)}</h1><p class="page-subtitle" style="margin:5px 0">@${escapeHTML(currentUser.handle)}</p><div class="profile-stats"><span><strong>${ownPosts.length}</strong> posts</span><span><strong>${followed.length}</strong> following</span></div></div><button class="logout-button" type="button" data-logout>Log out</button></div>
    <section class="profile-following"><div class="section-heading"><div><h2 class="right-heading">Choose who to follow</h2><p class="page-subtitle following-hint">Follow or unfollow people whenever you like.</p></div></div>
      ${followChoices.map(person => `<div class="friend-row">${avatar(person.name, person.color)}<div class="friend-copy"><strong>${escapeHTML(person.name)}</strong><small>@${escapeHTML(person.handle)}</small></div><button class="follow-button${followed.includes(person.handle) ? " following" : ""}" type="button" data-follow="${escapeHTML(person.handle)}">${followed.includes(person.handle) ? "Following" : "Follow"}</button></div>`).join("")}
    </section>
    ${ownPosts.length ? `<div class="profile-post-grid">${ownPosts.map(post => `<button type="button" data-toast="${escapeHTML(post.caption)}"><img src="${escapeHTML(post.image)}" alt="${escapeHTML(post.caption)}" loading="lazy"></button>`).join("")}</div>` : `<div class="empty-state saved-empty"><strong>Your story starts with a moment.</strong><p>Share your first photo and it’ll show up here.</p><button class="create-button" style="margin-top:16px" type="button" data-open-composer>Create a post</button></div>`}</section>`;
}

function render() {
  if (!currentUser) {
    renderAuth();
    return;
  }
  document.body.classList.remove("auth-mode");
  authScreen.hidden = true;
  if (currentView === "home") renderHome();
  if (currentView === "messages") renderMessages();
  if (currentView === "explore") renderExplore();
  if (currentView === "saved") renderSaved();
  if (currentView === "profile") renderProfile();
  document.querySelectorAll("[data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === currentView));
  document.querySelectorAll(".profile-copy strong").forEach(element => { element.textContent = currentUser.name; });
  document.querySelectorAll(".profile-copy small").forEach(element => { element.textContent = `@${currentUser.handle}`; });
  document.querySelectorAll(".profile-button .avatar, .mobile-profile .avatar, .mobile-nav [data-view='profile'] .avatar").forEach(element => {
    element.textContent = currentUser.name.split(" ").map(part => part[0]).slice(0, 2).join("");
    element.setAttribute("aria-label", currentUser.name);
  });
  const mobileProfile = document.querySelector(".mobile-profile");
  if (mobileProfile) mobileProfile.lastElementChild.textContent = currentUser.name;
}

document.addEventListener("click", event => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const authModeButton = target.closest("[data-auth-mode]");
  if (authModeButton) {
    authMode = authModeButton.dataset.authMode;
    renderAuth();
    return;
  }
  if (target.closest("[data-logout]")) {
    sessionStorage.removeItem("mellow-active-user");
    currentUser = null;
    currentView = "home";
    authMode = "login";
    render();
    return;
  }
  const viewButton = target.closest("[data-view]");
  if (viewButton) {
    event.preventDefault();
    currentView = viewButton.dataset.view;
    render();
    main.focus({ preventScroll: true });
    return;
  }
  if (target.closest("#openComposer, #mobileCreate, [data-open-composer]")) {
    composer.showModal();
    return;
  }
  if (target.closest(".close-dialog")) composer.close();
  if (target.closest(".story-close")) document.querySelector("#storyDialog").close();
  const toastButton = target.closest("[data-toast]");
  if (toastButton) {
    event.preventDefault();
    showToast(toastButton.dataset.toast);
  }
  const story = target.closest("[data-story]");
  if (story) {
    const person = people[Number(story.dataset.story)];
    const dialog = document.querySelector("#storyDialog");
    const viewer = dialog.querySelector(".story-viewer");
    viewer.style.backgroundImage = `url("${person.image}")`;
    viewer.innerHTML = `<div class="story-author">${avatar(person.name, person.color)}${escapeHTML(person.name)} <span style="font-weight:400;opacity:.75">· 2h</span></div>`;
    dialog.showModal();
  }
  if (target.closest("[data-own-story]")) showToast("Share a photo to start your story ✨");

  const chatButton = target.closest("[data-chat]");
  if (chatButton) {
    currentChat = chatButton.dataset.chat;
    renderMessages();
  }
  const followButton = target.closest("[data-follow]");
  if (followButton) {
    const handle = followButton.dataset.follow;
    followed = followed.includes(handle) ? followed.filter(item => item !== handle) : [...followed, handle];
    saveStorage(followedStorageKey(), followed);
    render();
  }
  const postCard = target.closest("[data-post-id]");
  if (postCard && target.closest(".like-button")) {
    const post = posts.find(item => item.id === postCard.dataset.postId);
    post.liked = !post.liked;
    saveStorage("mellow-posts", posts);
    render();
  } else if (postCard && target.closest(".post-save")) {
    const post = posts.find(item => item.id === postCard.dataset.postId);
    post.saved = !post.saved;
    saveStorage("mellow-posts", posts);
    render();
    showToast(post.saved ? "Saved to your little collection ✨" : "Removed from saved moments");
  } else if (postCard && target.closest(".comment-focus")) {
    postCard.querySelector(".comment-form input").focus();
  }
  const shareButton = target.closest("[data-share]");
  if (shareButton) {
    const post = posts.find(item => item.id === shareButton.dataset.share);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(post.image).then(() => showToast("Photo link copied to clipboard ✨")).catch(() => showToast("Couldn't copy the link on this browser."));
    } else {
      showToast("Photo link copied: " + post.image);
    }
  }
});

document.addEventListener("submit", async event => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.id === "authForm") {
    event.preventDefault();
    const formData = new FormData(form);
    const username = String(formData.get("username") || "").trim().replace(/^@/, "").toLowerCase();
    const pin = String(formData.get("pin") || "");
    const errorBox = document.querySelector("#authError");
    if (!/^[a-zA-Z0-9._]{3,20}$/.test(username) || !/^\d{3}$/.test(pin)) {
      showAuthError(errorBox, "Enter a valid username and a 3-digit PIN.");
      return;
    }
    try {
      const accounts = getAccounts();
      if (authMode === "signup") {
        const name = String(formData.get("name") || "").trim();
        if (name.length < 2 || name.length > 40) {
          showAuthError(errorBox, "Enter a name between 2 and 40 characters.");
          return;
        }
        if (accounts.some(account => account.handle === username)) {
          showAuthError(errorBox, "That username is already registered on this browser.");
          return;
        }
        const salt = crypto.getRandomValues(new Uint8Array(16));
        accounts.push({ name, handle: username, salt: encodeSalt(salt), pinHash: await hashPin(pin, salt) });
        localStorage.setItem("mellow-accounts", JSON.stringify(accounts));
        setCurrentUser(accounts[accounts.length - 1]);
        showToast("Your local demo account is ready.");
      } else {
        const account = accounts.find(item => item.handle === username);
        const valid = account ? await hashPin(pin, decodeSalt(account.salt)) === account.pinHash : false;
        if (!valid) {
          showAuthError(errorBox, "Username or PIN is incorrect.");
          return;
        }
        setCurrentUser(account);
      }
      currentView = "home";
      render();
    } catch (error) {
      console.error("Could not complete local demo sign-in.", error);
      showAuthError(errorBox, "Sign-in failed in this browser. Check storage access and try again.");
    }
    return;
  }
  if (form.matches(".comment-form")) {
    event.preventDefault();
    const input = form.elements.namedItem("comment");
    const text = input.value.trim();
    if (!text) return;
    const card = form.closest("[data-post-id]");
    const post = posts.find(item => item.id === card.dataset.postId);
    post.comments.push({ name: currentUser.handle, text });
    saveStorage("mellow-posts", posts);
    render();
    return;
  }
  if (form.id === "chatForm") {
    event.preventDefault();
    const input = form.elements.namedItem("message");
    const text = input.value.trim();
    if (!text) return;
    const conversation = conversations.find(item => item.id === currentChat);
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    conversation.messages.push({ text, mine: true, time });
    conversation.last = text;
    conversation.time = "now";
    saveStorage("mellow-conversations", conversations);
    renderMessages();
  }
  if (form.id === "postForm") {
    event.preventDefault();
    if (!selectedImage) {
      showToast("Choose a photo before sharing.");
      return;
    }
    const caption = postCaption.value.trim();
    posts.unshift({ id: `p${Date.now()}`, person: 5, image: selectedImage, location: "Somewhere lovely", time: "Just now", caption: caption || "A little moment worth remembering ✨", likes: 0, liked: false, saved: false, comments: [] });
    saveStorage("mellow-posts", posts);
    form.reset();
    selectedImage = "";
    imagePreview.hidden = true;
    uploadZone.classList.remove("has-image");
    composer.close();
    currentView = "home";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
    showToast("Your moment is out in the world ✨");
  }
});

function showAuthError(container, message) {
  container.textContent = message;
  container.hidden = false;
}

imageInput.addEventListener("change", () => {
  const file = imageInput.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("Please choose an image file.");
    imageInput.value = "";
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast("That image is a little too big. Please choose one under 10 MB.");
    imageInput.value = "";
    return;
  }
  compressImage(file).then(dataUrl => {
    selectedImage = dataUrl;
    imagePreview.src = selectedImage;
    imagePreview.hidden = false;
    uploadZone.classList.add("has-image");
  }).catch(error => {
    console.error("Could not prepare the selected image.", error);
    showToast("Couldn't prepare that image. Please try another one.");
  });
});

async function compressImage(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  let longestSide = 1400;
  let blob;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const scale = Math.min(1, longestSide / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", 0.82 - attempt * 0.1));
      if (!blob) throw new Error("The browser could not encode the selected image.");
      if (blob.size <= 1_500_000) break;
      longestSide *= 0.75;
    }
  } finally {
    bitmap.close();
  }
  if (blob.size > 1_500_000) throw new Error("The selected image is too large to store in this browser.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(new Error("The browser could not read the compressed image.")));
    reader.readAsDataURL(blob);
  });
}

postCaption.addEventListener("input", () => {
  document.querySelector("#captionCount").textContent = `${postCaption.value.length} / 240`;
});

document.querySelector("#searchInput").addEventListener("input", event => {
  searchQuery = event.target.value;
  if (searchQuery.trim() && currentView !== "home" && currentView !== "explore") currentView = "explore";
  render();
  const input = document.querySelector("#searchInput");
  input.focus();
  input.setSelectionRange(searchQuery.length, searchQuery.length);
});

document.querySelector("#searchInput").addEventListener("keydown", event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    event.currentTarget.focus();
  }
  if (event.key === "Escape") {
    event.currentTarget.value = "";
    searchQuery = "";
    render();
  }
});

document.addEventListener("keydown", event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    document.querySelector("#searchInput").focus();
  }
});

document.querySelector(".upload-zone").addEventListener("dragover", event => event.preventDefault());
document.querySelector(".upload-zone").addEventListener("drop", event => {
  event.preventDefault();
  const file = event.dataTransfer.files?.[0];
  if (!file) return;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  imageInput.files = transfer.files;
  imageInput.dispatchEvent(new Event("change"));
});

composer.addEventListener("click", event => {
  if (event.target === composer) composer.close();
});
document.querySelector("#storyDialog").addEventListener("click", event => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});

render();
