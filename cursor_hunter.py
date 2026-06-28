#!/usr/bin/env python3
"""
cursor_hunter.py — Expensify bounty hunter, Cursor-automation engine (no API key).

Flow:
  1. Fast conditional-poll Expensify/App "Help Wanted" (ETag; 304s are free).
     NOTE: true push is impossible — we don't own the repo, so GitHub won't let us
     register a webhook on it. Fast ETag polling is the realistic "instant".
  2. be-first pre-gate: skip issues that already have a real proposal.
  3. POST to the Cursor automation's webhook URL to trigger a cloud agent.
  4. The Cursor agent (configured in the dashboard) investigates the FORK and commits
     proposals/<issue>.md back to the fork.
  5. openclaw polls the fork contents API for that file (timeout-bounded).
  6. post-draft dedup gate, then gh issue comment on Expensify/App. PAT stays on this box.

Cursor dashboard automation must be set up to:
  - Trigger: Webhook
  - Repo: <your fork of Expensify/App>
  - Prompt: investigate the issue from the webhook payload, write proposals/<issue_number>.md
    in the strict Expensify template, COMMIT + PUSH it to the fork. (See README_CURSOR below.)

Config: .env.hunter / .env / environment.

Usage:
  python3 cursor_hunter.py --selftest   # check GitHub + fork access + webhook reachability
  python3 cursor_hunter.py --dry-run    # show what would fire; trigger nothing
  python3 cursor_hunter.py --once       # one poll pass
  python3 cursor_hunter.py              # watch loop (default)
"""

import os
import re
import sys
import json
import time
import base64
import logging
import argparse
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

import subprocess
import urllib.request
import urllib.error

# ─── Config ────────────────────────────────────────────────────────────────

def _load_env_file(path: Path) -> dict:
    env = {}
    try:
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, _, v = line.partition('=')
            env[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return env


def get_config() -> dict:
    root = Path(__file__).parent.resolve()
    env = {}
    for name in ('.env.hunter', '.env'):
        f = root / name
        if f.exists():
            env.update(_load_env_file(f))

    def g(key, fallback=''):
        return os.environ.get(key, env.get(key, fallback))

    cfg = {
        'github_token': g('GITHUB_TOKEN'),
        # Cursor automation webhook trigger URL (from dashboard — NO api key needed).
        'cursor_webhook': g('CURSOR_WEBHOOK_URL'),
        # Bearer token Cursor's webhook expects (crsr_... from dashboard).
        'cursor_webhook_token': g('CURSOR_WEBHOOK_TOKEN', ''),
        # Fork the Cursor agent reads + commits proposals to. "owner/repo".
        'fork_repo': g('FORK_REPO', 'ReaperOAK/App'),
        'fork_ref': g('FORK_REF', 'main'),          # kept fast-forward-synced to upstream
        'proposal_ref': g('PROPOSAL_REF', 'proposals'),  # branch the agent commits proposals to
        # Path within the fork where the agent writes proposals.
        'proposal_path_tmpl': g('PROPOSAL_PATH_TMPL', 'proposals/{n}.md'),
        'discord_webhook': g('DISCORD_WEBHOOK', ''),
        'poll_interval': int(g('POLL_INTERVAL', '8')),          # fast poll (ETag → 304 free)
        'pregate_max_existing': int(g('PREGATE_MAX_EXISTING', '0')),  # 0 = only when first
        'similarity_threshold': float(g('SIMILARITY_THRESHOLD', '0.36')),
        'issues_per_poll': int(g('ISSUES_PER_POLL', '15')),
        'file_wait': int(g('PROPOSAL_FILE_WAIT', '900')),       # secs to wait for fork file
        'file_poll': int(g('PROPOSAL_FILE_POLL', '15')),
        'kill_switch': g('KILL_SWITCH', str(root / 'agent-output' / 'hunter' / 'STOP')),
        'state_file': g('STATE_FILE', str(root / 'agent-output' / 'hunter' / 'cursor_state.json')),
        'root': str(root),
    }
    missing = [k for k in ('github_token', 'cursor_webhook') if not cfg[k]]
    if missing:
        print(f"ERROR: missing required config: {', '.join(k.upper() for k in missing)}")
        print("Set GITHUB_TOKEN and CURSOR_WEBHOOK_URL in .env.hunter or environment.")
        sys.exit(1)
    return cfg


# ─── Logging ───────────────────────────────────────────────────────────────

LOG_DIR = Path(__file__).parent / 'agent-output' / 'hunter'
LOG_DIR.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    handlers=[logging.FileHandler(LOG_DIR / 'cursor_hunter.log'), logging.StreamHandler()],
)
log = logging.getLogger('cursor_hunter')


