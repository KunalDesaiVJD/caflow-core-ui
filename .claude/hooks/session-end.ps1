# session-end.ps1
# Runs when Claude Code session ends (Stop hook).
# - If on a claude/auto-* branch: merge to main, push, delete branch
# - If on main: commit any uncommitted changes and push
# Errors are swallowed so they never block the session from closing.

$repo = "C:/Users/Admin/OneDrive/Documents/GitHub/caflow-core-ui"

try {
    Set-Location $repo -ErrorAction Stop

    $branch = git rev-parse --abbrev-ref HEAD 2>$null
    if (-not $branch) { exit 0 }

    if ($branch -match "^claude/auto-") {

        # Stage and commit anything uncommitted on the feature branch
        $status = git status --porcelain 2>$null
        if ($status) {
            git add -A 2>$null
            git commit -m "chore: auto-commit session changes on $branch

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>" 2>$null
        }

        # Switch to main and pull latest
        git checkout main 2>$null
        git pull origin main --rebase 2>$null

        # Merge the feature branch (no fast-forward so it shows in log)
        git merge $branch --no-ff -m "merge: session branch $branch into main

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>" 2>$null

        # Push main
        git push origin main 2>$null

        # Delete branch locally and remotely
        git branch -d $branch 2>$null
        git push origin --delete $branch 2>$null

    } elseif ($branch -eq "main") {

        # On main — just push any unpushed commits
        $status = git status --porcelain 2>$null
        if ($status) {
            git add -A 2>$null
            git commit -m "chore: auto-commit session changes

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>" 2>$null
        }
        git push origin main 2>$null

    }

} catch {
    # Never block session close on hook error
    exit 0
}

exit 0
