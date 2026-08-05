import { invoke } from "@tauri-apps/api/core";
import { sendNotification, isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import {
  parseRepoInput,
  getRepoInfo,
  getBranches,
  getBranchCommits,
} from "./lib/api";
import {
  loadRepos,
  addRepo,
  updateRepo,
  removeRepo,
  getToken,
} from "./lib/store";
import type { Commit, WatchedRepo, PollResult, Status } from "./lib/types";

const POLL_MS = 60_000;

const feed = document.getElementById("feed") as HTMLElement;
const emptyState = document.getElementById("emptyState") as HTMLElement;
const addForm = document.getElementById("addForm") as HTMLFormElement;
const repoInput = document.getElementById("repoInput") as HTMLInputElement;
const addBtn = document.getElementById("addBtn") as HTMLButtonElement;
const statusDot = document.getElementById("liveDot") as HTMLElement;
const toasts = document.getElementById("toasts") as HTMLElement;

let repos: WatchedRepo[] = [];
let polling = false;

function log(line: string): void {
  const ts = new Date().toISOString();
  const entry = `${ts}  ${line}`;
  console.log(entry);
  invoke("append_log", { line: entry }).catch(() => {
    // logging is best-effort
  });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function setStatus(status: Status): void {
  statusDot.className = `live-dot ${status === "idle" ? "" : status}`;
}

function render(): void {
  if (repos.length === 0) {
    emptyState.style.display = "flex";
    feed.querySelectorAll(".section").forEach((el) => el.remove());
    return;
  }
  emptyState.style.display = "none";

  feed.querySelectorAll(".section").forEach((el) => el.remove());

  repos.forEach((repo) => {
    const section = document.createElement("section");
    section.className = "section";
    const label = document.createElement("div");
    label.className = "section-label";
    label.innerHTML = `
      <span>${esc(repo.full_name)}</span>
      <button class="remove-btn" data-id="${esc(repo.id)}" title="Stop watching">✕</button>
    `;
    const rows = document.createElement("div");
    rows.className = "repo-rows";
    rows.dataset.repo = repo.id;
    section.appendChild(label);
    section.appendChild(rows);
    feed.appendChild(section);
  });

  feed.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const id = (e.currentTarget as HTMLElement).dataset.id!;
      removeRepo(id);
      repos = loadRepos();
      render();
    });
  });
}

function addCommitCard(repo: WatchedRepo, commit: Commit): void {
  const container = feed.querySelector<HTMLElement>(`.repo-rows[data-repo="${repo.id}"]`);
  if (!container) return;

  const avatar = commit.author.avatar_url
    ? `background-image:url('${commit.author.avatar_url}')`
    : "";
  const hasImg = !!commit.author.avatar_url;

  const row = document.createElement("article");
  row.className = "commit is-new";
  row.innerHTML = `
    <div class="avatar ${hasImg ? "" : "fallback"}" style="${avatar}">${hasImg ? "" : esc(initials(commit.author.name))}</div>
    <div class="commit-body">
      <span class="commit-msg">${esc(commit.message)}</span>
    </div>
    <div class="commit-meta">
      <span class="branch-badge">${esc(commit.branch)}</span>
      <span class="author">${esc(commit.author.name)}</span>
      <span class="sha">${shortSha(commit.sha)}</span>
    </div>
  `;

  container.prepend(row);
}

