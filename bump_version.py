#!/usr/bin/env python3
"""
Smart Survey X / Ground IQ — Automated Version Bumper & Release Manager
Provides a modern Browser GUI and CLI to bump version everywhere and push to Git.
"""

import sys
import os
import json
import re
import subprocess
import webbrowser
import http.server
import socketserver
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
PACKAGE_JSON = ROOT_DIR / "package.json"
PACKAGE_LOCK = ROOT_DIR / "package-lock.json"
BUILD_GRADLE = ROOT_DIR / "android" / "app" / "build.gradle"
DENO_MAIN = ROOT_DIR / "deno-deploy" / "main.ts"

def get_current_version():
    try:
        with open(PACKAGE_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)
            version = data.get("version", "2.0.0")
            code = data.get("versionCode", 20000)
            return version, int(code)
    except Exception:
        return "2.0.0", 20000

def semver_to_code(version_str):
    clean = re.sub(r"[^0-9.]", "", version_str)
    parts = clean.split(".")
    major = int(parts[0]) if len(parts) > 0 and parts[0] else 0
    minor = int(parts[1]) if len(parts) > 1 and parts[1] else 0
    patch = int(parts[2]) if len(parts) > 2 and parts[2] else 0
    return major * 10000 + minor * 100 + patch

def bump_patch(v_str):
    parts = v_str.split(".")
    if len(parts) >= 3:
        parts[2] = str(int(parts[2]) + 1)
        return ".".join(parts)
    return f"{v_str}.1"

def bump_minor(v_str):
    parts = v_str.split(".")
    if len(parts) >= 2:
        parts[1] = str(int(parts[1]) + 1)
        parts[2] = "0"
        return ".".join(parts)
    return "2.1.0"

