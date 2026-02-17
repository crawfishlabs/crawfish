<p align="center">
  <img src="https://gitlab.com/samuelbirk-private/crawfish/claw-platform/-/raw/main/assets/logo.png" alt="Crawfish" width="200" />
</p>

<h1 align="center">Crawfish</h1>

<p align="center">
  <strong>Build AI assistants that actually do things.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@crawfish/sdk"><img src="https://img.shields.io/npm/v/@crawfish/sdk?color=blue&label=sdk" alt="npm version" /></a>
  <a href="https://github.com/crawfishlabs/crawfish/actions"><img src="https://img.shields.io/github/actions/workflow/status/crawfishlabs/crawfish/ci.yml?branch=main" alt="CI" /></a>
  <a href="https://github.com/crawfishlabs/crawfish/blob/main/LICENSE"><img src="https://img.shields.io/github/license/crawfishlabs/crawfish" alt="License" /></a>
  <a href="https://discord.gg/crawfish"><img src="https://img.shields.io/discord/DISCORD_ID?color=5865F2&label=discord" alt="Discord" /></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#packages">Packages</a> •
  <a href="#documentation">Docs</a> •
  <a href="#contributing">Contributing</a>
</p>

---

> **📌 Mirror Notice:** This repository is mirrored from [GitLab](https://gitlab.com/samuelbirk-private/crawfish/claw-platform). PRs and Issues are welcome here — development happens on GitLab.

## What is Crawfish?

Crawfish is a platform for building AI assistants that integrate with real-world tools and services. It provides adapters, SDKs, and core packages to connect LLMs to messaging platforms, smart home devices, calendars, and more.

## Quick Start

```bash
npm install @crawfish/sdk
```

```typescript
import { createAssistant } from '@crawfish/sdk';

const assistant = createAssistant({
  // your config
});

await assistant.start();
```

## Packages

| Package | Description | Version |
|---------|-------------|---------|
| `@crawfish/sdk` | Core SDK | ![npm](https://img.shields.io/npm/v/@crawfish/sdk?label=) |
| `@crawfish/adapter-telegram` | Telegram adapter | ![npm](https://img.shields.io/npm/v/@crawfish/adapter-telegram?label=) |
| `@crawfish/adapter-discord` | Discord adapter | ![npm](https://img.shields.io/npm/v/@crawfish/adapter-discord?label=) |
| `@crawfish/core` | Shared core utilities | ![npm](https://img.shields.io/npm/v/@crawfish/core?label=) |

> Package names are placeholders — update once packages are published.

## Documentation

- 📖 [Full Documentation](https://docs.crawfish.dev) _(coming soon)_
- 💬 [Discord Community](https://discord.gg/crawfish)
- 🐛 [Report a Bug](https://github.com/crawfishlabs/crawfish/issues/new)

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

**Development happens on GitLab.** You can:
- **Open Issues** here on GitHub for bugs and feature requests
- **Submit PRs** here — we'll review and merge upstream
- **Join Discord** for discussion and questions

### Development Setup

```bash
git clone https://github.com/crawfishlabs/crawfish.git
cd crawfish
pnpm install
pnpm dev
```

## License

[MIT](LICENSE) © [Crawfish Labs](https://crawfish.dev)

---

<p align="center">
  Built with 🦞 by <a href="https://crawfish.dev">Crawfish Labs</a><br/>
  <sub>Mirror of <a href="https://gitlab.com/samuelbirk-private/crawfish/claw-platform">gitlab.com/samuelbirk-private/crawfish/claw-platform</a></sub>
</p>