# ─── HTTP (stdlib) ───────────────────────────────────────────────────────────

def _http(method, url, headers, body=None, timeout=30, raw=False):
    data = None
    if body is not None:
        data = body.encode() if isinstance(body, str) else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = resp.read().decode()
            if raw:
                return resp.status, dict(resp.headers), payload
            return json.loads(payload) if payload else {}
    except urllib.error.HTTPError as e:
        if raw:
            return e.code, dict(e.headers), e.read().decode()
        raise RuntimeError(f"{method} {url} -> HTTP {e.code}: {e.read().decode()[:400]}") from None


# ─── GitHub ──────────────────────────────────────────────────────────────────

GH = 'https://api.github.com/repos/Expensify/App'


def gh_headers(cfg, etag=None):
    h = {
        'Authorization': f"token {cfg['github_token']}",
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'cursor-hunter/2.0',
    }
    if etag:
        h['If-None-Match'] = etag
    return h


def gh_list_help_wanted(cfg, etag=None):
    """Return (issues_or_None, new_etag). issues is None on 304 (no change)."""
    params = f"labels=Help%20Wanted&state=open&sort=created&direction=desc&per_page={cfg['issues_per_poll']}"
    status, headers, payload = _http('GET', f"{GH}/issues?{params}", gh_headers(cfg, etag), raw=True)
    if status == 304:
        return None, etag
    if status != 200:
        raise RuntimeError(f"list issues HTTP {status}: {payload[:200]}")
    return json.loads(payload), headers.get('ETag')


def gh_fetch_comments(cfg, number):
    out, page = [], 1
    while True:
        batch = _http('GET', f"{GH}/issues/{number}/comments?per_page=100&page={page}", gh_headers(cfg))
        out.extend(batch)
        if len(batch) < 100:
            return out
        page += 1


def gh_post_comment(cfg, number, body):
    # Post via gh CLI — token is fine-grained and cannot write to Expensify/App.
    out = _gh(['issue', 'comment', str(number), '--repo', 'Expensify/App', '--body-file', '-'], body=body)
    return out.strip() or f"https://github.com/Expensify/App/issues/{number}"


def _gh(args, body=None):
    """Run gh CLI (authed as ReaperOAK, full repo scope). Returns stdout."""
    return subprocess.run(['gh', *args], input=body, capture_output=True,
                          text=True, timeout=30, check=True).stdout


def sync_fork(cfg) -> str:
    """Fast-forward fork's branch to upstream (a real 'git pull') via merge-upstream.
    Only works if the branch hasn't diverged — keep proposal commits OFF this branch.
    Returns a note on 409 (diverged) instead of raising, so a pass still proceeds."""
    try:
        out = _gh(['api', '-X', 'POST', f"repos/{cfg['fork_repo']}/merge-upstream",
                   '-f', f"branch={cfg['fork_ref']}"])
        return json.loads(out).get('merge_type', 'ok')
    except subprocess.CalledProcessError as e:
        return f"sync-skip (diverged/err: {(e.stderr or '')[:100]})"


def fork_read_proposal(cfg, number) -> Optional[str]:
    """Read proposals/<n>.md from the fork via the contents API. None if absent yet."""
    path = cfg['proposal_path_tmpl'].format(n=number)
    # Prefer the proposals branch; fall back to main in case the automation commits there.
    for ref in (cfg['proposal_ref'], cfg['fork_ref']):
        url = f"https://api.github.com/repos/{cfg['fork_repo']}/contents/{path}?ref={ref}"
        status, _, payload = _http('GET', url, gh_headers(cfg), raw=True)
        if status == 200:
            return base64.b64decode(json.loads(payload)['content']).decode()
        if status != 404:
            raise RuntimeError(f"fork contents HTTP {status}: {payload[:200]}")
    return None


# ─── Pre-gate + dedup (ported from hunter-agent/src/quality.ts) ───────────────

_STOP = {
    'about', 'after', 'before', 'being', 'change', 'changes', 'could', 'does', 'existing',
    'expense', 'file', 'from', 'have', 'into', 'issue', 'more', 'should', 'that', 'their',
    'there', 'these', 'this', 'transaction', 'transactions', 'using', 'when', 'where',
    'which', 'with', 'would',
}
_PROPOSAL_RE = re.compile(r'proposal|root cause|what changes', re.I)


