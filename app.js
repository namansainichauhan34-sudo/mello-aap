function readStorage(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch (error) {
    console.warn(`Could not read ${key} from local storage.`, error);
    return fallback;
  }
}

let posts = readStorage("mellow-posts", []);
let conversations = readStorage("mellow-conversations", []);
let stories = readStorage("mellow-stories", []);
const STORY_LIFETIME = 24 * 60 * 60 * 1000;
let storyExpiryTimer;
let currentView = "home";
let currentChat = null;
let searchQuery = "";
let selectedImage = "";
let selectedStoryImage = "";
let toastTimer;
let authMode = getAccounts().length ? "login" : "signup";
let authPending = false;
let currentUser = readSessionUser();
let followed = loadFollowedForCurrentUser();
let notifications = loadNotificationsForCurrentUser();
const storedPosts = posts;
posts = (Array.isArray(posts) ? posts : []).flatMap(post => {
  if (!post || typeof post !== "object") return [];
  if (typeof post.author === "string") return [post];
  if (post.person === 5 && currentUser) {
    return [{ ...post, author: currentUser.handle, likesBy: post.liked ? [currentUser.handle] : [], savedBy: post.saved ? [currentUser.handle] : [] }];
  }
  return [];
}).filter(post => getUser(post.author));
conversations = (Array.isArray(conversations) ? conversations : []).filter(item =>
  item && Array.isArray(item.memberHandles) && item.memberHandles.length > 1 &&
  item.memberHandles.every(handle => getUser(handle)) && Array.isArray(item.messages)
);
const storedStories = Array.isArray(stories) ? stories.length : 0;
stories = (Array.isArray(stories) ? stories : []).filter(isActiveStory);
if (stories.length !== storedStories) saveStorage("mellow-stories", stories);
if (posts.length !== storedPosts.length) saveStorage("mellow-posts", posts);
if (conversations.length !== readStorage("mellow-conversations", []).length) saveStorage("mellow-conversations", conversations);

const main = document.querySelector("#mainContent");
const authScreen = document.querySelector("#authScreen");
authScreen.addEventListener("input", event => {
  if (event.target instanceof HTMLInputElement && event.target.name === "username") {
    const errorBox = document.querySelector("#authError");
    errorBox.hidden = true;
    errorBox.textContent = "";
  }
});
const composer = document.querySelector("#composerDialog");
const imageInput = document.querySelector("#imageInput");
const imagePreview = document.querySelector("#imagePreview");
const storyImageInput = document.querySelector("#storyImageInput");
const storyImagePreview = document.querySelector("#storyImagePreview");
const storyUploadZone = document.querySelector("#storyUploadZone");
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

function displayHandle(handle) {
  return handle.includes("@") ? handle : `@${handle}`;
}

function getAccounts() {
  const accounts = readStorage("mellow-accounts", []);
  return Array.isArray(accounts) ? accounts.filter(account => account && typeof account.name === "string" && typeof account.handle === "string") : [];
}

function readSessionUser() {
  try {
    const stored = sessionStorage.getItem("mellow-active-user");
    const sessionUser = stored ? JSON.parse(stored) : null;
    if (!sessionUser || typeof sessionUser.handle !== "string") return null;
    const account = getAccounts().find(item => item.handle === sessionUser.handle);
    return account ? { name: account.name, handle: account.handle, avatar: account.avatar || "" } : null;
  } catch (error) {
    console.warn("Could not read the active session.", error);
    sessionStorage.removeItem("mellow-active-user");
    return null;
  }
}

function setCurrentUser(account) {
  currentUser = { name: account.name, handle: account.handle, avatar: account.avatar || "" };
  sessionStorage.setItem("mellow-active-user", JSON.stringify({ handle: currentUser.handle }));
  followed = loadFollowedForCurrentUser();
  notifications = loadNotificationsForCurrentUser();
}

function getUser(handle) {
  const account = getAccounts().find(item => item.handle === handle);
  return account ? { name: account.name, handle: account.handle, avatar: account.avatar || "" } : null;
}

function getPeople() {
  return getAccounts()
    .filter(account => account.handle !== currentUser?.handle)
    .map(account => ({ name: account.name, handle: account.handle, avatar: account.avatar || "" }));
}

function getPostAuthor(post) {
  return getUser(post.author);
}

function isActiveStory(story) {
  return Boolean(
    story && typeof story.id === "string" && typeof story.author === "string" &&
    typeof story.image === "string" && Number.isFinite(story.createdAt) &&
    story.createdAt <= Date.now() && Date.now() - story.createdAt < STORY_LIFETIME &&
    getUser(story.author)
  );
}

function scheduleStoryExpiry() {
  window.clearTimeout(storyExpiryTimer);
  const nextExpiry = stories.reduce((soonest, story) => Math.min(soonest, story.createdAt + STORY_LIFETIME), Infinity);
  if (!Number.isFinite(nextExpiry)) return;
  storyExpiryTimer = window.setTimeout(() => {
    const activeStories = stories.filter(isActiveStory);
    if (activeStories.length !== stories.length) {
      stories = activeStories;
      saveStorage("mellow-stories", stories);
      render();
    }
    scheduleStoryExpiry();
  }, Math.max(0, nextExpiry - Date.now()));
}

