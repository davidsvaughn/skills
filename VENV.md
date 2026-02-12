# `archivenv` + `findvenv`

## Python Virtual Environment Archival & Discovery System

This system provides:

* A safe way to **archive and delete Python virtual environments**
* A portable, single-file archive format
* A **central registry** of archived environments
* A global command to **locate large venv folders** anywhere on your machine

Designed for reclaiming disk space without losing reproducibility.

---

# Part 1 — `archivenv`

## Purpose

`archivenv` archives a virtual environment into a single `.tar.gz` file, logs it centrally, and optionally deletes the environment directory.

---

## What It Does

1. Detects a virtual environment directory
2. Extracts reproducibility data:

   * Python version
   * `pip freeze` output
   * Project and venv metadata
3. Packages everything into **one archive file**
4. Logs the archive in:

```
~/.local/share/venv-archive/index.tsv
```

5. Optionally deletes the venv directory

---

## Venv Detection Rules

If no directory is specified, it searches in this order:

```
.venv
venv
env
.env
```

You can override detection with:

```bash
archivenv --dir path/to/venv
```

---

## Archive Output

Each run produces:

```
<project-name>__YYYYMMDDTHHMMSSZ.tar.gz
```

Example:

```
myproject__20260212T184501Z.tar.gz
```

---

## What’s Inside the Archive

Each `.tar.gz` contains:

```
venv-archive.json
requirements.txt
```

### `venv-archive.json`

Contains:

* UTC timestamp
* Absolute project path
* Absolute venv path
* Relative venv directory name
* Python executable path
* Full Python version string
* Parsed Python version (e.g., 3.10.12)
* Pip executable path

### `requirements.txt`

Exact output of:

```
pip freeze
```

This is sufficient to reconstruct the environment.

---

## Central Archive Index

All archives are recorded in:

```
~/.local/share/venv-archive/index.tsv
```

Format:

```
archived_at_utc    project_dir    venv_dir    archive_path    python_version
```

To view neatly:

```bash
column -t -s $'\t' ~/.local/share/venv-archive/index.tsv | less
```

This provides a global history of archived environments.

---

## Usage

### Basic (autodetect + delete)

```bash
archivenv
```

### Specify venv directory

```bash
archivenv --dir .myenv
```

### Store archive somewhere else

```bash
archivenv --out ~/venv-archives
```

### Keep venv (do not delete)

```bash
archivenv --keep
```

### Non-interactive mode

```bash
archivenv --yes
```

### Disable central logging

```bash
archivenv --no-central
```

---

## Recreating an Environment

1. Extract the archive:

```bash
tar -xzf myproject__20260212T184501Z.tar.gz
```

2. Inspect Python version (optional):

```bash
cat venv-archive.json
```

3. Recreate:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

If using a version manager, install the recorded Python version first.

---

## Limitations

* Does not track OS-level dependencies (apt, system libs)
* Does not snapshot compiled binary state
* Assumes packages remain installable
* Assumes compatible OS + architecture

This is not system imaging. It is reproducible environment archiving.

---

# Part 2 — `findvenv`

## Purpose

`findvenv` scans directories and lists virtual environments along with their disk usage.

Useful before running `archivenv` to see what’s consuming space.

---

## Installation Location

The script lives in:

```
~/.local/bin/findvenv
```

Ensure this directory is in your PATH:

```bash
echo $PATH
```

If needed, add to `~/.bashrc`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Then:

```bash
source ~/.bashrc
```

---

## What It Does

* Recursively searches for directories named:

  * `.venv`
  * `venv`
  * `venv-*`
* Computes disk usage (`du -sh`)
* Prints size + full path
* Sorts by size (smallest → largest)

---

## Usage

Search entire home directory:

```bash
findvenv
```

Search a specific directory:

```bash
findvenv ~/projects
```

Example output:

```
356M     /home/user/oldproj/venv-3.10
842M     /home/user/ml/venv
1.2G     /home/user/projects/api/.venv
```

---

# Recommended Workflow

1. Find large environments:

```bash
findvenv
```

2. Navigate to project directory.

3. Archive:

```bash
archivenv
```

4. Confirm deletion.

5. Disk space reclaimed.

---

# Storage Layout Summary

### Project directory (after archival)

```
project/
├── (no .venv)
└── source files
```

### Archive files (wherever you store them)

```
myproject__20260212T184501Z.tar.gz
```

### Central registry

```
~/.local/share/venv-archive/index.tsv
```