def _tokens(text):
    text = re.sub(r'https?://\S+', ' ', text)
    text = re.sub(r'[`*_#()\[\]{}.,:;\'"|/\\<>+=-]', ' ', text).lower()
    return {t for t in text.split() if len(t) >= 4 and t not in _STOP and not t.isdigit()}


def similarity(a, b):
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    union = len(ta) + len(tb) - inter
    jaccard = inter / union if union else 0.0
    containment = inter / min(len(ta), len(tb))
    return max(jaccard, containment * 0.72)


def is_real_proposal_comment(c):
    body = c.get('body') or ''
    if 'ProposalPolice' in body or 'withdrawn' in body:
        return False
    return bool(_PROPOSAL_RE.search(body)) and len(body) > 400


def count_existing_proposals(comments):
    return sum(1 for c in comments if is_real_proposal_comment(c))


def best_similarity(proposal, comments):
    best = 0.0
    for c in comments:
        if _PROPOSAL_RE.search(c.get('body') or ''):
            best = max(best, similarity(proposal, c['body']))
    return best


# ─── Cursor automation webhook ───────────────────────────────────────────────

def fire_cursor_webhook(cfg, issue, comments):
    payload = {
        'issue_number': issue['number'],
        'title': issue['title'],
        'body': (issue.get('body') or '')[:8000],
        'html_url': issue['html_url'],
        'proposal_path': cfg['proposal_path_tmpl'].format(n=issue['number']),
        'existing_proposals': [
            {'author': c['user']['login'], 'body': (c.get('body') or '')[:1500]}
            for c in comments if is_real_proposal_comment(c)
        ],
    }
    h = {'Content-Type': 'application/json'}
    if cfg['cursor_webhook_token']:
        h['Authorization'] = f"Bearer {cfg['cursor_webhook_token']}"
    status, _, body = _http('POST', cfg['cursor_webhook'], h, payload, timeout=30, raw=True)
    if status not in (200, 201, 202, 204):
        raise RuntimeError(f"cursor webhook HTTP {status}: {body[:200]}")


def wait_for_proposal(cfg, number) -> Optional[str]:
    deadline = time.time() + cfg['file_wait']
    while time.time() < deadline:
        md = fork_read_proposal(cfg, number)
        if md:
            return md
        time.sleep(cfg['file_poll'])
    return None


# ─── State / discord / kill ──────────────────────────────────────────────────

def load_state(cfg):
    try:
        return json.loads(Path(cfg['state_file']).read_text())
    except Exception:
        return {'processed': [], 'etag': None}


def save_state(cfg, state):
    state['processed'] = state['processed'][-500:]
    Path(cfg['state_file']).write_text(json.dumps(state))


def discord(cfg, msg):
    if not cfg['discord_webhook']:
        return
    try:
        _http('POST', cfg['discord_webhook'], {'Content-Type': 'application/json'},
              {'content': msg}, timeout=10, raw=True)
    except Exception as e:
        log.warning(f"discord failed: {e}")


def kill_active(cfg):
    return Path(cfg['kill_switch']).exists()


# ─── Core ────────────────────────────────────────────────────────────────────

def process_issue(cfg, issue, dry=False):
    number = issue['number']
    comments = gh_fetch_comments(cfg, number)
    existing = count_existing_proposals(comments)

    if existing > cfg['pregate_max_existing']:
        return f"skip(pregate): {existing} existing > {cfg['pregate_max_existing']}"
    if dry:
        return f"WOULD-FIRE: #{number} ({existing} existing)"

    log.info(f"firing Cursor webhook for #{number}: {issue['title']}")
    discord(cfg, f"🚨 **#{number}** — {issue['title']}\nFiring Cursor agent…\n{issue['html_url']}")
    try:
        log.info(f"fork sync: {sync_fork(cfg)}")
    except Exception as e:
        log.warning(f"fork sync failed (continuing): {e}")
    fire_cursor_webhook(cfg, issue, comments)

    md = wait_for_proposal(cfg, number)
    if not md:
        return f"timeout: no proposals/{number}.md in fork after {cfg['file_wait']}s"
    if md.strip().startswith('SKIP') or '# Proposal' not in md:
        return f"agent-skip/invalid: {md.strip()[:120]!r}"

    fresh = gh_fetch_comments(cfg, number)
    sim = best_similarity(md, fresh)
    if sim >= cfg['similarity_threshold']:
        return f"skip(dedup): similarity {sim:.2f} >= {cfg['similarity_threshold']}"

    url = gh_post_comment(cfg, number, md)
    discord(cfg, f"🎯 **SUBMITTED #{number}** (sim {sim:.2f})\n{url}")
    return f"submitted: {url} (sim {sim:.2f})"


