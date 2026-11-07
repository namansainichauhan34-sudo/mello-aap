let posts = [];
let conversations = [];
let stories = [];
let cloudAccounts = [];
let cloudAuthUser = null;
let supabaseClient = null;
let cloudChannel = null;
let syncing = false;
const STORY_LIFETIME = 24 * 60 * 60 * 1000;
let storyExpiryTimer;
let currentView = "home";
let currentChat = null;
let searchQuery = "";
let selectedImage = "";
let selectedStoryImage = "";
let toastTimer;
let authMode = "signup";
let authPending = false;
let currentUser = null;
let followed = [];
let notifications = [];

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

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function displayHandle(handle) {
  return handle.includes("@") ? handle : `@${handle}`;
}

function getAccounts() { return cloudAccounts; }
function readSessionUser() { return currentUser; }
function setCurrentUser(account) {
  currentUser = { uid: account.uid, name: account.name, handle: account.handle, avatar: account.avatar || "" };
}
function getUser(handle) {
  const account = getAccounts().find(item => item.handle === handle);
  return account ? { uid: account.uid, name: account.name, handle: account.handle, avatar: account.avatar || "" } : null;
}

function getPeople() {
  return getAccounts()
    .filter(account => account.handle !== currentUser?.handle)
    .map(account => ({ uid: account.uid, name: account.name, handle: account.handle, avatar: account.avatar || "" }));
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
      render();
    }
    scheduleStoryExpiry();
  }, Math.max(0, nextExpiry - Date.now()));
}

