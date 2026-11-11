# Start Here on a New Device

## 1. Clone the Repository

```powershell
git clone https://github.com/heyitzrizki/catetin-project.git
cd catetin-project
git fetch --all --prune
```

For the stable context and R3A design:

```powershell
git switch main
git pull --ff-only origin main
```

For continuing the isolated R3B-A spike:

```powershell
git switch --track origin/travel/r3b-a-spike
```

## 2. Install and Verify Locally

```powershell
npm.cmd ci
npm.cmd run lint
npx.cmd tsx --test spikes/r2-multipart-interoperability/tests/r2-multipart-spike.test.ts
```

Do not run remote spike steps until Cloudflare R2 is explicitly activated and scoped credentials are created securely.

## 3. Restore Tool Access

Install or sign into these tools independently on the laptop:

- Git/GitHub credential manager.
- Codex or the chosen coding agent.
- Antigravity if it will be used.
- Node.js compatible with this repository.
- Wrangler via project dependencies.

For Cloudflare work:

```powershell
npx.cmd wrangler login
npx.cmd wrangler whoami
```

Verify the displayed account before creating or mutating any resource. Never copy the office computer's Wrangler credential files.

## 4. Recreate Secrets Safely

- Do not retrieve secrets from Git or chat.
- Use the relevant provider dashboard or secret manager.
- Put spike-only local values in `spikes/r2-multipart-interoperability/.dev.vars`.
- Keep `.dev.vars` untracked.
- Use placeholders from `.dev.vars.example` as the field list only.

## 5. Bootstrap Codex Context

Open the repository and send:

> Baca `AGENTS.md` lalu `docs/handoff/README.md` dan semua dokumen yang dirujuk dalam urutan baca. Jangan mengubah kode atau menjalankan remote command dulu. Ringkas status terakhir, jelaskan perbedaan `main` dan `travel/r3b-a-spike`, sebutkan bukti yang masih kurang untuk R3B-A, dan konfirmasi bahwa secret tidak boleh dibaca atau dicetak.

The new Codex session does not need the office machine's internal chat database if it reads this context pack.

## 6. Safe First Task on the Laptop

The first task should be local-only:

1. Confirm branch and clean/expected worktree.
2. Run the targeted R3B-A test.
3. Run lint.
4. Review `README.md` inside the spike folder.
5. Stop before any R2 activation, bucket creation, token creation, remote Worker execution, or deploy.

After those checks, decide separately whether to activate Cloudflare R2 and run the empirical browser interoperability gate.