def run_pass(cfg, state, dry=False):
    if kill_active(cfg):
        log.warning(f"kill-switch present ({cfg['kill_switch']}) — skipping")
        return
    issues, new_etag = gh_list_help_wanted(cfg, state.get('etag'))
    state['etag'] = new_etag
    if issues is None:
        return  # 304, nothing new
    seen = set(state['processed'])
    for issue in issues:
        if issue['number'] in seen or 'pull_request' in issue:
            continue
        try:
            outcome = process_issue(cfg, issue, dry=dry)
        except Exception as e:
            outcome = f"exception: {e}"
            discord(cfg, f"❌ #{issue['number']} error: {str(e)[:200]}")
        log.info(f"#{issue['number']}: {outcome}")
        if not dry:
            state['processed'].append(issue['number'])
            save_state(cfg, state)


def watch(cfg):
    log.info(f"watch — poll {cfg['poll_interval']}s, fork={cfg['fork_repo']}, "
             f"pregate_max={cfg['pregate_max_existing']}, sim={cfg['similarity_threshold']}")
    state = load_state(cfg)
    if not state['processed']:
        issues, etag = gh_list_help_wanted(cfg)
        state['etag'] = etag
        state['processed'] = [i['number'] for i in (issues or [])]
        save_state(cfg, state)
        log.info(f"baseline: {len(state['processed'])} existing issues marked seen")
    while True:
        try:
            run_pass(cfg, state)
            save_state(cfg, state)
        except Exception as e:
            log.error(f"pass error: {e}")
        time.sleep(cfg['poll_interval'])


def selftest(cfg):
    print("== GitHub source ==")
    issues, etag = gh_list_help_wanted(cfg)
    print(f"  ok — {len(issues)} Help Wanted; latest #{issues[0]['number'] if issues else '?'}; etag={etag}")
    print("== Fork access ==")
    try:
        url = f"https://api.github.com/repos/{cfg['fork_repo']}"
        st, _, _ = _http('GET', url, gh_headers(cfg), raw=True)
        print(f"  fork {cfg['fork_repo']} -> HTTP {st}")
    except Exception as e:
        print("  fork check failed:", e)
    print("== Cursor webhook (HEAD-ish ping) ==")
    print("  configured:", cfg['cursor_webhook'][:60], "…")
    print("  (not firing it in selftest — run --once on a real new issue to test end-to-end)")


def test_issue(cfg, number):
    """Full pipeline for ONE issue but NEVER post to Expensify — verify generation."""
    issue = _http('GET', f"{GH}/issues/{number}", gh_headers(cfg))
    comments = gh_fetch_comments(cfg, number)
    print(f"#{number}: {issue['title']}  ({count_existing_proposals(comments)} existing proposals)")
    print("fork sync:", sync_fork(cfg))
    print("firing webhook…")
    fire_cursor_webhook(cfg, issue, comments)
    print(f"waiting for fork file (up to {cfg['file_wait']}s)…")
    md = wait_for_proposal(cfg, number)
    if not md:
        print("TIMEOUT: no proposal file appeared in fork."); return
    sim = best_similarity(md, gh_fetch_comments(cfg, number))
    print(f"\n--- proposal ({len(md)} chars, similarity {sim:.2f}, "
          f"{'WOULD-POST' if sim < cfg['similarity_threshold'] and md.lstrip().startswith('# Proposal') else 'WOULD-SKIP'}) ---\n")
    print(md[:2000])


def main():
    p = argparse.ArgumentParser(description='Expensify hunter — Cursor automation engine')
    p.add_argument('--selftest', action='store_true')
    p.add_argument('--once', action='store_true')
    p.add_argument('--dry-run', action='store_true')
    p.add_argument('--test', type=int, metavar='ISSUE', help='full pipeline for one issue, never posts')
    args = p.parse_args()
    cfg = get_config()
    if args.test:
        test_issue(cfg, args.test)
    elif args.selftest:
        selftest(cfg)
    elif args.dry_run:
        st = load_state(cfg)
        st['processed'] = []  # force evaluation of all current issues
        run_pass(cfg, st, dry=True)
    elif args.once:
        st = load_state(cfg)
        run_pass(cfg, st)
        save_state(cfg, st)
    else:
        watch(cfg)


if __name__ == '__main__':
    main()