function addToast(title: string, body: string): void {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <div class="toast-title"><span class="dot"></span>${esc(title)}</div>
    <div class="toast-body">${esc(body)}</div>
  `;
  toasts.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("out");
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

async function ensureNotifPermission(): Promise<void> {
  try {
    if (!(await isPermissionGranted())) {
      await requestPermission();
    }
  } catch {
    // Notifications unavailable (e.g. plain browser) — in-app toasts still work.
  }
}

async function notifyCommit(repo: WatchedRepo, commit: Commit): Promise<void> {
  const title = `${repo.full_name} · ${commit.branch}`;
  const body = `${commit.author.name}: ${commit.message}`;
  addToast(title, body);
  try {
    sendNotification({ title, body });
  } catch {
    // ignore
  }
}

function stripAvatarQuery(url?: string): string | undefined {
  if (!url) return undefined;
  const base = url.split("?v=")[0];
  return base + "?s=96";
}

async function watchCommits(repo: WatchedRepo, token?: string): Promise<Commit[]> {
  const [owner, name] = repo.full_name.split("/");
  const newCommits: Commit[] = [];
  const nextBranches: Record<string, string> = { ...repo.branches };

  const branches = await getBranches(owner, name, token);
  for (const branch of branches) {
    const raws = await getBranchCommits(owner, name, branch.name, token);
    if (raws.length === 0) continue;

    const known = repo.branches[branch.name];
    const isFirst = !known;

    if (isFirst) {
      nextBranches[branch.name] = raws[0].sha;
      log(`baseline ${repo.full_name}#${branch.name} = ${raws[0].sha.slice(0, 7)} (${raws.length} commits, no notify)`);
      continue;
    }

    const knownIdx = raws.findIndex((c) => c.sha === known);
    const cutoff = knownIdx === -1 ? raws.length : knownIdx;
    nextBranches[branch.name] = raws[0].sha;

    log(`poll ${repo.full_name}#${branch.name}: head=${raws[0].sha.slice(0, 7)} known=${known.slice(0, 7)} atIdx=${knownIdx} -> new=${cutoff}`);

    for (let i = 0; i < cutoff; i++) {
      const c = raws[i];
      newCommits.push({
        sha: c.sha,
        message: c.message,
        author: {
          name: c.authorName,
          email: "",
          login: c.authorLogin,
          avatar_url: stripAvatarQuery(c.avatarUrl),
        },
        date: c.date,
        branch: branch.name,
        html_url: c.htmlUrl,
      });
    }
  }

  const updated: WatchedRepo = { ...repo, branches: nextBranches };
  updateRepo(updated);

  return newCommits;
}

async function poll(): Promise<void> {
  if (polling || repos.length === 0) return;
  polling = true;
  setStatus("polling");
  const token = getToken();

  try {
    const results: PollResult[] = [];
    for (const repo of repos) {
      try {
        const newCommits = await watchCommits(repo, token);
        results.push({ repo, newCommits });
      } catch (err) {
        console.error(err);
        log(`ERROR ${repo.full_name}: ${(err as Error).message}`);
        setStatus("error");
      }
    }

    for (const { repo, newCommits } of results) {
      for (const commit of newCommits) {
        addCommitCard(repo, commit);
        log(`NEW ${repo.full_name}#${commit.branch} ${commit.sha.slice(0, 7)} ${commit.author.name}: ${commit.message}`);
        await notifyCommit(repo, commit);
      }
    }

    setStatus("online");
  } finally {
    polling = false;
  }
}

async function onAddRepo(e: Event): Promise<void> {
  e.preventDefault();
  const parsed = parseRepoInput(repoInput.value);
  if (!parsed) {
    setStatus("error");
    return;
  }

  addBtn.disabled = true;
  addBtn.classList.add("loading");
  setStatus("polling");

  try {
    const token = getToken();
    const info = await getRepoInfo(parsed.owner, parsed.repo, token);
    const repo: WatchedRepo = {
      id: crypto.randomUUID(),
      full_name: info.full_name,
      html_url: info.html_url,
      owner_avatar: stripAvatarQuery(info.owner_avatar),
      branches: {},
    };
    addRepo(repo);
    repos = loadRepos();
    repoInput.value = "";
    render();
    const newCommits = await watchCommits(repo, token);
    for (const c of newCommits) addCommitCard(repo, c);
    addBtn.classList.remove("loading");
    addBtn.classList.add("done");
    setStatus("online");
  } catch (err) {
    addBtn.classList.remove("loading");
    setStatus("error");
  } finally {
    addBtn.disabled = false;
    setTimeout(() => addBtn.classList.remove("done"), 1600);
  }
}

function start(): void {
  ensureNotifPermission();
  repos = loadRepos();
  render();

  void poll();
  setInterval(() => void poll(), POLL_MS);
}

addForm.addEventListener("submit", onAddRepo);

start();
