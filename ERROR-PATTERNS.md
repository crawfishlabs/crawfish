# Error Patterns — Claw Ecosystem

Common errors you'll hit on first compile and how to fix them.

## TypeScript

### `Cannot find module '@claw/...'`
Platform packages not linked. Run:
```bash
cd ~/Developer/claw/claw-platform
for pkg in packages/*/; do cd "$pkg" && npm link && cd ../..; done
cd ~/Developer/claw/claw-fitness && npm link @claw/auth @claw/llm-router # etc
```

### `Type 'X' is not assignable to type 'Y'`
Written without compiler — expect type mismatches. Fix inline.

### `Property 'X' does not exist on type 'Y'`
Interface definitions may be incomplete. Check the @claw package types.

## Swift / Xcode

### `No such module 'ClawKit'`
ClawKit SPM package not added to Xcode project. Add via File → Add Package Dependencies → local path.

### `No such module 'FirebaseFirestore'`
Run `pod install` in the iOS app directory, then open `.xcworkspace` (not `.xcodeproj`).

### `Type 'X' has no member 'Y'`
SwiftUI API differences — code was written targeting iOS 17+. Verify deployment target.

### `Cannot find 'GoogleService-Info.plist'`
Download from Firebase Console → Project Settings → iOS app → download plist.

## Firebase

### `Error: No project active`
```bash
firebase use --add  # select the right project
```

### `Error: Functions deployment failed`
Check Node version matches (`node@22`). Check `engines` in package.json.

## Meilisearch

### `Connection refused on port 7700`
```bash
brew services start meilisearch
```

### Indexing OOM
Index in batches. The script should handle this but if not, reduce batch size in `index-to-meilisearch.ts`.

## CocoaPods

### `CDN: trunk URL couldn't be downloaded`
```bash
pod repo update
pod install --repo-update
```