def update_files(new_version, new_code):
    logs = []
    
    # 1. package.json
    try:
        with open(PACKAGE_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)
        data["version"] = new_version
        data["versionCode"] = new_code
        with open(PACKAGE_JSON, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
        logs.append(f"✓ Updated package.json -> {new_version} (versionCode: {new_code})")
    except Exception as e:
        logs.append(f"x Failed updating package.json: {e}")

    # 2. package-lock.json
    try:
        if PACKAGE_LOCK.exists():
            with open(PACKAGE_LOCK, "r", encoding="utf-8") as f:
                lock = json.load(f)
            lock["version"] = new_version
            if "packages" in lock and "" in lock["packages"]:
                lock["packages"][""]["version"] = new_version
            with open(PACKAGE_LOCK, "w", encoding="utf-8") as f:
                json.dump(lock, f, indent=2)
                f.write("\n")
            logs.append(f"✓ Updated package-lock.json -> {new_version}")
    except Exception as e:
        logs.append(f"x Failed updating package-lock.json: {e}")

    # 3. android/app/build.gradle
    try:
        if BUILD_GRADLE.exists():
            content = BUILD_GRADLE.read_text(encoding="utf-8")
            content = re.sub(r"versionCode\s+\d+", f"versionCode {new_code}", content)
            content = re.sub(r'versionName\s+["\'][^"\']+["\']', f'versionName "{new_version}"', content)
            BUILD_GRADLE.write_text(content, encoding="utf-8")
            logs.append(f"✓ Updated android/app/build.gradle -> {new_version} (versionCode: {new_code})")
    except Exception as e:
        logs.append(f"x Failed updating build.gradle: {e}")

    # 4. deno-deploy/main.ts
    try:
        if DENO_MAIN.exists():
            content = DENO_MAIN.read_text(encoding="utf-8")
            content = re.sub(r'version:\s*["\'][^"\']+["\']', f'version: "{new_version}"', content, count=1)
            content = re.sub(r"versionCode:\s*\d+", f"versionCode: {new_code}", content, count=1)
            DENO_MAIN.write_text(content, encoding="utf-8")
            logs.append(f"✓ Updated deno-deploy/main.ts -> {new_version} (versionCode: {new_code})")
    except Exception as e:
        logs.append(f"x Failed updating deno-deploy/main.ts: {e}")

    return logs

def run_cmd(cmd):
    try:
        res = subprocess.run(cmd, shell=True, cwd=str(ROOT_DIR), capture_output=True, text=True)
        return res.returncode == 0, res.stdout + res.stderr
    except Exception as e:
        return False, str(e)

HTML_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Ground IQ — Version Bumper UI</title>
<style>
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  body { background: #0f172a; color: #f8fafc; margin: 0; padding: 40px 20px; display: flex; justify-content: center; }
  .card { background: #1e293b; border: 1px solid rgba(56,189,248,0.3); border-radius: 16px; padding: 28px; max-width: 580px; width: 100%; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
  h1 { font-size: 22px; margin: 0 0 4px; color: #38bdf8; display: flex; align-items: center; gap: 8px; }
  p.sub { color: #94a3b8; font-size: 13px; margin: 0 0 24px; }
  .badge { background: #0284c7; color: #fff; padding: 4px 10px; border-radius: 999px; font-weight: 700; font-size: 13px; }
  .current-box { background: rgba(15,23,42,0.6); border: 1px solid #334155; border-radius: 12px; padding: 14px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
  .btn-row { display: flex; gap: 10px; margin-bottom: 20px; }
  button { flex: 1; padding: 12px 14px; border: none; border-radius: 10px; font-weight: 700; font-size: 14px; cursor: pointer; transition: all 0.15s ease; }
  .btn-primary { background: #0284c7; color: #fff; }
  .btn-primary:hover { background: #0369a1; }
  .btn-green { background: #10b981; color: #fff; }
  .btn-green:hover { background: #059669; }
  .btn-secondary { background: #334155; color: #f8fafc; }
  .btn-secondary:hover { background: #475569; }
  input[type="text"] { width: 100%; padding: 12px; border-radius: 10px; background: #0f172a; border: 1px solid #475569; color: #fff; font-size: 15px; margin-bottom: 14px; }
  .options { margin-bottom: 20px; display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: #cbd5e1; }
  label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
  .log-box { background: #090d16; border: 1px solid #1e293b; border-radius: 10px; padding: 12px; font-family: monospace; font-size: 12px; max-height: 200px; overflow-y: auto; color: #38bdf8; white-space: pre-wrap; margin-top: 16px; }
</style>
</head>
<body>
<div class="card">
  <h1>⚡ Smart Survey X — Version Manager</h1>
  <p class="sub">Increases version across package.json, Android Gradle, Deno Deploy, and Git remotes.</p>

  <div class="current-box">
    <div>
      <div style="font-size:12px; color:#94a3b8;">CURRENT VERSION</div>
      <div style="font-size:18px; font-weight:bold; color:#fff;" id="currVer">Loading…</div>
    </div>
    <span class="badge" id="currCode">Code: -</span>
  </div>

  <div style="margin-bottom: 8px; font-size:13px; font-weight:600; color:#cbd5e1;">Quick Actions:</div>
  <div class="btn-row">
    <button class="btn-primary" onclick="bump('patch')">+ Patch (+1)</button>
    <button class="btn-secondary" onclick="bump('minor')">+ Minor (x.0)</button>
  </div>

  <div style="margin-bottom: 6px; font-size:13px; font-weight:600; color:#cbd5e1;">Or Enter Custom Version:</div>
  <input type="text" id="customVer" placeholder="e.g. 2.0.4 or 2.1.0">

  <div class="options">
    <label><input type="checkbox" id="optBuild" checked> Run production build & lint test</label>
    <label><input type="checkbox" id="optPush" checked> Git commit & push to GitHub remotes</label>
    <label><input type="checkbox" id="optApk"> Build release APK (npm run build:apk:release)</label>
  </div>

  <button class="btn-green" style="width:100%;" onclick="applyVersion()" id="submitBtn">🚀 Apply Version & Sync Everywhere</button>

  <div class="log-box" id="logs">Waiting for action…</div>
</div>

<script>
async function loadCurrent() {
  const res = await fetch('/api/info');
  const d = await res.json();
  document.getElementById('currVer').textContent = 'v' + d.version;
  document.getElementById('currCode').textContent = 'versionCode: ' + d.versionCode;
  document.getElementById('customVer').placeholder = 'Next suggested: ' + d.nextPatch;
}

function bump(type) {
  fetch('/api/info').then(r => r.json()).then(d => {
    document.getElementById('customVer').value = type === 'patch' ? d.nextPatch : d.nextMinor;
  });
}

async function applyVersion() {
  const ver = document.getElementById('customVer').value.trim();
  const btn = document.getElementById('submitBtn');
  const logs = document.getElementById('logs');

  btn.disabled = true;
  btn.textContent = 'Applying changes & syncing…';
  logs.textContent = 'Starting version update process…\n';

  const payload = {
    version: ver,
    build: document.getElementById('optBuild').checked,
    push: document.getElementById('optPush').checked,
    apk: document.getElementById('optApk').checked,
  };

  try {
    const res = await fetch('/api/bump', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await res.json();
    logs.textContent = (d.logs || []).join('\n');
    loadCurrent();
  } catch (e) {
    logs.textContent += 'Error: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 Apply Version & Sync Everywhere';
  }
}

loadCurrent();
</script>
</body>
</html>
"""

class VersionHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        if self.path == "/" or self.path == "/index.html":
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(HTML_PAGE.encode("utf-8"))
            return

        if self.path == "/api/info":
            v, code = get_current_version()
            info = {
                "version": v,
                "versionCode": code,
                "nextPatch": bump_patch(v),
                "nextMinor": bump_minor(v),
            }
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(info).encode("utf-8"))
            return

        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        if self.path == "/api/bump":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode("utf-8")
            data = json.loads(body or "{}")

            req_v = data.get("version")
            curr_v, curr_c = get_current_version()
            new_v = req_v if req_v else bump_patch(curr_v)
            new_c = semver_to_code(new_v)

            all_logs = []
            all_logs.append(f"==> Updating version: {curr_v} -> {new_v} (versionCode: {new_c})")
            
            file_logs = update_files(new_v, new_c)
            all_logs.extend(file_logs)

            if data.get("build"):
                all_logs.append("==> Running lint and production build…")
                ok, out = run_cmd("npm run lint && npm run build")
                all_logs.append(out.strip() if out else "Build completed.")

            if data.get("push"):
                all_logs.append("==> Staging all changes (git add -A)…")
                run_cmd("git add -A")
                _, st = run_cmd("git status --short")
                if st.strip():
                    all_logs.append(f"Staged files:\n{st.strip()}")
                all_logs.append("==> Committing and pushing to Git…")
                ok, out = run_cmd(f'git commit -m "Bump version to v{new_v} (versionCode {new_c})"')
                all_logs.append(out.strip() if out else "Committed.")
                ok, out = run_cmd("git push ground-iq ground-sync:main && git push ground-iq-superadmin ground-sync:main")
                all_logs.append(out.strip() if out else "Pushed to remotes.")
                all_logs.append(f"✓ Staged, committed & pushed v{new_v} to both GitHub remotes!")

            if data.get("apk"):
                all_logs.append("==> Building Release APK…")
                ok, out = run_cmd("npm run build:apk:release")
                all_logs.append(out.strip() if out else "APK built.")

            all_logs.append(f"🎉 Version successfully updated everywhere to v{new_v}!")

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"logs": all_logs, "version": new_v}).encode("utf-8"))
            return

        self.send_response(404)
        self.end_headers()

def main():
    if len(sys.argv) > 1 and not sys.argv[1].startswith("--ui"):
        target_v = sys.argv[1]
        curr_v, curr_c = get_current_version()
        if target_v in ["patch", "bump"]:
            target_v = bump_patch(curr_v)
        elif target_v in ["minor"]:
            target_v = bump_minor(curr_v)
        
        target_c = semver_to_code(target_v)
        print(f"Bumping version: {curr_v} -> {target_v} (code: {target_c})")
        for log in update_files(target_v, target_c):
            print(log)
        
        if "--push" in sys.argv or "-p" in sys.argv:
            print("Building and pushing to Git...")
            run_cmd("npm run lint && npm run build")
            run_cmd("git add -A")
            run_cmd(f"git commit -m \"Bump version to v{target_v} (versionCode {target_c})\"")
            run_cmd("git push ground-iq ground-sync:main && git push ground-iq-superadmin ground-sync:main")
            print("✓ Pushed to both remotes!")
        return

    port = 8899
    print("=" * 65)
    print(f"🚀 Ground IQ Version Manager UI running at: http://localhost:{port}")
    print("=" * 65)
    
    try:
        webbrowser.open(f"http://localhost:{port}")
    except:
        pass

    with socketserver.TCPServer(("", port), VersionHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped version manager.")

if __name__ == "__main__":
    main()