function loadNotificationsForCurrentUser() { return notifications; }
async function addNotification(recipientHandle, { type, actor = currentUser?.handle, postId = null, conversationId = null, text = "" }) {
  const recipient = getUser(recipientHandle);
  if (!recipient || recipient.handle === actor || !cloudAuthUser) return;
  const { error } = await supabaseClient.from("mellow_notifications").insert({
    recipient_id: recipient.uid, actor_id: cloudAuthUser.id, type,
    post_id: postId, conversation_id: conversationId, text: String(text).slice(0, 180)
  });
  if (error) console.warn("Notification not saved:", error.message);
}
async function markNotificationsRead(ids = null) {
  const targets = notifications.filter(item => !item.read && (!ids || ids.includes(item.id))).map(item => item.id);
  if (!targets.length || !cloudAuthUser) return;
  const { error } = await supabaseClient.from("mellow_notifications")
    .update({ read: true }).in("id", targets).eq("recipient_id", cloudAuthUser.id);
  if (error) { showToast("Couldn't mark notifications as read."); return; }
  notifications = notifications.map(item => targets.includes(item.id) ? { ...item, read: true } : item);
  if (currentView === "notifications") render(); else renderNotificationBadges();
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

function loadFollowedForCurrentUser() { return followed; }
function renderAuth() {
  document.body.classList.add("auth-mode");
  authScreen.hidden = false;
  authScreen.innerHTML = `<section class="auth-card" aria-labelledby="authTitle">
    <a class="auth-brand" href="#" aria-label="mellow home"><span class="brand-mark">✳</span><span>mellow<span class="brand-dot">.</span></span></a>
    <span class="eyebrow">${authMode === "signup" ? "YOUR OWN LITTLE CORNER" : "WELCOME BACK"}</span>
    <h1 id="authTitle">${authMode === "signup" ? "Let’s connect the world." : "Good to see you again."}</h1>
    <p class="auth-intro">${authMode === "signup" ? "Create an account to share photos and message people on other devices." : "Sign in using your email and password."}</p>
    <form class="auth-form" id="authForm" novalidate>
      ${authMode === "signup" ? `<label for="authName">Your name</label><input id="authName" name="name" autocomplete="name" maxlength="40" placeholder="Your name" required>
      <label for="authUsername">Username</label><input id="authUsername" name="username" type="text" autocomplete="username" maxlength="20" placeholder="yourname" required>` : ""}
      <label for="authEmail">Email</label><input id="authEmail" name="email" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com" required>
      <label for="authPin">Password</label><input id="authPin" name="pin" minlength="6" maxlength="72" autocomplete="${authMode === "signup" ? "new-password" : "current-password"}" placeholder="At least 6 characters" type="password" required>
      <p class="auth-error" id="authError" role="alert" hidden></p>
      <button class="auth-submit" type="submit">${authMode === "signup" ? "Create account" : "Log in"} <span>→</span></button>
    </form>
    <p class="auth-switch">${authMode === "signup" ? `Already have an account? <button type="button" data-auth-mode="login">Log in</button>` : `New around here? <button type="button" data-auth-mode="signup">Create an account</button>`}</p>
    <p class="auth-notice"><strong>Small community test.</strong> Accounts, chats and photos are shared between devices through Supabase. Email ownership is not verified if you disable Confirm email. Do not use a password you use elsewhere or share private images.</p>
  </section>`;
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
  const oldInput = document.querySelector("#chatForm input");
  const oldDraft = oldInput?.value || "";
  const wasFocused = oldInput && document.activeElement === oldInput;
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
  }).join("") : `<p class="conversation-empty">Your chats will show up here. Start one with any member who has signed up.</p>`}
    </div>
    ${conversation ? `<div class="chat-panel"><header class="chat-header">${conversationAvatar(conversation)}<div class="chat-name"><strong>${escapeHTML(conversationTitle(conversation))}</strong><span>${conversation.type === "group" ? `${conversation.memberHandles.length} members` : escapeHTML(displayHandle(conversation.memberHandles.find(handle => handle !== currentUser.handle) || ""))}</span></div></header>
      <div class="chat-messages" id="chatMessages">${conversation.messages.length ? conversation.messages.map(message => {
    const mine = message.sender === currentUser.handle;
    const sender = getUser(message.sender);
    return `${conversation.type === "group" && !mine ? `<span class="message-sender">${escapeHTML(sender?.name || message.sender)}</span>` : ""}<div class="message-bubble${mine ? " mine" : ""}">${escapeHTML(message.text)}</div><span class="message-time${mine ? " mine" : ""}">${escapeHTML(message.time || "")}</span>`;
  }).join("") : `<div class="empty-state chat-empty"><strong>Say hello.</strong><p>This chat is ready when you are.</p></div>`}</div>
      <form class="chat-compose" id="chatForm"><input name="message" maxlength="500" autocomplete="off" placeholder="Write a message…" aria-label="Write a message" required><button type="submit" aria-label="Send message"><svg viewBox="0 0 24 24"><path d="m21 3-7.5 18-3.7-7.8L2 9.5 21 3Z"/><path d="M9.8 13.2 21 3"/></svg></button></form>
    </div>` : `<div class="chat-panel chat-placeholder"><div class="empty-state"><strong>Your conversations, together.</strong><p>Start a direct chat with anyone who has signed up.</p><button class="create-button" type="button" data-start-chat>＋ New conversation</button></div></div>`}
  </section>`;
  const newInput = document.querySelector("#chatForm input");
  if (newInput && oldInput) { newInput.value = oldDraft; if (wasFocused) newInput.focus(); }
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
      ${followChoices.length ? followChoices.map(person => `<div class="friend-row">${avatar(person)}<div class="friend-copy"><strong>${escapeHTML(person.name)}</strong><small>${escapeHTML(displayHandle(person.handle))}</small></div><button class="follow-button${followed.includes(person.handle) ? " following" : ""}" type="button" data-follow="${escapeHTML(person.handle)}">${followed.includes(person.handle) ? "Following" : "Follow"}</button><button class="follow-button" type="button" data-message-user="${escapeHTML(person.handle)}">Message</button></div>`).join("") : `<p class="page-subtitle">You’re the first one here. Invite someone to sign up using your website link.</p>`}
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
  }
  currentChat = conversation.id;
  currentView = "messages";
  render();
}

function openNewChatDialog() {
  const people = getPeople();
  if (!people.length) {
    showToast("Ask a friend to sign up on your website first.");
    return;
  }
  document.querySelector("#groupName").value = "";
  document.querySelector("#groupName").closest("label").style.display = "none";
  document.querySelector("#groupName").style.display = "none";
  document.querySelector("#chatPeopleList").innerHTML = people.map(person => `<label class="chat-person-option">${avatar(person)}<span><strong>${escapeHTML(person.name)}</strong><small>${escapeHTML(displayHandle(person.handle))}</small></span><input type="checkbox" name="members" value="${escapeHTML(person.handle)}"></label>`).join("");
  document.querySelector("#newChatDialog").showModal();
}

document.addEventListener("click", async event => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const authModeButton = target.closest("[data-auth-mode]");
  if (authModeButton) {
    authMode = authModeButton.dataset.authMode;
    renderAuth();
    return;
  }
  if (target.closest("[data-logout]")) {
    supabaseClient.auth.signOut().then(({ error }) => {
      if (error) { showToast(error.message); return; }
      resetCloudState();
      authMode = "login";
      render();
    });
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
    const person = getUser(followButton.dataset.follow);
    if (!person || !cloudAuthUser) return;
    const wasFollowing = followed.includes(person.handle);
    const query = supabaseClient.from("mellow_follows");
    const { error } = wasFollowing
      ? await query.delete().eq("follower_id", cloudAuthUser.id).eq("followed_id", person.uid)
      : await query.insert({ follower_id: cloudAuthUser.id, followed_id: person.uid });
    if (error) { showToast(error.message); return; }
    if (!wasFollowing) void addNotification(person.handle, { type: "follow" });
    await reloadFollows();
    render();
  }
  const postCard = target.closest("[data-post-id]");
  if (postCard && target.closest(".like-button, .post-save")) {
    const post = posts.find(item => item.id === postCard.dataset.postId);
    if (!post) return;
    const isLike = Boolean(target.closest(".like-button"));
    const table = isLike ? "mellow_likes" : "mellow_bookmarks";
    const marked = (isLike ? post.likesBy : post.savedBy).includes(currentUser.handle);
    const query = supabaseClient.from(table);
    const { error } = marked
      ? await query.delete().eq("post_id", post.id).eq("user_id", cloudAuthUser.id)
      : await query.insert({ post_id: post.id, user_id: cloudAuthUser.id });
    if (error) { showToast(error.message); return; }
    if (isLike && !marked) void addNotification(post.author, { type: "like", postId: post.id });
    await reloadPosts();
    render();
    if (!isLike) showToast(marked ? "Removed from saved moments" : "Saved to your collection");
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
    const email = String(formData.get("email") || "").trim().toLowerCase();
    const password = String(formData.get("pin") || "");
    const handle = String(formData.get("username") || "").trim().replace(/^@/, "").toLowerCase();
    const name = String(formData.get("name") || "").trim();
    const errorBox = document.querySelector("#authError");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showAuthError(errorBox, "Enter a valid email address."); return; }
    if (authMode === "signup" && (!/^[a-z0-9._]{3,20}$/.test(handle) || name.length < 2 || name.length > 40)) {
      showAuthError(errorBox, "Enter your name and a username with 3–20 letters, numbers, . or _."); return;
    }
    if (password.length < 6 || password.length > 72) { showAuthError(errorBox, "Use a password of 6–72 characters."); return; }
    authPending = true;
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = "Please wait…";
    try {
      const result = authMode === "signup"
        ? await supabaseClient.auth.signUp({ email, password, options: { data: { full_name: name, handle } } })
        : await supabaseClient.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (!result.data.session) throw new Error("No session created. Turn OFF Confirm email in Supabase Authentication → Sign In / Providers, then try again.");
      await loadCloudState(result.data.session.user);
      currentView = "home";
      render();
      showToast(authMode === "signup" ? "Your account is ready!" : "Welcome back!");
    } catch (error) {
      console.error("Authentication failed:", error);
      showAuthError(errorBox, error.message || "Couldn't sign in. Check your settings and try again.");
    } finally {
      authPending = false;
      if (submitButton.isConnected) {
        submitButton.disabled = false;
        submitButton.innerHTML = `${authMode === "signup" ? "Create account" : "Log in"} <span>→</span>`;
      }
    }
    return;
  }
  if (form.matches(".comment-form")) {
    event.preventDefault();
    const input = form.elements.namedItem("comment");
    const text = input.value.trim();
    const post = posts.find(item => item.id === form.closest("[data-post-id]")?.dataset.postId);
    if (!text || !post) return;
    const { error } = await supabaseClient.from("mellow_comments")
      .insert({ post_id: post.id, user_id: cloudAuthUser.id, content: text });
    if (error) { showToast(error.message); return; }
    void addNotification(post.author, { type: "comment", postId: post.id, text });
    await reloadPosts();
    render();
    return;
  }
  if (form.id === "chatForm") {
    event.preventDefault();
    const input = form.elements.namedItem("message");
    const text = input.value.trim();
    const chat = conversations.find(item => item.id === currentChat);
    if (!text || !chat || chat.type !== "direct") return;
    const recipientHandle = chat.memberHandles.find(handle => handle !== currentUser.handle);
    const recipient = getUser(recipientHandle);
    if (!recipient) { showToast("Recipient not found. Refresh the page."); return; }
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    const { error } = await supabaseClient.from("messages")
      .insert({ sender_id: cloudAuthUser.id, receiver_id: recipient.uid, content: text });
    submitButton.disabled = false;
    if (error) { showToast("Message not sent: " + error.message); return; }
    input.value = "";
    void addNotification(recipientHandle, { type: "message", conversationId: chat.id, text });
    await reloadMessages();
    renderMessages();
    return;
  }
  if (form.id === "newChatForm") {
    event.preventDefault();
    const handles = [...new Set(new FormData(form).getAll("members").map(String))].filter(handle => getUser(handle));
    if (handles.length !== 1) { showToast("Choose exactly one person. This test supports private one-to-one chats."); return; }
    startDirectChat(handles[0]);
    document.querySelector("#newChatDialog").close();
    return;
  }
  if (form.id === "storyForm") {
    event.preventDefault();
    if (!selectedStoryImage) { showToast("Choose a photo before sharing your story."); return; }
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const imageUrl = await uploadPhoto(selectedStoryImage);
      const { error } = await supabaseClient.from("mellow_stories").insert({
        user_id: cloudAuthUser.id, image_url: imageUrl,
        caption: document.querySelector("#storyCaption").value.trim()
      });
      if (error) throw error;
      await reloadStories();
      selectedStoryImage = "";
      form.reset();
      storyImagePreview.hidden = true;
      storyImagePreview.removeAttribute("src");
      storyUploadZone.classList.remove("has-image");
      document.querySelector("#storyImageStatus").textContent = "Choose an image to continue";
      document.querySelector("#storyComposerDialog").close();
      render();
      showToast("Your story is live.");
    } catch (error) { showToast("Story upload failed: " + error.message); }
    finally { submit.disabled = false; }
    return;
  }
  if (form.id === "postForm") {
    event.preventDefault();
    if (!selectedImage) { showToast("Choose a photo before sharing."); return; }
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const imageUrl = await uploadPhoto(selectedImage);
      const { error } = await supabaseClient.from("mellow_posts")
        .insert({ user_id: cloudAuthUser.id, image_url: imageUrl, caption: postCaption.value.trim() });
      if (error) throw error;
      await reloadPosts();
      form.reset();
      selectedImage = "";
      imagePreview.hidden = true;
      uploadZone.classList.remove("has-image");
      composer.close();
      currentView = "home";
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
      showToast("Photo shared with your community!");
    } catch (error) { showToast("Photo upload failed: " + error.message); }
    finally { submit.disabled = false; }
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
    showToast("Choose an image under 10 MB."); input.value = ""; return;
  }
  try {
    const url = await uploadPhoto(await compressImage(file));
    const { error } = await supabaseClient.from("profiles")
      .update({ avatar_url: url }).eq("id", cloudAuthUser.id);
    if (error) throw error;
    const account = cloudAccounts.find(item => item.uid === cloudAuthUser.id);
    account.avatar = url;
    setCurrentUser(account);
    render();
    showToast("Profile photo updated.");
  } catch (error) { showToast("Couldn't update your profile photo: " + error.message); }
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

// Supabase holds all shared data; no localStorage-based account or content syncing.
bootstrapMellow();


// ---------- Real Supabase data layer ----------
function cloudError(result, operation) {
  if (result.error) throw new Error(`${operation}: ${result.error.message}`);
  return result.data || [];
}

function lookupHandle(userId) {
  return cloudAccounts.find(account => account.uid === userId)?.handle || null;
}

function resetCloudState() {
  cloudAuthUser = null; currentUser = null; cloudAccounts = []; posts = [];
  conversations = []; stories = []; notifications = []; followed = []; currentChat = null;
  if (cloudChannel && supabaseClient) supabaseClient.removeChannel(cloudChannel);
  cloudChannel = null;
}

async function reloadProfiles() {
  const rows = cloudError(await supabaseClient.from("profiles")
    .select("id, handle, name, avatar_url").order("created_at", { ascending: true }).limit(200), "Profiles");
  cloudAccounts = rows.map(row => ({ uid: row.id, name: row.name, handle: row.handle, avatar: row.avatar_url || "" }));
}

async function reloadMessages() {
  if (!cloudAuthUser) return;
  const uid = cloudAuthUser.id;
  const rows = cloudError(await supabaseClient.from("messages")
    .select("id, sender_id, receiver_id, content, created_at")
    .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`)
    .order("created_at", { ascending: true }).limit(1000), "Messages");
  const oldEmpty = conversations.filter(chat => chat.type === "direct" && chat.messages.length === 0);
  const grouped = new Map(oldEmpty.map(chat => [chat.id, { ...chat, messages: [] }]));
  for (const row of rows) {
    const otherId = row.sender_id === uid ? row.receiver_id : row.sender_id;
    const otherHandle = lookupHandle(otherId);
    if (!otherHandle || !currentUser) continue;
    const handles = [currentUser.handle, otherHandle].sort();
    const id = `direct-${handles.join("-")}`;
    if (!grouped.has(id)) grouped.set(id, { id, type: "direct", name: "", memberHandles: handles, messages: [], updatedAt: 0 });
    const chat = grouped.get(id);
    chat.messages.push({ sender: lookupHandle(row.sender_id), text: row.content,
      time: new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
    chat.updatedAt = Math.max(chat.updatedAt || 0, new Date(row.created_at).getTime());
  }
  conversations = [...grouped.values()];
}

async function reloadPosts() {
  if (!cloudAuthUser) return;
  const [postRows, likeRows, bookmarkRows, commentRows] = await Promise.all([
    supabaseClient.from("mellow_posts").select("id,user_id,image_url,caption,created_at")
      .order("created_at", { ascending: false }).limit(200),
    supabaseClient.from("mellow_likes").select("post_id,user_id").limit(1000),
    supabaseClient.from("mellow_bookmarks").select("post_id,user_id").eq("user_id", cloudAuthUser.id).limit(1000),
    supabaseClient.from("mellow_comments").select("post_id,user_id,content,created_at")
      .order("created_at", { ascending: true }).limit(1000)
  ]);
  const pr = cloudError(postRows, "Posts");
  const lr = cloudError(likeRows, "Likes");
  const br = cloudError(bookmarkRows, "Bookmarks");
  const cr = cloudError(commentRows, "Comments");
  posts = pr.map(p => ({ id: p.id, author: lookupHandle(p.user_id), image: p.image_url,
    caption: p.caption, time: new Date(p.created_at).getTime(),
    likesBy: lr.filter(x => x.post_id === p.id).map(x => lookupHandle(x.user_id)).filter(Boolean),
    savedBy: br.filter(x => x.post_id === p.id).map(x => lookupHandle(x.user_id)).filter(Boolean),
    comments: cr.filter(x => x.post_id === p.id).map(x => ({ name: lookupHandle(x.user_id) || "member", text: x.content }))
  })).filter(p => Boolean(p.author));
}

async function reloadStories() {
  const since = new Date(Date.now() - STORY_LIFETIME).toISOString();
  const rows = cloudError(await supabaseClient.from("mellow_stories")
    .select("id,user_id,image_url,caption,created_at").gt("created_at", since)
    .order("created_at", { ascending: false }).limit(200), "Stories");
  stories = rows.map(s => ({ id: s.id, author: lookupHandle(s.user_id), image: s.image_url,
    caption: s.caption, createdAt: new Date(s.created_at).getTime() })).filter(isActiveStory);
  scheduleStoryExpiry();
}

async function reloadFollows() {
  if (!cloudAuthUser) return;
  const rows = cloudError(await supabaseClient.from("mellow_follows")
    .select("followed_id").eq("follower_id", cloudAuthUser.id).limit(200), "Follows");
  followed = rows.map(row => lookupHandle(row.followed_id)).filter(Boolean);
}

async function reloadNotifications() {
  if (!cloudAuthUser) return;
  const rows = cloudError(await supabaseClient.from("mellow_notifications")
    .select("id, actor_id, type, post_id, conversation_id, text, created_at, read")
    .eq("recipient_id", cloudAuthUser.id).order("created_at", { ascending: false }).limit(100), "Notifications");
  notifications = rows.map(n => ({ id: n.id, actor: lookupHandle(n.actor_id) || "member", type: n.type,
    postId: n.post_id, conversationId: n.conversation_id, text: n.text,
    createdAt: new Date(n.created_at).getTime(), read: n.read }));
  if (currentUser) renderNotificationBadges();
}

async function loadCloudState(authUser) {
  cloudAuthUser = authUser;
  await reloadProfiles();
  const account = cloudAccounts.find(u => u.uid === authUser.id);
  if (!account) throw new Error("Profile missing. Run supabase-setup.sql in the SQL Editor before signing up.");
  setCurrentUser(account);
  await Promise.all([reloadMessages(), reloadPosts(), reloadStories(), reloadFollows(), reloadNotifications()]);
  listenForCloudUpdates();
}

async function uploadPhoto(dataUrl) {
  if (!cloudAuthUser) throw new Error("Log in before uploading.");
  const blob = await (await fetch(dataUrl)).blob();
  const path = `${cloudAuthUser.id}/${crypto.randomUUID()}.webp`;
  const { error } = await supabaseClient.storage.from("mellow-media")
    .upload(path, blob, { contentType: "image/webp", upsert: false });
  if (error) throw error;
  return supabaseClient.storage.from("mellow-media").getPublicUrl(path).data.publicUrl;
}

function listenForCloudUpdates() {
  if (cloudChannel) supabaseClient.removeChannel(cloudChannel);
  cloudChannel = supabaseClient.channel("mellow-updates-" + cloudAuthUser.id)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, async payload => {
      if (!cloudAuthUser || (payload.new.sender_id !== cloudAuthUser.id && payload.new.receiver_id !== cloudAuthUser.id)) return;
      try { await reloadMessages(); if (currentView === "messages") renderMessages(); }
      catch (error) { console.warn(error); }
    })
    .subscribe();
}

