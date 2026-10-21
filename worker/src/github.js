// The repo, read and written through the GitHub API. A Snapshot is the whole file tree at
// one commit; changes are saved as a single new commit on top of it.
//
// Cloudflare's free plan allows 50 outside requests per admin request, so reads are batched:
// a snapshot is 2 requests, and any number of files are read in 1 (GraphQL). If someone else
// committed in the meantime (another admin save, or the build adding processed uploads),
// the save fails with a Conflict and is retried against a fresh snapshot.

export class Conflict extends Error {}

const API = 'https://api.github.com';

export class GitHub {
  constructor(env) {
    this.token = env.GITHUB_TOKEN;
    this.repo = env.GITHUB_REPO;
    this.branch = env.GITHUB_BRANCH || 'main';
  }

  async call(method, path, body) {
    if (!this.token) throw new Error('The admin isn\'t connected to GitHub yet (GITHUB_TOKEN missing)');
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'avec-anima-admin',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`GitHub: ${data.message || res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async snapshot() {
    const head = await this.call('GET', `/repos/${this.repo}/commits/${this.branch}`);
    const treeSha = head.commit.tree.sha;
    const tree = await this.call('GET', `/repos/${this.repo}/git/trees/${treeSha}?recursive=1`);
    if (tree.truncated) throw new Error('GitHub: repo listing was cut short');
    const files = new Map();
    for (const entry of tree.tree) {
      if (entry.type === 'blob') files.set(entry.path, entry.sha);
    }
    return new Snapshot(this, head.sha, treeSha, files);
  }

  // Text of several files at one commit, in a single GraphQL request → Map of path → text
  async readFiles(commitSha, paths) {
    if (!paths.length) return new Map();
    const [owner, name] = this.repo.split('/');
    const fields = paths
      .map((p, i) => `f${i}: object(expression: ${JSON.stringify(`${commitSha}:${p}`)}) { ... on Blob { text } }`)
      .join('\n');
    const data = await this.call('POST', '/graphql', {
      query: `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${fields} } }`,
    });
    if (data.errors) throw new Error(`GitHub: ${data.errors[0].message}`);
    const texts = new Map();
    paths.forEach((p, i) => {
      const blob = data.data.repository[`f${i}`];
      if (blob && typeof blob.text === 'string') texts.set(p, blob.text);
    });
    return texts;
  }

  // changes: Map of path → new text | null (delete) | { sha } (copy an existing file's content)
  async commit(snapshot, changes, message) {
    const tree = [...changes].map(([path, value]) => {
      if (value === null) return { path, mode: '100644', type: 'blob', sha: null };
      if (typeof value === 'object') return { path, mode: '100644', type: 'blob', sha: value.sha };
      return { path, mode: '100644', type: 'blob', content: value };
    });
    const newTree = await this.call('POST', `/repos/${this.repo}/git/trees`, { base_tree: snapshot.treeSha, tree });
    if (newTree.sha === snapshot.treeSha) return snapshot.commitSha; // nothing actually changed
    const commit = await this.call('POST', `/repos/${this.repo}/git/commits`, {
      message,
      tree: newTree.sha,
      parents: [snapshot.commitSha],
    });
    try {
      await this.call('PATCH', `/repos/${this.repo}/git/refs/heads/${this.branch}`, { sha: commit.sha });
    } catch (err) {
      if (err.status === 422 || err.status === 409) throw new Conflict('Someone else saved at the same time');
      throw err;
    }
    return commit.sha;
  }

  // Starts the build that processes uploads (see .github/workflows/deploy-pages.yml)
  dispatch(eventType) {
    return this.call('POST', `/repos/${this.repo}/dispatches`, { event_type: eventType });
  }
}

export class Snapshot {
  constructor(github, commitSha, treeSha, files) {
    this.github = github;
    this.commitSha = commitSha;
    this.treeSha = treeSha;
    this.files = files; // path → blob sha
    this.texts = new Map();
  }

  has(path) {
    return this.files.has(path);
  }

  // Everything under a folder (full paths)
  under(dir) {
    const prefix = `${dir}/`;
    return [...this.files.keys()].filter((p) => p.startsWith(prefix));
  }

  // Direct children of a folder, split into file and folder names
  children(dir) {
    const prefix = `${dir}/`;
    const files = new Set();
    const dirs = new Set();
    for (const p of this.files.keys()) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash === -1) files.add(rest);
      else dirs.add(rest.slice(0, slash));
    }
    return { files: [...files], dirs: [...dirs] };
  }

  // Loads file contents up front so they can be read synchronously (lib/event-rules.js is sync)
  async load(paths) {
    const wanted = [...new Set(paths)].filter((p) => this.files.has(p) && !this.texts.has(p));
    for (const [p, text] of await this.github.readFiles(this.commitSha, wanted)) this.texts.set(p, text);
  }

  // Parsed JSON of a loaded file, or null if it doesn't exist / isn't valid
  json(path) {
    if (!this.texts.has(path)) return null;
    try {
      return JSON.parse(this.texts.get(path));
    } catch (err) {
      return null;
    }
  }

  async readJson(path) {
    await this.load([path]);
    return this.json(path);
  }
}
