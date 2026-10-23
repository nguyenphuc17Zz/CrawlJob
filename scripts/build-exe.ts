import fs from "fs";
import path from "path";

const rootDir = process.cwd();
const exePath = path.join(rootDir, "CrawlJobStudio.exe");
const bunBin = process.execPath;

function patchPeSubsystemToGui(filePath: string): number {
  const fd = fs.openSync(filePath, "r+");
  try {
    const dosHeader = Buffer.alloc(64);
    fs.readSync(fd, dosHeader, 0, 64, 0);
    if (dosHeader.toString("ascii", 0, 2) !== "MZ") {
      throw new Error("Not a valid MZ PE executable.");
    }
    const peOffset = dosHeader.readUInt32LE(0x3c);
    const subsystemOffset = peOffset + 24 + 68;
    const subBuf = Buffer.alloc(2);
    fs.readSync(fd, subBuf, 0, 2, subsystemOffset);
    const currentSubsystem = subBuf.readUInt16LE(0);
    if (currentSubsystem !== 2) {
      subBuf.writeUInt16LE(2, 0); // 2 = IMAGE_SUBSYSTEM_WINDOWS_GUI
      fs.writeSync(fd, subBuf, 0, 2, subsystemOffset);
    }
    fs.readSync(fd, subBuf, 0, 2, subsystemOffset);
    return subBuf.readUInt16LE(0);
  } finally {
    fs.closeSync(fd);
  }
}

async function main() {
  // 0. Terminate any running old CrawlJobStudio*.exe and CrawlJobStudio_ChromeCleanProfile processes
  try {
    Bun.spawnSync(
      [
        "powershell",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Where-Object { ($_.Name -like 'CrawlJobStudio*.exe') -or ($_.CommandLine -like '*CrawlJobStudio_ChromeCleanProfile*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ],
      { stdout: "ignore", stderr: "ignore", windowsHide: true } as any
    );
    await new Promise((r) => setTimeout(r, 400));
  } catch {
    // ignore
  }

  // 1. Clean up unlocked .prev*.exe files
  for (const f of fs.readdirSync(rootDir)) {
    if (/^CrawlJobStudio\.prev[_\d]*\.exe$/i.test(f)) {
      try {
        fs.unlinkSync(path.join(rootDir, f));
      } catch {
        // still locked by a running old instance, ignore
      }
    }
  }

  // 2. If CrawlJobStudio.exe exists, try moving it to a temporary backup in case it's running
  if (fs.existsSync(exePath)) {
    const backupName = `CrawlJobStudio.prev_${Date.now()}.exe`;
    const backupPath = path.join(rootDir, backupName);
    try {
      fs.renameSync(exePath, backupPath);
      try {
        fs.unlinkSync(backupPath);
      } catch {
        // locked by running process, keep rotated until closed
      }
    } catch {
      // ignore
    }
  }

  // 3. Compile with --windows-hide-console
  console.log("[build-exe] Compiling CrawlJobStudio.exe with --windows-hide-console...");
  const proc = Bun.spawnSync(
    [
      bunBin,
      "build",
      "--compile",
      "--windows-hide-console",
      "server/standalone.ts",
      "--outfile",
      "CrawlJobStudio.exe",
    ],
    {
      cwd: rootDir,
      stdout: "inherit",
      stderr: "inherit",
    }
  );

  if (proc.exitCode !== 0) {
    process.exit(proc.exitCode || 1);
  }

  // 4. Verify & enforce PE Subsystem === 2 (IMAGE_SUBSYSTEM_WINDOWS_GUI)
  const finalSubsystem = patchPeSubsystemToGui(exePath);
  console.log(
    `[build-exe] Verified CrawlJobStudio.exe PE Subsystem = ${finalSubsystem} (2 = IMAGE_SUBSYSTEM_WINDOWS_GUI, Zero Console Window).`
  );
}

main();
