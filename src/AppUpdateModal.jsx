import { useState, useEffect } from "react";
import { checkForAppUpdate, dismissUpdate, launchApkUpdate } from "./appUpdate";

export default function AppUpdateModal() {
  const [updateInfo, setUpdateInfo] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Check for updates on startup with a gentle delay (after main screen paints)
    const t = setTimeout(async () => {
      try {
        const res = await checkForAppUpdate();
        if (res.hasUpdate) {
          setUpdateInfo(res);
        }
      } catch {
        // silent fail
      }
    }, 2500);

    return () => clearTimeout(t);
  }, []);

  if (!updateInfo) return null;

  const { latest, currentVersion } = updateInfo;

  const handleUpdate = async () => {
    setLoading(true);
    try {
      await launchApkUpdate(latest.apkUrl);
    } catch {
      /* toast from Profile path; here just stop spinner */
    } finally {
      setLoading(false);
    }
  };

  const handleDismiss = () => {
    dismissUpdate(latest.version);
    setUpdateInfo(null);
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 20,
        left: "50%",
        transform: "translateX(-50%)",
        width: "calc(100% - 32px)",
        maxWidth: 440,
        zIndex: 99999,
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        border: "1px solid rgba(56, 189, 248, 0.4)",
        borderRadius: 16,
        padding: "16px 18px",
        boxShadow: "0 20px 35px -5px rgba(0, 0, 0, 0.7), 0 0 15px rgba(56, 189, 248, 0.2)",
        color: "#f8fafc",
        animation: "slideUp 0.3s ease-out",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: "rgba(56, 189, 248, 0.15)",
            display: "grid",
            placeItems: "center",
            fontSize: 20,
            flexShrink: 0,
          }}
        >
          🚀
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#38bdf8" }}>
              Update Available (v{latest.version})
            </h4>
            <span
              style={{
                fontSize: 11,
                padding: "2px 6px",
                borderRadius: 6,
                background: "rgba(148, 163, 184, 0.2)",
                color: "#94a3b8",
              }}
            >
              Current: v{currentVersion}
            </span>
          </div>

          <p style={{ margin: "6px 0 12px", fontSize: 13, color: "#cbd5e1", lineHeight: 1.4 }}>
            {latest.changelog || "A new update is available with performance and security improvements."}
          </p>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <button
              onClick={handleUpdate}
              disabled={loading}
              style={{
                flex: 1,
                padding: "8px 14px",
                borderRadius: 8,
                background: "#0284c7",
                color: "#fff",
                border: "none",
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              {loading ? "Downloading inside app…" : "Install in app"}
            </button>
            {!latest.mandatory && (
              <button
                onClick={handleDismiss}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "transparent",
                  color: "#94a3b8",
                  border: "1px solid rgba(148, 163, 184, 0.3)",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Later
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