async function refreshCommunity() {
  if (!cloudAuthUser || syncing) return;
  syncing = true;
  try {
    const oldProfiles = JSON.stringify(cloudAccounts);
    const oldMessages = JSON.stringify(conversations.map(c => [c.id, c.messages]));
    const oldPosts = JSON.stringify(posts);
    const oldStories = JSON.stringify(stories);
    const oldNotifications = JSON.stringify(notifications);
    await reloadProfiles();
    const newCurrent = cloudAccounts.find(x => x.uid === cloudAuthUser.id);
    if (newCurrent) setCurrentUser(newCurrent);
    await Promise.all([reloadMessages(), reloadPosts(), reloadStories(), reloadFollows(), reloadNotifications()]);
    if (currentView === "messages") {
      if (JSON.stringify(conversations.map(c => [c.id, c.messages])) !== oldMessages) renderMessages();
    } else if ((currentView === "home" || currentView === "explore" || currentView === "profile" || currentView === "saved")
      && (JSON.stringify(posts) !== oldPosts || JSON.stringify(stories) !== oldStories || JSON.stringify(cloudAccounts) !== oldProfiles)) render();
    else if (currentView === "notifications" && JSON.stringify(notifications) !== oldNotifications) render();
  } catch (error) { console.warn("Cloud refresh:", error.message); }
  finally { syncing = false; }
}

