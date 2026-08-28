#!/usr/bin/env python3
"""
Smart Survey X — Version + APK + deploy (Python)

Desktop GUI (default):
  python3 bump_version.py

Browser UI:
  python3 bump_version.py --web

CLI:
  python3 bump_version.py patch
  python3 bump_version.py minor
  python3 bump_version.py 2.1.0 --apk
  python3 bump_version.py patch --apk --push
  python3 bump_version.py --push-only
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
PACKAGE_JSON = ROOT_DIR / "package.json"
PACKAGE_LOCK = ROOT_DIR / "package-lock.json"
BUILD_GRADLE = ROOT_DIR / "android" / "app" / "build.gradle"
DENO_MAIN = ROOT_DIR / "deno-deploy" / "main.ts"
HONO_HANDLER = ROOT_DIR / "hono-api" / "legacy" / "handler.ts"
HONO_DIR = ROOT_DIR / "hono-api"
API_REPO = "https://github.com/sravanku018/ground-iq-api.git"
GITHUB_WEB_REPO = "sravanku018/ground-iq-web"
DOWNLOADS = Path.home() / "Downloads"


def get_current_version():
    try:
        data = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
        return str(data.get("version", "2.0.0")), int(data.get("versionCode") or 20000)
    except Exception:
        return "2.0.0", 20000


def semver_to_code(version_str):
    clean = re.sub(r"[^0-9.]", "", version_str)
    parts = clean.split(".")
    major = int(parts[0]) if len(parts) > 0 and parts[0] else 0
    minor = int(parts[1]) if len(parts) > 1 and parts[1] else 0
    patch = int(parts[2]) if len(parts) > 2 and parts[2] else 0
    return major * 10000 + minor * 100 + min(patch, 99)


def bump_patch(v_str):
    parts = v_str.split(".")
    while len(parts) < 3:
        parts.append("0")
    parts[2] = str(int(parts[2] or 0) + 1)
    return ".".join(parts[:3])


def bump_minor(v_str):
    parts = v_str.split(".")
    while len(parts) < 3:
        parts.append("0")
    parts[1] = str(int(parts[1] or 0) + 1)
    parts[2] = "0"
    return ".".join(parts[:3])


def bump_major(v_str):
    parts = v_str.split(".")
    while len(parts) < 3:
        parts.append("0")
    parts[0] = str(int(parts[0] or 0) + 1)
    parts[1] = "0"
    parts[2] = "0"
    return ".".join(parts[:3])


def update_files(new_version, new_code):
    logs = []

    try:
        data = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
        data["version"] = new_version
        data["versionCode"] = new_code
        PACKAGE_JSON.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        logs.append(f"Updated package.json → {new_version} (versionCode {new_code})")
    except Exception as e:
        logs.append(f"Failed package.json: {e}")

    try:
        if PACKAGE_LOCK.exists():
            lock = json.loads(PACKAGE_LOCK.read_text(encoding="utf-8"))
            lock["version"] = new_version
            if "packages" in lock and "" in lock["packages"]:
                lock["packages"][""]["version"] = new_version
            PACKAGE_LOCK.write_text(json.dumps(lock, indent=2) + "\n", encoding="utf-8")
            logs.append("Updated package-lock.json")
    except Exception as e:
        logs.append(f"Failed package-lock.json: {e}")

    try:
        if BUILD_GRADLE.exists():
            content = BUILD_GRADLE.read_text(encoding="utf-8")
            content = re.sub(r"versionCode\s+\d+", f"versionCode {new_code}", content)
            content = re.sub(r'versionName\s+["\'][^"\']+["\']', f'versionName "{new_version}"', content)
            BUILD_GRADLE.write_text(content, encoding="utf-8")
            logs.append(f"Updated android/app/build.gradle → {new_version}")
    except Exception as e:
        logs.append(f"Failed build.gradle: {e}")

    try:
        if DENO_MAIN.exists():
            content = DENO_MAIN.read_text(encoding="utf-8")
            content = re.sub(r'version:\s*["\'][^"\']+["\']', f'version: "{new_version}"', content, count=1)
            content = re.sub(r"versionCode:\s*\d+", f"versionCode: {new_code}", content, count=1)
            DENO_MAIN.write_text(content, encoding="utf-8")
            logs.append("Updated deno-deploy/main.ts /api/app-version")
    except Exception as e:
        logs.append(f"Failed main.ts: {e}")

    try:
        if HONO_HANDLER.exists():
            content = HONO_HANDLER.read_text(encoding="utf-8")
            content = re.sub(r'version:\s*["\'][^"\']+["\']', f'version: "{new_version}"', content, count=1)
            content = re.sub(r"versionCode:\s*\d+", f"versionCode: {new_code}", content, count=1)
            HONO_HANDLER.write_text(content, encoding="utf-8")
            logs.append("Updated hono-api/legacy/handler.ts /api/app-version")
    except Exception as e:
        logs.append(f"Failed hono-api handler: {e}")

    return logs


def stream_cmd(cmd, on_line):
    env = os.environ.copy()
    env.setdefault("CI", "1")
    proc = subprocess.Popen(
        cmd,
        cwd=str(ROOT_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env=env,
        shell=isinstance(cmd, str),
    )
    assert proc.stdout is not None
    for line in proc.stdout:
        on_line(line.rstrip("\n"))
    return proc.wait() == 0


def copy_apk(kind="release"):
    logs = []
    if kind == "debug":
        src = ROOT_DIR / "android" / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk"
        name = "ElectionSurvey-debug.apk"
    else:
        src = ROOT_DIR / "android" / "app" / "build" / "outputs" / "apk" / "release" / "app-release.apk"
        name = "ElectionSurvey-release.apk"
    if not src.exists():
        logs.append(f"APK not found: {src}")
        return logs, None
    dest_root = ROOT_DIR / name
    dest_dl = DOWNLOADS / name
    dest_root.write_bytes(src.read_bytes())
    logs.append(f"Copied {name} → {dest_root}")
    try:
        DOWNLOADS.mkdir(parents=True, exist_ok=True)
        dest_dl.write_bytes(src.read_bytes())
        logs.append(f"Copied {name} → {dest_dl}")
    except Exception as e:
        logs.append(f"Could not copy to Downloads: {e}")
    return logs, dest_root


def publish_github_apk(new_v, apk_path, on_line):
    """Upload the APK to GitHub Releases so phones can in-app update."""
    if not apk_path or not Path(apk_path).exists():
        on_line("No APK to publish on GitHub")
        return
    tag = str(new_v).lstrip("v")
    on_line(f"GitHub Release {tag} ← {apk_path}")
    view = subprocess.run(
        ["gh", "release", "view", tag, "-R", GITHUB_WEB_REPO],
        cwd=str(ROOT_DIR),
        capture_output=True,
        text=True,
    )
    if view.returncode == 0:
        stream_cmd(
            ["gh", "release", "upload", tag, str(apk_path), "-R", GITHUB_WEB_REPO, "--clobber"],
            on_line,
        )
    else:
        stream_cmd(
            [
                "gh",
                "release",
                "create",
                tag,
                str(apk_path),
                "-R",
                GITHUB_WEB_REPO,
                "--title",
                f"Smart Survey X v{tag}",
                "--notes",
                f"Field APK v{tag}. Install in-app or from this release.",
            ],
            on_line,
        )


def git_push_websites(message, on_line):
    on_line("git add websites…")
    stream_cmd(["git", "add", "-A"], on_line)
    stream_cmd(["git", "status", "--short"], on_line)
    ok = stream_cmd(["git", "commit", "-m", message], on_line)
    if not ok:
        on_line("Website commit skipped (nothing to commit or git error)")
    on_line("push Client Admin (ground-iq)…")
    stream_cmd(["git", "push", "ground-iq", "HEAD:main"], on_line)
    on_line("push Super Admin (ground-iq-superadmin)…")
    stream_cmd(["git", "push", "ground-iq-superadmin", "HEAD:main"], on_line)


def git_push_api(on_line):
    """Copy hono-api/ into github.com/sravanku018/ground-iq-api (Deno auto-deploys)."""
    if not HONO_DIR.is_dir():
        on_line("hono-api/ missing — skip API push")
        return
    clone = Path(tempfile.gettempdir()) / "ground-iq-api-push"
    on_line("sync API repo…")
    if (clone / ".git").is_dir():
        stream_cmd(["git", "-C", str(clone), "fetch", "origin"], on_line)
        stream_cmd(["git", "-C", str(clone), "reset", "--hard", "origin/main"], on_line)
    else:
        if clone.exists():
            shutil.rmtree(clone)
        ok = stream_cmd(["git", "clone", API_REPO, str(clone)], on_line)
        if not ok:
            on_line("Could not clone ground-iq-api")
            return
    for item in clone.iterdir():
        if item.name == ".git":
            continue
        if item.is_dir():
            shutil.rmtree(item)
        else:
            item.unlink()
    for item in HONO_DIR.iterdir():
        if item.name in (".git", "node_modules"):
            continue
        dest = clone / item.name
        if item.is_dir():
            shutil.copytree(item, dest, dirs_exist_ok=True)
        else:
            shutil.copy2(item, dest)
    stream_cmd(["git", "-C", str(clone), "add", "-A"], on_line)
    ok = stream_cmd(["git", "-C", str(clone), "commit", "-m", "Update API from Python"], on_line)
    if not ok:
        on_line("API commit skipped (no file changes)")
    on_line("push API (ground-iq-api) — Deno deploys from this…")
    stream_cmd(["git", "-C", str(clone), "push", "origin", "main"], on_line)


def git_push(new_v, new_c, on_line):
    git_push_websites(f"Bump version to v{new_v} (versionCode {new_c})", on_line)
    git_push_api(on_line)


# ── Tkinter desktop GUI ──────────────────────────────────────

def launch_tk():
    try:
        import tkinter as tk
        from tkinter import messagebox, scrolledtext, ttk
    except ImportError:
        print("tkinter is not installed (sudo apt install python3-tk).")
        print("Opening the Version & APK page in the browser instead…")
        launch_web()
        return

    root = tk.Tk()
    root.title("Smart Survey X — Version & APK")
    root.geometry("720x640")
    root.minsize(620, 520)
    bg, panel, accent, text, muted = "#0f172a", "#1e293b", "#0284c7", "#f8fafc", "#94a3b8"
    root.configure(bg=bg)

    style = ttk.Style()
    try:
        style.theme_use("clam")
    except Exception:
        pass
    style.configure("TRadiobutton", background=panel, foreground=text, font=("Segoe UI", 11))
    style.configure("TCheckbutton", background=panel, foreground=text, font=("Segoe UI", 11))

    bump_kind = tk.StringVar(value="patch")
    do_push = tk.BooleanVar(value=True)
    busy = {"on": False}

    def refresh_banner():
        v, c = get_current_version()
        curr_var.set(f"v{v}")
        code_var.set(f"versionCode {c}")
        next_var.set(f"next patch  v{bump_patch(v)}    ·    next minor  v{bump_minor(v)}")

    def log(msg):
        log_box.configure(state="normal")
        log_box.insert("end", msg + "\n")
        log_box.see("end")
        log_box.configure(state="disabled")
        root.update_idletasks()

    def set_busy(on, label="Working…"):
        busy["on"] = on
        for b in action_btns:
            b.configure(state="disabled" if on else "normal")
        status_var.set(label if on else "Ready")

    def resolve_version():
        curr, _ = get_current_version()
        kind = bump_kind.get()
        custom = custom_ent.get().strip()
        if custom:
            if not re.match(r"^\d+\.\d+\.\d+$", custom):
                raise ValueError("Custom version must look like 2.0.8")
            return custom
        if kind == "minor":
            return bump_minor(curr)
        if kind == "major":
            return bump_major(curr)
        if kind == "none":
            return curr
        return bump_patch(curr)

    def worker(build_apk, release):
        try:
            kind = bump_kind.get()
            curr_v, curr_c = get_current_version()
            if kind == "none":
                new_v, new_c = curr_v, curr_c
                log(f"Keeping v{new_v} (versionCode {new_c})")
            else:
                new_v = resolve_version()
                new_c = semver_to_code(new_v)
                log(f"==> {curr_v} → {new_v}  (versionCode {new_c})")
                for line in update_files(new_v, new_c):
                    log(line)
                root.after(0, refresh_banner)

            if build_apk:
                script = "build:apk:release" if release else "build:apk"
                log(f"==> Building {'release' if release else 'debug'} APK (this takes several minutes)…")
                ok = stream_cmd(["npm", "run", script], log)
                extra, dest = copy_apk("release" if release else "debug")
                for line in extra:
                    log(line)
                if ok:
                    log("APK build finished.")
                    if dest:
                        log("==> Upload APK to GitHub Releases (phones update from here)…")
                        publish_github_apk(new_v, dest, log)
                else:
                    log("APK build failed — see log above.")

            if do_push.get():
                log("==> Git commit & push websites + API…")
                git_push(new_v, new_c, log)

            log("Done.")
            root.after(0, lambda: messagebox.showinfo("Smart Survey X", f"Version is v{new_v}"))
        except Exception as e:
            log(f"Error: {e}")
            root.after(0, lambda: messagebox.showerror("Smart Survey X", str(e)))
        finally:
            root.after(0, lambda: set_busy(False))

    def run(build_apk=False, release=True, keep=False):
        if busy["on"]:
            return
        if keep:
            bump_kind.set("none")
        try:
            resolve_version()
        except ValueError as e:
            messagebox.showerror("Version", str(e))
            return
        set_busy(True, "Building…" if build_apk else "Updating version…")
        log_box.configure(state="normal")
        log_box.delete("1.0", "end")
        log_box.configure(state="disabled")
        threading.Thread(target=worker, args=(build_apk, release), daemon=True).start()

    # Header
    head = tk.Frame(root, bg=bg, padx=22, pady=16)
    head.pack(fill="x")
    tk.Label(head, text="Smart Survey X", fg=accent, bg=bg, font=("Segoe UI", 18, "bold")).pack(anchor="w")
    tk.Label(head, text="Python control — version, APK, push websites + API. No Deno paste.", fg=muted, bg=bg, font=("Segoe UI", 11)).pack(anchor="w")

    card = tk.Frame(root, bg=panel, padx=18, pady=16)
    card.pack(fill="x", padx=22)

    curr_var = tk.StringVar(value="…")
    code_var = tk.StringVar(value="")
    next_var = tk.StringVar(value="")
    row = tk.Frame(card, bg=panel)
    row.pack(fill="x")
    tk.Label(row, textvariable=curr_var, fg=text, bg=panel, font=("Segoe UI", 22, "bold")).pack(side="left")
    tk.Label(row, textvariable=code_var, fg="#fff", bg=accent, font=("Segoe UI", 10, "bold"), padx=10, pady=4).pack(side="right")
    tk.Label(card, textvariable=next_var, fg=muted, bg=panel, font=("Segoe UI", 10)).pack(anchor="w", pady=(8, 0))

    kinds = tk.Frame(card, bg=panel, pady=12)
    kinds.pack(fill="x")
    for val, lab in (("patch", "Patch  (+0.0.1)"), ("minor", "Minor  (x.1.0)"), ("major", "Major  (1.0.0)")):
        ttk.Radiobutton(kinds, text=lab, value=val, variable=bump_kind).pack(side="left", padx=(0, 14))

    tk.Label(card, text="Or type a version", fg=muted, bg=panel, font=("Segoe UI", 10)).pack(anchor="w")
    custom_ent = tk.Entry(card, font=("Segoe UI", 13), bg="#0f172a", fg=text, insertbackground=text, relief="flat")
    custom_ent.pack(fill="x", ipady=8, pady=(4, 10))
    custom_ent.insert(0, "")

    ttk.Checkbutton(card, text="Also git commit & push websites + API", variable=do_push).pack(anchor="w")

    btns = tk.Frame(root, bg=bg, padx=22, pady=14)
    btns.pack(fill="x")
    action_btns = []

    def mkbtn(parent, label, cmd, color, fg="#fff"):
        b = tk.Button(
            parent,
            text=label,
            command=cmd,
            bg=color,
            fg=fg,
            activebackground=color,
            activeforeground=fg,
            relief="flat",
            font=("Segoe UI", 11, "bold"),
            cursor="hand2",
            padx=12,
            pady=10,
        )
        b.pack(side="left", expand=True, fill="x", padx=4)
        action_btns.append(b)
        return b

    mkbtn(btns, "Increase version", lambda: run(False), accent)
    mkbtn(btns, "Increase + debug APK", lambda: run(True, False), "#0f766e")
    mkbtn(btns, "Increase + release APK", lambda: run(True, True), "#059669")

    btns2 = tk.Frame(root, bg=bg, padx=22)
    btns2.pack(fill="x")
    mkbtn(btns2, "Build debug APK (no bump)", lambda: run(True, False, keep=True), "#334155")
    mkbtn(btns2, "Build release APK (no bump)", lambda: run(True, True, keep=True), "#334155")

    def push_only():
        if busy["on"]:
            return
        set_busy(True, "Pushing…")
        log_box.configure(state="normal")
        log_box.delete("1.0", "end")
        log_box.configure(state="disabled")

        def work():
            try:
                v, c = get_current_version()
                log("==> Push websites + API (no version bump)…")
                git_push(v, c, log)
                log("Done.")
                root.after(0, lambda: messagebox.showinfo("Smart Survey X", "Pushed websites + API"))
            except Exception as e:
                log(f"Error: {e}")
                root.after(0, lambda: messagebox.showerror("Smart Survey X", str(e)))
            finally:
                root.after(0, lambda: set_busy(False))

        threading.Thread(target=work, daemon=True).start()

    btns3 = tk.Frame(root, bg=bg, padx=22, pady=(10, 0))
    btns3.pack(fill="x")
    mkbtn(btns3, "Push websites + API", push_only, "#7c3aed")

    status_var = tk.StringVar(value="Ready")
    tk.Label(root, textvariable=status_var, fg=muted, bg=bg, font=("Segoe UI", 10), padx=26).pack(anchor="w", pady=(8, 0))

    log_box = scrolledtext.ScrolledText(
        root,
        height=16,
        bg="#090d16",
        fg="#7dd3fc",
        insertbackground="#7dd3fc",
        font=("Consolas", 10),
        relief="flat",
        state="disabled",
    )
    log_box.pack(fill="both", expand=True, padx=22, pady=(6, 18))

    refresh_banner()
    custom_ent.insert(0, bump_patch(get_current_version()[0]))
    root.mainloop()


# ── Browser UI (optional) ────────────────────────────────────

HTML_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Smart Survey X — Version & APK</title>
<style>
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  body { background: #0f172a; color: #f8fafc; margin: 0; padding: 40px 20px; display: flex; justify-content: center; }
  .card { background: #1e293b; border: 1px solid rgba(56,189,248,0.3); border-radius: 16px; padding: 28px; max-width: 640px; width: 100%; }
  h1 { font-size: 22px; margin: 0 0 4px; color: #38bdf8; }
  p.sub { color: #94a3b8; font-size: 13px; margin: 0 0 24px; }
  .badge { background: #0284c7; color: #fff; padding: 4px 10px; border-radius: 999px; font-weight: 700; font-size: 13px; }
  .current-box { background: rgba(15,23,42,0.6); border: 1px solid #334155; border-radius: 12px; padding: 14px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
  .btn-row { display: flex; gap: 10px; margin-bottom: 12px; }
  button { flex: 1; padding: 12px 14px; border: none; border-radius: 10px; font-weight: 700; font-size: 14px; cursor: pointer; }
  .btn-primary { background: #0284c7; color: #fff; }
  .btn-green { background: #059669; color: #fff; }
  .btn-teal { background: #0f766e; color: #fff; }
  .btn-secondary { background: #334155; color: #f8fafc; }
  button:disabled { opacity: .55; cursor: wait; }
  input[type="text"] { width: 100%; padding: 12px; border-radius: 10px; background: #0f172a; border: 1px solid #475569; color: #fff; font-size: 15px; margin-bottom: 14px; }
  .options { margin-bottom: 16px; display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: #cbd5e1; }
  label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
  .log-box { background: #090d16; border: 1px solid #1e293b; border-radius: 10px; padding: 12px; font-family: ui-monospace, monospace; font-size: 12px; max-height: 280px; overflow-y: auto; color: #7dd3fc; white-space: pre-wrap; margin-top: 16px; min-height: 120px; }
</style>
</head>
<body>
<div class="card">
  <h1>Smart Survey X — Version & APK</h1>
  <p class="sub">Bump version everywhere, then build the Android installer.</p>
  <div class="current-box">
    <div>
      <div style="font-size:12px; color:#94a3b8;">CURRENT VERSION</div>
      <div style="font-size:18px; font-weight:bold;" id="currVer">Loading…</div>
    </div>
    <span class="badge" id="currCode">Code: -</span>
  </div>
  <div class="btn-row">
    <button class="btn-primary" onclick="bump('patch')">Patch +1</button>
    <button class="btn-secondary" onclick="bump('minor')">Minor</button>
  </div>
  <input type="text" id="customVer" placeholder="e.g. 2.0.8">
  <div class="options">
    <label><input type="checkbox" id="optApk" checked> Build release APK after bump</label>
    <label><input type="checkbox" id="optDebug"> Build debug APK instead</label>
    <label><input type="checkbox" id="optPush" checked> Git commit &amp; push websites + API</label>
  </div>
  <div class="btn-row">
    <button class="btn-primary" id="btnVer" onclick="go(false)">Increase version</button>
    <button class="btn-green" id="btnApk" onclick="go(true)">Increase + build APK</button>
  </div>
  <div class="log-box" id="logs">Waiting…</div>
</div>
<script>
async function loadCurrent() {
  const d = await (await fetch('/api/info')).json();
  document.getElementById('currVer').textContent = 'v' + d.version;
  document.getElementById('currCode').textContent = 'versionCode: ' + d.versionCode;
  document.getElementById('customVer').placeholder = 'Next: ' + d.nextPatch;
}
function bump(type) {
  fetch('/api/info').then(r => r.json()).then(d => {
    document.getElementById('customVer').value = type === 'patch' ? d.nextPatch : d.nextMinor;
  });
}
async function go(apk) {
  const ver = document.getElementById('customVer').value.trim();
  const logs = document.getElementById('logs');
  const btns = [document.getElementById('btnVer'), document.getElementById('btnApk')];
  btns.forEach(b => b.disabled = true);
  logs.textContent = 'Starting…\\n';
  try {
    const res = await fetch('/api/bump', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: ver,
        apk: apk || document.getElementById('optApk').checked,
        debug: document.getElementById('optDebug').checked,
        push: document.getElementById('optPush').checked,
      }),
    });
    const d = await res.json();
    logs.textContent = (d.logs || []).join('\\n');
    loadCurrent();
  } catch (e) {
    logs.textContent += 'Error: ' + e.message;
  } finally {
    btns.forEach(b => b.disabled = false);
  }
}
loadCurrent();
</script>
</body>
</html>
"""


class VersionHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def _json(self, obj, status=200):
        raw = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            body = HTML_PAGE.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/api/info":
            v, code = get_current_version()
            self._json({"version": v, "versionCode": code, "nextPatch": bump_patch(v), "nextMinor": bump_minor(v)})
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        if self.path != "/api/bump":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", 0))
        data = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        curr_v, _ = get_current_version()
        new_v = (data.get("version") or "").strip() or bump_patch(curr_v)
        new_c = semver_to_code(new_v)
        logs = [f"==> {curr_v} → {new_v} (versionCode {new_c})"]
        logs.extend(update_files(new_v, new_c))
        if data.get("apk"):
            script = "build:apk" if data.get("debug") else "build:apk:release"
            logs.append(f"==> npm run {script}")
            collected = []
            ok = stream_cmd(["npm", "run", script], collected.append)
            logs.extend(collected[-80:])
            extra, dest = copy_apk("debug" if data.get("debug") else "release")
            logs.extend(extra)
            logs.append("APK ok" if ok else "APK failed")
            if ok and dest:
                publish_github_apk(new_v, dest, logs.append)
        if data.get("push"):
            logs.append("==> git push")
            git_push(new_v, new_c, logs.append)
        logs.append(f"Done. Version is v{new_v}")
        self._json({"logs": logs, "version": new_v, "versionCode": new_c})


