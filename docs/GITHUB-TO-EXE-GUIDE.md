# GitHub to EXE — Turn Any Repo Into a Real Executable

You found a cool project on GitHub. Now you want a double-clickable app you can
run anywhere — or hand to someone who has never typed `pip install` in their
life. This guide walks the whole path: download the code, figure out what
language it is, build it into a native executable on Windows, macOS, or Linux,
test it, and package it for sharing.

One naming note up front: "EXE" is the Windows format. The same process on
macOS produces a Mach-O binary (usually wrapped in a `.app` bundle) and on
Linux an ELF binary. The steps are the same — only the output format and the
distribution wrapper change.

**The one rule that governs everything: build on the OS you are targeting.**
PyInstaller, g++, and friends do not cross-compile out of the box. A Windows
`.exe` is built on Windows, a macOS `.app` on a Mac, a Linux binary on Linux.
(Go and Rust are the happy exceptions — see [Other languages](#other-languages-the-one-liners).)

---

## 1. Get the code

Two ways to pull a repo down:

**Clone with git (recommended)** — keeps history, lets you update later, and
pulls submodules:

```bash
git clone https://github.com/OWNER/REPO.git
cd REPO

# If the repo uses submodules (a .gitmodules file exists):
git submodule update --init --recursive
```

**Download ZIP** — the green **Code** button → **Download ZIP**. Fine for a
one-off build, but note two gotchas: ZIPs do not include submodules, and on
macOS/Linux they can drop the executable bit on scripts (fix with
`chmod +x script.sh`).

**Prefer a release tag over `main`.** The default branch is whatever the
maintainer pushed last night. Releases are the states the maintainer considered
buildable:

```bash
git tag --list          # see available versions
git checkout v2.1.0     # build from a known-good point
```

Also check the repo's **Releases** page before building anything — many
projects already publish prebuilt executables there, and downloading one beats
compiling one.

---

## 2. Identify the language and build system

Look at the files in the repo root. The manifest file tells you the language,
and the language tells you the toolchain:

| File in repo root | Language | You'll build with |
|---|---|---|
| `requirements.txt`, `pyproject.toml`, `setup.py` | Python | PyInstaller |
| `CMakeLists.txt` | C / C++ | CMake + a compiler |
| `Makefile` | C / C++ (usually) | `make` |
| `*.sln`, `*.vcxproj` | C / C++ (Windows) | Visual Studio |
| `package.json` | JavaScript / TypeScript | Node SEA, Bun, or electron-builder |
| `go.mod` | Go | `go build` |
| `Cargo.toml` | Rust | `cargo build --release` |
| `*.csproj` | C# / .NET | `dotnet publish` |
| `pom.xml`, `build.gradle` | Java / Kotlin | `jpackage` |

GitHub's language bar (right side of the repo page) confirms the mix. And
always read the README first — if it has a "Building" or "Installation"
section, that beats any generic recipe in this guide.

> 💡 **Shortcut:** this is exactly the kind of grunt work Claude Code is good
> at. `cd` into the clone, launch Claude Code (cloud — or fully local with the
> lineup in this repo), and ask *"figure out how this project builds and
> produce a standalone executable."* It will read the manifests, run the build,
> and debug the errors for you.

---

## 3. Tools you'll need per platform

| Platform | Install once |
|---|---|
| **Windows** | [Python](https://www.python.org/downloads/) (check *"Add to PATH"* in the installer) · [MSYS2](https://www.msys2.org/) for g++ **or** [Visual Studio](https://visualstudio.microsoft.com/) with the *Desktop development with C++* workload · [Git for Windows](https://git-scm.com/) |
| **macOS** | Xcode Command Line Tools: `xcode-select --install` (gives you git + clang) · [Homebrew](https://brew.sh/) · Python: `brew install python` |
| **Linux (Debian/Ubuntu)** | `sudo apt update && sudo apt install build-essential git python3 python3-pip python3-venv cmake` |

That covers ~90% of GitHub projects. Anything more exotic will be named in the
project's README.

---

## 4. Python → EXE with PyInstaller

The most common case. PyInstaller bundles your script, its imports, and a
Python interpreter into one self-contained program — the person you send it to
does not need Python installed.

**Step 1 — set up a clean virtual environment.** This matters more than it
looks: PyInstaller bundles the packages it can see, so a clean venv with only
the project's dependencies keeps the output small.

```bash
cd REPO
python -m venv .venv

# Activate it:
.venv\Scripts\activate         # Windows
source .venv/bin/activate      # macOS / Linux

pip install -r requirements.txt
pip install pyinstaller
```

**Step 2 — find the entry point.** Look for `main.py`, `app.py`, `run.py`, or
whatever the README says to run. For packages installed with an entry script,
`pyproject.toml`'s `[project.scripts]` section names the real entry function.

**Step 3 — build:**

```bash
pyinstaller --onefile --name MyApp main.py
```

Your executable lands in **`dist/`** (`dist/MyApp.exe` on Windows,
`dist/MyApp` elsewhere). The `build/` folder and `MyApp.spec` file are
intermediate artifacts — the `.spec` file is worth keeping, since
`pyinstaller MyApp.spec` reproduces the exact build later.

**The flags you'll actually use:**

| Flag | What it does |
|---|---|
| `--onefile` | Single self-extracting executable instead of a folder |
| `--windowed` (or `--noconsole`) | No black console window — required for GUI apps (Tkinter, PyQt, pygame) |
| `--icon=app.ico` | Custom icon (`.ico` on Windows, `.icns` on macOS) |
| `--add-data "assets;assets"` | Bundle data files — separator is `;` on Windows, `:` on macOS/Linux |
| `--hidden-import=NAME` | Force-include a module PyInstaller's scanner missed |
| `--exclude-module=NAME` | Drop a package you don't need (shrinks output) |

**One-file vs one-folder:** `--onefile` is tidier to share but unpacks itself
to a temp dir on every launch, so it starts slower and trips antivirus
heuristics more often. If startup speed or AV flags become a problem, drop
`--onefile` and ship the `dist/MyApp/` folder as a ZIP instead.

**Alternatives worth knowing:** [auto-py-to-exe](https://pypi.org/project/auto-py-to-exe/)
is a point-and-click GUI over PyInstaller (great for a first build);
[Nuitka](https://nuitka.net/) actually compiles Python to C for faster,
harder-to-reverse binaries; [cx_Freeze](https://cx-freeze.readthedocs.io/) is
the long-standing cross-platform freezer.

---

## 5. Compiling C++ on Windows

### Option A — g++ via MSYS2 (closest to the Linux workflow)

Install [MSYS2](https://www.msys2.org/), open the **UCRT64** shell, and:

```bash
pacman -S mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-cmake make

# Single-file project:
g++ main.cpp -o MyApp.exe -O2

# Statically link the runtime so the EXE runs on machines without MinGW:
g++ main.cpp -o MyApp.exe -O2 -static
```

### Option B — Visual Studio (the native Windows way)

If the repo has a `.sln` file: open it in Visual Studio, switch the toolbar
dropdown from **Debug** to **Release**, then **Build → Build Solution**. The
EXE appears under `x64/Release/`.

Heads-up: MSVC-built programs need the
[Visual C++ Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist)
on the target machine — the classic *"MSVCP140.dll was not found"* error means
it's missing.

### Option C — CMake (what most real C++ repos on GitHub use)

If the repo has `CMakeLists.txt`, ignore options A/B and do this — it works
with either compiler on every platform:

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
```

The executable ends up in `build/` (or `build/Release/` with Visual Studio).

---

## 6. Building on macOS and Linux

### macOS

```bash
xcode-select --install                      # once
clang++ main.cpp -o MyApp -O2               # C++ directly, or use the CMake recipe above
pyinstaller --onefile --windowed main.py    # Python — --windowed also produces a dist/MyApp.app bundle
```

Mac-specific realities:

- **Architectures:** an Apple Silicon build won't run on Intel Macs and vice
  versa (unless the project builds a universal binary). Check what you made
  with `file dist/MyApp`. Build on the kind of Mac you're targeting.
- **Gatekeeper:** an unsigned app downloaded from the internet gets blocked
  with *"cannot be opened because it is from an unidentified developer"* (or
  claimed to be "damaged"). Your testers can allow it via **System Settings →
  Privacy & Security → Open Anyway**, or clear the quarantine flag:
  `xattr -d com.apple.quarantine MyApp.app`. For real public distribution
  you'll eventually want an Apple Developer ID to `codesign` and notarize.

### Linux

```bash
sudo apt install build-essential cmake      # once (Debian/Ubuntu)
g++ main.cpp -o myapp -O2                   # or the CMake recipe, or:
make -j$(nproc)                             # if the repo ships a Makefile
chmod +x myapp                              # ensure it's executable
./myapp
```

Linux-specific reality: binaries built against a **newer glibc won't run on
older distros** (`version GLIBC_2.38 not found`). If you're distributing, build
on the oldest distro you intend to support — or sidestep the whole issue by
packaging as an [AppImage](https://appimage.org/), which bundles the
dependencies and runs anywhere.

### Other languages: the one-liners

| Language | Standalone build command | Output |
|---|---|---|
| Go | `go build -o myapp .` — cross-compiles with `GOOS=windows GOARCH=amd64 go build` | single static binary |
| Rust | `cargo build --release` | `target/release/myapp` |
| C# / .NET | `dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true` | single-file EXE |
| Node.js | `bun build --compile app.js --outfile myapp` (or Node's single-executable-application feature; the old `pkg` tool is archived) | single binary |
| Electron app | `npx electron-builder` (repo usually has a `dist`/`build` script in `package.json`) | installer per platform |
| Java | `jpackage --input target/ --main-jar app.jar --name MyApp` | native installer |

---

## 7. Test and verify the build

A build that runs on your machine proves almost nothing — your machine has all
the dev tools installed. Before sharing:

1. **Run it from `dist/`, not from the project folder.** A PyInstaller build
   that silently depended on files sitting next to your source will fail
   anywhere else. Copy the executable alone to `~/Desktop` and run it there.
2. **Test on a clean machine** — a VM, a friend's laptop, anything without
   Python/compilers installed. This is the single highest-value test. On
   Windows, a free
   [developer evaluation VM](https://developer.microsoft.com/en-us/windows/downloads/virtual-machines/)
   works well.
3. **Check dynamic library dependencies** if it won't start elsewhere:
   `ldd myapp` (Linux), `otool -L MyApp` (macOS), or the
   [Dependencies](https://github.com/lucasg/Dependencies) tool (Windows).
   Anything resolving to a path inside your dev environment will be missing on
   other machines — link it statically or ship it alongside.
4. **Exercise the real features**, not just launch: open a file, hit the
   network, save output. Missing `--add-data` assets and hidden imports only
   fail when the code path that needs them runs.
5. **Record a checksum** so downloaders can verify integrity:
   `sha256sum myapp` (Linux), `shasum -a 256 MyApp` (macOS),
   `certutil -hashfile MyApp.exe SHA256` (Windows). Publish it next to the
   download.

---

## 8. Packaging and distribution

**Icons.** Windows wants `.ico`, macOS wants `.icns`. From a 1024×1024 PNG:
`magick icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico`
(ImageMagick) for Windows, `iconutil` on macOS. Then pass `--icon` to
PyInstaller or set it in your installer tool.

**Permissions.** ZIP archives don't reliably preserve the Unix executable bit
— ship macOS/Linux builds as `.tar.gz` (`tar czf myapp.tar.gz myapp`), or
document the one-time `chmod +x myapp` fix.

**Installers, per platform:**

- **Windows:** [Inno Setup](https://jrsoftware.org/isinfo.php) or
  [NSIS](https://nsis.sourceforge.io/) wrap your EXE in a proper
  install/uninstall experience — this is also the polite way to ship a
  one-folder PyInstaller build.
- **macOS:** a drag-to-Applications DMG via
  [create-dmg](https://github.com/create-dmg/create-dmg), or just a zipped
  `.app`.
- **Linux:** AppImage for run-anywhere, or a `.deb` via `dpkg-deb` if you're
  targeting Debian/Ubuntu specifically.

**Where to host it: GitHub Releases.** Tag a version, draft a release, attach
one artifact per platform (`MyApp-1.0-windows.zip`, `MyApp-1.0-macos.tar.gz`,
`MyApp-1.0-linux.tar.gz`) plus the checksums. Bonus points: a GitHub Actions
workflow with a matrix over `windows-latest` / `macos-latest` /
`ubuntu-latest` builds all three on every tag — which neatly solves the
"build on the OS you target" rule without owning three machines.

**The antivirus talk.** Unsigned, freshly-built one-file executables are the
exact shape of thing SmartScreen and antivirus heuristics distrust — expect
*"Windows protected your PC"* (users click **More info → Run anyway**) and the
occasional false positive. Legitimate mitigations: prefer one-folder + installer
over `--onefile`, skip UPX compression (a classic red flag), sign your builds
(a code-signing certificate on Windows, a Developer ID on macOS), and publish
checksums. And the obvious flip side: only build and run code from repos you
trust — you are compiling a stranger's program, so skim the source first.

---

## 9. Troubleshooting quick reference

| Symptom | Cause → fix |
|---|---|
| `ModuleNotFoundError` only in the built EXE | PyInstaller missed a dynamic import → rebuild with `--hidden-import=thatmodule` |
| `MSVCP140.dll / VCRUNTIME140.dll not found` | MSVC runtime missing on target → install the VC++ Redistributable, or build with MinGW `-static` |
| `cannot execute binary file: Exec format error` | Built for the wrong OS or CPU architecture → rebuild on/for the target platform (`file myapp` shows what you made) |
| macOS says the app is *"damaged"* or from an *"unidentified developer"* | Gatekeeper quarantine → **Privacy & Security → Open Anyway**, or `xattr -d com.apple.quarantine MyApp.app` |
| `version GLIBC_2.xx not found` on Linux | Built on a newer distro than the target → build on the oldest supported distro or ship an AppImage |
| EXE is enormous (hundreds of MB) | Built from a bloated environment → rebuild inside a clean venv; add `--exclude-module` for heavyweights you don't use |
| One-file EXE takes ~5s to launch | Normal — it self-extracts each run → switch to one-folder mode if it bothers you |
| GUI app flashes a black console window | Console build of a GUI app → rebuild with `--windowed` |
| Works on your machine, crashes elsewhere | Hidden dependency on your dev environment → the clean-machine test in [§7](#7-test-and-verify-the-build), then `ldd`/`otool -L`/Dependencies to find what's missing |

---

## TL;DR

```bash
git clone https://github.com/OWNER/REPO.git && cd REPO   # 1. get the code
ls                                                        # 2. spot the manifest → language
# Python:
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt pyinstaller
pyinstaller --onefile --name MyApp main.py                # → dist/MyApp(.exe)
# C++ with CMake:
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build --config Release
```

Build on each OS you target, test on a machine without dev tools, ship via
GitHub Releases with checksums. That's the whole game.