function followedStorageKey() {
  return `mellow-followed:${currentUser.handle}`;
}

function notificationsStorageKey(handle = currentUser?.handle) {
  return handle ? `mellow-notifications:${handle}` : null;
}

function loadNotificationsForCurrentUser() {
  const key = notificationsStorageKey();
  if (!key) return [];
  const saved = readStorage(key, []);
  return Array.isArray(saved)
    ? saved.filter(item => item && typeof item.id === "string" && typeof item.actor === "string" && typeof item.type === "string" && Number.isFinite(item.createdAt))
    : [];
}

function addNotification(recipientHandle, { type, actor = currentUser.handle, postId = null, conversationId = null, text = "" }) {
  if (!recipientHandle || recipientHandle === actor || !getUser(recipientHandle)) return;
  const key = notificationsStorageKey(recipientHandle);
  if (!key) return;
  const recipientNotifications = readStorage(key, []);
  const safeNotifications = Array.isArray(recipientNotifications) ? recipientNotifications : [];
  safeNotifications.unshift({
    id: crypto.randomUUID(),
    type,
    actor,
    postId,
    conversationId,
    text: String(text).slice(0, 180),
    createdAt: Date.now(),
    read: false
  });
  saveStorage(key, safeNotifications.slice(0, 100));
}

function markNotificationsRead(ids = null) {
  const readIds = ids ? new Set(ids) : null;
  notifications = notifications.map(item => readIds
    ? readIds.has(item.id) ? { ...item, read: true } : item
    : { ...item, read: true });
  saveStorage(notificationsStorageKey(), notifications);
}

function unreadNotificationCount() {
  return notifications.filter(item => !item.read).length;
}

function renderNotificationBadges() {
  const count = unreadNotificationCount();
  document.querySelectorAll(".notification-count").forEach(badge => {
    badge.hidden = count === 0;
    badge.textContent = count > 99 ? "99+" : String(count);
  });
  document.querySelectorAll(".notification-button").forEach(button => {
    button.setAttribute("aria-label", count ? `Notifications, ${count} unread` : "Notifications");
    button.classList.toggle("has-unread", count > 0);
  });
}

function notificationDescription(item) {
  if (item.type === "like") return "liked your photo";
  if (item.type === "comment") return "commented on your photo";
  if (item.type === "follow") return "started following you";
  if (item.type === "message") return "sent you a message";
  return "interacted with you";
}

function formatNotificationTime(timestamp) {
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" });
}