async function bootstrapMellow() {
  const url = window.MELLOW_SUPABASE_URL;
  const key = window.MELLOW_SUPABASE_PUBLISHABLE_KEY;
  if (!window.supabase?.createClient || !url || !key || url.includes("YOUR-PROJECT") || key.includes("REPLACE_ME")) {
    document.body.classList.add("auth-mode");
    authScreen.hidden = false;
    authScreen.innerHTML = `<section class="auth-card"><h1>Connect Mellow to Supabase</h1>
      <p class="auth-intro">Open <strong>config.js</strong> and paste your Supabase Project URL and <strong>sb_publishable_...</strong> key. First run <strong>supabase-setup.sql</strong> in Supabase SQL Editor. Then refresh this page.</p>
      <p class="auth-notice">Never paste your sb_secret_ or service_role key into these public files.</p></section>`;
    return;
  }
  supabaseClient = window.supabase.createClient(url, key);
  document.body.classList.add("auth-mode");
  authScreen.hidden = false;
  authScreen.innerHTML = `<section class="auth-card"><h1>Connecting…</h1><p class="auth-intro">Loading your community.</p></section>`;
  try {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    if (data.session?.user) await loadCloudState(data.session.user);
    authMode = "login";
    render();
  } catch (error) {
    console.error(error);
    resetCloudState();
    authMode = "login";
    render();
    showToast("Supabase setup error: " + error.message);
  }
  supabaseClient.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") { resetCloudState(); authMode = "login"; render(); }
  });
  // Polling keeps the test functioning even when Realtime is unavailable or disconnected.
  window.setInterval(refreshCommunity, 8000);
}