def _free_port(preferred=3847):
    import socket

    for port in (preferred, preferred + 1, preferred + 2, 0):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind(("127.0.0.1", port))
            chosen = s.getsockname()[1]
            s.close()
            return chosen
        except OSError:
            s.close()
            continue
    raise RuntimeError("No free port for Version & APK UI")


def launch_web():
    # Never use 8899 — that port is the token-counter MCP on this machine.
    port = _free_port(3847)
    url = f"http://127.0.0.1:{port}/"
    print("")
    print("=" * 64)
    print("  Smart Survey X — Version & APK builder")
    print(f"  Open this page:  {url}")
    print("  (Not the token-counter page.)")
    print("=" * 64)
    print("")
    try:
        webbrowser.open(url)
    except Exception:
        pass
    httpd = ThreadingHTTPServer(("127.0.0.1", port), VersionHandler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped version UI.")
    finally:
        httpd.server_close()


def main():
    args = sys.argv[1:]
    if "--web" in args or "--ui" in args:
        launch_web()
        return

    cli = [a for a in args if not a.startswith("--")]
    if cli:
        curr_v, _ = get_current_version()
        target = cli[0]
        if target in ("patch", "bump"):
            target = bump_patch(curr_v)
        elif target == "minor":
            target = bump_minor(curr_v)
        elif target == "major":
            target = bump_major(curr_v)
        code = semver_to_code(target)
        print(f"{curr_v} → {target} ({code})")
        for line in update_files(target, code):
            print(line)
        if "--apk" in args:
            release = "--debug" not in args
            script = "build:apk:release" if release else "build:apk"
            print(f"Building {script}…")
            stream_cmd(["npm", "run", script], print)
            extra, dest = copy_apk("release" if release else "debug")
            for line in extra:
                print(line)
            if dest:
                publish_github_apk(target, dest, print)
        if "--push" in args or "-p" in args:
            git_push(target, code, print)
        return

    if "--push-only" in args or "--push" in args:
        v, c = get_current_version()
        git_push(v, c, print)
        return

    launch_tk()


if __name__ == "__main__":
    main()