function renderNotifications() {
  const unread = unreadNotificationCount();
  const sorted = [...notifications].sort((a, b) => b.createdAt - a.createdAt);
  main.innerHTML = `<section class="notifications-page" aria-labelledby="notificationsTitle">
    <header class="notifications-header"><div><h1 class="page-title" id="notificationsTitle">Notifications</h1><p class="page-subtitle">A little update when someone interacts with you.</p></div>
      ${unread ? `<button class="mark-read-button" type="button" data-mark-notifications-read>Mark all as read</button>` : ""}
    </header>
    ${sorted.length ? `<div class="notifications-list">${sorted.map(item => {
      const actor = getUser(item.actor);
      if (!actor) return "";
      const preview = item.type === "comment" || item.type === "message" ? item.text : "";
      return `<button class="notification-item${item.read ? "" : " unread"}" type="button" data-notification-id="${escapeHTML(item.id)}" ${item.postId ? `data-post-target="${escapeHTML(item.postId)}"` : ""} ${item.conversationId ? `data-chat-target="${escapeHTML(item.conversationId)}"` : ""}>
        ${avatar(actor)}<span class="notification-copy"><span><strong>${escapeHTML(actor.name)}</strong> ${notificationDescription(item)}</span>${preview ? `<small>${escapeHTML(preview)}</small>` : ""}<time datetime="${new Date(item.createdAt).toISOString()}">${formatNotificationTime(item.createdAt)}</time></span>
        ${item.postId && posts.find(post => post.id === item.postId)?.image ? `<img class="notification-thumbnail" src="${escapeHTML(posts.find(post => post.id === item.postId).image)}" alt="">` : `<span class="notification-type-icon" aria-hidden="true">${item.type === "follow" ? "＋" : item.type === "message" ? "↗" : item.type === "like" ? "♥" : "▤"}</span>`}
      </button>`;
    }).join("")}</div>` : `<div class="empty-state notifications-empty"><strong>You’re all caught up.</strong><p>When someone follows you, likes a photo, comments, or sends a message, you’ll see it here.</p></div>`}
  </section>`;
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
  authScreen.innerHTML = `<section class="auth-card" aria-labelledby="authTitle">
    <a class="auth-brand" href="#" aria-label="mellow home"><span class="brand-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 17.4c2.4-5.8 5-8.7 8-8.7 2.4 0 3.8 2.8 5.2 6.1s2.7 5.4 4.8 5.4c1.2 0 2.4-.8 3.8-2.5"/><path d="M6 22.1h20"/></svg></span><span>mellow<span class="brand-dot">.</span></span></a>
    <span class="eyebrow">${authMode === "signup" ? "YOUR OWN LITTLE CORNER" : "WELCOME BACK"}</span>
    <h1 id="authTitle">${authMode === "signup" ? "Let’s connect the world." : "Good to see you again."}</h1>
    <p class="auth-intro">${authMode === "signup" ? "Create your account and start sharing with your people." : "Sign in with the username or email and password you chose on this device."}</p>
    <form class="auth-form" id="authForm" novalidate>
      ${authMode === "signup" ? `<label for="authName">Your name</label><input id="authName" name="name" autocomplete="name" maxlength="40" placeholder="Your name" required>` : ""}
      <label for="authUsername">Username or email</label><input id="authUsername" name="username" type="text" autocomplete="username" maxlength="254" placeholder="yourname or you@example.com" required>
      <label for="authPin">Password</label><input id="authPin" name="pin" minlength="6" maxlength="72" autocomplete="${authMode === "signup" ? "new-password" : "current-password"}" placeholder="At least 6 characters" type="password" required>
      <p class="auth-error" id="authError" role="alert" hidden></p>
      <button class="auth-submit" type="submit">${authMode === "signup" ? "Create account" : "Log in"} <span>→</span></button>
    </form>
    <p class="auth-switch">${authMode === "signup" ? `Already have an account? <button type="button" data-auth-mode="login"${authPending ? " disabled" : ""}>Log in</button>` : `New around here? <button type="button" data-auth-mode="signup"${authPending ? " disabled" : ""}>Create an account</button>`}</p>
    <p class="auth-notice"><strong>Portfolio demo only.</strong> Use a throwaway password. Accounts, images, stories, and chats stay in this browser, are not private or synced, and are not shared with visitors on other devices.</p>
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

function avatar(user, color = "member", extraClass = "") {
  const profile = typeof user === "string" ? { name: user, color } : user;
  const name = profile?.name || "User";
  const initial = name.split(" ").map(part => part[0]).slice(0, 2).join("");
  return `<span class="avatar avatar-${escapeHTML(profile.color || color)} ${extraClass}" aria-label="${escapeHTML(name)}">${profile.avatar ? `<img src="${escapeHTML(profile.avatar)}" alt="">` : escapeHTML(initial)}</span>`;
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
  const latestStories = [...stories]
    .sort((left, right) => right.createdAt - left.createdAt)
    .filter((story, index, list) => list.findIndex(item => item.author === story.author) === index);
  const ownStory = latestStories.find(story => story.author === currentUser.handle);
  const otherStories = latestStories.filter(story => story.author !== currentUser.handle);
  return `<section class="stories-section" aria-label="Stories">
    <div class="section-heading"><h2>Little updates</h2><span class="story-expiry">Stories last 24 hours</span></div>
    <div class="stories-row"><span class="story-wrap"><button class="story story-add" type="button" ${ownStory ? `data-story-id="${escapeHTML(ownStory.id)}"` : 'data-own-story="true"'} aria-label="${ownStory ? "View your story" : "Add to your story"}"><span class="story-ring${ownStory ? "" : " seen"}">${ownStory ? `<span class="story-preview" style="background-image:url('${escapeHTML(ownStory.image)}')"></span>` : avatar(currentUser)}</span><span class="story-name">Your story</span></button><button class="story-plus-button" type="button" data-own-story="true" aria-label="Upload a story">+</button></span>${otherStories.map(story => {
    const person = getUser(story.author);
    if (!person) return "";
    return `<button class="story" type="button" data-story-id="${escapeHTML(story.id)}" aria-label="View ${escapeHTML(person.name)}'s story">
      <span class="story-ring"><span class="story-preview" style="background-image:url('${escapeHTML(story.image)}')"></span></span><span class="story-name">${escapeHTML(person.name.split(" ")[0])}</span>
    </button>`;
  }).join("")}</div>
  </section>`;
}

function postMarkup(post) {
  const person = getPostAuthor(post);
  if (!person || !post.image) return "";
  const likesBy = Array.isArray(post.likesBy) ? post.likesBy : [];
  const savedBy = Array.isArray(post.savedBy) ? post.savedBy : [];
  const comments = Array.isArray(post.comments) ? post.comments : [];
  const liked = likesBy.includes(currentUser.handle);
  const saved = savedBy.includes(currentUser.handle);
  const commentList = comments.map(comment => `<div><strong>${escapeHTML(comment.name)}</strong>${escapeHTML(comment.text)}</div>`).join("");
  return `<article class="post-card" data-post-id="${escapeHTML(post.id)}">
    <header class="post-header">${avatar(person)}<div class="post-user"><strong>${escapeHTML(displayHandle(person.handle))}</strong><span>${escapeHTML(post.location || "A little moment")}</span></div></header>
    <div class="post-image-wrap"><img class="post-image" src="${escapeHTML(post.image)}" alt="${escapeHTML(post.caption || "A photo shared by " + person.name)}" loading="lazy"></div>
    <div class="post-actions">
      <button class="post-action like-button${liked ? " liked" : ""}" type="button" aria-label="${liked ? "Unlike" : "Like"} post"><svg viewBox="0 0 24 24"><path d="M20.8 8.7c0 4.2-8.8 10-8.8 10s-8.8-5.8-8.8-10A4.7 4.7 0 0 1 12 6.2a4.7 4.7 0 0 1 8.8 2.5Z"/></svg><span>${likesBy.length}</span></button>
      <button class="post-action comment-focus" type="button" aria-label="Write a comment"><svg viewBox="0 0 24 24"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5 8 8 0 0 1-3.5-.8L4 20l1.5-4A7.4 7.4 0 0 1 4 11.5 7.5 7.5 0 0 1 11.5 4H12a7.5 7.5 0 0 1 8 7.5Z"/></svg><span>${comments.length || ""}</span></button>
      <button class="post-action" type="button" data-share="${escapeHTML(post.id)}" aria-label="Share post"><svg viewBox="0 0 24 24"><path d="m21 3-7.5 18-3.7-7.8L2 9.5 21 3Z"/><path d="M9.8 13.2 21 3"/></svg></button>
      <button class="post-action post-save${saved ? " saved" : ""}" type="button" aria-label="${saved ? "Remove from saved" : "Save post"}"><svg viewBox="0 0 24 24"><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4z"/></svg></button>
    </div>
    <div class="post-caption"><strong>${escapeHTML(displayHandle(person.handle))}</strong>${escapeHTML(post.caption)}</div>
    ${comments.length ? `<div class="comment-list">${commentList}</div>` : `<div class="post-comments">Be the first to say something kind</div>`}
    <form class="comment-form"><input name="comment" maxlength="180" placeholder="Add a comment…" aria-label="Add a comment"><button type="submit">Post</button></form>
  </article>`;
}

function suggestionsMarkup() {
  const suggestions = getPeople().slice(0, 4);
  return `<aside class="right-column" aria-label="Your profile and suggestions">
    <div class="your-profile">${avatar(currentUser)}<div class="profile-copy"><strong>${escapeHTML(currentUser.name)}</strong><small>${escapeHTML(displayHandle(currentUser.handle))}</small></div></div>
    <section class="right-section"><div class="section-heading"><h2 class="right-heading">People to know</h2><button class="see-all" data-view="explore" type="button">See all</button></div>
      ${suggestions.length ? suggestions.map(person => `<div class="friend-row">${avatar(person)}<div class="friend-copy"><strong>${escapeHTML(person.name)}</strong><small>${escapeHTML(displayHandle(person.handle))}</small></div><button class="follow-button${followed.includes(person.handle) ? " following" : ""}" type="button" data-follow="${escapeHTML(person.handle)}">${followed.includes(person.handle) ? "Following" : "Follow"}</button></div>`).join("") : `<p class="page-subtitle">New people will show up here when they join.</p>`}
    </section>
    <div class="footer-links"><a href="#" data-toast="Thanks for being here.">About</a><a href="#" data-toast="Mellow is your space.">Community</a><a href="#" data-toast="Your privacy matters.">Privacy</a><a href="#" data-toast="Be kind to one another 💛">Guidelines</a><a href="#" data-toast="Made for little moments.">About us</a></div>
    <div class="footer-copy">© ${new Date().getFullYear()} MELLOW SOCIAL</div>
  </aside>`;
}

function renderHome() {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visiblePosts = posts.filter(post => {
    const person = getPostAuthor(post);
    if (!person) return false;
    return !normalizedQuery || `${person.name} ${person.handle} ${post.caption} ${post.location || ""}`.toLowerCase().includes(normalizedQuery);
  });
  main.innerHTML = `<div class="content-grid"><section class="feed-column">${storyMarkup()}<div class="feed-posts">${visiblePosts.length ? visiblePosts.map(postMarkup).join("") : `<div class="empty-state"><strong>${normalizedQuery ? "No moments found." : "Your feed is ready for its first post."}</strong><p>${normalizedQuery ? "Try a different search." : "Share a photo or invite someone to join you."}</p>${normalizedQuery ? "" : `<button class="create-button" style="margin-top:16px" type="button" data-open-composer>Create a post</button>`}</div>`}</div></section>${suggestionsMarkup()}</div>`;
}

function conversationTitle(conversation) {
  if (conversation.type === "group" && conversation.name) return conversation.name;
  const people = conversation.memberHandles.filter(handle => handle !== currentUser.handle).map(getUser).filter(Boolean);
  return conversation.type === "group" ? people.map(person => person.name).join(", ") : people[0]?.name || "Conversation";
}

function lastMessage(conversation) {
  return conversation.messages[conversation.messages.length - 1] || null;
}

function conversationAvatar(conversation) {
  if (conversation.type === "group") return `<span class="avatar group-avatar" aria-label="${escapeHTML(conversationTitle(conversation))}">✦</span>`;
  const person = conversation.memberHandles.map(getUser).find(user => user && user.handle !== currentUser.handle);
  return avatar(person || { name: conversationTitle(conversation) });
}

function renderMessages() {
  const available = conversations
    .filter(item => item.memberHandles.includes(currentUser.handle))
    .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
  const conversation = available.find(item => item.id === currentChat) || available[0] || null;
  currentChat = conversation?.id || null;
  main.innerHTML = `<section class="messages-page" aria-label="Direct messages">
    <div class="conversation-list"><div class="messages-heading"><h1>Messages</h1><button type="button" data-start-chat>＋ New</button></div>
      ${available.length ? available.map(item => {
    const last = lastMessage(item);
    return `<button class="conversation-item${item.id === conversation?.id ? " active" : ""}" type="button" data-chat="${escapeHTML(item.id)}">${conversationAvatar(item)}<span class="conversation-info"><strong>${escapeHTML(conversationTitle(item))}</strong><span>${escapeHTML(last ? `${last.sender === currentUser.handle ? "You: " : ""}${last.text}` : "Start the conversation")}</span></span></button>`;
  }).join("") : `<p class="conversation-empty">Your chats will show up here. Start one with any account on this browser.</p>`}
    </div>
    ${conversation ? `<div class="chat-panel"><header class="chat-header">${conversationAvatar(conversation)}<div class="chat-name"><strong>${escapeHTML(conversationTitle(conversation))}</strong><span>${conversation.type === "group" ? `${conversation.memberHandles.length} members` : escapeHTML(displayHandle(conversation.memberHandles.find(handle => handle !== currentUser.handle) || ""))}</span></div></header>
      <div class="chat-messages" id="chatMessages">${conversation.messages.length ? conversation.messages.map(message => {
    const mine = message.sender === currentUser.handle;
    const sender = getUser(message.sender);
    return `${conversation.type === "group" && !mine ? `<span class="message-sender">${escapeHTML(sender?.name || message.sender)}</span>` : ""}<div class="message-bubble${mine ? " mine" : ""}">${escapeHTML(message.text)}</div><span class="message-time${mine ? " mine" : ""}">${escapeHTML(message.time || "")}</span>`;
  }).join("") : `<div class="empty-state chat-empty"><strong>Say hello.</strong><p>This chat is ready when you are.</p></div>`}</div>
      <form class="chat-compose" id="chatForm"><input name="message" maxlength="500" autocomplete="off" placeholder="Write a message…" aria-label="Write a message" required><button type="submit" aria-label="Send message"><svg viewBox="0 0 24 24"><path d="m21 3-7.5 18-3.7-7.8L2 9.5 21 3Z"/><path d="M9.8 13.2 21 3"/></svg></button></form>
    </div>` : `<div class="chat-panel chat-placeholder"><div class="empty-state"><strong>Your conversations, together.</strong><p>Start a direct chat or create a group with anyone who has an account in this browser.</p><button class="create-button" type="button" data-start-chat>＋ New conversation</button></div></div>`}
  </section>`;
  const messageBox = document.querySelector("#chatMessages");
  if (messageBox) messageBox.scrollTop = messageBox.scrollHeight;
}

function renderExplore() {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const people = getPeople().filter(person => `${person.name} ${person.handle}`.toLowerCase().includes(normalizedQuery));
  const moments = posts.filter(post => {
    const author = getPostAuthor(post);
    return author && `${author.name} ${author.handle} ${post.caption || ""}`.toLowerCase().includes(normalizedQuery);
  });
  main.innerHTML = `<h1 class="page-title">Find your people</h1><p class="page-subtitle">Everyone here joined for real. Search for a person and start a chat.</p><section class="explore-people">${people.length ? people.map(person => `<div class="friend-row">${avatar(person)}<div class="friend-copy"><strong>${escapeHTML(person.name)}</strong><small>${escapeHTML(displayHandle(person.handle))}</small></div><button class="follow-button" type="button" data-message-user="${escapeHTML(person.handle)}">Message</button></div>`).join("") : `<div class="empty-state"><strong>No people found.</strong><p>Try another name or username.</p></div>`}</section>${moments.length ? `<div class="explore-grid">${moments.map(post => `<button type="button" data-toast="${escapeHTML(post.caption || "A moment shared by the community")}"><img src="${escapeHTML(post.image)}" alt="${escapeHTML(post.caption || "A moment shared by the community")}" loading="lazy"></button>`).join("")}</div>` : ""}`;
}

function renderSaved() {
  const saved = posts.filter(post => Array.isArray(post.savedBy) && post.savedBy.includes(currentUser.handle));
  main.innerHTML = `<h1 class="page-title">Saved moments</h1><p class="page-subtitle">A little collection of things you want to remember.</p>${saved.length ? `<div class="profile-post-grid">${saved.map(post => `<button type="button" data-toast="${escapeHTML(post.caption)}"><img src="${escapeHTML(post.image)}" alt="${escapeHTML(post.caption)}" loading="lazy"></button>`).join("")}</div>` : `<div class="empty-state saved-empty"><strong>Your little collection is waiting.</strong><p>Save a post you love and it will find a cozy spot here.</p></div>`}`;
}

function renderProfile() {
  const ownPosts = posts.filter(post => post.author === currentUser.handle);
  const followChoices = getPeople();
  main.innerHTML = `<section class="profile-page"><div class="profile-hero">${avatar(currentUser)}<div><h1 class="page-title">${escapeHTML(currentUser.name)}</h1><p class="page-subtitle" style="margin:5px 0">${escapeHTML(displayHandle(currentUser.handle))}</p><div class="profile-stats"><span><strong>${ownPosts.length}</strong> posts</span><span><strong>${followed.length}</strong> following</span></div><label class="profile-photo-button" for="avatarInput">Change profile photo<input id="avatarInput" type="file" accept="image/*"></label></div><button class="logout-button" type="button" data-logout>Log out</button></div>
    <section class="profile-following"><div class="section-heading"><div><h2 class="right-heading">Your community</h2><p class="page-subtitle following-hint">Follow people or start a conversation.</p></div></div>
      ${followChoices.length ? followChoices.map(person => `<div class="friend-row">${avatar(person)}<div class="friend-copy"><strong>${escapeHTML(person.name)}</strong><small>${escapeHTML(displayHandle(person.handle))}</small></div><button class="follow-button${followed.includes(person.handle) ? " following" : ""}" type="button" data-follow="${escapeHTML(person.handle)}">${followed.includes(person.handle) ? "Following" : "Follow"}</button><button class="follow-button" type="button" data-message-user="${escapeHTML(person.handle)}">Message</button></div>`).join("") : `<p class="page-subtitle">You’re the first one here. Invite someone to create an account on this browser.</p>`}
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
  if (currentView === "notifications") renderNotifications();
  document.querySelectorAll("[data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === currentView));
  document.querySelectorAll(".profile-copy strong").forEach(element => { element.textContent = currentUser.name; });
  document.querySelectorAll(".profile-copy small").forEach(element => { element.textContent = displayHandle(currentUser.handle); });
  document.querySelectorAll(".profile-button .avatar, .mobile-profile .avatar, .mobile-nav [data-view='profile'] .avatar").forEach(element => {
    element.innerHTML = currentUser.avatar ? `<img src="${escapeHTML(currentUser.avatar)}" alt="">` : escapeHTML(currentUser.name.split(" ").map(part => part[0]).slice(0, 2).join(""));
    element.setAttribute("aria-label", currentUser.name);
  });
  const mobileProfile = document.querySelector(".mobile-profile");
  if (mobileProfile) mobileProfile.lastElementChild.textContent = currentUser.name;
  renderNotificationBadges();
}

function startDirectChat(handle) {
  const person = getUser(handle);
  if (!person || person.handle === currentUser.handle) return;
  const memberHandles = [currentUser.handle, person.handle].sort();
  let conversation = conversations.find(item => item.type === "direct" && item.memberHandles.length === 2 && memberHandles.every(member => item.memberHandles.includes(member)));
  if (!conversation) {
    conversation = { id: `direct-${memberHandles.join("-")}`, type: "direct", memberHandles, name: "", messages: [], updatedAt: Date.now() };
    conversations.unshift(conversation);
    saveStorage("mellow-conversations", conversations);
  }
  currentChat = conversation.id;
  currentView = "messages";
  render();
}

function openNewChatDialog() {
  const people = getPeople();
  if (!people.length) {
    showToast("Create another account in this browser to start a chat.");
    return;
  }
  document.querySelector("#groupName").value = "";
  document.querySelector("#chatPeopleList").innerHTML = people.map(person => `<label class="chat-person-option">${avatar(person)}<span><strong>${escapeHTML(person.name)}</strong><small>${escapeHTML(displayHandle(person.handle))}</small></span><input type="checkbox" name="members" value="${escapeHTML(person.handle)}"></label>`).join("");
  document.querySelector("#newChatDialog").showModal();
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
  if (target.closest("[data-mark-notifications-read]")) {
    markNotificationsRead();
    render();
    return;
  }
  const notificationButton = target.closest("[data-notification-id]");
  if (notificationButton) {
    const item = notifications.find(notification => notification.id === notificationButton.dataset.notificationId);
    if (!item) return;
    if (!item.read) markNotificationsRead([item.id]);
    if (item.conversationId && conversations.some(conversation => conversation.id === item.conversationId)) {
      currentChat = item.conversationId;
      currentView = "messages";
    } else {
      currentView = item.postId ? "home" : "notifications";
    }
    render();
    if (item.postId) {
      document.querySelector(`[data-post-id="${CSS.escape(item.postId)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
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
  const closeDialog = target.closest(".close-dialog");
  if (closeDialog) closeDialog.closest("dialog")?.close();
  if (target.closest(".story-close")) document.querySelector("#storyDialog").close();
  if (target.closest("[data-start-chat]")) {
    openNewChatDialog();
    return;
  }
  const messageUser = target.closest("[data-message-user]");
  if (messageUser) {
    startDirectChat(messageUser.dataset.messageUser);
    return;
  }
  const toastButton = target.closest("[data-toast]");
  if (toastButton) {
    event.preventDefault();
    showToast(toastButton.dataset.toast);
  }
  const storyCard = target.closest("[data-story-id]");
  if (storyCard) {
    const storyRecord = stories.find(item => item.id === storyCard.dataset.storyId);
    const person = storyRecord && getUser(storyRecord.author);
    if (!storyRecord || !person) return;
    const dialog = document.querySelector("#storyDialog");
    const viewer = dialog.querySelector(".story-viewer");
    viewer.style.backgroundImage = "";
    viewer.innerHTML = `<img class="story-image" src="${escapeHTML(storyRecord.image)}" alt="Story shared by ${escapeHTML(person.name)}"><div class="story-author">${avatar(person)}<span>${escapeHTML(person.name)} <span style="font-weight:400;opacity:.75">${escapeHTML(displayHandle(person.handle))}</span>${storyRecord.caption ? `<span class="story-caption">${escapeHTML(storyRecord.caption)}</span>` : ""}</span></div>`;
    dialog.showModal();
  }
  if (target.closest("[data-own-story]")) document.querySelector("#storyComposerDialog").showModal();

  const chatButton = target.closest("[data-chat]");
  if (chatButton) {
    currentChat = chatButton.dataset.chat;
    renderMessages();
  }
  const followButton = target.closest("[data-follow]");
  if (followButton) {
    const handle = followButton.dataset.follow;
    const wasFollowing = followed.includes(handle);
    followed = wasFollowing ? followed.filter(item => item !== handle) : [...followed, handle];
    if (!wasFollowing) addNotification(handle, { type: "follow" });
    saveStorage(followedStorageKey(), followed);
    render();
  }
  const postCard = target.closest("[data-post-id]");
  if (postCard && target.closest(".like-button")) {
    const post = posts.find(item => item.id === postCard.dataset.postId);
    if (!Array.isArray(post.likesBy)) post.likesBy = [];
    const wasLiked = post.likesBy.includes(currentUser.handle);
    post.likesBy = wasLiked
      ? post.likesBy.filter(handle => handle !== currentUser.handle)
      : [...post.likesBy, currentUser.handle];
    if (!wasLiked) addNotification(post.author, { type: "like", postId: post.id });
    saveStorage("mellow-posts", posts);
    render();
  } else if (postCard && target.closest(".post-save")) {
    const post = posts.find(item => item.id === postCard.dataset.postId);
    if (!Array.isArray(post.savedBy)) post.savedBy = [];
    const wasSaved = post.savedBy.includes(currentUser.handle);
    post.savedBy = wasSaved
      ? post.savedBy.filter(handle => handle !== currentUser.handle)
      : [...post.savedBy, currentUser.handle];
    saveStorage("mellow-posts", posts);
    render();
    showToast(wasSaved ? "Removed from saved moments" : "Saved to your little collection ✨");
  } else if (postCard && target.closest(".comment-focus")) {
    postCard.querySelector(".comment-form input").focus();
  }
  const shareButton = target.closest("[data-share]");
  if (shareButton) {
    const post = posts.find(item => item.id === shareButton.dataset.share);
    if (!post) return;
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
    if (authPending) return;
    const formData = new FormData(form);
    const username = String(formData.get("username") || "").trim().replace(/^@/, "").toLowerCase();
    const pin = String(formData.get("pin") || "");
    const errorBox = document.querySelector("#authError");
    const isUsername = /^[a-z0-9._]{3,20}$/.test(username);
    const isEmail = username.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username);
    if (!isUsername && !isEmail) {
      showAuthError(errorBox, "Enter a username (3–20 letters, numbers, periods, or underscores) or a valid email address.");
      return;
    }
    if (pin.length < 6 || pin.length > 72) {
      showAuthError(errorBox, "Use a password with 6–72 characters.");
      return;
    }
    authPending = true;
    const submitButton = form.querySelector('button[type="submit"]');
    const modeButton = authScreen.querySelector("[data-auth-mode]");
    const formInputs = [...form.querySelectorAll("input")];
    formInputs.forEach(input => { input.disabled = true; });
    submitButton.disabled = true;
    submitButton.textContent = "Please wait…";
    if (modeButton) modeButton.disabled = true;
    try {
      if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
        throw new Error("Secure password hashing is unavailable in this browser context.");
      }
      const accounts = getAccounts();
      if (authMode === "signup") {
        const name = String(formData.get("name") || "").trim();
        if (name.length < 2 || name.length > 40) {
          showAuthError(errorBox, "Enter a name between 2 and 40 characters.");
          return;
        }
        if (accounts.some(account => account.handle.toLowerCase() === username)) {
          showAuthError(errorBox, "That username is already registered on this browser.");
          return;
        }
        const salt = crypto.getRandomValues(new Uint8Array(16));
        accounts.push({ name, handle: username, avatar: "", salt: encodeSalt(salt), pinHash: await hashPin(pin, salt) });
        localStorage.setItem("mellow-accounts", JSON.stringify(accounts));
        setCurrentUser(accounts[accounts.length - 1]);
        showToast("Your account is ready.");
      } else {
        if (!accounts.length) {
          showAuthError(errorBox, "No account is saved in this browser yet. Create an account first.");
          return;
        }
        const account = accounts.find(item => item.handle.toLowerCase() === username);
        const valid = account ? await hashPin(pin, decodeSalt(account.salt)) === account.pinHash : false;
        if (!valid) {
          showAuthError(errorBox, "Username or password is incorrect.");
          return;
        }
        setCurrentUser(account);
      }
      currentView = "home";
      render();
    } catch (error) {
      console.error("Could not complete sign-in.", error);
      showAuthError(errorBox, error instanceof Error && error.message === "Secure password hashing is unavailable in this browser context."
        ? "Password sign-in needs a browser with Web Crypto. Open this site on HTTPS or localhost and try again."
        : "Sign-in failed. Check this browser’s storage access and try again.");
    } finally {
      authPending = false;
      formInputs.forEach(input => {
        if (input.isConnected) input.disabled = false;
      });
      if (submitButton.isConnected) {
        submitButton.disabled = false;
        submitButton.innerHTML = `${authMode === "signup" ? "Create account" : "Log in"} <span>→</span>`;
      }
      if (modeButton?.isConnected) modeButton.disabled = false;
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
    if (!Array.isArray(post.comments)) post.comments = [];
    post.comments.push({ name: currentUser.handle, text });
    addNotification(post.author, { type: "comment", postId: post.id, text });
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
    conversation.messages.push({ text, sender: currentUser.handle, time });
    conversation.updatedAt = Date.now();
    conversation.memberHandles
      .filter(handle => handle !== currentUser.handle)
      .forEach(handle => addNotification(handle, {
        type: "message",
        conversationId: conversation.id,
        text: conversation.type === "group" ? `${currentUser.name}: ${text}` : text
      }));
    saveStorage("mellow-conversations", conversations);
    renderMessages();
    return;
  }
  if (form.id === "newChatForm") {
    event.preventDefault();
    const formData = new FormData(form);
    const handles = [...new Set(formData.getAll("members").map(String))].filter(handle => getUser(handle));
    if (!handles.length) {
      showToast("Choose at least one person to chat with.");
      return;
    }
    const memberHandles = [...new Set([currentUser.handle, ...handles])].sort();
    if (memberHandles.length === 2) {
      startDirectChat(handles[0]);
    } else {
      const name = String(formData.get("groupName") || "").trim();
      const conversation = {
        id: `group-${crypto.randomUUID()}`,
        type: "group",
        name,
        memberHandles,
        messages: [],
        updatedAt: Date.now()
      };
      conversations.unshift(conversation);
      saveStorage("mellow-conversations", conversations);
      currentChat = conversation.id;
      currentView = "messages";
      render();
    }
    document.querySelector("#newChatDialog").close();
    return;
  }
  if (form.id === "storyForm") {
    event.preventDefault();
    if (!selectedStoryImage) {
      showToast("Choose a photo before sharing your story.");
      return;
    }
    stories.unshift({
      id: crypto.randomUUID(),
      author: currentUser.handle,
      image: selectedStoryImage,
      caption: document.querySelector("#storyCaption").value.trim(),
      createdAt: Date.now()
    });
    saveStorage("mellow-stories", stories);
    scheduleStoryExpiry();
    selectedStoryImage = "";
    form.reset();
    storyImagePreview.hidden = true;
    storyImagePreview.removeAttribute("src");
    storyUploadZone.classList.remove("has-image");
    document.querySelector("#storyImageStatus").textContent = "Choose an image to continue";
    document.querySelector("#storyComposerDialog").close();
    render();
    showToast("Your story is live.");
    return;
  }
  if (form.id === "postForm") {
    event.preventDefault();
    if (!selectedImage) {
      showToast("Choose a photo before sharing.");
      return;
    }
    const caption = postCaption.value.trim();
    posts.unshift({ id: crypto.randomUUID(), author: currentUser.handle, image: selectedImage, time: Date.now(), caption, likesBy: [], savedBy: [], comments: [] });
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

storyImageInput.addEventListener("change", async () => {
  const file = storyImageInput.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("Please choose an image file.");
    storyImageInput.value = "";
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast("That image is a little too big. Please choose one under 10 MB.");
    storyImageInput.value = "";
    return;
  }
  try {
    selectedStoryImage = await compressImage(file);
    storyImagePreview.src = selectedStoryImage;
    storyImagePreview.hidden = false;
    storyUploadZone.classList.add("has-image");
    document.querySelector("#storyImageStatus").textContent = "Photo ready to share";
  } catch (error) {
    console.error("Could not prepare the selected story image.", error);
    showToast("Couldn't prepare that image. Please try another one.");
  }
});

document.addEventListener("change", async event => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.id !== "avatarInput") return;
  const file = input.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
    showToast("Choose an image under 10 MB.");
    input.value = "";
    return;
  }
  try {
    const avatarImage = await compressImage(file);
    const accounts = getAccounts();
    const account = accounts.find(item => item.handle === currentUser.handle);
    if (!account) throw new Error("The current account is no longer available.");
    account.avatar = avatarImage;
    saveStorage("mellow-accounts", accounts);
    setCurrentUser(account);
    render();
    showToast("Profile photo updated.");
  } catch (error) {
    console.error("Could not update the profile photo.", error);
    showToast("Couldn't update the profile photo. Please try another image.");
  }
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
document.querySelector("#storyComposerDialog").addEventListener("click", event => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});
document.querySelector("#newChatDialog").addEventListener("click", event => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});

window.addEventListener("storage", event => {
  if (event.key === "mellow-posts") posts = readStorage("mellow-posts", []);
  if (event.key === "mellow-conversations") conversations = readStorage("mellow-conversations", []);
  if (event.key === notificationsStorageKey()) notifications = loadNotificationsForCurrentUser();
  if (event.key === "mellow-stories") {
    const stored = readStorage("mellow-stories", []);
    stories = (Array.isArray(stored) ? stored : []).filter(isActiveStory);
    scheduleStoryExpiry();
  }
  if (event.key === "mellow-accounts") {
    if (currentUser) currentUser = getUser(currentUser.handle);
    if (!currentUser) {
      currentView = "home";
      sessionStorage.removeItem("mellow-active-user");
    }
  }
  if (["mellow-posts", "mellow-conversations", "mellow-stories", "mellow-accounts", notificationsStorageKey()].includes(event.key)) render();
});

render();
scheduleStoryExpiry();
