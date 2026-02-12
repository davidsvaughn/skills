# Docker Disk Cleanup & Maintenance Guide

This document summarizes how to diagnose and reclaim disk space when Docker consumes large amounts of storage (especially `/var/lib/docker/overlay2`).

---

# 🚨 Symptoms

- `/var/lib/docker/overlay2` is very large
- Disk nearly full
- Many `<none>` images
- Frequent image rebuilds (especially large ML/CUDA images)
- No obvious running containers using that space

---

# 🧠 Why This Happens

Docker does **not automatically garbage-collect**:

- Old image versions
- Dangling (`<none>`) images
- Intermediate build layers
- Build cache

Each rebuild (especially large CUDA/LLM images) creates new layer stacks. Over time this can accumulate tens or hundreds of GB.

---

# 🔎 Step 1: Diagnose Disk Usage

### Check Docker root directory
```bash
docker info | grep "Docker Root Dir"
````

### Check top-level Docker disk usage

```bash
sudo sh -c 'du -sh /var/lib/docker/*'
```

If `overlay2` is huge, the problem is almost always images + build cache.

### Inspect detailed Docker usage

```bash
docker system df -v
```

This shows:

* Images (size + shared size + containers using them)
* Containers
* Volumes
* Build cache
* Reclaimable space

---

# 🧹 Step 2: Clean Up (Most Common Fix)

## 🔥 Remove Unused Images (Biggest Impact)

```bash
docker image prune -a
```

Removes:

* All dangling (`<none>`) images
* All images not used by any container

If you have no containers, this removes nearly everything.

---

## 🔥 Remove Build Cache

```bash
docker builder prune -a
```

Removes:

* Intermediate build layers
* Build cache accumulation

This often reclaims several GB.

---

## 🔥 Remove Stopped Containers (if any)

```bash
docker container prune
```

---

## 💣 Nuclear Option (Remove Everything Unused)

```bash
docker system prune -a --volumes
```

Removes:

* Stopped containers
* Unused images
* Unused networks
* Unused volumes
* Build cache

⚠️ Does NOT remove running containers.

---

# ✅ Step 3: Verify Space Reclaimed

```bash
docker system df
sudo sh -c 'du -sh /var/lib/docker/*'
```

`overlay2` should now be significantly smaller.

---

# 🛡️ Prevent Future Disk Explosion

After heavy rebuild sessions:

```bash
docker image prune -f
docker builder prune -f
```

Or occasionally:

```bash
docker system prune -af
```

---

# 🧩 What Lives in overlay2?

`overlay2` stores:

* Image layers
* Container writable layers
* Build layers

Large ML/CUDA images (10–25GB each) multiply quickly with repeated rebuilds.

---

# 🧨 What NOT To Do

Do NOT manually delete files in:

```
/var/lib/docker/overlay2
```

You will corrupt Docker.

Always use Docker CLI commands.

---

# 📝 Quick Maintenance Checklist

When disk is full:

1. `docker system df -v`
2. `docker image prune -a`
3. `docker builder prune -a`
4. `docker system df`
5. Verify `/var/lib/docker/overlay2` size
