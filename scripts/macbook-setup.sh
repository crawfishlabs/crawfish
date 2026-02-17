#!/bin/bash
# MacBook Pro Setup Script — Claw Ecosystem
# Run: curl -sSL <url> | bash  OR  bash macbook-setup.sh
# Time estimate: ~30 minutes (mostly downloads)

set -e

echo "🦞 Claw Ecosystem — MacBook Setup"
echo "=================================="

# 1. Xcode Command Line Tools
if ! xcode-select -p &>/dev/null; then
  echo "Installing Xcode Command Line Tools..."
  xcode-select --install
  echo "⏳ Wait for Xcode CLT to finish, then re-run this script"
  exit 0
fi

# 2. Homebrew
if ! command -v brew &>/dev/null; then
  echo "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$(/opt/homebrew/bin/brew shellenv)"
fi

# 3. Core tools
brew install node@22 git git-lfs watchman cocoapods fastlane meilisearch jq

# 4. Node global packages
npm install -g firebase-tools typescript tsx openclaw

# 5. Ruby (for CocoaPods/Fastlane)
brew install ruby
echo 'export PATH="/opt/homebrew/opt/ruby/bin:$PATH"' >> ~/.zshrc
gem install cocoapods fastlane

# 6. Clone all repos
REPO_BASE="$HOME/Developer/claw"
mkdir -p "$REPO_BASE"
for repo in claw-platform claw-fitness claw-nutrition claw-budget claw-meetings claw-web; do
  if [ ! -d "$REPO_BASE/$repo" ]; then
    git clone git@gitlab.com:samuelbirk-private/crawfish/$repo.git "$REPO_BASE/$repo"
  else
    cd "$REPO_BASE/$repo" && git pull origin main
  fi
done

# 7. Install all dependencies
for repo in claw-platform claw-fitness claw-nutrition claw-budget claw-meetings claw-web; do
  echo "📦 Installing deps for $repo..."
  cd "$REPO_BASE/$repo"

  # Backend
  if [ -d "backend/functions" ]; then
    cd backend/functions && npm install && cd ../..
  fi

  # Root package.json
  if [ -f "package.json" ]; then
    npm install
  fi

  # iOS pods
  if [ -f "Podfile" ]; then
    pod install
  fi
done

# 8. Platform packages — build all
cd "$REPO_BASE/claw-platform"
for pkg in packages/*/; do
  if [ -f "$pkg/package.json" ]; then
    echo "Building $pkg..."
    cd "$pkg" && npm install && npm run build 2>/dev/null; cd "$REPO_BASE/claw-platform"
  fi
done

# 9. Link platform packages locally
cd "$REPO_BASE/claw-platform"
for pkg in packages/*/; do
  if [ -f "$pkg/package.json" ]; then
    cd "$pkg" && npm link 2>/dev/null; cd "$REPO_BASE/claw-platform"
  fi
done

# 10. Firebase setup
echo "🔥 Firebase projects needed:"
echo "  - claw-fitness-prod"
echo "  - claw-nutrition-prod"
echo "  - claw-budget-prod"
echo "  - claw-meetings-prod"
echo "Run: firebase login"
echo "Then: firebase use --add (in each app dir)"

# 11. Meilisearch
echo "Starting Meilisearch..."
brew services start meilisearch

# 12. Environment files
for repo in claw-fitness claw-nutrition claw-budget claw-meetings; do
  if [ ! -f "$REPO_BASE/$repo/.env" ]; then
    cp "$REPO_BASE/$repo/.env.example" "$REPO_BASE/$repo/.env" 2>/dev/null || echo "⚠️  Create .env for $repo manually"
  fi
done

# 13. FileVault (encryption)
if ! fdesetup status | grep -q "On"; then
  echo "⚠️  FileVault is OFF. Enable it: System Settings → Privacy & Security → FileVault"
fi

# 14. SSH key for GitLab
if [ ! -f "$HOME/.ssh/id_ed25519" ]; then
  echo "Generating SSH key..."
  ssh-keygen -t ed25519 -C "sam@claw.dev" -f "$HOME/.ssh/id_ed25519" -N ""
  echo "Add this key to GitLab: https://gitlab.com/-/user_settings/ssh_keys"
  cat "$HOME/.ssh/id_ed25519.pub"
fi

echo ""
echo "✅ Setup complete! Next steps:"
echo "1. Open Xcode and install iOS simulators"
echo "2. Create Firebase projects (firebase login)"
echo "3. Add GoogleService-Info.plist to each iOS app"
echo "4. Set up Apple Developer account"
echo "5. Run the test plan: cat $REPO_BASE/claw-platform/TESTING-PLAN.md"
