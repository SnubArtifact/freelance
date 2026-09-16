import fs from "node:fs";

/**
 * Finds which mount a path lives on, given the text of /proc/mounts. The
 * longest mount point that contains the path wins; "/" if nothing else does.
 */
export function mountPointFor(target, mountsText) {
  const mounts = mountsText
    .split("\n")
    .map((line) => line.split(" ")[1])
    .filter(Boolean)
    .map((m) => m.replace(/\\040/g, " ")); // /proc/mounts escapes spaces
  return (
    mounts
      .filter((m) => target === m || target.startsWith(m.endsWith("/") ? m : `${m}/`))
      .sort((a, b) => b.length - a.length)[0] || "/"
  );
}

/**
 * Works out whether dataDir survives a restart. Only Render needs checking:
 * there, anything outside a mounted disk is erased on every restart, redeploy,
 * or (on the free plan) wake-up from sleep. A local machine's disk is kept.
 */
export function checkStorage(dataDir, appDir, env = process.env) {
  if (env.RENDER !== "true") return { persistent: true, host: "local" };

  let mountsText;
  try {
    mountsText = fs.readFileSync("/proc/mounts", "utf8");
  } catch {
    return { persistent: false, host: "render", dataDir, mount: null };
  }
  const dataMount = mountPointFor(fs.realpathSync(dataDir), mountsText);
  const appMount = mountPointFor(fs.realpathSync(appDir), mountsText);
  return {
    // Kept only if the data sits on its own mount, not the container's root
    // filesystem and not wherever the app code itself lives.
    persistent: dataMount !== "/" && dataMount !== appMount,
    host: "render",
    dataDir,
    mount: dataMount,
  };
}
